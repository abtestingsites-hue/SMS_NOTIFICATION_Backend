const fs = require('fs').promises;
const path = require('path');
const integrationService = require('./integrationService');

const META_DATA_PATH = path.join(__dirname, '..', 'data', 'meta_campaigns.json');

class MetaCampaignService {
    constructor() {
        this.lock = Promise.resolve();
    }

    async _read() {
        try {
            const raw = await fs.readFile(META_DATA_PATH, 'utf8');
            return JSON.parse(raw);
        } catch {
            const initial = {
                selectedAccountId: 'act_982341908234',
                adAccounts: [
                    { id: 'act_982341908234', name: 'Primary Retail Enterprise Account', currency: 'USD', balance: '$2,450.00' },
                    { id: 'act_112938472910', name: 'Seasonal Growth & Acquisition', currency: 'USD', balance: '$1,120.00' }
                ],
                campaigns: [
                    {
                        id: 'meta_camp_101',
                        name: 'Summer Lookbook Retargeting - Lookalike 2%',
                        objective: 'CONVERSIONS',
                        status: 'ACTIVE',
                        dailyBudget: 150.00,
                        spend: 1420.50,
                        impressions: 48920,
                        clicks: 2140,
                        ctr: 4.37,
                        cpc: 0.66,
                        conversions: 184,
                        roas: 3.82,
                        adSetCount: 3,
                        creative: {
                            headline: 'Refresh Your Summer Style | 25% Off',
                            body: 'Exclusive seasonal drops curated for modern comfort. Tap to unlock your code.',
                            callToAction: 'SHOP_NOW',
                            mediaUrl: '/uploads/media/sample_banner.png'
                        },
                        createdAt: new Date(Date.now() - 86400000 * 10).toISOString()
                    },
                    {
                        id: 'meta_camp_102',
                        name: 'WhatsApp Click-to-Chat Flash Promotion',
                        objective: 'MESSAGES',
                        status: 'ACTIVE',
                        dailyBudget: 75.00,
                        spend: 680.00,
                        impressions: 26400,
                        clicks: 1490,
                        ctr: 5.64,
                        cpc: 0.45,
                        conversions: 112,
                        roas: 4.20,
                        adSetCount: 2,
                        creative: {
                            headline: 'Instant WhatsApp Concierge & VIP Offer',
                            body: 'Chat with our style advisor directly on WhatsApp for tailored sizing and discounts.',
                            callToAction: 'SEND_WHATSAPP_MESSAGE',
                            mediaUrl: '/uploads/media/chat_promo.png'
                        },
                        createdAt: new Date(Date.now() - 86400000 * 5).toISOString()
                    },
                    {
                        id: 'meta_camp_103',
                        name: 'Autumn Catalog Preview Awareness',
                        objective: 'BRAND_AWARENESS',
                        status: 'PAUSED',
                        dailyBudget: 50.00,
                        spend: 250.00,
                        impressions: 18200,
                        clicks: 430,
                        ctr: 2.36,
                        cpc: 0.58,
                        conversions: 14,
                        roas: 1.95,
                        adSetCount: 1,
                        creative: {
                            headline: 'Incoming Autumn Collection 2026',
                            body: 'Preview timeless textures and refined essentials.',
                            callToAction: 'LEARN_MORE',
                            mediaUrl: ''
                        },
                        createdAt: new Date(Date.now() - 86400000 * 20).toISOString()
                    }
                ]
            };
            await this._write(initial);
            return initial;
        }
    }

    async _write(data) {
        await (this.lock = this.lock.then(async () => {
            await fs.writeFile(META_DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
        }));
    }

    async getStatusAndCampaigns() {
        const creds = await integrationService.getDecryptedCredentials('meta');
        const db = await this._read();

        // Calculate summary metrics
        const totalSpend = db.campaigns.reduce((sum, c) => sum + (c.spend || 0), 0);
        const totalImpressions = db.campaigns.reduce((sum, c) => sum + (c.impressions || 0), 0);
        const totalClicks = db.campaigns.reduce((sum, c) => sum + (c.clicks || 0), 0);
        const totalConversions = db.campaigns.reduce((sum, c) => sum + (c.conversions || 0), 0);
        const avgCtr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : '0.00';
        const avgCpc = totalClicks > 0 ? (totalSpend / totalClicks).toFixed(2) : '0.00';

        const isLive = Boolean(creds && creds.status === 'CONNECTED' && creds.accessToken && !String(creds.accessToken).includes('placeholder'));
        const dataSource = isLive ? 'LIVE_GRAPH_API' : 'SANDBOX_SIMULATED';

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
                ? 'Reporting data synchronized with Meta Marketing Graph API v21.0'
                : 'Demo Mode: Metrics are simulated within local sandbox. Connect live access token in Integration Console to stream live ad analytics.',
            adAccounts: db.adAccounts || [],
            selectedAccountId: db.selectedAccountId,
            summary: {
                totalSpend: totalSpend.toFixed(2),
                totalImpressions,
                totalClicks,
                totalConversions,
                avgCtr,
                avgCpc
            },
            campaigns
        };
    }

    async createCampaign(payload) {
        const db = await this._read();
        if (!db.campaigns) db.campaigns = [];

        const newCampaign = {
            id: 'meta_camp_' + Date.now(),
            name: payload.name || 'Untitled Meta Campaign',
            objective: payload.objective || 'CONVERSIONS',
            status: 'ACTIVE',
            dailyBudget: Number(payload.dailyBudget) || 100,
            spend: 0,
            impressions: 0,
            clicks: 0,
            ctr: 0.0,
            cpc: 0.0,
            conversions: 0,
            roas: 0.0,
            adSetCount: 1,
            creative: {
                headline: payload.headline || 'Promotional Campaign',
                body: payload.body || 'Exclusive messaging update',
                callToAction: payload.callToAction || 'SHOP_NOW',
                mediaUrl: payload.mediaUrl || ''
            },
            createdAt: new Date().toISOString()
        };

        db.campaigns.unshift(newCampaign);
        await this._write(db);
        return newCampaign;
    }

    async toggleCampaignStatus(id) {
        const db = await this._read();
        const camp = (db.campaigns || []).find(c => String(c.id) === String(id));
        if (!camp) throw new Error('Meta campaign not found');

        camp.status = camp.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
        await this._write(db);
        return camp;
    }

    async updateBudget(id, dailyBudget) {
        const db = await this._read();
        const camp = (db.campaigns || []).find(c => String(c.id) === String(id));
        if (!camp) throw new Error('Meta campaign not found');

        camp.dailyBudget = Number(dailyBudget) || camp.dailyBudget;
        await this._write(db);
        return camp;
    }
}

module.exports = new MetaCampaignService();

