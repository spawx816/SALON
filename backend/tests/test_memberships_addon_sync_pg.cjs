/**
 * PostgreSQL Integration Test: Suscripciones/Membresías B2C Add-on Synchronization & Branch Scoping
 * Runs against salon_saas_test (or DB_NAME from env).
 */
const assert = require('assert');
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const { createSaasRouter } = require('../routes/saas.routes');
const { createTenantRouter } = require('../routes/tenant.routes');
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

const pool = {
  isPostgres: true,
  connect: () => pgPool.connect(),
  query: async (sql, params = []) => {
    let idx = 0;
    const pgSql = sql.replace(/\?/g, () => `$${++idx}`);
    const res = await pgPool.query(pgSql, params);
    return [res.rows, res];
  }
};

function buildApp() {
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
    const role = req.headers['x-test-role'] || 'owner';
    const tenantId = req.headers['x-test-tenant-id'] || null;
    const userId = req.headers['x-test-user-id'] || 'test-actor';
    if (role === 'superadmin') {
      req.auth = { userId, role: 'superadmin', isSuperAdmin: true, verifiedTenantId: null };
      req.user = { id: userId, role: 'superadmin', isSuperAdmin: true };
    } else {
      req.auth = { userId, role, isSuperAdmin: false, verifiedTenantId: tenantId, branchId: req.headers['x-test-user-branch'] || null };
      req.user = { id: userId, role, tenant_id: tenantId, branch_id: req.headers['x-test-user-branch'] || null };
      req.tenantId = tenantId;
    }
    next();
  });

  app.use('/api/saas', createSaasRouter(pool, { entitlementsService }));
  app.use('/api/tenant', createTenantRouter(pool, { entitlementsService }));
  app.get('/api/plans', requirePlanFeature('memberships'), (_req, res) => res.json({ ok: true }));
  app.get('/api/contracts', requirePlanFeature('memberships'), (_req, res) => res.json({ ok: true }));
  app.get('/api/payments', requirePlanFeature('memberships'), (_req, res) => res.json({ ok: true }));
  return { app, entitlementsService };
}

(async () => {
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const branchA1 = crypto.randomUUID();
  const branchA2 = crypto.randomUUID();
  const branchB1 = crypto.randomUUID();
  const salonA = `salon-a-${Date.now()}`;
  const planB2CId = `b2c-${Date.now()}`;

  try {
    const [planRow] = await pool.query("SELECT id FROM saas_plans WHERE UPPER(code) = 'PRINCIPAL' LIMIT 1");
    const principalId = planRow[0]?.id || 1;

    await pool.query(
      `INSERT INTO tenants (id, business_name, slug, email, plan_id, status, licensed_branches, max_branches, max_users, has_memberships, created_at)
       VALUES (?, 'Test Sync A', ?, ?, ?, 'active', 2, 2, 6, FALSE, NOW()),
              (?, 'Test Sync B', ?, ?, ?, 'active', 1, 1, 3, FALSE, NOW())`,
      [
        tenantA, `test-sync-a-${Date.now()}`, `a-${Date.now()}@test.local`, principalId,
        tenantB, `test-sync-b-${Date.now()}`, `b-${Date.now()}@test.local`, principalId,
      ]
    );

    await pool.query(
      `INSERT INTO tenant_subscriptions (tenant_id, plan_code, status, billing_cycle, currency, current_period_start, current_period_end, created_at, updated_at)
       VALUES (?, 'PRINCIPAL', 'active', 'monthly', 'USD', NOW(), NOW() + INTERVAL '30 days', NOW(), NOW()),
              (?, 'PRINCIPAL', 'active', 'monthly', 'USD', NOW(), NOW() + INTERVAL '30 days', NOW(), NOW())`,
      [tenantA, tenantB]
    );

    await pool.query(
      `INSERT INTO branches (id, tenant_id, name, is_main, is_active, created_at)
       VALUES (?, ?, 'Sucursal A1', TRUE, TRUE, NOW()),
              (?, ?, 'Sucursal A2', FALSE, TRUE, NOW()),
              (?, ?, 'Sucursal B1', TRUE, TRUE, NOW())`,
      [branchA1, tenantA, branchA2, tenantA, branchB1, tenantB]
    );

    await pool.query(
      `INSERT INTO salons (id, tenant_id, name) VALUES (?, ?, 'Salon A')`,
      [salonA, tenantA]
    );
    await pool.query(
      `INSERT INTO plans (id, tenant_id, salon_id, name, price, currency, description, is_active)
       VALUES (?, ?, ?, 'Plan Beauty Historico', 1990, 'DOP', 'Preservado', TRUE)`,
      [planB2CId, tenantA, salonA]
    );

    const { app } = buildApp();

    // 1. Tenant A without add-on remains blocked
    const ent0 = await request(app).get('/api/tenant/entitlements').set('x-test-tenant-id', tenantA);
    assert.strictEqual(ent0.status, 200);
    assert.strictEqual(ent0.body.addons.memberships.active, false);
    assert.strictEqual(ent0.body.features.memberships, false);

    for (const path of ['/api/plans', '/api/contracts', '/api/payments']) {
      const blocked = await request(app).get(path).set('x-test-tenant-id', tenantA);
      assert.strictEqual(blocked.status, 403, `${path} should return 403 without add-on`);
      assert.strictEqual(blocked.body.code, 'FEATURE_NOT_INCLUDED');
    }

    // 2. Legacy flags MUST NOT grant accidental access
    await pool.query(
      `UPDATE tenants SET has_memberships = TRUE, modules_config = '{"memberships": true}'::jsonb WHERE id = ?`,
      [tenantA]
    );
    const entLegacy = await request(app).get('/api/tenant/entitlements').set('x-test-tenant-id', tenantA);
    assert.strictEqual(entLegacy.body.addons.memberships.active, false);
    const blockedLegacy = await request(app).get('/api/plans').set('x-test-tenant-id', tenantA);
    assert.strictEqual(blockedLegacy.status, 403);
    assert.strictEqual(blockedLegacy.body.code, 'FEATURE_NOT_INCLUDED');

    const saasList0 = await request(app).get('/api/saas/tenants').set('x-test-role', 'superadmin');
    const rowA0 = saasList0.body.find(r => r.id === tenantA);
    assert.strictEqual(rowA0.has_memberships, false, 'SuperAdmin DTO must ignore stale tenants.has_memberships');

    // 3. Invalid branch selection (branchB1 from tenantB) returns 400 and preserves previous state
    const badActivate = await request(app)
      .put(`/api/saas/tenants/${tenantA}/addons/memberships`)
      .set('x-test-role', 'superadmin')
      .send({ enabled: true, branchIds: [branchB1], reason: 'Cross-tenant branch attempt' });
    assert.strictEqual(badActivate.status, 400);
    assert.strictEqual(badActivate.body.code, 'INVALID_BRANCH_SELECTION');

    // 4. Activate ONLY on branchA1
    const actRes = await request(app)
      .put(`/api/saas/tenants/${tenantA}/addons/memberships`)
      .set('x-test-role', 'superadmin')
      .send({ enabled: true, branchIds: [branchA1], reason: 'Contratacion Sucursal A1' });
    assert.strictEqual(actRes.status, 200);
    assert.strictEqual(actRes.body.has_memberships, true);
    assert.deepStrictEqual(actRes.body.addon.branchIds, [branchA1]);
    assert.strictEqual(actRes.body.addon.enabledBranchCount, 1);

    // 5. SuperAdmin table, Owner entitlements, branchA1 allowed, branchA2 blocked, tenantB unaffected
    const saasList1 = await request(app).get('/api/saas/tenants').set('x-test-role', 'superadmin');
    const rowA1 = saasList1.body.find(r => r.id === tenantA);
    const rowB1 = saasList1.body.find(r => r.id === tenantB);
    assert.strictEqual(rowA1.has_memberships, true);
    assert.deepStrictEqual(rowA1.memberships_branch_ids, [branchA1]);
    assert.strictEqual(rowB1.has_memberships, false);

    const ent1 = await request(app).get('/api/tenant/entitlements').set('x-test-tenant-id', tenantA);
    assert.strictEqual(ent1.body.addons.memberships.active, true);
    assert.deepStrictEqual(ent1.body.addons.memberships.branchIds, [branchA1]);

    const okBranch1 = await request(app).get('/api/plans').set('x-test-tenant-id', tenantA).set('x-branch-id', branchA1);
    assert.strictEqual(okBranch1.status, 200);

    const blockedBranch2 = await request(app).get('/api/plans').set('x-test-tenant-id', tenantA).set('x-branch-id', branchA2);
    assert.strictEqual(blockedBranch2.status, 403);
    assert.strictEqual(blockedBranch2.body.code, 'FEATURE_NOT_INCLUDED');

    const blockedTenantB = await request(app).get('/api/plans').set('x-test-tenant-id', tenantB).set('x-branch-id', branchB1);
    assert.strictEqual(blockedTenantB.status, 403);

    // 6. Idempotent retry does not duplicate events
    const [evBefore] = await pool.query('SELECT COUNT(*)::int as c FROM tenant_subscription_events WHERE tenant_id = ?', [tenantA]);
    const retryRes = await request(app)
      .put(`/api/saas/tenants/${tenantA}/addons/memberships`)
      .set('x-test-role', 'superadmin')
      .send({ enabled: true, branchIds: [branchA1], reason: 'Contratacion Sucursal A1' });
    assert.strictEqual(retryRes.status, 200);
    assert.strictEqual(retryRes.body.idempotent, true);
    const [evAfter] = await pool.query('SELECT COUNT(*)::int as c FROM tenant_subscription_events WHERE tenant_id = ?', [tenantA]);
    assert.strictEqual(evAfter[0].c, evBefore[0].c, 'Idempotent retry must not duplicate subscription events');

    // 7. Deactivate revokes access without deleting B2C plans/history
    const deactRes = await request(app)
      .put(`/api/saas/tenants/${tenantA}/addons/memberships`)
      .set('x-test-role', 'superadmin')
      .send({ enabled: false, reason: 'Baja de add-on' });
    assert.strictEqual(deactRes.status, 200);
    assert.strictEqual(deactRes.body.has_memberships, false);

    const ent2 = await request(app).get('/api/tenant/entitlements').set('x-test-tenant-id', tenantA);
    assert.strictEqual(ent2.body.addons.memberships.active, false);

    const blockedAfterDeact = await request(app).get('/api/plans').set('x-test-tenant-id', tenantA).set('x-branch-id', branchA1);
    assert.strictEqual(blockedAfterDeact.status, 403);
    assert.strictEqual(blockedAfterDeact.body.code, 'FEATURE_NOT_INCLUDED');

    const [preservedPlans] = await pool.query('SELECT COUNT(*)::int as c FROM plans WHERE tenant_id = ?', [tenantA]);
    assert.strictEqual(preservedPlans[0].c, 1, 'Existing B2C plans must be preserved after deactivation');

    console.log('ALL POSTGRESQL MEMBERSHIPS ADD-ON SYNC & BRANCH SCOPING TESTS PASSED');
  } finally {
    await pool.query('DELETE FROM plans WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM salons WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM branches WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM tenant_feature_overrides WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM tenant_subscription_events WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM tenant_subscriptions WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM tenants WHERE id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pgPool.end();
  }
})().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
