const express = require('express');
require('dotenv').config();
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { DataManager } = require('./dataManager');
const { QueueSimulator } = require('./queueSimulator');
const csv = require('csv-parser');

// Expansion Services
const integrationService = require('./services/integrationService');
const mediaService = require('./services/mediaService');
const schedulerService = require('./services/schedulerService');
const automationService = require('./services/automationService');
const governanceService = require('./services/governanceService');
const metaCampaignService = require('./services/metaCampaignService');
const googleCampaignService = require('./services/googleCampaignService');
const inboundWebhookService = require('./services/inboundWebhookService');
const storageProvider = require('./services/storageProvider');
const notificationService = require('./services/notificationService');
const dispatchTelemetryService = require('./services/dispatchTelemetryService');
const aiTemplateService = require('./services/aiTemplateService');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure upload directories exist
const MEDIA_UPLOAD_DIR = path.join(__dirname, 'uploads', 'media');
if (!fs.existsSync(MEDIA_UPLOAD_DIR)) {
    fs.mkdirSync(MEDIA_UPLOAD_DIR, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static Media Hosting
app.use('/uploads/media', express.static(MEDIA_UPLOAD_DIR));

// Basic Upload Config for CSVs
const upload = multer({ dest: 'uploads/' });

// Media Library Multer Storage Engine
const mediaStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, MEDIA_UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'asset-' + uniqueSuffix + ext);
    }
});

const mediaUpload = multer({
    storage: mediaStorage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
            'video/mp4', 'application/pdf'
        ];
        if (allowedTypes.includes(file.mimetype.toLowerCase())) {
            cb(null, true);
        } else {
            cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: JPG, PNG, WebP, MP4, PDF`));
        }
    }
});

// Basic Routes
app.get('/', (req, res) => {
    res.send('Backend is running! 🚀 <br> Multi-Channel Marketing Automation Platform');
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', mode: 'enterprise_production' });
});

// =========================================================================
// 1. EXISTING DATA & CAMPAIGN ROUTES (PRESERVED IN FULL)
// =========================================================================

// Upload Customers CSV
app.post('/api/upload/customers', upload.single('file'), (req, res) => {
    const results = [];
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            const customers = results.map((row, index) => ({
                id: Date.now() + index,
                phone: row.phone || row.Phone || row.mobile || row.Mobile,
                name: row.name || row.Name || 'User',
                gender: row.gender || row.Gender || row.sex || row.Sex || row.category || row.Category || 'Men',
                age: row.age || row.Age
            })).filter(c => c.phone);

            await DataManager.addCustomers(customers);
            fs.unlinkSync(req.file.path);
            res.json({ message: 'Customers uploaded', count: customers.length });
        });
});

// Get Customers List & Registry Analytics
// Update customer preferred regional language
app.patch('/api/customers/:id/language', async (req, res) => {
    try {
        const { language } = req.body;
        if (!language) return res.status(400).json({ error: 'Language parameter required' });
        const updated = await DataManager.updateCustomerLanguage(req.params.id, language);
        if (!updated) return res.status(404).json({ error: 'Customer not found' });
        res.json({ success: true, customer: updated });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update audience segment regional language
app.post('/api/customers/segment-language', async (req, res) => {
    try {
        const { segment, language } = req.body;
        if (!language) return res.status(400).json({ error: 'Language parameter required' });
        const count = await DataManager.updateSegmentLanguage(segment || 'All', language);
        res.json({ success: true, updatedCount: count });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/customers', async (req, res) => {
    try {
        const customers = await DataManager.getCustomers();
        res.json(customers);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Upload Offers CSV
app.post('/api/upload/offers', upload.single('file'), (req, res) => {
    const results = [];
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            const offers = results.map((row, index) => ({
                id: Date.now() + index,
                code: row.code || row.Code,
                discount: row.discount || row.Discount,
                description: row.description || row.Description || 'Special Offer'
            }));

            await DataManager.addOffers(offers);
            fs.unlinkSync(req.file.path);
            res.json({ message: 'Offers uploaded', count: offers.length });
        });
});

// Get Offers
app.get('/api/offers', async (req, res) => {
    const offers = await DataManager.getOffers();
    res.json(offers);
});

// Create Single Offer (Manual)
app.post('/api/offers/create', async (req, res) => {
    const { code, discount, description } = req.body;
    if (!code || !discount) return res.status(400).json({ error: 'Missing fields' });

    const newOffer = {
        id: Date.now(),
        code,
        discount,
        description: description || 'Special Offer'
    };

    await DataManager.addOffers([newOffer]);
    res.json({ message: 'Offer added', count: 1 });
});

// Upload Templates (JSON or CSV)
app.post('/api/upload/templates', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const ext = path.extname(req.file.originalname).toLowerCase();

    if (ext === '.json') {
        fs.readFile(req.file.path, 'utf8', async (err, data) => {
            if (err) return res.status(500).json({ error: 'Failed to read file' });
            try {
                const templates = JSON.parse(data);
                await DataManager.saveCategoryTemplates(templates);
                fs.unlinkSync(req.file.path);
                res.json({ message: 'Templates updated from JSON', count: Object.keys(templates).length });
            } catch (e) {
                res.status(400).json({ error: 'Invalid JSON' });
            }
        });
    } else if (ext === '.csv') {
        const results = [];
        fs.createReadStream(req.file.path)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', async () => {
                const templates = {};
                results.forEach(row => {
                    let cat = row.gender || row.Gender || row.category || row.Category || 'General';
                    const msg = row.template || row.Template || row.message || row.Message;

                    const lowerCat = String(cat).toLowerCase();
                    if (lowerCat.includes('men') && !lowerCat.includes('wo')) cat = 'Men';
                    else if (lowerCat.includes('women')) cat = 'Women';
                    else if (lowerCat.includes('boy')) cat = 'Boys';
                    else if (lowerCat.includes('girl')) cat = 'Girls';
                    else if (lowerCat.includes('child') || lowerCat.includes('kid')) cat = 'Children';

                    if (msg) {
                        if (!templates[cat]) templates[cat] = [];
                        templates[cat].push(msg);
                    }
                });

                await DataManager.saveCategoryTemplates(templates);
                fs.unlinkSync(req.file.path);
                res.json({ message: 'Templates parsed from CSV (Gender-based)', categories: Object.keys(templates) });
            });
    } else {
        res.status(400).json({ error: 'Only .json or .csv allowed' });
    }
});

// Get Template Stats
app.get('/api/templates/stats', async (req, res) => {
    const templates = await DataManager.getCategoryTemplates();
    const stats = Object.entries(templates).map(([cat, list]) => ({ category: cat, count: list.length }));
    res.json(stats);
});

// Get All Templates (History)
app.get('/api/templates/list', async (req, res) => {
    const templates = await DataManager.getCategoryTemplates();
    res.json(templates);
});

// Settings & Dual Platform Configuration
app.get('/api/settings', async (req, res) => {
    const settings = await DataManager.getSettings();
    res.json({
        ...settings,
        whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_PHONE_NUMBER || 'whatsapp:+17372508034',
        smsNumber: process.env.TWILIO_SMS_NUMBER || process.env.TWILIO_PHONE_NUMBER || '+17372508034',
        fromNumber: process.env.TWILIO_PHONE_NUMBER || 'whatsapp:+17372508034',
        accountSid: process.env.TWILIO_ACCOUNT_SID ? `${process.env.TWILIO_ACCOUNT_SID.substring(0, 8)}...` : 'Not set',
        isConfigured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
    });
});

app.post('/api/settings', async (req, res) => {
    const { customerCareNumber, sendToCustomerCare, sendToCarePerCustomer, platform } = req.body;
    const updated = await DataManager.saveSettings({
        ...(customerCareNumber !== undefined ? { customerCareNumber } : {}),
        ...(sendToCustomerCare !== undefined ? { sendToCustomerCare: Boolean(sendToCustomerCare) } : {}),
        ...(sendToCarePerCustomer !== undefined ? { sendToCarePerCustomer: Boolean(sendToCarePerCustomer) } : {}),
        ...(platform !== undefined ? { platform } : {})
    });
    res.json({ message: 'Settings saved successfully', settings: updated });
});

// Send SINGLE Message Endpoint: Targets only 1 recipient (preserves trial quota)
app.post('/api/sms/send-single', async (req, res) => {
    try {
        const { recipient, platform = 'both', template, recipientName = 'Akash', offerCode, mediaId } = req.body;
        let singleMediaAsset = null;
        if (mediaId) {
            const check = await mediaService.verifyAssetExists(mediaId);
            if (check.exists) singleMediaAsset = check.asset;
        }
        const targetNumber = recipient || process.env.CUSTOMER_CARE_NUMBER || '+919363341709';

        // Customer governance check
        const governance = await governanceService.validateDispatch({ phone: targetNumber });
        if (!governance.allowed) {
            return res.status(403).json({ success: false, error: governance.reason });
        }

        const offers = await DataManager.getOffers();
        let selectedOffer = offers.length > 0 ? offers[0] : { code: 'SUMMER25', discount: '25% OFF', description: 'Summer Collection Special' };
        if (offerCode) {
            const found = offers.find(o => o.code === offerCode);
            if (found) selectedOffer = found;
        }

        const rawTemplate = template || (await DataManager.getTemplate()) || "";
        const body = QueueSimulator.formatCampaignMessage({
            template: rawTemplate,
            name: recipientName,
            offer: selectedOffer,
            validUntil: '15 Aug 2026',
            careNumber: targetNumber
        });
        const smsBody = QueueSimulator.formatSmsCampaignMessage({
            name: recipientName,
            offer: selectedOffer,
            validUntil: '15 Aug 2026'
        });

        console.log(`[Single Message] Sending to ${targetNumber} via ${platform}`);

        const result = await QueueSimulator.dispatchDualChannel({
            to: targetNumber,
            body: body,
            smsBody: smsBody,
            platform: platform,
            mediaAsset: singleMediaAsset
        });

        const waSent = result.whatsapp?.sent;
        const smsSent = result.sms?.sent;

        let statusText = '';
        if (waSent && smsSent) {
            statusText = `✅ Delivered to ${targetNumber} on BOTH WhatsApp and Cellular SMS!`;
        } else if (waSent) {
            statusText = `✅ Delivered on WhatsApp! (Cellular SMS: ${result.sms?.error || 'unverified on trial'})`;
        } else if (smsSent) {
            statusText = `✅ Delivered on Cellular SMS! (WhatsApp: ${result.whatsapp?.error || 'failed'})`;
        } else {
            statusText = `❌ Delivery failed: WhatsApp (${result.whatsapp?.error || 'none'}) | SMS (${result.sms?.error || 'none'})`;
        }

        res.json({
            success: result.success,
            message: statusText,
            details: result
        });
    } catch (err) {
        console.error('Send single message error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Test Campaign Message to Customer Care on WhatsApp and/or Cellular SMS
app.post('/api/customer-care/test', async (req, res) => {
    try {
        const { customerCareNumber, template, platform = 'both' } = req.body;
        const offers = await DataManager.getOffers();
        const latestOffer = offers.length > 0 ? offers[0] : { code: 'SUMMER25', discount: '25% OFF', description: 'Summer Collection Special' };

        const result = await QueueSimulator.sendToCustomerCare({
            campaign: { name: 'Exclusive Offer Campaign', validUntil: '15 Aug 2026' },
            offer: latestOffer,
            customerCareNumber: customerCareNumber || null,
            platform: platform,
            template: template || null
        });

        const waSent = result.whatsapp?.sent;
        const smsSent = result.sms?.sent;

        let summaryMsg = '';
        if (waSent && smsSent) {
            summaryMsg = 'Campaign message sent on BOTH WhatsApp and Cellular SMS!';
        } else if (waSent) {
            summaryMsg = `Campaign message sent on WhatsApp! (Cellular SMS: ${result.sms?.error || 'unverified number on trial'})`;
        } else if (smsSent) {
            summaryMsg = `Campaign message sent on Cellular SMS! (WhatsApp: ${result.whatsapp?.error || 'failed'})`;
        } else {
            summaryMsg = `Dispatch failed: ${result.whatsapp?.error || result.sms?.error || 'unknown error'}`;
        }

        res.json({
            success: result.success,
            message: summaryMsg,
            details: result
        });
    } catch (err) {
        console.error('Customer care test route error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Start Campaign
app.post('/api/campaigns/start', async (req, res) => {
    const customers = await DataManager.getCustomers();
    if (customers.length === 0) return res.status(400).json({ error: 'No customers found. Upload CSV first.' });

    const {
        name,
        scheduleDelayHours = 0,
        validUntil,
        targetAudience = 'All',
        customerCareNumber,
        sendToCustomerCare = true,
        platform = 'both',
        template,
        mediaId,
        mediaAsset
    } = req.body;

    let campaignMediaAsset = mediaAsset || null;
    let campaignMediaId = mediaId || null;

    // Pre-flight media verification: verify disk existence and accessibility
    if (campaignMediaId) {
        const check = await mediaService.verifyAssetExists(campaignMediaId);
        if (!check.exists) {
            return res.status(422).json({
                error: `Pre-flight validation failed: Media asset ${campaignMediaId} is unavailable (${check.reason || 'Not found'})`
            });
        }
        campaignMediaAsset = check.asset;
        await mediaService.addReference(campaignMediaId, `campaign:${name || 'active'}`);
    }

    if (template) {
        await DataManager.saveTemplate({
            template,
            mediaId: campaignMediaId,
            mediaAsset: campaignMediaAsset,
            channel: platform || 'both'
        });
    }

    const settings = await DataManager.getSettings();
    const effectiveCareNumber = customerCareNumber || settings.customerCareNumber || process.env.CUSTOMER_CARE_NUMBER || '+916369825386';

    let scheduledTime = new Date();
    if (scheduleDelayHours > 0) {
        scheduledTime.setHours(scheduledTime.getHours() + parseInt(scheduleDelayHours));
    }

    const campaign = {
        id: Date.now(),
        name: name || 'Marketing Campaign',
        status: scheduleDelayHours > 0 ? 'SCHEDULED' : 'PENDING',
        total: customers.length,
        sent: 0,
        createdAt: new Date().toISOString(),
        scheduledFor: scheduledTime.toISOString(),
        validUntil: validUntil,
        targetAudience: targetAudience,
        platform: platform || settings.platform || 'both',
        template: template || (await DataManager.getTemplate()),
        mediaId: campaignMediaId,
        mediaAsset: campaignMediaAsset,
        mediaEnabled: Boolean(campaignMediaId),
        mediaType: campaignMediaAsset?.mediaType || null,
        customerCareNumber: effectiveCareNumber,
        sendToCustomerCare: Boolean(sendToCustomerCare),
        customerCareNotified: false
    };

    await DataManager.createCampaign(campaign);
    QueueSimulator.scheduleCampaign(campaign.id, scheduledTime);

    res.json({
        message: scheduleDelayHours > 0 ? `Campaign scheduled for ${scheduledTime.toISOString()}` : 'Campaign started',
        campaignId: campaign.id,
        platform: campaign.platform
    });
});

// Get All Campaigns (Historical & Active)
app.get('/api/campaigns', async (req, res) => {
    try {
        const db = await DataManager._getMainDB();
        const campaigns = db.campaigns || [];
        res.json(campaigns);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Campaign Status
app.get('/api/campaigns/:id', async (req, res) => {
    const campaign = await DataManager.getCampaign(parseInt(req.params.id));
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json(campaign);
});

// Template Management
app.get('/api/template', async (req, res) => {
    try {
        const config = await DataManager.getTemplateConfig();
        res.json(config);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/template', async (req, res) => {
    try {
        const { template, mediaId, mediaAsset, channel } = req.body;
        if (template === undefined && !mediaId) {
            return res.status(400).json({ error: 'Template content or media is required' });
        }

        let resolvedAsset = mediaAsset || null;
        if (mediaId && !resolvedAsset) {
            resolvedAsset = await mediaService.getById(mediaId);
        }
        if (mediaId) {
            await mediaService.addReference(mediaId, 'template:active');
        }

        const saved = await DataManager.saveTemplate({
            template: template !== undefined ? template : '',
            mediaId: mediaId || null,
            mediaAsset: resolvedAsset,
            channel: channel || 'both'
        });

        res.json({
            message: 'Template saved',
            template: saved.template,
            mediaId: saved.mediaId,
            mediaAsset: saved.mediaAsset,
            channel: saved.channel
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Reusable Saved Templates Management
app.get('/api/templates/saved', async (req, res) => {
    try {
        const templates = await DataManager.getSavedTemplates();
        res.json(templates);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/templates/saved', async (req, res) => {
    try {
        const { id, name, body, template, channel, mediaId, mediaAsset, category } = req.body;
        let resolvedAsset = mediaAsset || null;
        if (mediaId && !resolvedAsset) {
            resolvedAsset = await mediaService.getById(mediaId);
        }
        if (mediaId) {
            await mediaService.addReference(mediaId, `template:${name || 'saved'}`);
        }
        const record = await DataManager.saveTemplateItem({
            id,
            name,
            body: body || template || '',
            channel: channel || 'both',
            mediaId: mediaId || null,
            mediaAsset: resolvedAsset,
            category: category || 'General'
        });
        res.json({ message: 'Template saved successfully', template: record });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/templates/saved/:id', async (req, res) => {
    try {
        const deleted = await DataManager.deleteSavedTemplate(req.params.id);
        if (!deleted) return res.status(404).json({ error: 'Saved template not found' });
        res.json({ message: 'Saved template deleted', id: req.params.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Tracked Media Redirect for SMS & Click Telemetry
app.get(['/api/m/:id', '/api/media/track/:id'], async (req, res) => {
    try {
        const mediaId = req.params.id;
        const asset = await mediaService.getById(mediaId);
        if (!asset) return res.status(404).send('Media not found');

        try {
            await dispatchTelemetryService.recordMediaClick({
                mediaId,
                recipient: req.query.r || null,
                campaignId: req.query.c || null,
                userAgent: req.headers['user-agent'] || 'unknown',
                ip: req.ip || req.headers['x-forwarded-for'] || 'unknown'
            });
        } catch (e) {
            console.warn('[Telemetry MediaClick Warning]', e.message);
        }

        res.redirect(302, `/api/media/asset/${mediaId}`);
    } catch (err) {
        res.status(500).send('Redirection error: ' + err.message);
    }
});


// =========================================================================
// 2. MEDIA LIBRARY ROUTES
// =========================================================================

app.get('/api/media', async (req, res) => {
    try {
        const media = await mediaService.getAll(req.query);
        res.json(media);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/media/upload', mediaUpload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No media file provided' });
        const record = await mediaService.registerUpload(req.file, {
            caption: req.body.caption,
            tags: req.body.tags
        });
        res.status(201).json({ message: 'Media uploaded successfully', asset: record });
    } catch (err) {
        console.error('Media upload error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/media/asset/:id', async (req, res) => {
    try {
        const asset = await mediaService.getById(req.params.id);
        if (!asset) return res.status(404).json({ error: 'Asset not found' });
        const filePath = storageProvider.getAssetPath(asset.filename);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Asset file not found on disk' });
        }
        res.setHeader('Content-Type', asset.mimeType || 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
        res.sendFile(filePath);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/media/:id', async (req, res) => {
    try {
        const updated = await mediaService.update(req.params.id, req.body);
        res.json({ message: 'Media asset updated', asset: updated });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.delete('/api/media/:id', async (req, res) => {
    try {
        const force = req.query.force === 'true';
        const result = await mediaService.delete(req.params.id, { force });
        if (!result.success && result.referenced) {
            return res.status(409).json(result);
        }
        res.json({ message: 'Asset deleted successfully' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});


// =========================================================================
// 3. INTEGRATION CONSOLE & VAULT ROUTES
// =========================================================================

app.get('/api/integrations/status', async (req, res) => {
    try {
        const status = await integrationService.getPublicStatus();
        res.json(status);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/integrations/:provider/save', async (req, res) => {
    try {
        const provider = req.params.provider.toLowerCase();
        const result = await integrationService.saveCredentials(provider, req.body);
        res.json({ message: `${provider} credentials saved and verified`, result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/integrations/:provider/verify', async (req, res) => {
    try {
        const provider = req.params.provider.toLowerCase();
        const result = await integrationService.verifyProvider(provider);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/integrations/:provider/disconnect', async (req, res) => {
    try {
        const provider = req.params.provider.toLowerCase();
        const result = await integrationService.disconnectProvider(provider);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// =========================================================================
// 4. MESSAGE SCHEDULER ROUTES
// =========================================================================

app.get('/api/schedules', async (req, res) => {
    try {
        const list = await schedulerService.getAll();
        res.json(list);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/schedules', async (req, res) => {
    try {
        const item = await schedulerService.createSchedule(req.body);
        res.status(201).json({ message: 'Schedule created', schedule: item });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/schedules/:id', async (req, res) => {
    try {
        const updated = await schedulerService.updateSchedule(req.params.id, req.body);
        res.json({ message: 'Schedule updated', schedule: updated });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.delete('/api/schedules/:id', async (req, res) => {
    try {
        await schedulerService.deleteSchedule(req.params.id);
        res.json({ message: 'Schedule deleted' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/schedules/:id/run-now', async (req, res) => {
    try {
        const result = await schedulerService.executeSchedule(req.params.id, { DataManager, QueueSimulator });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/schedules/:id/cancel', async (req, res) => {
    try {
        const result = await schedulerService.cancelSchedule(req.params.id);
        res.json({ message: 'Schedule cancelled', schedule: result });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});


// =========================================================================
// 5. FOLLOW-UP AUTOMATION WORKFLOW ROUTES
// =========================================================================

app.get('/api/automations', async (req, res) => {
    try {
        const list = await automationService.getAll();
        res.json(list);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/automations', async (req, res) => {
    try {
        const created = await automationService.createAutomation(req.body);
        res.status(201).json({ message: 'Automation workflow created', automation: created });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/automations/:id', async (req, res) => {
    try {
        const updated = await automationService.updateAutomation(req.params.id, req.body);
        res.json({ message: 'Workflow updated', automation: updated });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/automations/:id/toggle', async (req, res) => {
    try {
        const result = await automationService.toggleActive(req.params.id);
        res.json({ message: `Workflow is now ${result.active ? 'Active' : 'Paused'}`, automation: result });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.delete('/api/automations/:id', async (req, res) => {
    try {
        await automationService.deleteAutomation(req.params.id);
        res.json({ message: 'Automation workflow deleted' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/automations/:id/trigger-test', async (req, res) => {
    try {
        const result = await automationService.triggerTest(req.params.id, req.body.customer);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// =========================================================================
// 6. META MARKETING CAMPAIGN ROUTES
// =========================================================================

app.get('/api/meta/campaigns', async (req, res) => {
    try {
        const data = await metaCampaignService.getStatusAndCampaigns();
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/meta/campaigns', async (req, res) => {
    try {
        const created = await metaCampaignService.createCampaign(req.body);
        res.status(201).json({ message: 'Meta campaign created', campaign: created });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/meta/campaigns/:id/toggle', async (req, res) => {
    try {
        const updated = await metaCampaignService.toggleCampaignStatus(req.params.id);
        res.json({ message: 'Campaign status updated', campaign: updated });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.put('/api/meta/campaigns/:id/budget', async (req, res) => {
    try {
        const updated = await metaCampaignService.updateBudget(req.params.id, req.body.dailyBudget);
        res.json({ message: 'Budget updated', campaign: updated });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});


// =========================================================================
// 7. GOOGLE ADS CAMPAIGN ROUTES
// =========================================================================

app.get('/api/google/campaigns', async (req, res) => {
    try {
        const data = await googleCampaignService.getStatusAndCampaigns();
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/google/campaigns', async (req, res) => {
    try {
        const created = await googleCampaignService.createCampaign(req.body);
        res.status(201).json({ message: 'Google Ads campaign created', campaign: created });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/google/campaigns/:id/toggle', async (req, res) => {
    try {
        const updated = await googleCampaignService.toggleCampaignStatus(req.params.id);
        res.json({ message: 'Campaign status updated', campaign: updated });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.put('/api/google/campaigns/:id/budget', async (req, res) => {
    try {
        const updated = await googleCampaignService.updateBudget(req.params.id, req.body.dailyBudget);
        res.json({ message: 'Budget updated', campaign: updated });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});


// =========================================================================
// 8. CUSTOMER SAFETY & GOVERNANCE ROUTES
// =========================================================================

app.get('/api/governance/suppression', async (req, res) => {
    try {
        const list = await governanceService.getSuppressionList();
        res.json(list);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/governance/suppression/add', async (req, res) => {
    try {
        const { phone, reason, source } = req.body;
        if (!phone) return res.status(400).json({ error: 'Phone number required' });
        const result = await governanceService.suppressPhone(phone, reason, source);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/governance/suppression/remove', async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) return res.status(400).json({ error: 'Phone number required' });
        const result = await governanceService.unsuppressPhone(phone);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/governance/rules', async (req, res) => {
    try {
        const rules = await governanceService.getRules();
        res.json(rules);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/governance/rules', async (req, res) => {
    try {
        const updated = await governanceService.updateRules(req.body);
        res.json({ message: 'Governance rules saved', rules: updated });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// =========================================================================
// 9. TWILIO INBOUND WEBHOOK & ENGAGEMENT ROUTES
// =========================================================================

app.post('/api/webhooks/twilio/inbound', async (req, res) => {
    try {
        // 1. Signature validation in production
        const sigCheck = await inboundWebhookService.validateWebhookSignature(req);
        if (!sigCheck.valid) {
            console.warn(`[Webhook Rejected] Signature validation failure: ${sigCheck.reason}`);
            return res.status(403).type('text/xml').send('<Response><Message>Forbidden</Message></Response>');
        }

        // 2. Process inbound message (idempotency, customer resolution, opt-out, cancel follow-ups)
        const result = await inboundWebhookService.processInboundMessage(req.body);

        // 3. Return valid TwiML
        res.type('text/xml').send('<Response></Response>');
    } catch (err) {
        console.error('[Webhook Error]', err);
        res.status(500).type('text/xml').send(`<Response><!-- ${err.message} --></Response>`);
    }
});

app.get('/api/webhooks/twilio/messages', async (req, res) => {
    try {
        const messages = await inboundWebhookService.getInboundMessages(req.query);
        res.json({ count: messages.length, messages });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Twilio Message Delivery Status Callback (Handset Receipts & Error Tracking)
app.post('/api/webhooks/twilio/status', async (req, res) => {
    try {
        const messageSid = req.body.MessageSid || req.body.SmsSid;
        const messageStatus = req.body.MessageStatus || req.body.SmsStatus;
        const errorCode = req.body.ErrorCode || null;
        const errorMessage = req.body.ErrorMessage || null;

        if (!messageSid || !messageStatus) {
            return res.status(400).json({ error: 'Missing MessageSid or MessageStatus' });
        }

        const result = await dispatchTelemetryService.processStatusCallback({
            messageSid,
            messageStatus,
            errorCode,
            errorMessage,
            rawPayload: req.body
        });

        res.json(result);
    } catch (err) {
        console.error('[Status Callback Error]', err);
        res.status(500).json({ error: err.message });
    }
});

// Analytics Telemetry Endpoint (Discrete Channel Performance & Verified Rates)
app.get('/api/analytics/telemetry', async (req, res) => {
    try {
        const { dateRange = 'all', granularity = 'daily', timeZone = 'UTC' } = req.query;
        const metrics = await dispatchTelemetryService.getTelemetryMetrics({ dateRange, granularity, timeZone });
        res.json(metrics);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// =========================================================================
// 10. NOTIFICATIONS ROUTES (PHASE 15 ADDENDUM)
// =========================================================================

app.get('/api/notifications', async (req, res) => {
    try {
        const userId = req.query.userId || 'admin';
        const unreadOnly = req.query.unreadOnly === 'true';
        const limit = parseInt(req.query.limit, 10) || 50;
        const list = await notificationService.getAll({ userId, unreadOnly, limit });
        res.json(list);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/notifications/unread-count', async (req, res) => {
    try {
        const userId = req.query.userId || 'admin';
        const unreadCount = await notificationService.getUnreadCount({ userId });
        res.json({ unreadCount });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/notifications', async (req, res) => {
    try {
        const notif = await notificationService.createNotification(req.body);
        res.status(201).json(notif);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/notifications/:id/read', async (req, res) => {
    try {
        const userId = (req.body && req.body.userId) || 'admin';
        const result = await notificationService.markRead(req.params.id, userId);
        if (!result.success) {
            return res.status(404).json(result);
        }
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/notifications/mark-all-read', async (req, res) => {
    try {
        const userId = (req.body && req.body.userId) || 'admin';
        const result = await notificationService.markAllRead(userId);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/notifications/:id', async (req, res) => {
    try {
        const userId = req.query.userId || 'admin';
        const result = await notificationService.deleteNotification(req.params.id, userId);
        if (!result.success) {
            return res.status(404).json(result);
        }
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/notifications', async (req, res) => {
    try {
        const userId = req.query.userId || 'admin';
        const result = await notificationService.clearAll(userId);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// =========================================================================
// BACKGROUND RUNNER INITIATION & SERVER START
// =========================================================================


// =========================================================================
// PHASE 17: AI-POWERED TEMPLATE GENERATOR & MULTILINGUAL AUTOMATION
// =========================================================================

app.post('/api/ai-templates/analyze-image', mediaUpload.single('image'), async (req, res) => {
    try {
        let mediaId = req.body?.mediaId || req.body?.mediaAsset?.id || null;
        let fileBuffer = req.file ? await fs.promises.readFile(req.file.path) : null;
        let originalname = req.file?.originalname || req.body?.mediaAsset?.originalName || req.body?.originalname || '';
        let mimeType = req.file?.mimetype || req.body?.mediaAsset?.mimeType || 'image/jpeg';
        let imageHint = req.body?.imageHint || '';

        if (req.file) {
            try {
                const asset = await mediaService.registerUpload(req.file, {
                    caption: 'Uploaded for AI Template Analysis',
                    tags: ['AI_GENERATED']
                });
                mediaId = asset.id;
            } catch (regErr) {
                console.warn('Auto-register upload note:', regErr.message);
            }
        }

        const result = await aiTemplateService.analyzeImage({
            mediaId,
            fileBuffer,
            originalname,
            mimeType,
            imageHint
        });

        res.json(result);
    } catch (err) {
        console.error('AI image analysis error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ai-templates/generate', async (req, res) => {
    try {
        const { generationId, userId, sourceMediaId, sourceMediaAsset, extractedOfferData, languages, channel, tone } = req.body;
        if (!extractedOfferData) {
            return res.status(400).json({ error: 'extractedOfferData is required' });
        }
        const record = await aiTemplateService.generateContent({
            generationId,
            userId,
            sourceMediaId,
            sourceMediaAsset,
            extractedOfferData,
            languages: Array.isArray(languages) ? languages : ['english'],
            channel: channel || 'both',
            tone: tone || 'promotional'
        });
        res.json(record);
    } catch (err) {
        console.error('AI generate content error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ai-templates/generate-followups', async (req, res) => {
    try {
        const { generationId, campaignId, schedule, languages, channel, tone, extractedOfferData } = req.body;
        const followUps = await aiTemplateService.generateFollowUps({
            generationId,
            campaignId,
            schedule: schedule || [],
            languages: languages || ['english'],
            channel: channel || 'both',
            tone: tone || 'promotional',
            extractedOfferData: extractedOfferData || {}
        });
        res.json({ success: true, followUps });
    } catch (err) {
        console.error('AI generate follow-ups error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/ai-templates', async (req, res) => {
    try {
        const list = await aiTemplateService.getAllGenerations();
        res.json(list);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Gemini Status check
app.get('/api/ai-templates/gemini-status', (req, res) => {
    try {
        const geminiService = require('./services/geminiService');
        const apiKey = process.env.GEMINI_API_KEY;
        res.json({
            configured: !!apiKey,
            model: geminiService.defaultModel,
            fallbackModels: geminiService.fallbackModels,
            auditLogsCount: geminiService.getAuditLogs().length
        });
    } catch (err) {
        res.status(500).json({ configured: false, error: err.message });
    }
});

app.get('/api/ai-templates/:id', async (req, res) => {
    try {
        const item = await aiTemplateService.getGeneration(req.params.id);
        if (!item) return res.status(404).json({ error: 'AI Generation record not found' });
        res.json(item);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/ai-templates/:id', async (req, res) => {
    try {
        const { variantId, messageBody } = req.body;
        if (!variantId || messageBody === undefined) {
            return res.status(400).json({ error: 'variantId and messageBody are required' });
        }
        const updated = await aiTemplateService.updateVariantCopy({
            generationId: req.params.id,
            variantId,
            messageBody
        });
        res.json({ success: true, variant: updated });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Validate regional language version approvals before broadcast (Strict no automatic substitution)
// Confirm extracted offer fields before message generation
app.post('/api/ai-templates/:id/confirm-fields', async (req, res) => {
    try {
        const { confirmedFields } = req.body;
        const result = await aiTemplateService.confirmOfferFields({
            generationId: req.params.id,
            confirmedFields: confirmedFields || {}
        });
        res.json({ success: true, generation: result });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/ai-templates/:id/validate-approval', async (req, res) => {
    try {
        const { requiredLanguages = [] } = req.body;
        const result = await aiTemplateService.validateLanguageApproval({
            generationId: req.params.id,
            requiredLanguages
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ valid: false, error: err.message });
    }
});

app.post('/api/ai-templates/:id/approve', async (req, res) => {
    try {
        const { variantId, approveAll = false, approvedBy = 'admin' } = req.body;
        const result = await aiTemplateService.approveVariant({
            generationId: req.params.id,
            variantId,
            approveAll,
            approvedBy
        });
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/ai-templates/:id/save', async (req, res) => {
    try {
        const { variantId, templateName, category } = req.body;
        const gen = await aiTemplateService.getGeneration(req.params.id);
        if (!gen) return res.status(404).json({ error: 'AI Generation not found' });

        const variant = variantId ? gen.variants.find(v => v.id === variantId) : gen.variants[0];
        if (!variant) return res.status(404).json({ error: 'Variant not found' });

        const savedItem = await DataManager.saveTemplateItem({
            name: templateName || `${gen.extractedOfferData.businessName} - ${variant.language.toUpperCase()} (${variant.variantType})`,
            body: variant.messageBody,
            channel: variant.channel || gen.channel || 'both',
            mediaId: gen.sourceMediaId || null,
            mediaAsset: gen.sourceMediaAsset || null,
            category: category || 'AI_Generated'
        });

        if (req.body.setActive) {
            await DataManager.saveTemplate({
                template: variant.messageBody,
                mediaId: gen.sourceMediaId || null,
                mediaAsset: gen.sourceMediaAsset || null,
                channel: variant.channel || gen.channel || 'both'
            });
        }

        res.json({
            success: true,
            message: 'AI template successfully saved to template studio and library',
            template: savedItem
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ai-templates/:id/test', async (req, res) => {
    try {
        const { variantId, recipient, recipientName = 'Customer' } = req.body;
        const gen = await aiTemplateService.getGeneration(req.params.id);
        if (!gen) return res.status(404).json({ error: 'AI Generation not found' });

        const variant = variantId ? gen.variants.find(v => v.id === variantId) : gen.variants[0];
        if (!variant) return res.status(404).json({ error: 'Variant not found' });

        const targetNumber = recipient || process.env.CUSTOMER_CARE_NUMBER || '+916369825386';

        const governance = await governanceService.validateDispatch({ phone: targetNumber });
        if (!governance.allowed) {
            return res.status(403).json({ success: false, error: governance.reason });
        }

        let body = variant.messageBody
            .replace(/{{customer_name}}/g, recipientName)
            .replace(/{{1}}/g, recipientName)
            .replace(/{{business_name}}/g, gen.extractedOfferData.businessName || 'Trends')
            .replace(/{{offer_name}}/g, gen.extractedOfferData.offerTitle || 'Special Offer')
            .replace(/{{offer_code}}/g, gen.extractedOfferData.couponCode || 'SUMMER25')
            .replace(/{{2}}/g, `${gen.extractedOfferData.discount || '25% OFF'} with ${gen.extractedOfferData.couponCode || 'SUMMER25'}`)
            .replace(/{{valid_until}}/g, gen.extractedOfferData.validUntil || '15 Aug 2026')
            .replace(/{{3}}/g, gen.extractedOfferData.validUntil || '15 Aug 2026')
            .replace(/{{care_number}}/g, gen.extractedOfferData.contactNumber || targetNumber);

        const dispatchResult = await QueueSimulator.dispatchDualChannel({
            to: targetNumber,
            body: body,
            smsBody: null,
            platform: variant.channel || 'both',
            mediaAsset: gen.sourceMediaAsset || null
        });

        res.json({
            success: dispatchResult.success,
            message: `Carrier test dispatched in ${variant.language.toUpperCase()} (${variant.channel.toUpperCase()})`,
            details: dispatchResult
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ai-templates/:id/use-in-campaign', async (req, res) => {
    try {
        const { variantId, campaignName, validUntil, targetAudience = 'All', scheduleDelayHours = 0 } = req.body;
        const gen = await aiTemplateService.getGeneration(req.params.id);
        if (!gen) return res.status(404).json({ error: 'AI Generation not found' });

        const variant = variantId ? gen.variants.find(v => v.id === variantId) : gen.variants[0];
        if (!variant) return res.status(404).json({ error: 'Variant not found' });

        const customers = await DataManager.getCustomers();

        let scheduledTime = new Date();
        if (scheduleDelayHours > 0) {
            scheduledTime.setHours(scheduledTime.getHours() + parseInt(scheduleDelayHours));
        }

        const newCampaign = {
            id: Date.now(),
            name: campaignName || `${gen.extractedOfferData.businessName} - ${variant.language.toUpperCase()} Broadcast`,
            status: scheduleDelayHours > 0 ? 'SCHEDULED' : 'PENDING',
            total: customers.length,
            sent: 0,
            createdAt: new Date().toISOString(),
            scheduledFor: scheduledTime.toISOString(),
            validUntil: validUntil || gen.extractedOfferData.validUntil || '15 Aug 2026',
            targetAudience: targetAudience,
            platform: variant.channel || 'both',
            template: variant.messageBody,
            mediaId: gen.sourceMediaId || null,
            mediaAsset: gen.sourceMediaAsset || null,
            mediaEnabled: Boolean(gen.sourceMediaId),
            mediaType: gen.sourceMediaAsset?.mediaType || null,
            language: variant.language,
            aiGenerationId: gen.id,
            customerCareNumber: process.env.CUSTOMER_CARE_NUMBER || '+916369825386',
            sendToCustomerCare: true,
            customerCareNotified: false
        };

        await DataManager.createCampaign(newCampaign);
        QueueSimulator.scheduleCampaign(newCampaign.id, scheduledTime);

        res.json({
            success: true,
            message: `Multilingual campaign #${newCampaign.id} launched successfully`,
            campaignId: newCampaign.id,
            language: variant.language,
            mediaEnabled: newCampaign.mediaEnabled
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Start scheduler background runner
schedulerService.startRunner({ DataManager, QueueSimulator });

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Multi-Channel Backend running on http://localhost:${PORT}`);
    console.log(`📡 Endpoints initialized for Media, Schedules, Automations, Meta, Google, Integrations & Governance`);
});

server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        console.log(`⚠️ Port ${PORT} in use, trying ${PORT + 1}...`);
        app.listen(PORT + 1, '0.0.0.0', () => {
            console.log(`✅ Backend Server running on http://localhost:${PORT + 1}`);
        });
    } else {
        console.error("Server Error:", e);
    }
});
