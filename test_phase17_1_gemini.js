/**
 * Phase 17.1 Test Suite: Google Gemini Multimodal Image-Based Template Generation
 *
 * Verifies:
 * 1. Gemini Configuration & Security (API key stored server-side, never exposed)
 * 2. Multimodal OCR & Visual Image Understanding with gemini-3.5-flash
 * 3. Strict Image-Only Grounding & Anti-Hallucination (null on unmentioned fields, not_found confidence)
 * 4. Provenance tracking: { value, confidence, source: 'image' | 'manual' }
 * 5. Fact confirmation workflow (/confirm-fields)
 * 6. Exactly 6 Indian Regional Languages (Tamil, Telugu, Kannada, Malayalam, Hindi, Marathi)
 * 7. Authentic native scripts (Devanagari, Dravidian scripts) & 5 variations per language
 * 8. Telecom UCS-2 / GSM-7 encoding detection & segment estimation
 * 9. Schedule-Aware 4-Stage Follow-Up Sequence (Immediate, Day 3, Day 5, Day 7)
 * 10. Strict Anti-Substitution Policy & Approval Enforcement
 * 11. Campaign Console Integration
 */

const http = require('http');

const BASE_URL = 'http://127.0.0.1:3000';

function makeRequest(method, pathUrl, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathUrl, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { ...headers }
    };

    let postData = null;
    if (body) {
      postData = typeof body === 'string' ? body : JSON.stringify(body);
      options.headers['Content-Type'] = options.headers['Content-Type'] || 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, data });
        }
      });
    });

    req.on('error', err => reject(err));
    if (postData) req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log('\n======================================================================');
  console.log('PHASE 17.1 — GOOGLE GEMINI MULTIMODAL TEMPLATE GENERATOR AUDIT');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`  ✓ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${testName} - ${details}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------------------
    // TEST GROUP 1: Gemini Status & API Key Security
    // -------------------------------------------------------------------------
    console.log('--- Test Group 1: Gemini Engine Status & Security ---');
    const statusRes = await makeRequest('GET', '/api/ai-templates/gemini-status');
    assert(statusRes.status === 200, 'GET /api/ai-templates/gemini-status returns HTTP 200');
    assert(statusRes.data.configured === true, 'Gemini is configured in backend environment');
    assert(statusRes.data.model === 'gemini-3.5-flash', 'Primary model configured is gemini-3.5-flash');
    assert(!statusRes.data.apiKey && !JSON.stringify(statusRes.data).includes('AQ.Ab8RN'), 'GEMINI_API_KEY is NEVER exposed in status API response');

    // -------------------------------------------------------------------------
    // TEST GROUP 2: Multimodal Image Analysis with Grounded Extraction
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 2: Multimodal Image Analysis & Strict Grounding ---');
    const analyzePayload = {
      imageHint: 'Sony Bravia 4K Smart TV Festive Flash Deal 35% Flat Off. Valid Until: 15 Aug 2026. Care: +916369825386'
    };

    const analyzeRes = await makeRequest('POST', '/api/ai-templates/analyze-image', analyzePayload);
    assert(analyzeRes.status === 200, 'POST /api/ai-templates/analyze-image returns HTTP 200');
    assert(!!analyzeRes.data.extractedOfferData, 'Analysis returns structured extractedOfferData');

    const data = analyzeRes.data.extractedOfferData;

    // Check structured fields: { value, confidence, source }
    assert(typeof data.brandName === 'object' && 'confidence' in data.brandName, 'brandName has structured ExtractedField format');
    assert(typeof data.discount === 'object' && 'confidence' in data.discount, 'discount has structured ExtractedField format');
    assert(typeof data.couponCode === 'object' && 'confidence' in data.couponCode, 'couponCode has structured ExtractedField format');
    assert(data.brandName.source === 'image', 'brandName source is tracked as "image"');

    // Anti-Hallucination & Grounding Check: Coupon code was NOT in the poster hint
    assert(Array.isArray(data.missingFields), 'missingFields array is present in extracted data');
    assert(data.couponCode.value === null || data.couponCode.value === '', 'Unstated coupon code is null without fabrication');
    assert(data.couponCode.confidence === 'not_found', 'Unstated coupon code confidence is strictly marked "not_found"');
    assert(data.missingFields.includes('couponCode'), 'missingFields explicitly enumerates couponCode');

    // -------------------------------------------------------------------------
    // TEST GROUP 3: Multilingual Generation in Exactly 6 Regional Languages
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 3: Multilingual Generation (6 Regional Languages) ---');
    const REQUIRED_LANGUAGES = ['tamil', 'telugu', 'kannada', 'malayalam', 'hindi', 'marathi'];

    const genRes = await makeRequest('POST', '/api/ai-templates/generate', {
      sourceMediaId: null,
      extractedOfferData: data,
      languages: REQUIRED_LANGUAGES,
      channel: 'both',
      tone: 'promotional'
    });

    assert(genRes.status === 200, 'POST /api/ai-templates/generate returns HTTP 200');
    const genRecord = genRes.data.generation || genRes.data;
    const generationId = genRecord.id;
    const variants = genRecord.variants;
    assert(!!variants && Array.isArray(variants), 'Generation returns template variants array');
    assert(variants.length >= 30, `Generated ${variants.length} variations (5 variations × 6 languages)`);

    // Verify each of the 6 languages is generated
    for (const lang of REQUIRED_LANGUAGES) {
      const langVariants = variants.filter(v => v.language.toLowerCase() === lang.toLowerCase());
      assert(langVariants.length === 5, `Language "${lang}" has exactly 5 variations (primary, short, friendly, urgency, whatsapp)`);

      const primary = langVariants.find(v => v.variantType === 'primary');
      assert(!!primary && primary.messageBody.length > 10, `Language "${lang}" primary variant has substantive message body`);

      // Verify native script (Unicode characters present for Indian scripts)
      const hasNativeScript = Array.from(primary.messageBody).some(char => char.charCodeAt(0) > 127);
      assert(hasNativeScript, `Language "${lang}" uses authentic native script characters`);

      // Verify encoding and segment telemetry
      assert(primary.encoding === 'Unicode', `Language "${lang}" encoding accurately identified as Unicode (UCS-2)`);
      assert(primary.estimatedSmsSegments >= 1, `Language "${lang}" segment estimation is positive (${primary.estimatedSmsSegments} segments)`);
    }

    // -------------------------------------------------------------------------
    // TEST GROUP 4: Fact Confirmation & Manual Provenance Workflow
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 4: Confirmation Workflow & Manual Edit Tracking ---');
    // Test manual edit of a field
    const manualFields = {
      ...data,
      couponCode: { value: 'BRAVIA35', confidence: 'manual', source: 'manual' },
      isConfirmed: true
    };

    const confirmRes = await makeRequest('POST', `/api/ai-templates/${generationId}/confirm-fields`, {
      confirmedFields: manualFields
    });
    assert(confirmRes.status === 200, `POST /api/ai-templates/${generationId}/confirm-fields returns HTTP 200`);
    const confirmedGen = confirmRes.data.generation;
    assert(confirmedGen.isConfirmed === true || confirmedGen.extractedOfferData?.isConfirmed === true, 'Confirmed status persisted as true');
    assert(confirmedGen.extractedOfferData.couponCode.source === 'manual', 'Coupon code source is accurately tracked as "manual"');
    assert(confirmedGen.extractedOfferData.couponCode.confidence === 'manual', 'Coupon code confidence is marked as "manual"');

    // -------------------------------------------------------------------------
    // TEST GROUP 5: Schedule-Aware 4-Stage Follow-Up Sequence
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 5: Schedule-Aware Follow-Up Sequences ---');
    const followUpRes = await makeRequest('POST', '/api/ai-templates/generate-followups', {
      generationId: generationId,
      languages: ['tamil', 'hindi'],
      channel: 'both',
      tone: 'promotional',
      extractedOfferData: confirmedGen.extractedOfferData,
      schedule: [
        { sequenceNumber: 1, interval: '0h (Immediate)', stage: 'INITIAL' },
        { sequenceNumber: 2, interval: 'Day 3 — 11:00 AM', stage: 'REMINDER' },
        { sequenceNumber: 3, interval: 'Day 5 — 5:00 PM', stage: 'REINFORCEMENT' },
        { sequenceNumber: 4, interval: 'Day 7 — 12:00 PM', stage: 'EXPIRY' }
      ]
    });

    assert(followUpRes.status === 200, 'POST /api/ai-templates/generate-followups returns HTTP 200');
    assert(Array.isArray(followUpRes.data.followUps), 'Follow-ups returned as array');
    assert(followUpRes.data.followUps.length >= 8, `Returned ${followUpRes.data.followUps.length} follow-up stages across 2 languages`);

    // Verify stages match actual scheduler intervals
    const stages = ['INITIAL', 'REMINDER', 'REINFORCEMENT', 'EXPIRY'];
    for (const stage of stages) {
      const match = followUpRes.data.followUps.find(f => f.stage === stage && f.language === 'tamil');
      assert(!!match, `Follow-up stage "${stage}" generated for Tamil`);
      assert(!!match.scheduledInterval, `Stage "${stage}" has scheduled interval: ${match?.scheduledInterval}`);
    }

    // -------------------------------------------------------------------------
    // TEST GROUP 6: Strict Anti-Substitution & Language Approval
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 6: Strict Anti-Substitution Policy ---');
    const tamilVariants = variants.filter(v => v.language.toLowerCase() === 'tamil');

    // Initially unapproved
    assert(tamilVariants[0].approvalStatus === 'PENDING', 'Generated variant initially in PENDING status');

    // Approve Tamil
    const approveRes = await makeRequest('POST', `/api/ai-templates/${generationId}/approve`, {
      variantId: tamilVariants[0].id
    });
    assert(approveRes.status === 200, 'POST /api/ai-templates/:id/approve returns HTTP 200');
    assert(approveRes.data.success === true, 'Approval response returned success: true');
    const approvedVar = approveRes.data.variants?.find(v => v.id === tamilVariants[0].id);
    assert(approvedVar?.approvalStatus === 'APPROVED', 'Tamil variant marked APPROVED');

    // -------------------------------------------------------------------------
    // TEST GROUP 7: Campaign Console Adoption
    // -------------------------------------------------------------------------
    console.log('\n--- Test Group 7: Campaign Console Adoption ---');
    const campaignRes = await makeRequest('POST', `/api/ai-templates/${generationId}/use-in-campaign`, {
      variantId: tamilVariants[0].id,
      campaignName: 'Sony Bravia Tamil Festive Blitz',
      validUntil: '15 Aug 2026'
    });

    assert(campaignRes.status === 200, 'POST /api/ai-templates/:id/use-in-campaign returns HTTP 200');
    assert(campaignRes.data.success === true, 'Campaign successfully enqueued');
    assert(!!campaignRes.data.campaignId, `Campaign ID created: ${campaignRes.data.campaignId}`);

    console.log('\n======================================================================');
    console.log(`PHASE 17.1 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('======================================================================\n');

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Fatal test error:', err);
    process.exit(1);
  }
}

runTests();
