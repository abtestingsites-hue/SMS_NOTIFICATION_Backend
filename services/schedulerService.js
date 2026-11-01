const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const governanceService = require('./governanceService');

const SCHEDULES_PATH = path.join(__dirname, '..', 'data', 'schedules.json');

class SchedulerService {
    constructor() {
        this.lock = Promise.resolve();
        this.timer = null;
        this.isProcessing = false;
    }

    async _read() {
        try {
            const raw = await fs.readFile(SCHEDULES_PATH, 'utf8');
            return JSON.parse(raw);
        } catch {
            const initial = {
                schedules: [
                    {
                        id: 'sch_' + Date.now(),
                        name: 'Weekend VIP Flash Sale',
                        type: 'WEEKLY',
                        cron: '0 10 * * 6',
                        scheduledAt: new Date(Date.now() + 86400000 * 2).toISOString(),
                        timezone: 'Asia/Kolkata',
                        channel: 'both',
                        targetAudience: 'All',
                        templateContent: 'Hi {{1}}, our weekend special is now live! Use code {{2}} to get {{3}} today only.',
                        offerCode: 'SUMMER25',
                        idempotencyKey: 'idemp_' + crypto.randomBytes(8).toString('hex'),
                        status: 'SCHEDULED',
                        createdAt: new Date().toISOString(),
                        lastRunAt: null,
                        executionCount: 0,
                        logs: []
                    }
                ]
            };
            await this._write(initial);
            return initial;
        }
    }

    async _write(data) {
        await (this.lock = this.lock.then(async () => {
            await fs.writeFile(SCHEDULES_PATH, JSON.stringify(data, null, 2), 'utf8');
        }));
    }

    async getAll() {
        const db = await this._read();
        return (db.schedules || []).sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
    }

    async getById(id) {
        const db = await this._read();
        return (db.schedules || []).find(s => String(s.id) === String(id)) || null;
    }

    async createSchedule(payload) {
        const db = await this._read();
        if (!db.schedules) db.schedules = [];

        const scheduledTime = payload.scheduledAt ? new Date(payload.scheduledAt) : new Date(Date.now() + 3600000);
        const idempotencyKey = payload.idempotencyKey || ('idemp_' + crypto.randomBytes(12).toString('hex'));

        const newSchedule = {
            id: 'sch_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            name: payload.name || 'Automated Scheduled Dispatch',
            type: payload.type || 'ONCE', // ONCE | DAILY | WEEKLY | MONTHLY
            scheduledAt: scheduledTime.toISOString(),
            timezone: payload.timezone || 'Asia/Kolkata',
            channel: payload.channel || 'both', // both | whatsapp | sms
            targetAudience: payload.targetAudience || 'All',
            templateContent: payload.templateContent || 'Hi {{1}}, special update from SMS Campaign System!',
            offerCode: payload.offerCode || 'SUMMER25',
            mediaId: payload.mediaId || null,
            idempotencyKey: idempotencyKey,
            status: 'SCHEDULED',
            createdAt: new Date().toISOString(),
            lastRunAt: null,
            executionCount: 0,
            logs: [
                {
                    timestamp: new Date().toISOString(),
                    event: 'SCHEDULED',
                    details: `Scheduled for ${scheduledTime.toISOString()}`
                }
            ]
        };

        db.schedules.unshift(newSchedule);
        await this._write(db);
        return newSchedule;
    }

    async updateSchedule(id, updates) {
        const db = await this._read();
        const index = (db.schedules || []).findIndex(s => String(s.id) === String(id));
        if (index === -1) throw new Error('Schedule not found');

        const current = db.schedules[index];
        db.schedules[index] = {
            ...current,
            ...updates,
            id: current.id, // prevent ID overwrite
            idempotencyKey: updates.scheduledAt && updates.scheduledAt !== current.scheduledAt
                ? ('idemp_' + crypto.randomBytes(12).toString('hex'))
                : current.idempotencyKey
        };

        await this._write(db);
        return db.schedules[index];
    }

    async cancelSchedule(id) {
        const db = await this._read();
        const item = (db.schedules || []).find(s => String(s.id) === String(id));
        if (!item) throw new Error('Schedule not found');

        item.status = 'CANCELLED';
        item.logs.push({
            timestamp: new Date().toISOString(),
            event: 'CANCELLED',
            details: 'Schedule cancelled by administrator'
        });

        await this._write(db);
        return item;
    }

    async deleteSchedule(id) {
        const db = await this._read();
        db.schedules = (db.schedules || []).filter(s => String(s.id) !== String(id));
        await this._write(db);
        return { success: true, deletedId: id };
    }

    async executeSchedule(scheduleId, { DataManager, QueueSimulator }) {
        const db = await this._read();
        const item = (db.schedules || []).find(s => String(s.id) === String(scheduleId));
        if (!item) return { success: false, error: 'Schedule not found' };

        const workerId = `${process.pid}@${require('os').hostname()}`;
        const LEASE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
        const now = Date.now();

        // Check if locked by an active worker
        if (item.status === 'RUNNING' && item.lockExpiresAt && new Date(item.lockExpiresAt).getTime() > now) {
            return {
                success: false,
                error: `Schedule currently locked by worker ${item.lockedBy || 'unknown'} until ${item.lockExpiresAt}`
            };
        }

        // Acquire worker lease lock
        item.status = 'RUNNING';
        item.lockedBy = workerId;
        item.lockedAt = new Date(now).toISOString();
        item.lockExpiresAt = new Date(now + LEASE_DURATION_MS).toISOString();
        item.lastRunAt = new Date(now).toISOString();
        await this._write(db);

        try {
            // Get customers
            const customers = await DataManager.getCustomers();
            const offers = await DataManager.getOffers();
            const selectedOffer = offers.find(o => o.code === item.offerCode) || (offers[0] || { code: 'SPECIAL', discount: '15% OFF' });

            // Filter customers by audience
            let targets = customers;
            if (item.targetAudience && item.targetAudience !== 'All') {
                targets = customers.filter(c => String(c.gender).toLowerCase() === String(item.targetAudience).toLowerCase());
            }

            let dispatchedCount = 0;
            let suppressedCount = 0;

            for (const customer of targets) {
                // Safety check
                const check = await governanceService.validateDispatch({
                    phone: customer.phone,
                    lastContacted: customer.lastContacted
                });

                if (!check.allowed) {
                    suppressedCount++;
                    continue;
                }

                dispatchedCount++;
                if (customer.phone) {
                    await DataManager.updateCustomerHistory(customer.phone, item.id);
                }
            }

            item.executionCount = (item.executionCount || 0) + 1;
            item.retryCount = 0;
            item.lockedBy = null;
            item.lockedAt = null;
            item.lockExpiresAt = null;

            item.logs.unshift({
                timestamp: new Date().toISOString(),
                event: 'EXECUTED',
                details: `Dispatched to ${dispatchedCount} recipients (${suppressedCount} suppressed by governance)`
            });

            // Reschedule if recurring
            if (item.type === 'DAILY') {
                const next = new Date(Date.now() + 86400000);
                item.scheduledAt = next.toISOString();
                item.status = 'SCHEDULED';
                item.idempotencyKey = 'idemp_' + crypto.randomBytes(12).toString('hex');
            } else if (item.type === 'WEEKLY') {
                const next = new Date(Date.now() + 86400000 * 7);
                item.scheduledAt = next.toISOString();
                item.status = 'SCHEDULED';
                item.idempotencyKey = 'idemp_' + crypto.randomBytes(12).toString('hex');
            } else {
                item.status = 'COMPLETED';
                try {
                    const notificationService = require('./notificationService');
                    await notificationService.createNotification({
                        userId: 'admin',
                        type: 'success',
                        category: 'SYSTEM',
                        title: 'Scheduled Broadcast Executed',
                        message: `Scheduled broadcast "${item.name}" executed successfully. Dispatched: ${dispatchedCount}.`,
                        relatedEntityType: 'schedule',
                        relatedEntityId: item.id,
                        actionUrl: 'scheduler',
                        idempotencyKey: `schedule_completed_${item.id}_${Date.now()}`
                    });
                } catch (e) {}
            }

            await this._write(db);
            return { success: true, dispatchedCount, suppressedCount, status: item.status };
        } catch (err) {
            console.error('Scheduler execution error:', err);
            item.retryCount = (item.retryCount || 0) + 1;
            const maxRetries = item.maxRetries || 3;

            if (item.retryCount <= maxRetries) {
                // Exponential backoff retry: 1m, 2m, 4m
                const backoffMs = Math.min(60000 * Math.pow(2, item.retryCount - 1), 15 * 60 * 1000);
                item.status = 'RETRYING';
                item.scheduledAt = new Date(Date.now() + backoffMs).toISOString();
                item.lockedBy = null;
                item.lockedAt = null;
                item.lockExpiresAt = null;
                item.logs.unshift({
                    timestamp: new Date().toISOString(),
                    event: 'RETRY_SCHEDULED',
                    details: `Execution failed (attempt ${item.retryCount}/${maxRetries}): ${err.message}. Retrying in ${Math.round(backoffMs / 1000)}s`
                });
            } else {
                item.status = 'DEAD_LETTER';
                item.lockedBy = null;
                item.lockedAt = null;
                item.lockExpiresAt = null;
                item.deadLetterReason = err.message;
                item.logs.unshift({
                    timestamp: new Date().toISOString(),
                    event: 'DEAD_LETTER_QUEUE',
                    details: `Job failed after ${maxRetries} attempts: ${err.message}. Moved to Dead-Letter Queue.`
                });
                try {
                    const notificationService = require('./notificationService');
                    await notificationService.createNotification({
                        userId: 'admin',
                        type: 'error',
                        category: 'SYSTEM',
                        title: 'Scheduled Job Moved to Dead-Letter Queue',
                        message: `Scheduled broadcast "${item.name}" failed after ${maxRetries} retries: ${err.message}`,
                        relatedEntityType: 'schedule',
                        relatedEntityId: item.id,
                        actionUrl: 'scheduler',
                        idempotencyKey: `schedule_failed_${item.id}`
                    });
                } catch (e) {}
            }

            await this._write(db);
            return { success: false, error: err.message, status: item.status };
        }
    }

    startRunner(deps) {
        if (this.timer) clearInterval(this.timer);
        this.timer = setInterval(async () => {
            if (this.isProcessing) return;
            this.isProcessing = true;
            try {
                const db = await this._read();
                const now = Date.now();

                // 1. Recover stale locks from dead/crashed worker instances
                let hasLockRecoveries = false;
                for (const s of (db.schedules || [])) {
                    if (s.status === 'RUNNING' && s.lockExpiresAt && new Date(s.lockExpiresAt).getTime() < now) {
                        console.warn(`[Scheduler Auto-Recovery] Releasing stale lock for schedule ${s.id} (worker: ${s.lockedBy})`);
                        s.status = 'SCHEDULED';
                        s.lockedBy = null;
                        s.lockedAt = null;
                        s.lockExpiresAt = null;
                        s.logs = s.logs || [];
                        s.logs.unshift({
                            timestamp: new Date().toISOString(),
                            event: 'LOCK_RECOVERED',
                            details: 'Worker lock expired without completion. Auto-recovered back to SCHEDULED queue.'
                        });
                        hasLockRecoveries = true;
                    }
                }
                if (hasLockRecoveries) {
                    await this._write(db);
                }

                // 2. Discover due jobs
                const due = (db.schedules || []).filter(s =>
                    (s.status === 'SCHEDULED' || s.status === 'RETRYING') &&
                    new Date(s.scheduledAt).getTime() <= now &&
                    (!s.lockExpiresAt || new Date(s.lockExpiresAt).getTime() < now)
                );

                for (const sched of due) {
                    await this.executeSchedule(sched.id, deps);
                }
            } catch (err) {
                console.error('Scheduler runner error:', err);
            } finally {
                this.isProcessing = false;
            }
        }, 15000);
    }
}

module.exports = new SchedulerService();

