/**
 * Module 15 Acceptance Test — SuperAdmin Control Plane (Isolation, Metrics/MRR per 3-branch block, Tenant Management)
 * Runs against PostgreSQL (salon_saas_test).
 */
const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const { createSaasRouter } = require('../routes/saas.routes');
const { createAuthMiddleware, signAuthToken } = require('../middleware/auth.middleware');
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
  rawPool: pgPool,
  connect: () => pgPool.connect(),
  query: async (sql, params = []) => {
    let idx = 0;
    const pgSql = sql.replace(/\?/g, () => `$${++idx}`);
    const res = await pgPool.query(pgSql, params);
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
  const saUserId = crypto.randomUUID();
  const ownerUserId = crypto.randomUUID();
  const tenantProdLike = crypto.randomUUID();
  const branch1 = crypto.randomUUID();
  const branch2 = crypto.randomUUID();

  const entitlementsService = new EntitlementsService({
    saasPlanRepo: null,
    subscriptionRepo: new TenantSubscriptionRepository(pool),
    entitlementsRepo: new EntitlementsRepository(pool),
    auditRepo: new SaasBillingRepository(pool),
  });

  const { rejectControlPlaneRoleOnTenantRoutes } = createAuthMiddleware(pool);
  const app = express();
  app.use(express.json());
  app.use('/api/saas', createSaasRouter(pool, { entitlementsService }));
  // Simulated tenant operational route protected by rejectControlPlaneRoleOnTenantRoutes
  app.get('/api/clients', (req, _res, next) => {
    const role = req.headers['x-test-role'] || 'propietario';
    req.auth = { userId: saUserId, role, isSuperAdmin: role === 'superadmin', verifiedTenantId: tenantProdLike };
    req.user = { id: saUserId, role, isSuperAdmin: role === 'superadmin' };
    next();
  }, rejectControlPlaneRoleOnTenantRoutes, (_req, res) => res.json({ ok: true }));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const secret = process.env.JWT_SECRET;
  assert.ok(secret, 'JWT_SECRET required');

  let passed = 0;
  const runCase = async (name, fn) => {
    await fn();
    passed++;
    console.log(`PASS: ${name}`);
  };

  try {
    const [planRow] = await pool.query("SELECT id, COALESCE(price_per_branch, price_monthly, 0) AS ppb FROM saas_plans WHERE UPPER(code) = 'PRINCIPAL' LIMIT 1");
    const principalId = planRow[0]?.id || 1;
    const planPrice = Number(planRow[0]?.ppb || 0);

    // Non-test slug/email so it is included in MRR calculation
    await pool.query(
      `INSERT INTO tenants (id, business_name, slug, email, plan_id, status, licensed_branches, max_branches, max_users, has_memberships, created_at)
       VALUES (?, 'M15 Salon Realish', ?, ?, ?, 'active', 2, 2, 6, FALSE, NOW())`,
      [tenantProdLike, `m15-salon-${ts}`, `m15-${ts}@salonrealish.do`, principalId]
    );
    await pool.query(
      `INSERT INTO tenant_subscriptions (tenant_id, plan_code, status, billing_cycle, currency, current_period_start, current_period_end, created_at, updated_at)
       VALUES (?, 'PRINCIPAL', 'active', 'monthly', 'USD', NOW(), NOW() + INTERVAL '30 days', NOW(), NOW())`,
      [tenantProdLike]
    );
    await pool.query(
      `INSERT INTO branches (id, tenant_id, name, is_main, is_active, created_at)
       VALUES (?, ?, 'M15 Suc 1', TRUE, TRUE, NOW()), (?, ?, 'M15 Suc 2', FALSE, TRUE, NOW())`,
      [branch1, tenantProdLike, branch2, tenantProdLike]
    );
    await pool.query(
      `INSERT INTO users (id, tenant_id, name, nombre, email, password, password_hash, role, is_active)
       VALUES (?, NULL, 'M15 SA', 'M15 SA', ?, 'x', 'x', 'superadmin', TRUE),
              (?, ?, 'M15 Owner', 'M15 Owner', ?, 'x', 'x', 'propietario', TRUE)`,
      [saUserId, `m15-sa-${ts}@etereas.local`, ownerUserId, tenantProdLike, `m15-owner-${ts}@salonrealish.do`]
    );

    const saToken = signAuthToken({ id: saUserId, role: 'superadmin', isSuperAdmin: true, email: `m15-sa-${ts}@etereas.local` });
    const ownerToken = signAuthToken({ id: ownerUserId, role: 'propietario', tenant_id: tenantProdLike, email: `m15-owner-${ts}@salonrealish.do` });

    // 1. Non-superadmin blocked on /api/saas/metrics and /api/saas/tenants
    await runCase('M15-1: Tenant owner blocked from /api/saas/metrics & /api/saas/tenants (403)', async () => {
      const mRes = await request(server, 'GET', '/api/saas/metrics', { Authorization: `Bearer ${ownerToken}` });
      assert.strictEqual(mRes.status, 403);
      const tRes = await request(server, 'GET', '/api/saas/tenants', { Authorization: `Bearer ${ownerToken}` });
      assert.strictEqual(tRes.status, 403);
    });

    // 2. SuperAdmin blocked from tenant operational routes
    await runCase('M15-2: SuperAdmin strictly blocked from tenant operational routes (403)', async () => {
      const res = await request(server, 'GET', '/api/clients', { 'x-test-role': 'superadmin' });
      assert.strictEqual(res.status, 403);
    });

    // 3. SuperAdmin lists tenants and verifies MRR bills by contracted blocks (2 acquired blocks with 2 assigned branches = +US$198, unchanged after branch reassignment)
    await runCase('M15-3: SuperAdmin /metrics bills by contracted blocks (2 blocks w/ 2 branches = +US$198; reassignment preserves 2 blocks)', async () => {
      const before = await request(server, 'GET', '/api/saas/metrics', { Authorization: `Bearer ${saToken}` });
      assert.strictEqual(before.status, 200);
      const mrrBefore = Number(before.body?.mrr || 0);

      // Acquire 2 blocks (capacity 6) while assigning only 2 branches
      const act = await entitlementsService.setAddonStatus(tenantProdLike, 'memberships', {
        enabled: true,
        source: 'commercial_addon',
        reason: 'M15 two contracted blocks with two branches',
        branchIds: [branch1, branch2],
        acquiredBlocks: 2,
      });
      assert.strictEqual(act.acquiredBlocks, 2);
      assert.strictEqual(act.acquiredBranchCapacity, 6);
      assert.strictEqual(act.enabledBranchCount, 2);

      const afterTwo = await request(server, 'GET', '/api/saas/metrics', { Authorization: `Bearer ${saToken}` });
      assert.strictEqual(afterTwo.status, 200);
      const deltaTwo = Number((Number(afterTwo.body?.mrr || 0) - mrrBefore).toFixed(2));
      assert.strictEqual(deltaTwo, 198, `Expected MRR delta of +198 USD for 2 contracted blocks (with 2 assigned branches), got +${deltaTwo} (planPrice=${planPrice})`);

      // Change branch assignment (down to 1 branch) without passing acquiredBlocks: contracted blocks MUST stay 2 and MRR MUST stay +198
      const reassigned = await entitlementsService.setAddonStatus(tenantProdLike, 'memberships', {
        enabled: true,
        source: 'commercial_addon',
        reason: 'M15 branch reassignment without changing contracted blocks',
        branchIds: [branch1],
      });
      assert.strictEqual(reassigned.acquiredBlocks, 2, 'Reassignment must not reduce contracted blocks');
      assert.strictEqual(reassigned.enabledBranchCount, 1);

      const afterReassign = await request(server, 'GET', '/api/saas/metrics', { Authorization: `Bearer ${saToken}` });
      assert.strictEqual(afterReassign.status, 200);
      const deltaReassign = Number((Number(afterReassign.body?.mrr || 0) - mrrBefore).toFixed(2));
      assert.strictEqual(deltaReassign, 198, `Expected MRR delta to remain +198 USD after reassignment, got +${deltaReassign}`);

      const tenantsRes = await request(server, 'GET', '/api/saas/tenants', { Authorization: `Bearer ${saToken}` });
      assert.strictEqual(tenantsRes.status, 200);
      const found = (tenantsRes.body || []).find((t) => t.id === tenantProdLike);
      assert.ok(found && found.has_memberships === true);
      assert.strictEqual(Number(found.memberships_enabled_branch_count), 1);
    });

    console.log(`\nALL MODULE 15 ACCEPTANCE TESTS PASSED (${passed}/3)`);
  } finally {
    server.close();
    await pool.query('DELETE FROM users WHERE id IN (?, ?)', [saUserId, ownerUserId]).catch(() => {});
    await pool.query('DELETE FROM tenant_feature_overrides WHERE tenant_id = ?', [tenantProdLike]).catch(() => {});
    await pool.query('DELETE FROM tenant_subscription_events WHERE tenant_id = ?', [tenantProdLike]).catch(() => {});
    await pool.query('DELETE FROM tenant_subscriptions WHERE tenant_id = ?', [tenantProdLike]).catch(() => {});
    await pool.query('DELETE FROM branches WHERE tenant_id = ?', [tenantProdLike]).catch(() => {});
    await pool.query('DELETE FROM tenants WHERE id = ?', [tenantProdLike]).catch(() => {});
    await pgPool.end();
  }
})().catch((err) => {
  console.error('MODULE 15 ACCEPTANCE FAILED:', err);
  process.exit(1);
});
