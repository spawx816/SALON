'use strict';

const assert = require('assert');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { validateTestEnvironment, createIsolatedTestPool } = require('../utils/test_env_guard.cjs');
const { up: applyKioskMigration } = require('../migrations/20261117_kiosk_devices_hardening.cjs');
const { createApp } = require('../app.js');
const { EntitlementsRepository } = require('../repositories/entitlements.repository');
const { signAuthToken } = require('../middleware/auth.middleware');

async function reqJson(baseUrl, method, pathUrl, { cookie = '', body = null } = {}) {
  const headers = { Origin: baseUrl };
  if (cookie) headers.Cookie = cookie;
  if (body !== null) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${baseUrl}${pathUrl}`, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
  return { status: res.status, body: json, setCookies };
}

async function main() {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_kiosk_32_chars_min_12345';
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  const testConfig = validateTestEnvironment();
  const pool = createIsolatedTestPool(testConfig);

  const [ctx] = await pool.query('SELECT current_database() AS db');
  assert.strictEqual(ctx[0].db, testConfig.database);
  console.log(`🖥️ Iniciando pruebas de Usuario Dedicado Kiosco en db="${ctx[0].db}"...`);

  await applyKioskMigration(pool);

  const app = createApp({ pool });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const entRepo = new EntitlementsRepository(pool);

  const tag = crypto.randomBytes(4).toString('hex');
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const branchA1 = crypto.randomUUID();
  const branchA2 = crypto.randomUUID();
  const branchB1 = crypto.randomUUID();
  const ownerAId = crypto.randomUUID();
  const empBillableAId = crypto.randomUUID();
  const empPass = 'EmpPin2026';
  const kioskPass = 'KioskPass!2026';
  const empHash = bcrypt.hashSync(empPass, 10);

  try {
    await pool.query(
      "INSERT INTO tenants (id, business_name, email, slug, status, max_users, max_branches) VALUES (?, ?, ?, ?, 'active', 3, 2)",
      [tenantA, `KioskRole A ${tag}`, `ka-${tag}@test.local`, `kr-a-${tag}`]
    );
    await pool.query(
      "INSERT INTO tenants (id, business_name, email, slug, status, max_users, max_branches) VALUES (?, ?, ?, ?, 'active', 3, 1)",
      [tenantB, `KioskRole B ${tag}`, `kb-${tag}@test.local`, `kr-b-${tag}`]
    );
    await pool.query(
      'INSERT INTO branches (id, tenant_id, name, is_main, is_active) VALUES (?, ?, ?, TRUE, TRUE), (?, ?, ?, FALSE, TRUE)',
      [branchA1, tenantA, 'Sucursal A1', branchA2, tenantA, 'Sucursal A2']
    );
    await pool.query(
      'INSERT INTO branches (id, tenant_id, name, is_main, is_active) VALUES (?, ?, ?, TRUE, TRUE)',
      [branchB1, tenantB, 'Sucursal B1']
    );
    await pool.query(
      "INSERT INTO tenant_subscriptions (id, tenant_id, plan_code, status, billing_cycle, currency, current_period_start, current_period_end) VALUES (?, ?, 'PRINCIPAL', 'active', 'monthly', 'DOP', NOW(), NOW() + INTERVAL '30 days')",
      [crypto.randomUUID(), tenantA]
    );

    const ownerEmail = `owner_${tag}@test.local`;
    const empEmail = `emp_${tag}@test.local`;
    const emp2Email = `emp2_${tag}@test.local`;
    await pool.query(
      "INSERT INTO users (id, tenant_id, branch_id, name, nombre, email, password_hash, role, all_branches_access, is_active, estado) VALUES (?, ?, ?, 'Owner A', 'Owner A', ?, ?, 'propietario', TRUE, TRUE, 'Activo'), (?, ?, ?, 'Emp A1', 'Emp A1', ?, ?, 'estilista', FALSE, TRUE, 'Activo'), (?, ?, ?, 'Emp A1b', 'Emp A1b', ?, ?, 'cajero', FALSE, TRUE, 'Activo')",
      [ownerAId, tenantA, branchA1, ownerEmail, empHash, empBillableAId, tenantA, branchA1, empEmail, empHash, crypto.randomUUID(), tenantA, branchA1, emp2Email, empHash]
    );

    const [sA1] = await pool.query(
      "INSERT INTO staff_records (tenant_id, nombre, email, salon_id, status) VALUES (?, 'Emp A1', ?, ?, 'Activo') RETURNING id",
      [tenantA, empEmail, branchA1]
    );
    const staffA1Id = String(sA1[0].id);
    const [sA2] = await pool.query(
      "INSERT INTO staff_records (tenant_id, nombre, salon_id, status) VALUES (?, 'Emp A2', ?, 'Activo') RETURNING id",
      [tenantA, branchA2]
    );
    const staffA2Id = String(sA2[0].id);
    const [sB1] = await pool.query(
      "INSERT INTO staff_records (tenant_id, nombre, salon_id, status) VALUES (?, 'Emp B1', ?, 'Activo') RETURNING id",
      [tenantB, branchB1]
    );
    const staffB1Id = String(sB1[0].id);

    const ownerToken = signAuthToken({
      sub: ownerAId,
      id: ownerAId,
      email: ownerEmail,
      name: 'Owner A',
      role: 'propietario',
      tenantId: tenantA,
      branchId: branchA1,
      tokenVersion: 1,
    });
    const ownerCookie = `auth_token=${ownerToken}`;

    // 1. Cupo lleno (2/2): crear usuario facturable falla (403), pero crear kiosco_asistencia PASA (200)
    const billableFail = await reqJson(baseUrl, 'POST', '/api/users', {
      cookie: ownerCookie,
      body: { nombre: 'Extra Billable', email: `extra_${tag}@test.local`, password: 'Password!2026', role: 'empleado', branch_id: branchA1 },
    });
    assert.strictEqual(billableFail.status, 403, 'Debe rechazar usuario facturable cuando el cupo está lleno');

    const kioskNoBranch = await reqJson(baseUrl, 'POST', '/api/users', {
      cookie: ownerCookie,
      body: { nombre: 'Kiosco Sin Sucursal', email: `kiosk_nb_${tag}@test.local`, password: kioskPass, role: 'kiosco_asistencia' },
    });
    assert.strictEqual(kioskNoBranch.status, 400);
    assert.strictEqual(kioskNoBranch.body.code, 'KIOSK_BRANCH_REQUIRED');

    const kioskWithRoleId = await reqJson(baseUrl, 'POST', '/api/users', {
      cookie: ownerCookie,
      body: { nombre: 'Kiosco Con Permisos', email: `kiosk_rp_${tag}@test.local`, password: kioskPass, role: 'kiosco_asistencia', role_id: 1, branch_id: branchA1 },
    });
    assert.strictEqual(kioskWithRoleId.status, 400);
    assert.strictEqual(kioskWithRoleId.body.code, 'KIOSK_FIXED_PERMISSIONS');

    const kioskEmail = `kiosk_${tag}@test.local`;
    const kioskCreate = await reqJson(baseUrl, 'POST', '/api/users', {
      cookie: ownerCookie,
      body: { nombre: 'Kiosco Sucursal A1', email: kioskEmail, password: kioskPass, role: 'kiosco_asistencia', branch_id: branchA1 },
    });
    assert.strictEqual(kioskCreate.status, 200, `Error creando kiosco: ${JSON.stringify(kioskCreate.body)}`);
    const kioskUserId = String(kioskCreate.body.id);

    const billableCount = await entRepo.countResourceUsage(tenantA, 'users');
    assert.strictEqual(billableCount, 3, 'Cuenta kiosco_asistencia NO debe incrementar usuarios facturables');
    console.log('  ✅ 1. Kiosco creado con cupo lleno (3/3), sin consumir licencia ni permitir permisos extra.');

    // 2. Cambiar kiosco_asistencia -> rol facturable con cupo lleno debe rechazarse (403)
    const upgradeFail = await reqJson(baseUrl, 'PUT', `/api/users/${kioskUserId}`, {
      cookie: ownerCookie,
      body: { role: 'empleado' },
    });
    assert.strictEqual(upgradeFail.status, 403, 'Cambiar kiosco a rol facturable con cupo lleno debe devolver 403');
    console.log('  ✅ 2. Cambio de cuenta kiosco a rol facturable valida cupo disponible (403 PLAN_LIMIT_REACHED).');

    // 3. Login de cuenta kiosco -> kioskOnly: true + cookie kiosk_device_token + bloqueo de otros módulos
    const loginRes = await reqJson(baseUrl, 'POST', '/api/auth/login', {
      body: { email: kioskEmail, password: kioskPass },
    });
    assert.strictEqual(loginRes.status, 200, `Login kiosco falló: ${JSON.stringify(loginRes.body)}`);
    assert.strictEqual(loginRes.body.role, 'kiosco_asistencia');
    assert.strictEqual(loginRes.body.kioskOnly, true);
    const kioskCookies = loginRes.setCookies.map((c) => c.split(';')[0]).join('; ');
    assert.ok(kioskCookies.includes('kiosk_device_token='), 'Login de cuenta kiosco debe emitir kiosk_device_token');

    for (const blockedPath of ['/api/salons', '/api/clients', '/api/saas/billing/subscription', '/api/kiosk/devices']) {
      const blocked = await reqJson(baseUrl, 'GET', blockedPath, { cookie: kioskCookies });
      assert.strictEqual(blocked.status, 403, `Ruta ${blockedPath} debe estar bloqueada para kiosco_asistencia`);
    }
    console.log('  ✅ 3. Login dedicado vincula kiosco automáticamente y bloquea acceso a módulos administrativos/operativos (403).');

    // 4. Ponche, autoservicio y rechazo cross-branch / cross-tenant
    const sessRes = await reqJson(baseUrl, 'GET', '/api/kiosk/session', { cookie: kioskCookies });
    assert.strictEqual(sessRes.status, 200);
    assert.strictEqual(sessRes.body.bound, true);
    assert.strictEqual(sessRes.body.branch.id, branchA1);

    const empListRes = await reqJson(baseUrl, 'GET', '/api/kiosk/employees', { cookie: kioskCookies });
    assert.strictEqual(empListRes.status, 200);
    assert.strictEqual(empListRes.body.employees.length, 1);
    assert.strictEqual(String(empListRes.body.employees[0].id), staffA1Id);

    const crossBranchRes = await reqJson(baseUrl, 'POST', '/api/kiosk/verify-employee', {
      cookie: kioskCookies,
      body: { employee_id: staffA2Id, password: empPass },
    });
    assert.strictEqual(crossBranchRes.status, 403);

    const crossTenantRes = await reqJson(baseUrl, 'POST', '/api/kiosk/verify-employee', {
      cookie: kioskCookies,
      body: { employee_id: staffB1Id, password: empPass },
    });
    assert.strictEqual(crossTenantRes.status, 403);

    const verifyOk = await reqJson(baseUrl, 'POST', '/api/kiosk/verify-employee', {
      cookie: kioskCookies,
      body: { employee_id: staffA1Id, password: empPass },
    });
    assert.strictEqual(verifyOk.status, 200);

    const tinyJpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
    const punchOk = await reqJson(baseUrl, 'POST', '/api/kiosk/punch', {
      cookie: kioskCookies,
      body: {
        employeeId: staffA1Id,
        type: 'Check-In',
        photo: tinyJpg,
        punch_token: verifyOk.body.punch_token,
        idempotency_key: `DK-${tag}`,
      },
    });
    assert.strictEqual(punchOk.status, 200);
    assert.strictEqual(punchOk.body.success, true);

    const ssVerify = await reqJson(baseUrl, 'POST', '/api/kiosk/self-service/verify', {
      cookie: kioskCookies,
      body: { employee_id: staffA1Id, pin: empPass },
    });
    assert.strictEqual(ssVerify.status, 200);
    const ssCookies = [kioskCookies, ...ssVerify.setCookies.map((c) => c.split(';')[0])].join('; ');
    const ssComm = await reqJson(baseUrl, 'GET', '/api/kiosk/self-service/commissions', { cookie: ssCookies });
    assert.strictEqual(ssComm.status, 200);
    console.log('  ✅ 4. Ponche, autoservicio y aislamiento cross-branch/cross-tenant verificados desde cuenta kiosco.');

    // 5. Desactivación de cuenta kiosco revoca dispositivo inmediatamente
    const deactRes = await reqJson(baseUrl, 'PUT', `/api/users/${kioskUserId}`, {
      cookie: ownerCookie,
      body: { estado: 'Inactivo' },
    });
    assert.strictEqual(deactRes.status, 200);

    const afterDeact = await reqJson(baseUrl, 'GET', '/api/kiosk/employees', { cookie: kioskCookies });
    assert.strictEqual(afterDeact.status, 401);
    assert.strictEqual(afterDeact.body.code, 'KIOSK_DEVICE_UNBOUND');
    console.log('  ✅ 5. Desactivación de cuenta kiosco revoca inmediatamente el dispositivo y bloquea operaciones.');

    console.log('\n🎉 TODAS LAS PRUEBAS DE USUARIO DEDICADO KIOSCO PASARON.');
  } finally {
    server.close();
    await pool.query('DELETE FROM attendance WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM kiosk_employee_sessions WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM kiosk_devices WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM user_sessions WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM staff_records WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM users WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM tenant_subscriptions WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM branches WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM tenants WHERE id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ ERROR EN PRUEBAS DE USUARIO KIOSCO:', err);
  process.exit(1);
});
