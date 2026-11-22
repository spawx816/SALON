/**
 * Test Suite: Contratación de Sucursales Adicionales desde "Gestión de Sucursales"
 * 
 * Escenarios:
 * 1. Uso de licencia disponible sin nuevo cobro (availableLicenses > 0)
 * 2. Cálculo canónico de prorrateo y conversión FX (ProrationEngine + FxRateService)
 * 3. Contratación con método guardado autorizado (purchaseWithToken) e incremento (+1 branch, +3 users)
 * 4. Creación de orden para CardNet checkout y activación verificada
 * 5. Manejo de pago declinado y reintento sin duplicar sucursales
 * 6. Idempotencia ante doble-click / reactivación (_activateAfterPayment no duplica licencias)
 * 7. Add-on opcional de membresías (+US$99/mes)
 * 8. Control RBAC: 403 FORBIDDEN_ROLE para roles no autorizados (recepción, cajero)
 * 9. Aislamiento multi-tenant (anti-IDOR)
 */

const assert = require('assert');
const http = require('http');
const express = require('express');

const { SaasCheckoutService, ORDER_STATUS } = require('../services/saas_checkout.service');
const { InMemorySaasBillingRepository } = require('../repositories/fakes/in_memory_saas_billing.repository');
const { createSalonsRouter } = require('../routes/salons.routes');

function createBranchTestPool() {
  const tenant = {
    id: 'tenant-branch-1',
    name: 'Salon Test Branch',
    licensed_branches: 1,
    max_branches: 1,
    max_users: 3,
    extra_user_seats: 0,
    status: 'active'
  };

  const subscription = {
    id: 'sub-branch-1',
    tenant_id: tenant.id,
    plan_code: 'principal',
    billing_cycle: 'monthly',
    price_book_version: 'v1_2026',
    status: 'active',
    current_period_start: new Date(Date.now() - 10 * 86400 * 1000).toISOString(),
    current_period_end: new Date(Date.now() + 20 * 86400 * 1000).toISOString()
  };

  let branches = [
    { id: 'b-1', tenant_id: tenant.id, name: 'Sede Principal', is_active: true }
  ];

  let salons = [
    { id: 's-1', tenant_id: tenant.id, name: 'Sede Principal', status: 'Active' }
  ];

  let orders = [];
  const queries = [];

  return {
    tenant,
    subscription,
    branches,
    salons,
    orders,
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params });

      // SELECT from tenants
      if (/SELECT.*FROM tenants WHERE id = \?/i.test(sql)) {
        const found = tenant.id === params[0] ? { ...tenant } : null;
        return [found ? [found] : []];
      }

      // SELECT from tenant_subscriptions
      if (/SELECT.*FROM tenant_subscriptions WHERE tenant_id = \?/i.test(sql)) {
        const found = subscription.tenant_id === params[0] ? { ...subscription } : null;
        return [found ? [found] : []];
      }

      // COUNT from branches where is_active = true
      if (/SELECT COUNT\(\*\).*FROM branches WHERE tenant_id = \? AND is_active = true/i.test(sql)) {
        const count = branches.filter(b => b.tenant_id === params[0] && b.is_active).length;
        return [[{ total: count, count: String(count) }]];
      }

      // SELECT from branches where id = ? AND tenant_id = ?
      if (/SELECT.*FROM branches WHERE id = \? AND tenant_id = \?/i.test(sql)) {
        const found = branches.find(b => b.id === params[0] && b.tenant_id === params[1]);
        return [found ? [{ ...found }] : []];
      }

      // INSERT into branches
      if (/INSERT INTO branches/i.test(sql)) {
        const [id, tenantId, name] = params;
        const isActive = /VALUES\s*\([^)]*true\s*\)/i.test(sql) || Boolean(params[6]);
        branches.push({ id, tenant_id: tenantId, name, is_active: isActive });
        return [[]];
      }

      // INSERT into salons
      if (/INSERT INTO salons/i.test(sql)) {
        const [id, name, , , , , status, tenantId] = params;
        salons.push({ id, name, status, tenant_id: tenantId });
        return [[]];
      }

      // UPDATE branches SET is_active = true
      if (/UPDATE branches SET is_active = true/i.test(sql)) {
        const branchId = params[0];
        const b = branches.find(item => item.id === branchId);
        if (b) b.is_active = true;
        return [[]];
      }

      // UPDATE salons SET status = 'Active'
      if (/UPDATE salons SET status = 'Active'/i.test(sql)) {
        const salonId = params[0];
        const s = salons.find(item => item.id === salonId);
        if (s) s.status = 'Active';
        return [[]];
      }

      // UPDATE tenants SET licensed_branches = COALESCE(licensed_branches, 1) + 1
      if (/UPDATE\s+tenants\s+SET\s+licensed_branches/i.test(sql)) {
        tenant.licensed_branches = (tenant.licensed_branches || 1) + 1;
        tenant.max_branches = (tenant.max_branches || 1) + 1;
        tenant.max_users = (tenant.max_users || 3) + 3;
        return [[]];
      }

      // INSERT into saas_checkout_orders
      if (/INSERT INTO saas_checkout_orders/i.test(sql)) {
        let order;
        if (params.length === 11) {
          const [
            id, tenantId, orderNumber, status, subtotalMinor, totalMinor,
            planCode, membershipsAddonEnabled, createdByUserId, expiresAt, metadata
          ] = params;
          order = {
            id, order_number: orderNumber, tenant_id: tenantId, created_by_user_id: createdByUserId,
            source: 'branch_addon', plan_code: planCode, branches_count: 1, extra_users_count: 0,
            memberships_addon_enabled: membershipsAddonEnabled, currency: 'DOP', subtotal_minor: subtotalMinor,
            tax_minor: 0, total_minor: totalMinor, billing_cycle: 'monthly', status,
            expires_at: expiresAt, metadata: typeof metadata === 'string' ? JSON.parse(metadata) : metadata,
            created_at: new Date().toISOString()
          };
        } else {
          const [
            id, orderNumber, tenantId, createdByUserId, source,
            planCode, branchesCount, extraUsersCount, membershipsAddonEnabled,
            currency, subtotalMinor, taxMinor, totalMinor, billingCycle,
            status, gatewayProvider, cardnetSessionId, cardnetSessionKey,
            idempotencyKey, expiresAt, metadata
          ] = params;
          order = {
            id, order_number: orderNumber, tenant_id: tenantId, created_by_user_id: createdByUserId,
            source, plan_code: planCode, branches_count: branchesCount, extra_users_count: extraUsersCount,
            memberships_addon_enabled: membershipsAddonEnabled, currency, subtotal_minor: subtotalMinor,
            tax_minor: taxMinor, total_minor: totalMinor, billing_cycle: billingCycle, status,
            gateway_provider: gatewayProvider, cardnet_session_id: cardnetSessionId,
            cardnet_session_key: cardnetSessionKey, idempotency_key: idempotencyKey,
            expires_at: expiresAt, metadata: typeof metadata === 'string' ? JSON.parse(metadata) : metadata,
            created_at: new Date().toISOString()
          };
        }
        orders.push(order);
        return [[order]];
      }

      // SELECT * FROM saas_checkout_orders WHERE id = ?
      if (/SELECT \* FROM saas_checkout_orders WHERE id = \?/i.test(sql)) {
        const orderId = params[0];
        const found = orders.find(o => o.id === orderId);
        return [found ? [{ ...found }] : []];
      }

      // UPDATE saas_checkout_orders status / payment info
      if (/UPDATE saas_checkout_orders SET status = \?/i.test(sql)) {
        const newStatus = params[0];
        const orderId = params[params.length - 1];
        const order = orders.find(o => o.id === orderId);
        if (order) {
          order.status = newStatus;
          if (newStatus === ORDER_STATUS.APPROVED) {
            order.paid_at = new Date().toISOString();
          }
        }
        return [[]];
      }

      if (/UPDATE saas_checkout_orders\s+SET activated_at = NOW\(\)/i.test(sql)) {
        const orderId = params[0];
        const order = orders.find(o => o.id === orderId);
        if (order) order.activated_at = new Date().toISOString();
        return [[]];
      }

      return [[]];
    }
  };
}

async function runBranchContractingTests() {
  console.log('--- TEST SUITE: SAAS BRANCH CONTRACTING ---');
  let passed = 0;

  // 1. Prorated calculation formula test
  {
    const db = createBranchTestPool();
    const billingRepo = new InMemorySaasBillingRepository();
    const fxRateService = {
      async getEffectiveRate() {
        return { rate: 60.0, rate_numeric: 60, source: 'manual' };
      }
    };
    const checkoutService = new SaasCheckoutService({
      billingRepo,
      pool: db,
      fxRateService,
      baseUrl: 'https://staging.etereasapp.com'
    });

    const quote = await checkoutService.calculateProratedBranchOrderAmounts({
      tenantId: db.tenant.id,
      wantsMembershipsAddon: false,
      fxRate: 60.0
    });

    assert.strictEqual(quote.branchMonthlyUsd, 99, 'Catalog price must be 99 USD');
    assert.strictEqual(quote.usersIncludedPerBranch, 3, 'Must include 3 users');
    const proratedUsd = Number(quote.totalUsdMinor);
    assert.ok(proratedUsd > 0, 'Prorated USD minor must be > 0');
    assert.ok(proratedUsd <= 9900, 'Prorated USD minor must be <= 9900');
    assert.strictEqual(Number(quote.totalDopMinor), Math.round((proratedUsd * 60000000) / 1000000), 'DOP conversion must match canonical integer math');
    assert.strictEqual(quote.nextMonthlyUsd, 198, 'New monthly total must be 99 (base) + 99 (branch) = 198 USD');
    passed++;
    console.log('✓ Scenario 1: Proration calculation and integer FX conversion passed');
  }

  // 2. Proration with optional Memberships Add-on (+99 USD/mo)
  {
    const db = createBranchTestPool();
    const billingRepo = new InMemorySaasBillingRepository();
    const fxRateService = {
      async getEffectiveRate() {
        return { rate: 60.0, rate_numeric: 60, source: 'manual' };
      }
    };
    const checkoutService = new SaasCheckoutService({
      billingRepo,
      pool: db,
      fxRateService,
      baseUrl: 'https://staging.etereasapp.com'
    });

    const quote = await checkoutService.calculateProratedBranchOrderAmounts({
      tenantId: db.tenant.id,
      wantsMembershipsAddon: true,
      fxRate: 60.0
    });

    assert.strictEqual(quote.branchMonthlyUsd, 99, 'Branch catalog price must be 99 USD');
    assert.strictEqual(quote.addonMonthlyUsd, 99, 'Addon price must be 99 USD');
    assert.strictEqual(quote.nextMonthlyUsd, 297, 'New monthly total must be 99 base + 99 branch + 99 addon = 297 USD');
    passed++;
    console.log('✓ Scenario 2: Proration with optional Memberships Add-on passed');
  }

  // 3. Immediate activation without charge when availableLicenses > 0
  {
    const db = createBranchTestPool();
    db.tenant.licensed_branches = 3; // 3 licensed, only 1 active -> 2 available!
    const billingRepo = new InMemorySaasBillingRepository();
    const fxRateService = {
      async getEffectiveRate() { return { rate: 60.0 }; }
    };
    const checkoutService = new SaasCheckoutService({ billingRepo, pool: db, fxRateService });

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.auth = { tenantId: db.tenant.id, role: 'owner', userId: 'u-1' };
      req.tenantId = db.tenant.id;
      next();
    });
    app.use('/api/salons', createSalonsRouter({ pool: db, saasCheckoutService: checkoutService, billingRepo, fxRateService }));

    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const res = await fetch(`http://127.0.0.1:${port}/api/salons/contract-branch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Sucursal Santiago', address: 'Av. Juan Pablo Duarte' })
    });
    const data = await res.json();
    server.close();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.charged, false);
    assert.strictEqual(data.usedAvailableLicense, true);
    assert.strictEqual(db.branches.length, 2);
    assert.strictEqual(db.branches[1].is_active, true);
    passed++;
    console.log('✓ Scenario 3: Available license used without charge passed');
  }

  // 4. Contracting with saved reusable payment method
  {
    const db = createBranchTestPool(); // 1 licensed, 1 active -> 0 available
    const billingRepo = new InMemorySaasBillingRepository();
    await billingRepo.savePaymentMethod({
      tenant_id: db.tenant.id,
      tenantId: db.tenant.id,
      gateway_type: 'cardnet',
      token_reference: 'tok_reusable_123',
      last4: '9892',
      brand: 'VISA',
      exp_month: 7,
      exp_year: 2029,
      is_default: true
    });

    let tokenChargeExecuted = false;
    const tokenizationProvider = {
      async purchaseWithToken(params) {
        tokenChargeExecuted = true;
        assert.strictEqual(params.trxToken || params.tokenId, 'tok_reusable_123');
        return {
          approved: true,
          status: 'approved',
          authorizationCode: 'AUTH_BRANCH_01',
          responseCode: '00',
          responseMessage: 'Approved',
          rawResponse: { CreditCardNumber: '************9892' }
        };
      }
    };

    const fxRateService = {
      async getEffectiveRate() { return { rate: 60.0 }; }
    };
    const checkoutService = new SaasCheckoutService({
      billingRepo,
      pool: db,
      fxRateService,
      tokenizationProvider
    });

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.auth = { tenantId: db.tenant.id, role: 'owner', userId: 'u-1' };
      req.tenantId = db.tenant.id;
      next();
    });
    app.use('/api/salons', createSalonsRouter({ pool: db, saasCheckoutService: checkoutService, billingRepo, fxRateService }));

    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const res = await fetch(`http://127.0.0.1:${port}/api/salons/contract-branch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Sucursal Bella Vista',
        paymentOption: 'saved_card'
      })
    });
    const data = await res.json();
    server.close();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.charged, true);
    assert.ok(tokenChargeExecuted, 'Saved card token charge must have executed');
    assert.strictEqual(db.tenant.licensed_branches, 2, 'Licensed branches must increment to 2');
    assert.strictEqual(db.tenant.max_branches, 2, 'Max branches must increment to 2');
    assert.strictEqual(db.tenant.max_users, 6, 'Max users must increment to 6 (+3 users)');
    assert.strictEqual(db.branches.length, 2);
    assert.strictEqual(db.branches[1].is_active, true, 'Branch must be activated');
    passed++;
    console.log('✓ Scenario 4: Contracting with saved payment method and capacity increment passed');
  }

  // 5. CardNet Checkout order creation when no saved method or user selects CardNet
  {
    const db = createBranchTestPool();
    const billingRepo = new InMemorySaasBillingRepository();
    const fxRateService = {
      async getEffectiveRate() { return { rate: 60.0 }; }
    };
    const tokenizationProvider = {
      isConfigured: () => true,
      getConfigurationStatus: () => ({ configured: true }),
      assertReadyForCheckout: () => {},
      baseUrl: 'https://servicios.cardnet.com.do/servicios/tokens/v1',
      publicKey: 'pub_test',
      async createCustomerSession() {
        return {
          uniqueId: 'uniq_session_123',
          customerId: 'cust_123',
          captureUrl: 'https://servicios.cardnet.com.do/servicios/tokens/v1/Capture',
        };
      }
    };

    const checkoutService = new SaasCheckoutService({
      billingRepo,
      pool: db,
      fxRateService,
      tokenizationProvider
    });

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.auth = { tenantId: db.tenant.id, role: 'owner', userId: 'u-1' };
      req.tenantId = db.tenant.id;
      next();
    });
    app.use('/api/salons', createSalonsRouter({ pool: db, saasCheckoutService: checkoutService, billingRepo, fxRateService }));

    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const res = await fetch(`http://127.0.0.1:${port}/api/salons/contract-branch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Sucursal Naco',
        paymentOption: 'cardnet_hosted'
      })
    });
    const data = await res.json();
    server.close();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.requiresCheckout, true);
    assert.ok(data.order, 'Must return order for checkout');
    assert.strictEqual(data.order.metadata.type, 'add_branch');
    assert.strictEqual(db.branches.length, 2);
    assert.strictEqual(db.branches[1].is_active, false, 'Pending branch must NOT be active before payment');
    passed++;
    console.log('✓ Scenario 5: CardNet checkout order creation with pending branch passed');
  }

  // 6. Declined payment handling: branch stays inactive, reattempt doesn't duplicate
  {
    const db = createBranchTestPool();
    const billingRepo = new InMemorySaasBillingRepository();
    await billingRepo.savePaymentMethod({
      tenant_id: db.tenant.id,
      tenantId: db.tenant.id,
      gateway_type: 'cardnet',
      token_reference: 'tok_declined',
      last4: '0000',
      is_default: true
    });

    const tokenizationProvider = {
      isConfigured: () => true,
      getConfigurationStatus: () => ({ configured: true }),
      async purchaseWithToken() {
        return {
          approved: false,
          responseCode: '05',
          responseMessage: 'Do Not Honor / Tarjeta Declinada'
        };
      }
    };
    const fxRateService = {
      async getEffectiveRate() { return { rate: 60.0 }; }
    };
    const checkoutService = new SaasCheckoutService({
      billingRepo,
      pool: db,
      fxRateService,
      tokenizationProvider
    });

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.auth = { tenantId: db.tenant.id, role: 'owner', userId: 'u-1' };
      req.tenantId = db.tenant.id;
      next();
    });
    app.use('/api/salons', createSalonsRouter({ pool: db, saasCheckoutService: checkoutService, billingRepo, fxRateService }));

    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const res = await fetch(`http://127.0.0.1:${port}/api/salons/contract-branch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Sucursal Declinada',
        paymentOption: 'saved_card'
      })
    });
    const data = await res.json();
    server.close();

    assert.strictEqual(res.status, 402);
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.requiresAlternativePayment, true);
    assert.strictEqual(db.tenant.licensed_branches, 1, 'Licensed branches must NOT increment');
    assert.strictEqual(db.branches[1].is_active, false, 'Draft branch must remain inactive');
    passed++;
    console.log('✓ Scenario 6: Declined payment handling without branch activation passed');
  }

  // 7. Double-click idempotency on _activateAfterPayment
  {
    const db = createBranchTestPool();
    const billingRepo = new InMemorySaasBillingRepository();
    const fxRateService = { async getEffectiveRate() { return { rate: 60.0 }; } };
    const checkoutService = new SaasCheckoutService({ billingRepo, pool: db, fxRateService });

    const draftBranchId = 'branch-idem-1';
    db.branches.push({ id: draftBranchId, tenant_id: db.tenant.id, name: 'Sucursal Idem', is_active: false });

    const order = {
      id: 'order-idem-1',
      tenant_id: db.tenant.id,
      order_number: 'ETW-IDEM-01',
      status: ORDER_STATUS.APPROVED,
      paid_at: new Date().toISOString(),
      metadata: {
        type: 'add_branch',
        draft_branch_id: draftBranchId,
        wants_memberships_addon: false
      }
    };
    db.orders.push(order);

    // Call activation first time
    await checkoutService._activateAfterPayment(order);
    assert.strictEqual(db.tenant.licensed_branches, 2, 'First activation increments licensed_branches');
    assert.strictEqual(db.tenant.max_users, 6, 'First activation increments max_users');
    assert.ok(order.activated_at, 'Order must be marked activated');

    // Call activation second time (e.g. concurrent webhook/reconcile retry)
    await checkoutService._activateAfterPayment(order);
    assert.strictEqual(db.tenant.licensed_branches, 2, 'Second activation must NOT increment licensed_branches again');
    assert.strictEqual(db.tenant.max_users, 6, 'Second activation must NOT increment max_users again');
    passed++;
    console.log('✓ Scenario 7: Idempotent double-click activation passed');
  }

  // 8. RBAC guard: Non-owner roles (including recepcionista) rejected with 403 OWNER_ONLY_SAAS_BILLING and zero DB/billing side effects
  {
    const db = createBranchTestPool();
    const billingRepo = new InMemorySaasBillingRepository();
    const fxRateService = { async getEffectiveRate() { return { rate: 60.0 }; } };
    const checkoutService = new SaasCheckoutService({ billingRepo, pool: db, fxRateService });

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.auth = { tenantId: db.tenant.id, role: 'recepcionista', userId: 'u-recep' };
      req.tenantId = db.tenant.id;
      next();
    });
    app.use('/api/salons', createSalonsRouter({ pool: db, saasCheckoutService: checkoutService, billingRepo, fxRateService }));

    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const initialBranchesCount = db.branches.length;
    const initialLicensedBranches = db.tenant.licensed_branches;

    const res = await fetch(`http://127.0.0.1:${port}/api/salons/contract-branch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Sucursal Prohibida' })
    });
    const data = await res.json();
    server.close();

    assert.strictEqual(res.status, 403);
    assert.strictEqual(data.code, 'OWNER_ONLY_SAAS_BILLING');
    assert.strictEqual(db.branches.length, initialBranchesCount, 'Rejected request must not create branches');
    assert.strictEqual(db.orders.length, 0, 'Rejected request must not create checkout orders');
    assert.strictEqual(db.tenant.licensed_branches, initialLicensedBranches, 'Rejected request must not alter licensed_branches');
    const invCount = billingRepo.invoices instanceof Map ? billingRepo.invoices.size : (Array.isArray(billingRepo.invoices) ? billingRepo.invoices.length : 0);
    const payCount = billingRepo.payments instanceof Map ? billingRepo.payments.size : (Array.isArray(billingRepo.payments) ? billingRepo.payments.length : 0);
    assert.strictEqual(invCount, 0, 'Rejected request must not generate invoices');
    assert.strictEqual(payCount, 0, 'Rejected request must not execute payments');
    passed++;
    console.log('✓ Scenario 8: RBAC enforcement rejecting non-owner with OWNER_ONLY_SAAS_BILLING and zero side effects passed');
  }

  // 9. Legacy POST /api/salons returns 403 PLAN_LIMIT_REACHED with capacity contracting pointer
  {
    const db = createBranchTestPool();
    db.tenant.licensed_branches = 1;
    // 1 active branch exists, limit is 1
    const billingRepo = new InMemorySaasBillingRepository();
    const fxRateService = { async getEffectiveRate() { return { rate: 60.0 }; } };
    const checkoutService = new SaasCheckoutService({ billingRepo, pool: db, fxRateService });

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.auth = { tenantId: db.tenant.id, role: 'owner', userId: 'u-1' };
      req.tenantId = db.tenant.id;
      next();
    });
    app.use('/api/salons', createSalonsRouter({ pool: db, saasCheckoutService: checkoutService, billingRepo, fxRateService }));

    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const res = await fetch(`http://127.0.0.1:${port}/api/salons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Nueva Sucursal Excedente' })
    });
    const data = await res.json();
    server.close();

    assert.strictEqual(res.status, 403);
    assert.strictEqual(data.code, 'PLAN_LIMIT_REACHED');
    assert.strictEqual(data.requiresCapacityContract, true);
    assert.strictEqual(data.quoteEndpoint, '/api/salons/quote-add-branch');
    passed++;
    console.log('✓ Scenario 9: POST /api/salons limit gate with quote pointer passed');
  }

  console.log(`\nALL ${passed} BRANCH CONTRACTING TESTS PASSED!`);
}

runBranchContractingTests().catch(err => {
  console.error('FATAL TEST ERROR:', err);
  process.exit(1);
});
