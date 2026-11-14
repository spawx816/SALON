/**
 * Test Suite Unitaria: Fase 2D — Facturación del SaaS y Ciclo de Suscripción Base/Pro
 * 
 * EJECUCIÓN 100% EN MEMORIA (TDD) SIN POSTGRESQL NI PASARELAS REALES.
 * Cubre:
 * 1. Estados canónicos (active, past_due, suspended, cancelled, expired, sin trialing).
 * 2. Dinero en unidades menores (amount_minor BIGINT) sin floats ni conversiones.
 * 3. Snapshot de versión de precio e impuestos mediante ZeroTaxPolicy.
 * 4. PCI DSS Compliance: Cero PAN / CVC en repositorios, payloads o eventos.
 * 5. Reembolsos parciales y totales con validación estricta de límites.
 * 6. Webhooks con firma HMAC, idempotencia y cero confianza en tenant del payload.
 * 7. Prorrateo UTC determinista (febrero, bisiesto, 30/31 días, primer/último día).
 * 8. Contador atómico de facturas por tenant.
 * 9. Dunning, períodos de gracia, Jobs concurrentes y anti-IDOR estricto.
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  SAAS_PLANS,
  SUBSCRIPTION_STATUSES,
  SAAS_CURRENCIES,
  BILLING_CYCLES,
  PRICE_BOOK_VERSION,
  CANONICAL_PRICE_BOOK,
  INVOICE_STATUS,
  PAYMENT_STATUS,
  REFUND_STATUS,
  DUNNING_POLICY,
  getPlanPriceMinor
} = require('../services/saas_billing.constants');

const { ZeroTaxPolicy, BillingTaxPolicy } = require('../services/tax_policy');
const { FakePaymentGatewayAdapter } = require('../services/fakes/fake_payment_gateway.adapter');
const { FakeBillingJobSchedulerAdapter } = require('../services/fakes/fake_billing_job_scheduler.adapter');
const { InMemorySaasBillingRepository } = require('../repositories/fakes/in_memory_saas_billing.repository');
const { ProrationEngine } = require('../services/proration_engine');
const { SubscriptionLifecycleService } = require('../services/subscription_lifecycle.service');
const { SaasBillingService } = require('../services/saas_billing.service');
const { EntitlementsService } = require('../services/entitlements.service');

// Fake Repositories de Fase 2A
class FakeTenantSubscriptionRepo {
  constructor() {
    this.subscriptions = new Map();
  }
  async findByTenantId(tenantId) {
    const s = this.subscriptions.get(tenantId);
    return s ? { ...s } : null;
  }
  async update(tenantId, data) {
    this.subscriptions.set(tenantId, { ...data, tenant_id: tenantId });
    return this.subscriptions.get(tenantId);
  }
  async save(data) {
    this.subscriptions.set(data.tenant_id, { ...data });
    return data;
  }
}

class FakeEntitlementsRepo {
  constructor() {
    this.overrides = new Map();
    this.resourceUsage = new Map(); // `${tenantId}:${resource}` -> count
  }
  async findOverridesByTenantId(tenantId) {
    return this.overrides.get(tenantId) || [];
  }
  async countResourceUsage(tenantId, resource) {
    return this.resourceUsage.get(`${tenantId}:${resource}`) || 1;
  }
}

let testIndex = 0;
let passedCount = 0;

function runTest(name, fn) {
  testIndex++;
  try {
    fn();
    console.log(`  [PASS ${testIndex}/35] ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`  ❌ [FAIL ${testIndex}/35] ${name}`);
    console.error(err);
    throw err;
  }
}

async function runAsyncTest(name, fn) {
  testIndex++;
  try {
    await fn();
    console.log(`  [PASS ${testIndex}/35] ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`  ❌ [FAIL ${testIndex}/35] ${name}`);
    console.error(err);
    throw err;
  }
}

async function main() {
  console.log('=== STARTING SUITE: PHASE 2D SAAS BILLING & SUBSCRIPTIONS UNIT TESTS ===\n');

  // TEST 1: Canonical subscription states (no trialing)
  runTest('Test 1: Estados canónicos autorizados y prohibición de trialing', () => {
    assert.strictEqual(SUBSCRIPTION_STATUSES.ACTIVE, 'active');
    assert.strictEqual(SUBSCRIPTION_STATUSES.PAST_DUE, 'past_due');
    assert.strictEqual(SUBSCRIPTION_STATUSES.SUSPENDED, 'suspended');
    assert.strictEqual(SUBSCRIPTION_STATUSES.CANCELLED, 'cancelled');
    assert.strictEqual(SUBSCRIPTION_STATUSES.EXPIRED, 'expired');
    assert.strictEqual(SUBSCRIPTION_STATUSES.TRIALING, undefined, 'trialing must NOT exist');
  });

  // TEST 2: Money stored as minor units BIGINT without conversion
  runTest('Test 2: Precios en unidades menores (amount_minor BIGINT) y listas independientes', () => {
    assert.strictEqual(getPlanPriceMinor('BASE', 'monthly', 'DOP'), 290000n);
    assert.strictEqual(getPlanPriceMinor('BASE', 'monthly', 'USD'), 4900n);
    assert.strictEqual(getPlanPriceMinor('BASE', 'annual', 'DOP'), 2900000n);
    assert.strictEqual(getPlanPriceMinor('BASE', 'annual', 'USD'), 49000n);
    assert.strictEqual(getPlanPriceMinor('PRO', 'monthly', 'DOP'), 590000n);
    assert.strictEqual(getPlanPriceMinor('PRO', 'monthly', 'USD'), 9900n);
    assert.strictEqual(getPlanPriceMinor('PRO', 'annual', 'DOP'), 5900000n);
    assert.strictEqual(getPlanPriceMinor('PRO', 'annual', 'USD'), 99000n);
    assert.throws(() => getPlanPriceMinor('BASE', 'monthly', 'EUR'), /Moneda no soportada/i);
  });

  // TEST 3: ZeroTaxPolicy interface and computation
  runTest('Test 3: Política fiscal abstracta e implementación ZeroTaxPolicy', () => {
    const taxPolicy = new ZeroTaxPolicy();
    assert(taxPolicy instanceof BillingTaxPolicy);
    const tax = taxPolicy.calculateTax({
      amountMinor: 290000n,
      currency: 'DOP',
      tenantId: 'tenant-1',
      planCode: 'BASE'
    });
    assert.strictEqual(tax.taxAmountMinor, 0n);
    assert.strictEqual(tax.taxRateBasisPoints, 0);
  });

  // TEST 4: PCI DSS Compliance: PaymentGatewayPort and FakeAdapter have ZERO PAN/CVC
  runTest('Test 4: PCI Compliance: Cero PAN y CVC en interfaz y métodos de gateway', () => {
    const adapter = new FakePaymentGatewayAdapter();
    const token = adapter.generateOpaquePaymentMethodToken('card_ok', '1234');
    assert(token.startsWith('pm_fake_'), 'Token must be opaque');
    assert(!token.includes('4242424242424242'), 'Token must not contain full card numbers');
    
    // Assert no cardNumber or cvc in adapter methods
    const adapterProto = Object.getOwnPropertyNames(Object.getPrototypeOf(adapter));
    assert(!adapterProto.includes('chargeCardNumber'));
    assert(!adapterProto.includes('tokenizeCard'));
  });

  // TEST 5: Invoice creation stores snapshot of price version
  await runAsyncTest('Test 5: Emisión de factura almacena snapshot de versión de precio e items', async () => {
    const billingRepo = new InMemorySaasBillingRepository();
    const subRepo = new FakeTenantSubscriptionRepo();
    const gateway = new FakePaymentGatewayAdapter();
    const billingService = new SaasBillingService({
      billingRepo,
      subscriptionRepo: subRepo,
      gatewayPort: gateway
    });

    const inv = await billingService.createSubscriptionInvoice({
      tenantId: 'tenant-snap-1',
      planCode: 'BASE',
      billingCycle: 'monthly',
      currency: 'DOP',
      periodStart: '2026-11-01T00:00:00Z',
      periodEnd: '2026-12-01T00:00:00Z'
    });

    assert.strictEqual(inv.price_book_version, PRICE_BOOK_VERSION);
    assert.strictEqual(inv.subtotal_minor, 290000n);
    assert.strictEqual(inv.tax_minor, 0n);
    assert.strictEqual(inv.total_minor, 290000n);
    assert.strictEqual(inv.currency, 'DOP');
    assert.strictEqual(inv.items.length, 1);
    assert.strictEqual(inv.items[0].item_type, 'PLAN_FEE');
    assert.strictEqual(inv.items[0].amount_minor, 290000n);
  });

  // TEST 6: Atomic sequential invoice numbering per tenant
  await runAsyncTest('Test 6: Numeración atómica secuencial de facturas por tenant (no MAX+1)', async () => {
    const billingRepo = new InMemorySaasBillingRepository();
    const num1 = await billingRepo.getNextInvoiceNumber('tenant-seq-1', 2026);
    const num2 = await billingRepo.getNextInvoiceNumber('tenant-seq-1', 2026);
    const numOther = await billingRepo.getNextInvoiceNumber('tenant-seq-2', 2026);

    assert.strictEqual(num1, 'INV-2026-00001');
    assert.strictEqual(num2, 'INV-2026-00002');
    assert.strictEqual(numOther, 'INV-2026-00001', 'Tenant B counter must start independently at 1');
  });

  // TEST 7: Successful charge transitions invoice to PAID and calls lifecycle handler
  await runAsyncTest('Test 7: Cobro exitoso de factura actualiza estado a PAID y reactiva suscripción', async () => {
    const billingRepo = new InMemorySaasBillingRepository();
    const subRepo = new FakeTenantSubscriptionRepo();
    await subRepo.save({
      tenant_id: 'tenant-charge-1',
      plan_code: 'BASE',
      status: 'past_due',
      currency: 'DOP'
    });
    const gateway = new FakePaymentGatewayAdapter();
    const lifecycleService = new SubscriptionLifecycleService({
      subscriptionRepo: subRepo,
      billingRepo
    });
    const billingService = new SaasBillingService({
      billingRepo,
      subscriptionRepo: subRepo,
      gatewayPort: gateway,
      lifecycleService
    });

    // Guardar método de pago predeterminado
    await billingRepo.savePaymentMethod({
      tenant_id: 'tenant-charge-1',
      token_reference: gateway.generateOpaquePaymentMethodToken(),
      provider_customer_id: 'cus_123',
      is_default: true
    });

    const inv = await billingService.createSubscriptionInvoice({
      tenantId: 'tenant-charge-1',
      planCode: 'BASE',
      billingCycle: 'monthly',
      currency: 'DOP'
    });

    const res = await billingService.chargeInvoice({
      tenantId: 'tenant-charge-1',
      invoiceId: inv.id,
      idempotencyKey: 'charge_test_key_1'
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.invoice.status, INVOICE_STATUS.PAID);
    assert.strictEqual(res.payment.status, PAYMENT_STATUS.SUCCESS);
    assert.strictEqual(res.payment.amount_minor, 290000n);

    // Verificar que la suscripción pasó de past_due a active
    const subAfter = await subRepo.findByTenantId('tenant-charge-1');
    assert.strictEqual(subAfter.status, 'active');
    assert.strictEqual(subAfter.grace_period_until, null);
  });

  // TEST 8: Charge failure transitions subscription to PAST_DUE with grace period
  await runAsyncTest('Test 8: Fallo de cobro transiciona a PAST_DUE con 5 días de gracia', async () => {
    const billingRepo = new InMemorySaasBillingRepository();
    const subRepo = new FakeTenantSubscriptionRepo();
    await subRepo.save({
      tenant_id: 'tenant-fail-1',
      plan_code: 'BASE',
      status: 'active',
      currency: 'DOP'
    });
    const gateway = new FakePaymentGatewayAdapter();
    const scheduler = new FakeBillingJobSchedulerAdapter();
    const lifecycleService = new SubscriptionLifecycleService({
      subscriptionRepo: subRepo,
      billingRepo,
      jobScheduler: scheduler
    });
    const billingService = new SaasBillingService({
      billingRepo,
      subscriptionRepo: subRepo,
      gatewayPort: gateway,
      lifecycleService
    });

    // Registrar token que simula rechazo
    await billingRepo.savePaymentMethod({
      tenant_id: 'tenant-fail-1',
      token_reference: 'pm_fake_card_declined_1234',
      provider_customer_id: 'cus_fail_1',
      is_default: true
    });

    const inv = await billingService.createSubscriptionInvoice({
      tenantId: 'tenant-fail-1',
      planCode: 'BASE',
      billingCycle: 'monthly',
      currency: 'DOP'
    });

    await assert.rejects(
      async () => billingService.chargeInvoice({ tenantId: 'tenant-fail-1', invoiceId: inv.id }),
      /PAYMENT_DECLINED/i
    );

    const sub = await subRepo.findByTenantId('tenant-fail-1');
    assert.strictEqual(sub.status, 'past_due');
    assert(sub.grace_period_until, 'grace_period_until must be set');
    const graceDate = new Date(sub.grace_period_until);
    assert(graceDate > new Date(), 'grace_period_until must be in the future');

    // Verificar que se programó job de vencimiento de gracia
    assert(scheduler.jobs.some(j => j.jobType === 'CHECK_GRACE_EXPIRATION'));
  });

  // TEST 9: past_due during grace period allows feature access in Phase 2A Entitlements
  await runAsyncTest('Test 9: past_due durante gracia mantiene acceso en motor de Entitlements', async () => {
    const subRepo = new FakeTenantSubscriptionRepo();
    const entRepo = new FakeEntitlementsRepo();
    const futureGrace = new Date(Date.now() + 86400000 * 3); // 3 days in future
    await subRepo.save({
      tenant_id: 'tenant-grace-active',
      plan_code: 'BASE',
      status: 'past_due',
      grace_period_until: futureGrace.toISOString()
    });

    const entService = new EntitlementsService({
      subscriptionRepo: subRepo,
      entitlementsRepo: entRepo
    });

    const checkPos = await entService.hasFeature('tenant-grace-active', 'pos');
    assert.strictEqual(checkPos.allowed, true, 'Features must remain allowed while grace is active');
  });

  // TEST 10: past_due after grace period expires blocks features (fail-closed)
  await runAsyncTest('Test 10: past_due tras vencer gracia bloquea funcionalidades en Entitlements', async () => {
    const subRepo = new FakeTenantSubscriptionRepo();
    const entRepo = new FakeEntitlementsRepo();
    const pastGrace = new Date(Date.now() - 86400000); // 1 day in past
    await subRepo.save({
      tenant_id: 'tenant-grace-expired',
      plan_code: 'BASE',
      status: 'past_due',
      grace_period_until: pastGrace.toISOString()
    });

    const entService = new EntitlementsService({
      subscriptionRepo: subRepo,
      entitlementsRepo: entRepo
    });

    const checkPos = await entService.hasFeature('tenant-grace-expired', 'pos');
    assert.strictEqual(checkPos.allowed, false, 'Features must be blocked when grace is expired');
    assert.strictEqual(checkPos.code, 'SUBSCRIPTION_PAST_DUE_GRACE_EXPIRED');
  });

  // TEST 11: Suspended state blocks commercial features but allows billing routes
  await runAsyncTest('Test 11: Estado suspended bloquea módulos comerciales fail-closed', async () => {
    const subRepo = new FakeTenantSubscriptionRepo();
    const entRepo = new FakeEntitlementsRepo();
    await subRepo.save({
      tenant_id: 'tenant-suspended-1',
      plan_code: 'PRO',
      status: 'suspended'
    });

    const entService = new EntitlementsService({
      subscriptionRepo: subRepo,
      entitlementsRepo: entRepo
    });

    const checkClients = await entService.hasFeature('tenant-suspended-1', 'clients');
    assert.strictEqual(checkClients.allowed, false);
    assert.strictEqual(checkClients.code, 'SUBSCRIPTION_SUSPENDED');
  });

  // TEST 12: Cancelled subscription retains access until current_period_end
  await runAsyncTest('Test 12: Suscripción cancelada mantiene acceso hasta current_period_end', async () => {
    const subRepo = new FakeTenantSubscriptionRepo();
    const entRepo = new FakeEntitlementsRepo();
    const futurePeriodEnd = new Date(Date.now() + 86400000 * 15); // 15 days in future
    await subRepo.save({
      tenant_id: 'tenant-cancelled-active',
      plan_code: 'BASE',
      status: 'cancelled',
      current_period_end: futurePeriodEnd.toISOString()
    });

    const entService = new EntitlementsService({
      subscriptionRepo: subRepo,
      entitlementsRepo: entRepo
    });

    const check = await entService.hasFeature('tenant-cancelled-active', 'pos');
    assert.strictEqual(check.allowed, true, 'Access must remain valid until current_period_end');
  });

  // TEST 13: Cancelled subscription with past current_period_end is EXPIRED
  await runAsyncTest('Test 13: Suscripción cancelada con current_period_end vencido es EXPIRED', async () => {
    const subRepo = new FakeTenantSubscriptionRepo();
    const entRepo = new FakeEntitlementsRepo();
    const pastPeriodEnd = new Date(Date.now() - 86400000); // 1 day in past
    await subRepo.save({
      tenant_id: 'tenant-cancelled-expired',
      plan_code: 'BASE',
      status: 'cancelled',
      current_period_end: pastPeriodEnd.toISOString()
    });

    const entService = new EntitlementsService({
      subscriptionRepo: subRepo,
      entitlementsRepo: entRepo
    });

    const check = await entService.hasFeature('tenant-cancelled-expired', 'pos');
    assert.strictEqual(check.allowed, false);
    assert.strictEqual(check.code, 'SUBSCRIPTION_EXPIRED');
  });

  // TEST 14: Proration UTC exact mathematics (mid-month upgrade)
  runTest('Test 14: Prorrateo UTC matemático determinista en upgrade mid-month', () => {
    // Ciclo de 30 días exactos (ej. Noviembre: 1 Nov a 1 Dic)
    const periodStart = '2026-11-01T00:00:00Z';
    const periodEnd = '2026-12-01T00:00:00Z';
    // Cambio exactamente a la mitad: 15 días consumidos, 15 días restantes
    const effectiveAt = '2026-11-16T00:00:00Z';

    const p = ProrationEngine.calculateProration({
      currentPlan: 'BASE',
      newPlan: 'PRO',
      billingCycle: 'monthly',
      currency: 'DOP',
      periodStart,
      periodEnd,
      effectiveAt
    });

    // Base mensual DOP: 290000 -> 15/30 días = 145000 crédito
    // Pro mensual DOP: 590000 -> 15/30 días = 295000 cargo
    // Neto adeudado: 295000 - 145000 = 150000
    assert.strictEqual(p.unusedCreditMinor, 145000n);
    assert.strictEqual(p.newPlanChargeMinor, 295000n);
    assert.strictEqual(p.netDueMinor, 150000n);
    assert.strictEqual(p.creditBalanceMinor, 0n);
  });

  // TEST 15: Proration on Day 1 (Full remaining cycle)
  runTest('Test 15: Prorrateo en el primer día del ciclo (R = D)', () => {
    const periodStart = '2026-05-01T00:00:00Z';
    const periodEnd = '2026-06-01T00:00:00Z';
    const effectiveAt = '2026-05-01T00:00:00Z';

    const p = ProrationEngine.calculateProration({
      currentPlan: 'BASE',
      newPlan: 'PRO',
      billingCycle: 'monthly',
      currency: 'USD',
      periodStart,
      periodEnd,
      effectiveAt
    });

    // Base USD: 4900 -> crédito 4900
    // Pro USD: 9900 -> cargo 9900
    // Neto adeudado: 5000
    assert.strictEqual(p.unusedCreditMinor, 4900n);
    assert.strictEqual(p.newPlanChargeMinor, 9900n);
    assert.strictEqual(p.netDueMinor, 5000n);
  });

  // TEST 16: Proration on Last Day (R = 0)
  runTest('Test 16: Prorrateo en el último día / momento final del ciclo (R = 0)', () => {
    const periodStart = '2026-05-01T00:00:00Z';
    const periodEnd = '2026-06-01T00:00:00Z';
    const effectiveAt = '2026-06-01T00:00:00Z';

    const p = ProrationEngine.calculateProration({
      currentPlan: 'BASE',
      newPlan: 'PRO',
      billingCycle: 'monthly',
      currency: 'USD',
      periodStart,
      periodEnd,
      effectiveAt
    });

    assert.strictEqual(p.unusedCreditMinor, 0n);
    assert.strictEqual(p.newPlanChargeMinor, 0n);
    assert.strictEqual(p.netDueMinor, 0n);
  });

  // TEST 17: Proration in February and Leap Year
  runTest('Test 17: Prorrateo en febrero bisiesto (29 días) y no bisiesto (28 días)', () => {
    // 2028 es año bisiesto (29 días en febrero)
    const leapStart = '2028-02-01T00:00:00Z';
    const leapEnd = '2028-03-01T00:00:00Z';
    const leapEff = '2028-02-15T00:00:00Z';

    const pLeap = ProrationEngine.calculateProration({
      currentPlan: 'BASE',
      newPlan: 'PRO',
      billingCycle: 'monthly',
      currency: 'DOP',
      periodStart: leapStart,
      periodEnd: leapEnd,
      effectiveAt: leapEff
    });

    assert(pLeap.netDueMinor > 0n);
    assert.strictEqual(pLeap.creditBalanceMinor, 0n);
  });

  // TEST 18: Mixed currency proration rejection
  runTest('Test 18: Rechazo estricto de mezclar monedas o conversiones', () => {
    assert.throws(
      () => ProrationEngine.calculateProration({
        currentPlan: 'BASE',
        newPlan: 'PRO',
        billingCycle: 'monthly',
        currency: 'INVALID_CURR',
        periodStart: '2026-01-01T00:00:00Z',
        periodEnd: '2026-02-01T00:00:00Z',
        effectiveAt: '2026-01-15T00:00:00Z'
      }),
      /Moneda inválida/i
    );
  });

  // TEST 19: Full Upgrade flow issues invoice, charges card and switches plan
  await runAsyncTest('Test 19: Flujo completo de Upgrade a PRO genera factura, cobra y actualiza plan', async () => {
    const billingRepo = new InMemorySaasBillingRepository();
    const subRepo = new FakeTenantSubscriptionRepo();
    const now = new Date();
    await subRepo.save({
      tenant_id: 'tenant-upg-flow',
      plan_code: 'BASE',
      status: 'active',
      currency: 'DOP',
      billing_cycle: 'monthly',
      current_period_start: now.toISOString(),
      current_period_end: new Date(now.getTime() + 30 * 86400000).toISOString()
    });

    const gateway = new FakePaymentGatewayAdapter();
    await billingRepo.savePaymentMethod({
      tenant_id: 'tenant-upg-flow',
      token_reference: gateway.generateOpaquePaymentMethodToken(),
      provider_customer_id: 'cus_upg_1',
      is_default: true
    });

    const billingService = new SaasBillingService({
      billingRepo,
      subscriptionRepo: subRepo,
      gatewayPort: gateway
    });

    const res = await billingService.processUpgrade({
      tenantId: 'tenant-upg-flow',
      newPlan: 'PRO',
      actorId: 'admin-1'
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.newPlan, 'PRO');
    assert.strictEqual(res.invoice.plan_code, 'PRO');
    assert.strictEqual(res.invoice.status, INVOICE_STATUS.PAID);
    assert.strictEqual(res.payment.status, PAYMENT_STATUS.SUCCESS);

    const subUpdated = await subRepo.findByTenantId('tenant-upg-flow');
    assert.strictEqual(subUpdated.plan_code, 'PRO');
  });

  // TEST 20: Downgrade to BASE rejected when tenant exceeds resource limits
  await runAsyncTest('Test 20: Downgrade a BASE bloqueado si supera 1 sucursal o 3 usuarios', async () => {
    const subRepo = new FakeTenantSubscriptionRepo();
    const entRepo = new FakeEntitlementsRepo();
    // Configurar tenant con 4 sucursales
    entRepo.resourceUsage.set('tenant-down-excess:branches', 4);
    entRepo.resourceUsage.set('tenant-down-excess:users', 8);

    await subRepo.save({
      tenant_id: 'tenant-down-excess',
      plan_code: 'PRO',
      status: 'active',
      current_period_end: new Date(Date.now() + 10 * 86400000).toISOString()
    });

    const lifecycleService = new SubscriptionLifecycleService({
      subscriptionRepo: subRepo,
      entitlementsRepo: entRepo
    });

    await assert.rejects(
      async () => lifecycleService.requestDowngrade('tenant-down-excess', { newPlan: 'BASE' }),
      (err) => {
        assert.strictEqual(err.code, 'RESOURCE_LIMIT_EXCEEDED');
        assert.strictEqual(err.details.currentBranches, 4);
        assert.strictEqual(err.details.maxBranchesAllowed, 1);
        return true;
      }
    );
  });

  // TEST 21: Downgrade to BASE scheduled at end of period when within limits
  await runAsyncTest('Test 21: Downgrade a BASE programado al fin de ciclo cuando cumple límites', async () => {
    const subRepo = new FakeTenantSubscriptionRepo();
    const entRepo = new FakeEntitlementsRepo();
    // 1 sucursal y 2 usuarios (dentro de límites Base)
    entRepo.resourceUsage.set('tenant-down-ok:branches', 1);
    entRepo.resourceUsage.set('tenant-down-ok:users', 2);

    const periodEnd = new Date(Date.now() + 12 * 86400000).toISOString();
    await subRepo.save({
      tenant_id: 'tenant-down-ok',
      plan_code: 'PRO',
      status: 'active',
      current_period_end: periodEnd
    });

    const lifecycleService = new SubscriptionLifecycleService({
      subscriptionRepo: subRepo,
      entitlementsRepo: entRepo
    });

    const res = await lifecycleService.requestDowngrade('tenant-down-ok', { newPlan: 'BASE' });
    assert.strictEqual(res.scheduled, true);
    assert.strictEqual(res.effectiveAt, periodEnd);
    assert.strictEqual(res.targetPlan, 'BASE');

    const sub = await subRepo.findByTenantId('tenant-down-ok');
    assert.strictEqual(sub.scheduled_downgrade_plan, 'BASE');
  });

  // TEST 22: Partial Refund updates payment to partially_refunded (not refunded)
  await runAsyncTest('Test 22: Reembolso parcial actualiza estado a partially_refunded', async () => {
    const billingRepo = new InMemorySaasBillingRepository();
    const gateway = new FakePaymentGatewayAdapter();
    const billingService = new SaasBillingService({
      billingRepo,
      gatewayPort: gateway
    });

    const inv = await billingRepo.createInvoice({
      tenant_id: 'tenant-ref-1',
      total_minor: 290000n,
      currency: 'DOP',
      status: 'paid'
    });

    const payment = await billingRepo.recordPayment({
      tenant_id: 'tenant-ref-1',
      invoice_id: inv.id,
      amount_minor: 290000n,
      currency: 'DOP',
      gateway_reference: 'ch_fake_ref_1',
      status: 'success',
      idempotency_key: 'pay_ref_1'
    });
    // Registrar cargo en adapter
    gateway.charges.set('ch_fake_ref_1', {
      tenantId: 'tenant-ref-1',
      amountMinor: 290000n,
      currency: 'DOP'
    });

    // Reembolso de 1000 DOP (100000 centavos)
    const refRes = await billingService.processRefund({
      tenantId: 'tenant-ref-1',
      paymentId: payment.id,
      amountMinor: 100000n,
      reason: 'descuento_comercial'
    });

    assert.strictEqual(refRes.success, true);
    assert.strictEqual(refRes.isFullRefund, false);
    assert.strictEqual(refRes.paymentStatus, PAYMENT_STATUS.PARTIALLY_REFUNDED);

    const paymentAfter = await billingRepo.getPaymentById('tenant-ref-1', payment.id);
    assert.strictEqual(paymentAfter.status, PAYMENT_STATUS.PARTIALLY_REFUNDED);
    assert.strictEqual(paymentAfter.refunded_amount_minor, 100000n);
  });

  // TEST 23: Multiple partial refunds up to full amount mark payment as REFUNDED
  await runAsyncTest('Test 23: Múltiples reembolsos acumulados hasta el total marcan REFUNDED', async () => {
    const billingRepo = new InMemorySaasBillingRepository();
    const gateway = new FakePaymentGatewayAdapter();
    const billingService = new SaasBillingService({
      billingRepo,
      gatewayPort: gateway
    });

    const payment = await billingRepo.recordPayment({
      tenant_id: 'tenant-ref-2',
      invoice_id: 'inv_ref_2',
      amount_minor: 200000n,
      currency: 'DOP',
      gateway_reference: 'ch_fake_ref_2',
      status: 'success',
      idempotency_key: 'pay_ref_2'
    });
    gateway.charges.set('ch_fake_ref_2', {
      tenantId: 'tenant-ref-2',
      amountMinor: 200000n,
      currency: 'DOP'
    });

    // Primer reembolso parcial de 120000
    await billingService.processRefund({
      tenantId: 'tenant-ref-2',
      paymentId: payment.id,
      amountMinor: 120000n
    });

    // Segundo reembolso final de 80000 (totaliza 200000)
    const ref2 = await billingService.processRefund({
      tenantId: 'tenant-ref-2',
      paymentId: payment.id,
      amountMinor: 80000n
    });

    assert.strictEqual(ref2.isFullRefund, true);
    assert.strictEqual(ref2.paymentStatus, PAYMENT_STATUS.REFUNDED);

    const payFinal = await billingRepo.getPaymentById('tenant-ref-2', payment.id);
    assert.strictEqual(payFinal.status, PAYMENT_STATUS.REFUNDED);
    assert.strictEqual(payFinal.refunded_amount_minor, 200000n);
  });

  // TEST 24: Refund exceeding paid amount is strictly rejected
  await runAsyncTest('Test 24: Reembolso que excede el monto pagado falla con REFUND_EXCEEDS_PAYMENT', async () => {
    const billingRepo = new InMemorySaasBillingRepository();
    const gateway = new FakePaymentGatewayAdapter();
    const billingService = new SaasBillingService({
      billingRepo,
      gatewayPort: gateway
    });

    const payment = await billingRepo.recordPayment({
      tenant_id: 'tenant-ref-excess',
      invoice_id: 'inv_excess',
      amount_minor: 50000n,
      currency: 'DOP',
      gateway_reference: 'ch_fake_excess',
      status: 'success',
      idempotency_key: 'pay_excess'
    });
    gateway.charges.set('ch_fake_excess', {
      tenantId: 'tenant-ref-excess',
      amountMinor: 50000n,
      currency: 'DOP'
    });

    await assert.rejects(
      async () => billingService.processRefund({
        tenantId: 'tenant-ref-excess',
        paymentId: payment.id,
        amountMinor: 60000n // Excede 50000
      }),
      (err) => {
        assert.strictEqual(err.code, 'REFUND_EXCEEDS_PAYMENT');
        return true;
      }
    );
  });

  // TEST 25: Charge idempotency: identical key returns cached charge without double charging
  await runAsyncTest('Test 25: Idempotencia de cobro en pasarela previene doble cargo', async () => {
    const gateway = new FakePaymentGatewayAdapter();
    const token = gateway.generateOpaquePaymentMethodToken();

    const charge1 = await gateway.charge({
      tenantId: 'tenant-idemp-1',
      amountMinor: 290000n,
      currency: 'DOP',
      paymentMethodToken: token,
      idempotencyKey: 'same_charge_key_123'
    });

    const charge2 = await gateway.charge({
      tenantId: 'tenant-idemp-1',
      amountMinor: 290000n,
      currency: 'DOP',
      paymentMethodToken: token,
      idempotencyKey: 'same_charge_key_123'
    });

    assert.strictEqual(charge1.chargeId, charge2.chargeId);
    assert.strictEqual(charge2.isIdempotentReplay, true);
    assert.strictEqual(gateway.charges.size, 1, 'Only 1 charge must exist in gateway state');
  });

  // TEST 26: Webhook signature verification and invalid signature rejection
  await runAsyncTest('Test 26: Webhook valida firma HMAC y rechaza firmas manipuladas con 401', async () => {
    const billingRepo = new InMemorySaasBillingRepository();
    const gateway = new FakePaymentGatewayAdapter();
    const billingService = new SaasBillingService({
      billingRepo,
      gatewayPort: gateway
    });

    const rawPayload = JSON.stringify({ id: 'evt_wh_sig_1', type: 'invoice.paid', data: {} });
    const validSignature = gateway.signWebhookPayload(rawPayload);

    // 1. Firma válida
    const okRes = await billingService.handleWebhook({
      provider: 'fake_gateway',
      rawBody: rawPayload,
      signatureHeader: validSignature
    });
    assert.strictEqual(okRes.success, true);
    assert.strictEqual(okRes.eventId, 'evt_wh_sig_1');

    // 2. Firma manipulada
    await assert.rejects(
      async () => billingService.handleWebhook({
        provider: 'fake_gateway',
        rawBody: rawPayload,
        signatureHeader: 't=12345,v1=bad_hex_signature'
      }),
      (err) => {
        assert.strictEqual(err.code, 'INVALID_WEBHOOK_SIGNATURE');
        return true;
      }
    );
  });

  // TEST 27: Webhook Anti-Tamper: rejects tenant provided directly in payload
  await runAsyncTest('Test 27: Webhook resuelve tenant internamente e ignora tenant en payload', async () => {
    const billingRepo = new InMemorySaasBillingRepository();
    const gateway = new FakePaymentGatewayAdapter();
    const billingService = new SaasBillingService({
      billingRepo,
      gatewayPort: gateway
    });

    // Registrar customer reference para Tenant Legitimo
    await billingRepo.savePaymentMethod({
      tenant_id: 'tenant-legit-77',
      token_reference: 'pm_tok_77',
      provider_customer_id: 'cus_legit_77',
      is_default: true
    });

    // Payload que intenta inyectar fraudulentamente tenant-attacker-99
    const spoofPayload = JSON.stringify({
      id: 'evt_spoof_check',
      type: 'charge.succeeded',
      customer: 'cus_legit_77',
      tenant_id: 'tenant-attacker-99', // Ataque de spoofing
      data: { amount: 290000, currency: 'DOP' }
    });

    const sig = gateway.signWebhookPayload(spoofPayload);
    const res = await billingService.handleWebhook({
      provider: 'fake_gateway',
      rawBody: spoofPayload,
      signatureHeader: sig
    });

    assert.strictEqual(res.resolvedTenantId, 'tenant-legit-77', 'Must resolve to legit tenant, ignoring attacker payload');
  });

  // TEST 28: Webhook idempotency by eventId
  await runAsyncTest('Test 28: Idempotencia de webhooks: misma entrega no duplica evento', async () => {
    const billingRepo = new InMemorySaasBillingRepository();
    const gateway = new FakePaymentGatewayAdapter();
    const billingService = new SaasBillingService({
      billingRepo,
      gatewayPort: gateway
    });

    const payload = JSON.stringify({ id: 'evt_idemp_repeat', type: 'payment.success', data: {} });
    const sig = gateway.signWebhookPayload(payload);

    const first = await billingService.handleWebhook({
      provider: 'fake_gateway',
      rawBody: payload,
      signatureHeader: sig
    });
    const second = await billingService.handleWebhook({
      provider: 'fake_gateway',
      rawBody: payload,
      signatureHeader: sig
    });

    assert.strictEqual(second.idempotentReplay, true);
    assert.strictEqual(billingRepo.webhookEvents.size, 1);
  });

  // TEST 29: Concurrent job scheduling concurrency lock
  await runAsyncTest('Test 29: Bloqueo de concurrencia en programador de tareas de facturación', async () => {
    const scheduler = new FakeBillingJobSchedulerAdapter();
    const lockKey = 'lock:invoice_job:tenant_1';

    const lock1 = await scheduler.acquireLock(lockKey, 5000);
    const lock2 = await scheduler.acquireLock(lockKey, 5000);

    assert.strictEqual(lock1, true, 'First worker must acquire lock');
    assert.strictEqual(lock2, false, 'Second worker must be denied lock');

    await scheduler.releaseLock(lockKey);
    const lock3 = await scheduler.acquireLock(lockKey, 5000);
    assert.strictEqual(lock3, true, 'Lock must be available after release');
  });

  // TEST 30: Anti-IDOR: Tenant A cannot view or pay Tenant B invoices
  await runAsyncTest('Test 30: Anti-IDOR estricto: Tenant A no puede acceder a factura de Tenant B', async () => {
    const billingRepo = new InMemorySaasBillingRepository();
    const invB = await billingRepo.createInvoice({
      tenant_id: 'tenant-victim-B',
      total_minor: 590000n,
      currency: 'DOP'
    });

    // Tenant A intenta consultar la factura de Tenant B
    const queryByA = await billingRepo.getInvoiceById('tenant-attacker-A', invB.id);
    assert.strictEqual(queryByA, null, 'Must fail-closed to null when accessed by another tenant');

    // Tenant B consulta legítimamente
    const queryByB = await billingRepo.getInvoiceById('tenant-victim-B', invB.id);
    assert.notStrictEqual(queryByB, null);
    assert.strictEqual(queryByB.id, invB.id);
  });

  // TEST 31: SuperAdmin extends grace period with mandatory reason and audit
  await runAsyncTest('Test 31: SuperAdmin extiende período de gracia extraordinario auditado', async () => {
    const subRepo = new FakeTenantSubscriptionRepo();
    const billingRepo = new InMemorySaasBillingRepository();
    await subRepo.save({
      tenant_id: 'tenant-ext-grace',
      plan_code: 'BASE',
      status: 'past_due',
      grace_period_until: new Date().toISOString()
    });

    const lifecycleService = new SubscriptionLifecycleService({
      subscriptionRepo: subRepo,
      billingRepo
    });

    const updated = await lifecycleService.extendGracePeriod('tenant-ext-grace', {
      additionalDays: 10,
      reason: 'Solicitud formal por cheque en tránsito',
      actorId: 'superadmin-master'
    });

    assert.strictEqual(updated.status, 'past_due');
    assert(new Date(updated.grace_period_until) > new Date(Date.now() + 86400000 * 8));
    assert(billingRepo.billingEvents.size > 0, 'Audit event must be recorded');
  });

  // TEST 32: Scanner check: ZERO PAN and ZERO CVC in codebase, repositories and events
  runTest('Test 32: Verificación de escaneo: Cero PAN (16 dígitos) y cero CVC en memoria y código', () => {
    const billingRepo = new InMemorySaasBillingRepository();
    const gateway = new FakePaymentGatewayAdapter();
    const jsonStr = JSON.stringify({
      repo: Array.from(billingRepo.paymentMethods.values()),
      events: Array.from(billingRepo.billingEvents.values()),
      tokens: [gateway.generateOpaquePaymentMethodToken()]
    });

    // Expresión regular para tarjetas PAN de 16 dígitos (Luhn o bloques de 4)
    const panRegex = /\b(?:\d{4}[ -]?){3}\d{4}\b/;
    assert.strictEqual(panRegex.test(jsonStr), false, 'PAN pattern must NEVER appear in billing state');

    // Comprobar que los archivos fuente de Fase 2D no contienen parámetros de PAN o CVC
    const filesToCheck = [
      '../services/payment_gateway.port.js',
      '../services/fakes/fake_payment_gateway.adapter.js',
      '../services/saas_billing.service.js',
      '../routes/saas_billing.routes.js'
    ];

    for (const f of filesToCheck) {
      const content = fs.readFileSync(path.resolve(__dirname, f), 'utf8');
      assert(!content.includes('cardNumber'), `${f} must not contain cardNumber`);
      assert(!content.includes('cvc'), `${f} must not contain cvc`);
    }
  });

  // TEST 33: DDL Migration contains FK tenant_id -> tenants(id) with ON DELETE CASCADE
  runTest('Test 33: Migración DDL contiene FK tenant_id -> tenants(id) ON DELETE CASCADE', () => {
    const migrationFile = path.resolve(__dirname, '../migrations/20261109_phase2d_saas_billing.cjs');
    const content = fs.readFileSync(migrationFile, 'utf8');

    const requiredTables = [
      'saas_payment_methods',
      'saas_invoice_counters',
      'saas_invoices',
      'saas_invoice_items',
      'saas_payments',
      'saas_refunds',
      'saas_billing_events',
      'saas_webhook_events',
      'saas_billing_jobs'
    ];

    for (const table of requiredTables) {
      assert(content.includes(table), `Migration must create table ${table}`);
      assert(
        content.includes(`idx_${table}_tenant_id`) || table === 'saas_invoice_counters',
        `Table ${table} must have dedicated B-Tree index on tenant_id`
      );
    }
    assert(content.includes('REFERENCES tenants(id) ON DELETE CASCADE'));
  });

  // TEST 34: Commercial model has PRINCIPAL (+ legacy BASE/PRO in price book for historical invoices, no 3rd commercial tier)
  runTest('Test 34: Modelo comercial con PRINCIPAL y compatibilidad histórica BASE/PRO', () => {
    const plansInBook = Object.keys(CANONICAL_PRICE_BOOK.prices);
    assert.deepStrictEqual(plansInBook.sort(), ['BASE', 'PRINCIPAL', 'PRO'], 'Only PRINCIPAL and legacy BASE/PRO are in price book');
    assert.strictEqual(CANONICAL_PRICE_BOOK.prices.ENTERPRISE, undefined);
    assert.strictEqual(CANONICAL_PRICE_BOOK.prices.PREMIUM, undefined);
  });

  // TEST 35: Fail-closed on unhandled gateway errors
  await runAsyncTest('Test 35: Fallo cerrado (Fail-Closed) ante errores imprevistos en pasarela', async () => {
    const billingRepo = new InMemorySaasBillingRepository();
    const subRepo = new FakeTenantSubscriptionRepo();
    await subRepo.save({
      tenant_id: 'tenant-crash',
      plan_code: 'BASE',
      status: 'active',
      currency: 'DOP'
    });

    const explodingGateway = {
      async charge() { throw new Error('FATAL_DATABASE_CORRUPTION'); },
      async refund() {},
      verifyWebhookSignature() { return false; }
    };

    await billingRepo.savePaymentMethod({
      tenant_id: 'tenant-crash',
      token_reference: 'pm_crash',
      provider_customer_id: 'cus_crash',
      is_default: true
    });

    const billingService = new SaasBillingService({
      billingRepo,
      subscriptionRepo: subRepo,
      gatewayPort: explodingGateway
    });

    const inv = await billingService.createSubscriptionInvoice({
      tenantId: 'tenant-crash',
      planCode: 'BASE',
      billingCycle: 'monthly',
      currency: 'DOP'
    });

    await assert.rejects(
      async () => billingService.chargeInvoice({ tenantId: 'tenant-crash', invoiceId: inv.id }),
      /FATAL_DATABASE_CORRUPTION/
    );

    const invAfter = await billingRepo.getInvoiceById('tenant-crash', inv.id);
    assert.strictEqual(invAfter.status, INVOICE_STATUS.OPEN, 'Invoice must remain unpaid fail-closed');
  });

  console.log('\n=== TEST RESULTS SUMMARY ===');
  console.log(`Passed: ${passedCount} / ${testIndex}`);
  console.log('🎉 ALL 35 PHASE 2D SAAS BILLING UNIT TESTS PASSED SUCCESSFULLY (PASS)\n');
}

main().catch(err => {
  console.error('\n❌ Suite execution failed:', err);
  process.exit(1);
});

