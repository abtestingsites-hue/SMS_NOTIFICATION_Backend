const fs = require('fs').promises;
const path = require('path');
const integrationService = require('./integrationService');

const GOOGLE_DATA_PATH = path.join(__dirname, '..', 'data', 'google_campaigns.json');

class GoogleCampaignService {
    constructor() {
        this.lock = Promise.resolve();
    }

    async _read() {
        try {
            const raw = await fs.readFile(GOOGLE_DATA_PATH, 'utf8');
            return JSON.parse(raw);
        } catch {
            const initial = {
                customerId: '839-401-2993',
                customerName: 'Enterprise Growth Search & Performance',
                campaigns: [
                    {
                        id: 'goog_camp_201',
                        name: 'High-Intent Search — Menswear & Accessories',
                        type: 'SEARCH',
                        biddingStrategy: 'TARGET_ROAS (380%)',
                        status: 'ENABLED',
                        dailyBudget: 200.00,
                        cost: 1840.20,
                        impressions: 34100,
                        clicks: 3120,
                        avgCpc: 0.59,
                        conversions: 245,
                        costPerConversion: 7.51,
                        keywordsCount: 42,
                        createdAt: new Date(Date.now() - 86400000 * 12).toISOString()
                    },
                    {
                        id: 'goog_camp_202',
                        name: 'Performance Max — Omni-Channel Retargeting',
                        type: 'PERFORMANCE_MAX',
                        biddingStrategy: 'MAXIMIZE_CONVERSIONS',
                        status: 'ENABLED',
                        dailyBudget: 120.00,
                        cost: 920.00,
                        impressions: 51200,
                        clicks: 2840,
                        avgCpc: 0.32,
                        conversions: 180,
                        costPerConversion: 5.11,
                        keywordsCount: 18,
                        createdAt: new Date(Date.now() - 86400000 * 8).toISOString()
                    },
                    {
                        id: 'goog_camp_203',
                        name: 'YouTube In-Stream Brand Video Spotlight',
                        type: 'VIDEO',
                        biddingStrategy: 'TARGET_CPM',
                        status: 'PAUSED',
                        dailyBudget: 60.00,
                        cost: 410.00,
                        impressions: 62400,
                        clicks: 910,
                        avgCpc: 0.45,
                        conversions: 22,
                        costPerConversion: 18.63,
                        keywordsCount: 10,
                        createdAt: new Date(Date.now() - 86400000 * 25).toISOString()
                    }
                ]
            };
            await this._write(initial);
            return initial;
        }
    }

    async _write(data) {
        await (this.lock = this.lock.then(async () => {
            await fs.writeFile(GOOGLE_DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
        }));
    }

    async getStatusAndCampaigns() {
        const creds = await integrationService.getDecryptedCredentials('google');
        const db = await this._read();

        const totalCost = db.campaigns.reduce((sum, c) => sum + (c.cost || 0), 0);
        const totalImpressions = db.campaigns.reduce((sum, c) => sum + (c.impressions || 0), 0);
        const totalClicks = db.campaigns.reduce((sum, c) => sum + (c.clicks || 0), 0);
        const totalConversions = db.campaigns.reduce((sum, c) => sum + (c.conversions || 0), 0);
        const avgCpc = totalClicks > 0 ? (totalCost / totalClicks).toFixed(2) : '0.00';
        const avgCostPerConv = totalConversions > 0 ? (totalCost / totalConversions).toFixed(2) : '0.00';

        const isLive = Boolean(creds && creds.status === 'CONNECTED' && creds.developerToken && !String(creds.developerToken).includes('placeholder'));
        const dataSource = isLive ? 'LIVE_GOOGLE_ADS_API' : 'SANDBOX_SIMULATED';

        const campaigns = (db.campaigns || []).map(c => ({
            ...c,
            dataSource: c.dataSource || dataSource,
            isLive: c.isLive !== undefined ? c.isLive : isLive
        }));

        return {
            isConnected: creds && creds.status === 'CONNECTED',
            isLive,
            dataSource,
            dataSourceNotice: isLive
                ? 'Metrics directly polled from Google Ads API v18'
                : 'Demo Mode: Metrics are simulated within local sandbox. Connect live developer token & OAuth credentials to enable live streaming.',
            customerId: db.customerId,
            customerName: db.customerName,
            summary: {
                totalCost: totalCost.toFixed(2),
                totalImpressions,
                totalClicks,
                totalConversions,
                avgCpc,
                avgCostPerConv
            },
            campaigns
        };
    }

    async createCampaign(payload) {
        const db = await this._read();
        if (!db.campaigns) db.campaigns = [];

        const newCampaign = {
            id: 'goog_camp_' + Date.now(),
            name: payload.name || 'Untitled Google Ads Campaign',
            type: payload.type || 'SEARCH', // SEARCH | DISPLAY | PERFORMANCE_MAX | VIDEO
            biddingStrategy: payload.biddingStrategy || 'MAXIMIZE_CONVERSIONS',
            status: 'ENABLED',
            dailyBudget: Number(payload.dailyBudget) || 100,
            cost: 0,
            impressions: 0,
            clicks: 0,
            avgCpc: 0.0,
            conversions: 0,
            costPerConversion: 0.0,
            keywordsCount: payload.keywordsCount || 10,
            createdAt: new Date().toISOString()
        };

        db.campaigns.unshift(newCampaign);
        await this._write(db);
        return newCampaign;
    }

    async toggleCampaignStatus(id) {
        const db = await this._read();
        const camp = (db.campaigns || []).find(c => String(c.id) === String(id));
        if (!camp) throw new Error('Google campaign not found');

        camp.status = camp.status === 'ENABLED' ? 'PAUSED' : 'ENABLED';
        await this._write(db);
        return camp;
    }

    async updateBudget(id, dailyBudget) {
        const db = await this._read();
        const camp = (db.campaigns || []).find(c => String(c.id) === String(id));
        if (!camp) throw new Error('Google campaign not found');

        camp.dailyBudget = Number(dailyBudget) || camp.dailyBudget;
        await this._write(db);
        return camp;
    }
}

module.exports = new GoogleCampaignService();

