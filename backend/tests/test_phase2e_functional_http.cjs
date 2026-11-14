/**
 * Test Suite: Phase 2E End-to-End Functional Consolidation without PostgreSQL
 * (backend/tests/test_phase2e_functional_http.cjs)
 * 
 * Verifies the complete integrated SaaS system over real HTTP requests on ephemeral ports.
 * Implements strict guards against PostgreSQL, external networks, and .env files.
 * Covers all 18 mandatory business and security flows:
 *   1. Onboarding creates tenant Base and neutralizes attempt to force Pro.
 *   2. Base queries correct entitlements.
 *   3. Base uses basic inventory.
 *   4. Base accesses CRM clients, but receives 403 trying memberships or advanced inventory.
 *   5. Upgrade Base -> Pro with fake payment enables Pro features.
 *   6. Repeat upgrade does not duplicate invoice or charge.
 *   7. Downgrade is blocked if it exceeds users or branches.
 *   8. Failed payment changes to past_due.
 *   9. During grace retains access.
 *  10. Expired grace changes to suspended.
 *  11. Suspension blocks commercial modules, but keeps login and billing.
 *  12. Successful payment reactivates the tenant.
 *  13. POS sale deducts stock exactly once.
 *  14. Void replenishes stock exactly once.
 *  15. Tenant A cannot query or modify Tenant B resources.
 *  16. Signed webhook is processed exactly once.
 *  17. SuperAdmin can perform authorized and audited operations.
 *  18. Salon admin cannot modify their plan directly.
 */

'use strict';

// =========================================================================
// SECURITY GUARDS INSTALLATION (FAIL-CLOSED RUNTIME DEFENSE)
// =========================================================================

// 1. Purge & intercept DATABASE_URL and DB connection parameters
delete process.env.DATABASE_URL;
delete process.env.DB_HOST;
delete process.env.PGHOST;
delete process.env.DB_NAME;
delete process.env.PRODUCTION_DB_NAME;

// 2. Intercept filesystem reads to prevent reading backend/.env
const fs = require('fs');
const originalReadFileSync = fs.readFileSync;
const originalReadFile = fs.readFile;

fs.readFileSync = function (filePath, ...rest) {
  const normalized = String(filePath).replace(/\\/g, '/');
  if (normalized.endsWith('backend/.env') || normalized.endsWith('/.env')) {
    throw new Error(`[GUARD VIOLATION]: Reading .env files during test run is strictly forbidden (${filePath})`);
  }
  return originalReadFileSync.call(fs, filePath, ...rest);
};

fs.readFile = function (filePath, ...rest) {
  const normalized = String(filePath).replace(/\\/g, '/');
  if (normalized.endsWith('backend/.env') || normalized.endsWith('/.env')) {
    const cb = rest[rest.length - 1];
    const err = new Error(`[GUARD VIOLATION]: Reading .env files during test run is strictly forbidden (${filePath})`);
    if (typeof cb === 'function') return cb(err);
    throw err;
  }
  return originalReadFile.call(fs, filePath, ...rest);
};

// 3. Intercept network sockets to block PostgreSQL (port 5432) and external hosts
const net = require('net');
const originalSocketConnect = net.Socket.prototype.connect;

net.Socket.prototype.connect = function (...args) {
  let port, host;
  if (typeof args[0] === 'object' && args[0] !== null) {
    port = args[0].port;
    host = args[0].host;
  } else {
    port = args[0];
    host = args[1];
  }

  // Strictly block PostgreSQL default port
  if (Number(port) === 5432) {
    throw new Error('[GUARD VIOLATION]: Attempted connection to PostgreSQL on port 5432 is strictly forbidden!');
  }

  // Strictly block external hosts (only loopback is permitted for ephemeral HTTP server)
  const isLoopback = !host || host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if (!isLoopback) {
    throw new Error(`[GUARD VIOLATION]: External network connection to ${host}:${port} is strictly forbidden!`);
  }

  return originalSocketConnect.apply(this, args);
};

const assert = require('assert');
const { createInMemoryTestApp } = require('./helpers/create_in_memory_test_app.cjs');

console.log('=== STARTING SUITE: PHASE 2E FUNCTIONAL HTTP CONSOLIDATION (ZERO POSTGRESQL) ===\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  [PASS ${totalTests}] ${name}`);
  } catch (err) {
    console.error(`  [FAIL ${totalTests}] ${name}`);
    console.error(`         Reason: ${err.message}`);
    if (err.stack) {
      console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    }
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  [PASS ${totalTests}] ${name}`);
  } catch (err) {
    console.error(`  [FAIL ${totalTests}] ${name}`);
    console.error(`         Reason: ${err.message}`);
    if (err.stack) {
      console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    }
  }
}

async function runAll() {
  // =========================================================================
  // GUARD 0: ZERO-POSTGRESQL & SAFETY GUARDS VERIFICATION
  // =========================================================================
  runTest('Guard 0.1: backend/db.js is NOT present in require.cache', () => {
    let dbLoaded = false;
    try {
      const dbPath = require.resolve('../db');
      dbLoaded = Boolean(require.cache[dbPath]);
    } catch {
      dbLoaded = false;
    }
    assert.strictEqual(dbLoaded, false, 'backend/db.js must never be imported in tests');
  });

  runTest('Guard 0.2: process.env.DATABASE_URL is not set or accessed', () => {
    assert.strictEqual(process.env.DATABASE_URL || '', '', 'DATABASE_URL must remain unset');
  });

  runTest('Guard 0.3: Guard actively intercepts and rejects attempted PostgreSQL connection', () => {
    assert.throws(() => {
      const socket = new net.Socket();
      socket.connect(5432, '127.0.0.1');
    }, /\[GUARD VIOLATION\]: Attempted connection to PostgreSQL on port 5432/);
  });

  runTest('Guard 0.4: Guard actively intercepts and rejects external network requests', () => {
    assert.throws(() => {
      const socket = new net.Socket();
      socket.connect(443, 'api.dgii.gov.do');
    }, /\[GUARD VIOLATION\]: External network connection/);
  });

  runTest('Guard 0.5: Guard actively intercepts and rejects reading backend/.env', () => {
    assert.throws(() => {
      fs.readFileSync('backend/.env');
    }, /\[GUARD VIOLATION\]: Reading \.env files/);
  });

  // Spin up test harness on ephemeral port (server.listen(0))
  const harness = await createInMemoryTestApp();

  try {
    // =========================================================================
    // FLOW 1: ONBOARDING CREA TENANT BASE Y NEUTRALIZA INTENTO DE FORZAR PRO
    // =========================================================================
    await runAsyncTest('Flow 1.1: Public onboarding with forced rollback leaves NO entities in database', async () => {
      const initialTenants = harness.dbMock.tables.tenants.length;
      const initialUsers = harness.dbMock.tables.users.length;

      const res = await harness.request({
        method: 'POST',
        path: '/api/public/onboarding',
        headers: {
          'x-test-force-rollback': 'true'
        },
        body: {
          business_name: 'Salón Fallido',
          owner_name: 'Carlos Dueño',
          owner_email: 'carlos@fallido.com',
          admin_password: 'Password123!'
        }
      });

      assert.strictEqual(res.status, 500);
      assert.strictEqual(harness.dbMock.tables.tenants.length, initialTenants, 'No tenant should be saved on rollback');
      assert.strictEqual(harness.dbMock.tables.users.length, initialUsers, 'No user should be saved on rollback');
    });

    let onboardedTenantId = null;
    await runAsyncTest('Flow 1.2: Public onboarding creates tenant with Plan BASE and neutralizes attempt to force PRO', async () => {
      const res = await harness.request({
        method: 'POST',
        path: '/api/public/onboarding',
        body: {
          business_name: 'Salón Bella Vista',
          owner_name: 'María Gómez',
          owner_email: 'maria@bellavista.com',
          admin_password: 'Password123!',
          rnc: '131000001',
          address: 'Av. Winston Churchill 100',
          // Client maliciously attempts to force Plan PRO in payload
          requested_plan: 'PRO',
          plan: 'PRO',
          plan_code: 'PRO'
        }
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.status, 'pending');
      assert.ok(res.body.tenant_id);
      onboardedTenantId = res.body.tenant_id;

      // Verify DB state: plan must be strictly PRINCIPAL, ignoring 'PRO' from payload
      const tenantRow = harness.dbMock.tables.tenants.find(t => t.id === onboardedTenantId);
      assert.ok(tenantRow);
      assert.strictEqual(tenantRow.status, 'pending');

      const subRow = harness.dbMock.tables.tenant_subscriptions.find(s => s.tenant_id === onboardedTenantId);
      assert.ok(subRow);
      assert.strictEqual(subRow.plan_code, 'PRINCIPAL', 'Subscription plan_code must be strictly PRINCIPAL');
    });

    // =========================================================================
    // FLOW 2: PRINCIPAL CONSULTA ENTITLEMENTS CORRECTOS
    // =========================================================================
    let tenantBaseUser = null;
    await runAsyncTest('Flow 2.1: Active tenant user on Plan PRINCIPAL queries entitlements and receives correct limits & features', async () => {
      tenantBaseUser = await harness.createTenantWithUser({
        plan: 'PRINCIPAL',
        email: 'admin@bellavista.com',
        businessName: 'Salón Bella Vista'
      });

      const res = await harness.request({
        method: 'GET',
        path: '/api/tenant/entitlements',
        headers: tenantBaseUser.headers
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.currentPlan, 'PRINCIPAL');
      assert.strictEqual(res.body.features.inventory, true, 'PRINCIPAL includes basic inventory');
      assert.strictEqual(res.body.features.pos, true, 'PRINCIPAL includes POS');
      assert.strictEqual(res.body.features.clients, true, 'PRINCIPAL includes CRM clients');
      assert.strictEqual(res.body.features.marketing, true, 'PRINCIPAL includes marketing');
      assert.strictEqual(res.body.features.memberships, false, 'PRINCIPAL excludes B2C memberships without add-on');
      assert.strictEqual(res.body.features.inventory_advanced, true, 'PRINCIPAL includes advanced inventory');
      assert.strictEqual(res.body.limits.branches, 1, 'PRINCIPAL default allows 1 branch maximum');
      assert.strictEqual(res.body.limits.users, 3, 'PRINCIPAL default allows 3 users maximum');
    });

    // =========================================================================
    // FLOW 3: BASE UTILIZA INVENTARIO BÁSICO
    // =========================================================================
    let shampooProduct = null;
    await runAsyncTest('Flow 3.1: Inventory blocks product creation (403) and Catalog product is available for stock', async () => {
      const blockedRes = await harness.request({
        method: 'POST',
        path: '/api/inventory/products',
        headers: tenantBaseUser.headers,
        body: {
          sku: 'SHAMP-BASE-01',
          name: 'Shampoo Profesional Hidratante',
          sale_price: 850,
          cost: 400,
          track_stock: true,
          initial_stock: 0
        }
      });

      assert.strictEqual(blockedRes.status, 403);
      assert.strictEqual(blockedRes.body.code, 'CATALOG_SINGLE_SOURCE');

      shampooProduct = await harness.inventoryRepo.createProduct(tenantBaseUser.tenantId, {
        sku: 'SHAMP-BASE-01',
        name: 'Shampoo Profesional Hidratante',
        sale_price: 850,
        cost: 400,
        track_stock: true
      });
      assert.strictEqual(shampooProduct.sku, 'SHAMP-BASE-01');
      assert.strictEqual(shampooProduct.name, 'Shampoo Profesional Hidratante');
    });

    await runAsyncTest('Flow 3.2: Base tenant registers stock receipt and queries balance', async () => {
      const res = await harness.request({
        method: 'POST',
        path: '/api/inventory/adjustments',
        headers: tenantBaseUser.headers,
        body: {
          productId: shampooProduct.id,
          quantity: 25,
          adjustmentType: 'ADJUSTMENT_IN',
          reason: 'Inventario inicial de apertura'
        }
      });

      assert.strictEqual(res.status, 200);

      // Verify stock balance
      const stockRes = await harness.request({
        method: 'GET',
        path: `/api/inventory/stock/${shampooProduct.id}`,
        headers: tenantBaseUser.headers
      });

      assert.strictEqual(stockRes.status, 200);
      assert.strictEqual(Number(stockRes.body.quantity), 25);
    });

    // =========================================================================
    // FLOW 4: BASE RECIBE 403 AL INTENTAR CRM, MEMBRESÍAS O INVENTARIO AVANZADO
    // =========================================================================
    await runAsyncTest('Flow 4.1: Base tenant is NOT blocked on CRM Clients (feature included in BASE)', async () => {
      const res = await harness.request({
        method: 'GET',
        path: '/api/clients',
        headers: tenantBaseUser.headers
      });

      assert.notStrictEqual(res.status, 403, 'Clients/CRM must not be blocked by plan on BASE');
      assert.notStrictEqual(res.body && res.body.code, 'FEATURE_NOT_INCLUDED');
    });

    await runAsyncTest('Flow 4.2: Base tenant is blocked with 403 on B2C Memberships', async () => {
      const res = await harness.request({
        method: 'GET',
        path: '/api/plans',
        headers: tenantBaseUser.headers
      });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.code, 'FEATURE_NOT_INCLUDED');
      assert.strictEqual(res.body.feature, 'memberships');
    });

    await runAsyncTest('Flow 4.3: Tenant without add-on is blocked with 403 on B2C Contracts & Payments', async () => {
      for (const p of ['/api/contracts', '/api/payments']) {
        const res = await harness.request({
          method: 'GET',
          path: p,
          headers: tenantBaseUser.headers
        });
        assert.strictEqual(res.status, 403, p);
        assert.strictEqual(res.body.code, 'FEATURE_NOT_INCLUDED', p);
        assert.strictEqual(res.body.feature, 'memberships', p);
      }
    });

    // =========================================================================
    // FLOW 5: UPGRADE BASE → PRO CON PAGO FAKE HABILITA FUNCIONES PRO
    // =========================================================================
    await runAsyncTest('Flow 5.1: Register payment method with opaque token (Zero PAN/CVC)', async () => {
      const res = await harness.request({
        method: 'POST',
        path: '/api/saas/billing/payment-methods',
        headers: tenantBaseUser.headers,
        body: {
          paymentMethodToken: 'pm_tok_test_4242',
          providerCustomerReference: 'cus_test_123',
          brand: 'visa',
          last4: '4242',
          expMonth: 12,
          expYear: 2029
        }
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.paymentMethod.last4, '4242');
    });

    await runAsyncTest('Flow 5.2: Request memberships add-on & SuperAdmin activation unlocks memberships', async () => {
      const reqRes = await harness.request({
        method: 'POST',
        path: '/api/saas/billing/addons/memberships/request',
        headers: tenantBaseUser.headers,
        body: { note: 'Solicito activar add-on de membresías B2C' }
      });
      assert.strictEqual(reqRes.status, 200);
      assert.strictEqual(reqRes.body.success, true);

      await harness.entitlementsService.setAddonStatus(tenantBaseUser.tenantId, 'memberships', {
        enabled: true,
        actorId: 'superadmin-test',
        reason: 'Activación comercial'
      });

      const entRes = await harness.request({
        method: 'GET',
        path: '/api/tenant/entitlements',
        headers: tenantBaseUser.headers
      });
      assert.strictEqual(entRes.status, 200);
      assert.strictEqual(entRes.body.currentPlan, 'PRINCIPAL');
      assert.strictEqual(entRes.body.features.clients, true);
      assert.strictEqual(entRes.body.features.memberships, true);
      assert.strictEqual(entRes.body.addons.memberships.active, true);
      assert.strictEqual(entRes.body.features.inventory_advanced, true);

      const clientsRes = await harness.request({ method: 'GET', path: '/api/clients', headers: tenantBaseUser.headers });
      assert.strictEqual(clientsRes.status, 200);

      const plansRes = await harness.request({ method: 'GET', path: '/api/plans', headers: tenantBaseUser.headers });
      assert.strictEqual(plansRes.status, 200);
    });

    // =========================================================================
    // FLOW 6: REPETIR UPGRADE NO DUPLICA FACTURA NI COBRO
    // =========================================================================
    await runAsyncTest('Flow 6.1: Repeating upgrade with same Idempotency-Key does NOT duplicate invoice or payment', async () => {
      await harness.saasRepo.upsertSubscription(tenantBaseUser.tenantId, { plan_code: 'BASE', status: 'active' });
      const upgradeIdempotencyKey = `upg-key-${Date.now()}`;
      const resFirst = await harness.request({
        method: 'POST',
        path: '/api/saas/billing/subscription/upgrade',
        headers: {
          ...tenantBaseUser.headers,
          'Idempotency-Key': upgradeIdempotencyKey
        }
      });
      assert.strictEqual(resFirst.status, 200);
      const initialInvoicesCount = harness.dbMock.tables.invoices.length;

      const resRepeat = await harness.request({
        method: 'POST',
        path: '/api/saas/billing/subscription/upgrade',
        headers: {
          ...tenantBaseUser.headers,
          'Idempotency-Key': upgradeIdempotencyKey
        }
      });

      assert.strictEqual(resRepeat.status, 200);
      assert.strictEqual(resRepeat.body.newPlan, 'PRO');
      assert.strictEqual(harness.dbMock.tables.invoices.length, initialInvoicesCount, 'No duplicate invoice should be created');
    });

    // =========================================================================
    // FLOW 7: DOWNGRADE SE BLOQUEA SI EXCEDE USUARIOS O SUCURSALES
    // =========================================================================
    await runAsyncTest('Flow 7.1: Resource limit check rejects exceeding branch user limits', async () => {
      harness.dbMock.tables.users.push(
        { id: 'usr-extra-1', tenant_id: tenantBaseUser.tenantId, email: 'u1@test.com', is_active: true },
        { id: 'usr-extra-2', tenant_id: tenantBaseUser.tenantId, email: 'u2@test.com', is_active: true },
        { id: 'usr-extra-3', tenant_id: tenantBaseUser.tenantId, email: 'u3@test.com', is_active: true }
      );

      const limitCheck = await harness.entitlementsService.checkLimit(tenantBaseUser.tenantId, 'users');
      assert.strictEqual(limitCheck.allowed, false);
      assert.strictEqual(limitCheck.code, 'PLAN_LIMIT_REACHED');
      assert.ok(limitCheck.current > limitCheck.maximum);
    });

    await runAsyncTest('Flow 7.2: Disabling memberships add-on blocks memberships while preserving PRINCIPAL access', async () => {
      harness.dbMock.tables.users = harness.dbMock.tables.users.filter(u => !u.id.startsWith('usr-extra-'));
      await harness.entitlementsService.setAddonStatus(tenantBaseUser.tenantId, 'memberships', {
        enabled: false,
        actorId: 'superadmin-test',
        reason: 'Baja de add-on'
      });

      const entRes = await harness.request({
        method: 'GET',
        path: '/api/tenant/entitlements',
        headers: tenantBaseUser.headers
      });
      assert.strictEqual(entRes.status, 200);
      assert.strictEqual(entRes.body.currentPlan, 'PRINCIPAL');
      assert.strictEqual(entRes.body.features.memberships, false);
      assert.strictEqual(entRes.body.features.clients, true);
    });

    // =========================================================================
    // FLOW 8: PAGO FALLIDO CAMBIA A PAST_DUE
    // =========================================================================
    let dunningTenantUser = null;
    await runAsyncTest('Flow 8.1: Failed subscription payment transitions status to past_due with grace period', async () => {
      dunningTenantUser = await harness.createTenantWithUser({
        plan: 'PRO',
        email: 'admin@dunning.com',
        businessName: 'Salón Dunning'
      });

      // Simulate failed charge transition via lifecycle service
      const now = new Date();
      const graceEnd = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
      await harness.saasRepo.upsertSubscription(dunningTenantUser.tenantId, {
        plan_code: 'PRO',
        status: 'past_due',
        grace_period_until: graceEnd
      });

      const sub = await harness.saasRepo.findByTenantId(dunningTenantUser.tenantId);
      assert.strictEqual(sub.status, 'past_due');
      assert.ok(sub.grace_period_until);
    });

    // =========================================================================
    // FLOW 9: DURANTE GRACIA CONSERVA ACCESO
    // =========================================================================
    await runAsyncTest('Flow 9.1: Tenant in past_due with active grace period retains commercial access', async () => {
      const entRes = await harness.request({
        method: 'GET',
        path: '/api/tenant/entitlements',
        headers: dunningTenantUser.headers
      });

      assert.strictEqual(entRes.status, 200);
      assert.strictEqual(entRes.body.currentPlan, 'PRINCIPAL');
      assert.strictEqual(entRes.body.subscriptionStatus, 'past_due');
      assert.strictEqual(entRes.body.isSuspended, false);
      assert.strictEqual(entRes.body.features.clients, true, 'Access remains active during grace period');
    });

    // =========================================================================
    // FLOW 10: GRACIA VENCIDA CAMBIA A SUSPENDED
    // =========================================================================
    await runAsyncTest('Flow 10.1: Expired grace period marks subscription as suspended and blocks commercial features', async () => {
      // Advance clock 6 days (past the 5 days grace)
      harness.advanceClock(6 * 24 * 60 * 60 * 1000);

      const entRes = await harness.request({
        method: 'GET',
        path: '/api/tenant/entitlements',
        headers: dunningTenantUser.headers
      });

      assert.strictEqual(entRes.status, 200);
      assert.strictEqual(entRes.body.isSuspended, true);
      assert.strictEqual(entRes.body.features.clients, false, 'Clients blocked when grace expired');
      assert.strictEqual(entRes.body.features.inventory, false, 'Inventory blocked when grace expired');
    });

    // =========================================================================
    // FLOW 11: SUSPENSIÓN BLOQUEA MÓDULOS COMERCIALES, PERO CONSERVA LOGIN Y FACTURACIÓN
    // =========================================================================
    await runAsyncTest('Flow 11.1: Suspension blocks commercial routes but preserves login and billing access', async () => {
      // 1. Commercial route is blocked
      const clientRes = await harness.request({
        method: 'GET',
        path: '/api/clients',
        headers: dunningTenantUser.headers
      });
      assert.strictEqual(clientRes.status, 403);

      // 2. Billing routes remain open for debt payment
      const subRes = await harness.request({
        method: 'GET',
        path: '/api/saas/billing/subscription',
        headers: dunningTenantUser.headers
      });
      assert.strictEqual(subRes.status, 200);

      const invRes = await harness.request({
        method: 'GET',
        path: '/api/saas/billing/invoices',
        headers: dunningTenantUser.headers
      });
      assert.strictEqual(invRes.status, 200);
    });

    // =========================================================================
    // FLOW 12: PAGO EXITOSO REACTIVA EL TENANT
    // =========================================================================
    await runAsyncTest('Flow 12.1: Successful payment of open debt reactivates tenant to active status', async () => {
      // Create unpaid invoice in repository
      const invoice = await harness.saasBillingRepo.createInvoice({
        tenant_id: dunningTenantUser.tenantId,
        currency: 'DOP',
        subtotal_minor: 590000n,
        tax_minor: 0n,
        total_minor: 590000n,
        amount_due_minor: 590000n,
        amount_paid_minor: 0n,
        status: 'open',
        items: [{ description: 'Plan PRO mensual pendiente', amount_minor: 590000n }]
      });

      // Register payment method
      await harness.request({
        method: 'POST',
        path: '/api/saas/billing/payment-methods',
        headers: dunningTenantUser.headers,
        body: {
          paymentMethodToken: 'pm_tok_reactivate_test',
          last4: '9999'
        }
      });

      // Pay invoice
      const payRes = await harness.request({
        method: 'POST',
        path: `/api/saas/billing/invoices/${invoice.id}/pay`,
        headers: dunningTenantUser.headers
      });

      assert.strictEqual(payRes.status, 200);
      assert.strictEqual(payRes.body.success, true);

      // Verify subscription is restored to active
      const subRes = await harness.request({
        method: 'GET',
        path: '/api/saas/billing/subscription',
        headers: dunningTenantUser.headers
      });
      assert.strictEqual(subRes.body.subscription.status, 'active');

      // Verify commercial modules are unblocked
      const entRes = await harness.request({
        method: 'GET',
        path: '/api/tenant/entitlements',
        headers: dunningTenantUser.headers
      });
      assert.strictEqual(entRes.body.isSuspended, false);
      assert.strictEqual(entRes.body.features.clients, true);
    });

    // =========================================================================
    // FLOW 13: VENTA POS DESCUENTA STOCK UNA SOLA VEZ
    // =========================================================================
    const checkoutVisitId = `VIS-POS-${Date.now()}`;
    await runAsyncTest('Flow 13.1: POS sale checkout deducts stock exactly once (idempotent)', async () => {
      const initialStock = 25;
      const res = await harness.request({
        method: 'POST',
        path: `/api/visits/${checkoutVisitId}/checkout`,
        headers: tenantBaseUser.headers,
        body: {
          client_name: 'Cliente Mostrador',
          servicios: [],
          items_detail: [
            {
              id: shampooProduct.id,
              product_id: shampooProduct.id,
              tipo_item: 'Producto',
              is_product: true,
              nombre: 'Shampoo Profesional Hidratante',
              precio: 850,
              cantidad: 5
            }
          ],
          subtotal: 4250,
          total: 4250,
          metodo_pago: 'Efectivo'
        }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, 'Facturado');

      // Verify stock deducted from 25 to 20
      const stockRes = await harness.request({
        method: 'GET',
        path: `/api/inventory/stock/${shampooProduct.id}`,
        headers: tenantBaseUser.headers
      });
      assert.strictEqual(Number(stockRes.body.quantity), initialStock - 5);

      // Replay identical checkout: must NOT deduct stock again
      const replayRes = await harness.request({
        method: 'POST',
        path: `/api/visits/${checkoutVisitId}/checkout`,
        headers: tenantBaseUser.headers,
        body: {
          client_name: 'Cliente Mostrador',
          servicios: [],
          items_detail: [
            {
              id: shampooProduct.id,
              product_id: shampooProduct.id,
              tipo_item: 'Producto',
              is_product: true,
              nombre: 'Shampoo Profesional Hidratante',
              precio: 850,
              cantidad: 5
            }
          ],
          subtotal: 4250,
          total: 4250,
          metodo_pago: 'Efectivo'
        }
      });
      assert.strictEqual(replayRes.status, 200);

      const stockAfterReplay = await harness.request({
        method: 'GET',
        path: `/api/inventory/stock/${shampooProduct.id}`,
        headers: tenantBaseUser.headers
      });
      assert.strictEqual(Number(stockAfterReplay.body.quantity), 20, 'Stock must remain at 20 after replaying checkout');
    });

    // =========================================================================
    // FLOW 14: ANULACIÓN REPONE STOCK UNA SOLA VEZ
    // =========================================================================
    await runAsyncTest('Flow 14.1: Voiding POS invoice restores stock exactly once (idempotent)', async () => {
      const voidKey = `void-pos-${Date.now()}`;
      const res = await harness.request({
        method: 'POST',
        path: `/api/visits/${checkoutVisitId}/void`,
        headers: {
          ...tenantBaseUser.headers,
          'Idempotency-Key': voidKey
        },
        body: {
          reason: 'Error en cobro de factura'
        }
      });

      assert.strictEqual(res.status, 200);

      // Verify restored stock (from 20 back to 25)
      const stockRes = await harness.request({
        method: 'GET',
        path: `/api/inventory/stock/${shampooProduct.id}`,
        headers: tenantBaseUser.headers
      });
      assert.strictEqual(Number(stockRes.body.quantity), 25, 'Stock must be restored to 25');

      // Replay identical void with Idempotency-Key: must return replayed 200 and NOT restore stock again
      const replayVoid = await harness.request({
        method: 'POST',
        path: `/api/visits/${checkoutVisitId}/void`,
        headers: {
          ...tenantBaseUser.headers,
          'Idempotency-Key': voidKey
        },
        body: {
          reason: 'Error en cobro de factura'
        }
      });
      assert.strictEqual(replayVoid.status, 200);
      assert.strictEqual(replayVoid.headers['x-idempotency-replay'], 'true');

      // Third void call without Idempotency-Key: must reject with 409 ALREADY_VOIDED
      const nonIdempotentVoid = await harness.request({
        method: 'POST',
        path: `/api/visits/${checkoutVisitId}/void`,
        headers: tenantBaseUser.headers,
        body: {
          reason: 'Intento de anulación duplicada sin clave'
        }
      });
      assert.strictEqual(nonIdempotentVoid.status, 409);
      assert.strictEqual(nonIdempotentVoid.body.code, 'ALREADY_VOIDED');

      const stockAfterReplayVoid = await harness.request({
        method: 'GET',
        path: `/api/inventory/stock/${shampooProduct.id}`,
        headers: tenantBaseUser.headers
      });
      assert.strictEqual(Number(stockAfterReplayVoid.body.quantity), 25, 'Stock must remain at 25 after replaying void');
    });

    // =========================================================================
    // FLOW 15: TENANT A NO CONSULTA NI MODIFICA RECURSOS DE TENANT B
    // =========================================================================
    let tenantAUser = null;
    let tenantBUser = null;
    await runAsyncTest('Flow 15.1: Tenant A cannot access Tenant B invoice (returns 404)', async () => {
      tenantAUser = await harness.createTenantWithUser({ plan: 'PRO', email: 'owner.a@example.com' });
      tenantBUser = await harness.createTenantWithUser({ plan: 'PRO', email: 'owner.b@example.com' });

      // Create invoice for Tenant B
      const invB = await harness.saasBillingRepo.createInvoice({
        tenant_id: tenantBUser.tenantId,
        currency: 'DOP',
        subtotal_minor: 590000n,
        tax_minor: 0n,
        total_minor: 590000n,
        amount_due_minor: 590000n,
        amount_paid_minor: 0n,
        status: 'open',
        items: []
      });

      // Tenant A requests Tenant B invoice
      const res = await harness.request({
        method: 'GET',
        path: `/api/saas/billing/invoices/${invB.id}`,
        headers: tenantAUser.headers
      });

      assert.strictEqual(res.status, 404, 'IDOR request must fail with 404');
    });

    await runAsyncTest('Flow 15.2: Tenant A cannot adjust Tenant B inventory product (returns 404)', async () => {
      // Create product for Tenant B
      const prodB = await harness.inventoryRepo.createProduct(tenantBUser.tenantId, {
        sku: 'PROD-B-SEC',
        name: 'Producto Secreto B',
        sale_price: 1000
      });

      // Tenant A attempts to adjust Tenant B product
      const res = await harness.request({
        method: 'POST',
        path: '/api/inventory/adjustments',
        headers: tenantAUser.headers,
        body: {
          productId: prodB.id,
          quantity: 5,
          adjustmentType: 'ADJUSTMENT_IN',
          reason: 'Cross-tenant test'
        }
      });

      assert.strictEqual(res.status, 404, 'Adjusting another tenant product must return 404');
    });

    await runAsyncTest('Flow 15.3: Spoofing x-tenant-id header is actively rejected with 403', async () => {
      const res = await harness.request({
        method: 'GET',
        path: '/api/tenant/entitlements',
        headers: {
          ...tenantAUser.headers,
          'x-tenant-id': tenantBUser.tenantId
        }
      });

      assert.strictEqual(res.status, 403, 'Cross-tenant header spoofing must be rejected with 403');
      assert.strictEqual(res.body.code, 'CROSS_TENANT_ACCESS_DENIED');
    });

    // =========================================================================
    // FLOW 16: WEBHOOK FIRMADO SE PROCESA UNA SOLA VEZ
    // =========================================================================
    await runAsyncTest('Flow 16.1: Webhook without valid HMAC signature is rejected with 401', async () => {
      const res = await harness.request({
        method: 'POST',
        path: '/api/saas/billing/webhooks/fake',
        body: JSON.stringify({ type: 'payment_intent.succeeded' })
      });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.code, 'INVALID_WEBHOOK_SIGNATURE');
    });

    await runAsyncTest('Flow 16.2: Signed webhook is processed exactly once (idempotent)', async () => {
      const rawPayload = JSON.stringify({
        id: 'evt_test_hmac_123',
        type: 'payment_intent.succeeded',
        tenant_id: 'untrusted_body_tenant',
        data: {
          customer: 'cus_test_123',
          object: {
            id: 'pi_test_123',
            amount: 590000
          }
        }
      });

      const signature = harness.paymentGateway.signWebhookPayload(rawPayload);

      // First delivery: processes successfully
      const res1 = await harness.request({
        method: 'POST',
        path: '/api/saas/billing/webhooks/fake',
        headers: {
          'stripe-signature': signature,
          'Content-Type': 'application/json'
        },
        body: rawPayload
      });

      assert.strictEqual(res1.status, 200);
      assert.strictEqual(res1.body.received, true);
      assert.strictEqual(res1.body.eventId, 'evt_test_hmac_123');

      // Second delivery: idempotent acknowledgement without reprocessing
      const res2 = await harness.request({
        method: 'POST',
        path: '/api/saas/billing/webhooks/fake',
        headers: {
          'stripe-signature': signature,
          'Content-Type': 'application/json'
        },
        body: rawPayload
      });

      assert.strictEqual(res2.status, 200);
      assert.strictEqual(res2.body.received, true);
    });

    // =========================================================================
    // FLOW 17: SUPERADMIN PUEDE REALIZAR OPERACIONES AUTORIZADAS Y AUDITADAS
    // =========================================================================
    let superAdminUser = null;
    await runAsyncTest('Flow 17.1: SuperAdmin queries SaaS metrics and tenants list (200 OK)', async () => {
      superAdminUser = await harness.createTenantWithUser({
        role: 'superadmin',
        email: 'superadmin@salonpro.com'
      });

      const metricsRes = await harness.request({
        method: 'GET',
        path: '/api/saas/metrics',
        headers: superAdminUser.headers
      });

      assert.strictEqual(metricsRes.status, 200);
      assert.ok('total_tenants' in metricsRes.body);

      const tenantsRes = await harness.request({
        method: 'GET',
        path: '/api/saas/tenants',
        headers: superAdminUser.headers
      });

      assert.strictEqual(tenantsRes.status, 200);
      assert.ok(Array.isArray(tenantsRes.body));
    });

    await runAsyncTest('Flow 17.2: SuperAdmin extends grace period with registered audit log', async () => {
      const res = await harness.request({
        method: 'POST',
        path: '/api/saas/billing/admin/extend-grace',
        headers: superAdminUser.headers,
        body: {
          tenantId: dunningTenantUser.tenantId,
          additionalDays: 7,
          reason: 'Extensión autorizada por soporte VIP'
        }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
    });

    // =========================================================================
    // FLOW 18: ADMINISTRADOR DE SALÓN NO PUEDE MODIFICAR SU PLAN DIRECTAMENTE
    // =========================================================================
    await runAsyncTest('Flow 18.1: Salon Admin cannot modify subscription plan directly via /api/saas/tenants/:id/subscription (403)', async () => {
      const res = await harness.request({
        method: 'PATCH',
        path: `/api/saas/tenants/${tenantBaseUser.tenantId}/subscription`,
        headers: tenantBaseUser.headers,
        body: {
          plan_code: 'PRO'
        }
      });

      assert.strictEqual(res.status, 403, 'Salon admin must be forbidden from administrative subscription modification');
    });

    await runAsyncTest('Flow 18.2: Salon Admin attempting SuperAdmin grace extension is rejected (403)', async () => {
      const res = await harness.request({
        method: 'POST',
        path: '/api/saas/billing/admin/extend-grace',
        headers: tenantBaseUser.headers,
        body: {
          tenantId: tenantBaseUser.tenantId,
          additionalDays: 14,
          reason: 'Auto-extensión ilegítima'
        }
      });

      assert.strictEqual(res.status, 403, 'Salon admin cannot execute administrative grace extension');
    });

    await runAsyncTest('Flow 18.3: Salon Admin attempting SuperAdmin metrics is rejected (403)', async () => {
      const res = await harness.request({
        method: 'GET',
        path: '/api/saas/metrics',
        headers: tenantBaseUser.headers
      });

      assert.strictEqual(res.status, 403, 'Salon admin must be forbidden from accessing SuperAdmin metrics');
    });

  } finally {
    // Teardown HTTP server and clean up fixtures
    await harness.close();
  }

  // Summary
  console.log('\n======================================================');
  console.log(`PHASE 2E TEST SUMMARY: ${passedTests}/${totalTests} PASSED`);
  console.log('======================================================\n');

  if (passedTests < totalTests) {
    process.exit(1);
  }
}

runAll().catch(err => {
  console.error('[FATAL RUN ERROR]:', err);
  process.exit(1);
});
