/**
 * Module 14 Acceptance Test — Suscripción SaaS y Pagos (Owner-only guard, Cotización consolidada, Worker OFF, Simulación sin cobro real)
 * Runs against PostgreSQL (salon_saas_test).
 */
const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const { Pool } = require('pg');

const { createSaasBillingRouter } = require('../routes/saas_billing.routes');
const { TenantSubscriptionRepository } = require('../repositories/tenant_subscription.repository');
const { EntitlementsRepository } = require('../repositories/entitlements.repository');
const { SaasBillingRepository } = require('../repositories/saas_billing.repository');
const { EntitlementsService } = require('../services/entitlements.service');
const { SaasSubscriptionLifecycleService } = require('../services/saas_subscription_lifecycle.service');
const { SaasFxRateService } = require('../services/saas_fx_rate.service');

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
  const tenantA = crypto.randomUUID();
  const branchA1 = crypto.randomUUID();
  const ownerId = crypto.randomUUID();

  // Guarantee renewal worker is disabled in test
  delete process.env.SAAS_RENEWAL_WORKER_ENABLED;

  const subscriptionRepo = new TenantSubscriptionRepository(pool);
  const entitlementsRepo = new EntitlementsRepository(pool);
  const billingRepo = new SaasBillingRepository(pool);
  const entitlementsService = new EntitlementsService({
    saasPlanRepo: null,
    subscriptionRepo,
    entitlementsRepo,
    auditRepo: billingRepo,
  });
  const lifecycleService = new SaasSubscriptionLifecycleService({
    subscriptionRepo,
    entitlementsRepo,
    billingRepo,
    auditRepo: billingRepo,
  });
  const fxRateService = new SaasFxRateService({ pool });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.headers['x-test-role'] || 'propietario';
    const tenantId = req.headers['x-test-tenant-id'] || tenantA;
    req.tenantId = tenantId;
    req.auth = { userId: ownerId, role, isSuperAdmin: role === 'superadmin', verifiedTenantId: tenantId };
    req.user = { id: ownerId, role, tenant_id: tenantId };
    next();
  });

  app.use('/api/saas/billing', createSaasBillingRouter({
    billingService: null,
    lifecycleService,
    billingRepo,
    checkoutService: { getGatewayStatus: () => ({ configured: false, mode: 'simulated' }) },
    fxRateService,
    cardnetCheckoutProvider: { getConfigurationStatus: () => ({ configured: false }) },
    cardnetTokenizationProvider: null,
    pool,
  }));

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
      `INSERT INTO tenants (id, business_name, slug, email, plan_id, status, licensed_branches, max_branches, max_users, extra_user_seats, has_memberships, created_at)
       VALUES (?, 'M14 Salon A', ?, ?, ?, 'active', 1, 1, 3, 2, FALSE, NOW())`,
      [tenantA, `m14-a-${ts}`, `m14-a-${ts}@test.local`, principalId]
    );
    await pool.query(
      `INSERT INTO tenant_subscriptions (tenant_id, plan_code, status, billing_cycle, currency, current_period_start, current_period_end, created_at, updated_at)
       VALUES (?, 'PRINCIPAL', 'active', 'monthly', 'USD', NOW(), NOW() + INTERVAL '30 days', NOW(), NOW())`,
      [tenantA]
    );
    await pool.query(
      `INSERT INTO branches (id, tenant_id, name, is_main, is_active, created_at)
       VALUES (?, ?, 'M14 Suc A1', TRUE, TRUE, NOW())`,
      [branchA1, tenantA]
    );

    // 1. Non-owner roles strictly blocked (403 OWNER_ONLY_SAAS_BILLING)
    await runCase('M14-1: Non-owner roles (recepcion, gerente, admin) blocked with 403 OWNER_ONLY_SAAS_BILLING', async () => {
      for (const role of ['recepcion', 'gerente', 'admin', 'cajero']) {
        const res = await request(server, 'GET', '/api/saas/billing/subscription', { 'x-test-role': role, 'x-test-tenant-id': tenantA });
        assert.strictEqual(res.status, 403, `Role ${role} should be 403`);
        assert.strictEqual(res.body?.code, 'OWNER_ONLY_SAAS_BILLING');
      }
    });

    // 2. Owner reads subscription & pricing & branches
    await runCase('M14-2: Owner reads /subscription with active PRINCIPAL plan and branch list', async () => {
      const res = await request(server, 'GET', '/api/saas/billing/subscription', { 'x-test-role': 'propietario', 'x-test-tenant-id': tenantA });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(String(res.body?.subscription?.plan_code).toUpperCase(), 'PRINCIPAL');
      assert.ok(Array.isArray(res.body?.branches) && res.body.branches.length === 1);
    });

    // 3. Consolidated renewal quote reflects worker OFF + missing_consent state
    await runCase('M14-3: /renewal/quote returns consolidated DOP quote with workerEnabled=false & missing_consent', async () => {
      const res = await request(server, 'GET', '/api/saas/billing/renewal/quote', { 'x-test-role': 'propietario', 'x-test-tenant-id': tenantA });
      assert.strictEqual(res.status, 200, `Quote failed: ${res.raw}`);
      assert.strictEqual(res.body?.workerEnabled, false);
      assert.strictEqual(res.body?.renewalState?.workerEnabled, false);
      assert.strictEqual(res.body?.renewalState?.effectiveStatus, 'missing_consent');
      assert.ok(Array.isArray(res.body?.quote?.lineItems) && res.body.quote.lineItems.length >= 1);
    });

    // 4. Renewal authorization rejects missing explicit consent (400)
    await runCase('M14-4: POST /renewal/authorize rejects missing explicit consent (400 RECURRING_CONSENT_REQUIRED)', async () => {
      const res = await request(server, 'POST', '/api/saas/billing/renewal/authorize', { 'x-test-role': 'propietario', 'x-test-tenant-id': tenantA }, {
        authorize_recurring: false,
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body?.code, 'RECURRING_CONSENT_REQUIRED');
    });

    console.log(`\nALL MODULE 14 ACCEPTANCE TESTS PASSED (${passed}/4)`);
  } finally {
    server.close();
    await pool.query('DELETE FROM tenant_terms_acceptances WHERE tenant_id = ?', [tenantA]).catch(() => {});
    await pool.query('DELETE FROM tenant_subscription_events WHERE tenant_id = ?', [tenantA]).catch(() => {});
    await pool.query('DELETE FROM tenant_subscriptions WHERE tenant_id = ?', [tenantA]).catch(() => {});
    await pool.query('DELETE FROM branches WHERE tenant_id = ?', [tenantA]).catch(() => {});
    await pool.query('DELETE FROM tenants WHERE id = ?', [tenantA]).catch(() => {});
    await pgPool.end();
  }
})().catch((err) => {
  console.error('MODULE 14 ACCEPTANCE FAILED:', err);
  process.exit(1);
});
