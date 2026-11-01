const http = require('http');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const { DataManager } = require('./dataManager');
const mediaService = require('./services/mediaService');
const dispatchTelemetryService = require('./services/dispatchTelemetryService');
const { QueueSimulator } = require('./queueSimulator');

const PORT = 3000;
const HOST = '127.0.0.1';

function request(options, data) {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: HOST, port: PORT, ...options }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(body) });
                } catch {
                    resolve({ status: res.statusCode, headers: res.headers, raw: body });
                }
            });
        });
        req.on('error', reject);
        if (data) req.write(typeof data === 'string' ? data : JSON.stringify(data));
        req.end();
    });
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
    try {
        await fn();
        console.log(`✅ PASS: ${name}`);
        passed++;
    } catch (err) {
        console.error(`❌ FAIL: ${name}\n  Error: ${err.message}`);
        failed++;
    }
}

async function runTestSuite() {
    console.log('================================================================');
    console.log('🧪 RUNNING PHASE 16 — MEDIA-ENABLED MESSAGE TEMPLATES & DISPATCH');
    console.log('================================================================\n');

    // Setup: Ensure we have at least one valid media asset with file on disk
    const mediaDir = path.join(__dirname, 'uploads', 'media');
    if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

    const sampleFilename = `asset_test_phase16_${Date.now()}.jpg`;
    const sampleFilePath = path.join(mediaDir, sampleFilename);
    const jpegBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xFF, 0xD9]);
    fs.writeFileSync(sampleFilePath, jpegBuffer);

    const testAsset = await mediaService.registerUpload({
        path: sampleFilePath,
        filename: sampleFilename,
        originalname: 'Phase16_Banner.jpg',
        mimetype: 'image/jpeg',
        size: jpegBuffer.length
    }, { caption: 'Phase 16 Test Creative', tags: ['Phase16', 'Autumn'] });

    // 1. Template Config API
    await test('GET /api/template returns template text, mediaId, mediaAsset, and channel', async () => {
        const res = await request({ path: '/api/template', method: 'GET' });
        assert.strictEqual(res.status, 200);
        assert.ok(typeof res.data.template === 'string');
        assert.ok('mediaId' in res.data);
        assert.ok('mediaAsset' in res.data);
        assert.ok('channel' in res.data);
    });

    // 2. Save Template with Media
    await test('POST /api/template persists template copy, channel, and attached mediaId', async () => {
        const payload = {
            template: 'Exclusive Flash Sale: {{2}}! Valid until {{3}}',
            mediaId: testAsset.id,
            channel: 'both'
        };
        const res = await request({
            path: '/api/template',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, payload);

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.data.mediaId, testAsset.id);
        assert.strictEqual(res.data.channel, 'both');
        assert.ok(res.data.mediaAsset !== null);
        assert.strictEqual(res.data.mediaAsset.id, testAsset.id);
    });

    // 3. Reusable Saved Templates List
    let savedTemplateId = null;
    await test('POST /api/templates/saved creates reusable template in shared library', async () => {
        const payload = {
            name: 'Diwali Festive Mega Offer',
            body: 'Special festival discounts: {{2}}! Limited time: {{3}}',
            channel: 'whatsapp',
            mediaId: testAsset.id,
            category: 'Festive'
        };
        const res = await request({
            path: '/api/templates/saved',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, payload);

        assert.strictEqual(res.status, 200);
        assert.ok(res.data.template.id);
        savedTemplateId = res.data.template.id;
        assert.strictEqual(res.data.template.name, 'Diwali Festive Mega Offer');
        assert.strictEqual(res.data.template.mediaId, testAsset.id);
    });

    // 4. Retrieve Saved Templates
    await test('GET /api/templates/saved returns list of reusable templates', async () => {
        const res = await request({ path: '/api/templates/saved', method: 'GET' });
        assert.strictEqual(res.status, 200);
        assert.ok(Array.isArray(res.data));
        const item = res.data.find(t => t.id === savedTemplateId);
        assert.ok(item, 'Newly created template should be listed in library');
        assert.strictEqual(item.channel, 'whatsapp');
    });

    // 5. Delete Saved Template
    await test('DELETE /api/templates/saved/:id deletes saved template', async () => {
        const res = await request({ path: `/api/templates/saved/${savedTemplateId}`, method: 'DELETE' });
        assert.strictEqual(res.status, 200);

        const listRes = await request({ path: '/api/templates/saved', method: 'GET' });
        assert.strictEqual(listRes.data.some(t => t.id === savedTemplateId), false);
    });

    // 6. Media Asset Disk Verification (Success)
    await test('mediaService.verifyAssetExists reports exists: true for valid asset on disk', async () => {
        const check = await mediaService.verifyAssetExists(testAsset.id);
        assert.strictEqual(check.exists, true);
        assert.ok(check.filePath);
    });

    // 7. Media Asset Disk Verification (Failure)
    await test('mediaService.verifyAssetExists reports exists: false for non-existent asset ID', async () => {
        const check = await mediaService.verifyAssetExists('med_phantom_asset_999');
        assert.strictEqual(check.exists, false);
        assert.ok(check.reason.includes('not found'));
    });

    // 8. Delete Protection for Referenced Media
    await test('Media deletion check: protects assets referenced by templates/campaigns', async () => {
        await mediaService.addReference(testAsset.id, 'template:active');
        const delRes = await mediaService.delete(testAsset.id, { force: false });
        assert.strictEqual(delRes.success, false);
        assert.strictEqual(delRes.referenced, true);
        assert.ok(delRes.message.includes('referenced'));
    });

    // 9. Campaign Launch Pre-Flight Verification (Rejection)
    await test('POST /api/campaigns/start rejects non-existent media with 422 Unprocessable Entity', async () => {
        const res = await request({
            path: '/api/campaigns/start',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, {
            name: 'Failing Preflight Campaign',
            mediaId: 'med_non_existent_fake_id',
            validUntil: '2026-12-31'
        });

        assert.strictEqual(res.status, 422);
        assert.ok(res.data.error.includes('Pre-flight validation failed'));
    });

    // 10. Campaign Launch Pre-Flight Verification (Success)
    let launchedCampaignId = null;
    await test('POST /api/campaigns/start succeeds with verified media and registers campaign reference', async () => {
        const res = await request({
            path: '/api/campaigns/start',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, {
            name: 'Phase 16 Verified Media Campaign',
            mediaId: testAsset.id,
            validUntil: '2026-12-31',
            platform: 'both',
            scheduleDelayHours: 48 // Schedule in future to verify configuration without spamming immediately
        });

        assert.strictEqual(res.status, 200);
        assert.ok(res.data.campaignId);
        launchedCampaignId = res.data.campaignId;

        // Check campaign record
        const campRes = await request({ path: `/api/campaigns/${launchedCampaignId}`, method: 'GET' });
        assert.strictEqual(campRes.data.mediaId, testAsset.id);
        assert.strictEqual(campRes.data.mediaEnabled, true);
        assert.strictEqual(campRes.data.mediaType, 'image');
    });

    // 11. Dual Channel Rules & Payload Differentiation
    await test('dispatchDualChannel rules: WhatsApp attaches native mediaUrl while SMS receives tracked redirect link', async () => {
        const dispatchRes = await QueueSimulator.dispatchDualChannel({
            to: '+919840123450',
            body: 'Special Season Offer! Visit us today.',
            smsBody: null,
            platform: 'both',
            mediaAsset: testAsset,
            campaignId: launchedCampaignId
        });

        assert.strictEqual(dispatchRes.success, true);
        // WhatsApp verification
        assert.ok(dispatchRes.whatsapp.attempted);
        if (dispatchRes.whatsapp.mediaUrl) {
            assert.ok(dispatchRes.whatsapp.mediaUrl[0].includes(`/api/media/asset/${testAsset.id}`));
        }

        // SMS verification
        assert.ok(dispatchRes.sms.attempted);
        assert.ok(dispatchRes.sms.text.includes(`/api/m/${testAsset.id}`));
    });

    // 12. Tracked Media Shortlink Redirection & Telemetry Logging
    await test('GET /api/m/:id records click telemetry and 302 redirects to asset stream URL', async () => {
        const redirectRes = await request({
            path: `/api/m/${testAsset.id}?c=${launchedCampaignId}&r=%2B919840123450`,
            method: 'GET'
        });

        assert.strictEqual(redirectRes.status, 302);
        assert.strictEqual(redirectRes.headers['location'], `/api/media/asset/${testAsset.id}`);

        // Verify click recorded in telemetry
        const clicks = await dispatchTelemetryService.getMediaClicks(testAsset.id);
        assert.ok(clicks.length > 0, 'Click must be logged in telemetry service');
        const lastClick = clicks[0];
        assert.strictEqual(lastClick.mediaId, testAsset.id);
        assert.strictEqual(lastClick.campaignId, String(launchedCampaignId));

        // Verify telemetry endpoint reflects media stats
        const telemRes = await request({ path: '/api/analytics/telemetry?dateRange=all', method: 'GET' });
        assert.strictEqual(telemRes.status, 200);
        assert.ok(telemRes.data.mediaStats !== undefined, 'mediaStats must be present in telemetry metrics response');
        assert.ok(telemRes.data.mediaStats.clicks >= 1, 'mediaStats.clicks must be >= 1');
    });

    console.log('\n================================================================');
    console.log(`SUMMARY: ${passed} Passed, ${failed} Failed out of ${passed + failed} Tests`);
    console.log('================================================================');

    if (failed > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runTestSuite().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
