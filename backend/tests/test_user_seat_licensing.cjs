'use strict';

const assert = require('assert');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { validateTestEnvironment, createIsolatedTestPool } = require('../utils/test_env_guard.cjs');
const { createApp } = require('../app.js');
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
  return { status: res.status, body: json };
}

async function main() {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_seats_32_chars_min_12345';
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  const testConfig = validateTestEnvironment();
  const pool = createIsolatedTestPool(testConfig);

  const [ctx] = await pool.query('SELECT current_database() AS db');
  assert.strictEqual(ctx[0].db, testConfig.database);
  console.log(`🎟️ Iniciando suite de Licencias y Asientos Facturables en db="${ctx[0].db}"...`);

  const app = createApp({ pool });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const tag = crypto.randomBytes(4).toString('hex');
  const tenantId = crypto.randomUUID();
  const branch1 = crypto.randomUUID();
  const branch2 = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const ownerEmail = `owner_seat_${tag}@test.local`;
  const passHash = bcrypt.hashSync('SeatPass!2026', 10);

  try {
    // Seed empresa con 1 sucursal licenciada, 0 asientos extra, pero max_users=5 legacy para demostrar que se ignora el valor obsoleto
    await pool.query(
      "INSERT INTO tenants (id, business_name, email, slug, status, licensed_branches, max_branches, extra_user_seats, max_users) VALUES (?, ?, ?, ?, 'active', 1, 1, 0, 5)",
      [tenantId, `Seat Test ${tag}`, ownerEmail, `seat-${tag}`]
    );
    await pool.query(
      "INSERT INTO tenant_subscriptions (id, tenant_id, plan_code, status, billing_cycle, currency, current_period_start, current_period_end) VALUES (?, ?, 'PRINCIPAL', 'active', 'monthly', 'DOP', NOW(), NOW() + INTERVAL '30 days')",
      [crypto.randomUUID(), tenantId]
    );
    // 1 sucursal activa + 1 sucursal pendiente/inactiva (NO debe sumar asientos)
    await pool.query(
      'INSERT INTO branches (id, tenant_id, name, is_main, is_active) VALUES (?, ?, ?, TRUE, TRUE), (?, ?, ?, FALSE, FALSE)',
      [branch1, tenantId, 'Sucursal Principal', branch2, tenantId, 'Sucursal Pendiente Pago']
    );
    await pool.query(
      "INSERT INTO users (id, tenant_id, branch_id, salon_id, name, nombre, username, email, password_hash, role, all_branches_access, is_active, estado) VALUES (?, ?, ?, ?, 'Owner Seat', 'Owner Seat', ?, ?, ?, 'propietario', TRUE, TRUE, 'Activo')",
      [ownerId, tenantId, branch1, branch1, ownerEmail, ownerEmail, passHash]
    );

    // Crear rol personalizado llamado "Kiosco Personalizado" (NO debe otorgar exención)
    const [customKioskRoleRows] = await pool.query(
      "INSERT INTO roles (tenant_id, nombre, permisos) VALUES (?, 'Kiosco Personalizado', '{}') RETURNING id",
      [tenantId]
    );
    const customKioskRoleId = customKioskRoleRows[0].id;

    const ownerToken = signAuthToken({
      sub: ownerId,
      id: ownerId,
      email: ownerEmail,
      name: 'Owner Seat',
      role: 'propietario',
      tenantId,
      branchId: branch1,
      tokenVersion: 1,
    });
    const ownerCookie = `auth_token=${ownerToken}`;

    // 1. Verificar que sucursal pendiente NO aporta asientos y legacy max_users=5 se ignora -> cupo real = 3
    const ent0 = await reqJson(baseUrl, 'GET', '/api/tenant/entitlements', { cookie: ownerCookie });
    assert.strictEqual(ent0.status, 200);
    assert.strictEqual(ent0.body.limits.users, 3, `Cupo esperado 3, recibido ${ent0.body.limits.users}`);
    assert.strictEqual(ent0.body.usage.users, 1, 'Owner debe consumir 1 asiento');
    console.log('  ✅ 1. Cupo base = 3 (ignora max_users=5 legacy y sucursal pendiente de pago); Owner consume 1/3.');

    // 2. Owner + 2 operadores (3/3); cuarto usuario rechazado (403 PLAN_LIMIT_REACHED)
    const op1 = await reqJson(baseUrl, 'POST', '/api/users', {
      cookie: ownerCookie,
      body: { nombre: 'Operador 1', email: `op1_${tag}@test.local`, password: 'Password!2026', role: 'empleado', branch_id: branch1 },
    });
    assert.strictEqual(op1.status, 200);

    const op2 = await reqJson(baseUrl, 'POST', '/api/users', {
      cookie: ownerCookie,
      body: { nombre: 'Operador 2', email: `op2_${tag}@test.local`, password: 'Password!2026', role: 'empleado', branch_id: branch1 },
    });
    assert.strictEqual(op2.status, 200);

    const op4Blocked = await reqJson(baseUrl, 'POST', '/api/users', {
      cookie: ownerCookie,
      body: { nombre: 'Operador 4 Exceso', email: `op4_${tag}@test.local`, password: 'Password!2026', role: 'empleado', branch_id: branch1 },
    });
    assert.strictEqual(op4Blocked.status, 403);
    assert.strictEqual(op4Blocked.body.code, 'PLAN_LIMIT_REACHED');
    console.log('  ✅ 2. Owner + 2 operadores = 3/3; cuarto usuario operativo rechazado (403 PLAN_LIMIT_REACHED).');

    // 3. Rol personalizado llamado "Kiosco Personalizado" NO obtiene exención
    const fakeKioskBlocked = await reqJson(baseUrl, 'POST', '/api/users', {
      cookie: ownerCookie,
      body: { nombre: 'Falso Kiosco', email: `fk_${tag}@test.local`, password: 'Password!2026', role_id: customKioskRoleId, branch_id: branch1 },
    });
    assert.strictEqual(fakeKioskBlocked.status, 403);
    assert.strictEqual(fakeKioskBlocked.body.code, 'PLAN_LIMIT_REACHED');
    console.log('  ✅ 3. Rol personalizado llamado "Kiosco Personalizado" NO obtiene exención (403 PLAN_LIMIT_REACHED).');

    // 4. Con cupo lleno (3/3): crear Kiosco reservado SÍ está permitido y no altera consumo facturable
    const realKiosk = await reqJson(baseUrl, 'POST', '/api/users', {
      cookie: ownerCookie,
      body: { nombre: 'Kiosco Real', email: `kr_${tag}@test.local`, password: 'Password!2026', role: 'kiosco_asistencia', branch_id: branch1 },
    });
    assert.strictEqual(realKiosk.status, 200);
    const kioskId = realKiosk.body.id;

    const entAfterKiosk = await reqJson(baseUrl, 'GET', '/api/tenant/entitlements', { cookie: ownerCookie });
    assert.strictEqual(entAfterKiosk.body.usage.users, 3);
    assert.strictEqual(entAfterKiosk.body.usage.exemptKioskUsers, 1);
    console.log('  ✅ 4. Kiosco reservado permitido con cupo lleno (3/3) y reportado separado como exento (1).');

    // 5. Editar usuario existente sin incrementar consumo permitido; desactivar libera asiento; reactivar y cambiar kiosco a facturable respetan límite
    const editExisting = await reqJson(baseUrl, 'PUT', `/api/users/${op1.body.id}`, {
      cookie: ownerCookie,
      body: { nombre: 'Operador 1 Editado' },
    });
    assert.strictEqual(editExisting.status, 200, 'Editar usuario existente con cupo lleno debe seguir permitido');

    const kioskToBillableFail = await reqJson(baseUrl, 'PUT', `/api/users/${kioskId}`, {
      cookie: ownerCookie,
      body: { role: 'empleado', role_id: customKioskRoleId },
    });
    assert.strictEqual(kioskToBillableFail.status, 403);
    assert.strictEqual(kioskToBillableFail.body.code, 'PLAN_LIMIT_REACHED');

    // Desactivar op2 libera 1 asiento (pasa a 2/3)
    const deactOp2 = await reqJson(baseUrl, 'PUT', `/api/users/${op2.body.id}`, {
      cookie: ownerCookie,
      body: { estado: 'Inactivo' },
    });
    assert.strictEqual(deactOp2.status, 200);
    const entAfterDeact = await reqJson(baseUrl, 'GET', '/api/tenant/entitlements', { cookie: ownerCookie });
    assert.strictEqual(entAfterDeact.body.usage.users, 2, 'Desactivar usuario debe liberar su asiento (2/3)');

    // 6. Dos creaciones CONCURRENTES para 1 único asiento libre -> solo 1 prospera (200) y 1 falla (403 PLAN_LIMIT_REACHED)
    const [race1, race2] = await Promise.all([
      reqJson(baseUrl, 'POST', '/api/users', {
        cookie: ownerCookie,
        body: { nombre: 'Race A', email: `raceA_${tag}@test.local`, password: 'Password!2026', role: 'empleado', branch_id: branch1 },
      }),
      reqJson(baseUrl, 'POST', '/api/users', {
        cookie: ownerCookie,
        body: { nombre: 'Race B', email: `raceB_${tag}@test.local`, password: 'Password!2026', role: 'empleado', branch_id: branch1 },
      }),
    ]);
    const raceStatuses = [race1.status, race2.status].sort((a, b) => a - b);
    assert.deepStrictEqual(raceStatuses, [200, 403], `Concurrencia debe permitir exactamente 1 de 2, recibido ${JSON.stringify(raceStatuses)}`);
    const loser = race1.status === 403 ? race1 : race2;
    assert.strictEqual(loser.body.code, 'PLAN_LIMIT_REACHED');

    // Reactivar op2 ahora con cupo lleno (3/3) debe ser rechazado (403 PLAN_LIMIT_REACHED)
    const reactivateBlocked = await reqJson(baseUrl, 'PUT', `/api/users/${op2.body.id}`, {
      cookie: ownerCookie,
      body: { estado: 'Activo' },
    });
    assert.strictEqual(reactivateBlocked.status, 403);
    assert.strictEqual(reactivateBlocked.body.code, 'PLAN_LIMIT_REACHED');
    console.log('  ✅ 5 & 6. Desactivación libera asiento, concurrencia 2x1 solo permite 1 (200/403), reactivación bloqueada con cupo lleno.');

    // 7. Dos sucursales contratadas aportan 6 asientos compartidos + usuario multi-sucursal consume 1 sola licencia
    await pool.query('UPDATE branches SET is_active = TRUE WHERE id = ? AND tenant_id = ?', [branch2, tenantId]);
    await pool.query('UPDATE tenants SET licensed_branches = 2, max_branches = 2 WHERE id = ?', [tenantId]);

    const entTwoBranches = await reqJson(baseUrl, 'GET', '/api/tenant/entitlements', { cookie: ownerCookie });
    assert.strictEqual(entTwoBranches.body.limits.users, 6, '2 sucursales contratadas deben aportar 6 asientos compartidos');
    assert.strictEqual(entTwoBranches.body.usage.users, 3);

    // Asignar multi-sucursal a op1 NO debe duplicar su consumo
    const multiBranchEdit = await reqJson(baseUrl, 'PUT', `/api/users/${op1.body.id}`, {
      cookie: ownerCookie,
      body: { authorized_branch_ids: [branch1, branch2], all_branches_access: true },
    });
    assert.strictEqual(multiBranchEdit.status, 200);
    const entAfterMulti = await reqJson(baseUrl, 'GET', '/api/tenant/entitlements', { cookie: ownerCookie });
    assert.strictEqual(entAfterMulti.body.usage.users, 3, 'Usuario multi-sucursal debe consumir 1 sola licencia');

    // Sumar 2 asientos adicionales contratados -> 6 + 2 = 8
    await pool.query('UPDATE tenants SET extra_user_seats = 2 WHERE id = ?', [tenantId]);
    const entWithExtra = await reqJson(baseUrl, 'GET', '/api/tenant/entitlements', { cookie: ownerCookie });
    assert.strictEqual(entWithExtra.body.limits.users, 8, '2 sucursales (6) + 2 asientos extra = 8');

    // 8. Colaborador exclusivo de ponches/autoservicio (staff_records sin cuenta operativa en users) NO consume asiento
    await pool.query(
      "INSERT INTO staff_records (tenant_id, nombre, email, salon_id, status) VALUES (?, 'Colaborador Solo Ponches', ?, ?, 'Activo')",
      [tenantId, `staff_only_${tag}@test.local`, branch1]
    );
    const entAfterStaffOnly = await reqJson(baseUrl, 'GET', '/api/tenant/entitlements', { cookie: ownerCookie });
    assert.strictEqual(entAfterStaffOnly.body.usage.users, 3, 'Colaborador exclusivo en staff_records NO debe consumir asiento');

    // 9. Estado distinto de Activo/Inactivo (ej. 'Pendiente' con is_active=true) que aún puede acceder SÍ se cuenta como facturable
    const customStateUser = await reqJson(baseUrl, 'POST', '/api/users', {
      cookie: ownerCookie,
      body: { nombre: 'Estado Pendiente', email: `pend_${tag}@test.local`, password: 'Password!2026', role: 'empleado', branch_id: branch1, estado: 'Pendiente' },
    });
    assert.strictEqual(customStateUser.status, 200);
    const entAfterPendingState = await reqJson(baseUrl, 'GET', '/api/tenant/entitlements', { cookie: ownerCookie });
    assert.strictEqual(entAfterPendingState.body.usage.users, 4, 'Cuenta con estado distinto de Inactivo (Pendiente) que puede operar debe contarse como facturable');

    // 10. Coincidencia exacta entre asientos adicionales facturados (ConsolidatedRenewalService) y capacidad disponible (EntitlementsService)
    const { ConsolidatedRenewalService } = require('../services/consolidated_renewal.service');
    const renewalSvc = new ConsolidatedRenewalService({
      pool,
      fxRateService: { requireCurrentRate: async () => ({ rateFormatted: '60.00', rate: '60.00' }) },
      taxPolicy: { calculateTax: () => ({ taxAmountMinor: 0n }) },
    });
    const quote = await renewalSvc.calculateConsolidatedQuote({ tenantId });
    assert.strictEqual(quote.billableBranches, 2, 'Renovación debe facturar exactamente las 2 sucursales licenciadas');
    assert.strictEqual(quote.extraUsers, 2, 'Renovación debe facturar exactamente los 2 asientos adicionales contratados');
    assert.strictEqual(
      (quote.billableBranches * 3) + quote.extraUsers,
      entAfterPendingState.body.limits.users,
      'Capacidad disponible (limits.users) debe coincidir 1:1 con (sucursales facturadas × 3) + asientos extra facturados'
    );
    console.log('  ✅ 7-10. 2 sucursales = 6 (+2 extra = 8), multi-sucursal=1, staff_records solo ponches=0, estado "Pendiente" contado, y facturación consolidada coincide 1:1 con capacidad.');

    console.log('\n🎉 SUITE DE LICENCIAS Y ASIENTOS FACTURABLES COMPLETADA (10/10 PASS).');
  } finally {
    server.close();
    await pool.query('DELETE FROM security_audit_logs WHERE tenant_id = ?', [tenantId]).catch(() => { });
    await pool.query('DELETE FROM user_sessions WHERE tenant_id = ?', [tenantId]).catch(() => { });
    await pool.query('DELETE FROM staff_records WHERE tenant_id = ?', [tenantId]).catch(() => { });
    await pool.query('DELETE FROM users WHERE tenant_id = ?', [tenantId]).catch(() => { });
    await pool.query('DELETE FROM roles WHERE tenant_id = ?', [tenantId]).catch(() => { });
    await pool.query('DELETE FROM tenant_subscriptions WHERE tenant_id = ?', [tenantId]).catch(() => { });
    await pool.query('DELETE FROM branches WHERE tenant_id = ?', [tenantId]).catch(() => { });
    await pool.query('DELETE FROM tenants WHERE id = ?', [tenantId]).catch(() => { });
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ FALLO SUITE DE LICENCIAS Y ASIENTOS:', err);
  process.exit(1);
});
