'use strict';

/**
 * Suite de Integración: Permisos Granulares de Contabilidad, Roles Predefinidos por Empresa,
 * Aislamiento Multi-Tenant, Seguridad/Licencias y Reglas Operativas (Bloques 1-8)
 * (backend/tests/test_rbac_accounting_and_role_templates.cjs)
 */

const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const bcrypt = require('bcryptjs');

const { validateTestEnvironment, createIsolatedTestPool } = require('./helpers/test_runner_guard.cjs');
const { createApp } = require('../app');
const { signAuthToken, issueSingleActiveUserSession } = require('../middleware/auth.middleware');
const { migrateAll } = require('../migrations/migrate_all.cjs');
const { installPredefinedRolesForTenant } = require('../services/role_templates.service');
const { PREDEFINED_ROLE_TEMPLATES, PERMISSION_MODULES } = require('../domain/rbac_catalog');

function requestJson(baseUrl, method, pathUrl, { token = null, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathUrl, baseUrl);
    const payload = body !== null && body !== undefined ? JSON.stringify(body) : null;
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers,
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { json = null; }
        resolve({ status: res.statusCode, body: json, text: raw });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log('========================================================================');
  console.log('🧪 SUITE RBAC CONTABILIDAD + ROLES PREDEFINIDOS + ADD-ON MEMBRESÍAS');
  console.log('========================================================================\n');

  const testConfig = validateTestEnvironment({ allowDisposableSchema: false });
  const pool = createIsolatedTestPool(testConfig);

  await migrateAll({ pool, targetSchema: 'public', quiet: true });

  const app = createApp(pool);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const ts = Date.now();
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const branchA1 = crypto.randomUUID();
  const branchA2 = crypto.randomUUID();
  const branchB1 = crypto.randomUUID();
  const ownerAId = crypto.randomUUID();
  const ownerBId = crypto.randomUUID();

  const createdUserIds = [ownerAId, ownerBId];

  const makeTokenForUser = async ({ userId, tenantId, branchId, role, email, name }) => {
    const { sessionId } = await issueSingleActiveUserSession(pool, {
      userId: String(userId),
      tenantId,
      userName: name,
      role,
      salonId: String(branchId),
      ipAddress: '127.0.0.1',
      userAgent: 'TestSuite/1.0',
      isKioskAccount: false,
    });
    return signAuthToken({
      sub: String(userId),
      id: String(userId),
      email,
      name,
      role,
      tenantId,
      branchId,
      sessionId,
      isSuperAdmin: false,
      tokenVersion: 1,
    });
  };

  try {
    // 0. Verificar catálogo canónico: Contabilidad existe y Marketing está en Plan Principal (NO add-on)
    console.log('[1/10] Verificando catálogo canónico (Contabilidad y etiqueta de Marketing)...');
    const accMod = PERMISSION_MODULES.find((m) => m.module === 'accounting');
    assert.ok(accMod && accMod.permissions.length >= 9, 'Debe existir sección Contabilidad con permisos granulares');
    const catMod = PERMISSION_MODULES.find((m) => m.module === 'catalog_inventory');
    const mktView = catMod.permissions.find((p) => p.key === 'marketing.view');
    const mktManage = catMod.permissions.find((p) => p.key === 'marketing.manage');
    assert.strictEqual(mktView.requiresAddon, undefined, 'Marketing NO debe tener requiresAddon');
    assert.strictEqual(mktManage.requiresAddon, undefined, 'Marketing NO debe tener requiresAddon');
    assert.strictEqual(mktView.includedInPlan, 'Plan Principal');
    assert.strictEqual(PREDEFINED_ROLE_TEMPLATES.length, 6, 'Deben existir exactamente 6 plantillas predefinidas');

    // Verificar mínimo privilegio en plantillas
    const opAdminTpl = PREDEFINED_ROLE_TEMPLATES.find((t) => t.template_key === 'operational_admin');
    assert.strictEqual(opAdminTpl.permissions['security.manage'], undefined, 'Administrador operativo NO debe tener security.manage');
    assert.strictEqual(opAdminTpl.permissions['payroll.approve'], undefined, 'Administrador operativo NO debe tener payroll.approve');
    const hrTpl = PREDEFINED_ROLE_TEMPLATES.find((t) => t.template_key === 'human_resources');
    assert.strictEqual(hrTpl.permissions['payroll.generate'], true);
    assert.strictEqual(hrTpl.permissions['payroll.approve'], undefined, 'RRHH debe separar generar de aprobar nómina');
    assert.strictEqual(hrTpl.permissions['payroll.pay'], undefined, 'RRHH debe separar generar de pagar nómina');
    const reportsTpl = PREDEFINED_ROLE_TEMPLATES.find((t) => t.template_key === 'reports_viewer');
    assert.strictEqual(reportsTpl.permissions['accounting.view'], true);
    assert.strictEqual(reportsTpl.permissions['accounting.export'], undefined, 'Consulta de reportes NO debe tener export');
    assert.strictEqual(reportsTpl.permissions['accounting.expenses.manage'], undefined);
    console.log('  ✅ [PASS] Catálogo y mínimo privilegio validados.');

    // Setup Tenant A (legacy sin roles predefinidos) y Tenant B
    const pwHash = await bcrypt.hash('TestPass#2026', 10);
    for (const [tid, slug, bId, oId, email] of [
      [tenantA, `rbac-a-${ts}`, branchA1, ownerAId, `owner-a-${ts}@test.local`],
      [tenantB, `rbac-b-${ts}`, branchB1, ownerBId, `owner-b-${ts}@test.local`],
    ]) {
      await pool.query(
        `INSERT INTO tenants (id, business_name, slug, email, owner_name, owner_email, plan_id, status, licensed_branches, max_branches, max_users, modules_config)
         VALUES (?, ?, ?, ?, 'Owner Test', ?, 1, 'active', 2, 2, 10, '{"pos":true,"clients":true,"marketing":true,"memberships":false}'::jsonb)`,
        [tid, `Empresa ${slug}`, slug, email, email]
      );
      await pool.query(
        `INSERT INTO branches (id, tenant_id, name, address, phone, is_main, status, is_active)
         VALUES (?, ?, 'Principal', 'Dir', '8090000000', true, 'Active', true)`,
        [bId, tid]
      );
      await pool.query(
        `INSERT INTO salons (id, name, address, phone, status, tenant_id)
         VALUES (?, 'Principal', 'Dir', '8090000000', 'Active', ?)`,
        [bId, tid]
      );
      await pool.query(
        `INSERT INTO users (id, tenant_id, branch_id, name, nombre, email, password_hash, role, is_active, estado, token_version)
         VALUES (?, ?, ?, 'Owner Test', 'Owner Test', ?, ?, 'owner', true, 'Activo', 1)`,
        [oId, tid, bId, email, pwHash]
      );
      await pool.query(
        `INSERT INTO tenant_subscriptions (tenant_id, plan_code, status, current_period_start, current_period_end, auto_renew)
         VALUES (?, 'PRINCIPAL', 'active', NOW(), NOW() + INTERVAL '30 days', FALSE)
         ON CONFLICT (tenant_id) DO NOTHING`,
        [tid]
      );
    }
    await pool.query(
      `INSERT INTO branches (id, tenant_id, name, address, phone, is_main, status, is_active)
       VALUES (?, ?, 'Sucursal 2', 'Dir 2', '8090000001', false, 'Active', true)`,
      [branchA2, tenantA]
    );

    const ownerAToken = await makeTokenForUser({
      userId: ownerAId,
      tenantId: tenantA,
      branchId: branchA1,
      role: 'owner',
      email: `owner-a-${ts}@test.local`,
      name: 'Owner A',
    });
    const ownerBToken = await makeTokenForUser({
      userId: ownerBId,
      tenantId: tenantB,
      branchId: branchB1,
      role: 'owner',
      email: `owner-b-${ts}@test.local`,
      name: 'Owner B',
    });

    // 2. Instalar roles predefinidos en empresa existente + verificar idempotencia (sin duplicados ni consumo de licencias)
    console.log('[2/10] Probando instalación idempotente de roles predefinidos en empresa existente...');
    const install1 = await requestJson(baseUrl, 'POST', '/api/roles/install-templates', { token: ownerAToken, body: {} });
    assert.strictEqual(install1.status, 200, `Esperado 200, recibido ${install1.status}: ${install1.text}`);
    assert.strictEqual(install1.body.installedCount, 6);

    const install2 = await requestJson(baseUrl, 'POST', '/api/roles/install-templates', { token: ownerAToken, body: {} });
    assert.strictEqual(install2.status, 200);
    assert.strictEqual(install2.body.installedCount, 0, 'Reintentar no debe duplicar roles');
    assert.strictEqual(install2.body.skippedCount, 6);

    // Verificar que crear roles no creó usuarios extra
    const [uCountRows] = await pool.query('SELECT COUNT(*) as total FROM users WHERE tenant_id = ?', [tenantA]);
    assert.strictEqual(Number(uCountRows[0].total), 1, 'Instalar roles predefinidos NO debe crear usuarios ni consumir licencias');
    console.log('  ✅ [PASS] 6 roles instalados idempotentemente sin crear usuarios.');

    // 3. Editar, renombrar y restaurar plantilla + no sobrescribir roles personalizados
    console.log('[3/10] Probando personalización, no sobrescritura y restauración de plantilla con preview...');
    const rolesListRes = await requestJson(baseUrl, 'GET', '/api/roles', { token: ownerAToken });
    assert.strictEqual(rolesListRes.status, 200);
    const accountingRole = rolesListRes.body.find((r) => r.template_key === 'accounting');
    const reportsRole = rolesListRes.body.find((r) => r.template_key === 'reports_viewer');
    const invRole = rolesListRes.body.find((r) => r.template_key === 'inventory_manager');
    assert.ok(accountingRole && reportsRole && invRole);

    // Personalizar rol Contabilidad (quitar accounting.expenses.void y renombrar)
    const customAccPerms = { ...accountingRole.permisos };
    delete customAccPerms['accounting.expenses.void'];
    const updAcc = await requestJson(baseUrl, 'PUT', `/api/roles/${accountingRole.id}`, {
      token: ownerAToken,
      body: { nombre: 'Contabilidad Senior', permisos: customAccPerms },
    });
    assert.strictEqual(updAcc.status, 200);
    assert.strictEqual(updAcc.body.is_customized, true);

    // Re-instalar plantillas NO debe sobrescribir el rol personalizado
    const install3 = await requestJson(baseUrl, 'POST', '/api/roles/install-templates', { token: ownerAToken, body: {} });
    assert.strictEqual(install3.body.installedCount, 0);
    const previewRes = await requestJson(baseUrl, 'GET', `/api/roles/${accountingRole.id}/restore-preview`, { token: ownerAToken });
    assert.strictEqual(previewRes.status, 200);
    assert.strictEqual(previewRes.body.diff.hasChanges, true);
    assert.ok(previewRes.body.diff.added.includes('accounting.expenses.void'));

    // Restaurar plantilla
    const restoreRes = await requestJson(baseUrl, 'POST', `/api/roles/${accountingRole.id}/restore-template`, { token: ownerAToken, body: {} });
    assert.strictEqual(restoreRes.status, 200);
    assert.strictEqual(restoreRes.body.is_customized, false);
    assert.strictEqual(restoreRes.body.permisos['accounting.expenses.void'], true);
    console.log('  ✅ [PASS] Personalización, preview de diff y restauración de plantilla verificados.');

    // 4. Eliminar rol predefinido sin usuarios asignados (y verificar que NO se recrea solo)
    console.log('[4/10] Probando eliminación de rol predefinido y bloqueo 409 si tiene usuarios...');
    const delInv = await requestJson(baseUrl, 'DELETE', `/api/roles/${invRole.id}`, { token: ownerAToken });
    assert.strictEqual(delInv.status, 200);
    const rolesAfterDel = await requestJson(baseUrl, 'GET', '/api/roles', { token: ownerAToken });
    assert.strictEqual(rolesAfterDel.body.some((r) => r.template_key === 'inventory_manager'), false);

    // Nombres reservados (incluyendo Kiosco) bloqueados
    const kioskAttempt = await requestJson(baseUrl, 'POST', '/api/roles', {
      token: ownerAToken,
      body: { nombre: 'Kiosco', permisos: { 'attendance.view': true } },
    });
    assert.strictEqual(kioskAttempt.status, 400);
    assert.strictEqual(kioskAttempt.body.code, 'RESERVED_ROLE_NAME');
    console.log('  ✅ [PASS] Eliminación limpia y bloqueo de nombres reservados ("Kiosco") verificados.');

    // 5. Aislamiento multi-tenant: Tenant B no puede leer, editar, restaurar ni eliminar roles de Tenant A
    console.log('[5/10] Verificando aislamiento multi-tenant de roles...');
    const crossEdit = await requestJson(baseUrl, 'PUT', `/api/roles/${accountingRole.id}`, {
      token: ownerBToken,
      body: { nombre: 'Hack', permisos: {} },
    });
    assert.strictEqual(crossEdit.status, 404);
    const crossRestore = await requestJson(baseUrl, 'POST', `/api/roles/${accountingRole.id}/restore-template`, {
      token: ownerBToken,
      body: {},
    });
    assert.strictEqual(crossRestore.status, 404);
    console.log('  ✅ [PASS] Aislamiento multi-tenant estricto en roles.');

    // 6. Permisos granulares de Contabilidad: Usuario con solo Consulta de reportes (`accounting.view`)
    console.log('[6/10] Verificando separación Consultar vs Crear/Editar/Pagar/Anular/Exportar/Configurar...');
    const viewerId = crypto.randomUUID();
    createdUserIds.push(viewerId);
    await pool.query(
      `INSERT INTO users (id, tenant_id, branch_id, name, nombre, email, password_hash, role, role_id, is_active, estado, token_version)
       VALUES (?, ?, ?, 'Solo Consulta', 'Solo Consulta', ?, ?, 'empleado', ?, true, 'Activo', 1)`,
      [viewerId, tenantA, branchA1, `viewer-${ts}@test.local`, pwHash, reportsRole.id]
    );
    const viewerToken = await makeTokenForUser({
      userId: viewerId,
      tenantId: tenantA,
      branchId: branchA1,
      role: 'empleado',
      email: `viewer-${ts}@test.local`,
      name: 'Solo Consulta',
    });

    // Debe bloquear eliminación del rol reportsRole porque tiene usuario asignado (409 ROLE_IN_USE)
    const delInUse = await requestJson(baseUrl, 'DELETE', `/api/roles/${reportsRole.id}`, { token: ownerAToken });
    assert.strictEqual(delInUse.status, 409);
    assert.strictEqual(delInUse.body.code, 'ROLE_IN_USE');

    // Puede CONSULTAR egresos, 606, 607, IT-1, secuencias
    assert.strictEqual((await requestJson(baseUrl, 'GET', '/api/expenses', { token: viewerToken })).status, 200);
    assert.strictEqual((await requestJson(baseUrl, 'GET', '/api/dgii/report-606', { token: viewerToken })).status, 200);
    assert.strictEqual((await requestJson(baseUrl, 'GET', '/api/dgii/report-607', { token: viewerToken })).status, 200);
    assert.strictEqual((await requestJson(baseUrl, 'GET', '/api/dgii/it1', { token: viewerToken })).status, 200);
    assert.strictEqual((await requestJson(baseUrl, 'GET', '/api/dgii/sequences', { token: viewerToken })).status, 200);

    // NO puede crear egreso, pagar préstamo, anular, exportar TXT 606/607, configurar IT-1 ni secuencias
    assert.strictEqual((await requestJson(baseUrl, 'POST', '/api/expenses', { token: viewerToken, body: { concept: 'Test', amount: 100 } })).status, 403);
    assert.strictEqual((await requestJson(baseUrl, 'POST', '/api/expenses', { token: viewerToken, body: { concept: 'Préstamo', amount: 500, is_loan: 1 } })).status, 403);
    assert.strictEqual((await requestJson(baseUrl, 'POST', '/api/dgii/report-606', { token: viewerToken, body: { rnc_cedula: '131917038', ncf: 'B0100000001' } })).status, 403);
    assert.strictEqual((await requestJson(baseUrl, 'GET', '/api/dgii/report-606/txt', { token: viewerToken })).status, 403);
    assert.strictEqual((await requestJson(baseUrl, 'GET', '/api/dgii/report-607/txt', { token: viewerToken })).status, 403);
    assert.strictEqual((await requestJson(baseUrl, 'POST', '/api/dgii/it1/save', { token: viewerToken, body: { periodo: '2026-11' } })).status, 403);
    assert.strictEqual((await requestJson(baseUrl, 'POST', '/api/dgii/sequences', { token: viewerToken, body: { tipo_comprobante: 'B02', secuencia_desde: 1, secuencia_hasta: 10 } })).status, 403);
    console.log('  ✅ [PASS] Consultar (accounting.view) NO concede crear, editar, pagar, anular, configurar ni exportar.');

    // 7. Usuario con rol Contabilidad: puede operar contabilidad y exportar, pero NO seguridad ni transmisión electrónica DGII
    console.log('[7/10] Verificando rol Contabilidad (operaciones permitidas, no seguridad, DGII e-CF desactivado)...');
    const accUserId = crypto.randomUUID();
    createdUserIds.push(accUserId);
    await pool.query(
      `INSERT INTO users (id, tenant_id, branch_id, name, nombre, email, password_hash, role, role_id, is_active, estado, token_version)
       VALUES (?, ?, ?, 'Contadora Test', 'Contadora Test', ?, ?, 'contador', ?, true, 'Activo', 1)`,
      [accUserId, tenantA, branchA1, `acc-${ts}@test.local`, pwHash, accountingRole.id]
    );
    const accToken = await makeTokenForUser({
      userId: accUserId,
      tenantId: tenantA,
      branchId: branchA1,
      role: 'contador',
      email: `acc-${ts}@test.local`,
      name: 'Contadora Test',
    });

    const expCreate = await requestJson(baseUrl, 'POST', '/api/expenses', {
      token: accToken,
      body: { concept_name: 'Energía Eléctrica', amount: 2500, payment_date: '2026-11-15' },
    });
    assert.strictEqual(expCreate.status, 200);
    const expVoid = await requestJson(baseUrl, 'POST', `/api/expenses/${expCreate.body.id}/void`, {
      token: accToken,
      body: { reason: 'Prueba de anulación' },
    });
    assert.strictEqual(expVoid.status, 200);
    assert.strictEqual((await requestJson(baseUrl, 'GET', '/api/dgii/report-607/txt', { token: accToken })).status, 200);
    // Transmisión electrónica DGII sigue bloqueada (503) aunque tenga accounting.credit_notes.manage
    const dgiiRetransmit = await requestJson(baseUrl, 'POST', '/api/dgii/credit-notes/retransmit/1', { token: accToken, body: {} });
    assert.strictEqual(dgiiRetransmit.status, 503);
    assert.strictEqual(dgiiRetransmit.body.code, 'DGII_INTEGRATION_DISABLED');
    // No puede acceder a /api/roles (sin security.view)
    assert.strictEqual((await requestJson(baseUrl, 'GET', '/api/roles', { token: accToken })).status, 403);
    console.log('  ✅ [PASS] Rol Contabilidad validado correctamente.');

    // 8. Invalidación inmediata de sesión al cambiar permisos de un rol
    console.log('[8/10] Verificando invalidación de sesiones/tokens al modificar permisos de un rol...');
    const revPerms = { ...accountingRole.permisos };
    delete revPerms['accounting.export'];
    const updForRevoke = await requestJson(baseUrl, 'PUT', `/api/roles/${accountingRole.id}`, {
      token: ownerAToken,
      body: { nombre: 'Contabilidad', permisos: revPerms },
    });
    assert.strictEqual(updForRevoke.status, 200);
    // El token previo de accToken debe ser rechazado con 401 por token_version incrementado
    const staleCall = await requestJson(baseUrl, 'GET', '/api/dgii/report-607/txt', { token: accToken });
    assert.strictEqual(staleCall.status, 401, `Esperado 401 tras invalidación de rol, recibido ${staleCall.status}`);
    console.log('  ✅ [PASS] Sesiones invalidadas inmediatamente tras cambio de permisos.');

    // 9. Auditoría de creación, edición, restauración y eliminación de roles
    console.log('[9/10] Verificando registro de auditoría en security_audit_logs...');
    const [auditRows] = await pool.query(
      `SELECT action FROM security_audit_logs WHERE tenant_id = ? AND action IN ('ROLE_TEMPLATES_INSTALLED', 'ROLE_UPDATED', 'ROLE_TEMPLATE_RESTORED', 'ROLE_DELETED')`,
      [tenantA]
    );
    const actions = new Set((auditRows || []).map((r) => r.action));
    assert.ok(actions.has('ROLE_TEMPLATES_INSTALLED'), 'Debe auditar ROLE_TEMPLATES_INSTALLED');
    assert.ok(actions.has('ROLE_UPDATED'), 'Debe auditar ROLE_UPDATED');
    assert.ok(actions.has('ROLE_TEMPLATE_RESTORED'), 'Debe auditar ROLE_TEMPLATE_RESTORED');
    assert.ok(actions.has('ROLE_DELETED'), 'Debe auditar ROLE_DELETED');
    console.log('  ✅ [PASS] Auditoría completa verificada.');

    // 10. Verificar onboarding (installPredefinedRolesForTenant en nueva empresa)
    console.log('[10/10] Verificando instalación automática para nueva empresa (Tenant B)...');
    const bSeed = await installPredefinedRolesForTenant(pool, tenantB);
    assert.strictEqual(bSeed.installed.length, 6);
    console.log('  ✅ [PASS] Nueva empresa recibe los 6 roles predefinidos aislados.');

    console.log('\n========================================================================');
    console.log('✅ TODOS LOS 10 ESCENARIOS RBAC CONTABILIDAD Y PLANTILLAS PASARON');
    console.log('========================================================================');
  } finally {
    // Limpieza total de fixtures sintéticos
    try {
      await pool.query('DELETE FROM user_sessions WHERE tenant_id IN (?, ?)', [tenantA, tenantB]);
      await pool.query('DELETE FROM security_audit_logs WHERE tenant_id IN (?, ?)', [tenantA, tenantB]);
      await pool.query('DELETE FROM expenses WHERE tenant_id IN (?, ?)', [tenantA, tenantB]);
      await pool.query('DELETE FROM users WHERE tenant_id IN (?, ?)', [tenantA, tenantB]);
      await pool.query('DELETE FROM roles WHERE tenant_id IN (?, ?)', [tenantA, tenantB]);
      await pool.query('DELETE FROM salons WHERE tenant_id IN (?, ?)', [tenantA, tenantB]);
      await pool.query('DELETE FROM branches WHERE tenant_id IN (?, ?)', [tenantA, tenantB]);
      await pool.query('DELETE FROM tenant_subscriptions WHERE tenant_id IN (?, ?)', [tenantA, tenantB]);
      await pool.query('DELETE FROM tenants WHERE id IN (?, ?)', [tenantA, tenantB]);
    } catch (cleanErr) {
      console.warn('[CLEANUP WARNING]:', cleanErr.message);
    }
    server.close();
    await pool.end();
  }
}

runTests().catch((err) => {
  console.error('❌ FALLO EN SUITE RBAC CONTABILIDAD Y PLANTILLAS:', err);
  process.exit(1);
});
