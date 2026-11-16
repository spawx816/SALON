/**
 * Test Suite: Conciliación Post-Pago CardNet <-> Mi Suscripción (Factura, Pago, Método, Recibo)
 */

const assert = require('assert');
const http = require('http');
const express = require('express');

const { SaasCheckoutService, ORDER_STATUS } = require('../services/saas_checkout.service');
const { InMemorySaasBillingRepository } = require('../repositories/fakes/in_memory_saas_billing.repository');
const { PgSaasBillingRepository } = require('../repositories/pg_saas_billing.repository');
const { createSaasBillingRouter } = require('../routes/saas_billing.routes');

function createOrderPoolMock(initialOrder) {
  let order = { ...initialOrder };
  const queries = [];
  return {
    queries,
    getOrder: () => ({ ...order }),
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (/SELECT \* FROM saas_checkout_orders WHERE id = \? AND tenant_id = \?/i.test(sql)) {
        return [[order.id === params[0] && order.tenant_id === params[1] ? { ...order } : null].filter(Boolean)];
      }
      if (/SELECT \* FROM saas_checkout_orders WHERE id = \?/i.test(sql)) {
        return [[order.id === params[0] ? { ...order } : null].filter(Boolean)];
      }
      if (/UPDATE saas_checkout_orders SET masked_card = \?/i.test(sql)) {
        order.masked_card = params[0];
        return [[]];
      }
      if (/UPDATE saas_checkout_orders SET invoice_id = \?/i.test(sql)) {
        order.invoice_id = params[0];
        return [[]];
      }
      if (/UPDATE saas_checkout_orders\s+SET activated_at = NOW\(\)/i.test(sql)) {
        order.activated_at = new Date().toISOString();
        order.last_error = null;
        return [[]];
      }
      if (/SELECT id, current_period_start, current_period_end FROM tenant_subscriptions/i.test(sql)) {
        return [[{ id: 'sub_1', current_period_start: '2026-11-15T20:45:14Z', current_period_end: '2026-12-15T20:45:14Z' }]];
      }
      if (/UPDATE tenants SET status = 'active'/i.test(sql)) {
        return [[]];
      }
      return [[]];
    },
  };
}

async function runTests() {
  let passed = 0;

  // 1. Reconciliación idempotente de orden aprobada sin factura ni método de pago
  {
    const tenantId = 'a1ba3002-d50f-4d1d-91ce-ada0e97f37f8';
    const orderId = '17bea222-f226-41f3-a7ac-6b4aef736f3a';
    const pool = createOrderPoolMock({
      id: orderId,
      tenant_id: tenantId,
      order_number: 'ETWIAZS1FF3F217',
      plan_code: 'principal',
      branches_count: 1,
      extra_users_count: 0,
      memberships_addon_enabled: false,
      currency: 'DOP',
      subtotal_minor: '990',
      tax_minor: '0',
      total_minor: '990',
      status: ORDER_STATUS.APPROVED,
      invoice_id: null,
      cardnet_session_key: '10179072',
      cardnet_authorization_code: '017913',
      cardnet_response_code: '00',
      masked_card: null,
      paid_at: '2026-11-15T20:45:14.056Z',
      activated_at: '2026-11-15T20:45:14.063Z',
      metadata: {
        fx_snapshot: {
          pair: 'USD_DOP',
          rate: 0.1,
          rate_formatted: '0.1000',
          usd: { total_minor: '9900' },
          dop: { total_minor: '990', tax_minor: '0' },
        },
      },
    });

    const billingRepo = new InMemorySaasBillingRepository();
    let chargeCalls = 0;
    let profileCalls = 0;

    const tokenizationProvider = {
      async purchaseWithToken() {
        chargeCalls += 1;
        throw new Error('NO DEBE COBRAR DE NUEVO');
      },
      async getCustomerProfile(customerId) {
        profileCalls += 1;
        assert.strictEqual(customerId, '10179072');
        return {
          customerId: '10179072',
          paymentProfiles: [
            {
              paymentProfileId: '10847564',
              brand: 'VISA',
              last4: '3481',
              expMonth: 10,
              expYear: 2028,
              token: 'tok_secret_never_exposed',
              enabled: true,
            },
          ],
        };
      },
    };

    const service = new SaasCheckoutService({
      pool,
      tokenizationProvider,
      billingRepo,
    });

    const res1 = await service.reconcileApprovedOrder({ orderId, tenantId, actorUserId: 'admin-1' });
    assert.strictEqual(res1.activated, true);
    assert.strictEqual(res1.reconciled, true);
    assert.strictEqual(chargeCalls, 0, 'Nunca debe volver a cobrar');
    assert.strictEqual(profileCalls, 1);

    const invoices = await billingRepo.listInvoices(tenantId);
    assert.strictEqual(invoices.length, 1);
    assert.strictEqual(invoices[0].total_minor, 990n);
    assert.strictEqual(invoices[0].currency, 'DOP');
    assert.strictEqual(invoices[0].status, 'paid');

    const payments = await billingRepo.listPaymentsByInvoice(tenantId, invoices[0].id);
    assert.strictEqual(payments.length, 1);
    assert.strictEqual(payments[0].amount_minor, 990n);
    assert.strictEqual(payments[0].gateway_reference, '017913');

    const methods = await billingRepo.getPaymentMethods(tenantId);
    assert.strictEqual(methods.length, 1);
    assert.strictEqual(methods[0].brand, 'VISA');
    assert.strictEqual(methods[0].last4, '3481');
    assert.strictEqual(methods[0].exp_month, 10);
    assert.strictEqual(methods[0].exp_year, 2028);

    // Segundo callback / conciliación repetida: 100% idempotente
    const res2 = await service.verifyAndFinalizeOrder({ orderId, tenantId });
    assert.strictEqual(res2.alreadyProcessed, true);
    assert.strictEqual(chargeCalls, 0);
    assert.strictEqual((await billingRepo.listInvoices(tenantId)).length, 1, 'No debe duplicar factura');
    assert.strictEqual((await billingRepo.listPaymentsByInvoice(tenantId, invoices[0].id)).length, 1, 'No debe duplicar pago');

    // Enlace de rutas Express + anti-IDOR + recibo sin token ni NCF
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.tenantId = req.headers['x-test-tenant'] || tenantId;
      req.auth = { userId: 'u1', role: 'propietario' };
      next();
    });
    app.use('/api/saas/billing', createSaasBillingRouter({
      billingService: {},
      lifecycleService: {},
      billingRepo,
      checkoutService: service,
    }));

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const pmRes = await fetch(`${baseUrl}/api/saas/billing/payment-methods`);
      const pmBody = await pmRes.json();
      assert.strictEqual(pmRes.status, 200);
      assert.strictEqual(pmBody.paymentMethods.length, 1);
      assert.strictEqual(pmBody.paymentMethods[0].last4, '3481');
      assert.strictEqual(pmBody.paymentMethods[0].token_reference, undefined, 'Nunca exponer token al frontend');
      assert.strictEqual(JSON.stringify(pmBody).includes('tok_secret_never_exposed'), false);

      const recJsonRes = await fetch(`${baseUrl}/api/saas/billing/invoices/${invoices[0].id}/receipt`);
      const recJsonBody = await recJsonRes.json();
      assert.strictEqual(recJsonRes.status, 200);
      assert.strictEqual(recJsonBody.receipt.document_type, 'COMMERCIAL_SAAS_RECEIPT');
      assert.ok(recJsonBody.receipt.fiscal_notice.includes('No es comprobante fiscal'));

      const recHtmlRes = await fetch(`${baseUrl}/api/saas/billing/invoices/${invoices[0].id}/receipt?download=1`);
      const recHtmlText = await recHtmlRes.text();
      assert.strictEqual(recHtmlRes.status, 200);
      assert.ok(recHtmlText.includes('Comprobante Comercial SaaS'));
      assert.ok(recHtmlText.includes('RD$9.90'));

      const idorRes = await fetch(`${baseUrl}/api/saas/billing/invoices/${invoices[0].id}/receipt`, {
        headers: { 'x-test-tenant': '00000000-0000-0000-0000-000000000999' },
      });
      assert.strictEqual(idorRes.status, 404, 'Otro tenant no puede leer el comprobante');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }

    passed += 1;
    console.log('✓ Test 1: Reconciliación idempotente, método, factura, recibo comercial y anti-IDOR');
  }

  // 2. PgSaasBillingRepository contract check (SQL tenant_id & idempotency)
  {
    const seen = [];
    const mockPgPool = {
      async query(sql, params = []) {
        seen.push({ sql, params });
        if (/INSERT INTO saas_payments/i.test(sql)) {
          return [[{
            id: 'pay-pg-1',
            tenant_id: params[0],
            invoice_id: params[1],
            amount_minor: params[2],
            refunded_amount_minor: '0',
            currency: params[3],
            gateway_reference: params[4],
            status: params[5],
            idempotency_key: params[8],
          }]];
        }
        return [[]];
      },
    };
    const pgRepo = new PgSaasBillingRepository(mockPgPool);
    const pay = await pgRepo.recordPayment({
      tenant_id: 't1',
      invoice_id: 'inv1',
      amount_minor: 990n,
      currency: 'DOP',
      gateway_reference: '017913',
      idempotency_key: 'pay_ord_1',
    });
    assert.strictEqual(pay.amount_minor, 990n);
    assert.ok(seen[0].sql.includes('ON CONFLICT (tenant_id, idempotency_key) DO NOTHING'));
    passed += 1;
    console.log('✓ Test 2: PgSaasBillingRepository recordPayment usa ON CONFLICT idempotente');
  }

  console.log(`\nALL ${passed} TESTS PASSED`);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
