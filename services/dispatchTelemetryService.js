const fs = require('fs').promises;
const path = require('path');

const DISPATCHES_FILE = path.join(__dirname, '..', 'data', 'dispatches.json');

class DispatchTelemetryService {
    constructor() {
        this.lock = Promise.resolve();
        this.initialized = false;
    }

    async init() {
        if (this.initialized) return;
        try {
            await fs.access(DISPATCHES_FILE);
        } catch {
            await this.seedInitialFixtures();
        }
        this.initialized = true;
    }

    async _readDispatches() {
        try {
            const data = await fs.readFile(DISPATCHES_FILE, 'utf8');
            return JSON.parse(data);
        } catch {
            return [];
        }
    }

    async _writeDispatches(dispatches) {
        await fs.writeFile(DISPATCHES_FILE, JSON.stringify(dispatches, null, 2), 'utf8');
    }

    async recordDispatch({
        campaignId = null,
        channel, // 'sms' | 'whatsapp'
        recipient,
        provider = 'twilio',
        sid,
        status = 'queued',
        errorCode = null,
        errorMessage = null,
        metadata = {}
    }) {
        await this.init();
        return await (this.lock = this.lock.then(async () => {
            const dispatches = await this._readDispatches();
            const now = new Date().toISOString();

            // Check if record already exists by SID
            const existing = dispatches.find(d => d.sid === sid);
            if (existing) {
                return existing;
            }

            const record = {
                id: sid || `disp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                sid: sid || null,
                campaignId: campaignId ? String(campaignId) : null,
                channel: channel.toLowerCase(),
                recipient: recipient,
                provider: provider.toLowerCase(),
                status: this.normalizeStatus(status),
                attemptedAt: now,
                deliveredAt: this.normalizeStatus(status) === 'delivered' ? now : null,
                failedAt: ['failed', 'undelivered'].includes(this.normalizeStatus(status)) ? now : null,
                errorCode: errorCode || null,
                errorMessage: errorMessage || null,
                callbackCount: 0,
                lastCallbackAt: null,
                metadata: metadata || {}
            };

            dispatches.unshift(record);
            await this._writeDispatches(dispatches);
            return record;
        }));
    }

    async processStatusCallback({
        messageSid,
        messageStatus,
        errorCode = null,
        errorMessage = null,
        rawPayload = {}
    }) {
        await this.init();
        return await (this.lock = this.lock.then(async () => {
            const dispatches = await this._readDispatches();
            const now = new Date().toISOString();

            const record = dispatches.find(d => d.sid === messageSid);
            if (!record) {
                // If not found, create new record from callback
                const channel = (rawPayload.From && rawPayload.From.startsWith('whatsapp:')) || (rawPayload.To && rawPayload.To.startsWith('whatsapp:'))
                    ? 'whatsapp'
                    : 'sms';
                const newRecord = {
                    id: messageSid,
                    sid: messageSid,
                    campaignId: null,
                    channel,
                    recipient: rawPayload.To || 'unknown',
                    provider: 'twilio',
                    status: this.normalizeStatus(messageStatus),
                    attemptedAt: now,
                    deliveredAt: this.normalizeStatus(messageStatus) === 'delivered' ? now : null,
                    failedAt: ['failed', 'undelivered'].includes(this.normalizeStatus(messageStatus)) ? now : null,
                    errorCode: errorCode || rawPayload.ErrorCode || null,
                    errorMessage: errorMessage || rawPayload.ErrorMessage || null,
                    callbackCount: 1,
                    lastCallbackAt: now,
                    metadata: rawPayload
                };
                dispatches.unshift(newRecord);
                await this._writeDispatches(dispatches);
                return { success: true, action: 'CREATED', record: newRecord };
            }

            // Existing record update
            const normalized = this.normalizeStatus(messageStatus);
            record.callbackCount = (record.callbackCount || 0) + 1;
            record.lastCallbackAt = now;

            // Idempotent duplicate check: If identical status already recorded, log duplicate receipt
            const isDuplicate = record.status === normalized;

            record.status = normalized;
            if (normalized === 'delivered' && !record.deliveredAt) {
                record.deliveredAt = now;
            }
            if (['failed', 'undelivered'].includes(normalized) && !record.failedAt) {
                record.failedAt = now;
                record.errorCode = errorCode || rawPayload.ErrorCode || record.errorCode;
                record.errorMessage = errorMessage || rawPayload.ErrorMessage || record.errorMessage;
            }

            await this._writeDispatches(dispatches);
            return {
                success: true,
                action: isDuplicate ? 'DUPLICATE_CALLBACK_RECORDED' : 'STATUS_UPDATED',
                isDuplicate,
                record
            };
        }));
    }

    normalizeStatus(status) {
        if (!status) return 'unknown';
        const s = String(status).toLowerCase().trim();
        const valid = ['queued', 'accepted', 'sending', 'sent', 'delivered', 'failed', 'undelivered'];
        if (valid.includes(s)) return s;
        return 'unknown';
    }

    async getTelemetryMetrics({
        dateRange = 'all',
        granularity = 'daily',
        timeZone = 'UTC'
    } = {}) {
        await this.init();
        const dispatches = await this._readDispatches();

        // 1. Calculate Cutoff Timestamp based on Date Range
        const now = new Date();
        let cutoff = 0;
        if (dateRange === 'today') {
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            cutoff = startOfDay.getTime();
        } else if (dateRange === '7days') {
            cutoff = now.getTime() - 7 * 86400000;
        } else if (dateRange === '30days') {
            cutoff = now.getTime() - 30 * 86400000;
        } else if (dateRange === 'thisMonth') {
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            cutoff = startOfMonth.getTime();
        }

        const filtered = cutoff > 0
            ? dispatches.filter(d => new Date(d.attemptedAt).getTime() >= cutoff)
            : dispatches;

        // 2. Channel-Level Discrete Metrics
        const calculateChannelStats = (records) => {
            const attempted = records.length;
            const accepted = records.filter(r => ['queued', 'accepted', 'sending', 'sent', 'delivered'].includes(r.status)).length;
            const delivered = records.filter(r => r.status === 'delivered').length;
            const failed = records.filter(r => ['failed', 'undelivered'].includes(r.status)).length;
            const pending = records.filter(r => ['queued', 'accepted', 'sending', 'sent'].includes(r.status)).length;
            const unknown = records.filter(r => r.status === 'unknown').length;
            const deliveryRate = attempted > 0 ? Math.min(100, Math.round((delivered / attempted) * 100)) : null;
            const failureRate = attempted > 0 ? Math.min(100, Math.round((failed / attempted) * 100)) : null;

            return {
                attempted,
                accepted,
                delivered,
                failed,
                pending,
                unknown,
                deliveryRate,
                failureRate
            };
        };

        const smsRecords = filtered.filter(d => d.channel === 'sms');
        const waRecords = filtered.filter(d => d.channel === 'whatsapp');

        const smsStats = calculateChannelStats(smsRecords);
        const waStats = calculateChannelStats(waRecords);
        const totalStats = calculateChannelStats(filtered);

        // 3. Timeline Aggregation (Ensuring Chart Totals strictly match KPI Totals)
        const timeline = this.buildTimelineAggregation(filtered, granularity);

        return {
            dateRange,
            granularity,
            total: totalStats,
            sms: smsStats,
            whatsapp: waStats,
            timeline,
            recordCount: filtered.length
        };
    }

    buildTimelineAggregation(records, granularity) {
        const labels = granularity === 'daily'
            ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
            : granularity === 'weekly'
            ? ['W1', 'W2', 'W3', 'W4']
            : ['Q1', 'Q2', 'Q3', 'Q4'];

        const points = labels.map(label => ({ label, sent: 0, delivered: 0, failed: 0 }));
        if (records.length === 0) return points;

        records.forEach(r => {
            const d = new Date(r.attemptedAt);
            let idx = 0;
            if (granularity === 'daily') {
                const day = d.getDay(); // 0 is Sun, 1 is Mon
                idx = day === 0 ? 6 : day - 1;
            } else if (granularity === 'weekly') {
                const dom = d.getDate();
                idx = Math.min(3, Math.floor((dom - 1) / 7));
            } else {
                const month = d.getMonth();
                idx = Math.floor(month / 3);
            }
            if (points[idx]) {
                points[idx].sent++;
                if (r.status === 'delivered') points[idx].delivered++;
                if (['failed', 'undelivered'].includes(r.status)) points[idx].failed++;
            }
        });

        return points;
    }

    async seedInitialFixtures() {
        const fixtures = [];
        const baseTime = Date.now();

        // 1. WhatsApp Confirmed Dispatches (10 records)
        for (let i = 1; i <= 10; i++) {
            fixtures.push({
                id: `SM_WA_CONF_${1000 + i}`,
                sid: `SM_WA_CONF_${1000 + i}`,
                campaignId: '1767094872241',
                channel: 'whatsapp',
                recipient: `+91984012345${i % 10}`,
                provider: 'twilio',
                status: 'delivered',
                attemptedAt: new Date(baseTime - (i * 3600000 * 2)).toISOString(),
                deliveredAt: new Date(baseTime - (i * 3600000 * 2) + 2000).toISOString(),
                failedAt: null,
                errorCode: null,
                errorMessage: null,
                callbackCount: 2,
                lastCallbackAt: new Date(baseTime - (i * 3600000 * 2) + 2000).toISOString(),
                metadata: { template: 'Spring Special' }
            });
        }

        // 2. Cellular SMS Confirmed Dispatches (8 records)
        for (let i = 1; i <= 8; i++) {
            fixtures.push({
                id: `SM_SMS_CONF_${2000 + i}`,
                sid: `SM_SMS_CONF_${2000 + i}`,
                campaignId: '1767097545942',
                channel: 'sms',
                recipient: `+91987654321${i % 10}`,
                provider: 'twilio',
                status: 'delivered',
                attemptedAt: new Date(baseTime - (i * 3600000 * 4)).toISOString(),
                deliveredAt: new Date(baseTime - (i * 3600000 * 4) + 1500).toISOString(),
                failedAt: null,
                errorCode: null,
                errorMessage: null,
                callbackCount: 2,
                lastCallbackAt: new Date(baseTime - (i * 3600000 * 4) + 1500).toISOString(),
                metadata: { segment: 'GSM-7' }
            });
        }

        // 3. Pending Delivery Receipts (2 records)
        fixtures.push({
            id: 'SM_PEND_WA_3001',
            sid: 'SM_PEND_WA_3001',
            campaignId: '1767098510074',
            channel: 'whatsapp',
            recipient: '+919940123456',
            provider: 'twilio',
            status: 'sent', // Provider accepted, awaiting handset receipt
            attemptedAt: new Date(baseTime - 120000).toISOString(),
            deliveredAt: null,
            failedAt: null,
            errorCode: null,
            errorMessage: null,
            callbackCount: 1,
            lastCallbackAt: new Date(baseTime - 100000).toISOString(),
            metadata: { state: 'awaiting_receipt' }
        });

        fixtures.push({
            id: 'SM_PEND_SMS_3002',
            sid: 'SM_PEND_SMS_3002',
            campaignId: '1767098510074',
            channel: 'sms',
            recipient: '+919940123457',
            provider: 'twilio',
            status: 'queued', // Provider queued
            attemptedAt: new Date(baseTime - 60000).toISOString(),
            deliveredAt: null,
            failedAt: null,
            errorCode: null,
            errorMessage: null,
            callbackCount: 1,
            lastCallbackAt: new Date(baseTime - 50000).toISOString(),
            metadata: { state: 'carrier_queued' }
        });

        // 4. Confirmed Carrier Failures (2 records)
        fixtures.push({
            id: 'SM_FAIL_SMS_4001',
            sid: 'SM_FAIL_SMS_4001',
            campaignId: '1767098510074',
            channel: 'sms',
            recipient: '+919123456789',
            provider: 'twilio',
            status: 'undelivered',
            attemptedAt: new Date(baseTime - 1800000).toISOString(),
            deliveredAt: null,
            failedAt: new Date(baseTime - 1795000).toISOString(),
            errorCode: '30008',
            errorMessage: 'Unknown error / Handset unreachable',
            callbackCount: 2,
            lastCallbackAt: new Date(baseTime - 1795000).toISOString(),
            metadata: { error: 'Handset unreachable' }
        });

        fixtures.push({
            id: 'SM_FAIL_WA_4002',
            sid: 'SM_FAIL_WA_4002',
            campaignId: '1767098510074',
            channel: 'whatsapp',
            recipient: '+919000000000',
            provider: 'twilio',
            status: 'failed',
            attemptedAt: new Date(baseTime - 3600000).toISOString(),
            deliveredAt: null,
            failedAt: new Date(baseTime - 3590000).toISOString(),
            errorCode: '63007',
            errorMessage: 'Twilio trial sandbox recipient not joined',
            callbackCount: 1,
            lastCallbackAt: new Date(baseTime - 3590000).toISOString(),
            metadata: { error: 'Sandbox non-joined' }
        });

        await this._writeDispatches(fixtures);
        return fixtures;
    }
}

module.exports = new DispatchTelemetryService();
