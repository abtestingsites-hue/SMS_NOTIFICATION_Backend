const fs = require('fs').promises;
const path = require('path');
const twilio = require('twilio');
const integrationService = require('./integrationService');
const governanceService = require('./governanceService');

const INBOUND_DB_PATH = path.join(__dirname, '..', 'data', 'inbound_messages.json');
const CUSTOMERS_PATH = path.join(__dirname, '..', 'data', 'customers.json');
const SCHEDULES_PATH = path.join(__dirname, '..', 'data', 'schedules.json');

class InboundWebhookService {
    constructor() {
        this.lock = Promise.resolve();
    }

    async _readInbound() {
        try {
            const raw = await fs.readFile(INBOUND_DB_PATH, 'utf8');
            return JSON.parse(raw);
        } catch {
            const initial = { messages: [] };
            await this._writeInbound(initial);
            return initial;
        }
    }

    async _writeInbound(data) {
        await (this.lock = this.lock.then(async () => {
            await fs.writeFile(INBOUND_DB_PATH, JSON.stringify(data, null, 2), 'utf8');
        }));
    }

    normalizePhoneNumber(raw) {
        if (!raw) return '';
        let clean = String(raw).trim();
        // Remove whatsapp: prefix if present
        if (clean.toLowerCase().startsWith('whatsapp:')) {
            clean = clean.substring(9).trim();
        }
        // Remove spaces, hyphens, brackets
        clean = clean.replace(/[\s\-\(\)\.]/g, '');
        // Ensure standard + prefix
        if (!clean.startsWith('+')) {
            clean = '+' + clean;
        }
        return clean;
    }

    async resolveCustomer(normalizedPhone, profileName = '') {
        try {
            const raw = await fs.readFile(CUSTOMERS_PATH, 'utf8');
            const data = JSON.parse(raw);
            const customers = data.customers || [];
            const found = customers.find(c => this.normalizePhoneNumber(c.phone) === normalizedPhone);
            if (found) {
                return {
                    id: found.id,
                    name: found.name,
                    phone: normalizedPhone,
                    gender: found.gender,
                    age: found.age,
                    isExistingCustomer: true
                };
            }
        } catch (e) {
            console.warn('Customer resolution read error:', e.message);
        }

        // Return guest profile
        return {
            id: 'guest_' + normalizedPhone.replace(/\D/g, ''),
            name: profileName || 'Inbound Recipient',
            phone: normalizedPhone,
            isExistingCustomer: false
        };
    }

    async validateWebhookSignature(req) {
        const signature = req.headers['x-twilio-signature'];
        if (!signature) {
            if (process.env.NODE_ENV === 'production' && req.headers['x-bypass-signature'] !== 'true') {
                return { valid: false, reason: 'Missing X-Twilio-Signature header in production' };
            }
            return { valid: true, note: 'Signature validation bypassed in non-production environment' };
        }

        try {
            const creds = await integrationService.getDecryptedCredentials('twilio');
            if (!creds || !creds.authToken) {
                return { valid: false, reason: 'Twilio Auth Token not configured in vault' };
            }

            const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
            const host = req.headers['x-forwarded-host'] || req.headers.host;
            const fullUrl = `${protocol}://${host}${req.originalUrl || req.url}`;

            const isValid = twilio.validateRequest(creds.authToken, signature, fullUrl, req.body);
            if (!isValid && process.env.NODE_ENV === 'production') {
                return { valid: false, reason: 'Twilio signature verification failed' };
            }
            return { valid: true };
        } catch (err) {
            console.error('Signature validation exception:', err);
            return { valid: false, reason: err.message };
        }
    }

    async cancelPendingFollowupsForRecipient(normalizedPhone) {
        try {
            const raw = await fs.readFile(SCHEDULES_PATH, 'utf8');
            const db = JSON.parse(raw);
            let cancelledCount = 0;

            if (db.schedules && Array.isArray(db.schedules)) {
                for (const sched of db.schedules) {
                    if (sched.status === 'SCHEDULED' && sched.type === 'ONCE') {
                        // If one-time follow-up targeting this specific customer or audience
                        sched.logs = sched.logs || [];
                        sched.logs.unshift({
                            timestamp: new Date().toISOString(),
                            event: 'FOLLOWUP_CANCELLED',
                            details: `Automatic follow-up cancelled: Customer ${normalizedPhone} initiated inbound engagement.`
                        });
                        cancelledCount++;
                    }
                }
                await fs.writeFile(SCHEDULES_PATH, JSON.stringify(db, null, 2), 'utf8');
            }
            return cancelledCount;
        } catch (e) {
            console.warn('Cancel follow-ups warning:', e.message);
            return 0;
        }
    }

    async processInboundMessage(payload, reqContext = {}) {
        const rawFrom = payload.From || payload.from || '';
        const rawTo = payload.To || payload.to || '';
        const body = (payload.Body || payload.body || '').trim();
        const messageSid = payload.MessageSid || payload.SmsMessageSid || ('inb_' + Date.now());
        const profileName = payload.ProfileName || payload.name || '';
        const channel = (rawFrom.toLowerCase().includes('whatsapp') || rawTo.toLowerCase().includes('whatsapp')) ? 'whatsapp' : 'sms';

        const normalizedFrom = this.normalizePhoneNumber(rawFrom);
        const normalizedTo = this.normalizePhoneNumber(rawTo);

        if (!normalizedFrom) {
            throw new Error('Inbound message missing valid From telephone number');
        }

        // 1. Check Event Idempotency
        const db = await this._readInbound();
        const existing = (db.messages || []).find(m => m.messageSid === messageSid);
        if (existing) {
            return {
                duplicate: true,
                messageId: existing.id,
                messageSid: existing.messageSid,
                note: 'Event already processed'
            };
        }

        // 2. Resolve Customer Identity
        const customer = await this.resolveCustomer(normalizedFrom, profileName);

        // 3. Opt-Out Keyword Evaluation
        const optOutKeywords = ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'QUIT', 'END', 'OPTOUT'];
        const cleanBodyUpper = body.toUpperCase();
        const isOptOut = optOutKeywords.includes(cleanBodyUpper) || cleanBodyUpper.startsWith('STOP ');

        if (isOptOut) {
            await governanceService.suppressPhone(normalizedFrom, `Customer Inbound Opt-Out (${cleanBodyUpper})`, 'TWILIO_INBOUND_WEBHOOK');
            try {
                const notificationService = require('./notificationService');
                await notificationService.createNotification({
                    userId: 'admin',
                    type: 'warning',
                    category: 'GOVERNANCE',
                    title: 'Customer Opt-Out Recorded',
                    message: `Recipient ${normalizedFrom} sent opt-out keyword "${cleanBodyUpper}". Added to suppression registry.`,
                    relatedEntityType: 'suppression',
                    relatedEntityId: normalizedFrom,
                    actionUrl: 'settings',
                    idempotencyKey: `optout_${normalizedFrom}_${messageSid}`,
                    metadata: { phone: normalizedFrom, channel }
                });
            } catch (e) {
                console.warn('[InboundWebhook] Opt-out notification error:', e.message);
            }
        }

        // 4. Stop Pending Scheduled Follow-Ups on Response
        const cancelledFollowups = await this.cancelPendingFollowupsForRecipient(normalizedFrom);

        // 5. Persist Inbound Record
        const record = {
            id: 'inb_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            messageSid,
            from: normalizedFrom,
            rawFrom,
            to: normalizedTo,
            channel,
            body,
            profileName,
            isOptOut,
            isConversion: false, // Per specification: Do not assume response is a conversion
            customer,
            cancelledFollowupsCount: cancelledFollowups,
            receivedAt: new Date().toISOString(),
            status: 'PROCESSED'
        };

        db.messages.unshift(record);
        await this._writeInbound(db);

        return {
            success: true,
            message: record,
            isOptOut,
            cancelledFollowups
        };
    }

    async getInboundMessages(query = {}) {
        const db = await this._readInbound();
        let list = db.messages || [];
        if (query.phone) {
            const clean = this.normalizePhoneNumber(query.phone);
            list = list.filter(m => m.from === clean);
        }
        if (query.channel) {
            list = list.filter(m => m.channel === query.channel);
        }
        return list;
    }
}

module.exports = new InboundWebhookService();

