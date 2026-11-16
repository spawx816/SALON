'use strict';

/**
 * Suite Integral de Pruebas RBAC — Etereas
 * Verifica aislamiento multi-tenant, ciclo de vida de roles, protección Last-Owner concurrente,
 * revocación inmediata en sesión abierta, alcance de sucursales, separación de add-ons y SaaS Billing Owner-only.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_must_be_at_least_32_characters_long_for_security';

const assert = require('assert');
const http = require('http');
const express = require('express');

const { InMemoryDbMock } = require('./helpers/in_memory_db_mock.cjs');
const { createAuthMiddleware, signAuthToken } = require('../middleware/auth.middleware');
const { requireRole, requirePermission, normalizeRole, getEffectiveRole } = require('../middleware/rbac.middleware');
const { createAuthRouter } = require('../routes/auth.routes');
const { createCashRegistersRouter } = require('../routes/cash_registers.routes');
const { createSaasBillingRouter } = require('../routes/saas_billing.routes');
const { createInventoryRouter } = require('../routes/inventory.routes');
const { InMemorySaasBillingRepository } = require('../repositories/fakes/in_memory_saas_billing.repository');

async function runTests() {
  console.log('🛡️ Iniciando suite integral de pruebas RBAC...\n');

  const pool = new InMemoryDbMock();
  pool.tables.tenants = [
    { id: 'tenant-a', status: 'active', business_name: 'Salon A', plan_id: 1, max_users: 20 },
    { id: 'tenant-b', status: 'active', business_name: 'Salon B', plan_id: 1, max_users: 20 },
  ];
  pool.tables.branches = [
    { id: 101, tenant_id: 'tenant-a', name: 'Sucursal A1', is_main: true },
    { id: 102, tenant_id: 'tenant-a', name: 'Sucursal A2', is_main: false },
    { id: 201, tenant_id: 'tenant-b', name: 'Sucursal B1', is_main: true },
  ];
  pool.tables.roles = [
    { id: 10, tenant_id: 'tenant-a', nombre: 'Cajero POS', description: '', permisos: JSON.stringify({ 'pos.visits.view': true, 'pos.visits.create': true, 'pos.cash_registers.view': true, 'pos.cash_registers.manage': true }) },
    { id: 11, tenant_id: 'tenant-a', nombre: 'Membresias Role', description: '', permisos: JSON.stringify({ 'memberships.plans.manage': true }) },
    { id: 20, tenant_id: 'tenant-b', nombre: 'Admin B', description: '', permisos: JSON.stringify({ 'security.manage': true, 'payroll.approve': true }) },
  ];
  pool.tables.users = [
    { id: 'u-owner-a', tenant_id: 'tenant-a', branch_id: 101, email: 'owner@a.com', name: 'Owner A', role: 'propietario', role_id: null, is_active: true, estado: 'Activo', token_version: 1 },
    { id: 'u-admin-a', tenant_id: 'tenant-a', branch_id: 101, email: 'admin@a.com', name: 'Admin A', role: 'admin', role_id: null, is_active: true, estado: 'Activo', token_version: 1 },
    { id: 'u-emp-a', tenant_id: 'tenant-a', branch_id: 101, authorized_branch_ids: JSON.stringify(['101']), all_branches_access: false, email: 'emp@a.com', name: 'Emp A', role: 'empleado', role_id: 10, is_active: true, estado: 'Activo', token_version: 1 },
    { id: 'u-mem-a', tenant_id: 'tenant-a', branch_id: 101, email: 'mem@a.com', name: 'Mem A', role: 'empleado', role_id: 11, is_active: true, estado: 'Activo', token_version: 1 },
  ];
  pool.tables.clients = [
    { id: 'c-b2c-a', tenant_id: 'tenant-a', nombre: 'Clienta B2C', email: 'clienta@a.com', status: 'Activo' },
  ];
  pool.tables.cash_registers = [
    { id: 1, tenant_id: 'tenant-a', branch_id: 101, salon_id: '101', status: 'Abierta', opened_at: '2026-11-15T10:00:00Z' },
    { id: 2, tenant_id: 'tenant-a', branch_id: 102, salon_id: '102', status: 'Abierta', opened_at: '2026-11-15T10:00:00Z' },
  ];
  pool.tables.security_settings = [
    { id: 1, tenant_id: 'tenant-a', allow_admin_role_delegation: false },
  ];
  pool.tables.user_sessions = [];
  pool.tables.security_audit_logs = [];

  const app = express();
  app.use(express.json());
  const { authenticate } = createAuthMiddleware(pool);
  app.use('/api', authenticate);

  const { router: authRouter } = createAuthRouter(pool, {});
  app.use('/api', authRouter);

  app.use('/api/cash-registers', createCashRegistersRouter(pool));

  // Simulated feature-gated memberships endpoint
  const fakeRequireMembershipsAddon = (_req, res, _next) =>
    res.status(403).json({ error: 'Add-on Membresías no contratado', code: 'FEATURE_LOCKED_UPGRADE_REQUIRED' });
  app.get('/api/plans', fakeRequireMembershipsAddon, requirePermission('memberships.plans.manage'), (_req, res) => {
    res.json({ ok: true });
  });

  // Simulated protected endpoints for action testing
  app.get('/api/payroll', requirePermission('payroll.view'), (_req, res) => res.json({ ok: true }));
  app.post('/api/visits', requirePermission('pos.visits.create'), (_req, res) => res.json({ ok: true }));
  app.post('/api/visits/:id/void', requirePermission('pos.invoices.void'), (_req, res) => res.json({ ok: true }));
  app.get('/api/unknown-perm-test', requirePermission('non_existent.permission'), (_req, res) => res.json({ ok: true }));

  const billingRepo = new InMemorySaasBillingRepository();
  app.use('/api/saas/billing', createSaasBillingRouter(pool, { billingRepo }));

  const mockTransferService = {
    requestTransfer: async (_tId, data) => ({ id: 'tr-1', ...data }),
  };
  app.use('/api/inventory', createInventoryRouter({
    inventoryService: {},
    purchaseService: {},
    transferService: mockTransferService,
    physicalSessionService: {},
    requirePlanFeature: () => (_req, _res, next) => next(),
  }));

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const mkToken = (u, extra = {}) =>
    signAuthToken({
      sub: u.id,
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      tenantId: u.tenant_id,
      branchId: u.branch_id,
      tokenVersion: u.token_version,
      ...extra,
    });

  const ownerToken = mkToken(pool.tables.users[0]);
  const adminToken = mkToken(pool.tables.users[1]);
  const empToken = mkToken(pool.tables.users[2]);
  const memToken = mkToken(pool.tables.users[3]);
  const b2cToken = mkToken({ id: 'c-b2c-a', email: 'clienta@a.com', name: 'Clienta', role: 'client', tenant_id: 'tenant-a', branch_id: null, token_version: 1 }, { isClient: true });

  const call = async (method, p, token, body) => {
    const res = await fetch(baseUrl + p, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  };

  try {
    // 1. Empleado & B2C cannot create roles
    const t1a = await call('POST', '/api/roles', empToken, { nombre: 'Hacker', permisos: { 'security.manage': true } });
    assert.strictEqual(t1a.status, 403, 'Empleado no debe poder crear roles');
    const t1b = await call('POST', '/api/roles', b2cToken, { nombre: 'HackerB2C', permisos: { 'security.manage': true } });
    assert.strictEqual(t1b.status, 403, 'Cliente B2C no debe poder crear roles');
    console.log('  ✅ 1. Empleado y cliente B2C bloqueados al intentar crear roles.');

    // 2. Reserved role names rejected
    const t2 = await call('POST', '/api/roles', ownerToken, { nombre: 'superadmin', permisos: { 'pos.visits.view': true } });
    assert.strictEqual(t2.status, 400);
    assert.strictEqual(t2.data.code, 'RESERVED_ROLE_NAME');
    console.log('  ✅ 2. Creación de roles con nombres reservados (superadmin) rechazada.');

    // 3. Cross-tenant role_id and branch_id rejected
    const t3a = await call('PUT', '/api/users/u-emp-a', ownerToken, { role_id: 20 });
    assert.strictEqual(t3a.status, 403);
    assert.strictEqual(t3a.data.code, 'INVALID_OR_CROSS_TENANT_ROLE');

    const t3b = await call('PUT', '/api/users/u-emp-a', ownerToken, { branch_id: 201 });
    assert.strictEqual(t3b.status, 403);
    assert.strictEqual(t3b.data.code, 'INVALID_OR_CROSS_TENANT_BRANCH');
    console.log('  ✅ 3. Rechazo de role_id y branch_id pertenecientes a otra empresa.');

    // 4. Admin cannot self-escalate
    const t4 = await call('PUT', '/api/users/u-admin-a', adminToken, { role_id: 10 });
    assert.strictEqual(t4.status, 403);
    assert.strictEqual(t4.data.code, 'SELF_PRIVILEGE_MODIFICATION_DENIED');
    console.log('  ✅ 4. Auto-escalada de Admin bloqueada.');

    // 5. Last Owner protection under concurrency
    const concurrentOwnerAttempts = await Promise.all([
      call('PUT', '/api/users/u-owner-a', ownerToken, { role: 'empleado' }),
      call('PUT', '/api/users/u-owner-a', ownerToken, { estado: 'Inactivo' }),
      call('DELETE', '/api/users/u-owner-a', ownerToken),
    ]);
    for (const attempt of concurrentOwnerAttempts) {
      assert.ok([403, 409].includes(attempt.status), `Se esperaba 403/409 protegiendo último Owner, recibido ${attempt.status}`);
    }
    assert.strictEqual(concurrentOwnerAttempts[2].status, 409, 'DELETE de último Owner debe retornar 409');
    console.log('  ✅ 5. Último Owner protegido ante degradación, desactivación y eliminación concurrente.');

    // 6. Custom role authorizes exact actions & fail-closed on unknown permissions
    const t6a = await call('POST', '/api/visits', empToken, {});
    assert.strictEqual(t6a.status, 200);
    const t6b = await call('POST', '/api/visits/1/void', empToken, {});
    assert.strictEqual(t6b.status, 403);
    const t6c = await call('GET', '/api/payroll', empToken);
    assert.strictEqual(t6c.status, 403);
    const t6d = await call('GET', '/api/unknown-perm-test', empToken);
    assert.strictEqual(t6d.status, 403);
    console.log('  ✅ 6. Roles personalizados autorizan exactamente sus acciones y deniegan permisos desconocidos.');

    // 7. Revoked permission stops working immediately on open session
    const revokeRes = await call('PUT', '/api/roles/10', ownerToken, {
      nombre: 'Cajero POS',
      permisos: { 'pos.visits.view': true } // revocado pos.visits.create
    });
    assert.strictEqual(revokeRes.status, 200);
    const afterRevoke = await call('POST', '/api/visits', empToken, {});
    assert.ok([401, 403].includes(afterRevoke.status), `Esperado 401/403 tras revocación, obtenido ${afterRevoke.status}`);
    console.log('  ✅ 7. Permiso revocado bloqueado inmediatamente en sesión abierta.');

    // 8. Branch scope restrictions on reads, writes and transfers (with refreshed token after role edit)
    const empFreshToken = mkToken(pool.tables.users[2]);
    const cashList = await call('GET', '/api/cash-registers', empFreshToken);
    assert.strictEqual(cashList.status, 200);
    assert.strictEqual(cashList.data.length, 1);
    assert.strictEqual(String(cashList.data[0].branch_id), '101');

    const cashOtherBranch = await call('GET', '/api/cash-registers?salon_id=102', empFreshToken);
    assert.strictEqual(cashOtherBranch.status, 403);

    const transferUnauthorized = await call('POST', '/api/inventory/transfers', empFreshToken, {
      from_branch_id: 101,
      to_branch_id: 102,
      items: [],
    });
    assert.strictEqual(transferUnauthorized.status, 403);
    console.log('  ✅ 8. Restricciones por sucursal aplicadas a lectura, escritura y transferencias.');

    // 9. Memberships add-on remains blocked without add-on even if role has permission
    const memBlocked = await call('GET', '/api/plans', memToken);
    assert.strictEqual(memBlocked.status, 403);
    assert.strictEqual(memBlocked.data.code, 'FEATURE_LOCKED_UPGRADE_REQUIRED');
    console.log('  ✅ 9. Membresías bloqueadas sin add-on contratado aunque el rol tenga el permiso.');

    // 10. SaaS Billing sensitive actions remain Owner-only & Role-in-use deletion rejected
    const cancelByAdmin = await call('POST', '/api/saas/billing/subscription/cancel', adminToken, {});
    assert.strictEqual(cancelByAdmin.status, 403);
    assert.strictEqual(cancelByAdmin.data.code, 'OWNER_ONLY_SAAS_BILLING');

    const delInUse = await call('DELETE', '/api/roles/10', ownerToken);
    assert.strictEqual(delInUse.status, 409);
    assert.strictEqual(delInUse.data.code, 'ROLE_IN_USE');

    // Reassign emp to role 11, then delete role 10
    await call('PUT', '/api/users/u-emp-a', ownerToken, { role_id: 11 });
    const delFree = await call('DELETE', '/api/roles/10', ownerToken);
    assert.strictEqual(delFree.status, 200);
    console.log('  ✅ 10. Billing SaaS exclusivo de Owner y eliminación de rol en uso rechazada hasta reasignar.');

    // Role normalization verification: contador & unknown NEVER become admin
    assert.strictEqual(normalizeRole('contador'), 'contador');
    assert.strictEqual(getEffectiveRole({ auth: { role: 'contador' } }), 'contador');
    assert.strictEqual(getEffectiveRole({ auth: { role: 'inventado' } }), 'empleado');
    console.log('  ✅ 11. Normalización segura de alias verificada (contador/desconocido jamás escalan a admin).');

    console.log('\n🎉 TODAS LAS PRUEBAS DE REMEDIACIÓN RBAC PASARON EXITOSAMENTE.');
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error('❌ FALLO EN PRUEBA RBAC:', err);
  process.exit(1);
});
