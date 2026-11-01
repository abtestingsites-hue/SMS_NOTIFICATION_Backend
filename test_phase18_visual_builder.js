/**
 * Phase 18 — Visual Campaign Builder & Bulk Campaign Launch Automated Test Suite
 * Validates:
 * 1. Visual Campaign Drafts CRUD API
 * 2. Dynamic Audience Resolution & Language Breakdown
 * 3. Bulk Campaign Launch Execution & Telephony Queue Integration
 * 4. Grounded Language Mapping & Suppression Compliance
 */

const assert = require('assert');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const API_BASE = process.env.API_BASE || 'http://localhost:5000';

async function runTestSuite() {
    console.log('================================================================');
    console.log('🚀 PHASE 18: VISUAL CAMPAIGN BUILDER & BULK LAUNCH TEST SUITE');
    console.log('================================================================\n');

    let passed = 0;
    let failed = 0;

    const test = async (name, fn) => {
        try {
            process.stdout.write(`• Testing: ${name}... `);
            await fn();
            console.log('✅ PASSED');
            passed++;
        } catch (err) {
            console.log(`❌ FAILED: ${err.message}`);
            failed++;
        }
    };

    // 1. Audience Summary API
    await test('GET /api/campaign-builder/audience-summary calculates counts & language breakdown', async () => {
        const res = await fetch(`${API_BASE}/api/campaign-builder/audience-summary?segment=All`);
        assert.strictEqual(res.status, 200, `Expected HTTP 200, got ${res.status}`);
        const data = await res.json();
        assert(typeof data.totalSelected === 'number', 'totalSelected should be a number');
        assert(typeof data.smsEligible === 'number', 'smsEligible should be a number');
        assert(typeof data.whatsappEligible === 'number', 'whatsappEligible should be a number');
        assert(typeof data.suppressed === 'number', 'suppressed should be a number');
        assert(typeof data.optedOut === 'number', 'optedOut should be a number');
        assert(data.languageBreakdown && typeof data.languageBreakdown === 'object', 'languageBreakdown should be object');
        console.log(`\n  [Summary: Total=${data.totalSelected}, SMS=${data.smsEligible}, WA=${data.whatsappEligible}, Suppressed=${data.suppressed}]`);
    });

    // 2. Draft Save & Retrieval API
    let createdDraftId = `draft_test_${Date.now()}`;
    await test('POST /api/campaign-builder/drafts saves draft to durable storage', async () => {
        const testDraft = {
            id: createdDraftId,
            name: 'Diwali Electronics Mega Carnival 2026',
            channel: 'both',
            status: 'DRAFT',
            contentBlocks: [
                { id: 'b_1', type: 'headline', label: 'Headline', content: '🎉 Mega Diwali Flash Sale Announced!', order: 1 },
                { id: 'b_2', type: 'description', label: 'Body', content: 'Huge discounts on smart televisions and kitchen appliances.', order: 2 },
                { id: 'b_3', type: 'coupon', label: 'Coupon', content: '🏷️ Code: DIWALI50', order: 3 },
                { id: 'b_4', type: 'optout', label: 'Opt-out', content: 'Reply STOP to unsubscribe.', order: 4 }
            ],
            offerId: 1,
            audienceSelection: { segmentName: 'All', type: 'all' },
            languageConfig: {
                selectedLanguages: ['ta', 'te', 'kn', 'ml', 'hi', 'mr'],
                defaultLanguage: 'ta',
                languageVariants: {
                    ta: 'வணக்கம்! சத்யா தீபாவளி மெகா ஆஃபர்! கோட்: DIWALI50. பெற உடனே வருக.',
                    hi: 'नमस्ते! सत्य दिवाली महा सेल! कोड: DIWALI50. आज ही विज़िट करें।'
                },
                languageApprovals: { ta: true, te: true, kn: true, ml: true, hi: true, mr: true }
            },
            scheduleConfig: {
                mode: 'NOW',
                scheduledDate: '2026-11-02',
                scheduledTime: '11:00',
                timezone: 'Asia/Kolkata (IST - UTC+5:30)',
                followUps: [
                    {
                        id: 'fu_1',
                        stage: 'REMINDER',
                        sequenceNumber: 1,
                        scheduledInterval: 'Day 3 - 11:00 AM',
                        messageBody: 'Reminder: Use your code DIWALI50 before offer expires!',
                        channel: 'both',
                        language: 'en',
                        eligibilityRule: 'ALL_ELIGIBLE',
                        approvalStatus: 'APPROVED'
                    }
                ]
            }
        };

        const res = await fetch(`${API_BASE}/api/campaign-builder/drafts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testDraft)
        });
        assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.draft.id, createdDraftId);
        assert.strictEqual(data.draft.name, 'Diwali Electronics Mega Carnival 2026');
    });

    // 3. Draft List & Detail Retrieval
    await test('GET /api/campaign-builder/drafts lists all drafts including new draft', async () => {
        const res = await fetch(`${API_BASE}/api/campaign-builder/drafts`);
        assert.strictEqual(res.status, 200);
        const drafts = await res.json();
        assert(Array.isArray(drafts), 'Expected array of drafts');
        const found = drafts.find(d => d.id === createdDraftId);
        assert(found, `Draft ${createdDraftId} not found in drafts list`);
    });

    await test('GET /api/campaign-builder/drafts/:id fetches specific draft', async () => {
        const res = await fetch(`${API_BASE}/api/campaign-builder/drafts/${createdDraftId}`);
        assert.strictEqual(res.status, 200);
        const draft = await res.json();
        assert.strictEqual(draft.id, createdDraftId);
        assert.strictEqual(draft.contentBlocks.length, 4);
    });

    // 4. Bulk Campaign Launch API
    await test('POST /api/campaign-builder/launch executes bulk campaign with language routing', async () => {
        const launchPayload = {
            name: 'Test Bulk Dispatch Phase 18',
            channel: 'both',
            contentBlocks: [
                { id: 'b1', type: 'headline', label: 'Headline', content: 'Special Festive Offer', order: 1 },
                { id: 'b2', type: 'optout', label: 'Opt-out', content: 'Reply STOP to opt out.', order: 2 }
            ],
            fullMessage: 'Hi {{customer_name}}, enjoy Special Privilege! Reply STOP to opt out.',
            targetSegment: 'All',
            selectedLanguages: ['ta', 'te', 'kn', 'ml', 'hi', 'mr'],
            defaultLanguage: 'ta',
            languageVariants: {
                ta: 'வணக்கம் {{customer_name}}, சத்யா சிறப்பு சலுகை! Stop என பதிலளிக்கவும்.',
                kn: 'ನಮಸ್ಕಾರ {{customer_name}}, ಸತ್ಯ ವಿಶೇಷ ರಿಯಾಯಿತಿ! Stop ಎಂದು ಉತ್ತರಿಸಿ.'
            },
            languageApprovals: { ta: true, te: true, kn: true, ml: true, hi: true, mr: true },
            scheduleMode: 'NOW',
            followUps: []
        };

        const res = await fetch(`${API_BASE}/api/campaign-builder/launch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(launchPayload)
        });

        assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
        const result = await res.json();
        assert.strictEqual(result.success, true);
        assert(result.campaignId, 'Should return campaignId');
        assert(result.stats, 'Should return dispatch stats');
        console.log(`\n  [Campaign #${result.campaignId} launched: Dispatched=${result.stats.totalDispatched}, Languages=${JSON.stringify(result.stats.byLanguage)}]`);
    });

    // 5. Delete Draft API
    await test('DELETE /api/campaign-builder/drafts/:id removes draft from storage', async () => {
        const res = await fetch(`${API_BASE}/api/campaign-builder/drafts/${createdDraftId}`, {
            method: 'DELETE'
        });
        assert.strictEqual(res.status, 200);
        const result = await res.json();
        assert.strictEqual(result.success, true);

        // Verify it no longer exists
        const checkRes = await fetch(`${API_BASE}/api/campaign-builder/drafts/${createdDraftId}`);
        assert.strictEqual(checkRes.status, 404);
    });

    console.log('\n================================================================');
    console.log(`📊 TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
    console.log('================================================================\n');

    if (failed > 0) process.exit(1);
}

runTestSuite();
