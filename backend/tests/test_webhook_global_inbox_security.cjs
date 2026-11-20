/**
 * Real PostgreSQL Security & Integrity Suite: Global Webhook Inbox (saas_webhook_events)
 *
 * Verifies against isolated PostgreSQL test DB (TEST_DB_*):
 * 1. HMAC authenticity check fails closed (401) before DB writes or side effects.
 * 2. Manipulated tenant_id / metadata.internalTenantId without internal reference
 *    resolves to NULL, stores status = 'unresolved_tenant', and applies ZERO side effects.
 * 3. Cross-tenant reference mismatch (customer from Tenant A + order from Tenant B)
 *    is rejected with 422 WEBHOOK_TENANT_MISMATCH and applies ZERO side effects.
 * 4. Amount and currency discrepancies against real saas_checkout_orders are rejected
 *    with 422 WEBHOOK_AMOUNT_MISMATCH / WEBHOOK_CURRENCY_MISMATCH and ZERO side effects.
 * 5. Atomic deduplication by (provider, event_id) under concurrent deliveries:
 *    exactly 1 row in saas_webhook_events and 1 scheduled job.
 */

const assert = require('assert');
const crypto = require('crypto');
const { validateTestEnvironment, createIsolatedTestPool } = require('../utils/test_env_guard.cjs');
const { PgSaasBillingRepository } = require('../repositories/pg_saas_billing.repository');
const { SaasBillingService } = require('../services/saas_billing.service');
const { FakePaymentGatewayAdapter } = require('../services/fakes/fake_payment_gateway.adapter');
const { FakeBillingJobSchedulerAdapter } = require('../services/fakes/fake_billing_job_scheduler.adapter');

async function runWebhookGlobalInboxSuite() {
  console.log('=== START TEST: GLOBAL WEBHOOK INBOX (POSTGRESQL) ===\n');
  const testDbConfig = validateTestEnvironment({ allowDisposableSchema: true });
  const pool = createIsolatedTestPool(testDbConfig);

  const TENANT_A = crypto.randomUUID();
  const TENANT_B = crypto.randomUUID();
  const ts = Date.now();
  const ORD_A = `ORD-WH-PG-A-${ts}`;
  const ORD_B = `ORD-WH-PG-B-${ts}`;
  const CUS_A = `cus_wh_pg_a_${ts}`;
  const eventIds = [
    `evt_pg_bad_sig_${ts}`,
    `evt_pg_tamper_tenant_${ts}`,
    `evt_pg_cross_ref_${ts}`,
    `evt_pg_bad_amt_${ts}`,
    `evt_pg_bad_cur_${ts}`,
    `evt_pg_atomic_${ts}`,
    `evt_pg_cardnet_501_${ts}`,
    `evt_pg_crash_rec_${ts}`
  ];

  let passed = 0;

  try {
    await pool.query(
      "INSERT INTO tenants (id, business_name, slug, email, status) VALUES (?, 'WH Tenant A', ?, ?, 'active')",
      [TENANT_A, `wh-a-${ts}`, `wh.a.${ts}@test-fixtures.local`]
    );
    await pool.query(
      "INSERT INTO tenants (id, business_name, slug, email, status) VALUES (?, 'WH Tenant B', ?, ?, 'active')",
      [TENANT_B, `wh-b-${ts}`, `wh.b.${ts}@test-fixtures.local`]
    );

    const billingRepo = new PgSaasBillingRepository(pool);
    const gateway = new FakePaymentGatewayAdapter({ webhookSecret: 'whsec_pg_test_secret_2026' });
    const scheduler = new FakeBillingJobSchedulerAdapter();
    const billingService = new SaasBillingService({
      billingRepo,
      gatewayPort: gateway,
      jobScheduler: scheduler
    });

    await billingRepo.savePaymentMethod({
      tenant_id: TENANT_A,
      gateway_type: 'cardnet',
      token_reference: `tok_pg_a_${ts}`,
      provider_customer_id: CUS_A,
      last4: '4242',
      brand: 'VISA',
      is_default: true
    });

    const invA = await billingRepo.createInvoice({
      tenant_id: TENANT_A,
      plan_code: 'principal',
      billing_cycle: 'monthly',
      subtotal_minor: 590000n,
      tax_minor: 0n,
      total_minor: 590000n,
      currency: 'DOP',
      status: 'open'
    });
    const invB = await billingRepo.createInvoice({
      tenant_id: TENANT_B,
      plan_code: 'principal',
      billing_cycle: 'monthly',
      subtotal_minor: 590000n,
      tax_minor: 0n,
      total_minor: 590000n,
      currency: 'DOP',
      status: 'open'
    });

    await billingRepo.recordPayment({
      tenant_id: TENANT_A,
      invoice_id: invA.id,
      amount_minor: 590000n,
      currency: 'DOP',
      gateway_reference: ORD_A,
      status: 'pending',
      idempotency_key: `idem_${ORD_A}`
    });
    await billingRepo.recordPayment({
      tenant_id: TENANT_B,
      invoice_id: invB.id,
      amount_minor: 590000n,
      currency: 'DOP',
      gateway_reference: ORD_B,
      status: 'pending',
      idempotency_key: `idem_${ORD_B}`
    });

    // 1. Invalid HMAC signature -> 401, 0 rows, 0 side effects
    const badSigPayload = JSON.stringify({ id: eventIds[0], type: 'checkout.paid', data: { gateway_reference: ORD_A } });
    await assert.rejects(
      async () => billingService.handleWebhook({
        provider: 'fake_gateway',
        rawBody: badSigPayload,
        signatureHeader: 't=12345,v1=deadbeef'
      }),
      (err) => err.code === 'INVALID_WEBHOOK_SIGNATURE' && err.statusCode === 401
    );
    assert.strictEqual(await billingRepo.getWebhookEvent('fake_gateway', eventIds[0]), null);
    assert.strictEqual(scheduler.jobs.length, 0);
    console.log('  [PASS 1/7] Invalid HMAC rejected before DB writes or side effects.');
    passed++;

    // 2. Manipulated tenant_id & metadata.internalTenantId without internal reference -> NULL tenant, 0 side effects
    const tamperPayload = JSON.stringify({
      id: eventIds[1],
      type: 'invoice.paid',
      tenant_id: TENANT_B,
      data: {
        tenant_id: TENANT_B,
        metadata: { internalTenantId: TENANT_B },
        amount_minor: 590000,
        currency: 'DOP'
      }
    });
    const tamperRes = await billingService.handleWebhook({
      provider: 'fake_gateway',
      rawBody: tamperPayload,
      signatureHeader: gateway.signWebhookPayload(tamperPayload)
    });
    assert.strictEqual(tamperRes.resolvedTenantId, null);
    assert.strictEqual(tamperRes.unresolvedTenant, true);
    assert.strictEqual(tamperRes.processed, false);
    assert.strictEqual(scheduler.jobs.length, 0);
    const savedTamper = await billingRepo.getWebhookEvent('fake_gateway', eventIds[1]);
    assert.strictEqual(savedTamper.tenant_id, null);
    assert.strictEqual(savedTamper.status, 'unresolved_tenant');
    console.log('  [PASS 2/7] Manipulated tenant_id ignored; unresolved webhook stored with tenant_id=NULL and 0 side effects.');
    passed++;

    // 3. Cross-tenant reference mismatch (Tenant A customer + Tenant B payment reference) -> 422 WEBHOOK_TENANT_MISMATCH
    const crossPayload = JSON.stringify({
      id: eventIds[2],
      type: 'checkout.paid',
      customer: CUS_A,
      data: { gateway_reference: ORD_B, amount_minor: 590000, currency: 'DOP' }
    });
    await assert.rejects(
      async () => billingService.handleWebhook({
        provider: 'fake_gateway',
        rawBody: crossPayload,
        signatureHeader: gateway.signWebhookPayload(crossPayload)
      }),
      (err) => err.code === 'WEBHOOK_TENANT_MISMATCH' && err.statusCode === 422
    );
    assert.strictEqual(scheduler.jobs.length, 0);
    console.log('  [PASS 3/7] Cross-tenant reference mismatch rejected with 422 and 0 side effects.');
    passed++;

    // 4. Amount and currency discrepancies against real DB payment -> 422
    const badAmtPayload = JSON.stringify({
      id: eventIds[3],
      type: 'checkout.paid',
      data: { gateway_reference: ORD_A, amount_minor: 100, currency: 'DOP' }
    });
    await assert.rejects(
      async () => billingService.handleWebhook({
        provider: 'fake_gateway',
        rawBody: badAmtPayload,
        signatureHeader: gateway.signWebhookPayload(badAmtPayload)
      }),
      (err) => err.code === 'WEBHOOK_AMOUNT_MISMATCH' && err.statusCode === 422
    );
    const badCurPayload = JSON.stringify({
      id: eventIds[4],
      type: 'checkout.paid',
      data: { gateway_reference: ORD_A, amount_minor: 590000, currency: 'USD' }
    });
    await assert.rejects(
      async () => billingService.handleWebhook({
        provider: 'fake_gateway',
        rawBody: badCurPayload,
        signatureHeader: gateway.signWebhookPayload(badCurPayload)
      }),
      (err) => err.code === 'WEBHOOK_CURRENCY_MISMATCH' && err.statusCode === 422
    );
    assert.strictEqual(scheduler.jobs.length, 0);
    console.log('  [PASS 4/7] Amount and currency discrepancies rejected with 422 and 0 side effects.');
    passed++;

    // 5. Concurrent duplicate delivery -> atomic PostgreSQL ON CONFLICT deduplication, 1 row, 1 job
    const validPayload = JSON.stringify({
      id: eventIds[5],
      type: 'checkout.paid',
      tenant_id: TENANT_B, // Spoofed body tenant_id must be ignored; internal reference resolves TENANT_A
      data: { gateway_reference: ORD_A, amount_minor: 590000, currency: 'DOP' }
    });
    const validSig = gateway.signWebhookPayload(validPayload);

    const [c1, c2] = await Promise.all([
      billingService.handleWebhook({ provider: 'fake_gateway', rawBody: validPayload, signatureHeader: validSig }),
      billingService.handleWebhook({ provider: 'fake_gateway', rawBody: validPayload, signatureHeader: validSig })
    ]);
    assert.strictEqual(c1.resolvedTenantId, TENANT_A);
    assert.strictEqual(c2.resolvedTenantId, TENANT_A);
    assert.strictEqual([c1.idempotentReplay, c2.idempotentReplay].filter(Boolean).length, 1);
    assert.strictEqual(scheduler.jobs.length, 1);
    assert.strictEqual(scheduler.jobs[0].tenantId, TENANT_A);
    const [whCountRows] = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM saas_webhook_events WHERE provider = ? AND event_id = ?',
      ['fake_gateway', eventIds[5]]
    );
    assert.strictEqual(Number(whCountRows[0].cnt), 1);
    console.log('  [PASS 5/7] Atomic PostgreSQL deduplication confirmed: 1 row in saas_webhook_events, 1 scheduled job for Tenant A.');
    passed++;

    // 6. CardNet provider fails closed (501) without verified official CardNet webhook verifier
    const cardnetPayload = JSON.stringify({ id: eventIds[6], type: 'checkout.paid', data: { gateway_reference: ORD_A } });
    await assert.rejects(
      async () => billingService.handleWebhook({
        provider: 'cardnet',
        rawBody: cardnetPayload,
        signatureHeader: gateway.signWebhookPayload(cardnetPayload)
      }),
      (err) => err.code === 'WEBHOOK_PROVIDER_AUTH_NOT_SUPPORTED' && err.statusCode === 501
    );
    assert.strictEqual(await billingRepo.getWebhookEvent('cardnet', eventIds[6]), null);
    console.log('  [PASS 6/7] CardNet webhook fails closed (501) without verified official provider auth.');
    passed++;

    // 7. Crash recovery on real PostgreSQL: row saved as 'received' before crash recovers on retry -> 'enqueued' -> subsequent replay is terminal
    const crashPayload = JSON.stringify({
      id: eventIds[7],
      type: 'checkout.paid',
      data: { gateway_reference: ORD_A, amount_minor: 590000, currency: 'DOP' }
    });
    const crashSig = gateway.signWebhookPayload(crashPayload);
    await billingRepo.recordWebhookEvent({
      provider: 'fake_gateway',
      event_id: eventIds[7],
      tenant_id: TENANT_A,
      event_type: 'checkout.paid',
      status: 'received',
      idempotency_key: eventIds[7]
    });
    const recRes = await billingService.handleWebhook({ provider: 'fake_gateway', rawBody: crashPayload, signatureHeader: crashSig });
    assert.strictEqual(recRes.recovered, true);
    assert.strictEqual(recRes.status, 'enqueued');
    assert.strictEqual(scheduler.jobs.length, 2);

    const terminalReplay = await billingService.handleWebhook({ provider: 'fake_gateway', rawBody: crashPayload, signatureHeader: crashSig });
    assert.strictEqual(terminalReplay.idempotentReplay, true);
    assert.strictEqual(terminalReplay.status, 'enqueued');
    assert.strictEqual(scheduler.jobs.length, 2);
    console.log('  [PASS 7/7] PostgreSQL crash recovery confirmed: received -> enqueued on retry, terminal duplicate ignored.');
    passed++;

  } finally {
    try {
      await pool.query('DELETE FROM saas_webhook_events WHERE event_id = ANY(?::text[])', [eventIds]);
      await pool.query('DELETE FROM saas_payments WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]);
      await pool.query('DELETE FROM saas_invoices WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]);
      await pool.query('DELETE FROM saas_invoice_counters WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]);
      await pool.query('DELETE FROM saas_payment_methods WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]);
      await pool.query('DELETE FROM tenants WHERE id IN (?, ?)', [TENANT_A, TENANT_B]);
    } catch (_) {}
    await pool.end();
  }

  console.log(`\n=== TEST RESULT: ALL ${passed}/7 GLOBAL WEBHOOK INBOX PG CHECKS PASSED ===\n`);
}

if (require.main === module) {
  runWebhookGlobalInboxSuite()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[FATAL WEBHOOK INBOX TEST ERROR]:', err);
      process.exit(1);
    });
}

module.exports = { runWebhookGlobalInboxSuite };
