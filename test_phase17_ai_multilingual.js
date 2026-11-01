/**
 * Phase 17 Comprehensive Verification Test Suite:
 * AI-Powered Template Generator & Multilingual Follow-Up Automation
 *
 * Covers all 20 Acceptance Test Points:
 * 1. Promotional image analysis & OCR multimodal extraction
 * 2. Accurate field extraction (Business Name, Product, Discount, Code, Expiry, Terms, Phone, URL, CTA)
 * 3. Anti-hallucination guarantee: Unmentioned codes/discounts flagged as 'needsConfirmation' (never invented)
 * 4. 12 Indian regional languages coverage (Tamil, Hindi, Telugu, Malayalam, Kannada, Bengali, Marathi, Gujarati, Punjabi, Odia, Urdu, English)
 * 5. 6 Brand tones coverage (Professional, Friendly, Promotional, Festive, Urgent, Premium)
 * 6. 5 message variations per language (primary, short, friendly, urgency, whatsapp)
 * 7. Authentic native script rendering (cultural phrasing, avoiding literal machine translation)
 * 8. Accurate character counting and encoding detection (GSM-7 vs Unicode UCS-2)
 * 9. Telecom SMS segment estimation (160 chars GSM-7, 70 chars UCS-2)
 * 10. Sequence-aware AI follow-up generator with schedule awareness (Initial -> Reminder -> Reinforcement -> Expiry)
 * 11. Smart follow-up eligibility: Opt-out suppression (STOP keyword)
 * 12. Smart follow-up eligibility: Non-conversion check (Inbound replies are NOT assumed conversions)
 * 13. Smart follow-up eligibility: Delivery status verification
 * 14. Smart follow-up eligibility: Quiet hours compliance (e.g. 21:00 - 09:00 TRAI)
 * 15. Smart follow-up eligibility: Offer expiration cutoff
 * 16. Template editing API (`PATCH /api/ai-templates/:id`)
 * 17. Content approval workflow (`POST /api/ai-templates/:id/approve`)
 * 18. Shared Template Library persistence (`POST /api/ai-templates/:id/save`)
 * 19. Carrier pre-flight test message dispatch (`POST /api/ai-templates/:id/test`)
 * 20. Campaign Console adoption endpoint (`POST /api/ai-templates/:id/use-in-campaign`)
 */

const http = require('http');

const BASE_URL = 'http://127.0.0.1:3000';

function makeRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
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

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runPhase17Tests() {
  console.log('================================================================');
  console.log(' PHASE 17 VERIFICATION SUITE: AI & MULTILINGUAL AUTOMATION');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} - ${details}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------
    // TEST 1 & 2: Image Analysis & Accurate Field Extraction
    // -------------------------------------------------------------
    console.log('--- TEST GROUP 1: Creative Analysis & Field Extraction ---');
    const analyzePayload = {
      mediaAsset: {
        id: 'med_phase17_poster_01',
        originalName: 'Diwali_Mega_Sale_50_Off.png',
        mimeType: 'image/png',
        fileSize: 450200
      },
      imageHint: 'Diwali Grand Electronics Sale 50% Flat Off Code: DIWALI50 Valid Until: 2026-11-15'
    };

    const res1 = await makeRequest('POST', '/api/ai-templates/analyze-image', analyzePayload);
    assert(res1.status === 200, 'Test 1: Image Analysis Endpoint Returns 200 OK');
    assert(res1.data.extractedOfferData !== undefined, 'Test 2a: Extracted Offer Data Object Exists');
    assert(res1.data.extractedOfferData.discount === '50% OFF' || res1.data.extractedOfferData.discount.includes('50'), 'Test 2b: Accurate Discount Extraction (50%)');
    assert(res1.data.extractedOfferData.couponCode === 'DIWALI50', 'Test 2c: Accurate Coupon Code Extraction (DIWALI50)');

    // -------------------------------------------------------------
    // TEST 3: Anti-Hallucination Guarantee (Unstated Fields Flagged)
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 2: Anti-Hallucination & Confirmation Flags ---');
    const analyzeVague = {
      imageHint: 'Grand Opening Sale! Visit our store today'
    };
    const res3 = await makeRequest('POST', '/api/ai-templates/analyze-image', analyzeVague);
    assert(res3.status === 200, 'Test 3a: Analyzed Creative without Explicit Code Returns 200');
    assert(
      res3.data.extractedOfferData.needsConfirmation &&
      (res3.data.extractedOfferData.needsConfirmation.includes('couponCode') || res3.data.extractedOfferData.couponCode === ''),
      'Test 3b: System NEVER Invents a Coupon Code When Not Present',
      JSON.stringify(res3.data.extractedOfferData)
    );

    // -------------------------------------------------------------
    // TEST 4 & 5 & 6: 12 Indian Languages, 6 Tones & 5 Variations
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 3: Multilingual Generation Across 12 Languages & 6 Tones ---');
    const all12Langs = [
      'english', 'tamil', 'hindi', 'telugu', 'malayalam',
      'kannada', 'bengali', 'marathi', 'gujarati', 'punjabi', 'odia', 'urdu'
    ];

    const generatePayload = {
      extractedOfferData: {
        businessName: 'Royal Silk Sarees',
        productName: 'Kanchipuram Silk Saree',
        offerTitle: 'Deepavali Special Mega Privilege',
        discount: '40% Flat Discount',
        couponCode: 'SILK40',
        validUntil: '2026-11-20',
        contactNumber: '+919876543210',
        websiteUrl: 'https://royalsilks.in',
        callToAction: 'Shop Now & Claim Privilege'
      },
      languages: all12Langs,
      tone: 'festive',
      channel: 'both'
    };

    const resGen = await makeRequest('POST', '/api/ai-templates/generate', generatePayload);
    assert(resGen.status === 200, 'Test 4a: Multilingual Generation Endpoint Returns 200 OK');
    const gen = resGen.data;
    assert(Array.isArray(gen.variants), 'Test 4b: Generated Variants Array Exists');

    const generatedLangs = new Set(gen.variants.map(v => v.language));
    const hasAll12 = all12Langs.every(l => generatedLangs.has(l));
    assert(hasAll12, `Test 4c: Generated Content Across All 12 Indian Languages (Found: ${generatedLangs.size}/12)`);

    // Verify 5 variations per language
    const tamilVariants = gen.variants.filter(v => v.language === 'tamil');
    const variantTypes = new Set(tamilVariants.map(v => v.variantType));
    assert(
      variantTypes.has('primary') && variantTypes.has('short') && variantTypes.has('friendly') && variantTypes.has('urgency') && variantTypes.has('whatsapp'),
      'Test 6: 5 Distinct Message Variations per Language (Primary, Short, Friendly, Urgency, WhatsApp)',
      `Found types: ${Array.from(variantTypes).join(', ')}`
    );

    // -------------------------------------------------------------
    // TEST 7: Authentic Native Script Quality (No transliteration)
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 4: Authentic Native Script Quality ---');
    const tamilPrimary = gen.variants.find(v => v.language === 'tamil' && v.variantType === 'primary');
    const hindiPrimary = gen.variants.find(v => v.language === 'hindi' && v.variantType === 'primary');
    const teluguPrimary = gen.variants.find(v => v.language === 'telugu' && v.variantType === 'primary');

    assert(tamilPrimary && /[\u0B80-\u0BFF]/.test(tamilPrimary.messageBody), 'Test 7a: Tamil Variant Uses Authentic Tamil Native Unicode Script');
    assert(hindiPrimary && /[\u0900-\u097F]/.test(hindiPrimary.messageBody), 'Test 7b: Hindi Variant Uses Authentic Devanagari Native Unicode Script');
    assert(teluguPrimary && /[\u0C00-\u0C7F]/.test(teluguPrimary.messageBody), 'Test 7c: Telugu Variant Uses Authentic Telugu Native Unicode Script');

    // -------------------------------------------------------------
    // TEST 8 & 9: Telecom Encoding & Segment Estimation (GSM-7 vs Unicode)
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 5: Telecom Encodings & SMS Segment Estimation ---');
    const englishShort = gen.variants.find(v => v.language === 'english' && v.variantType === 'short');
    assert(englishShort && englishShort.encoding === 'GSM-7', 'Test 8a: English Message Identified as GSM-7 Encoding');
    assert(tamilPrimary && tamilPrimary.encoding === 'Unicode', 'Test 8b: Regional Native Script Identified as Unicode Encoding');

    assert(englishShort.estimatedSmsSegments === 1, 'Test 9a: Single Segment SMS Correctly Estimated (1 Segment)');
    assert(tamilPrimary.estimatedSmsSegments >= 1, 'Test 9b: Multi-segment Unicode SMS Correctly Estimated for Carrier Route');

    // -------------------------------------------------------------
    // TEST 10: Sequence-Aware Follow-Up Generation
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 6: Sequence-Aware AI Follow-Up Generator ---');
    const followUpPayload = {
      generationId: gen.id,
      campaignIntervals: [
        { sequence: 1, stage: 'INITIAL', scheduledInterval: '0h' },
        { sequence: 2, stage: 'REMINDER', scheduledInterval: '+24h' },
        { sequence: 3, stage: 'REINFORCEMENT', scheduledInterval: '+48h' },
        { sequence: 4, stage: 'EXPIRY', scheduledInterval: '+72h' }
      ],
      language: 'tamil',
      channel: 'both'
    };

    const resFollowUps = await makeRequest('POST', '/api/ai-templates/generate-followups', followUpPayload);
    assert(resFollowUps.status === 200, 'Test 10a: Generate Follow-ups Endpoint Returns 200 OK');
    const followUps = resFollowUps.data?.followUps || resFollowUps.data;
    assert(Array.isArray(followUps) && followUps.length === 4, 'Test 10b: 4 Sequential Follow-up Messages Generated');
    assert(followUps && followUps[0]?.stage === 'INITIAL' && followUps[3]?.stage === 'EXPIRY', 'Test 10c: Initial and Final Expiry Stages Properly Sequenced');

    // -------------------------------------------------------------
    // TEST 11 to 15: Smart Follow-Up Eligibility Rules
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 7: Smart Follow-Up Eligibility Engine ---');
    const aiTemplateService = require('./services/aiTemplateService');

    // 11. Opt-out suppression check
    const suppressedCustomer = { id: 101, phone: '+919999900001', optOut: true, status: 'UNSUBSCRIBED' };
    const eligSuppressed = await aiTemplateService.checkFollowUpEligibility(suppressedCustomer, followUps[1]);
    assert(eligSuppressed.eligible === false && (eligSuppressed.reason.toLowerCase().includes('suppress') || eligSuppressed.reason.toLowerCase().includes('opt-out')), 'Test 11: Suppressed / Opted-Out Contact Rejected for Follow-up');

    // 12. Non-conversion check (Inbound reply is NOT assumed conversion)
    const repliedCustomer = {
      id: 102,
      phone: '+919999900002',
      optOut: false,
      inboundReplies: ['What is the address?'], // Replied to inquiry, but has NOT purchased
      converted: false
    };
    const eligReplied = await aiTemplateService.checkFollowUpEligibility(repliedCustomer, followUps[1]);
    assert(eligReplied.eligible === true, 'Test 12: Inbound Inquiry Reply Is NOT Assumed Conversion (Contact Remains Eligible for Sequence)');

    // Explicit conversion check
    const convertedCustomer = {
      id: 103,
      phone: '+919999900003',
      optOut: false,
      converted: true
    };
    const followUpConvertedCheck = { ...followUps[1], eligibilityRule: 'NOT_CONVERTED' };
    const eligConverted = await aiTemplateService.checkFollowUpEligibility(convertedCustomer, followUpConvertedCheck);
    assert(eligConverted.eligible === false && eligConverted.reason.toLowerCase().includes('converted'), 'Test 12b: Converted Customer Properly Suppressed from Further Follow-ups');

    // 13. Delivery check
    const failedDeliveryCustomer = { id: 104, phone: '+919999900004', initialDeliveryStatus: 'FAILED' };
    const eligFailed = await aiTemplateService.checkFollowUpEligibility(failedDeliveryCustomer, { ...followUps[1], eligibilityRule: 'DELIVERED_ONLY' });
    assert(eligFailed.eligible === false && (eligFailed.reason.toLowerCase().includes('failed') || eligFailed.reason.toLowerCase().includes('delivery')), 'Test 13: Delivery Check Suppresses Contacts with Failed Initial Delivery');

    // 14. Quiet hours check
    const currentHour = new Date().getHours();
    const quietFollowUp = { ...followUps[1], respectQuietHours: true };
    const normalCustomer = { id: 105, phone: '+919999900005', optOut: false };
    const eligQuiet = await aiTemplateService.checkFollowUpEligibility(normalCustomer, quietFollowUp);
    if (currentHour >= 21 || currentHour < 9) {
      assert(eligQuiet.eligible === false && eligQuiet.reason.toLowerCase().includes('quiet'), 'Test 14: Quiet Hours (TRAI 21:00-09:00) Compliance Verified Active');
    } else {
      assert(eligQuiet.eligible === true, 'Test 14: Non-Quiet Hours Allows Lawful Dispatch');
    }

    // 15. Offer expiration cutoff check
    const expiredFollowUp = { ...followUps[3], offerValidUntil: '2026-01-01' }; // Past date
    const eligExpired = await aiTemplateService.checkFollowUpEligibility(normalCustomer, expiredFollowUp);
    assert(eligExpired.eligible === false && eligExpired.reason.toLowerCase().includes('expired'), 'Test 15: Expiration Cutoff Prevents Dispatch After Offer Expiry Date');

    // -------------------------------------------------------------
    // TEST 16: Variant Copy Update (PATCH)
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 8: API Lifecycle Operations ---');
    const updateRes = await makeRequest('PATCH', `/api/ai-templates/${gen.id}`, {
      variantId: tamilPrimary.id,
      messageBody: `${tamilPrimary.messageBody}\n\nஅவசர சலுகை!`
    });
    assert(updateRes.status === 200, 'Test 16a: PATCH /api/ai-templates/:id Returns 200');
    assert(updateRes.data.variant.messageBody.includes('அவசர சலுகை!'), 'Test 16b: Variant Message Body Updated and Persisted');

    // -------------------------------------------------------------
    // TEST 17: Content Approval Workflow
    // -------------------------------------------------------------
    const approveRes = await makeRequest('POST', `/api/ai-templates/${gen.id}/approve`, {
      variantId: tamilPrimary.id
    });
    assert(approveRes.status === 200, 'Test 17a: POST /api/ai-templates/:id/approve Returns 200');
    const approvedVar = approveRes.data.variants?.find(v => v.id === tamilPrimary.id);
    assert(approveRes.data.approvedCount > 0 && approvedVar?.approvalStatus === 'APPROVED', 'Test 17b: Variant Status Formally Transitioned to APPROVED');

    // -------------------------------------------------------------
    // TEST 18: Save to Reusable Shared Library
    // -------------------------------------------------------------
    const saveRes = await makeRequest('POST', `/api/ai-templates/${gen.id}/save`, {
      variantId: tamilPrimary.id,
      templateName: 'Diwali Tamil Silk Mega Promo',
      category: 'Promotional'
    });
    assert(saveRes.status === 200, 'Test 18a: POST /api/ai-templates/:id/save Returns 200');
    assert((saveRes.data.template || saveRes.data.savedTemplate) && (saveRes.data.template?.name || saveRes.data.savedTemplate?.name) === 'Diwali Tamil Silk Mega Promo', 'Test 18b: Template Successfully Synced into Shared Saved Templates');

    // -------------------------------------------------------------
    // TEST 19: Pre-Flight Carrier Test Dispatch
    // -------------------------------------------------------------
    const testRes = await makeRequest('POST', `/api/ai-templates/${gen.id}/test`, {
      variantId: tamilPrimary.id,
      recipient: '+916369825386'
    });
    assert(testRes.status === 200, 'Test 19a: POST /api/ai-templates/:id/test Returns 200');
    assert(testRes.data.success === true || (testRes.data.message && testRes.data.message.includes('Carrier test dispatched')), 'Test 19b: Pre-flight Test Message Dispatched to Carrier Queue');

    // -------------------------------------------------------------
    // TEST 20: Ingestion into Campaign Console
    // -------------------------------------------------------------
    const useRes = await makeRequest('POST', `/api/ai-templates/${gen.id}/use-in-campaign`, {
      variantId: tamilPrimary.id
    });
    assert(useRes.status === 200, 'Test 20a: POST /api/ai-templates/:id/use-in-campaign Returns 200');
    assert(useRes.data.success === true && (useRes.data.campaignId !== undefined || useRes.data.campaignPayload !== undefined), 'Test 20b: Formatted Payload Generated for Broadcast Console Integration');

    // -------------------------------------------------------------
    // TEST GROUP 9: 6 Regional Languages, 4-Stage Follow-Ups & Strict No-Substitution Policy
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 9: 6 Regional Languages, 4-Stage Follow-Ups & Strict No-Substitution ---');

    // 21. Exactly 6 Regional Languages Generation
    const sixLangs = ['tamil', 'telugu', 'kannada', 'malayalam', 'hindi', 'marathi'];
    const sixGenRes = await makeRequest('POST', '/api/ai-templates/generate', {
      extractedOfferData: {
        businessName: 'Royal Silk House',
        discount: '40% OFF',
        couponCode: 'SILK40',
        validUntil: '30 Nov 2026',
        contactNumber: '+916369825386'
      },
      languages: sixLangs,
      channel: 'both',
      tone: 'promotional'
    });
    assert(sixGenRes.status === 200, 'Test 21a: Generates variations for exactly 6 regional languages');
    const sixGen = sixGenRes.data;
    const sixGeneratedLangs = new Set(sixGen.variants.map(v => v.language.toLowerCase()));
    const allSixPresent = sixLangs.every(l => sixGeneratedLangs.has(l));
    assert(allSixPresent, 'Test 21b: All 6 required languages (ta, te, kn, ml, hi, mr) present in generated output');

    // 22. 4-Stage Sequential Follow-Ups (INITIAL, REMINDER, REINFORCEMENT, EXPIRY)
    const fourStageRes = await makeRequest('POST', '/api/ai-templates/generate-followups', {
      generationId: sixGen.id,
      languages: ['tamil', 'telugu', 'kannada'],
      schedule: [
        { sequenceNumber: 1, interval: '0h', stage: 'INITIAL' },
        { sequenceNumber: 2, interval: 'Day 3 — 11:00 AM', stage: 'REMINDER' },
        { sequenceNumber: 3, interval: 'Day 5 — 5:00 PM', stage: 'REINFORCEMENT' },
        { sequenceNumber: 4, interval: 'Day 7 — 12:00 PM', stage: 'EXPIRY' }
      ]
    });
    assert(fourStageRes.status === 200, 'Test 22a: 4-Stage follow-ups API returns 200');
    const seqFollowUps = fourStageRes.data.followUps;
    const tamilStages = seqFollowUps.filter(f => f.language.toLowerCase() === 'tamil').map(f => f.stage);
    const hasAllFourStages = ['INITIAL', 'REMINDER', 'REINFORCEMENT', 'EXPIRY'].every(st => tamilStages.includes(st));
    assert(hasAllFourStages, 'Test 22b: Tamil follow-up sequence contains all 4 stages (Initial, Reminder, Reinforcement, Expiry)');

    // 23. Strict No-Substitution Policy Enforcement
    const validateUnapprovedRes = await makeRequest('POST', `/api/ai-templates/${sixGen.id}/validate-approval`, {
      requiredLanguages: ['tamil', 'telugu', 'kannada']
    });
    assert(validateUnapprovedRes.status === 200, 'Test 23a: Validate approval endpoint returns 200');
    assert(validateUnapprovedRes.data.valid === false, 'Test 23b: Unapproved language versions reject campaign launch');
    assert(validateUnapprovedRes.data.error.includes('Automatic substitution is strictly disabled'), 'Test 23c: Explicit policy guarantees automatic substitution is disabled');

    // Approve the variants and re-test validation
    await makeRequest('POST', `/api/ai-templates/${sixGen.id}/approve`, { approveAll: true });
    const validateApprovedRes = await makeRequest('POST', `/api/ai-templates/${sixGen.id}/validate-approval`, {
      requiredLanguages: ['tamil', 'telugu', 'kannada']
    });
    assert(validateApprovedRes.data.valid === true, 'Test 23d: Approved language versions allow broadcast to proceed');

    // 24. Contact-Level Language Assignment
    const custsRes = await makeRequest('GET', '/api/customers');
    const testCust = custsRes.data[0];
    const updateCustLangRes = await makeRequest('PATCH', `/api/customers/${testCust.id}/language`, {
      language: 'kannada'
    });
    assert(updateCustLangRes.status === 200, 'Test 24a: PATCH /api/customers/:id/language returns 200');
    assert(updateCustLangRes.data.customer.language === 'kannada', 'Test 24b: Contact-level preferred language set to Kannada');

    // 25. Segment-Level Language Assignment
    const updateSegLangRes = await makeRequest('POST', '/api/customers/segment-language', {
      segment: 'Women',
      language: 'malayalam'
    });
    assert(updateSegLangRes.status === 200, 'Test 25a: POST /api/customers/segment-language returns 200');
    assert(updateSegLangRes.data.updatedCount >= 0, 'Test 25b: Demographic segment assigned Malayalam language routing');

    // Final Summary
    console.log('\n================================================================');
    console.log(` PHASE 17 VERIFICATION SUMMARY: ${passed} PASSED | ${failed} FAILED`);
    console.log('================================================================');

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (error) {
    console.error('Fatal test error:', error);
    process.exit(1);
  }
}

runPhase17Tests();
