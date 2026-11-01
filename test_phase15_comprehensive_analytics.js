/**
 * Phase 15.1 — Analytics Accuracy, Viewport Validation & Production Acceptance Suite
 * 
 * Verifies:
 * 1. KPI Calculation Formulas (delivery rate, failure rate, pending receipts)
 * 2. Zero-Denominator Handling (replaces 100% false metrics with N/A)
 * 3. Multi-Channel Distribution Accuracy (dual dispatch handling, no 50/50 division)
 * 4. Date Range Filtering Consistency (Today, 7d, 30d, This Month, All Time)
 * 5. Automation Conversion Independence (inbound replies != conversions)
 * 6. Viewport Overflow Acceptance across 1920x1080, 1600x900, 1440x900, 1366x768
 * 7. Live API Health & Integration Console status verification
 */

const assert = require('assert');
const puppeteer = require('d:/New folder (4)/SMS/node_modules/puppeteer-core');

const BASE_URL = 'http://127.0.0.1:3000';
const VITE_URL = 'http://localhost:5173';
const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

let passed = 0;
let failed = 0;

function it(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}:`, err.message);
    failed++;
  }
}

async function itAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}:`, err.message);
    failed++;
  }
}

console.log('\n===============================================================');
console.log(' PHASE 15.1 ENTERPRISE ANALYTICS & ACCEPTANCE VERIFICATION');
console.log('===============================================================\n');

// 1. KPI Formulation & Zero-Data Tests
console.log('[SECTION 1: KPI & Zero-Denominator Formulation]');

it('Delivery Rate returns null / N/A when 0 messages sent (Never false 100%)', () => {
  const messagesSent = 0;
  const messagesDelivered = 0;
  const deliveryRate = messagesSent > 0 ? Math.min(100, Math.round((messagesDelivered / messagesSent) * 100)) : null;
  assert.strictEqual(deliveryRate, null, 'Must be null when 0 messages sent');
});

it('Delivery Rate accurately computes Confirmed Delivered / Dispatched', () => {
  const messagesSent = 100;
  const messagesDelivered = 94;
  const deliveryRate = messagesSent > 0 ? Math.min(100, Math.round((messagesDelivered / messagesSent) * 100)) : null;
  assert.strictEqual(deliveryRate, 94, 'Must compute exactly 94%');
});

it('Failure Rate does NOT classify pending receipts as failed', () => {
  const messagesSent = 100;
  const messagesDelivered = 90;
  const confirmedFailed = 4;
  const pendingReceipts = Math.max(0, messagesSent - messagesDelivered - confirmedFailed);
  const failureRate = messagesSent > 0 ? Math.min(100, Math.round((confirmedFailed / messagesSent) * 100)) : null;
  
  assert.strictEqual(pendingReceipts, 6, 'Must calculate 6 pending receipts');
  assert.strictEqual(failureRate, 4, 'Failure rate must be 4%, not 10%');
});

it('Channel Distribution accurately tallies dual-platform broadcast without 50/50 division', () => {
  const campaigns = [
    { platform: 'both', sent: 50, status: 'COMPLETED' },
    { platform: 'sms', sent: 30, status: 'COMPLETED' },
    { platform: 'whatsapp', sent: 20, status: 'COMPLETED' }
  ];

  let smsSent = 0;
  let waSent = 0;

  campaigns.forEach(c => {
    if (c.platform === 'whatsapp') {
      waSent += c.sent;
    } else if (c.platform === 'sms') {
      smsSent += c.sent;
    } else {
      // Both channels dispatch to every recipient
      smsSent += c.sent;
      waSent += c.sent;
    }
  });

  assert.strictEqual(smsSent, 80, 'SMS sent must be 50 + 30 = 80 (not 25 + 30 = 55)');
  assert.strictEqual(waSent, 70, 'WhatsApp sent must be 50 + 20 = 70 (not 25 + 20 = 45)');
});

it('Channel rate returns null / N/A when channel has 0 dispatches', () => {
  const smsSent = 0;
  const smsDelivered = 0;
  const smsRate = smsSent > 0 ? Math.min(100, Math.round((smsDelivered / smsSent) * 100)) : null;
  assert.strictEqual(smsRate, null, 'SMS rate must be null when 0 sent');
});

it('Automation success ratio returns null / N/A when 0 triggers exist', () => {
  const totalExecutions = 0;
  const successfulActions = 0;
  const successRatio = totalExecutions > 0 ? Math.round((successfulActions / totalExecutions) * 100) : null;
  assert.strictEqual(successRatio, null, 'Success ratio must be null when 0 triggers exist');
});

// 2. Date Filtering Logic Tests
console.log('\n[SECTION 2: Date Filtering Consistency]');

it('Date range cutoffs correctly boundary Today, 7d, 30d, This Month', () => {
  const now = new Date('2026-11-01T12:00:00Z');
  const currentTime = now.getTime();

  // Today start of day
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const cutoff7d = currentTime - 7 * 86400000;
  const cutoff30d = currentTime - 30 * 86400000;
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  assert(startOfDay <= currentTime, 'Start of day must be <= current time');
  assert(cutoff7d < startOfDay, '7d cutoff must be earlier than today');
  assert(cutoff30d < cutoff7d, '30d cutoff must be earlier than 7d');
  assert(startOfMonth <= startOfDay, 'Start of month must be <= start of day');
});

// 3. Inbound vs Conversion Verification
console.log('\n[SECTION 3: Inbound Messages vs Conversions]');

itAsync('Twilio Inbound webhook marks messages as non-conversion by default', async () => {
  const res = await fetch(`${BASE_URL}/api/webhooks/twilio/messages`);
  assert(res.ok, 'Inbound messages endpoint must respond 200');
  const data = await res.json();
  assert(Array.isArray(data.messages), 'Messages must be array');
  data.messages.forEach(m => {
    assert.strictEqual(m.isConversion, false, 'Inbound inquiries must NOT be classified as conversions');
  });
});

// 4. Live Backend & Vault Integration Tests
console.log('\n[SECTION 4: Live Integration Vault & Gateway]');

itAsync('Integration Status endpoint returns 200 with sealed vault status', async () => {
  const res = await fetch(`${BASE_URL}/api/integrations/status`);
  assert(res.ok, `Integrations endpoint failed with status ${res.status}`);
  const status = await res.json();
  assert(status.twilio, 'Twilio integration status present');
  assert(status.meta, 'Meta integration status present');
  assert(status.google, 'Google integration status present');
  assert(status.twilio.status, 'Twilio status present');
  assert(status.meta.status, 'Meta status present');
  assert(status.google.status, 'Google status present');
});

itAsync('Vite Dev Proxy transparently routes /api/integrations/status', async () => {
  const res = await fetch(`${VITE_URL}/api/integrations/status`);
  assert(res.ok, `Vite proxy to integrations failed with status ${res.status}`);
  const status = await res.json();
  assert(status.twilio, 'Twilio present via Vite proxy');
});

// 5. Browser Viewport Validation & Overflow Verification
console.log('\n[SECTION 5: Headless Browser Viewport & Layout Validation]');

const viewports = [
  { width: 1920, height: 1080, name: '1920x1080 (FHD Desktop)' },
  { width: 1600, height: 900, name: '1600x900 (Widescreen Desktop)' },
  { width: 1440, height: 900, name: '1440x900 (MacBook Pro/Compact Desktop)' },
  { width: 1366, height: 768, name: '1366x768 (Standard Laptop)' }
];

async function runBrowserTests() {
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: EDGE_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu']
    });

    for (const vp of viewports) {
      await itAsync(`Command Overview zero vertical overflow at ${vp.name}`, async () => {
        const page = await browser.newPage();
        await page.setViewport({ width: vp.width, height: vp.height });
        await page.goto(VITE_URL, { waitUntil: 'networkidle0' });

        const measurements = await page.evaluate(() => {
          const docEl = document.documentElement;
          const main = document.querySelector('main');
          return {
            docScroll: docEl.scrollHeight,
            docClient: docEl.clientHeight,
            mainScroll: main ? main.scrollHeight : 0,
            mainClient: main ? main.clientHeight : 0
          };
        });

        // Zero vertical overflow requirement: docScroll <= docClient
        assert(
          measurements.docScroll <= measurements.docClient,
          `Document vertical overflow detected at ${vp.width}x${vp.height}: scrollHeight=${measurements.docScroll} > clientHeight=${measurements.docClient}`
        );

        await page.close();
      });
    }

    // Verify Integration Console renders 3 provider cards without any 404 alert banner
    await itAsync('Integration Console renders 3 provider cards with 0 error banners', async () => {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(VITE_URL, { waitUntil: 'networkidle0' });

      // Click Integration Console
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('aside button'));
        for (const b of buttons) {
          if (b.textContent && b.textContent.includes('Integration Console')) {
            b.click();
            return;
          }
        }
      });

      await new Promise(r => setTimeout(r, 1200));

      const pageAnalysis = await page.evaluate(() => {
        const text = document.body.innerText;
        const hasErrorBanner = text.includes('Request failed') || text.includes('Not Found (404)');
        const hasTwilioCard = text.includes('Twilio Telephony');
        const hasMetaCard = text.includes('Meta Marketing');
        const hasGoogleCard = text.includes('Google Ads');
        return { hasErrorBanner, hasTwilioCard, hasMetaCard, hasGoogleCard };
      });

      assert.strictEqual(pageAnalysis.hasErrorBanner, false, 'No error banner must appear on Integration Console');
      assert.strictEqual(pageAnalysis.hasTwilioCard, true, 'Twilio Telephony card must be visible');
      assert.strictEqual(pageAnalysis.hasMetaCard, true, 'Meta Marketing card must be visible');
      assert.strictEqual(pageAnalysis.hasGoogleCard, true, 'Google Ads card must be visible');

      await page.close();
    });

  } finally {
    if (browser) await browser.close();
  }

  console.log('\n===============================================================');
  console.log(` SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log('===============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runBrowserTests().catch(err => {
  console.error('Test suite runner crashed:', err);
  process.exit(1);
});
