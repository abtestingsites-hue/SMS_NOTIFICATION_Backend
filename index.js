const express = require('express');
require('dotenv').config();
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { DataManager } = require('./dataManager');
const { QueueSimulator } = require('./queueSimulator');
const csv = require('csv-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Upload config
const upload = multer({ dest: 'uploads/' });

// Basic Routes
app.get('/', (req, res) => {
    res.send('Backend is running! 🚀 <br> Please access the frontend at <a href="http://localhost:5173">http://localhost:5173</a>');
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', mode: 'demo' });
});

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
        const { recipient, platform = 'both', template, recipientName = 'Akash', offerCode } = req.body;
        const targetNumber = recipient || process.env.CUSTOMER_CARE_NUMBER || '+919363341709';

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
            platform: platform
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
        template
    } = req.body;

    if (template) {
        await DataManager.saveTemplate(template);
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

// Get Campaign Status
app.get('/api/campaigns/:id', async (req, res) => {
    const campaign = await DataManager.getCampaign(parseInt(req.params.id));
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json(campaign);
});

// Template Management
app.get('/api/template', async (req, res) => {
    const template = await DataManager.getTemplate();
    res.json({ template });
});

app.post('/api/template', async (req, res) => {
    const { template } = req.body;
    if (!template) return res.status(400).json({ error: 'Template is required' });
    await DataManager.saveTemplate(template);
    res.json({ message: 'Template saved', template });
});

// Start Server with Port Fallback
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Backend Server running on http://localhost:${PORT}`);
    console.log(`Resources: /api/upload/customers, /api/upload/offers, /api/template, /api/settings, /api/customer-care/test, /api/sms/send-single`);
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
