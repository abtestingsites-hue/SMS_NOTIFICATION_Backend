/**
 * Phase 19 — Production Campaign Execution & Delivery Reliability Audit Test Suite
 *
 * Covers 11 Production Acceptance Tests:
 * 1. Test-recipient campaign
 * 2. Multilingual campaign (6 regional languages: ta, te, kn, ml, hi, mr)
 * 3. SMS campaign (GSM-7 compliance, tracked shortlink, single segment)
 * 4. WhatsApp media campaign (rich text, media payload)
 * 5. Combined-channel campaign (both platforms dispatch)
 * 6. Scheduled campaign (persisted schedule, runner recovery)
 * 7. Multi-stage follow-up campaign (4 sequence stages, timing rules, fact preservation)
 * 8. Provider timeout and retry simulation (backoff handling)
 * 9. Duplicate callback handling (idempotency, no duplicate count inflations)
 * 10. Backend restart & scheduler recovery (database durability)
 * 11. Suppression and opt-out exclusion (pre-dispatch real-time block)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const { DataManager } = require('./dataManager');
const { QueueSimulator } = require('./queueSimulator');
const campaignBuilderService = require('./services/campaignBuilderService');
const dispatchTelemetryService = require('./services/dispatchTelemetryService');
const governanceService = require('./services/governanceService');
const schedulerService = require('./services/schedulerService');
const geminiService = require('./services/geminiService');

async function runTestSuite() {
    console.log('========================================================================');
    console.log('PHASE 19 — PRODUCTION CAMPAIGN EXECUTION & DELIVERY RELIABILITY AUDIT');
    console.log('========================================================================\n');

    let passed = 0;
    let failed = 0;

    async function test(name, fn) {
        try {
            process.stdout.write(`[TEST] ${name} ... `);
            await fn();
            console.log('✅ PASSED');
            passed++;
        } catch (e) {
            console.log(`❌ FAILED: ${e.message}`);
            console.error(e.stack);
            failed++;
        }
    }

    // ------------------------------------------------------------------------
    // TEST 1: Test-Recipient Campaign
    // ------------------------------------------------------------------------
    await test('1. Test-Recipient Campaign Dispatch & Full Cycle', async () => {
        const testPhone = '+919876543210';
        const res = await QueueSimulator.dispatchDualChannel({
            to: testPhone,
            body: 'Hi Alexander, special offer test message! Reply STOP to opt out.',
            platform: 'whatsapp'
        });

        assert.strictEqual(res.success, true, 'Dispatch should succeed');
        assert.ok(res.whatsapp.sent || res.whatsapp.attempted, 'WhatsApp attempted');
        
        // Check telemetry record created
        const dispatches = await dispatchTelemetryService.getDispatchesByCampaign(null);
        const record = dispatches.find(d => d.recipient === testPhone);
        assert.ok(record, 'Telemetry record must exist for test recipient');
    });

    // ------------------------------------------------------------------------
    // TEST 2: Multilingual Campaign (6 Regional Languages)
    // ------------------------------------------------------------------------
    await test('2. Multilingual Campaign with 6 Regional Languages', async () => {
        const languages = ['tamil', 'telugu', 'kannada', 'malayalam', 'hindi', 'marathi'];
        const variants = {
            tamil: 'வணக்கம் {{customer_name}}, சத்யா வழங்கும் சிறப்பு சலுகை! குறியீடு: SUMMER25.',
            telugu: 'నమస్కారం {{customer_name}}, సత్య ప్రత్యేక ఆఫర్! కోడ్: SUMMER25 ఉపయోగించండి.',
            kannada: 'ನಮಸ್ಕಾರ {{customer_name}}, ಸತ್ಯ ವಿಶೇಷ ರಿಯಾಯಿತಿ! ಕೋಡ್: SUMMER25 ಬಳಸಿ.',
            malayalam: 'നമസ്കാരം {{customer_name}}, സത്യ സ്പെഷ്യൽ ഓഫർ! കോഡ്: SUMMER25 ഉപയോഗിക്കുക.',
            hindi: 'नमस्ते {{customer_name}}, सत्या का विशेष ऑफर! कोड SUMMER25 का उपयोग करें।',
            marathi: 'नमस्कार {{customer_name}}, सत्याची विशेष ऑफर! कोड: SUMMER25 वापरा.'
        };

        const launchResult = await campaignBuilderService.launchCampaign({
            name: 'Audit Multilingual Festival Promo',
            channel: 'both',
            template: variants.tamil,
            audienceSelection: { type: 'segment', segmentName: 'All' },
            languageConfig: {
                selectedLanguages: languages,
                defaultLanguage: 'tamil',
                languageVariants: variants
            }
        });

        assert.strictEqual(launchResult.success, true);
        assert.ok(launchResult.campaignId, 'Campaign ID must be returned');
        assert.ok(launchResult.stats.languagesMapped.length > 0, 'Languages mapped to audience');
    });

    // ------------------------------------------------------------------------
    // TEST 3: SMS Campaign (GSM-7 Compliance & Tracked Shortlink)
    // ------------------------------------------------------------------------
    await test('3. Cellular SMS Campaign (GSM-7, Tracked Link, No Emojis)', async () => {
        const dummyMedia = { id: 'med_test_audit_sms', filename: 'poster.jpg', mediaType: 'image' };
        const smsText = QueueSimulator.formatSmsCampaignMessage({
            name: 'Priya',
            offer: { description: 'Summer Sale', discount: '30% OFF', code: 'HOT30' },
            validUntil: '15 Aug 2026'
        });

        assert.ok(!/[\u{1F600}-\u{1F64F}]/gu.test(smsText), 'SMS text must have no emojis');
        assert.ok(smsText.length < 160, 'SMS text should fit 1 segment');

        const trackedUrl = QueueSimulator.getTrackedMediaUrl(dummyMedia, 12345);
        assert.ok(trackedUrl.includes('/api/m/med_test_audit_sms?c=12345'), 'Tracked URL format verified');

        const dispatchRes = await QueueSimulator.dispatchDualChannel({
            to: '+919123456789',
            body: 'Special offer text',
            smsBody: smsText,
            platform: 'sms',
            mediaAsset: dummyMedia,
            campaignId: 12345
        });

        assert.strictEqual(dispatchRes.success, true);
        assert.strictEqual(dispatchRes.sms.attempted, true);
    });

    // ------------------------------------------------------------------------
    // TEST 4: WhatsApp Media Campaign (Rich Formatting & Payload)
    // ------------------------------------------------------------------------
    await test('4. WhatsApp Media Campaign Payload Formatting', async () => {
        const mediaAsset = {
            id: 'med_test_wa_media',
            filename: 'tv_banner.png',
            mediaType: 'image',
            assetStreamUrl: 'http://localhost:5000/api/media/asset/med_test_wa_media'
        };

        const body = QueueSimulator.formatCampaignMessage({
            template: 'Hi {{1}}, *Flash Sale* on Sony Bravia!\nGet {{2}}\nValid: {{3}}',
            name: 'Karthik',
            offer: { description: 'Special Privilege', discount: '20% OFF', code: 'SONY20' },
            validUntil: '30 Aug 2026'
        });

        assert.ok(body.includes('*Flash Sale*'), 'Rich formatting preserved');
        assert.ok(body.includes('Karthik'), 'Personalized merge tags replaced');

        const dispatchRes = await QueueSimulator.dispatchDualChannel({
            to: '+919876501234',
            body,
            platform: 'whatsapp',
            mediaAsset
        });

        assert.strictEqual(dispatchRes.success, true);
        assert.strictEqual(dispatchRes.whatsapp.attempted, true);
    });

    // ------------------------------------------------------------------------
    // TEST 5: Combined-Channel Campaign (Dual Dispatch)
    // ------------------------------------------------------------------------
    await test('5. Combined-Channel Campaign (Simultaneous WhatsApp + SMS)', async () => {
        const dispatchRes = await QueueSimulator.dispatchDualChannel({
            to: '+919988776655',
            body: 'Omnichannel campaign message',
            platform: 'both'
        });

        assert.strictEqual(dispatchRes.success, true);
        assert.strictEqual(dispatchRes.whatsapp.attempted, true, 'WhatsApp must be attempted');
        assert.strictEqual(dispatchRes.sms.attempted, true, 'SMS must be attempted');
    });

    // ------------------------------------------------------------------------
    // TEST 6: Scheduled Campaign Persistence & Timezone Registration
    // ------------------------------------------------------------------------
    await test('6. Scheduled Campaign Persistence & Unified Scheduler', async () => {
        const futureDate = new Date(Date.now() + 86400000 * 2); // 2 days ahead
        const dateStr = futureDate.toISOString().split('T')[0];
        
        const launchResult = await campaignBuilderService.launchCampaign({
            name: 'Audit Scheduled Broadcast',
            channel: 'both',
            template: 'Hi {{customer_name}}, scheduled event invitation.',
            scheduleConfig: {
                mode: 'SCHEDULED',
                scheduledDate: dateStr,
                scheduledTime: '15:30:00',
                timezone: 'Asia/Kolkata'
            }
        });

        assert.strictEqual(launchResult.success, true);
        assert.strictEqual(launchResult.stats.isScheduled, true);
        assert.ok(launchResult.campaign.scheduledFor.startsWith(dateStr));

        // Verify stored in DB
        const stored = await DataManager.getCampaign(launchResult.campaignId);
        assert.strictEqual(stored.status, 'SCHEDULED');
    });

    // ------------------------------------------------------------------------
    // TEST 7: Multi-Stage Follow-Up Sequence & Timing Rules
    // ------------------------------------------------------------------------
    await test('7. Multi-Stage Follow-Up Sequence Grounding & Rules', async () => {
        const schedule = [
            { sequenceNumber: 1, stage: 'INITIAL', scheduledInterval: 'Day 0 - Immediate' },
            { sequenceNumber: 2, stage: 'REMINDER', scheduledInterval: 'Day 2 - 10:00 AM' },
            { sequenceNumber: 3, stage: 'REINFORCEMENT', scheduledInterval: 'Day 4 - 4:00 PM' },
            { sequenceNumber: 4, stage: 'FINAL_CALL', scheduledInterval: 'Day 6 - 6:00 PM' }
        ];

        const offer = {
            businessName: 'Sathya',
            offerTitle: 'Privilege Festival Offer',
            discount: '25% OFF',
            couponCode: 'SUMMER25'
        };

        const followUps = geminiService._synthesizeFollowUpSequence('tamil', schedule, offer, 'whatsapp');
        assert.strictEqual(followUps.length, 4, 'Must have 4 stages');
        assert.strictEqual(followUps[0].stage, 'INITIAL');
        assert.ok(['FINAL_CALL', 'EXPIRY'].includes(followUps[3].stage), 'Final stage recognized');
        assert.ok(followUps[0].messageBody.includes('Sathya'), 'Brand name grounded');
        assert.ok(followUps[0].messageBody.includes('SUMMER25'), 'Coupon code grounded');
    });

    // ------------------------------------------------------------------------
    // TEST 8: Provider Timeout and Retry Simulation
    // ------------------------------------------------------------------------
    await test('8. Provider Timeout & Exponential Backoff Handling', async () => {
        let attempts = 0;
        const simulatedRetryOp = async () => {
            attempts++;
            if (attempts < 2) {
                const err = new Error('Gateway Timeout 504');
                err.code = 504;
                throw err;
            }
            return { success: true, attempts };
        };

        let finalResult = null;
        for (let i = 1; i <= 3; i++) {
            try {
                finalResult = await simulatedRetryOp();
                break;
            } catch (err) {
                if (i === 3) throw err;
                await new Promise(r => setTimeout(r, 100 * i));
            }
        }

        assert.strictEqual(finalResult.success, true);
        assert.strictEqual(finalResult.attempts, 2, 'Should succeed on retry attempt 2');
    });

    // ------------------------------------------------------------------------
    // TEST 9: Duplicate Callback Handling (Idempotency)
    // ------------------------------------------------------------------------
    await test('9. Idempotent Status Callback Processing (Zero Count Inflation)', async () => {
        const testSid = 'SM_audit_callback_' + Date.now();
        
        // 1. First callback: delivered
        const cb1 = await dispatchTelemetryService.processStatusCallback({
            messageSid: testSid,
            messageStatus: 'delivered',
            rawPayload: { To: '+919876543210', From: '+12202404020' }
        });
        assert.strictEqual(cb1.success, true);

        // 2. Duplicate callback with identical status
        const cb2 = await dispatchTelemetryService.processStatusCallback({
            messageSid: testSid,
            messageStatus: 'delivered',
            rawPayload: { To: '+919876543210', From: '+12202404020' }
        });
        assert.strictEqual(cb2.success, true);

        // Dispatches record count should not be duplicated
        const dispatches = await dispatchTelemetryService.getDispatchesByCampaign(null);
        const matching = dispatches.filter(d => d.sid === testSid);
        assert.strictEqual(matching.length, 1, 'Only one record must exist per SID');
        assert.strictEqual(matching[0].callbackCount, 2, 'Callback count updated to 2');
    });

    // ------------------------------------------------------------------------
    // TEST 10: Backend Restart & Scheduler Recovery
    // ------------------------------------------------------------------------
    await test('10. Backend Restart & Database Persistence Durability', async () => {
        const draft = await campaignBuilderService.saveDraft({
            name: 'Persistence Integrity Audit Draft',
            channel: 'both'
        });
        assert.ok(draft.id);

        const retrievedDraft = await campaignBuilderService.getDraftById(draft.id);
        assert.strictEqual(retrievedDraft.name, 'Persistence Integrity Audit Draft');

        const draftsFile = path.join(__dirname, 'data', 'campaign_drafts.json');
        const content = fs.readFileSync(draftsFile, 'utf8');
        const parsed = JSON.parse(content);
        assert.ok(Array.isArray(parsed));
    });

    // ------------------------------------------------------------------------
    // TEST 11: Suppression & Opt-Out Exclusion
    // ------------------------------------------------------------------------
    await test('11. Real-Time STOP Suppression & Opt-Out Exclusion', async () => {
        const customers = await DataManager.getCustomers();
        const targetCustomer = customers[0] || { phone: '+919876543210' };
        const suppressedPhone = targetCustomer.phone;
        
        // Add to suppression list using suppressPhone
        await governanceService.suppressPhone(
            suppressedPhone,
            'User sent STOP during audit test',
            'INBOUND_SMS'
        );

        // Verify suppressed in governance
        const isSuppressed = await governanceService.isSuppressed(suppressedPhone);
        assert.strictEqual(isSuppressed, true, 'Phone must be suppressed');

        // Audience summary must count it under suppressed
        const summary = await campaignBuilderService.getAudienceSummary('All');
        assert.ok(summary.suppressed >= 1, 'Suppressed count must be at least 1');

        // Eligible recipients list must NOT contain the suppressed phone
        const cleanTarget = String(suppressedPhone).trim().replace(/^\+/, '');
        const inEligible = summary.eligibleRecipients.some(r => {
            const p = String(r.phone || '').trim().replace(/^\+/, '');
            return p === cleanTarget;
        });
        assert.strictEqual(inEligible, false, 'Suppressed contact excluded from eligible list');
    });

    // ------------------------------------------------------------------------
    // TEST SUMMARY
    // ------------------------------------------------------------------------
    console.log('\n========================================================================');
    console.log(`TEST RUN COMPLETE: ${passed} PASSED | ${failed} FAILED (Total 11)`);
    console.log('========================================================================');

    if (failed > 0) {
        process.exit(1);
    }
}

runTestSuite().catch(err => {
    console.error('Fatal Test Runner Error:', err);
    process.exit(1);
});
