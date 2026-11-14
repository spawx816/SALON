'use strict';

/**
 * Integration Suite against PostgreSQL (salon_saas_test):
 * Verifies SuperAdmin Audit Remediation (Blocks 1-6).
 */
const assert = require('assert');
const http = require('http');
const crypto = require('crypto');
const { Pool } = require('pg');
const { createApp } = require('../app');
const { signAuthToken } = require('../middleware/auth.middleware');

function createPgPoolAdapter() {
  const pgPool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'salon_saas_test'
  });

  function convertSql(sql) {
    let idx = 0;
    return sql.replace(/\?/g, () => `$${++idx}`);
  }

  function wrapClient(client) {
    return {
      query: async (sql, params = []) => {
        const res = await client.query(convertSql(sql), params);
        return [res.rows, res];
      },
      beginTransaction: async () => { await client.query('BEGIN'); },
      commit: async () => { await client.query('COMMIT'); },
      rollback: async () => { await client.query('ROLLBACK'); },
      release: () => client.release()
    };
  }

  return {
    raw: pgPool,
    query: async (sql, params = []) => {
      const res = await pgPool.query(convertSql(sql), params);
      return [res.rows, res];
    },
    getConnection: async () => {
      const client = await pgPool.connect();
      return wrapClient(client);
    },
    end: () => pgPool.end()
  };
}

function httpRequest(port, method, path, { token = null, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body !== null ? JSON.stringify(body) : null;
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function run() {
  const pool = createPgPoolAdapter();
  // Ensure test routes remain disabled when ENABLE_TEST_ROUTES is not 'true'
  delete process.env.ENABLE_TEST_ROUTES;
  const app = createApp({ pool });
  const server = app.listen(0);
  const port = server.address().port;

  const createdTenantIds = [];
  const createdUserIds = [];
  const saId = crypto.randomUUID();
  const suffix = Date.now().toString(36);

  try {
    // Seed temporary superadmin in salon_saas_test
    await pool.query(
      `INSERT INTO users (id, name, nombre, email, password_hash, role, is_active, estado)
       VALUES (?, 'SA Audit', 'SA Audit', ?, '$2a$10$abcdefghijklmnopqrstuv', 'superadmin', true, 'Activo')`,
      [saId, `sa-audit-${suffix}@etereas.local`]
    );
    createdUserIds.push(saId);

    const saToken = signAuthToken({ id: saId, role: 'superadmin', tenant_id: null, isSuperAdmin: true });

    // 1. /api/test disabled when ENABLE_TEST_ROUTES !== 'true'
    const resTest = await httpRequest(port, 'GET', '/api/test/simulate-500', { token: saToken });
    assert.ok(resTest.status === 404 || resTest.status === 403, `/api/test must be disabled (got ${resTest.status})`);
    console.log(`[PASS] 1. /api/test disabled (${resTest.status})`);

    // 2. Create Tenant A via POST /api/saas/tenants (transactional, no B2C plans, no memberships)
    const slugA = `audit-salon-a-${suffix}`;
    const emailA = `owner-a-${suffix}@salon-a.com`;
    const resCreateA = await httpRequest(port, 'POST', '/api/saas/tenants', {
      token: saToken,
      body: {
        business_name: `Salon Audit A ${suffix}`,
        slug: slugA,
        owner_name: 'Owner A',
        owner_email: emailA,
        admin_password: 'Password123!',
        licensed_branches: 2,
        extra_user_seats: 1
      }
    });
    assert.strictEqual(resCreateA.status, 201, `Create Tenant A failed: ${JSON.stringify(resCreateA.body)}`);
    assert.strictEqual(resCreateA.body.plan_code, 'PRINCIPAL');
    assert.strictEqual(resCreateA.body.has_memberships, false);
    assert.ok(!JSON.stringify(resCreateA.body).includes('Password123!'), 'Password must never appear in response');
    const tenantA = resCreateA.body.tenant_id;
    const ownerAId = resCreateA.body.user_id;
    createdTenantIds.push(tenantA);
    createdUserIds.push(ownerAId);

    const [b2cPlansA] = await pool.query('SELECT COUNT(*) as c FROM plans WHERE tenant_id = ?', [tenantA]);
    assert.strictEqual(Number(b2cPlansA[0].c), 0, 'Must NOT auto-seed B2C plans');
    const [subsA] = await pool.query('SELECT plan_code, status FROM tenant_subscriptions WHERE tenant_id = ?', [tenantA]);
    assert.strictEqual(subsA.length, 1);
    assert.strictEqual(subsA[0].plan_code, 'PRINCIPAL');
    console.log('[PASS] 2. POST /api/saas/tenants transactional, no B2C plans, no password leak');

    // 3. Create Tenant B + duplicate email rollback check
    const slugB = `audit-salon-b-${suffix}`;
    const emailB = `owner-b-${suffix}@salon-b.com`;
    const resDup = await httpRequest(port, 'POST', '/api/saas/tenants', {
      token: saToken,
      body: {
        business_name: 'Dup Email Salon',
        slug: `dup-${suffix}`,
        owner_email: emailA,
        admin_password: 'Password123!'
      }
    });
    assert.strictEqual(resDup.status, 400);
    const [dupTenantRows] = await pool.query('SELECT id FROM tenants WHERE slug = ?', [`dup-${suffix}`]);
    assert.strictEqual(dupTenantRows.length, 0, 'Duplicate email must leave 0 tenant rows');

    const resCreateB = await httpRequest(port, 'POST', '/api/saas/tenants', {
      token: saToken,
      body: {
        business_name: `Salon Audit B ${suffix}`,
        slug: slugB,
        owner_name: 'Owner B',
        owner_email: emailB,
        admin_password: 'Password123!'
      }
    });
    assert.strictEqual(resCreateB.status, 201);
    const tenantB = resCreateB.body.tenant_id;
    const ownerBId = resCreateB.body.user_id;
    createdTenantIds.push(tenantB);
    createdUserIds.push(ownerBId);
    console.log('[PASS] 3. Duplicate rejection & rollback verified');

    // 4. Block 1 Security Matrix: anon, ownerA, superadmin
    const ownerAToken = signAuthToken({ id: ownerAId, role: 'owner', tenant_id: tenantA, isSuperAdmin: false });
    assert.strictEqual((await httpRequest(port, 'GET', '/api/security/login-attempts')).status, 401);
    assert.strictEqual((await httpRequest(port, 'GET', '/api/security/login-attempts', { token: saToken })).status, 403);
    assert.strictEqual((await httpRequest(port, 'GET', '/api/security/audit-logs', { token: saToken })).status, 403);
    assert.strictEqual((await httpRequest(port, 'POST', '/api/security/settings', { token: saToken, body: { tenant_id: tenantA } })).status, 403);

    const resOwnerLoginAttempts = await httpRequest(port, 'GET', '/api/security/login-attempts', { token: ownerAToken });
    assert.strictEqual(resOwnerLoginAttempts.status, 200);
    assert.deepStrictEqual(resOwnerLoginAttempts.body.blockedIps, [], 'Owner must not see global blockedIps');

    const resOwnerUnblockIp = await httpRequest(port, 'POST', '/api/security/unblock-ip', { token: ownerAToken, body: { ip_address: '1.2.3.4' } });
    assert.strictEqual(resOwnerUnblockIp.status, 403);

    // Cross-tenant unblock-account attempt by Owner A on Owner B's email -> 404
    const resCrossUnblock = await httpRequest(port, 'POST', '/api/security/unblock-account', {
      token: ownerAToken,
      body: { account_identifier: emailB }
    });
    assert.strictEqual(resCrossUnblock.status, 404, 'Cross-tenant unblock-account must be denied');

    // Control Plane security endpoints: owner blocked (403), superadmin allowed (200) and audited
    assert.strictEqual((await httpRequest(port, 'GET', '/api/saas/security/login-attempts', { token: ownerAToken })).status, 403);
    assert.strictEqual((await httpRequest(port, 'GET', '/api/saas/security/login-attempts', { token: saToken })).status, 200);
    assert.strictEqual((await httpRequest(port, 'GET', '/api/saas/security/audit-logs', { token: saToken })).status, 200);
    console.log('[PASS] 4. Security isolation & Control Plane endpoints verified');

    // 5. Block 2: GET /api/saas/subscriptions & /invoices + extend-grace
    const resSubs = await httpRequest(port, 'GET', '/api/saas/subscriptions', { token: saToken });
    assert.strictEqual(resSubs.status, 200, `GET /subscriptions failed: ${JSON.stringify(resSubs.body)}`);
    assert.ok(Array.isArray(resSubs.body.subscriptions));

    const resGrace = await httpRequest(port, 'POST', '/api/saas/billing/admin/extend-grace', {
      token: saToken,
      body: { tenantId: tenantA, additionalDays: 7, reason: 'Acuerdo comercial de prueba' }
    });
    assert.strictEqual(resGrace.status, 200, `extend-grace failed: ${JSON.stringify(resGrace.body)}`);
    console.log('[PASS] 5. Billing subscriptions & extend-grace verified');

    // 6. Block 4: Partial licensing & modules updates preserve other fields
    const resLic = await httpRequest(port, 'PUT', `/api/saas/tenants/${tenantA}/licensing`, {
      token: saToken,
      body: { extra_user_seats: 3 }
    });
    assert.strictEqual(resLic.status, 200);
    assert.strictEqual(resLic.body.licensed_branches, 2, 'licensed_branches preserved');
    assert.strictEqual(resLic.body.extra_user_seats, 3);
    assert.strictEqual(resLic.body.max_users, 9, '2 * 3 + 3 = 9');
    assert.strictEqual(resLic.body.has_memberships, false, 'has_memberships preserved');

    const resModBad = await httpRequest(port, 'PUT', `/api/saas/tenants/${tenantA}/modules`, {
      token: saToken,
      body: { modules_config: { memberships: true } }
    });
    assert.strictEqual(resModBad.status, 400, 'memberships must stay separated from modules endpoint');

    const resModOk = await httpRequest(port, 'PUT', `/api/saas/tenants/${tenantA}/modules`, {
      token: saToken,
      body: { modules_config: { dgii_ecf: false } }
    });
    assert.strictEqual(resModOk.status, 200);
    assert.strictEqual(resModOk.body.modules_config.pos, true, 'Existing pos module preserved');
    assert.strictEqual(resModOk.body.modules_config.dgii_ecf, false);
    console.log('[PASS] 6. Partial licensing & modules updates preserve state');

    // 7. Block 3: Status state machine & sync
    const resSuspend = await httpRequest(port, 'PUT', `/api/saas/tenants/${tenantA}/status`, {
      token: saToken,
      body: { status: 'suspended', reason: 'Test suspension' }
    });
    assert.strictEqual(resSuspend.status, 200);
    const [subAfterSuspend] = await pool.query('SELECT status FROM tenant_subscriptions WHERE tenant_id = ?', [tenantA]);
    assert.strictEqual(subAfterSuspend[0].status, 'suspended');

    const resInvalidTrans = await httpRequest(port, 'PUT', `/api/saas/tenants/${tenantA}/status`, {
      token: saToken,
      body: { status: 'past_due' }
    });
    assert.strictEqual(resInvalidTrans.status, 400);
    console.log('[PASS] 7. Status state machine & sync verified');

    // 8. Block 5: Metrics & MRR_by_currency + Tenants DTO
    const resMetrics = await httpRequest(port, 'GET', '/api/saas/metrics', { token: saToken });
    assert.strictEqual(resMetrics.status, 200);
    assert.ok(resMetrics.body.mrr_by_currency && typeof resMetrics.body.mrr_by_currency === 'object');
    assert.ok(resMetrics.body.total_tenants >= 2);
    const resTenants = await httpRequest(port, 'GET', '/api/saas/tenants', { token: saToken });
    assert.strictEqual(resTenants.status, 200);
    const foundA = resTenants.body.find((t) => t.id === tenantA);
    assert.ok(foundA && foundA.branches_count !== undefined && foundA.users_count !== undefined && foundA.plan_extra_user_price !== undefined);
    console.log('[PASS] 8. Metrics, mrr_by_currency & Tenants DTO verified');

    console.log('\n✅ ALL POSTGRESQL SUPERADMIN REMEDIATION TESTS PASSED');
  } finally {
    // Cleanup synthetic fixtures in salon_saas_test
    for (const tid of createdTenantIds) {
      await pool.query('DELETE FROM security_audit_logs WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM tenant_subscription_events WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM tenant_subscriptions WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM users WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM salons WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM branches WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM tenants WHERE id = ?', [tid]).catch(() => {});
    }
    for (const uid of createdUserIds) {
      await pool.query('DELETE FROM security_audit_logs WHERE user_id = ?', [uid]).catch(() => {});
      await pool.query('DELETE FROM users WHERE id = ?', [uid]).catch(() => {});
    }
    server.close();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exitCode = 1;
});

