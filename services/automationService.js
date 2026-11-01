const fs = require('fs').promises;
const path = require('path');
const governanceService = require('./governanceService');

const AUTOMATIONS_PATH = path.join(__dirname, '..', 'data', 'automations.json');

class AutomationService {
    constructor() {
        this.lock = Promise.resolve();
    }

    async _read() {
        try {
            const raw = await fs.readFile(AUTOMATIONS_PATH, 'utf8');
            return JSON.parse(raw);
        } catch {
            const initial = {
                automations: [
                    {
                        id: 'aut_reengage_48h',
                        name: '48-Hour Unopened Offer Nudge',
                        active: true,
                        trigger: {
                            type: 'DAYS_INACTIVE',
                            delayValue: 2,
                            delayUnit: 'DAYS'
                        },
                        conditions: [
                            { field: 'gender', operator: 'EQUALS', value: 'All' }
                        ],
                        actions: [
                            {
                                type: 'SEND_WHATSAPP',
                                channel: 'whatsapp',
                                template: 'Hi {{1}}, your exclusive offer code {{2}} is expiring soon! Tap here to claim before Sunday midnight.',
                                offerCode: 'SUMMER25'
                            }
                        ],
                        stats: { triggeredCount: 142, completedCount: 138, convertedCount: 29 },
                        createdAt: new Date(Date.now() - 86400000 * 7).toISOString(),
                        logs: [
                            {
                                timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
                                event: 'TRIGGERED',
                                details: 'Evaluated 12 eligible customers. Dispatched 12 follow-ups.'
                            }
                        ]
                    },
                    {
                        id: 'aut_vip_care_alert',
                        name: 'High-Value VIP Follow-Up',
                        active: true,
                        trigger: {
                            type: 'CAMPAIGN_DISPATCHED',
                            delayValue: 1,
                            delayUnit: 'HOURS'
                        },
                        conditions: [
                            { field: 'age', operator: 'GREATER_THAN', value: '25' }
                        ],
                        actions: [
                            {
                                type: 'NOTIFY_CARE',
                                note: 'VIP customer received campaign. Customer care desk ready for priority call handling.'
                            }
                        ],
                        stats: { triggeredCount: 54, completedCount: 54, convertedCount: 18 },
                        createdAt: new Date(Date.now() - 86400000 * 14).toISOString(),
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
            await fs.writeFile(AUTOMATIONS_PATH, JSON.stringify(data, null, 2), 'utf8');
        }));
    }

    async getAll() {
        const db = await this._read();
        return db.automations || [];
    }

    async getById(id) {
        const db = await this._read();
        return (db.automations || []).find(a => String(a.id) === String(id)) || null;
    }

    async createAutomation(payload) {
        const db = await this._read();
        if (!db.automations) db.automations = [];

        const newAutomation = {
            id: 'aut_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            name: payload.name || 'Untitled Automation Workflow',
            active: payload.active !== undefined ? Boolean(payload.active) : true,
            trigger: payload.trigger || {
                type: 'CAMPAIGN_DISPATCHED',
                delayValue: 24,
                delayUnit: 'HOURS'
            },
            conditions: Array.isArray(payload.conditions) ? payload.conditions : [],
            actions: Array.isArray(payload.actions) && payload.actions.length > 0 ? payload.actions : [
                {
                    type: 'SEND_SMS',
                    channel: 'sms',
                    template: 'Hi {{1}}, don’t miss our latest update! Code {{2}} is active.',
                    offerCode: 'SUMMER25'
                }
            ],
            stats: { triggeredCount: 0, completedCount: 0, convertedCount: 0 },
            createdAt: new Date().toISOString(),
            logs: [
                {
                    timestamp: new Date().toISOString(),
                    event: 'CREATED',
                    details: 'Workflow created and activated'
                }
            ]
        };

        db.automations.unshift(newAutomation);
        await this._write(db);
        return newAutomation;
    }

    async updateAutomation(id, updates) {
        const db = await this._read();
        const index = (db.automations || []).findIndex(a => String(a.id) === String(id));
        if (index === -1) throw new Error('Automation workflow not found');

        const current = db.automations[index];
        db.automations[index] = {
            ...current,
            ...updates,
            id: current.id,
            stats: current.stats,
            logs: current.logs
        };

        await this._write(db);
        return db.automations[index];
    }

    async toggleActive(id) {
        const db = await this._read();
        const item = (db.automations || []).find(a => String(a.id) === String(id));
        if (!item) throw new Error('Automation workflow not found');

        item.active = !item.active;
        item.logs.unshift({
            timestamp: new Date().toISOString(),
            event: item.active ? 'ACTIVATED' : 'PAUSED',
            details: `Workflow marked as ${item.active ? 'ACTIVE' : 'PAUSED'}`
        });

        await this._write(db);
        return item;
    }

    async deleteAutomation(id) {
        const db = await this._read();
        db.automations = (db.automations || []).filter(a => String(a.id) !== String(id));
        await this._write(db);
        return { success: true, deletedId: id };
    }

    async triggerTest(id, testCustomer = { name: 'Alex Johnson', phone: '+919363341709', gender: 'Men', age: 30 }) {
        const db = await this._read();
        const item = (db.automations || []).find(a => String(a.id) === String(id));
        if (!item) throw new Error('Automation workflow not found');

        const suppressed = await governanceService.isSuppressed(testCustomer.phone);
        if (suppressed) {
            return {
                success: false,
                suppressed: true,
                message: `Test halted: Customer ${testCustomer.phone} is on suppression list.`
            };
        }

        item.stats.triggeredCount = (item.stats.triggeredCount || 0) + 1;
        item.stats.completedCount = (item.stats.completedCount || 0) + 1;

        const actionOutputs = item.actions.map(action => {
            return {
                type: action.type,
                channel: action.channel || 'both',
                dispatchedTo: testCustomer.phone,
                preview: (action.template || '').replace('{{1}}', testCustomer.name).replace('{{2}}', action.offerCode || 'SUMMER25'),
                status: 'DELIVERED_SIMULATED'
            };
        });

        item.logs.unshift({
            timestamp: new Date().toISOString(),
            event: 'TEST_EXECUTED',
            details: `Simulated dispatch for ${testCustomer.name} (${testCustomer.phone}). ${actionOutputs.length} action(s) processed.`
        });

        await this._write(db);
        return {
            success: true,
            workflow: item.name,
            actionsProcessed: actionOutputs
        };
    }
}

module.exports = new AutomationService();

