const fs = require('fs').promises;
const path = require('path');

const SUPPRESSION_PATH = path.join(__dirname, '..', 'data', 'suppression.json');

class GovernanceService {
    constructor() {
        this.lock = Promise.resolve();
    }

    async _read() {
        try {
            const raw = await fs.readFile(SUPPRESSION_PATH, 'utf8');
            return JSON.parse(raw);
        } catch {
            const initial = {
                suppressionList: [
                    {
                        phone: '+15005550009',
                        reason: 'User Opt-Out (STOP)',
                        source: 'INBOUND_SMS',
                        addedAt: new Date(Date.now() - 86400000 * 3).toISOString()
                    }
                ],
                rules: {
                    quietHoursEnabled: true,
                    quietHoursStart: '21:00', // 9:00 PM
                    quietHoursEnd: '08:00',   // 8:00 AM
                    timezone: 'Asia/Kolkata',
                    frequencyCapEnabled: true,
                    maxMessagesPerWeek: 3,
                    optOutKeywords: ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'QUIT', 'END', 'OPTOUT']
                }
            };
            await this._write(initial);
            return initial;
        }
    }

    async _write(data) {
        await (this.lock = this.lock.then(async () => {
            await fs.writeFile(SUPPRESSION_PATH, JSON.stringify(data, null, 2), 'utf8');
        }));
    }

    async getSuppressionList() {
        const db = await this._read();
        return db.suppressionList || [];
    }

    async isSuppressed(phone) {
        if (!phone) return false;
        const db = await this._read();
        const clean = String(phone).replace(/\s+/g, '');
        return (db.suppressionList || []).some(s => s.phone.replace(/\s+/g, '') === clean);
    }

    async suppressPhone(phone, reason = 'Manual Suppression', source = 'DASHBOARD') {
        const db = await this._read();
        if (!db.suppressionList) db.suppressionList = [];

        const clean = String(phone).trim();
        const exists = db.suppressionList.find(s => s.phone === clean);
        if (exists) {
            exists.reason = reason;
            exists.updatedAt = new Date().toISOString();
        } else {
            db.suppressionList.unshift({
                phone: clean,
                reason,
                source,
                addedAt: new Date().toISOString()
            });
        }

        await this._write(db);
        return { success: true, count: db.suppressionList.length };
    }

    async unsuppressPhone(phone) {
        const db = await this._read();
        const clean = String(phone).trim();
        db.suppressionList = (db.suppressionList || []).filter(s => s.phone !== clean);
        await this._write(db);
        return { success: true, count: db.suppressionList.length };
    }

    async getRules() {
        const db = await this._read();
        return db.rules || {};
    }

    async updateRules(updates) {
        const db = await this._read();
        db.rules = {
            ...(db.rules || {}),
            ...updates
        };
        await this._write(db);
        return db.rules;
    }

    isWithinQuietHours() {
        const now = new Date();
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const currentMins = hours * 60 + minutes;

        // Default: 21:00 (1260 mins) to 08:00 (480 mins)
        // If current time >= 21:00 OR current time < 08:00, it is quiet hours
        return currentMins >= (21 * 60) || currentMins < (8 * 60);
    }

    async validateDispatch({ phone, lastContacted = null, historyCount = 0 }) {
        if (await this.isSuppressed(phone)) {
            return { allowed: false, reason: 'SUPPRESSED: Recipient is on the opt-out suppression list' };
        }

        const rules = await this.getRules();
        if (rules.quietHoursEnabled && this.isWithinQuietHours()) {
            return {
                allowed: false,
                reason: `QUIET_HOURS: Current dispatch falls inside protected quiet hours (${rules.quietHoursStart} - ${rules.quietHoursEnd})`
            };
        }

        if (rules.frequencyCapEnabled && lastContacted) {
            const timeSinceLast = Date.now() - new Date(lastContacted).getTime();
            const oneDay = 24 * 60 * 60 * 1000;
            if (timeSinceLast < oneDay) {
                return {
                    allowed: false,
                    reason: 'FREQUENCY_CAP: Recipient already contacted within the last 24 hours'
                };
            }
        }

        return { allowed: true };
    }
}

module.exports = new GovernanceService();

