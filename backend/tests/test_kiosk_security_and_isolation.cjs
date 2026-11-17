'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { pool } = require('../db');
const { up: upRbacHardening } = require('../migrations/20261115_rbac_hardening.cjs');
const { up: upKiosk } = require('../migrations/20261117_kiosk_devices_hardening.cjs');
const {
  KIOSK_DEVICE_COOKIE,
  bindKioskDevice,
  resolveKioskDevice,
  revokeKioskDevice,
  isEmployeeAuthorizedForBranch,
  createKioskEmployeeSession,
  consumePunchSession,
  checkPinRateLimit,
  recordPinFailure,
  clearPinFailures,
} = require('../services/kiosk_device.service');

async function run() {
  console.log('🔐 Iniciando pruebas de Seguridad y Aislamiento Multi-Tenant del Kiosco...');

  // 1. Idempotencia de migración
  await upRbacHardening(pool, 'public');
  await upKiosk(pool, 'public');
  await upKiosk(pool, 'public');
  console.log('  ✅ 1. Migración 20261117_kiosk_devices_hardening idempotente.');

  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const branchA1 = crypto.randomUUID();
  const branchA2 = crypto.randomUUID();
  const branchB1 = crypto.randomUUID();
  let empA1Id;
  let empAMultiId;
  let empB1Id;
  const userAMultiId = crypto.randomUUID();

  try {
    await pool.query("INSERT INTO tenants (id, business_name, email, slug, status) VALUES (?, 'Empresa A', ?, ?, 'active')", [tenantA, `a-${tenantA.slice(0, 8)}@test.local`, `emp-a-${tenantA.slice(0, 8)}`]);
    await pool.query("INSERT INTO tenants (id, business_name, email, slug, status) VALUES (?, 'Empresa B', ?, ?, 'active')", [tenantB, `b-${tenantB.slice(0, 8)}@test.local`, `emp-b-${tenantB.slice(0, 8)}`]);
    await pool.query('INSERT INTO branches (id, tenant_id, name, is_main) VALUES (?, ?, ?, true)', [branchA1, tenantA, 'Sucursal A1']);
    await pool.query('INSERT INTO branches (id, tenant_id, name, is_main) VALUES (?, ?, ?, false)', [branchA2, tenantA, 'Sucursal A2']);
    await pool.query('INSERT INTO branches (id, tenant_id, name, is_main) VALUES (?, ?, ?, true)', [branchB1, tenantB, 'Sucursal B1']);

    const [sA1] = await pool.query(
      "INSERT INTO staff_records (tenant_id, nombre, salon_id, status) VALUES (?, 'Emp A1', ?, 'Activo') RETURNING id",
      [tenantA, branchA1]
    );
    empA1Id = String(sA1[0].id);

    await pool.query(
      "INSERT INTO users (id, tenant_id, name, email, password, password_hash, role, all_branches_access, is_active) VALUES (?, ?, 'Emp Multi', 'multi@a.test', 'hash', 'hash', 'recepcionista', true, true)",
      [userAMultiId, tenantA]
    );
    const [sAM] = await pool.query(
      "INSERT INTO staff_records (tenant_id, nombre, email, salon_id, status) VALUES (?, 'Emp Multi', 'multi@a.test', ?, 'Activo') RETURNING id",
      [tenantA, branchA1]
    );
    empAMultiId = String(sAM[0].id);

    const [sB1] = await pool.query(
      "INSERT INTO staff_records (tenant_id, nombre, salon_id, status) VALUES (?, 'Emp B1', ?, 'Activo') RETURNING id",
      [tenantB, branchB1]
    );
    empB1Id = String(sB1[0].id);

    // 2. Vinculación, resolución y revocación de dispositivo
    const bound = await bindKioskDevice(pool, {
      tenantId: tenantA,
      branchId: branchA1,
      deviceName: 'Tablet Test A1',
      actorUserId: userAMultiId,
      actorName: 'Owner A',
    });
    assert(bound.rawToken && bound.device.id, 'Debe emitir token opaco y device ID');

    const resolved = await resolveKioskDevice(pool, { cookies: { [KIOSK_DEVICE_COOKIE]: bound.rawToken }, headers: {} });
    assert(resolved && resolved.device.tenant_id === tenantA && resolved.device.branch_id === branchA1, 'Debe resolver tenant y sucursal desde credencial');

    // 3. Aislamiento por empresa y sucursal (y soporte multi-sucursal)
    const authA1InA1 = await isEmployeeAuthorizedForBranch(pool, tenantA, empA1Id, branchA1);
    assert.strictEqual(authA1InA1.authorized, true, 'Emp A1 autorizado en A1');

    const authA1InA2 = await isEmployeeAuthorizedForBranch(pool, tenantA, empA1Id, branchA2);
    assert.strictEqual(authA1InA2.authorized, false, 'Emp A1 NO autorizado en A2');

    const authMultiInA2 = await isEmployeeAuthorizedForBranch(pool, tenantA, empAMultiId, branchA2);
    assert.strictEqual(authMultiInA2.authorized, true, 'Emp Multi autorizado en A2');

    const authBInA = await isEmployeeAuthorizedForBranch(pool, tenantA, empB1Id, branchA1);
    assert.strictEqual(authBInA.authorized, false, 'Emp de Empresa B rechazado en Empresa A');
    console.log('  ✅ 2. Vinculación opaca, aislamiento multi-tenant/sucursal y soporte multi-sucursal verificados.');

    // 4. Verificación de empleado A seguida de intento de ponche de empleado B + concurrencia
    const punchSess = await createKioskEmployeeSession(pool, {
      deviceId: bound.device.id,
      tenantId: tenantA,
      branchId: branchA1,
      employeeId: empA1Id,
      purpose: 'punch',
    });

    const crossEmpPunch = await consumePunchSession(pool, {
      rawToken: punchSess.rawToken,
      deviceId: bound.device.id,
      tenantId: tenantA,
      employeeId: empAMultiId,
    });
    assert.strictEqual(crossEmpPunch.valid, false, 'No puede verificar empleado A y ponchar empleado B');

    const [c1, c2] = await Promise.all([
      consumePunchSession(pool, { rawToken: punchSess.rawToken, deviceId: bound.device.id, tenantId: tenantA, employeeId: empA1Id }),
      consumePunchSession(pool, { rawToken: punchSess.rawToken, deviceId: bound.device.id, tenantId: tenantA, employeeId: empA1Id }),
    ]);
    assert.strictEqual([c1.valid, c2.valid].filter(Boolean).length, 1, 'Consumo concurrente de sesión de ponche debe ser exactamente 1');
    console.log('  ✅ 3. Bloqueo de intercambio A->B e idempotencia concurrente verificados.');

    // 5. Rate limiting por dispositivo + empleado sin bloquear a otros
    clearPinFailures(bound.device.id, empA1Id);
    for (let i = 0; i < 5; i += 1) recordPinFailure(bound.device.id, empA1Id);
    assert.strictEqual(checkPinRateLimit(bound.device.id, empA1Id).allowed, false, 'Debe bloquear tras 5 intentos fallidos');
    assert.strictEqual(checkPinRateLimit(bound.device.id, empAMultiId).allowed, true, 'No debe bloquear a otros empleados');
    clearPinFailures(bound.device.id, empA1Id);
    console.log('  ✅ 4. Rate limiting aislado por dispositivo y empleado verificado.');

    // 6. Revocación efectiva invalida dispositivo y sesiones abiertas
    await createKioskEmployeeSession(pool, {
      deviceId: bound.device.id,
      tenantId: tenantA,
      branchId: branchA1,
      employeeId: empA1Id,
      purpose: 'self_service',
    });
    const revoked = await revokeKioskDevice(pool, { deviceId: bound.device.id, tenantId: tenantA, reason: 'Test revoke' });
    assert.strictEqual(revoked, true);
    const resolvedAfterRevoke = await resolveKioskDevice(pool, { cookies: { [KIOSK_DEVICE_COOKIE]: bound.rawToken }, headers: {} });
    assert.strictEqual(resolvedAfterRevoke, null, 'Dispositivo revocado no debe resolver');
    const [activeSs] = await pool.query('SELECT COUNT(*) AS cnt FROM kiosk_employee_sessions WHERE device_id = ? AND is_active = TRUE', [bound.device.id]);
    assert.strictEqual(Number(activeSs[0].cnt), 0, 'Revocar kiosco debe invalidar sesiones de empleado abiertas');
    console.log('  ✅ 5. Revocación remota e invalidación inmediata de sesiones verificadas.');

    console.log('\n🎉 TODAS LAS PRUEBAS DE SEGURIDAD DEL KIOSCO PASARON.');
  } finally {
    await pool.query('DELETE FROM tenants WHERE id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.end();
  }
}

run().catch((err) => {
  console.error('❌ ERROR EN PRUEBAS KIOSCO:', err);
  process.exit(1);
});
