/**
 * Phase 17.1 — Google Gemini Service
 * Dedicated Backend Integration for Multimodal Image Understanding,
 * Fact-Grounded Regional Language Generation & Schedule-Aware Follow-Up Automation.
 *
 * Security Guarantee:
 * - API Key accessed exclusively from process.env.GEMINI_API_KEY.
 * - Never exposed to frontend code.
 */

const fs = require('fs');

class GeminiService {
    constructor() {
        this.defaultModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
        this.fallbackModels = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest', 'gemini-3.6-flash'];
        this.timeoutMs = 45000;
        this.maxRetries = 2;
        this.auditLogs = [];
    }

    getApiKey() {
        const key = process.env.GEMINI_API_KEY;
        if (!key || key.trim() === '') {
            throw new Error('GEMINI_API_KEY is not configured in backend environment variables.');
        }
        return key.trim();
    }

    logAudit({ operation, model, latencyMs, success, error = null, tokens = null }) {
        const entry = {
            id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            operation,
            model,
            latencyMs,
            success,
            error: error ? String(error) : null,
            tokens,
            timestamp: new Date().toISOString()
        };
        this.auditLogs.unshift(entry);
        if (this.auditLogs.length > 100) this.auditLogs.pop();
        console.log(`[Gemini Audit] ${operation} | Model: ${model} | ${latencyMs}ms | ${success ? 'SUCCESS' : 'FAILED'}`);
    }

    getAuditLogs() {
        return this.auditLogs;
    }

    /**
     * Executes a Google Gemini REST request with retries, timeout, and fallback models.
     */
    async _callGemini({ contents, generationConfig = {}, systemInstruction = null }) {
        const apiKey = this.getApiKey();
        const modelsToTry = [this.defaultModel, ...this.fallbackModels.filter(m => m !== this.defaultModel)];

        let lastError = null;

        for (const model of modelsToTry) {
            for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
                const startTime = Date.now();
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

                try {
                    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
                    const payload = {
                        contents,
                        generationConfig: {
                            temperature: 0.2, // Low temperature for high factual accuracy
                            ...generationConfig
                        }
                    };

                    if (systemInstruction) {
                        payload.systemInstruction = {
                            parts: [{ text: systemInstruction }]
                        };
                    }

                    const response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                        signal: controller.signal
                    });

                    clearTimeout(timeoutId);
                    const latencyMs = Date.now() - startTime;

                    if (!response.ok) {
                        const errJson = await response.json().catch(() => ({}));
                        const errMsg = errJson.error?.message || `HTTP ${response.status} ${response.statusText}`;

                        // If model not found or deprecated, try next model immediately
                        if (response.status === 404 || errMsg.includes('not found') || errMsg.includes('no longer available')) {
                            console.warn(`[Gemini] Model ${model} not available (${errMsg}), trying fallback...`);
                            lastError = new Error(errMsg);
                            break; // break retry loop to move to next model
                        }

                        // If quota limit exceeded on this model, immediately try next fallback model
                        if (errMsg.toLowerCase().includes('quota') || errMsg.includes('free_tier_requests')) {
                            console.warn(`[Gemini] Quota limit on ${model}. Trying next fallback model immediately.`);
                            lastError = new Error(errMsg);
                            break;
                        }

                        // On rate limit (429) or temporary server error (503), wait and retry
                        if (response.status === 429 || response.status >= 500) {
                            console.warn(`[Gemini] Attempt ${attempt} on ${model} failed (${errMsg}). Retrying in 2s...`);
                            await new Promise(r => setTimeout(r, 2000 * attempt));
                            lastError = new Error(errMsg);
                            continue;
                        }

                        throw new Error(`Gemini API Error: ${errMsg}`);
                    }

                    const json = await response.json();
                    if (!json.candidates || json.candidates.length === 0) {
                        throw new Error('Gemini API returned no candidates for generation.');
                    }

                    const rawText = json.candidates[0].content?.parts?.[0]?.text;
                    const tokens = json.usageMetadata?.totalTokenCount || null;

                    this.logAudit({
                        operation: 'generateContent',
                        model,
                        latencyMs,
                        success: true,
                        tokens
                    });

                    return { rawText, model, tokens, latencyMs };
                } catch (err) {
                    clearTimeout(timeoutId);
                    const latencyMs = Date.now() - startTime;
                    const errorMsg = err.name === 'AbortError' ? `Request timed out after ${this.timeoutMs}ms` : err.message;
                    lastError = new Error(errorMsg);

                    this.logAudit({
                        operation: 'generateContent',
                        model,
                        latencyMs,
                        success: false,
                        error: errorMsg
                    });

                    if (attempt < this.maxRetries && err.name !== 'AbortError') {
                        await new Promise(r => setTimeout(r, 1500));
                    }
                }
            }
        }

        throw new Error(`Gemini generation failed on all models. Last error: ${lastError?.message}`);
    }

    /**
     * Step 1 to 6 — Gemini Image Understanding & Structured Extraction
     * Grounded exclusively in the uploaded image creative.
     */
    async analyzeImage({ imageBuffer, mimeType = 'image/jpeg', filename = 'creative.jpg' }) {
        if (!imageBuffer || imageBuffer.length === 0) {
            throw new Error('Image buffer is empty or missing.');
        }

        // Validate size (max 10MB)
        if (imageBuffer.length > 10 * 1024 * 1024) {
            throw new Error('Image file exceeds the 10MB limit for Gemini multimodal ingestion.');
        }

        const validMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
        const normalizedMime = validMimes.includes(mimeType.toLowerCase()) ? mimeType.toLowerCase() : 'image/jpeg';
        const base64Data = imageBuffer.toString('base64');

        const systemPrompt = `You are an expert promotional image analyzer for an enterprise marketing system.
Inspect the uploaded creative with rigorous, ground-truth visual understanding.
The uploaded image is the EXCLUSIVE and ONLY source of promotional facts.

STRICT ANTI-HALLUCINATION RULES:
1. Do NOT invent any brand or business name unless clearly visible in text or an unmistakable trademark.
2. Do NOT invent any offer, discount percentage, flat discount, or BOGO claim.
3. Do NOT invent coupon codes. If no promotional code is printed in the image, couponCode must be null.
4. Do NOT invent validity dates. If no expiry or end date is printed in the image, validUntil must be null.
5. Do NOT invent contact phone numbers or website URLs.
6. Do NOT invent product features or benefits that are not shown in the creative.
7. Do NOT add claims like "free delivery", "limited stock", "exclusive VIP", or "satisfaction guaranteed" unless visibly supported by text in the image.
8. If information is missing, ambiguous, or unreadable:
   - Set value to null.
   - Set confidence to "not_found" or "uncertain".
   - Include the field name in the missingFields or uncertainFields array.

You MUST return valid JSON matching this exact structure:
{
  "brandName": { "value": string | null, "confidence": "high" | "medium" | "low" | "not_found" | "uncertain", "source": "image" },
  "productName": { "value": string | null, "confidence": "high" | "medium" | "low" | "not_found" | "uncertain", "source": "image" },
  "offerTitle": { "value": string | null, "confidence": "high" | "medium" | "low" | "not_found" | "uncertain", "source": "image" },
  "discount": { "value": string | null, "confidence": "high" | "medium" | "low" | "not_found" | "uncertain", "source": "image" },
  "couponCode": { "value": string | null, "confidence": "high" | "medium" | "low" | "not_found" | "uncertain", "source": "image" },
  "validUntil": { "value": string | null, "confidence": "high" | "medium" | "low" | "not_found" | "uncertain", "source": "image" },
  "productFeatures": string[],
  "contactNumber": { "value": string | null, "confidence": "high" | "medium" | "low" | "not_found" | "uncertain", "source": "image" },
  "websiteUrl": { "value": string | null, "confidence": "high" | "medium" | "low" | "not_found" | "uncertain", "source": "image" },
  "callToAction": { "value": string | null, "confidence": "high" | "medium" | "low" | "not_found" | "uncertain", "source": "image" },
  "termsAndConditions": string[],
  "missingFields": string[],
  "uncertainFields": string[]
}`;

        const userPrompt = `Analyze this promotional creative image ("${filename}"). Extract all visible promotional fields adhering strictly to the anti-hallucination rules. Never invent missing details.`;

        const contents = [
            {
                parts: [
                    {
                        inlineData: {
                            mimeType: normalizedMime,
                            data: base64Data
                        }
                    },
                    { text: userPrompt }
                ]
            }
        ];

        const { rawText, model } = await this._callGemini({
            contents,
            systemInstruction: systemPrompt,
            generationConfig: {
                responseMimeType: 'application/json'
            }
        });

        let parsed = null;
        try {
            parsed = JSON.parse(rawText);
        } catch (e) {
            // If wrapped in markdown blocks, strip them
            const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
            parsed = JSON.parse(cleaned);
        }

        // Schema validation & default normalization
        const normalized = this._normalizeExtractedSchema(parsed);
        normalized._meta = {
            model,
            analyzedAt: new Date().toISOString(),
            filename
        };

        return normalized;
    }

    _normalizeExtractedSchema(raw) {
        const fields = [
            'brandName', 'productName', 'offerTitle', 'discount',
            'couponCode', 'validUntil', 'contactNumber', 'websiteUrl', 'callToAction'
        ];

        const normalized = {
            brandName: { value: null, confidence: 'not_found', source: 'image' },
            productName: { value: null, confidence: 'not_found', source: 'image' },
            offerTitle: { value: null, confidence: 'not_found', source: 'image' },
            discount: { value: null, confidence: 'not_found', source: 'image' },
            couponCode: { value: null, confidence: 'not_found', source: 'image' },
            validUntil: { value: null, confidence: 'not_found', source: 'image' },
            productFeatures: Array.isArray(raw?.productFeatures) ? raw.productFeatures : [],
            contactNumber: { value: null, confidence: 'not_found', source: 'image' },
            websiteUrl: { value: null, confidence: 'not_found', source: 'image' },
            callToAction: { value: null, confidence: 'not_found', source: 'image' },
            termsAndConditions: Array.isArray(raw?.termsAndConditions) ? raw.termsAndConditions : [],
            missingFields: [],
            uncertainFields: []
        };

        for (const f of fields) {
            if (raw && raw[f]) {
                if (typeof raw[f] === 'object' && raw[f] !== null) {
                    normalized[f] = {
                        value: raw[f].value !== undefined ? raw[f].value : null,
                        confidence: raw[f].confidence || (raw[f].value ? 'high' : 'not_found'),
                        source: raw[f].source || 'image'
                    };
                } else {
                    normalized[f] = {
                        value: raw[f],
                        confidence: raw[f] ? 'high' : 'not_found',
                        source: 'image'
                    };
                }
            }
        }

        // Compute missingFields and uncertainFields
        const missing = [];
        const uncertain = [];

        for (const f of fields) {
            if (!normalized[f].value || normalized[f].confidence === 'not_found') {
                missing.push(f);
                normalized[f].value = null;
                normalized[f].confidence = 'not_found';
            } else if (normalized[f].confidence === 'uncertain' || normalized[f].confidence === 'low') {
                uncertain.push(f);
            }
        }

        normalized.missingFields = Array.from(new Set([...(raw?.missingFields || []), ...missing]));
        normalized.uncertainFields = Array.from(new Set([...(raw?.uncertainFields || []), ...uncertain]));

        return normalized;
    }

    /**
     * Step 4 & 5 — Regional Language Message Generation
     * Exactly 6 Required Languages: Tamil, Telugu, Kannada, Malayalam, Hindi, Marathi.
     * Generates 5 variations per language strictly grounded in confirmed facts.
     */
    async generateRegionalMessages({
        confirmedOfferData = {},
        languages = ['tamil'],
        tone = 'promotional',
        channel = 'both'
    }) {
        const allowedLangs = [
            'tamil', 'telugu', 'kannada', 'malayalam', 'hindi', 'marathi',
            'english', 'bengali', 'gujarati', 'punjabi', 'odia', 'urdu'
        ];
        const validLangs = languages.filter(l => allowedLangs.includes(l.toLowerCase()));
        if (validLangs.length === 0) validLangs.push('tamil');

        const langMeta = {
            tamil: { name: 'Tamil', native: 'தமிழ்', code: 'ta' },
            telugu: { name: 'Telugu', native: 'తెలుగు', code: 'te' },
            kannada: { name: 'Kannada', native: 'ಕನ್ನಡ', code: 'kn' },
            malayalam: { name: 'Malayalam', native: 'മലയാളം', code: 'ml' },
            hindi: { name: 'Hindi', native: 'हिन्दी', code: 'hi' },
            marathi: { name: 'Marathi', native: 'मराठी', code: 'mr' },
            english: { name: 'English', native: 'English', code: 'en' },
            bengali: { name: 'Bengali', native: 'বাংলা', code: 'bn' },
            gujarati: { name: 'Gujarati', native: 'ગુજરાતી', code: 'gu' },
            punjabi: { name: 'Punjabi', native: 'ਪੰਜਾਬੀ', code: 'pa' },
            odia: { name: 'Odia', native: 'ଓଡ଼ିଆ', code: 'or' },
            urdu: { name: 'Urdu', native: 'اردو', code: 'ur' }
        };

        const factsPrompt = `CONFIRMED PROMOTIONAL FACTS (EXCLUSIVE SOURCE OF INFORMATION):
- Brand/Business Name: ${confirmedOfferData.brandName?.value || confirmedOfferData.businessName || 'Not Provided'}
- Product Name: ${confirmedOfferData.productName?.value || confirmedOfferData.productName || 'Not Specified'}
- Offer Title: ${confirmedOfferData.offerTitle?.value || confirmedOfferData.offerTitle || 'Special Privilege'}
- Discount: ${confirmedOfferData.discount?.value || confirmedOfferData.discount || 'NULL (DO NOT INVENT A DISCOUNT OR PERCENTAGE)'}
- Coupon Code: ${confirmedOfferData.couponCode?.value || confirmedOfferData.couponCode || 'NULL (DO NOT INVENT A COUPON CODE)'}
- Validity Date: ${confirmedOfferData.validUntil?.value || confirmedOfferData.validUntil || 'NULL (DO NOT INVENT AN EXPIRY DATE OR FALSE URGENCY)'}
- Product Features: ${(confirmedOfferData.productFeatures || []).join(', ') || 'None explicitly displayed'}
- Contact Number: ${confirmedOfferData.contactNumber?.value || confirmedOfferData.contactNumber || 'Not Specified'}
- Website URL: ${confirmedOfferData.websiteUrl?.value || confirmedOfferData.websiteUrl || 'Not Specified'}
- Call To Action: ${confirmedOfferData.callToAction?.value || confirmedOfferData.callToAction || 'Shop Now'}
- Terms: ${(confirmedOfferData.termsAndConditions || []).join('. ') || 'Standard T&C apply'}`;

        const systemPrompt = `You are an elite multilingual copywriter for an enterprise SMS and WhatsApp marketing platform.
Generate promotional campaign copy strictly grounded in the confirmed facts provided.

CRITICAL FACTUAL GROUNDING RULES:
1. NEVER invent discounts, percentage numbers, coupon codes, validity dates, phone numbers, or warranty claims that are NULL or unmentioned.
2. If the discount is NULL, do NOT say "Flat 50%" or "huge discount"; describe the offer accurately using the Offer Title.
3. If the coupon code is NULL, do NOT invent a code like "SUMMER25" or "DEAL10".
4. If validity date is NULL, do NOT create artificial urgency like "hurry expires tonight".
5. Use authentic, fluent, native scripts with natural regional marketing expressions.
6. Preserve brand names, numbers, coupon codes, and URLs verbatim.
7. Support standard personalization tokens: {{customer_name}}, {{care_number}}.
8. For each requested language, generate exactly 5 distinct message variations:
   - primary: Comprehensive promotional broadcast
   - short: Crisp single-segment SMS
   - friendly: Warm customer relationship engagement
   - urgency: Offer validity reminder (only if validity date is present, otherwise focus on timely visit)
   - whatsapp: WhatsApp rich formatting (*bold*, emojis, clean line breaks)

Output MUST be strict JSON:
{
  "languages": {
    "<language_code>": [
      { "variantType": "primary", "label": "Primary Promotional", "messageBody": "..." },
      { "variantType": "short", "label": "Short (Single Segment)", "messageBody": "..." },
      { "variantType": "friendly", "label": "Customer Engagement", "messageBody": "..." },
      { "variantType": "urgency", "label": "Timely Reminder", "messageBody": "..." },
      { "variantType": "whatsapp", "label": "WhatsApp Rich", "messageBody": "..." }
    ]
  }
}`;

        const userPrompt = `${factsPrompt}

TARGET LANGUAGES: ${validLangs.map(l => `${langMeta[l].name} (${langMeta[l].native} - ${langMeta[l].code})`).join(', ')}
CAMPAIGN TONE: ${tone}
PREFERRED CHANNEL: ${channel}

Generate the 5 variations for each target language in strict JSON.`;

        const { rawText, model } = await this._callGemini({
            contents: [{ parts: [{ text: userPrompt }] }],
            systemInstruction: systemPrompt,
            generationConfig: {
                responseMimeType: 'application/json'
            }
        });

        let parsed = null;
        try {
            parsed = JSON.parse(rawText);
        } catch (e) {
            const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
            parsed = JSON.parse(cleaned);
        }

        const variants = [];
        const langData = parsed.languages || parsed;

        for (const lang of validLangs) {
            const list = langData[lang] || langData[langMeta[lang]?.code] || langData[langMeta[lang]?.name] || [];
            if (Array.isArray(list) && list.length > 0) {
                for (const item of list) {
                    const { charCount, encoding, segments } = this.calculateEncodingAndSegments(item.messageBody || '');
                    variants.push({
                        id: `var_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                        language: lang,
                        channel: item.variantType === 'whatsapp' ? 'whatsapp' : channel,
                        tone,
                        variantType: item.variantType || 'primary',
                        label: item.label || 'Promotional Variant',
                        messageBody: item.messageBody,
                        characterCount: charCount,
                        encoding,
                        estimatedSmsSegments: segments,
                        approvalStatus: 'PENDING',
                        approved: false,
                        modelUsed: model
                    });
                }
            } else {
                // In the rare event a language was skipped by the LLM, synthesize ground-truth fallback
                const fallbackVariants = this._generateFallbackVariants(lang, confirmedOfferData, channel, tone);
                variants.push(...fallbackVariants);
            }
        }

        return variants;
    }

    /**
     * Step 6 — Schedule-Aware Follow-Up Generation
     * Connects to actual configured schedule intervals (Day 1, Day 3, Day 5, Day 7).
     * Grounded in confirmed offer facts without introducing new claims.
     */
    async generateScheduleAwareFollowUps({
        confirmedOfferData = {},
        approvedInitialMessage = '',
        languages = ['tamil'],
        channel = 'both',
        schedule = [],
        tone = 'promotional'
    }) {
        const allowedLangs = ['tamil', 'telugu', 'kannada', 'malayalam', 'hindi', 'marathi'];
        const validLangs = languages.filter(l => allowedLangs.includes(l.toLowerCase()));
        if (validLangs.length === 0) validLangs.push('tamil');

        const activeSchedule = (schedule && schedule.length > 0) ? schedule : [
            { sequenceNumber: 1, interval: '0h (Immediate)', stage: 'INITIAL' },
            { sequenceNumber: 2, interval: 'Day 3 — 11:00 AM', stage: 'REMINDER' },
            { sequenceNumber: 3, interval: 'Day 5 — 5:00 PM', stage: 'REINFORCEMENT' },
            { sequenceNumber: 4, interval: 'Day 7 — 12:00 PM', stage: 'EXPIRY' }
        ];

        const brand = confirmedOfferData.brandName?.value || confirmedOfferData.businessName || 'Trends';
        const offerTitle = confirmedOfferData.offerTitle?.value || confirmedOfferData.offerTitle || 'Special Privilege';
        const discount = confirmedOfferData.discount?.value || confirmedOfferData.discount || null;
        const code = confirmedOfferData.couponCode?.value || confirmedOfferData.couponCode || null;
        const expiry = confirmedOfferData.validUntil?.value || confirmedOfferData.validUntil || null;
        const care = confirmedOfferData.contactNumber?.value || confirmedOfferData.contactNumber || '+916369825386';

        const systemPrompt = `You are an automated campaign sequence engine for regional marketing.
Generate sequential schedule-aware follow-up messages for configured campaign intervals.

STRICT GROUNDING RULES:
1. Use ONLY the confirmed facts: Brand "${brand}", Offer "${offerTitle}", Discount: ${discount || 'NONE'}, Code: ${code || 'NONE'}, Expiry: ${expiry || 'NONE'}, Helpline: ${care}.
2. If discount is NONE, NEVER invent discounts.
3. If coupon code is NONE, NEVER invent codes.
4. If expiry is NONE, do NOT invent artificial expiry dates.
5. Avoid repetitive wording across sequences. Progress naturally:
   - INITIAL: First announcement
   - REMINDER: Gentle nudge about the offer
   - REINFORCEMENT: Highlights offer value or brand relationship
   - EXPIRY: Closing opportunity (only mention expiry date if one exists)
6. Authentic native scripts for each requested regional language.

Output JSON:
{
  "followUps": [
    {
      "sequenceNumber": number,
      "stage": "INITIAL" | "REMINDER" | "REINFORCEMENT" | "EXPIRY",
      "scheduledInterval": string,
      "language": string,
      "messageBody": string
    }
  ]
}`;

        const userPrompt = `Generate follow-ups for:
LANGUAGES: ${validLangs.join(', ')}
SCHEDULED INTERVALS:
${JSON.stringify(activeSchedule, null, 2)}
PREVIOUS APPROVED INITIAL MESSAGE REFERENCE:
"${approvedInitialMessage || 'None provided'}"`;

        const { rawText, model } = await this._callGemini({
            contents: [{ parts: [{ text: userPrompt }] }],
            systemInstruction: systemPrompt,
            generationConfig: {
                responseMimeType: 'application/json'
            }
        });

        let parsed = null;
        try {
            parsed = JSON.parse(rawText);
        } catch (e) {
            const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
            parsed = JSON.parse(cleaned);
        }

        const rawList = parsed.followUps || parsed;
        const results = [];

        if (Array.isArray(rawList)) {
            for (const item of rawList) {
                results.push({
                    id: `fu_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                    sequenceNumber: item.sequenceNumber || 1,
                    stage: item.stage || 'REMINDER',
                    scheduledInterval: item.scheduledInterval || 'Scheduled Interval',
                    language: (item.language || validLangs[0]).toLowerCase(),
                    channel,
                    messageBody: item.messageBody,
                    eligibilityRule: item.stage === 'INITIAL' ? 'ALL_ELIGIBLE' : 'NOT_REPLIED',
                    approvalStatus: 'PENDING',
                    modelUsed: model,
                    createdAt: new Date().toISOString()
                });
            }
        }

        // If any requested language was missing from response, synthesize deterministic sequence
        for (const lang of validLangs) {
            const hasLang = results.some(r => r.language === lang);
            if (!hasLang) {
                const synthetics = this._synthesizeFollowUpSequence(lang, activeSchedule, confirmedOfferData, channel);
                results.push(...synthetics);
            }
        }

        return results;
    }

    calculateEncodingAndSegments(text) {
        if (!text) return { charCount: 0, encoding: 'GSM-7', segments: 0 };
        const isUnicode = Array.from(text).some(c => c.charCodeAt(0) > 127);
        const charCount = text.length;
        let segments = 1;

        if (isUnicode) {
            // UCS-2: single segment <= 70, concatenated <= 67
            if (charCount > 70) {
                segments = Math.ceil(charCount / 67);
            }
        } else {
            // GSM-7: single segment <= 160, concatenated <= 153
            if (charCount > 160) {
                segments = Math.ceil(charCount / 153);
            }
        }

        return {
            charCount,
            encoding: isUnicode ? 'Unicode' : 'GSM-7',
            segments
        };
    }

    _generateFallbackVariants(language, offer, channel, tone) {
        const bus = offer.brandName?.value || offer.businessName || 'Trends';
        const disc = offer.discount?.value || offer.discount;
        const code = offer.couponCode?.value || offer.couponCode;
        const expiry = offer.validUntil?.value || offer.validUntil;
        const care = offer.contactNumber?.value || offer.contactNumber || '+916369825386';
        const title = offer.offerTitle?.value || offer.offerTitle || 'Special Privilege';

        let primaryText = '';
        if (language === 'english') {
            const discPart = disc ? `${disc} ` : '';
            const codePart = code ? `Use code ${code}. ` : '';
            const expPart = expiry ? `Valid until ${expiry}. ` : '';
            primaryText = `Hi {{customer_name}}, ${bus} presents ${title}! ${discPart}${codePart}${expPart}Care: ${care}. Reply STOP to opt out.`.replace(/\s+/g, ' ').trim();
        } else {
            const codePart = code ? `குறியீடு ${code} பயன்படுத்தவும்.` : '';
            const discPart = disc ? `${disc} சலுகை.` : '';
            const expPart = expiry ? `செல்லுபடியாகும் நாள்: ${expiry}.` : '';
            primaryText = `வணக்கம் {{customer_name}}, ${bus} வழங்கும் ${title}! ${discPart} ${codePart} ${expPart} தொடர்புக்கு: ${care}. நிறுத்த STOP அனுப்பவும்.`.replace(/\s+/g, ' ').trim();
        }

        const { charCount, encoding, segments } = this.calculateEncodingAndSegments(primaryText);

        return [
            {
                id: `var_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                language,
                channel,
                tone,
                variantType: 'primary',
                label: 'Primary Promotional',
                messageBody: primaryText,
                characterCount: charCount,
                encoding,
                estimatedSmsSegments: segments,
                approvalStatus: 'PENDING',
                approved: false
            }
        ];
    }

    _synthesizeFollowUpSequence(language, schedule, offer, channel) {
        const bus = offer.brandName?.value || offer.businessName || 'Trends';
        const title = offer.offerTitle?.value || offer.offerTitle || 'Special Privilege';
        const disc = offer.discount?.value || offer.discount || '';
        const code = offer.couponCode?.value || offer.couponCode || '';

        return schedule.map(sch => {
            const seq = sch.sequenceNumber || 1;
            const stage = sch.stage || (seq === 1 ? 'INITIAL' : seq === 2 ? 'REMINDER' : seq === 3 ? 'REINFORCEMENT' : 'EXPIRY');
            const interval = sch.scheduledInterval || sch.interval || `Day ${seq * 2}`;

            let body = '';
            if (stage === 'INITIAL') {
                body = `வணக்கம் {{customer_name}}, ${bus} வழங்கும் ${title}! ${disc ? `${disc} ` : ''}${code ? `குறியீடு: ${code}. ` : ''}தொடர்புக்கு: {{care_number}}.`;
            } else if (stage === 'REMINDER') {
                body = `நினைவூட்டல்: வணக்கம் {{customer_name}}, ${bus} இன் ${title} இன்னும் செல்லுபடியாகும். ${code ? `குறியீடு: ${code}.` : ''}`;
            } else if (stage === 'REINFORCEMENT') {
                body = `அன்புள்ள {{customer_name}}, தரமான சேவையை அனுபவிக்கவும்! ${bus} இன் ${title} சலுகையை இன்றே பெறுங்கள்.`;
            } else {
                body = `கடைசி வாய்ப்பு! {{customer_name}}, ${bus} இன் ${title} சலுகை நிறைவடைகிறது. இன்றே வருகை தரவும்!`;
            }

            return {
                id: `fu_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                sequenceNumber: seq,
                stage,
                scheduledInterval: interval,
                language,
                channel,
                messageBody: body,
                eligibilityRule: stage === 'INITIAL' ? 'ALL_ELIGIBLE' : 'NOT_REPLIED',
                approvalStatus: 'PENDING',
                createdAt: new Date().toISOString()
            };
        });
    }
}

module.exports = new GeminiService();
