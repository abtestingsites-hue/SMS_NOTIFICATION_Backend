const { DataManager } = require('./dataManager');
const twilio = require('twilio');

class QueueSimulator {
    constructor() {
        this.activeCampaignId = null;
        this.isProcessing = false;
        this.rateLimit = 250;
    }

    getTwilioClient() {
        const sid = process.env.TWILIO_ACCOUNT_SID;
        const token = process.env.TWILIO_AUTH_TOKEN;
        return (sid && token) ? new twilio(sid, token) : null;
    }

    getWhatsAppSender() {
        const from = process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_PHONE_NUMBER || 'whatsapp:+14155238886';
        return from.startsWith('whatsapp:') ? from : `whatsapp:${from}`;
    }

    getSmsSender() {
        const from = process.env.TWILIO_SMS_NUMBER || process.env.TWILIO_PHONE_NUMBER || '+12202404020';
        return from.replace(/^whatsapp:/i, '');
    }

    normalizeNumber(phone) {
        if (!phone) return null;
        let clean = String(phone).trim().replace(/\s+/g, '');
        clean = clean.replace(/^whatsapp:/i, '');

        if (/^\d{10}$/.test(clean)) {
            clean = '+91' + clean;
        } else if (!clean.startsWith('+')) {
            clean = '+' + clean;
        }

        return clean;
    }

    // Format the actual campaign marketing message
    formatCampaignMessage({ template, name, offer, validUntil, careNumber }) {
        let body = template && template.trim().length > 0
            ? template
            : "Hi {{1}} 👋\n\n✨ *Exclusive Offer Just for You!* ✨\n\n{{2}}\n\n⏰ *Offer Valid Until:* {{3}}\n\nVisit our store and grab your favorite styles before time runs out.\nCome and get it soon! 🛍️🔥\n\nReply *STOP* to opt out.";

        const customerName = name || 'Valued Customer';
        body = body.split('{{1}}').join(customerName).split('{1}').join(customerName);

        let offerDetails = "Special 25% Discount for you!\nUse code: *SUMMER25*";
        if (offer) {
            if (offer.description) {
                offerDetails = `*${offer.description}*\nGet ${offer.discount} using ID: *${offer.code}*`;
            } else {
                offerDetails = `Get ${offer.discount} OFF using code *${offer.code}*`;
            }
        }
        body = body.split('{{2}}').join(offerDetails).split('{2}').join(offerDetails);

        const expiry = validUntil || 'Limited Time';
        body = body.split('{{3}}').join(expiry).split('{3}').join(expiry);

        const care = careNumber || process.env.CUSTOMER_CARE_NUMBER || '+916369825386';
        body = body.split('{{care_number}}').join(care)
                   .split('{care_number}').join(care)
                   .split('{{customer_care}}').join(care);

        return body;
    }

    // Format an SMS-optimized version of the campaign (concise, 1 segment, GSM-7 compatible, no emojis)
    formatSmsCampaignMessage({ name, offer, validUntil }) {
        const customerName = name || 'Customer';
        const title = offer?.description || 'Exclusive Offer';
        const disc = offer?.discount ? offer.discount : '25% OFF';
        const code = offer?.code || 'SUMMER25';
        const expiry = validUntil || 'Limited Time';
        return `Hi ${customerName}: ${title}! Get ${disc} with code ${code}. Valid until ${expiry}. Visit our store today!`;
    }

    // Core Dual Platform Dispatcher: Sends via WhatsApp AND/OR Cellular SMS
    async dispatchDualChannel({ to, body, smsBody = null, platform = 'both' }) {
        const rawPhone = this.normalizeNumber(to);
        if (!rawPhone) {
            return {
                success: false,
                error: 'Invalid recipient phone number',
                whatsapp: { sent: false, error: 'Invalid number' },
                sms: { sent: false, error: 'Invalid number' }
            };
        }

        const client = this.getTwilioClient();
        const waFrom = this.getWhatsAppSender();
        const smsFrom = this.getSmsSender();

        const results = {
            whatsapp: { attempted: false, sent: false, sid: null, error: null, code: null },
            sms: { attempted: false, sent: false, sid: null, error: null, code: null }
        };

        if (!client) {
            console.log(`[Simulate Dual] (${platform}) To: ${rawPhone}\nBody:\n${body}`);
            return {
                success: true,
                simulated: true,
                whatsapp: { attempted: platform !== 'sms', sent: platform !== 'sms', sid: 'SIM_WA_' + Date.now() },
                sms: { attempted: platform !== 'whatsapp', sent: platform !== 'whatsapp', sid: 'SIM_SMS_' + Date.now() },
                body
            };
        }

        // 1. WhatsApp Dispatch (Supports rich text, bolding, emojis)
        if (platform === 'both' || platform === 'whatsapp') {
            results.whatsapp.attempted = true;
            try {
                const waTo = `whatsapp:${rawPhone}`;
                console.log(`[WhatsApp] Dispatching Campaign Message to ${waTo} from ${waFrom}...`);
                const msg = await client.messages.create({
                    body: body,
                    from: waFrom,
                    to: waTo
                });
                results.whatsapp.sent = true;
                results.whatsapp.sid = msg.sid;
                console.log(`✅ [WhatsApp] Delivered to ${waTo}: ${msg.sid}`);
            } catch (err) {
                results.whatsapp.sent = false;
                results.whatsapp.error = err.message;
                results.whatsapp.code = err.code;
                console.error(`❌ [WhatsApp] Failed to ${rawPhone}:`, err.message);
            }
        }

        // 2. Cellular SMS Dispatch (Compact, single-segment GSM-7 compliant to avoid carrier/trial rejection)
        if (platform === 'both' || platform === 'sms') {
            results.sms.attempted = true;
            try {
                const smsTo = rawPhone;
                let textForSms = smsBody;
                if (!textForSms) {
                    textForSms = body
                        .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}]/gu, '')
                        .replace(/[*_~`]/g, '')
                        .replace(/\s+/g, ' ')
                        .trim();
                    if (textForSms.length > 140) {
                        textForSms = textForSms.slice(0, 137) + '...';
                    }
                }
                console.log(`[Cellular SMS] Dispatching Campaign Message to ${smsTo} from ${smsFrom}...`);
                const msg = await client.messages.create({
                    body: textForSms,
                    from: smsFrom,
                    to: smsTo
                });
                results.sms.sent = true;
                results.sms.sid = msg.sid;
                results.sms.text = textForSms;
                console.log(`✅ [Cellular SMS] Delivered to ${smsTo}: ${msg.sid}`);
            } catch (err) {
                results.sms.sent = false;
                results.sms.error = err.message;
                results.sms.code = err.code;
                console.error(`❌ [Cellular SMS] Failed to ${rawPhone}:`, err.message);
            }
        }

        const success = results.whatsapp.sent || results.sms.sent;
        return {
            success,
            whatsapp: results.whatsapp,
            sms: results.sms,
            body: body
        };
    }

    async scheduleCampaign(campaignId, scheduledTime) {
        const now = new Date();
        const delay = scheduledTime.getTime() - now.getTime();

        console.log(`[Scheduler] Scheduling Campaign ${campaignId} for ${scheduledTime.toISOString()} (Delay: ${delay}ms)`);

        if (delay <= 0) {
            this.startCampaign(campaignId).catch(err => console.error(err));
        } else {
            setTimeout(() => {
                this.startCampaign(campaignId).catch(err => console.error(err));
            }, delay);
        }
    }

    async startCampaign(campaignId) {
        if (this.isProcessing) throw new Error("A campaign is already running.");

        console.log(`[Scheduler] Starting Campaign: ${campaignId}`);
        this.activeCampaignId = campaignId;
        this.isProcessing = true;

        const campaign = await DataManager.getCampaign(campaignId);
        if (!campaign) {
            this.isProcessing = false;
            throw new Error("Campaign not found");
        }

        console.log(`[Scheduler] Campaign ${campaignId} registered.`);
        await DataManager.updateCampaign(campaignId, { status: 'PROCESSING' });

        this.processSmartQueue().catch(err => {
            console.error('[Scheduler] Error in processSmartQueue:', err);
        }).finally(() => {
            this.isProcessing = false;
            this.activeCampaignId = null;
        });
    }

    // Sends the exact Campaign Message to Customer Care on WhatsApp and/or Cellular SMS
    async sendToCustomerCare({ campaign, offer, customBody = null, customerCareNumber = null, platform = 'both', template = null }) {
        const settings = await DataManager.getSettings();
        const carePhone = customerCareNumber || settings.customerCareNumber || process.env.CUSTOMER_CARE_NUMBER;

        if (!carePhone) {
            console.log('[CustomerCare] No customer care number configured.');
            return { success: false, error: 'No customer care number configured' };
        }

        let body = customBody;
        let smsBody = null;
        if (!body) {
            const rawTemplate = template || (await DataManager.getTemplate()) || "";
            body = this.formatCampaignMessage({
                template: rawTemplate,
                name: 'Akash',
                offer: offer,
                validUntil: campaign?.validUntil || '15 Aug 2026',
                careNumber: carePhone
            });
            smsBody = this.formatSmsCampaignMessage({
                name: 'Akash',
                offer: offer,
                validUntil: campaign?.validUntil || '15 Aug 2026'
            });
        }

        console.log(`[CustomerCare] Dispatching Campaign Message to ${carePhone} via ${platform}`);

        return await this.dispatchDualChannel({
            to: carePhone,
            body: body,
            smsBody: smsBody,
            platform: platform || settings.platform || 'both'
        });
    }

    async processSmartQueue() {
        try {
            const activeCampaigns = await DataManager.getActiveCampaigns();
            if (activeCampaigns.length === 0) return;

            const now = new Date();
            const customers = await DataManager.getCustomers();
            const offers = await DataManager.getOffers();
            const currentOffer = offers.length > 0 ? offers[0] : null;

            for (const campaign of activeCampaigns) {
                const validUntil = new Date(campaign.validUntil);
                if (validUntil < now) {
                    console.log(`[Scheduler] Campaign ${campaign.id} EXPIRED. Stopping.`);
                    await DataManager.updateCampaign(campaign.id, { status: 'COMPLETED' });
                    continue;
                }

                const settings = await DataManager.getSettings();
                const platform = campaign.platform || settings.platform || 'both';
                const sendToCare = campaign.sendToCustomerCare !== undefined ? campaign.sendToCustomerCare : settings.sendToCustomerCare;
                const careNumber = campaign.customerCareNumber || settings.customerCareNumber || process.env.CUSTOMER_CARE_NUMBER;

                // Send the exact Campaign Message to Customer Care on both platforms
                if (sendToCare && careNumber && !campaign.customerCareNotified) {
                    console.log(`[Scheduler] Sending Campaign Message (Mode: ${platform}) to Customer Care (${careNumber})...`);
                    await this.sendToCustomerCare({
                        campaign,
                        offer: currentOffer,
                        customerCareNumber: careNumber,
                        platform: platform,
                        template: campaign.template || null
                    });
                    await DataManager.updateCampaign(campaign.id, { customerCareNotified: true });
                }

                const hoursLeft = (validUntil - now) / (1000 * 60 * 60);
                const isEmergency = hoursLeft <= 24;
                const intervalHours = isEmergency ? 3 : 24;
                const intervalMs = intervalHours * 60 * 60 * 1000;

                console.log(`[Scheduler] Campaign ${campaign.id}: ${hoursLeft.toFixed(1)}h left. Mode: ${isEmergency ? '🚨 EMERGENCY' : 'Standard'} [Platform: ${platform}]`);

                const target = (campaign.targetAudience || 'All').toLowerCase();
                const filteredCustomers = customers.filter(c => {
                    if (target === 'all') return true;
                    if (!c.gender) return false;
                    const g = String(c.gender).toLowerCase();

                    if (target === 'men') return g === 'men' || g === 'boy' || g === 'male';
                    if (target === 'women') return g === 'women' || g === 'girl' || g === 'female';
                    if (target === 'boys') return g === 'boy' || g === 'boys';
                    if (target === 'girls') return g === 'girl' || g === 'girls';
                    if (target === 'children') return g === 'child' || g === 'kid' || g === 'children';
                    return true;
                });

                console.log(`[Scheduler] Campaign ${campaign.id} Target: ${campaign.targetAudience}. Matches: ${filteredCustomers.length}/${customers.length}`);
                await DataManager.updateCampaign(campaign.id, { total: filteredCustomers.length });

                let sentCount = campaign.sent || 0;

                for (const customer of filteredCustomers) {
                    const lastContacted = customer.lastContacted || 0;
                    const timeSinceLast = now.getTime() - lastContacted;

                    if (timeSinceLast > intervalMs) {
                        try {
                            const success = await this.simulateWhatsAppSend(
                                customer,
                                currentOffer,
                                campaign.template || null,
                                campaign.validUntil,
                                isEmergency,
                                platform
                            );

                            if (success) {
                                sentCount++;
                                await DataManager.updateCampaign(campaign.id, {
                                    sent: sentCount
                                });

                                if (settings.sendToCarePerCustomer && careNumber) {
                                    await this.sendToCustomerCare({
                                        campaign,
                                        offer: currentOffer,
                                        customBody: null,
                                        customerCareNumber: careNumber,
                                        platform: platform,
                                        template: campaign.template || null
                                    });
                                }
                            }

                            await new Promise(r => setTimeout(r, this.rateLimit));
                        } catch (err) {
                            if (err.message && err.message.includes('exceeded the 50 daily messages limit')) {
                                console.log('[Scheduler] Limit Hit. Pausing Campaign.');
                                await DataManager.updateCampaign(campaign.id, { status: 'PAUSED_LIMIT_REACHED' });
                                return;
                            }
                        }
                    }
                }

                await DataManager.updateCampaign(campaign.id, { status: 'COMPLETED' });
                console.log(`[Scheduler] Campaign ${campaign.id} completed. Total sent: ${sentCount}`);
            }
        } catch (error) {
            console.error('[Scheduler] Error in loop:', error);
        }
    }

    async simulateWhatsAppSend(customer, offer, legacyTemplate, validUntil, isEmergency = false, platform = 'both') {
        const rawPhone = this.normalizeNumber(customer.phone);
        if (!rawPhone) return false;

        try {
            let selectedTemplate = legacyTemplate;
            const allTemplates = await DataManager.getCategoryTemplates();

            if (!selectedTemplate && Object.keys(allTemplates).length > 0) {
                let category = "Men";
                if (isEmergency) category = "Emergency";
                else if (customer.gender) {
                    const g = String(customer.gender).toLowerCase();
                    if (g.includes('f') || g.includes('wom') || g.includes('girl')) category = "Women";
                    if (g.includes('boy')) category = "Boys";
                    if (g.includes('girl')) category = "Girls";
                    if (g.includes('kid') || g.includes('child')) category = "Children";
                }

                const candidates = allTemplates[category] || allTemplates["Men"];
                const history = new Set(customer.history || []);
                const available = candidates ? candidates.filter(t => !history.has(t)) : [];

                if (available.length > 0) {
                    selectedTemplate = available[Math.floor(Math.random() * available.length)];
                    await DataManager.updateCustomerHistory(customer.phone, selectedTemplate);
                } else if (candidates && candidates.length > 0) {
                    await DataManager.resetCustomerHistory(customer.phone);
                    selectedTemplate = candidates[Math.floor(Math.random() * candidates.length)];
                    await DataManager.updateCustomerHistory(customer.phone, selectedTemplate);
                }
            }

            const rawTemplate = selectedTemplate || (await DataManager.getTemplate()) || "";
            const body = this.formatCampaignMessage({
                template: rawTemplate,
                name: customer.name,
                offer: offer,
                validUntil: validUntil,
                careNumber: process.env.CUSTOMER_CARE_NUMBER || '+916369825386'
            });
            const smsBody = this.formatSmsCampaignMessage({
                name: customer.name,
                offer: offer,
                validUntil: validUntil
            });

            console.log(`[Queue] Sending Campaign Message (Platform: ${platform}) to ${customer.name} (${rawPhone})`);

            const result = await this.dispatchDualChannel({
                to: rawPhone,
                body: body,
                smsBody: smsBody,
                platform: platform
            });

            return result.success;
        } catch (error) {
            console.error(`❌ Failed to send to ${customer.phone}:`, error.message);
            return false;
        }
    }
}

module.exports = { QueueSimulator: new QueueSimulator() };
