/**
 * Test Suite: Phase 2H-A Security, RBAC & Isolation Remediation
 * (backend/tests/test_phase2h_security.cjs)
 * 
 * Verifies P0 fixes:
 * - Block 1: Strict RBAC on User Management (RBAC-001)
 * - Block 2: Secure Hashed Admin PIN with Rate Limiting (DATA-001, RBAC-002)
 * - Block 3: Billing Rescue Allowlist during Tenant Suspension (AUTH-002)
 * - Block 4: Multi-Tenant Secure File Access & /uploads Protection (TENANT-001)
 * 
 * PURE IN-MEMORY — ZERO POSTGRESQL — ZERO SECRETS
 */

'use strict';

const assert = require('assert');
const { createInMemoryTestApp } = require('./helpers/create_in_memory_test_app.cjs');
const { signAuthToken } = require('../middleware/auth.middleware');

async function runPhase2hSecuritySuite() {
  console.log('\n=== STARTING SUITE: PHASE 2H-A SECURITY REMEDIATION (P0) ===\n');

  const testApp = await createInMemoryTestApp();
  let passedTests = 0;

  function pass(name) {
    passedTests++;
    console.log(`  [PASS ${passedTests}] ${name}`);
  }

  try {
    // -------------------------------------------------------------
    // SETUP: Tenants and Users
    // -------------------------------------------------------------
    // Tenant 1 (Base Plan)
    const tenant1 = await testApp.createTenantWithUser({
      planCode: 'BASE',
      ownerEmail: 'owner1@salonpro.test',
      ownerName: 'Propietario Uno',
      businessName: 'Salón Alpha'
    });

    // Tenant 2 (Pro Plan)
    const tenant2 = await testApp.createTenantWithUser({
      planCode: 'PRO',
      ownerEmail: 'owner2@salonpro.test',
      ownerName: 'Propietario Dos',
      businessName: 'Salón Beta'
    });

    // Staff in Tenant 1
    // Admin user
    const adminUser = {
      id: 101,
      tenant_id: tenant1.tenantId,
      email: 'admin1@salonpro.test',
      name: 'Admin Salón Uno',
      role: 'admin',
      is_active: 1
    };
    testApp.dbMock.tables.users.push(adminUser);
    testApp.dbMock.tables.user_sessions.push({ id: 1001, user_id: 101, role: 'admin', tenant_id: tenant1.tenantId, is_active: 1 });
    const adminToken = signAuthToken({
      sub: adminUser.id,
      id: adminUser.id,
      email: adminUser.email,
      name: adminUser.name,
      role: 'admin',
      tenantId: tenant1.tenantId,
      branchId: tenant1.branchId,
      sessionId: 1001
    });

    // Cashier user
    const cashierUser = {
      id: 102,
      tenant_id: tenant1.tenantId,
      email: 'cajero1@salonpro.test',
      name: 'Cajero Salón Uno',
      role: 'cajero',
      is_active: 1
    };
    testApp.dbMock.tables.users.push(cashierUser);
    testApp.dbMock.tables.user_sessions.push({ id: 1002, user_id: 102, role: 'cajero', tenant_id: tenant1.tenantId, is_active: 1 });
    const cashierToken = signAuthToken({
      sub: cashierUser.id,
      id: cashierUser.id,
      email: cashierUser.email,
      name: cashierUser.name,
      role: 'cajero',
      tenantId: tenant1.tenantId,
      branchId: tenant1.branchId,
      sessionId: 1002
    });

    // Receptionist user
    const receptionistUser = {
      id: 103,
      tenant_id: tenant1.tenantId,
      email: 'recep1@salonpro.test',
      name: 'Recepcionista Salón Uno',
      role: 'recepcionista',
      is_active: 1
    };
    testApp.dbMock.tables.users.push(receptionistUser);
    testApp.dbMock.tables.user_sessions.push({ id: 1003, user_id: 103, role: 'recepcionista', tenant_id: tenant1.tenantId, is_active: 1 });
    const receptionistToken = signAuthToken({
      sub: receptionistUser.id,
      id: receptionistUser.id,
      email: receptionistUser.email,
      name: receptionistUser.name,
      role: 'recepcionista',
      tenantId: tenant1.tenantId,
      branchId: tenant1.branchId,
      sessionId: 1003
    });

    // B2C Customer in Tenant 1
    testApp.dbMock.tables.clients = testApp.dbMock.tables.clients || [];
    testApp.dbMock.tables.clients.push({
      id: 201,
      tenant_id: tenant1.tenantId,
      nombre: 'Clienta B2C',
      email: 'clienta@gmail.test',
      status: 'active'
    });
    testApp.dbMock.tables.user_sessions.push({ id: 2001, user_id: 201, role: 'cliente_b2c', tenant_id: tenant1.tenantId, is_active: 1 });
    const b2cCustomerToken = signAuthToken({
      sub: 201,
      id: 201,
      email: 'clienta@gmail.test',
      name: 'Clienta B2C',
      role: 'cliente_b2c',
      isClient: true,
      tenantId: tenant1.tenantId,
      sessionId: 2001
    });

    // =============================================================
    // BLOQUE 1: RBAC ESTRICTO EN GESTIÓN DE USUARIOS (RBAC-001)
    // =============================================================
    console.log('\n--- BLOQUE 1: RBAC ESTRICTO EN GESTIÓN DE USUARIOS ---');

    // 1.1: Cajero intentando crear usuario -> 403 Forbidden
    const res1_1 = await testApp.request({
      method: 'POST',
      path: '/api/users',
      headers: { 'Authorization': `Bearer ${cashierToken}` },
      body: {
        nombre: 'Nuevo Usuario Ilegal',
        email: 'hacker1@salonpro.test',
        password: 'Password123!',
        role: 'admin'
      }
    });
    assert.strictEqual(res1_1.status, 403, 'Cajero creando usuario debe responder 403');
    pass('Flow 1.1: Cajero creando usuario es rechazado con 403');

    // 1.2: Recepcionista intentando eliminar propietario -> 403 Forbidden
    const res1_2 = await testApp.request({
      method: 'DELETE',
      path: `/api/users/${tenant1.userId}`,
      headers: { 'Authorization': `Bearer ${receptionistToken}` }
    });
    assert.strictEqual(res1_2.status, 403, 'Recepcionista eliminando usuario debe responder 403');
    pass('Flow 1.2: Recepcionista intentando eliminar usuario es rechazada con 403');

    // 1.3: Cliente B2C intentando consultar o crear usuarios -> 403 Forbidden
    const res1_3 = await testApp.request({
      method: 'GET',
      path: '/api/users',
      headers: { 'Authorization': `Bearer ${b2cCustomerToken}` }
    });
    assert.strictEqual(res1_3.status, 403, 'Cliente B2C consultando usuarios debe responder 403');
    pass('Flow 1.3: Cliente B2C consultando lista de usuarios es bloqueado con 403');

    // 1.4: Spoofing mediante header x-user-role no eleva privilegios
    const res1_4 = await testApp.request({
      method: 'POST',
      path: '/api/users',
      headers: {
        'Authorization': `Bearer ${cashierToken}`,
        'x-user-role': 'propietario',
        'x-role': 'superadmin'
      },
      body: {
        nombre: 'Usuario Spoofed',
        email: 'spoofed@salonpro.test',
        password: 'Password123!',
        role: 'admin'
      }
    });
    assert.strictEqual(res1_4.status, 403, 'Spoofing de rol en headers debe ser ignorado y responder 403');
    pass('Flow 1.4: Spoofing de rol mediante cabeceras HTTP es rechazado con 403');

    // 1.5: Administrador intentando crear un Propietario (escalada de privilegios) -> 403 Forbidden
    const res1_5 = await testApp.request({
      method: 'POST',
      path: '/api/users',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: {
        nombre: 'Nuevo Propietario Ilegal',
        email: 'propietario_ilegal@salonpro.test',
        password: 'Password123!',
        role: 'propietario'
      }
    });
    assert.strictEqual(res1_5.status, 403, 'Admin creando rol propietario debe responder 403');
    pass('Flow 1.5: Administrador intentando crear un Propietario es bloqueado con 403');

    // 1.6: IDOR - Usuario de Tenant 1 intentando modificar usuario de Tenant 2 -> 404
    const res1_6 = await testApp.request({
      method: 'PUT',
      path: `/api/users/${tenant2.userId}`,
      headers: { 'Authorization': `Bearer ${tenant1.headers.Authorization.split(' ')[1]}` },
      body: { nombre: 'Nombre Hackeado' }
    });
    assert.strictEqual(res1_6.status, 404, 'Modificar usuario de otro tenant debe responder 404');
    pass('Flow 1.6: Intento de IDOR sobre usuario de otro tenant responde 404');

    // 1.7: Propietario gestionando usuario permitido -> Éxito (200/201)
    const res1_7 = await testApp.request({
      method: 'POST',
      path: '/api/users',
      headers: { 'Authorization': tenant2.headers.Authorization },
      body: {
        nombre: 'Estilista Válida',
        email: 'estilista.valida@salonpro.test',
        password: 'Password123!',
        role: 'estilista'
      }
    });
    assert.strictEqual(res1_7.status, 200, 'Propietario creando estilista debe ser exitoso');
    const createdUserId = res1_7.body.id;
    assert.ok(createdUserId, 'Debe retornar id del usuario creado');
    pass('Flow 1.7: Propietario creando usuario permitido completa con éxito');

    // 1.8: Intento de eliminar al último propietario activo del tenant -> Bloqueado (400 o 409)
    const res1_8 = await testApp.request({
      method: 'DELETE',
      path: `/api/users/${tenant1.userId}`,
      headers: { 'Authorization': tenant1.headers.Authorization }
    });
    assert.ok([400, 409].includes(res1_8.status), `Eliminar al último propietario debe responder 400/409, got ${res1_8.status}`);
    pass('Flow 1.8: Eliminación del último propietario activo del tenant es bloqueada');

    // =============================================================
    // BLOQUE 2: PIN ADMINISTRATIVO SEGURO (DATA-001, RBAC-002)
    // =============================================================
    console.log('\n--- BLOQUE 2: PIN ADMINISTRATIVO SEGURO ---');

    // 2.1: Empleado no autorizado intentando cambiar PIN -> 403 Forbidden
    const res2_1 = await testApp.request({
      method: 'POST',
      path: '/api/security/settings',
      headers: { 'Authorization': `Bearer ${cashierToken}` },
      body: { admin_pin: '8392' }
    });
    assert.strictEqual(res2_1.status, 403, 'Cajero cambiando PIN debe responder 403');
    pass('Flow 2.1: Empleado no autorizado intentando cambiar PIN recibe 403');

    // 2.2: Propietario estableciendo PIN trivial o secuencial -> Rechazado (400)
    const res2_2 = await testApp.request({
      method: 'POST',
      path: '/api/security/settings',
      headers: { 'Authorization': tenant1.headers.Authorization },
      body: { admin_pin: '0000' }
    });
    assert.strictEqual(res2_2.status, 400, 'PIN trivial 0000 debe responder 400');
    pass('Flow 2.2: Intento de establecer PIN trivial o secuencial es rechazado con 400');

    // 2.3: Propietario estableciendo PIN seguro inicial (ej: 8492) -> Éxito (200)
    const res2_3 = await testApp.request({
      method: 'POST',
      path: '/api/security/settings',
      headers: { 'Authorization': tenant1.headers.Authorization },
      body: { admin_pin: '8492' }
    });
    assert.strictEqual(res2_3.status, 200, 'Establecer PIN inicial seguro debe responder 200');
    pass('Flow 2.3: Propietario establece PIN seguro inicial con éxito');

    // 2.4: Verificar que el PIN guardado en DB esté hasheado (no texto plano)
    const [secRows] = await testApp.dbMock.query('SELECT admin_pin, admin_pin_hash FROM security_settings WHERE tenant_id = ?', [tenant1.tenantId]);
    const secRow = secRows[0];
    const storedPin = secRow?.admin_pin_hash || secRow?.admin_pin;
    assert.ok(storedPin, 'Debe haber un PIN o hash guardado');
    assert.notStrictEqual(storedPin, '8492', 'El PIN NUNCA debe guardarse en texto plano');
    assert.ok(storedPin.startsWith('$2'), 'El PIN debe ser un hash adaptativo bcrypt');
    pass('Flow 2.4: El PIN está almacenado como hash bcrypt y no en texto plano');

    // 2.5: GET /api/security/settings NUNCA expone el PIN ni el hash
    const res2_5 = await testApp.request({
      method: 'GET',
      path: '/api/security/settings',
      headers: { 'Authorization': tenant1.headers.Authorization }
    });
    assert.strictEqual(res2_5.status, 200);
    assert.strictEqual(res2_5.body.admin_pin, undefined, 'La respuesta no debe contener admin_pin');
    assert.strictEqual(res2_5.body.admin_pin_hash, undefined, 'La respuesta no debe contener admin_pin_hash');
    assert.strictEqual(res2_5.body.is_pin_configured, true, 'Debe indicar que el PIN está configurado');
    pass('Flow 2.5: GET /settings no expone el PIN ni el hash en el payload');

    // 2.6: Intento de cambiar PIN sin proveer current_pin -> Rechazado (400)
    const res2_6 = await testApp.request({
      method: 'POST',
      path: '/api/security/settings',
      headers: { 'Authorization': tenant1.headers.Authorization },
      body: { admin_pin: '9371' } // falta current_pin
    });
    assert.strictEqual(res2_6.status, 400, 'Cambiar PIN sin current_pin debe fallar');
    pass('Flow 2.6: Cambio de PIN existente sin current_pin es rechazado con 400');

    // 2.7: Intento de cambiar PIN con current_pin incorrecto -> Rechazado (400/401)
    const res2_7 = await testApp.request({
      method: 'POST',
      path: '/api/security/settings',
      headers: { 'Authorization': tenant1.headers.Authorization },
      body: {
        current_pin: '9999', // incorrecto
        admin_pin: '9371'
      }
    });
    assert.ok([400, 401].includes(res2_7.status), 'Current PIN incorrecto debe responder 400 o 401');
    pass('Flow 2.7: Cambio de PIN con current_pin erróneo es rechazado');

    // 2.8: Verificación de PIN correcta -> Éxito (200)
    const res2_8 = await testApp.request({
      method: 'POST',
      path: '/api/security/verify-pin',
      headers: { 'Authorization': tenant1.headers.Authorization },
      body: { pin: '8492' }
    });
    assert.strictEqual(res2_8.status, 200, 'PIN correcto debe verificar con éxito');
    assert.strictEqual(res2_8.body.success, true);
    pass('Flow 2.8: Verificación con PIN correcto es aprobada exitosamente');

    // 2.9: Rate limit / Bloqueo temporal tras intentos fallidos repetidos de PIN
    for (let i = 0; i < 5; i++) {
      await testApp.request({
        method: 'POST',
        path: '/api/security/verify-pin',
        headers: { 'Authorization': tenant1.headers.Authorization },
        body: { pin: '0000' }
      });
    }
    const res2_9 = await testApp.request({
      method: 'POST',
      path: '/api/security/verify-pin',
      headers: { 'Authorization': tenant1.headers.Authorization },
      body: { pin: '8492' } // aun con PIN correcto, debe estar bloqueado
    });
    assert.ok([423, 429].includes(res2_9.status), `PIN bloqueado por fuerza bruta debe responder 423 o 429, got ${res2_9.status}`);
    pass('Flow 2.9: Intentos repetidos de PIN activan bloqueo temporal anti-fuerza bruta');

    // Desbloquear PIN para siguientes pruebas
    await testApp.dbMock.query('UPDATE security_settings SET pin_failed_attempts = 0, pin_locked_until = NULL WHERE tenant_id = ?', [tenant1.tenantId]);

    // =============================================================
    // BLOQUE 3: RECUPERACIÓN DE FACTURACIÓN EN SUSPENSIÓN (AUTH-002)
    // =============================================================
    console.log('\n--- BLOQUE 3: RESCATE DE FACTURACIÓN DURANTE SUSPENSIÓN ---');

    // Suspender Tenant 1
    await testApp.dbMock.query("UPDATE tenants SET status = ? WHERE id = ?", ['suspended', tenant1.tenantId]);
    await testApp.dbMock.query("UPDATE tenant_subscriptions SET status = ? WHERE tenant_id = ?", ['suspended', tenant1.tenantId]);

    // 3.1: Tenant suspendido consultando POS / Inventario / Reportes -> 403 Forbidden
    const res3_1 = await testApp.request({
      method: 'GET',
      path: '/api/visits',
      headers: { 'Authorization': tenant1.headers.Authorization }
    });
    assert.strictEqual(res3_1.status, 403, 'POS en tenant suspendido debe responder 403');
    assert.strictEqual(res3_1.body.code, 'TENANT_SUSPENDED');
    pass('Flow 3.1: Operaciones comerciales (POS) permanecen estrictamente bloqueadas en suspensión');

    // 3.2: Propietario suspendido consultando su suscripción -> 200 OK
    const res3_2 = await testApp.request({
      method: 'GET',
      path: '/api/saas/billing/subscription',
      headers: { 'Authorization': tenant1.headers.Authorization }
    });
    assert.strictEqual(res3_2.status, 200, 'Propietario suspendido consultando suscripción debe responder 200');
    pass('Flow 3.2: Propietario suspendido consulta estado de suscripción exitosamente');

    // 3.3: Propietario suspendido consultando sus facturas abiertas -> 200 OK
    const res3_3 = await testApp.request({
      method: 'GET',
      path: '/api/saas/billing/invoices',
      headers: { 'Authorization': tenant1.headers.Authorization }
    });
    assert.strictEqual(res3_3.status, 200, 'Propietario suspendido consultando facturas debe responder 200');
    pass('Flow 3.3: Propietario suspendido consulta facturas de rescate exitosamente');

    // 3.4: Usuario NO propietario (ej. cajero) intentando acceder a facturación -> 403 Forbidden
    const res3_4 = await testApp.request({
      method: 'GET',
      path: '/api/saas/billing/subscription',
      headers: { 'Authorization': `Bearer ${cashierToken}` }
    });
    assert.strictEqual(res3_4.status, 403, 'No-propietario en suscripción de tenant suspendido debe ser 403');
    pass('Flow 3.4: Empleado no-propietario intentando acceder a rescate de facturación recibe 403');

    // 3.5: Propietario suspendido pagando deuda pendiente -> Éxito (200) y reactivación
    const res3_5 = await testApp.request({
      method: 'POST',
      path: '/api/saas/billing/pay-debt',
      headers: { 'Authorization': tenant1.headers.Authorization },
      body: {
        paymentMethodToken: 'pm_token_rescue_test_valid'
      }
    });
    assert.strictEqual(res3_5.status, 200, 'Pago de deuda debe tener éxito');
    assert.strictEqual(res3_5.body.status, 'active');
    pass('Flow 3.5: Pago de deuda exitoso reactiva tenant suspendido a estado active');

    // =============================================================
    // BLOQUE 4: PROTECCIÓN DE ARCHIVOS Y UPLOADS (TENANT-001)
    // =============================================================
    console.log('\n--- BLOQUE 4: PROTECCIÓN DE ARCHIVOS Y AISLAMIENTO MULTI-TENANT ---');

    // 4.1: URL pública legacy /uploads no debe exponer archivos estáticos
    const res4_1 = await testApp.request({
      method: 'GET',
      path: '/uploads/secret_contract.pdf'
    });
    assert.strictEqual(res4_1.status, 404, 'Acceso estático público a /uploads debe retornar 404');
    pass('Flow 4.1: Acceso público anónimo a /uploads está deshabilitado y retorna 404');

    // 4.2: Endpoint seguro de archivos requiere autenticación -> 401 Unauthorized
    const res4_2 = await testApp.request({
      method: 'GET',
      path: '/api/tenant/files/file_abc123.pdf'
    });
    assert.strictEqual(res4_2.status, 401, 'Acceso a archivo sin token debe ser 401');
    pass('Flow 4.2: Descarga de archivo sin autenticación responde 401 Unauthorized');

    // Registrar archivo seguro para Tenant 1
    testApp.dbMock.tables.tenant_files = testApp.dbMock.tables.tenant_files || [];
    testApp.dbMock.tables.tenant_files.push({
      file_id: 'contract_alpha_1.pdf',
      tenant_id: tenant1.tenantId,
      filename: 'contract_alpha_1.pdf',
      mime_type: 'application/pdf',
      content_base64: Buffer.from('%PDF-1.4 Mock Contract Content for Salon Alpha').toString('base64'),
      is_active: 1
    });

    // Registrar archivo seguro para Tenant 2
    testApp.dbMock.tables.tenant_files.push({
      file_id: 'contract_beta_2.pdf',
      tenant_id: tenant2.tenantId,
      filename: 'contract_beta_2.pdf',
      mime_type: 'application/pdf',
      content_base64: Buffer.from('%PDF-1.4 Mock Contract Content for Salon Beta').toString('base64'),
      is_active: 1
    });

    // 4.3: Tenant 1 intentando descargar archivo de Tenant 2 -> 404 Not Found (Anti-IDOR)
    const res4_3 = await testApp.request({
      method: 'GET',
      path: '/api/tenant/files/contract_beta_2.pdf',
      headers: { 'Authorization': tenant1.headers.Authorization }
    });
    assert.strictEqual(res4_3.status, 404, 'Archivo de otro tenant debe devolver 404');
    pass('Flow 4.3: Intento de IDOR cruzado sobre archivo de otro tenant responde 404');

    // 4.4: Path traversal attempt (../../etc/passwd) -> 400 Bad Request
    const res4_4 = await testApp.request({
      method: 'GET',
      path: '/api/tenant/files/..%2F..%2Fetc%2Fpasswd',
      headers: { 'Authorization': tenant1.headers.Authorization }
    });
    assert.ok([400, 404].includes(res4_4.status), 'Intento de path traversal debe responder 400 o 404');
    pass('Flow 4.4: Ataque de Path Traversal es neutralizado con 400/404');

    // 4.5: Descarga autorizada de archivo propio de Tenant 1 -> 200 OK con headers nosniff
    const res4_5 = await testApp.request({
      method: 'GET',
      path: '/api/tenant/files/contract_alpha_1.pdf',
      headers: { 'Authorization': tenant1.headers.Authorization }
    });
    assert.strictEqual(res4_5.status, 200, 'Descarga autorizada debe retornar 200');
    assert.strictEqual(res4_5.headers['x-content-type-options'], 'nosniff', 'Debe incluir cabecera X-Content-Type-Options: nosniff');
    assert.ok(res4_5.headers['content-disposition']?.includes('contract_alpha_1.pdf'), 'Debe incluir Content-Disposition seguro');
    pass('Flow 4.5: Descarga autorizada por el tenant entrega archivo con headers de seguridad');

    // =========================================================================
    // PASO 0 (Fase 2H-B): AUDITORÍA Y ENDURECIMIENTO RESIDUAL DE PIN Y SEGURIDAD
    // =========================================================================
    console.log('\n--- PASO 0: AUDITORÍA RESIDUAL DE PIN Y ROLES (FASE 2H-B) ---');

    // 0.1: PIN legacy almacenado en texto plano NO autentica operaciones y exige rotación
    const legacyTenant = await testApp.createTenantWithUser({
      plan: 'BASE',
      email: 'legacy@salon.com',
      username: 'legacy_owner',
      role: 'owner'
    });

    // Sobrescribir security_settings para este tenant con PIN en texto plano legacy
    const existingLegacySec = testApp.dbMock.tables.security_settings.find(s => s.tenant_id === legacyTenant.tenantId);
    if (existingLegacySec) {
      existingLegacySec.admin_pin = '9821';
      existingLegacySec.admin_pin_hash = null;
    } else {
      testApp.dbMock.tables.security_settings.push({
        tenant_id: legacyTenant.tenantId,
        admin_pin: '9821', // Legacy plaintext
        admin_pin_hash: null,
        max_failed_attempts: 5,
        lockout_minutes: 30,
        pin_failed_attempts: 0,
        pin_locked_until: null
      });
    }

    const legacyCashierToken = signAuthToken({
      id: 88,
      sub: '88',
      userId: 88,
      tenantId: legacyTenant.tenantId,
      role: 'cajero',
      username: 'legacy_cashier'
    });
    testApp.dbMock.tables.users.push({
      id: 88,
      tenant_id: legacyTenant.tenantId,
      username: 'legacy_cashier',
      email: 'cashier@legacy.com',
      role: 'cajero',
      is_active: 1
    });
    testApp.dbMock.tables.user_sessions.push({
      id: 88,
      tenant_id: legacyTenant.tenantId,
      user_id: 88,
      is_active: 1
    });

    const res0_1 = await testApp.request({
      method: 'POST',
      path: '/api/security/verify-pin',
      headers: { 'Authorization': `Bearer ${legacyCashierToken}` },
      body: { pin: '9821' }
    });
    assert.strictEqual(res0_1.status, 403, 'PIN legacy debe ser rechazado con 403');
    assert.strictEqual(res0_1.body.code, 'PIN_ROTATION_REQUIRED', 'Debe exigir rotación obligatoria');
    pass('Flow 0.1: PIN legacy en texto plano es rechazado con 403 PIN_ROTATION_REQUIRED');

    // 0.2: Propietario rotando PIN legacy mediante POST /settings con current_pin exitosamente
    const res0_2 = await testApp.request({
      method: 'POST',
      path: '/api/security/settings',
      headers: { 'Authorization': legacyTenant.headers.Authorization },
      body: {
        admin_pin: '7391', // Nuevo PIN complejo
        current_pin: '9821' // PIN legacy anterior para autorizar
      }
    });
    assert.strictEqual(res0_2.status, 200, 'Rotación de PIN legacy debe responder 200');
    // Verificar que ahora se guardó como hash bcrypt
    const [rotatedSec] = await testApp.dbMock.query('SELECT admin_pin, admin_pin_hash FROM security_settings WHERE tenant_id = ?', [legacyTenant.tenantId]);
    assert.ok(String(rotatedSec[0].admin_pin_hash).startsWith('$2'), 'El PIN rotado debe almacenarse como hash bcrypt');
    pass('Flow 0.2: Propietario rota exitosamente PIN legacy validando clave anterior');

    // 0.3: Empleado con intentos fallidos repetidos se bloquea a sí mismo pero NO bloquea al propietario
    const empToken = signAuthToken({
      id: 90,
      sub: '90',
      userId: 90,
      tenantId: tenant1.tenantId,
      role: 'cajero',
      username: 'troublemaker_cashier'
    });
    testApp.dbMock.tables.users.push({
      id: 90,
      tenant_id: tenant1.tenantId,
      username: 'troublemaker_cashier',
      email: 'trouble@salon.com',
      role: 'cajero',
      is_active: 1
    });
    testApp.dbMock.tables.user_sessions.push({
      id: 90,
      tenant_id: tenant1.tenantId,
      user_id: 90,
      is_active: 1
    });
    // Disparar 5 intentos erróneos desde la identidad del cajero
    for (let i = 0; i < 5; i++) {
      await testApp.request({
        method: 'POST',
        path: '/api/security/verify-pin',
        headers: { 'Authorization': `Bearer ${empToken}`, 'x-user-id': '90', 'x-user-role': 'cajero' },
        body: { pin: '9999' }
      });
    }
    // El 6to intento del empleado responde 423 PIN_TEMPORARILY_LOCKED
    const res0_3_emp = await testApp.request({
      method: 'POST',
      path: '/api/security/verify-pin',
      headers: { 'Authorization': `Bearer ${empToken}`, 'x-user-id': '90', 'x-user-role': 'cajero' },
      body: { pin: '8392' }
    });
    assert.strictEqual(res0_3_emp.status, 423, 'Empleado debe quedar bloqueado tras 5 fallos');

    // Sin embargo, el propietario verifica su PIN correcto y NO está bloqueado
    const res0_3_owner = await testApp.request({
      method: 'POST',
      path: '/api/security/verify-pin',
      headers: { 'Authorization': tenant1.headers.Authorization, 'x-user-id': '1', 'x-user-role': 'propietario' },
      body: { pin: '8492' }
    });
    assert.strictEqual(res0_3_owner.status, 200, 'Propietario no debe quedar bloqueado por intentos de un empleado');
    pass('Flow 0.3: Empleado bloqueado por fuerza bruta no bloquea al propietario');

    // 0.4: SuperAdmin cambiando PIN sin soporte formal recibe 400
    const superadmin = await testApp.createTenantWithUser({
      role: 'superadmin',
      email: 'superadmin@salonpro.test',
      username: 'superadmin_sec'
    });

    const res0_4 = await testApp.request({
      method: 'POST',
      path: '/api/security/settings',
      headers: {
        'Authorization': superadmin.headers.Authorization,
        'x-tenant-id': tenant1.tenantId
      },
      body: { admin_pin: '8492' }
    });
    assert.strictEqual(res0_4.status, 400, 'SuperAdmin sin ticket debe recibir 400');
    assert.strictEqual(res0_4.body.code, 'SUPPORT_AUTHORIZATION_REQUIRED', 'Requiere ticket de soporte');
    pass('Flow 0.4: SuperAdmin sin ticket de soporte formal recibe 400 SUPPORT_AUTHORIZATION_REQUIRED');

    // 0.5: SuperAdmin con ticket de soporte formal cambia PIN y registra auditoría inmutable
    const res0_5 = await testApp.request({
      method: 'POST',
      path: '/api/security/settings',
      headers: {
        'Authorization': superadmin.headers.Authorization,
        'x-tenant-id': tenant1.tenantId
      },
      body: {
        admin_pin: '8492',
        support_ticket_id: 'INC-2026-9921',
        support_reason: 'Restablecimiento de PIN solicitado por titular verificado vía videollamada'
      }
    });
    assert.strictEqual(res0_5.status, 200, 'SuperAdmin con ticket de soporte formal completa cambio exitosamente');
    // Verificar auditoría
    const [auditRows] = await testApp.dbMock.query('SELECT * FROM security_audit_logs WHERE action = ?', ['SUPERADMIN_PIN_SUPPORT_OVERRIDE']);
    assert.ok(auditRows.length > 0, 'Debe registrar auditoría inmutable');
    assert.ok(auditRows[0].details.includes('INC-2026-9921'), 'Auditoría debe registrar ticket de soporte');
    assert.ok(!auditRows[0].details.includes('8492'), 'Auditoría NUNCA debe contener el PIN en texto plano');
    pass('Flow 0.5: SuperAdmin con ticket de soporte formal actualiza PIN y genera auditoría sin exponer clave');

    console.log('\n======================================================');
    console.log(`PHASE 2H-A TEST SUMMARY: ${passedTests}/${passedTests} PASSED`);
    console.log('======================================================\n');
  } finally {
    await testApp.close();
  }
}

runPhase2hSecuritySuite().catch(err => {
  console.error('\n❌ PHASE 2H-A TEST FAILED:');
  console.error(err);
  process.exit(1);
});
