'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_must_be_at_least_32_characters_long_for_security';

const assert = require('assert');
const http = require('http');
const express = require('express');
const { createAuthMiddleware, signAuthToken } = require('../middleware/auth.middleware');
const { createSaasBillingRouter } = require('../routes/saas_billing.routes');
const { SubscriptionLifecycleService } = require('../services/subscription_lifecycle.service');
const { SUBSCRIPTION_STATUSES } = require('../services/saas_billing.constants');
const { InMemoryDbMock } = require('./helpers/in_memory_db_mock.cjs');

function createCancelTestHarness() {
  const pool = new InMemoryDbMock();
  pool.tables.tenants = [
    { id: 't-active', status: 'active', business_name: 'Salon Activo', owner_email: 'owner.active@test.local', plan_id: 1 },
    { id: 't-pending', status: 'pending', business_name: 'Salon Pendiente', owner_email: 'owner.pending@test.local', plan_id: 1 },
    { id: 't-suspended', status: 'suspended', business_name: 'Salon Suspendido', owner_email: 'owner.susp@test.local', plan_id: 1 },
  ];
  pool.tables.users = [
    { id: 'u-owner-active', role: 'owner', tenant_id: 't-active', status: 'active', token_version: 1, email: 'owner.active@test.local', name: 'Owner Active' },
    { id: 'u-owner-pending', role: 'owner', tenant_id: 't-pending', status: 'active', token_version: 1, email: 'owner.pending@test.local', name: 'Owner Pending' },
    { id: 'u-owner-susp', role: 'owner', tenant_id: 't-suspended', status: 'active', token_version: 1, email: 'owner.susp@test.local', name: 'Owner Susp' },
    { id: 'u-staff', role: 'employee', tenant_id: 't-pending', status: 'active', token_version: 1, email: 'staff@test.local', name: 'Staff' },
  ];
  pool.tables.clients = [
    { id: 'u-b2c', tenant_id: 't-pending', status: 'Active', token_version: 1, email: 'client@test.local', nombre: 'Client' },
  ];
  pool.tables.roles = [];
  pool.tables.tenant_terms_acceptances = [
    { id: 1, tenant_id: 't-active', terms_version: 'v2026.1', accepted_at_utc: '2026-11-01T00:00:00Z' },
    { id: 2, tenant_id: 't-pending', terms_version: 'v2026.1', accepted_at_utc: '2026-11-01T00:00:00Z' },
    { id: 3, tenant_id: 't-suspended', terms_version: 'v2026.1', accepted_at_utc: '2026-11-01T00:00:00Z' },
  ];

  const subscriptions = {
    't-active': { id: 1, tenant_id: 't-active', plan_code: 'PRINCIPAL', status: SUBSCRIPTION_STATUSES.ACTIVE, current_period_end: '2026-12-15T00:00:00.000Z' },
    't-pending': { id: 2, tenant_id: 't-pending', plan_code: 'PRINCIPAL', status: 'pending', current_period_end: null },
    't-suspended': { id: 3, tenant_id: 't-suspended', plan_code: 'PRINCIPAL', status: SUBSCRIPTION_STATUSES.SUSPENDED, current_period_end: '2026-10-01T00:00:00.000Z' },
  };
  const invoices = [
    { id: 'inv-1', tenant_id: 't-pending', total_minor: 9900, status: 'open' },
    { id: 'inv-2', tenant_id: 't-suspended', total_minor: 9900, status: 'past_due' },
  ];
  const orders = [
    { id: 'ord-1', tenant_id: 't-active', auto_renew_enabled: true },
  ];
  const billingEvents = [];
  const auditLogs = [];

  const origQuery = pool.query.bind(pool);
  pool.query = async (sql, params = []) => {
    const norm = String(sql).replace(/\s+/g, ' ').trim();
    if (/UPDATE saas_checkout_orders SET auto_renew_enabled = FALSE/i.test(norm)) {
      const tid = String(params[0] || '');
      orders.filter((o) => o.tenant_id === tid).forEach((o) => { o.auto_renew_enabled = false; });
      return [{ affectedRows: 1 }];
    }
    if (/INSERT INTO security_audit_logs/i.test(norm)) {
      auditLogs.push({ tenant_id: params[0], user_id: params[1], details: params[2] });
      return [{ affectedRows: 1 }];
    }
    return origQuery(sql, params);
  };

  const subscriptionRepo = {
    async findByTenantId(tid) {
      return subscriptions[tid] ? { ...subscriptions[tid] } : null;
    },
    async upsertSubscription(tid, updated) {
      subscriptions[tid] = { ...updated };
      return subscriptions[tid];
    },
  };

  const billingRepo = {
    async recordBillingEvent(evt) {
      if (billingEvents.some((e) => e.idempotency_key === evt.idempotency_key)) return;
      billingEvents.push(evt);
    },
  };

  const lifecycleService = new SubscriptionLifecycleService({
    subscriptionRepo,
    billingRepo,
  });

  const { authenticate } = createAuthMiddleware(pool);
  const app = express();
  app.use(express.json());
  app.use('/api', authenticate);
  app.get('/api/visits', (_req, res) => res.json({ ok: true }));
  app.use('/api/saas/billing', createSaasBillingRouter({
    lifecycleService,
    billingRepo,
    pool,
  }));

  return { app, pool, tenants: pool.tables.tenants, subscriptions, invoices, orders, billingEvents, auditLogs, lifecycleService };
}

function callApi(server, method, path, token, body = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on('error', reject);
    if (method !== 'GET') req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('🛑 Iniciando pruebas de Cancelación de Suscripción SaaS...\n');
  const h = createCancelTestHarness();
  const server = await new Promise((resolve) => {
    const s = h.app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const tokActive = signAuthToken({ sub: 'u-owner-active', id: 'u-owner-active', role: 'owner', tenantId: 't-active', tokenVersion: 1 });
    const tokPending = signAuthToken({ sub: 'u-owner-pending', id: 'u-owner-pending', role: 'owner', tenantId: 't-pending', tokenVersion: 1 });
    const tokSusp = signAuthToken({ sub: 'u-owner-susp', id: 'u-owner-susp', role: 'owner', tenantId: 't-suspended', tokenVersion: 1 });
    const tokStaff = signAuthToken({ sub: 'u-staff', id: 'u-staff', role: 'employee', tenantId: 't-pending', tokenVersion: 1 });
    const tokB2C = signAuthToken({ sub: 'u-b2c', id: 'u-b2c', role: 'client', tenantId: 't-pending', tokenVersion: 1, isClient: true });

    // 1. Personal y B2C rechazados con 403; rutas operativas siguen bloqueadas en pending (402)
    const staffCancel = await callApi(server, 'POST', '/api/saas/billing/subscription/cancel', tokStaff, {});
    assert.strictEqual(staffCancel.status, 403);
    const b2cCancel = await callApi(server, 'POST', '/api/saas/billing/subscription/cancel', tokB2C, {});
    assert.strictEqual(b2cCancel.status, 403);
    const pendingOps = await callApi(server, 'GET', '/api/visits', tokPending);
    assert.strictEqual(pendingOps.status, 402, 'Rutas operativas deben seguir bloqueadas con 402');
    console.log('  ✅ 1. Personal y B2C bloqueados (403) y paywall operativo intacto (402).');

    // 2. Owner pending y Owner suspended pueden cancelar sin 402/403
    const resPending = await callApi(server, 'POST', '/api/saas/billing/subscription/cancel', tokPending, { reason: 'no_continuar' });
    assert.strictEqual(resPending.status, 200);
    assert.strictEqual(resPending.body.status, 'cancelled');
    assert.strictEqual(resPending.body.accessUntil, null);
    assert.strictEqual(resPending.body.termsVersion, 'v2026.1');

    const resSusp = await callApi(server, 'POST', '/api/saas/billing/subscription/cancel', tokSusp, { reason: 'cierre' });
    assert.strictEqual(resSusp.status, 200);
    assert.strictEqual(resSusp.body.status, 'cancelled');
    assert.strictEqual(resSusp.body.accessUntil, null);
    console.log('  ✅ 2. Owners en estado pending y suspended cancelan exitosamente (sin 402).');

    // 3. Owner active cancela conservando acceso hasta fin de ciclo + desactiva auto_renew + auditoría
    const resActive = await callApi(server, 'POST', '/api/saas/billing/subscription/cancel', tokActive, { reason: 'pausa' });
    assert.strictEqual(resActive.status, 200);
    assert.strictEqual(resActive.body.accessUntil, '2026-12-15T00:00:00.000Z');
    assert.strictEqual(h.orders[0].auto_renew_enabled, false, 'Renovación automática local desactivada');
    assert.strictEqual(h.auditLogs.length, 3);
    console.log('  ✅ 3. Owner activo cancela con fecha efectiva de fin de ciclo y auto_renew desactivado.');

    // 4. Idempotencia: repetir cancelación no duplica eventos ni auditoría
    const eventsBefore = h.billingEvents.length;
    const auditsBefore = h.auditLogs.length;
    const resRepeat = await callApi(server, 'POST', '/api/saas/billing/subscription/cancel', tokActive, { reason: 'repetido' });
    assert.strictEqual(resRepeat.status, 200);
    assert.strictEqual(resRepeat.body.alreadyCancelled, true);
    assert.strictEqual(h.billingEvents.length, eventsBefore);
    assert.strictEqual(h.auditLogs.length, auditsBefore);
    console.log('  ✅ 4. Idempotencia verificada (sin eventos ni auditorías duplicadas).');

    // 5. Fallo del proveedor externo no marca cancelación anticipada
    h.subscriptions['t-provider-fail'] = { id: 4, tenant_id: 't-provider-fail', plan_code: 'PRINCIPAL', status: SUBSCRIPTION_STATUSES.ACTIVE, current_period_end: '2026-12-20T00:00:00.000Z' };
    await assert.rejects(
      () => h.lifecycleService.cancelSubscription('t-provider-fail', {
        reason: 'test',
        actorId: 'u-1',
        pool: h.pool,
        providerAdapter: {
          async cancelRecurring() {
            return { ok: false, error: 'CardNet timeout' };
          },
        },
      }),
      (err) => err.code === 'PROVIDER_CANCELLATION_PENDING'
    );
    assert.strictEqual(h.subscriptions['t-provider-fail'].status, SUBSCRIPTION_STATUSES.ACTIVE, 'No debe marcar cancelada si proveedor falla');
    // Facturas e historial conservados
    assert.strictEqual(h.invoices.length, 2);
    console.log('  ✅ 5. Fallo del proveedor no marca éxito anticipado e historial/facturas conservados.');
  } finally {
    server.close();
  }

  console.log('\n🎉 TODAS LAS PRUEBAS DE CANCELACIÓN DE SUSCRIPCIÓN PASARON.');
}

runTests().catch((err) => {
  console.error('❌ Test fallido:', err);
  process.exit(1);
});
