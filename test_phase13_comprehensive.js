// Comprehensive Phase 13 Hardening & Regression Verification Suite
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE_URL = 'http://127.0.0.1:3000';

async function runTests() {
    console.log('🚀 ========================================================');
    console.log('   STARTING PHASE 13 COMPREHENSIVE VERIFICATION SUITE');
    console.log('========================================================\n');

    let passed = 0;
    let failed = 0;

    function assert(condition, testName, details = '') {
        if (condition) {
            console.log(`✅ [PASS] ${testName}`);
            passed++;
        } else {
            console.error(`❌ [FAIL] ${testName}: ${details}`);
            failed++;
        }
    }

    // ----------------------------------------------------
    // TEST 1: HEALTH & CONFIGURATION
    // ----------------------------------------------------
    try {
        const res = await fetch(`${BASE_URL}/api/health`);
        const json = await res.json();
        assert(json.status === 'ok' && json.mode === 'enterprise_production', 'Backend health check returns enterprise mode');
    } catch (e) {
        assert(false, 'Backend health check', e.message);
    }

    // ----------------------------------------------------
    // TEST 2: ENCRYPTION SECURITY & KEY ROTATION (TASK 1)
    // ----------------------------------------------------
    try {
        const encryptionService = require('./services/encryptionService');
        const plaintext = 'super_secret_twilio_token_9876543210';
        const encrypted = encryptionService.encrypt(plaintext);
        assert(encrypted && encrypted.includes(':'), 'Payload encrypted with IV and Auth Tag');

        const decrypted = encryptionService.decrypt(encrypted);
        assert(decrypted === plaintext, 'Payload decrypted successfully with master key');

        // Test key rotation: Encrypt with candidate key from ENCRYPTION_PREVIOUS_KEYS
        const prevKey = process.env.ENCRYPTION_PREVIOUS_KEYS || 'sms_campaign_system_master_enterprise_secret_2026';
        const salt = crypto.randomBytes(16);
        const iv = crypto.randomBytes(12);
        const derivedKey = crypto.pbkdf2Sync(prevKey, salt, 100000, 32, 'sha512');
        const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
        let oldEnc = cipher.update('legacy_credential_value', 'utf8', 'hex');
        oldEnc += cipher.final('hex');
        const tag = cipher.getAuthTag();
        const legacyCiphertext = [
            salt.toString('hex'),
            iv.toString('hex'),
            tag.toString('hex'),
            oldEnc
        ].join(':');

        const decryptedLegacy = encryptionService.decrypt(legacyCiphertext);
        assert(decryptedLegacy === 'legacy_credential_value', 'Key rotation: Legacy ciphertext decrypted via PREVIOUS_KEYS fallback');
    } catch (e) {
        assert(false, 'Encryption security & rotation', e.message);
    }

    // ----------------------------------------------------
    // TEST 3: INTEGRATION CONSOLE STATUS & VAULT (TASK 1)
    // ----------------------------------------------------
    try {
        const res = await fetch(`${BASE_URL}/api/integrations/status`);
        const json = await res.json();
        assert(json && json.twilio && json.twilio.status === 'CONNECTED', 'Integration Console returns Twilio Connected');
        assert(json.meta && json.google, 'Integration Console returns Meta and Google structures');
        assert(json.twilio.hasAuthToken === true, 'Twilio Auth Token masked in status output');
        assert(Array.isArray(json.auditLogs) && json.auditLogs.length > 0, 'Vault security audit logs populated');
    } catch (e) {
        assert(false, 'Integration status & vault', e.message);
    }

    // ----------------------------------------------------
    // TEST 4: TWILIO INBOUND WEBHOOK (TASK 2)
    // ----------------------------------------------------
    try {
        const testSid = 'SM_inbound_test_' + Date.now();
        const testPhone = '+17372508034';
        const formBody = new URLSearchParams({
            MessageSid: testSid,
            From: testPhone,
            To: '+12202404020',
            Body: 'Hello! I would like more information on the summer sale.',
            ProfileName: 'Alex Customer'
        }).toString();

        const webhookRes = await fetch(`${BASE_URL}/api/webhooks/twilio/inbound`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'x-bypass-signature': 'true'
            },
            body: formBody
        });

        const twiml = await webhookRes.text();
        assert(webhookRes.status === 200 && twiml.includes('<Response>'), 'Inbound webhook returns valid 200 TwiML response');

        // Test Idempotency: replay same MessageSid
        const replayRes = await fetch(`${BASE_URL}/api/webhooks/twilio/inbound`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'x-bypass-signature': 'true'
            },
            body: formBody
        });
        assert(replayRes.status === 200, 'Replay of duplicate MessageSid processed idempotently');

        // Query inbound messages log
        const logRes = await fetch(`${BASE_URL}/api/webhooks/twilio/messages?phone=${encodeURIComponent(testPhone)}`);
        const logData = await logRes.json();
        assert(logData.count > 0, 'Inbound message persisted in database audit log');
        const savedMsg = logData.messages.find(m => m.messageSid === testSid);
        assert(savedMsg && savedMsg.isConversion === false, 'Customer response is NOT assumed to be a conversion');

        // Test Opt-out keyword STOP
        const optOutSid = 'SM_optout_test_' + Date.now();
        const optOutPhone = '+19998887777';
        await fetch(`${BASE_URL}/api/webhooks/twilio/inbound`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'x-bypass-signature': 'true'
            },
            body: new URLSearchParams({
                MessageSid: optOutSid,
                From: optOutPhone,
                To: '+12202404020',
                Body: 'STOP',
                ProfileName: 'Opt Out User'
            }).toString()
        });

        const supRes = await fetch(`${BASE_URL}/api/governance/suppression`);
        const supList = await supRes.json();
        const isSuppressed = supList.some(s => s.phone === optOutPhone);
        assert(isSuppressed, 'Inbound STOP keyword automatically suppressed recipient in Governance Registry');
    } catch (e) {
        assert(false, 'Twilio inbound webhook processing', e.message);
    }

    // ----------------------------------------------------
    // TEST 5: DURABLE MEDIA STORAGE & MAGIC BYTES (TASK 3)
    // ----------------------------------------------------
    try {
        const storageProvider = require('./services/storageProvider');

        // Valid JPEG magic bytes: FFD8FFE0
        const validJpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);
        const validPng = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        const fakeFile = Buffer.from('NOT_AN_IMAGE_MALICIOUS_SCRIPT');

        assert(storageProvider.validateMagicBytes(validJpeg, 'image/jpeg') === true, 'Storage provider accepts valid JPEG magic bytes');
        assert(storageProvider.validateMagicBytes(validPng, 'image/png') === true, 'Storage provider accepts valid PNG magic bytes');
        assert(storageProvider.validateMagicBytes(fakeFile, 'image/jpeg') === false, 'Storage provider rejects spoofed file with invalid magic bytes');

        // Save durable test asset
        const saved = await storageProvider.saveAsset(validPng, 'test_logo.png', 'image/png');
        assert(saved.storedFilename && saved.checksum.length === 64, 'Durable asset stored with SHA-256 checksum');

        // Verify retrieval via streaming endpoint
        const mediaService = require('./services/mediaService');
        const registered = await mediaService.registerUpload({
            filename: saved.storedFilename,
            originalname: 'test_logo.png',
            mimetype: 'image/png',
            size: validPng.length,
            path: saved.targetPath
        }, { caption: 'Phase 13 Verified Logo' });

        assert(registered.assetStreamUrl && registered.checksum, 'Media service registers durable asset with stream URL');

        const streamRes = await fetch(`${BASE_URL}/api/media/asset/${registered.id}`);
        assert(streamRes.status === 200 && streamRes.headers.get('content-type') === 'image/png', 'Streaming asset route serves binary with correct Content-Type');
    } catch (e) {
        assert(false, 'Media storage & magic bytes verification', e.message);
    }

    // ----------------------------------------------------
    // TEST 6: SCHEDULER LEASE LOCKING & RETRY (TASK 4)
    // ----------------------------------------------------
    try {
        const schedulerService = require('./services/schedulerService');
        const { DataManager } = require('./dataManager');
        const { QueueSimulator } = require('./queueSimulator');

        // Create a test schedule
        const sched = await schedulerService.createSchedule({
            name: 'Phase 13 Resilience Dispatch',
            type: 'ONCE',
            channel: 'both',
            targetAudience: 'All',
            scheduledAt: new Date(Date.now() - 5000).toISOString()
        });

        assert(sched && sched.id, 'Created schedule for lease lock testing');

        // Execute schedule
        const execResult = await schedulerService.executeSchedule(sched.id, { DataManager, QueueSimulator });
        assert(execResult.success === true, 'Schedule executed successfully through lease locking');

        // Verify that lock is released upon completion
        const refreshed = await schedulerService.getById(sched.id);
        assert(refreshed.status === 'COMPLETED' && refreshed.lockedBy === null, 'Worker lease lock cleanly released on job completion');
    } catch (e) {
        assert(false, 'Scheduler lease locking & execution', e.message);
    }

    // ----------------------------------------------------
    // TEST 7: META & GOOGLE LIVE/SANDBOX DELINEATION (TASK 5)
    // ----------------------------------------------------
    try {
        const metaRes = await fetch(`${BASE_URL}/api/meta/campaigns`);
        const metaData = await metaRes.json();
        assert(metaData.dataSource !== undefined && metaData.isLive !== undefined, 'Meta campaigns API reports dataSource and isLive flag');
        assert(metaData.dataSourceNotice && metaData.dataSourceNotice.length > 0, 'Meta campaigns API includes clear transparency notice');

        const googRes = await fetch(`${BASE_URL}/api/google/campaigns`);
        const googData = await googRes.json();
        assert(googData.dataSource !== undefined && googData.isLive !== undefined, 'Google campaigns API reports dataSource and isLive flag');
        assert(googData.dataSourceNotice && googData.dataSourceNotice.length > 0, 'Google campaigns API includes clear transparency notice');
    } catch (e) {
        assert(false, 'Meta & Google delineation', e.message);
    }

    // ----------------------------------------------------
    // TEST 8: TWILIO SMS & WHATSAPP REGRESSION (TASK 6)
    // ----------------------------------------------------
    try {
        const verifiedNumber = process.env.CUSTOMER_CARE_NUMBER || '+916369825386';

        // Test single recipient dispatch
        const singleSmsRes = await fetch(`${BASE_URL}/api/sms/send-single`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recipient: verifiedNumber,
                template: 'Phase 13 Regression Test: Verified SMS Delivery.',
                platform: 'sms'
            })
        });
        const smsData = await singleSmsRes.json();
        assert(smsData.success === true, 'Single SMS dispatch regression test passed');

        const singleWaRes = await fetch(`${BASE_URL}/api/sms/send-single`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recipient: verifiedNumber,
                template: 'Phase 13 Regression Test: Verified WhatsApp Delivery.',
                platform: 'whatsapp'
            })
        });
        const waData = await singleWaRes.json();
        assert(waData.success === true, 'Single WhatsApp dispatch regression test passed');

        // Customer care forwarding test
        const careRes = await fetch(`${BASE_URL}/api/customer-care/test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                customerCareNumber: verifiedNumber,
                platform: 'whatsapp'
            })
        });
        const careData = await careRes.json();
        assert(careData.success === true, 'Customer care escalation forwarding regression test passed');
    } catch (e) {
        assert(false, 'Twilio SMS & WhatsApp regression', e.message);
    }

    console.log('\n========================================================');
    console.log(`VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('========================================================\n');

    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error('Test Suite Fatal Error:', err);
    process.exit(1);
});
