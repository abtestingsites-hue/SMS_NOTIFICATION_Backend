const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { DataManager } = require('../dataManager');
const mediaService = require('./mediaService');
const governanceService = require('./governanceService');
const schedulerService = require('./schedulerService');
const dispatchTelemetryService = require('./dispatchTelemetryService');

const DRAFTS_FILE = path.join(__dirname, '..', 'data', 'campaign_drafts.json');

class CampaignBuilderService {
    constructor() {
        this.lock = Promise.resolve();
        this.initialized = false;
        this.launchLocks = new Map();
    }

    async init() {
        if (this.initialized) return;
        try {
            await fs.access(DRAFTS_FILE);
        } catch {
            await fs.writeFile(DRAFTS_FILE, JSON.stringify([], null, 2), 'utf8');
        }
        this.initialized = true;
    }

    async _readDrafts() {
        await this.init();
        try {
            const data = await fs.readFile(DRAFTS_FILE, 'utf8');
            return JSON.parse(data);
        } catch {
            return [];
        }
    }

    async _writeDrafts(drafts) {
        await (this.lock = this.lock.then(async () => {
            const tempFile = `${DRAFTS_FILE}.tmp.${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
            await fs.writeFile(tempFile, JSON.stringify(drafts, null, 2), 'utf8');
            try {
                await fs.rename(tempFile, DRAFTS_FILE);
            } catch (err) {
                await fs.writeFile(DRAFTS_FILE, JSON.stringify(drafts, null, 2), 'utf8');
                await fs.unlink(tempFile).catch(() => {});
            }
        }));
    }

    // --- Drafts CRUD Operations ---
    async getAllDrafts() {
        const drafts = await this._readDrafts();
        return drafts.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }

    async getDraftById(id) {
        const drafts = await this._readDrafts();
        return drafts.find(d => String(d.id) === String(id)) || null;
    }

    async saveDraft(draftData) {
        const drafts = await this._readDrafts();
        const now = new Date().toISOString();
        const id = draftData.id || `draft_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

        const existingIdx = drafts.findIndex(d => String(d.id) === String(id));
        const draftRecord = {
            id,
            name: draftData.name || 'Untitled Campaign Draft',
            description: draftData.description || '',
            status: draftData.status || 'DRAFT',
            channel: draftData.channel || 'both',
            creativeAssetId: draftData.creativeAssetId || null,
            creativeAsset: draftData.creativeAsset || null,
            contentBlocks: Array.isArray(draftData.contentBlocks) ? draftData.contentBlocks : [],
            offerId: draftData.offerId || null,
            offer: draftData.offer || null,
            audienceSelection: draftData.audienceSelection || {
                type: 'all',
                segmentName: 'All',
                totalCount: 0,
                smsEligibleCount: 0,
                whatsappEligibleCount: 0,
                suppressedCount: 0,
                optedOutCount: 0,
                languageBreakdown: {}
            },
            languageConfig: draftData.languageConfig || {
                selectedLanguages: ['tamil', 'telugu', 'kannada'],
                defaultLanguage: 'tamil',
                languageVariants: {},
                languageApprovals: {}
            },
            scheduleConfig: draftData.scheduleConfig || {
                mode: 'NOW',
                scheduledDate: '',
                scheduledTime: '',
                timezone: 'Asia/Kolkata',
                followUps: []
            },
            geminiExtraction: draftData.geminiExtraction || null,
            createdAt: existingIdx >= 0 ? drafts[existingIdx].createdAt : now,
            updatedAt: now
        };

        if (existingIdx >= 0) {
            drafts[existingIdx] = draftRecord;
        } else {
            drafts.unshift(draftRecord);
        }

        await this._writeDrafts(drafts);
        return draftRecord;
    }

    async deleteDraft(id) {
        const drafts = await this._readDrafts();
        const filtered = drafts.filter(d => String(d.id) !== String(id));
        await this._writeDrafts(filtered);
        return { success: true, deletedId: id };
    }

    // --- Dynamic Audience Summary & Resolution ---
    async getAudienceSummary(segmentName = 'All') {
        const customers = await DataManager.getCustomers();
        const suppressionList = await governanceService.getSuppressionList();
        const suppressedPhones = new Set(suppressionList.map(s => String(s.phone).trim().replace(/^\+/, '')));

        const segUpper = String(segmentName || 'All').toUpperCase();
        const matched = customers.filter(c => {
            const g = String(c.gender || c.category || '').toUpperCase();
            if (segUpper === 'ALL') return true;
            if (segUpper === 'MEN' && (g === 'MEN' || g === 'MALE')) return true;
            if (segUpper === 'WOMEN' && (g === 'WOMEN' || g === 'FEMALE')) return true;
            if (segUpper === 'VIP' && (g.includes('VIP') || Number(c.age || 0) > 30)) return true;
            if (segUpper === 'INACTIVE' && (!c.lastContacted || c.history?.length === 0)) return true;
            return g === segUpper;
        });

        let smsEligible = 0;
        let whatsappEligible = 0;
        let suppressed = 0;
        let optedOut = 0;
        let invalid = 0;
        const languageBreakdown = {};

        matched.forEach(c => {
            const rawPhone = String(c.phone || '').trim().replace(/^\+/, '');
            if (!rawPhone || rawPhone.length < 10) {
                invalid++;
                return;
            }

            const isSuppressed = suppressedPhones.has(rawPhone);
            if (isSuppressed) {
                suppressed++;
                optedOut++;
                return;
            }

            // Valid & Eligible
            smsEligible++;
            whatsappEligible++;

            const lang = (c.language || 'Unassigned').toLowerCase();
            languageBreakdown[lang] = (languageBreakdown[lang] || 0) + 1;
        });

        return {
            totalSelected: matched.length,
            smsEligible,
            whatsappEligible,
            suppressed,
            optedOut,
            invalid,
            languageBreakdown,
            eligibleRecipients: matched.filter(c => {
                const p = String(c.phone || '').trim().replace(/^\+/, '');
                return p.length >= 10 && !suppressedPhones.has(p);
            })
        };
    }

    // --- Launch / Schedule Visual Campaign ---
    async launchCampaign(payload) {
        // Debounce & Idempotency Check
        const idempotencyKey = payload.idempotencyKey || `${payload.name || 'camp'}_${payload.channel || 'both'}_${payload.audienceSelection?.segmentName || 'All'}_${payload.template?.length || 0}`;
        const nowMs = Date.now();
        if (this.launchLocks && this.launchLocks.has(idempotencyKey)) {
            const lastLaunch = this.launchLocks.get(idempotencyKey);
            if (nowMs - lastLaunch < 5000) {
                console.warn(`[Campaign Builder] Duplicate launch rejected: ${idempotencyKey}`);
                throw new Error('Duplicate launch request detected within 5-second debounce window. Please wait before re-launching.');
            }
        }
        if (this.launchLocks) {
            this.launchLocks.set(idempotencyKey, nowMs);
            if (this.launchLocks.size > 200) {
                for (const [k, v] of this.launchLocks.entries()) {
                    if (nowMs - v > 60000) this.launchLocks.delete(k);
                }
            }
        }
        const {
            name = 'Visual Campaign',
            channel = 'both',
            contentBlocks = [],
            template = '',
            mediaAsset = null,
            mediaId = null,
            offer = null,
            offerId = null,
            audienceSelection = { type: 'all', segmentName: 'All' },
            languageConfig = { selectedLanguages: ['tamil'], defaultLanguage: 'tamil', languageVariants: {} },
            scheduleConfig = { mode: 'NOW', scheduledDate: '', scheduledTime: '', timezone: 'Asia/Kolkata', followUps: [] },
            geminiExtraction = null
        } = payload;

        // 1. Audience Resolution
        const audienceSummary = await this.getAudienceSummary(audienceSelection.segmentName || 'All');
        const recipients = audienceSummary.eligibleRecipients;

        if (recipients.length === 0) {
            throw new Error('No eligible recipients found in selected audience segment. All contacts may be suppressed or opted out.');
        }

        // 2. Resolve Primary Message Content from Content Blocks or Template
        let resolvedTemplate = template;
        if (!resolvedTemplate && Array.isArray(contentBlocks) && contentBlocks.length > 0) {
            resolvedTemplate = contentBlocks
                .sort((a, b) => (a.order || 0) - (b.order || 0))
                .map(b => b.content)
                .filter(Boolean)
                .join('\n\n');
        }

        if (!resolvedTemplate) {
            resolvedTemplate = 'Hi {{customer_name}}, special promotion live now! Visit our store today.';
        }

        // 3. Resolve Media Asset
        let resolvedMedia = mediaAsset || null;
        let resolvedMediaId = mediaId || mediaAsset?.id || null;

        if (resolvedMediaId) {
            const check = await mediaService.verifyAssetExists(resolvedMediaId);
            if (!check.exists) {
                throw new Error(`Media asset ${resolvedMediaId} verification failed: ${check.reason || 'File not found on disk'}`);
            }
            resolvedMedia = check.asset;
            await mediaService.addReference(resolvedMediaId, `campaign:${name}`);
        }

        // 4. Validate Offer if attached
        let resolvedOffer = offer || null;
        if (offerId && !resolvedOffer) {
            const db = await DataManager._getMainDB();
            resolvedOffer = (db.offers || []).find(o => String(o.id) === String(offerId) || String(o.code) === String(offerId)) || null;
        }

        // 5. Schedule Determination
        const isScheduled = Boolean(scheduleConfig.mode === 'SCHEDULED' && scheduleConfig.scheduledDate);
        let scheduledForDate = new Date();
        if (isScheduled) {
            const dtString = `${scheduleConfig.scheduledDate}T${scheduleConfig.scheduledTime || '10:00:00'}`;
            scheduledForDate = new Date(dtString);
            if (isNaN(scheduledForDate.getTime()) || scheduledForDate.getTime() <= Date.now()) {
                scheduledForDate = new Date(Date.now() + 3600000); // 1 hour ahead fallback
            }
        }

        // 6. Campaign Persistence
        const campaignId = Date.now();
        const campaignRecord = {
            id: campaignId,
            name,
            status: isScheduled ? 'SCHEDULED' : 'PENDING',
            total: recipients.length,
            sent: 0,
            delivered: 0,
            failed: 0,
            createdAt: new Date().toISOString(),
            scheduledFor: scheduledForDate.toISOString(),
            validUntil: resolvedOffer?.validUntil || geminiExtraction?.validUntil?.value || null,
            targetAudience: audienceSelection.segmentName || 'All',
            platform: channel,
            template: resolvedTemplate,
            mediaId: resolvedMediaId,
            mediaAsset: resolvedMedia,
            mediaEnabled: Boolean(resolvedMediaId),
            mediaType: resolvedMedia?.mediaType || null,
            offer: resolvedOffer,
            offerId: resolvedOffer?.id || null,
            contentBlocks,
            languageConfig,
            scheduleConfig,
            geminiExtraction,
            builderIntegrated: true
        };

        await DataManager.createCampaign(campaignRecord);

        // 7. Schedule or Dispatch Immediately
        const { QueueSimulator } = require('../queueSimulator');

        if (isScheduled) {
            // Register with unified scheduler
            await schedulerService.createSchedule({
                name: `[Builder] ${name}`,
                type: 'ONCE',
                scheduledAt: scheduledForDate.toISOString(),
                timezone: scheduleConfig.timezone || 'Asia/Kolkata',
                channel,
                targetAudience: audienceSelection.segmentName || 'All',
                templateContent: resolvedTemplate,
                offerCode: resolvedOffer?.code || null
            });
            QueueSimulator.scheduleCampaign(campaignId, scheduledForDate);
        } else {
            // Immediate dispatch with Recipient Language-to-Message mapping
            QueueSimulator.scheduleCampaign(campaignId, new Date());

            // Process recipient dispatches respecting each customer's language preference
            setImmediate(async () => {
                const variants = languageConfig.languageVariants || {};
                const defLang = (languageConfig.defaultLanguage || 'tamil').toLowerCase();

                let dispatchedCount = 0;
                let suppressedSkipped = 0;

                for (const recipient of recipients) {
                    // Pre-dispatch real-time opt-out / suppression check
                    const cleanPhone = String(recipient.phone || '').trim().replace(/^\+/, '');
                    const isSuppressed = await governanceService.isSuppressed(cleanPhone);
                    if (isSuppressed) {
                        suppressedSkipped++;
                        console.log(`[Builder Dispatch] Recipient ${cleanPhone} is suppressed / opted out. Skipping.`);
                        continue;
                    }

                    const custLang = (recipient.language || defLang).toLowerCase();
                    const languageMessage = variants[custLang] || variants[defLang] || resolvedTemplate;

                    // Personalize template
                    const personalizedBody = languageMessage
                        .replace(/\{\{customer_name\}\}/g, recipient.name || 'Valued Customer')
                        .replace(/\{\{1\}\}/g, recipient.name || 'Valued Customer')
                        .replace(/\{\{offer_code\}\}/g, resolvedOffer?.code || 'SPECIAL')
                        .replace(/\{\{care_number\}\}/g, process.env.CUSTOMER_CARE_NUMBER || '+916369825386');

                    try {
                        await QueueSimulator.dispatchDualChannel({
                            to: recipient.phone,
                            body: personalizedBody,
                            platform: channel,
                            mediaAsset: resolvedMedia,
                            campaignId
                        });
                    } catch (e) {
                        console.warn(`[Builder Dispatch] Error to ${recipient.phone}:`, e.message);
                    }
                }
            });
        }

        return {
            success: true,
            campaignId,
            campaign: campaignRecord,
            stats: {
                totalRecipients: recipients.length,
                channel,
                isScheduled,
                scheduledFor: scheduledForDate.toISOString(),
                languagesMapped: Object.keys(audienceSummary.languageBreakdown)
            }
        };
    }
    // --- Strict Delivery Reconciliation & Campaign Analytics ---
    async getCampaignAnalytics(campaignId) {
        const idStr = String(campaignId);
        const db = await DataManager._getMainDB();
        const campaign = (db.campaigns || []).find(c => String(c.id) === idStr);
        if (!campaign) {
            throw new Error(`Campaign ${campaignId} not found`);
        }

        const dispatches = await dispatchTelemetryService.getDispatchesByCampaign(idStr);
        const attempted = dispatches.length;
        const sent = dispatches.filter(d => ['sent', 'delivered'].includes(d.status)).length;
        const delivered = dispatches.filter(d => d.status === 'delivered').length;
        const failed = dispatches.filter(d => ['failed', 'undelivered'].includes(d.status)).length;
        const pending = dispatches.filter(d => ['queued', 'accepted', 'pending', 'sending'].includes(d.status)).length;

        const smsDispatches = dispatches.filter(d => d.channel === 'sms');
        const waDispatches = dispatches.filter(d => d.channel === 'whatsapp');

        const smsMetrics = {
            attempted: smsDispatches.length,
            sent: smsDispatches.filter(d => ['sent', 'delivered'].includes(d.status)).length,
            delivered: smsDispatches.filter(d => d.status === 'delivered').length,
            failed: smsDispatches.filter(d => ['failed', 'undelivered'].includes(d.status)).length
        };

        const waMetrics = {
            attempted: waDispatches.length,
            sent: waDispatches.filter(d => ['sent', 'delivered'].includes(d.status)).length,
            delivered: waDispatches.filter(d => d.status === 'delivered').length,
            failed: waDispatches.filter(d => ['failed', 'undelivered'].includes(d.status)).length
        };

        // Strict carrier delivery receipt formula: delivered / (delivered + failed)
        const receiptTotal = delivered + failed;
        const deliveryRate = receiptTotal > 0 ? Number(((delivered / receiptTotal) * 100).toFixed(2)) : (sent > 0 ? 100 : 0);

        const languageBreakdown = {};
        dispatches.forEach(d => {
            const lang = d.metadata?.language || 'default';
            languageBreakdown[lang] = (languageBreakdown[lang] || 0) + 1;
        });

        // Media click tracking for this campaign
        const mediaClicks = await dispatchTelemetryService.getMediaClicks(campaign.mediaId);
        const campaignClicks = mediaClicks.filter(c => !c.campaignId || String(c.campaignId) === idStr);

        // Opt-out tracking
        const suppressionList = await governanceService.getSuppressionList();
        const campaignOptOuts = suppressionList.filter(s => s.reason?.includes(idStr) || s.metadata?.campaignId === idStr).length;

        return {
            campaignId: campaign.id,
            campaignName: campaign.name,
            status: campaign.status,
            platform: campaign.platform,
            totalRecipients: campaign.total || dispatches.length,
            eligibleCount: campaign.total || dispatches.length,
            attemptedCount: attempted,
            sentCount: sent,
            deliveredCount: delivered,
            failedCount: failed,
            pendingCount: pending,
            deliveryRatePercentage: deliveryRate,
            smsVsWhatsapp: {
                sms: smsMetrics,
                whatsapp: waMetrics
            },
            languageBreakdown: Object.keys(languageBreakdown).length > 0 ? languageBreakdown : { tamil: campaign.total || 0 },
            conversionMetrics: {
                mediaClicksCount: campaignClicks.length,
                clickThroughRate: attempted > 0 ? Number(((campaignClicks.length / attempted) * 100).toFixed(2)) : 0,
                optOutCount: campaignOptOuts,
                optOutRate: attempted > 0 ? Number(((campaignOptOuts / attempted) * 100).toFixed(2)) : 0
            },
            verifiedAt: new Date().toISOString()
        };
    }
}

module.exports = new CampaignBuilderService();
