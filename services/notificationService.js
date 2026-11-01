const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NOTIFICATIONS_FILE = path.join(__dirname, '..', 'data', 'notifications.json');

class NotificationService {
    constructor() {
        this._initStorage();
    }

    _initStorage() {
        if (!fs.existsSync(NOTIFICATIONS_FILE)) {
            const initial = {
                notifications: [
                    {
                        id: 'notif_init_sys_001',
                        userId: 'admin',
                        type: 'info',
                        category: 'INTEGRATION',
                        title: 'Telephony Gateway Synchronized',
                        message: 'Twilio production gateway verified and operational for SMS and WhatsApp dispatches.',
                        relatedEntityType: 'integration',
                        relatedEntityId: 'twilio',
                        actionUrl: 'integrations',
                        isRead: false,
                        createdAt: new Date(Date.now() - 3600000).toISOString(),
                        readAt: null,
                        metadata: { provider: 'twilio', status: 'CONNECTED' }
                    },
                    {
                        id: 'notif_init_sys_002',
                        userId: 'admin',
                        type: 'success',
                        category: 'GOVERNANCE',
                        title: 'Compliance Governance Active',
                        message: 'Quiet hours filter and anti-fatigue frequency caps enforced across all channels.',
                        relatedEntityType: 'governance',
                        actionUrl: 'settings',
                        isRead: false,
                        createdAt: new Date(Date.now() - 7200000).toISOString(),
                        readAt: null
                    }
                ]
            };
            fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(initial, null, 2), 'utf8');
        }
    }

    async _read() {
        try {
            if (!fs.existsSync(NOTIFICATIONS_FILE)) {
                this._initStorage();
            }
            const data = fs.readFileSync(NOTIFICATIONS_FILE, 'utf8');
            return JSON.parse(data);
        } catch (e) {
            console.error('Failed reading notifications file:', e.message);
            return { notifications: [] };
        }
    }

    async _write(data) {
        try {
            const tempFile = `${NOTIFICATIONS_FILE}.tmp.${Date.now()}`;
            fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
            fs.renameSync(tempFile, NOTIFICATIONS_FILE);
        } catch (e) {
            console.error('Failed writing notifications file:', e.message);
        }
    }

    /**
     * Get list of notifications for user
     */
    async getAll({ userId = 'admin', limit = 50, unreadOnly = false } = {}) {
        const db = await this._read();
        let list = (db.notifications || []).filter(n => !n.userId || n.userId === 'all' || n.userId === userId);

        if (unreadOnly) {
            list = list.filter(n => !n.isRead);
        }

        // Sort descending by creation date
        list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        return list.slice(0, limit);
    }

    /**
     * Get unread count
     */
    async getUnreadCount({ userId = 'admin' } = {}) {
        const db = await this._read();
        const list = (db.notifications || []).filter(n => (!n.userId || n.userId === 'all' || n.userId === userId) && !n.isRead);
        return list.length;
    }

    /**
     * Create a notification with idempotency protection against duplicate worker loops
     */
    async createNotification({
        userId = 'admin',
        type = 'info', // 'success' | 'error' | 'warning' | 'info'
        category = 'CAMPAIGN',
        title,
        message,
        relatedEntityType = null,
        relatedEntityId = null,
        actionUrl = null,
        idempotencyKey = null,
        metadata = {}
    }) {
        if (!title || !message) return null;

        const db = await this._read();
        if (!db.notifications) db.notifications = [];

        // Check duplicate within 10 minutes if idempotencyKey supplied
        if (idempotencyKey) {
            const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
            const duplicate = db.notifications.find(
                n => n.idempotencyKey === idempotencyKey && new Date(n.createdAt).getTime() > tenMinutesAgo
            );
            if (duplicate) {
                return duplicate; // Return existing without re-emitting
            }
        }

        const id = 'notif_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
        const notif = {
            id,
            userId,
            type,
            category,
            title,
            message,
            relatedEntityType,
            relatedEntityId,
            actionUrl,
            idempotencyKey,
            isRead: false,
            createdAt: new Date().toISOString(),
            readAt: null,
            metadata
        };

        // Keep last 200 notifications to prevent unbounded storage
        db.notifications.unshift(notif);
        if (db.notifications.length > 200) {
            db.notifications = db.notifications.slice(0, 200);
        }

        await this._write(db);
        return notif;
    }

    /**
     * Mark single notification as read
     */
    async markRead(id, userId = 'admin') {
        const db = await this._read();
        const notif = (db.notifications || []).find(n => n.id === id && (!n.userId || n.userId === userId || n.userId === 'admin'));
        if (notif) {
            notif.isRead = true;
            notif.readAt = new Date().toISOString();
            await this._write(db);
            return { success: true, notification: notif };
        }
        return { success: false, error: 'Notification not found' };
    }

    /**
     * Mark all notifications as read for user
     */
    async markAllRead(userId = 'admin') {
        const db = await this._read();
        let updatedCount = 0;
        const now = new Date().toISOString();

        (db.notifications || []).forEach(n => {
            if ((!n.userId || n.userId === userId || n.userId === 'admin') && !n.isRead) {
                n.isRead = true;
                n.readAt = now;
                updatedCount++;
            }
        });

        if (updatedCount > 0) {
            await this._write(db);
        }

        return { success: true, updatedCount };
    }

    /**
     * Delete single notification
     */
    async deleteNotification(id, userId = 'admin') {
        const db = await this._read();
        const initialLen = db.notifications ? db.notifications.length : 0;
        db.notifications = (db.notifications || []).filter(
            n => !(n.id === id && (!n.userId || n.userId === userId || n.userId === 'admin'))
        );

        if (db.notifications.length !== initialLen) {
            await this._write(db);
            return { success: true };
        }
        return { success: false, error: 'Notification not found' };
    }

    /**
     * Clear all notifications for user
     */
    async clearAll(userId = 'admin') {
        const db = await this._read();
        db.notifications = (db.notifications || []).filter(
            n => n.userId && n.userId !== userId && n.userId !== 'admin'
        );
        await this._write(db);
        return { success: true };
    }
}

module.exports = new NotificationService();

