/**
 * Module 13 Acceptance Test — Membresías (Add-on US$99/bloque 3 sucursales, Planes, Contratos, Pagos y Cupo Plan Beauty)
 * Runs against PostgreSQL (salon_saas_test).
 */
const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const { Pool } = require('pg');

const { createPlansRouter } = require('../routes/plans.routes');
const { createContractsRouter } = require('../routes/contracts.routes');
const { createPaymentsRouter } = require('../routes/payments.routes');
const { createVisitsRouter } = require('../routes/visits.routes');
const { createEntitlementsMiddleware } = require('../middleware/entitlements.middleware');
const { EntitlementsRepository } = require('../repositories/entitlements.repository');
const { TenantSubscriptionRepository } = require('../repositories/tenant_subscription.repository');
const { SaasBillingRepository } = require('../repositories/saas_billing.repository');
const { EntitlementsService } = require('../services/entitlements.service');

const pgPool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'salon_saas_test',
});

const translateSql = (sql) => {
  let idx = 0;
  let s = sql.replace(/DATE_ADD\s*\(([^,]+),\s*INTERVAL\s+(\d+)\s+([A-Za-z]+)\)/gi, "($1 + INTERVAL '$2 $3')");
  return s.replace(/\?/g, () => `$${++idx}`);
};

const pool = {
  isPostgres: true,
  rawPool: pgPool,
  connect: () => pgPool.connect(),
  getConnection: async () => {
    const client = await pgPool.connect();
    return {
      query: async (sql, params = []) => {
        const res = await client.query(translateSql(sql), params);
        return [res.rows, res];
      },
      beginTransaction: () => client.query('BEGIN'),
      commit: () => client.query('COMMIT'),
      rollback: () => client.query('ROLLBACK'),
      release: () => client.release(),
    };
  },
  query: async (sql, params = []) => {
    const res = await pgPool.query(translateSql(sql), params);
    return [res.rows, res];
  },
};

function request(server, method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const payload = body !== null ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch (_) {}
          resolve({ status: res.statusCode, body: json, raw: data });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  const ts = Date.now();
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const branchA1 = crypto.randomUUID();
  const branchA2 = crypto.randomUUID();
  const branchB1 = crypto.randomUUID();
  const clientA = crypto.randomUUID();
  const clientB = crypto.randomUUID();

  const entitlementsService = new EntitlementsService({
    saasPlanRepo: null,
    subscriptionRepo: new TenantSubscriptionRepository(pool),
    entitlementsRepo: new EntitlementsRepository(pool),
    auditRepo: new SaasBillingRepository(pool),
  });
  const { requirePlanFeature } = createEntitlementsMiddleware(entitlementsService);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const tenantId = req.headers['x-test-tenant-id'];
    const branchId = req.headers['x-test-branch-id'] || null;
    req.tenantId = tenantId;
    req.auth = {
      userId: 'm13-tester',
      role: 'propietario',
      isSuperAdmin: false,
      verifiedTenantId: tenantId,
      branchId,
      permissions: {
        'memberships.plans.manage': true,
        'memberships.contracts.view': true,
        'pos.visits.create': true,
        'pos.visits.view': true,
      },
    };
    req.user = { id: 'm13-tester', role: 'propietario', tenant_id: tenantId, branch_id: branchId };
    next();
  });

  app.use('/api/plans', requirePlanFeature('memberships'), createPlansRouter(pool));
  app.use('/api/contracts', requirePlanFeature('memberships'), createContractsRouter(pool));
  app.use('/api/payments', requirePlanFeature('memberships'), createPaymentsRouter(pool));
  const { router: visitsRouter } = createVisitsRouter(pool, {});
  app.use('/api/visits', visitsRouter);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  let passed = 0;
  const runCase = async (name, fn) => {
    await fn();
    passed++;
    console.log(`PASS: ${name}`);
  };

  try {
    const [planRow] = await pool.query("SELECT id FROM saas_plans WHERE UPPER(code) = 'PRINCIPAL' LIMIT 1");
    const principalId = planRow[0]?.id || 1;

    await pool.query(
      `INSERT INTO tenants (id, business_name, slug, email, plan_id, status, licensed_branches, max_branches, max_users, has_memberships, created_at)
       VALUES (?, 'M13 Salon A', ?, ?, ?, 'active', 2, 2, 6, FALSE, NOW()),
              (?, 'M13 Salon B', ?, ?, ?, 'active', 1, 1, 3, FALSE, NOW())`,
      [tenantA, `m13-a-${ts}`, `m13-a-${ts}@test.local`, principalId, tenantB, `m13-b-${ts}`, `m13-b-${ts}@test.local`, principalId]
    );
    await pool.query(
      `INSERT INTO tenant_subscriptions (tenant_id, plan_code, status, billing_cycle, currency, current_period_start, current_period_end, created_at, updated_at)
       VALUES (?, 'PRINCIPAL', 'active', 'monthly', 'USD', NOW(), NOW() + INTERVAL '30 days', NOW(), NOW()),
              (?, 'PRINCIPAL', 'active', 'monthly', 'USD', NOW(), NOW() + INTERVAL '30 days', NOW(), NOW())`,
      [tenantA, tenantB]
    );
    await pool.query(
      `INSERT INTO branches (id, tenant_id, name, is_main, is_active, created_at)
       VALUES (?, ?, 'M13 Suc A1', TRUE, TRUE, NOW()),
              (?, ?, 'M13 Suc A2', FALSE, TRUE, NOW()),
              (?, ?, 'M13 Suc B1', TRUE, TRUE, NOW())`,
      [branchA1, tenantA, branchA2, tenantA, branchB1, tenantB]
    );
    await pool.query(
      `INSERT INTO clients (id, tenant_id, nombre, name, telefono, phone, cedula, salon_id, status)
       VALUES (?, ?, 'Clienta Plan A', 'Clienta Plan A', '8095551301', '8095551301', '00113000001', ?, 'Active'),
              (?, ?, 'Clienta Plan B', 'Clienta Plan B', '8095551302', '8095551302', '00113000002', ?, 'Active')`,
      [clientA, tenantA, branchA1, clientB, tenantB, branchB1]
    );

    // 1. Add-on fail-closed even when RBAC grants memberships.*
    await runCase('M13-1: Add-on uncontracted blocks /plans, /contracts, /payments (403 FEATURE_NOT_INCLUDED)', async () => {
      for (const ep of ['/api/plans', '/api/contracts', '/api/payments']) {
        const res = await request(server, 'GET', ep, { 'x-test-tenant-id': tenantA, 'x-test-branch-id': branchA1 });
        assert.strictEqual(res.status, 403, `${ep} should return 403`);
        assert.strictEqual(res.body?.code, 'FEATURE_NOT_INCLUDED');
      }
    });

    // 2. Activate add-on for branchA1 only (1 block = capacity 3) and verify branch scoping
    await runCase('M13-2: Add-on activated for branchA1 allows branchA1, blocks branchA2 & tenantB', async () => {
      const addonRes = await entitlementsService.setAddonStatus(tenantA, 'memberships', {
        enabled: true,
        source: 'commercial_addon',
        reason: 'M13 test activation',
        branchIds: [branchA1],
        acquiredBlocks: 1,
      });
      assert.strictEqual(addonRes.acquiredBlocks, 1);
      assert.strictEqual(addonRes.acquiredBranchCapacity, 3);

      const okA1 = await request(server, 'GET', '/api/plans', { 'x-test-tenant-id': tenantA, 'x-test-branch-id': branchA1 });
      assert.strictEqual(okA1.status, 200);
      assert.ok(Array.isArray(okA1.body) && okA1.body.length >= 3);

      const blockedA2 = await request(server, 'GET', '/api/plans', { 'x-test-tenant-id': tenantA, 'x-test-branch-id': branchA2 });
      assert.strictEqual(blockedA2.status, 403);
      assert.strictEqual(blockedA2.body?.code, 'FEATURE_NOT_INCLUDED');

      const blockedB = await request(server, 'GET', '/api/plans', { 'x-test-tenant-id': tenantB, 'x-test-branch-id': branchB1 });
      assert.strictEqual(blockedB.status, 403);
    });

    // 3. Plans & Contract & Payment validations + UI object payload { plans, applyToExisting }
    await runCase('M13-3: Invalid plan price, negative contract values & invalid payment amounts rejected (400); UI {plans} payload accepted (200)', async () => {
      const badPlan = await request(server, 'POST', '/api/plans', { 'x-test-tenant-id': tenantA, 'x-test-branch-id': branchA1 }, [
        { id: 'bad', name: 'Bad', price: -50 },
      ]);
      assert.strictEqual(badPlan.status, 400);

      const uiPlansOk = await request(server, 'POST', '/api/plans', { 'x-test-tenant-id': tenantA, 'x-test-branch-id': branchA1 }, {
        plans: [
          { id: 'silver', title: 'Plan Silver UI', price: 1550, services: ['4 Lavados'] },
          { id: 'gold', title: 'Plan Beauty Pro', price: 1950, services: ['4 Lavados', '15% desc.'] },
        ],
        applyToExisting: false,
      });
      assert.strictEqual(uiPlansOk.status, 200, `UI {plans} payload should return 200, got ${uiPlansOk.status}: ${uiPlansOk.raw}`);

      const badContract = await request(server, 'POST', '/api/contracts', { 'x-test-tenant-id': tenantA, 'x-test-branch-id': branchA1 }, {
        client_id: clientA,
        plan_id: 'gold',
        wash_Quota: -2,
        precio_mensual: 1950,
      });
      assert.strictEqual(badContract.status, 400);

      const badPay = await request(server, 'POST', '/api/payments', { 'x-test-tenant-id': tenantA, 'x-test-branch-id': branchA1 }, {
        client_id: clientA,
        amount: 0,
      });
      assert.strictEqual(badPay.status, 400);
    });

    // 4. Cross-tenant client isolation in contracts & payments
    await runCase('M13-4: Cross-tenant client rejected on contracts & payments (/verify-token, /charge-saved-card, /manual-cash)', async () => {
      const crossContract = await request(server, 'POST', '/api/contracts', { 'x-test-tenant-id': tenantA, 'x-test-branch-id': branchA1 }, {
        client_id: clientB,
        plan_id: 'gold',
        wash_Quota: 4,
        precio_mensual: 1950,
      });
      assert.strictEqual(crossContract.status, 404);

      const crossVerify = await request(server, 'POST', '/api/payments/verify-token', { 'x-test-tenant-id': tenantA, 'x-test-branch-id': branchA1 }, {
        clientId: clientB,
        amount: 1950,
        token: 'tok-fake',
      });
      assert.strictEqual(crossVerify.status, 404);

      const crossCharge = await request(server, 'POST', '/api/payments/charge-saved-card', { 'x-test-tenant-id': tenantA, 'x-test-branch-id': branchA1 }, {
        clientId: clientB,
        amount: 1950,
      });
      assert.strictEqual(crossCharge.status, 404);
    });

    // 5. Contract lifecycle + Plan Beauty wash quota enforcement (4 washes max; 0 remaining MUST reject 409)
    await runCase('M13-5: Plan Beauty quota deducts up to 4 and strictly rejects 5th wash when 0 available (409)', async () => {
      const createCon = await request(server, 'POST', '/api/contracts', { 'x-test-tenant-id': tenantA, 'x-test-branch-id': branchA1 }, {
        client_id: clientA,
        plan_id: 'gold',
        wash_Quota: 4,
        washes_used: 3,
        precio_mensual: 1950,
        salon_id: branchA1,
        record_payment: true,
      });
      assert.strictEqual(createCon.status, 200);
      assert.ok(createCon.body?.id);

      // 4th wash succeeds (3 -> 4)
      const visOkId = `VIS-M13-OK-${ts}`;
      const chkOk = await request(server, 'POST', `/api/visits/${visOkId}/checkout`, { 'x-test-tenant-id': tenantA, 'x-test-branch-id': branchA1 }, {
        client_id: clientA,
        client_name: 'Clienta Plan A',
        salon_id: branchA1,
        metodo_pago: 'Plan Beauty',
        subtotal: 0,
        total: 0,
        consume_wash: true,
        wash_count_to_consume: 1,
        items_detail: [{ nombre: 'Lavado y Secado', precioBase: 600, precioAplicado: 0, cantidad: 1, isPlanWash: true }],
      });
      assert.strictEqual(chkOk.status, 200, `4th wash should succeed, got ${chkOk.status}: ${chkOk.raw}`);

      // Verify washes_used = 4 in DB
      const [cRows] = await pool.query('SELECT washes_used FROM contracts WHERE id = ?', [createCon.body.id]);
      assert.strictEqual(Number(cRows[0].washes_used), 4);

      // 5th wash (0 remaining) MUST be rejected with 409 PLAN_WASH_QUOTA_EXHAUSTED
      const visBlockedId = `VIS-M13-ZERO-${ts}`;
      const chkBlocked = await request(server, 'POST', `/api/visits/${visBlockedId}/checkout`, { 'x-test-tenant-id': tenantA, 'x-test-branch-id': branchA1 }, {
        client_id: clientA,
        client_name: 'Clienta Plan A',
        salon_id: branchA1,
        metodo_pago: 'Plan Beauty',
        subtotal: 0,
        total: 0,
        consume_wash: true,
        wash_count_to_consume: 1,
        items_detail: [{ nombre: 'Lavado y Secado', precioBase: 600, precioAplicado: 0, cantidad: 1, isPlanWash: true }],
      });
      assert.strictEqual(chkBlocked.status, 409, `5th wash must be 409, got ${chkBlocked.status}: ${chkBlocked.raw}`);
      assert.strictEqual(chkBlocked.body?.code, 'PLAN_WASH_QUOTA_EXHAUSTED');

      // Manual cash renewal resets washes_used to 0
      const renewRes = await request(server, 'POST', '/api/payments/manual-cash', { 'x-test-tenant-id': tenantA, 'x-test-branch-id': branchA1 }, {
        client_id: clientA,
        plan_id: 'gold',
        amount: 1950,
        salon_id: branchA1,
      });
      assert.strictEqual(renewRes.status, 200);
      const [cAfter] = await pool.query('SELECT washes_used FROM contracts WHERE id = ?', [createCon.body.id]);
      assert.strictEqual(Number(cAfter[0].washes_used), 0);
    });

    console.log(`\nALL MODULE 13 ACCEPTANCE TESTS PASSED (${passed}/5)`);
  } finally {
    server.close();
    await pool.query('DELETE FROM visits WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM payments WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM contracts WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM plans WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM clients WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM tenant_feature_overrides WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM tenant_subscription_events WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM tenant_subscriptions WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM branches WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM tenants WHERE id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pgPool.end();
  }
})().catch((err) => {
  console.error('MODULE 13 ACCEPTANCE FAILED:', err);
  process.exit(1);
});
