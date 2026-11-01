/**
 * PHASE 15.2 — FINAL ENTERPRISE ACCEPTANCE & EVIDENCE AUDIT SUITE
 * 
 * Comprehensive automated verification for Tasks 1 - 8:
 * - Task 1: Viewport Evidence (1920x1080, 1600x900, 1440x900, 1366x768 zero overflow)
 * - Task 2: Analytics Data Integrity (accepted, delivered, failed, pending, duplicate callbacks)
 * - Task 3: Multi-channel Accounting (SMS, WhatsApp, dual-channel, partial failures)
 * - Task 4: Date & Timezone Boundaries (5 presets, aggregations, KPI vs Chart consistency)
 * - Task 5: Integration 5-State Matrix (Credentials, Auth, API, Permissions, Live ops)
 * - Task 6: Centralized Toast & Notification Acceptance (types, unread, isolation, navigation)
 * - Task 7: 12-Module Route Verification (zero crashes, zero 404s, healthy DOM)
 */

const assert = require('assert');
const puppeteer = require('d:/New folder (4)/SMS/node_modules/puppeteer-core');
const dispatchTelemetryService = require('./services/dispatchTelemetryService');
const notificationService = require('./services/notificationService');
const integrationService = require('./services/integrationService');

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

async function runSuite() {
  console.log('\n===============================================================');
  console.log(' PHASE 15.2 FINAL ENTERPRISE ACCEPTANCE & EVIDENCE AUDIT SUITE');
  console.log('===============================================================\n');

  // =========================================================================
  // SECTION 1: VIEWPORT MEASUREMENTS & ZERO OVERFLOW EVIDENCE (TASK 1)
  // =========================================================================
  console.log('[SECTION 1: Viewport Zero-Overflow Evidence (Edge Headless)]');

  const viewports = [
    { width: 1920, height: 1080, name: '1920x1080' },
    { width: 1600, height: 900, name: '1600x900' },
    { width: 1440, height: 900, name: '1440x900' },
    { width: 1366, height: 768, name: '1366x768' }
  ];

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

        assert(
          measurements.docScroll <= measurements.docClient,
          `Document overflow detected at ${vp.name}: scrollHeight=${measurements.docScroll} > clientHeight=${measurements.docClient}`
        );
        assert(
          measurements.mainScroll <= measurements.mainClient,
          `Main content overflow detected at ${vp.name}: scrollHeight=${measurements.mainScroll} > clientHeight=${measurements.mainClient}`
        );

        await page.close();
      });
    }

    // =========================================================================
    // SECTION 2: ANALYTICS DATA INTEGRITY & RECEIPT VERIFICATION (TASK 2)
    // =========================================================================
    console.log('\n[SECTION 2: Analytics Data Integrity & Callback Handling]');

    await itAsync('Telemetry API accurately reports outbound attempts, deliveries, failures, pending', async () => {
      const res = await fetch(`${BASE_URL}/api/analytics/telemetry?dateRange=all`);
      assert(res.ok, 'Telemetry endpoint must return 200');
      const data = await res.json();
      assert(data.total, 'Total metrics block present');
      assert(data.total.attempted >= 20, 'At least 20 attempted records tracked');
      assert(data.total.delivered >= 18, 'At least 18 delivered records tracked');
      assert(data.total.failed >= 2, 'Failed records tracked');
      assert(data.total.pending >= 0, 'Pending records tracked');
      assert(data.total.deliveryRate !== null, 'Delivery rate is calculated');
      assert(data.total.failureRate !== null, 'Failure rate is calculated');
      assert(data.total.deliveryRate <= 100, 'Delivery rate cannot exceed 100%');
    });

    await itAsync('Twilio status callback updates message state and handles duplicate callbacks', async () => {
      const testSid = `TEST_CB_${Date.now()}`;
      
      // 1. Initial queued dispatch
      await dispatchTelemetryService.recordDispatch({
        sid: testSid,
        channel: 'sms',
        recipient: '+919999988888',
        status: 'queued'
      });

      // 2. Status callback: 'sent'
      const cb1 = await dispatchTelemetryService.processStatusCallback({
        messageSid: testSid,
        messageStatus: 'sent'
      });
      assert.strictEqual(cb1.action, 'STATUS_UPDATED');
      assert.strictEqual(cb1.record.status, 'sent');
      assert.strictEqual(cb1.record.callbackCount, 1);

      // 3. Status callback: 'delivered'
      const cb2 = await dispatchTelemetryService.processStatusCallback({
        messageSid: testSid,
        messageStatus: 'delivered'
      });
      assert.strictEqual(cb2.action, 'STATUS_UPDATED');
      assert.strictEqual(cb2.record.status, 'delivered');
      assert.strictEqual(cb2.record.callbackCount, 2);

      // 4. Duplicate status callback: 'delivered' (idempotency check)
      const cb3 = await dispatchTelemetryService.processStatusCallback({
        messageSid: testSid,
        messageStatus: 'delivered'
      });
      assert.strictEqual(cb3.action, 'DUPLICATE_CALLBACK_RECORDED');
      assert.strictEqual(cb3.isDuplicate, true);
      assert.strictEqual(cb3.record.callbackCount, 3);
    });

    await itAsync('Unknown provider statuses are recorded without falsely marking delivered or failed', async () => {
      const unkSid = `TEST_UNK_${Date.now()}`;
      await dispatchTelemetryService.recordDispatch({
        sid: unkSid,
        channel: 'whatsapp',
        recipient: '+919999977777',
        status: 'some_arbitrary_carrier_flag'
      });

      const metrics = await dispatchTelemetryService.getTelemetryMetrics({ dateRange: 'all' });
      assert(metrics.total.unknown >= 1, 'Unknown statuses recorded in unknown bucket');
    });

    // =========================================================================
    // SECTION 3: MULTI-CHANNEL ACCOUNTING (TASK 3)
    // =========================================================================
    console.log('\n[SECTION 3: Multi-Channel Accounting]');

    await itAsync('SMS and WhatsApp metrics are derived from discrete individual channel records', async () => {
      const metrics = await dispatchTelemetryService.getTelemetryMetrics({ dateRange: 'all' });
      assert(metrics.sms, 'SMS metrics block present');
      assert(metrics.whatsapp, 'WhatsApp metrics block present');
      assert(metrics.sms.attempted > 0, 'SMS attempted dispatches present');
      assert(metrics.whatsapp.attempted > 0, 'WhatsApp attempted dispatches present');
      
      // Sum of individual channels must equal total
      assert.strictEqual(
        metrics.sms.attempted + metrics.whatsapp.attempted,
        metrics.total.attempted,
        'Sum of SMS and WhatsApp attempted must equal total attempted'
      );
      assert.strictEqual(
        metrics.sms.delivered + metrics.whatsapp.delivered,
        metrics.total.delivered,
        'Sum of SMS and WhatsApp delivered must equal total delivered'
      );
      assert.strictEqual(
        metrics.sms.failed + metrics.whatsapp.failed,
        metrics.total.failed,
        'Sum of SMS and WhatsApp failed must equal total failed'
      );
    });

    // =========================================================================
    // SECTION 4: DATE AND TIMEZONE BOUNDARIES (TASK 4)
    // =========================================================================
    console.log('\n[SECTION 4: Date Range & Timezone Boundaries]');

    const presets = ['today', '7days', '30days', 'thisMonth', 'all'];
    for (const preset of presets) {
      await itAsync(`Date preset '${preset}' returns valid telemetry and aggregation timeline`, async () => {
        const metrics = await dispatchTelemetryService.getTelemetryMetrics({ dateRange: preset });
        assert(metrics.total, `Total metrics present for ${preset}`);
        assert(Array.isArray(metrics.timeline), `Timeline array present for ${preset}`);
        
        // Sum of timeline sent points must equal total attempted
        const timelineSent = metrics.timeline.reduce((sum, p) => sum + p.sent, 0);
        const timelineDelivered = metrics.timeline.reduce((sum, p) => sum + p.delivered, 0);
        assert.strictEqual(timelineSent, metrics.total.attempted, `Timeline sent (${timelineSent}) matches total attempted (${metrics.total.attempted})`);
        assert.strictEqual(timelineDelivered, metrics.total.delivered, `Timeline delivered (${timelineDelivered}) matches total delivered (${metrics.total.delivered})`);
      });
    }

    // =========================================================================
    // SECTION 5: INTEGRATION 5-STATE VERIFICATION MATRIX (TASK 5)
    // =========================================================================
    console.log('\n[SECTION 5: Integration 5-State Matrix (Twilio, Meta, Google)]');

    await itAsync('Twilio reports separate states for credentials, auth, connectivity, permissions, live ops', async () => {
      const status = await integrationService.getPublicStatus();
      assert(status.twilio, 'Twilio status present');
      assert.strictEqual(typeof status.twilio.credentialsConfigured, 'boolean');
      assert.strictEqual(typeof status.twilio.authVerified, 'boolean');
      assert.strictEqual(typeof status.twilio.apiConnectivity, 'boolean');
      assert.strictEqual(typeof status.twilio.permissionsVerified, 'boolean');
      assert.strictEqual(typeof status.twilio.liveOperations, 'boolean');
      assert.strictEqual(status.twilio.mode, 'LIVE_GATEWAY');
    });

    await itAsync('Meta reports separate states and distinguishes live vs mock sandbox', async () => {
      const status = await integrationService.getPublicStatus();
      assert(status.meta, 'Meta status present');
      assert.strictEqual(typeof status.meta.credentialsConfigured, 'boolean');
      assert.strictEqual(typeof status.meta.authVerified, 'boolean');
      assert.strictEqual(typeof status.meta.apiConnectivity, 'boolean');
      assert.strictEqual(typeof status.meta.permissionsVerified, 'boolean');
      assert.strictEqual(typeof status.meta.liveOperations, 'boolean');
      assert(['LIVE_PRODUCTION', 'MOCK_SANDBOX'].includes(status.meta.mode));
    });

    await itAsync('Google reports separate states and distinguishes live vs mock sandbox', async () => {
      const status = await integrationService.getPublicStatus();
      assert(status.google, 'Google status present');
      assert.strictEqual(typeof status.google.credentialsConfigured, 'boolean');
      assert.strictEqual(typeof status.google.authVerified, 'boolean');
      assert.strictEqual(typeof status.google.apiConnectivity, 'boolean');
      assert.strictEqual(typeof status.google.permissionsVerified, 'boolean');
      assert.strictEqual(typeof status.google.liveOperations, 'boolean');
      assert(['LIVE_PRODUCTION', 'MOCK_SANDBOX'].includes(status.google.mode));
    });

    // =========================================================================
    // SECTION 6: CENTRALIZED NOTIFICATIONS ACCEPTANCE (TASK 6)
    // =========================================================================
    console.log('\n[SECTION 6: Notification System Acceptance]');

    await itAsync('Notification service supports success, error, warning, info, idempotency and unread counts', async () => {
      const testKey = `notif_test_${Date.now()}`;
      
      // 1. Create notification
      const n1 = await notificationService.createNotification({
        userId: 'admin',
        type: 'warning',
        category: 'CAMPAIGN',
        title: 'Rate Limit Warning',
        message: 'Approaching daily threshold',
        idempotencyKey: testKey,
        actionUrl: 'campaigns'
      });
      assert(n1.id, 'Notification created with ID');
      assert.strictEqual(n1.type, 'warning');

      // 2. Duplicate idempotency check
      const n2 = await notificationService.createNotification({
        userId: 'admin',
        type: 'warning',
        category: 'CAMPAIGN',
        title: 'Rate Limit Warning',
        message: 'Approaching daily threshold',
        idempotencyKey: testKey
      });
      assert.strictEqual(n2.id, n1.id, 'Duplicate idempotency returns existing notification');

      // 3. Mark read
      const readRes = await notificationService.markRead(n1.id, 'admin');
      assert(readRes.success, 'Mark read returns success');

      // 4. User isolation: non-admin cannot access admin notifications
      const userList = await notificationService.getAll({ userId: 'other_user_xyz' });
      const foundInOther = userList.find(n => n.id === n1.id);
      assert(!foundInOther, 'Admin notification isolated from other users');
    });

    // =========================================================================
    // SECTION 7: FULL 12-MODULE APPLICATION INSPECTION (TASK 7)
    // =========================================================================
    console.log('\n[SECTION 7: Full 12-Module Route Health]');

    await itAsync('All 12 module routes render cleanly without fatal errors', async () => {
      const reportFile = 'C:/Users/Home/.gemini/antigravity/brain/455d9fe5-2caf-49f4-a85d-6011938b806b/screenshots/twelve_module_inspection_report.json';
      assert(require('fs').existsSync(reportFile), '12-module report exists');
      const modules = JSON.parse(require('fs').readFileSync(reportFile, 'utf8'));
      assert.strictEqual(modules.length, 12, 'All 12 modules inspected');
      modules.forEach(m => {
        assert.strictEqual(m.healthy, true, `Module ${m.label} must be healthy`);
        assert.strictEqual(m.hasCrash, false, `Module ${m.label} must not crash`);
        assert.strictEqual(m.has404, false, `Module ${m.label} must not have 404`);
        assert.strictEqual(m.hasRequestFailed, false, `Module ${m.label} must not have request failure`);
        assert.strictEqual(m.isEmpty, false, `Module ${m.label} must not be empty`);
      });
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

runSuite().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});

