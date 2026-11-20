'use strict';

const assert = require('assert');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { validateTestEnvironment, createIsolatedTestPool } = require('../utils/test_env_guard.cjs');
const { up: applyRbacMigration } = require('../migrations/20261115_rbac_hardening.cjs');
const { up: applyKioskMigration } = require('../migrations/20261117_kiosk_devices_hardening.cjs');
const { createApp } = require('../app.js');
const { signAuthToken } = require('../middleware/auth.middleware');
const { EntitlementsRepository } = require('../repositories/entitlements.repository');

async function reqJson(baseUrl, method, pathUrl, { token = null, headers: extraHeaders = {}, body = null } = {}) {
  const headers = { Origin: baseUrl, ...extraHeaders };
  if (token) headers.Cookie = `auth_token=${token}`;
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
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_rbac_closure_matrix_32chars';
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  const testConfig = validateTestEnvironment();
  const pool = createIsolatedTestPool(testConfig);
  const [ctx] = await pool.query('SELECT current_database() AS db');
  assert.strictEqual(ctx[0].db, testConfig.database);
  console.log(`🛡️ Iniciando Matriz Completa de Cierre RBAC y Aislamiento en db="${ctx[0].db}"...`);

  await applyRbacMigration(pool);
  await applyKioskMigration(pool);

  const app = createApp({ pool });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const entRepo = new EntitlementsRepository(pool);

  const tag = crypto.randomBytes(4).toString('hex');
  const t1 = crypto.randomUUID();
  const t2 = crypto.randomUUID();
  const b1 = crypto.randomUUID();
  const b2 = crypto.randomUUID();
  const b3 = crypto.randomUUID();

  const superAdminId = crypto.randomUUID();
  const ownerT1Id = crypto.randomUUID();
  const adminT1Id = crypto.randomUUID();
  const customWithPermId = crypto.randomUUID();
  const customNoPermId = crypto.randomUUID();
  const kioskT1Id = crypto.randomUUID();
  const ownerT2Id = crypto.randomUUID();

  const client1Id = crypto.randomUUID();
  const client2Id = crypto.randomUUID();
  const clientT2Id = crypto.randomUUID();

  const passHash = bcrypt.hashSync('RbacTest2026!', 4);
  let roleWithPermId;
  let roleNoPermId;
  let roleT2Id;

  try {
    // Seed 2 synthetic tenants (T1 has 2 branches B1/B2, NO memberships add-on; T2 has 1 branch B3)
    await pool.query(
      `INSERT INTO tenants (id, business_name, email, slug, status, max_users, max_branches, licensed_branches)
       VALUES (?, ?, ?, ?, 'active', 4, 2, 2), (?, ?, ?, ?, 'active', 3, 1, 1)`,
      [t1, `RBAC T1 ${tag}`, `t1-${tag}@rbac.test`, `rbac-t1-${tag}`, t2, `RBAC T2 ${tag}`, `t2-${tag}@rbac.test`, `rbac-t2-${tag}`]
    );
    await pool.query(
      `INSERT INTO branches (id, tenant_id, name, is_main, is_active)
       VALUES (?, ?, 'Sucursal B1', TRUE, TRUE), (?, ?, 'Sucursal B2', FALSE, TRUE), (?, ?, 'Sucursal T2-B3', TRUE, TRUE)`,
      [b1, t1, b2, t1, b3, t2]
    );
    await pool.query(
      `INSERT INTO tenant_subscriptions (id, tenant_id, plan_code, status, billing_cycle, currency, current_period_start, current_period_end)
       VALUES (?, ?, 'PRINCIPAL', 'active', 'monthly', 'DOP', NOW(), NOW() + INTERVAL '30 days'),
              (?, ?, 'PRINCIPAL', 'active', 'monthly', 'DOP', NOW(), NOW() + INTERVAL '30 days')`,
      [crypto.randomUUID(), t1, crypto.randomUUID(), t2]
    );

    // Custom roles in T1 & T2
    const [r1] = await pool.query(
      `INSERT INTO roles (tenant_id, nombre, description, permisos)
       VALUES (?, ?, 'Analista B1', ?) RETURNING id`,
      [t1, `Analista B1 ${tag}`, JSON.stringify({ 'analytics.view': true, 'clients.view': true, 'attendance.view': true })]
    );
    roleWithPermId = r1[0].id;

    const [r2] = await pool.query(
      `INSERT INTO roles (tenant_id, nombre, description, permisos)
       VALUES (?, ?, 'Sin Permisos', ?) RETURNING id`,
      [t1, `Vacio ${tag}`, JSON.stringify({})]
    );
    roleNoPermId = r2[0].id;

    const [rT2] = await pool.query(
      `INSERT INTO roles (tenant_id, nombre, description, permisos)
       VALUES (?, ?, 'Rol T2', ?) RETURNING id`,
      [t2, `Rol T2 ${tag}`, JSON.stringify({ 'security.manage': true })]
    );
    roleT2Id = rT2[0].id;

    // Seed all 8 actor types
    await pool.query(
      `INSERT INTO users (id, tenant_id, branch_id, name, nombre, email, password_hash, role, role_id, authorized_branch_ids, all_branches_access, is_active, estado, token_version)
       VALUES
         (?, NULL, NULL, 'SuperAdmin', 'SuperAdmin', ?, ?, 'superadmin', NULL, NULL, TRUE, TRUE, 'Activo', 1),
         (?, ?, ?, 'Owner T1', 'Owner T1', ?, ?, 'propietario', NULL, NULL, TRUE, TRUE, 'Activo', 1),
         (?, ?, ?, 'Admin T1', 'Admin T1', ?, ?, 'admin', NULL, NULL, TRUE, TRUE, 'Activo', 1),
         (?, ?, ?, 'Analista B1', 'Analista B1', ?, ?, 'empleado', ?, ?, FALSE, TRUE, 'Activo', 1),
         (?, ?, ?, 'SinPerm B1', 'SinPerm B1', ?, ?, 'empleado', ?, ?, FALSE, TRUE, 'Activo', 1),
         (?, ?, ?, 'Kiosco B1', 'Kiosco B1', ?, ?, 'kiosco_asistencia', NULL, ?, FALSE, TRUE, 'Activo', 1),
         (?, ?, ?, 'Owner T2', 'Owner T2', ?, ?, 'propietario', NULL, NULL, TRUE, TRUE, 'Activo', 1)`,
      [
        superAdminId, `sa_${tag}@rbac.test`, passHash,
        ownerT1Id, t1, b1, `own1_${tag}@rbac.test`, passHash,
        adminT1Id, t1, b1, `adm1_${tag}@rbac.test`, passHash,
        customWithPermId, t1, b1, `cperm_${tag}@rbac.test`, passHash, roleWithPermId, JSON.stringify([b1]),
        customNoPermId, t1, b1, `cnoperm_${tag}@rbac.test`, passHash, roleNoPermId, JSON.stringify([b1]),
        kioskT1Id, t1, b1, `ksk1_${tag}@rbac.test`, passHash, JSON.stringify([b1]),
        ownerT2Id, t2, b3, `own2_${tag}@rbac.test`, passHash,
      ]
    );

    // Seed B2C clients in T1 (C1, C2) and T2 (C3)
    await pool.query(
      `INSERT INTO clients (id, tenant_id, nombre, name, email, cedula, telefono, password)
       VALUES (?, ?, 'Clienta Uno', 'Clienta Uno', ?, ?, '8090000001', ?),
              (?, ?, 'Clienta Dos', 'Clienta Dos', ?, ?, '8090000002', ?),
              (?, ?, 'Clienta T2', 'Clienta T2', ?, ?, '8090000003', ?)`,
      [
        client1Id, t1, `c1_${tag}@rbac.test`, `001${tag.slice(0, 7)}1`, passHash,
        client2Id, t1, `c2_${tag}@rbac.test`, `001${tag.slice(0, 7)}2`, passHash,
        clientT2Id, t2, `c3_${tag}@rbac.test`, `001${tag.slice(0, 7)}3`, passHash,
      ]
    );

    // Seed visits in B1 (total 1500) and B2 (total 9000) to verify BI branch scoping
    await pool.query(
      `INSERT INTO visits (id, tenant_id, salon_id, client_id, client_name, total, status, visited_at)
       VALUES (?, ?, ?, ?, 'Clienta Uno', 1500, 'Facturado', NOW()),
              (?, ?, ?, ?, 'Clienta Dos', 9000, 'Facturado', NOW())`,
      [`V-B1-${tag}`, t1, b1, client1Id, `V-B2-${tag}`, t1, b2, client2Id]
    );

    // Seed appointments for C1 and C2 in T1
    await pool.query(
      `INSERT INTO appointments (id, tenant_id, client_id, date, time, services)
       VALUES (?, ?, ?, CURRENT_DATE, '10:00', '[]'), (?, ?, ?, CURRENT_DATE, '11:00', '[]')`,
      [`APT-C1-${tag}`, t1, client1Id, `APT-C2-${tag}`, t1, client2Id]
    );

    const makeTok = (opts) => signAuthToken({ tokenVersion: 1, ...opts });
    const tokens = {
      anonymous: null,
      superadmin: makeTok({ sub: superAdminId, id: superAdminId, email: `sa_${tag}@rbac.test`, role: 'superadmin', tenantId: null, isSuperAdmin: true }),
      owner: makeTok({ sub: ownerT1Id, id: ownerT1Id, email: `own1_${tag}@rbac.test`, role: 'propietario', tenantId: t1, branchId: b1 }),
      admin: makeTok({ sub: adminT1Id, id: adminT1Id, email: `adm1_${tag}@rbac.test`, role: 'admin', tenantId: t1, branchId: b1 }),
      customWithPerm: makeTok({ sub: customWithPermId, id: customWithPermId, email: `cperm_${tag}@rbac.test`, role: 'empleado', tenantId: t1, branchId: b1 }),
      customNoPerm: makeTok({ sub: customNoPermId, id: customNoPermId, email: `cnoperm_${tag}@rbac.test`, role: 'empleado', tenantId: t1, branchId: b1 }),
      kiosk: makeTok({ sub: kioskT1Id, id: kioskT1Id, email: `ksk1_${tag}@rbac.test`, role: 'kiosco_asistencia', tenantId: t1, branchId: b1 }),
      clientB2C: makeTok({ sub: client1Id, id: client1Id, email: `c1_${tag}@rbac.test`, role: 'client', tenantId: t1, isClient: true }),
    };

    // 1. PARAMETERIZED AUTHORIZATION MATRIX (8 actors across sensitive modules)
    const matrix = [
      // [method, path, expectedByActor]
      ['GET', '/api/roles', { anonymous: 401, superadmin: 403, owner: 200, admin: 200, customWithPerm: 403, customNoPerm: 403, kiosk: 403, clientB2C: 403 }],
      ['POST', '/api/roles', { anonymous: 401, superadmin: 403, owner: 400, admin: 403, customWithPerm: 403, customNoPerm: 403, kiosk: 403, clientB2C: 403 }],
      ['GET', '/api/attendance/history', { anonymous: 401, superadmin: 403, owner: 200, admin: 200, customWithPerm: 200, customNoPerm: 403, kiosk: 403, clientB2C: 403 }],
      ['POST', '/api/holidays', { anonymous: 401, superadmin: 403, owner: 400, admin: 400, customWithPerm: 403, customNoPerm: 403, kiosk: 403, clientB2C: 403 }],
      ['GET', '/api/clients', { anonymous: 401, superadmin: 403, owner: 200, admin: 200, customWithPerm: 200, customNoPerm: 403, kiosk: 403, clientB2C: 403 }],
      ['GET', '/api/dashboard/summary', { anonymous: 401, superadmin: 403, owner: 200, admin: 200, customWithPerm: 200, customNoPerm: 403, kiosk: 403, clientB2C: 403 }],
      ['GET', '/api/payroll/settings/calculation-config', { anonymous: 401, superadmin: 403, owner: 200, admin: 200, customWithPerm: 403, customNoPerm: 403, kiosk: 403, clientB2C: 403 }],
      ['GET', '/api/salons/licensing-status', { anonymous: 401, superadmin: 403, owner: 200, admin: 200, customWithPerm: 403, customNoPerm: 403, kiosk: 403, clientB2C: 403 }],
      ['POST', '/api/salons/quote-add-branch', { anonymous: 401, superadmin: 403, owner: [200, 400, 402, 409, 503], admin: 403, customWithPerm: 403, customNoPerm: 403, kiosk: 403, clientB2C: 403 }],
      ['POST', '/api/salons/contract-branch', { anonymous: 401, superadmin: 403, owner: 400, admin: 403, customWithPerm: 403, customNoPerm: 403, kiosk: 403, clientB2C: 403 }],
      ['GET', '/api/saas/billing/subscription', { anonymous: 401, superadmin: 403, owner: 200, admin: 403, customWithPerm: 403, customNoPerm: 403, kiosk: 403, clientB2C: 403 }],
      ['POST', '/api/saas/billing/subscription/cancel', { anonymous: 401, superadmin: 403, admin: 403, customWithPerm: 403, customNoPerm: 403, kiosk: 403, clientB2C: 403 }],
      ['GET', '/api/plans', { anonymous: 401, superadmin: 403, owner: 403, admin: 403, customWithPerm: 403, customNoPerm: 403, kiosk: 403, clientB2C: 403 }], // memberships add-on NOT contracted
      ['GET', '/api/surveys/stats', { anonymous: 401, superadmin: 403, owner: 200, admin: 200, customWithPerm: 200, customNoPerm: 403, kiosk: 403, clientB2C: 403 }],
      ['GET', '/api/admin/gifts', { anonymous: 401, superadmin: 403, owner: 200, admin: 200, customWithPerm: 403, customNoPerm: 403, kiosk: 403, clientB2C: 403 }],
    ];

    let checks = 0;
    for (const [method, endpoint, expectations] of matrix) {
      for (const [actor, expected] of Object.entries(expectations)) {
        const res = await reqJson(baseUrl, method, endpoint, { token: tokens[actor], body: method === 'POST' ? {} : null });
        const allowed = Array.isArray(expected) ? expected : [expected];
        assert(
          allowed.includes(res.status),
          `[MATRIX FAIL] ${actor} ${method} ${endpoint}: esperado ${JSON.stringify(allowed)}, recibido ${res.status} (${JSON.stringify(res.body)})`
        );
        checks += 1;
      }
    }
    console.log(`  ✅ 1. Matriz parametrizada aprobada (${checks} combinaciones actor × endpoint).`);

    // 2. BRANCH ISOLATION IN BI REPORTS & SALONS LIST
    const biOtherBranch = await reqJson(baseUrl, 'GET', `/api/reports/bi?salonId=${b2}`, { token: tokens.customWithPerm });
    assert.strictEqual(biOtherBranch.status, 403, 'Analista B1 no debe consultar BI de B2');
    assert.strictEqual(biOtherBranch.body.code, 'FORBIDDEN_BRANCH_SCOPE');

    const biAllScoped = await reqJson(baseUrl, 'GET', '/api/reports/bi?salonId=all', { token: tokens.customWithPerm });
    assert.strictEqual(biAllScoped.status, 200);
    const totalShown = (biAllScoped.body?.table?.rows || []).reduce((s, r) => s + Number(r.facturacion || 0), 0);
    assert.strictEqual(totalShown, 1500, `BI con salonId=all para Analista B1 debe sumar solo B1 (1500), recibido ${totalShown}`);

    const salonsScoped = await reqJson(baseUrl, 'GET', '/api/salons', { token: tokens.customWithPerm });
    assert.strictEqual(salonsScoped.status, 200);
    assert.strictEqual(salonsScoped.body.length, 1);
    assert.strictEqual(String(salonsScoped.body[0].id), b1);
    console.log('  ✅ 2. Aislamiento por sucursal en BI (/api/reports/bi) y /api/salons verificado con totales reales.');

    // 3. B2C CLIENT STRICT SELF-ISOLATION (clients + appointments + DB state check)
    const cOwn = await reqJson(baseUrl, 'GET', `/api/clients/${client1Id}`, { token: tokens.clientB2C });
    assert.strictEqual(cOwn.status, 200);
    const cOther = await reqJson(baseUrl, 'GET', `/api/clients/${client2Id}`, { token: tokens.clientB2C });
    assert.strictEqual(cOther.status, 403);
    const cCrossTenant = await reqJson(baseUrl, 'GET', `/api/clients/${clientT2Id}`, { token: tokens.clientB2C });
    assert.strictEqual(cCrossTenant.status, 403);

    const aptList = await reqJson(baseUrl, 'GET', '/api/appointments', { token: tokens.clientB2C });
    assert.strictEqual(aptList.status, 200);
    assert(aptList.body.every((a) => String(a.client_id) === client1Id), 'Cliente B2C solo debe ver sus propias citas');

    const aptSpoof = await reqJson(baseUrl, 'POST', '/api/appointments', {
      token: tokens.clientB2C,
      body: { clientId: client2Id, date: '2026-12-01', time: '14:00', services: [] },
    });
    assert.strictEqual(aptSpoof.status, 200);
    const [aptRow] = await pool.query('SELECT client_id FROM appointments WHERE id = ?', [aptSpoof.body.id]);
    assert.strictEqual(String(aptRow[0].client_id), client1Id, 'POST /api/appointments debe ignorar clientId manipulado por B2C');
    console.log('  ✅ 3. Aislamiento B2C estricto verificado en clientes y citas (incluyendo estado en BD).');

    // 4. CROSS-TENANT MANIPULATION, RESERVED ROLE NAMES & SELF-ESCALATION (with DB verification)
    const crossTenantHeader = await reqJson(baseUrl, 'GET', '/api/clients', { token: tokens.owner, headers: { 'x-tenant-id': t2 } });
    assert.strictEqual(crossTenantHeader.status, 403);

    const crossRoleAssign = await reqJson(baseUrl, 'PUT', `/api/users/${customNoPermId}`, {
      token: tokens.owner,
      body: { role_id: roleT2Id },
    });
    assert.strictEqual(crossRoleAssign.status, 403);
    const [uCheck1] = await pool.query('SELECT role_id FROM users WHERE id = ?', [customNoPermId]);
    assert.strictEqual(Number(uCheck1[0].role_id), Number(roleNoPermId), 'role_id no debe cambiar tras intento cross-tenant');

    const reservedRole = await reqJson(baseUrl, 'POST', '/api/roles', {
      token: tokens.owner,
      body: { nombre: 'superadmin', permisos: { 'security.manage': true } },
    });
    assert(reservedRole.status === 400 || reservedRole.status === 403);
    const [rCount] = await pool.query("SELECT COUNT(*)::int AS cnt FROM roles WHERE tenant_id = ? AND LOWER(nombre) = 'superadmin'", [t1]);
    assert.strictEqual(rCount[0].cnt, 0, 'No debe persistir rol con nombre reservado');

    const selfEsc = await reqJson(baseUrl, 'PUT', `/api/users/${adminT1Id}`, {
      token: tokens.admin,
      body: { role: 'propietario' },
    });
    assert.strictEqual(selfEsc.status, 403);
    const [admCheck] = await pool.query('SELECT role FROM users WHERE id = ?', [adminT1Id]);
    assert.strictEqual(admCheck[0].role, 'admin', 'Admin no debe auto-escalarse en BD');
    console.log('  ✅ 4. Manipulación cross-tenant, nombres reservados y auto-escalada bloqueados con BD intacta.');

    // 5. ROLE LIFECYCLE, DELETE IN-USE & IMMEDIATE REVOCATION OF OPEN SESSION
    const delInUse = await reqJson(baseUrl, 'DELETE', `/api/roles/${roleWithPermId}`, { token: tokens.owner });
    assert.strictEqual(delInUse.status, 409, 'Eliminar rol con usuarios asignados debe devolver 409');
    const [rStill] = await pool.query('SELECT id FROM roles WHERE id = ?', [roleWithPermId]);
    assert.strictEqual(rStill.length, 1);

    const revokeRole = await reqJson(baseUrl, 'PUT', `/api/roles/${roleWithPermId}`, {
      token: tokens.owner,
      body: { nombre: `Analista B1 ${tag}`, permisos: { 'clients.view': true } },
    });
    assert.strictEqual(revokeRole.status, 200);
    const afterRevoke = await reqJson(baseUrl, 'GET', '/api/attendance/history', { token: tokens.customWithPerm });
    assert.strictEqual(afterRevoke.status, 401, 'Sesión anterior a revocación de rol debe invalidarse inmediatamente (401)');
    console.log('  ✅ 5. Ciclo de vida de rol (409 ROLE_IN_USE) y revocación inmediata de sesión abierta verificados.');

    // 6. CONCURRENT LAST-OWNER PROTECTION (DB state verified)
    const [c1, c2] = await Promise.all([
      reqJson(baseUrl, 'PUT', `/api/users/${ownerT1Id}`, { token: tokens.owner, body: { role: 'empleado' } }),
      reqJson(baseUrl, 'PUT', `/api/users/${ownerT1Id}`, { token: tokens.owner, body: { estado: 'Inactivo', is_active: false } }),
    ]);
    assert(c1.status >= 400 && c2.status >= 400, `Último Owner no puede degradarse/desactivarse: ${c1.status}, ${c2.status}`);
    const [ownCheck] = await pool.query('SELECT role, is_active, estado FROM users WHERE id = ?', [ownerT1Id]);
    assert.strictEqual(ownCheck[0].role, 'propietario');
    assert.strictEqual(ownCheck[0].is_active, true);
    console.log('  ✅ 6. Protección transaccional concurrente del último Owner verificada en BD.');

    // 7. KIOSK LICENSE EXEMPTION COUNT
    const billableUsers = await entRepo.countResourceUsage(t1, 'users');
    // Active users in T1: owner, admin, customWithPerm, customNoPerm (4 billable) + kioskT1 (exempt) = 4
    assert.strictEqual(Number(billableUsers), 4, `Conteo facturable debe excluir kiosco_asistencia (esperado 4, recibido ${billableUsers})`);
    console.log('  ✅ 7. Conteo de licencias excluye rol reservado kiosco_asistencia (4/4 facturables + 1 kiosco exento).');

    console.log('\n🎉 CIERRE RBAC Y AISLAMIENTO: TODAS LAS PRUEBAS PASARON EN salon_saas_test.');
  } finally {
    await new Promise((r) => server.close(r));
    await pool.query('DELETE FROM appointments WHERE tenant_id IN (?, ?)', [t1, t2]).catch(() => {});
    await pool.query('DELETE FROM visits WHERE tenant_id IN (?, ?)', [t1, t2]).catch(() => {});
    await pool.query('DELETE FROM clients WHERE tenant_id IN (?, ?)', [t1, t2]).catch(() => {});
    await pool.query('DELETE FROM kiosk_devices WHERE tenant_id IN (?, ?)', [t1, t2]).catch(() => {});
    await pool.query('DELETE FROM user_sessions WHERE tenant_id IN (?, ?)', [t1, t2]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = ? OR tenant_id IN (?, ?)', [superAdminId, t1, t2]).catch(() => {});
    await pool.query('DELETE FROM roles WHERE tenant_id IN (?, ?)', [t1, t2]).catch(() => {});
    await pool.query('DELETE FROM tenant_subscriptions WHERE tenant_id IN (?, ?)', [t1, t2]).catch(() => {});
    await pool.query('DELETE FROM branches WHERE tenant_id IN (?, ?)', [t1, t2]).catch(() => {});
    await pool.query('DELETE FROM tenants WHERE id IN (?, ?)', [t1, t2]).catch(() => {});
    await pool.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error('❌ RBAC CLOSURE MATRIX FAILED:', err);
  process.exit(1);
});
