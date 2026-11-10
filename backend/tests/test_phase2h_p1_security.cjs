/**
 * Test Suite: Phase 2H-C Security & Resilience P1 Remediation
 * (backend/tests/test_phase2h_p1_security.cjs)
 *
 * Verifies P1 fixes:
 * - REM-P1-01: Token revocation via token_version on users (remote logout / revocation)
 * - REM-P1-02: Strict CSRF Origin / Referer validation for mutating requests with cookies
 * - REM-P1-03: Rate Limiting on B2C client login and recovery
 * - REM-P1-04: Protection of /api/contact-messages (Control Plane role required)
 * - REM-P1-05: Block B2C Client role tokens from accessing staff & cash routes
 * - REM-P1-06: Supervisor PIN requirement for invoice voiding
 * - REM-P1-08: Cash register operator (opened_by / closed_by) binding from req.auth
 * - REM-P1-09: x-cron-secret enforcement on automated birthday discounts trigger
 * - REM-P1-13: Global 500 error handler sanitization with correlation ID
 *
 * PURE IN-MEMORY — ZERO POSTGRESQL — ZERO SECRETS
 */

'use strict';

const assert = require('assert');
const { createInMemoryTestApp } = require('./helpers/create_in_memory_test_app.cjs');
const { signAuthToken } = require('../middleware/auth.middleware');
const { hashPin } = require('../services/pin_security.service');

async function runPhase2hP1SecuritySuite() {
  console.log('\n=== STARTING SUITE: PHASE 2H-C P1 SECURITY REMEDIATION ===\n');

  // Set mock CRON_SECRET for test
  process.env.CRON_SECRET = 'super-secret-cron-token-minimum-16-chars';

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
    const tenant1 = await testApp.createTenantWithUser({
      planCode: 'PRO',
      ownerEmail: 'owner1@salonpro.test',
      ownerName: 'Propietario Uno',
      businessName: 'Salón Alpha'
    });

    // Cashier user in Tenant 1
    const cashierUser = {
      id: 201,
      tenant_id: tenant1.tenantId,
      email: 'cajero1@salonpro.test',
      name: 'Cajero Principal',
      role: 'cajero',
      is_active: 1,
      token_version: 1
    };
    testApp.dbMock.tables.users.push(cashierUser);
    testApp.dbMock.tables.user_sessions.push({ id: 2001, user_id: 201, role: 'cajero', tenant_id: tenant1.tenantId, is_active: 1 });
    const cashierToken = signAuthToken({
      sub: cashierUser.id,
      id: cashierUser.id,
      email: cashierUser.email,
      name: cashierUser.name,
      role: 'cajero',
      tenantId: tenant1.tenantId,
      branchId: tenant1.branchId,
      sessionId: 2001,
      tokenVersion: 1
    });

    // B2C Client in Tenant 1
    const clientUser = {
      id: 301,
      tenant_id: tenant1.tenantId,
      email: 'client1@gmail.com',
      nombre: 'Clienta Consentida',
      salon_id: tenant1.branchId,
      status: 'Activo'
    };
    testApp.dbMock.tables.clients.push(clientUser);
    testApp.dbMock.tables.user_sessions.push({ id: 3001, user_id: 301, role: 'client', tenant_id: tenant1.tenantId, is_active: 1 });
    const clientToken = signAuthToken({
      sub: clientUser.id,
      id: clientUser.id,
      email: clientUser.email,
      name: clientUser.nombre,
      role: 'client',
      tenantId: tenant1.tenantId,
      branchId: tenant1.branchId,
      sessionId: 3001,
      isClient: true
    });

    // SuperAdmin User (Control Plane)
    const superAdmin = await testApp.createTenantWithUser({
      role: 'superadmin',
      email: 'superadmin@salonpro.test',
      ownerName: 'SuperAdmin SaaS'
    });

    // Configure security_settings with hashed PIN for Tenant 1
    const hashedPin = await hashPin('9821');
    testApp.dbMock.tables.security_settings.push({
      tenant_id: tenant1.tenantId,
      admin_pin_hash: hashedPin,
      pin_failed_attempts: 0,
      lockout_minutes: 30,
      max_failed_attempts: 5
    });

    // =============================================================
    // 1. REM-P1-01: Token Revocation via token_version
    // =============================================================
    console.log('\n--- BLOCK 1: REM-P1-01 Token Revocation via token_version ---');

    // 1.1 Cashier can access protected endpoint with initial token
    const res11 = await testApp.request({
      method: 'GET',
      path: '/api/appointments',
      headers: { 'Authorization': `Bearer ${cashierToken}` }
    });
    assert.strictEqual(res11.status, 200, 'Token inicial con tokenVersion vigente debe ser aceptado');
    pass('REM-P1-01: Token inicial con tokenVersion vigente es aceptado (200 OK)');

    // 1.2 Call revoke-tokens endpoint
    const res12 = await testApp.request({
      method: 'POST',
      path: '/api/auth/revoke-tokens',
      headers: {
        'Authorization': `Bearer ${cashierToken}`,
        'Content-Type': 'application/json'
      },
      body: {}
    });
    assert.strictEqual(res12.status, 200, 'Revoke tokens debe responder 200 OK');
    assert.strictEqual(res12.body.success, true);
    pass('REM-P1-01: Endpoint /api/auth/revoke-tokens incrementa token_version exitosamente');

    // 1.3 Verify old token is rejected with 401 (SESSION_REVOKED or TOKEN_REVOKED)
    const res13 = await testApp.request({
      method: 'GET',
      path: '/api/appointments',
      headers: { 'Authorization': `Bearer ${cashierToken}` }
    });
    assert.strictEqual(res13.status, 401, 'Token revocado debe retornar 401');
    assert.ok(res13.body.code === 'TOKEN_REVOKED' || res13.body.code === 'SESSION_REVOKED', 'Código debe indicar revocación');
    pass('REM-P1-01: Token tras /api/auth/revoke-tokens es revocado inmediatamente (401)');

    // 1.4 Test direct token_version mismatch with active session (e.g. password change)
    testApp.dbMock.tables.user_sessions.push({ id: 2003, user_id: 201, role: 'cajero', tenant_id: tenant1.tenantId, is_active: 1 });
    const tokenWithOldVersion = signAuthToken({
      sub: cashierUser.id,
      id: cashierUser.id,
      email: cashierUser.email,
      name: cashierUser.name,
      role: 'cajero',
      tenantId: tenant1.tenantId,
      branchId: tenant1.branchId,
      sessionId: 2003,
      tokenVersion: 1 // DB has token_version = 2 now
    });
    const res14 = await testApp.request({
      method: 'GET',
      path: '/api/appointments',
      headers: { 'Authorization': `Bearer ${tokenWithOldVersion}` }
    });
    assert.strictEqual(res14.status, 401, 'Token con versión desactualizada debe ser rechazado con 401');
    assert.strictEqual(res14.body.code, 'TOKEN_REVOKED', 'Código debe ser TOKEN_REVOKED');
    pass('REM-P1-01: Token con tokenVersion desactualizado es rechazado con 401 TOKEN_REVOKED');

    // =============================================================
    // 2. REM-P1-02: CSRF Validation on Mutating Requests
    // =============================================================
    console.log('\n--- BLOCK 2: REM-P1-02 Strict CSRF Origin/Referer Validation ---');

    // Create a new fresh token for owner
    const freshOwnerToken = signAuthToken({
      sub: tenant1.userId,
      id: tenant1.userId,
      email: 'owner1@salonpro.test',
      name: 'Propietario Uno',
      role: 'propietario',
      tenantId: tenant1.tenantId,
      branchId: tenant1.branchId,
      sessionId: 4001,
      tokenVersion: 1
    });

    // 2.1 Mutating POST with cookie but NO Origin and NO Referer -> 403 CSRF_ORIGIN_REQUIRED
    const res21 = await testApp.request({
      method: 'POST',
      path: '/api/appointments',
      headers: {
        'Cookie': `auth_token=${freshOwnerToken}`,
        'Content-Type': 'application/json'
      },
      body: { title: 'Cita Test' }
    });
    assert.strictEqual(res21.status, 403, 'POST con cookie sin Origin ni Referer debe ser bloqueado con 403');
    assert.strictEqual(res21.body.code, 'CSRF_ORIGIN_REQUIRED');
    pass('REM-P1-02: Mutating request con cookie sin Origin ni Referer es bloqueado (403 CSRF_ORIGIN_REQUIRED)');

    // 2.2 Mutating POST with unauthorized external origin -> 403 CSRF_ORIGIN_DENIED
    const res22 = await testApp.request({
      method: 'POST',
      path: '/api/appointments',
      headers: {
        'Cookie': `auth_token=${freshOwnerToken}`,
        'Origin': 'https://evil-attacker-site.com',
        'Content-Type': 'application/json'
      },
      body: { title: 'Cita Test' }
    });
    assert.strictEqual(res22.status, 403, 'POST con origen externo no autorizado debe ser bloqueado con 403');
    assert.strictEqual(res22.body.code, 'CSRF_ORIGIN_DENIED');
    pass('REM-P1-02: Mutating request con Origin no autorizado es rechazado (403 CSRF_ORIGIN_DENIED)');

    // 2.3 Mutating POST with valid loopback Origin passes CSRF
    const res23 = await testApp.request({
      method: 'POST',
      path: '/api/appointments',
      headers: {
        'Cookie': `auth_token=${freshOwnerToken}`,
        'Origin': 'http://localhost:5173',
        'Content-Type': 'application/json'
      },
      body: { title: 'Cita Test' }
    });
    // Request passed CSRF check (even if validation of appointment body fails or succeeds)
    assert.notStrictEqual(res23.body.code, 'CSRF_ORIGIN_REQUIRED');
    assert.notStrictEqual(res23.body.code, 'CSRF_ORIGIN_DENIED');
    pass('REM-P1-02: Mutating request con Origin local autorizado supera la validación CSRF');

    // =============================================================
    // 3. REM-P1-03: Rate Limiting on Client Login & Password Recovery
    // =============================================================
    console.log('\n--- BLOCK 3: REM-P1-03 Strict Rate Limiting ---');

    // Trigger consecutive requests with x-test-rate-limit: force to hit rate limiter
    let hitRateLimit = false;
    for (let i = 0; i < 12; i++) {
      const resRate = await testApp.request({
        method: 'POST',
        path: '/api/auth/client-login',
        headers: {
          'x-test-rate-limit': 'force',
          'Content-Type': 'application/json'
        },
        body: { email: 'client1@gmail.com', password: 'wrongpassword' }
      });
      if (resRate.status === 429) {
        hitRateLimit = true;
        break;
      }
    }
    assert.strictEqual(hitRateLimit, true, 'Intentos reiterados deben activar 429 Too Many Requests');
    pass('REM-P1-03: Ráfaga de intentos en login de clientes activa 429 Too Many Requests');

    // =============================================================
    // 4. REM-P1-04: Protection of /api/contact-messages
    // =============================================================
    console.log('\n--- BLOCK 4: REM-P1-04 Contact Messages Security ---');

    // 4.1 Unauthenticated GET /api/contact-messages -> 401
    const res41 = await testApp.request({
      method: 'GET',
      path: '/api/contact-messages'
    });
    assert.strictEqual(res41.status, 401, 'GET sin token a /api/contact-messages debe retornar 401');
    pass('REM-P1-04: GET /api/contact-messages sin autenticación es rechazado (401 AUTH_REQUIRED)');

    // 4.2 Tenant Owner GET /api/contact-messages -> 403 (Control plane required)
    const res42 = await testApp.request({
      method: 'GET',
      path: '/api/contact-messages',
      headers: tenant1.headers
    });
    if (res42.status !== 403) {
      console.log('DEBUG RES42:', res42.status, res42.body);
    }
    assert.strictEqual(res42.status, 403, 'GET por usuario de tenant debe retornar 403');
    pass('REM-P1-04: GET /api/contact-messages por rol de salón es denegado (403 CONTROL_PLANE_ROLE_REQUIRED)');

    // 4.3 SuperAdmin GET /api/contact-messages -> 200 OK
    const res43 = await testApp.request({
      method: 'GET',
      path: '/api/contact-messages',
      headers: superAdmin.headers
    });
    assert.strictEqual(res43.status, 200, 'GET por SuperAdmin debe retornar 200 OK');
    pass('REM-P1-04: GET /api/contact-messages por SuperAdmin es aceptado (200 OK)');

    // =============================================================
    // 5. REM-P1-05: Block B2C Client Role on Staff/Cash Routes
    // =============================================================
    console.log('\n--- BLOCK 5: REM-P1-05 Block B2C Clients from Staff Routes ---');

    // 5.1 Client token accessing /api/cash-registers -> 403 CLIENT_ROLE_FORBIDDEN
    const res51 = await testApp.request({
      method: 'GET',
      path: '/api/cash-registers/active',
      headers: { 'Authorization': `Bearer ${clientToken}` }
    });
    assert.strictEqual(res51.status, 403, 'Cliente accediendo a cajas debe ser rechazado con 403');
    assert.strictEqual(res51.body.code, 'CLIENT_ROLE_FORBIDDEN');
    pass('REM-P1-05: Cliente B2C intentando acceder a /api/cash-registers es bloqueado (403 CLIENT_ROLE_FORBIDDEN)');

    // 5.2 Client token accessing /api/payroll -> 403 CLIENT_ROLE_FORBIDDEN
    const res52 = await testApp.request({
      method: 'GET',
      path: '/api/payroll/summary',
      headers: { 'Authorization': `Bearer ${clientToken}` }
    });
    assert.strictEqual(res52.status, 403, 'Cliente accediendo a nómina debe ser rechazado con 403');
    assert.strictEqual(res52.body.code, 'CLIENT_ROLE_FORBIDDEN');
    pass('REM-P1-05: Cliente B2C intentando acceder a /api/payroll es bloqueado (403 CLIENT_ROLE_FORBIDDEN)');

    // =============================================================
    // 6. REM-P1-06: Supervisor PIN on Invoice Void
    // =============================================================
    console.log('\n--- BLOCK 6: REM-P1-06 Supervisor PIN on Invoice Void ---');

    // Seed a visit for voiding test
    const visitId = 999;
    testApp.dbMock.tables.visits.push({
      id: visitId,
      tenant_id: tenant1.tenantId,
      status: 'Facturado',
      total: 1500,
      payment_method: 'Efectivo',
      cash_register_id: null
    });

    // Create fresh cashier token for tenant 1
    const freshCashierToken = signAuthToken({
      sub: 202,
      id: 202,
      email: 'cajero2@salonpro.test',
      name: 'Cajero Secundario',
      role: 'cajero',
      tenantId: tenant1.tenantId,
      branchId: tenant1.branchId,
      sessionId: 2002,
      tokenVersion: 1
    });
    testApp.dbMock.tables.users.push({
      id: 202,
      tenant_id: tenant1.tenantId,
      email: 'cajero2@salonpro.test',
      name: 'Cajero Secundario',
      role: 'cajero',
      is_active: 1,
      token_version: 1
    });
    testApp.dbMock.tables.user_sessions.push({ id: 2002, user_id: 202, role: 'cajero', tenant_id: tenant1.tenantId, is_active: 1 });

    // 6.1 Cashier attempts void without PIN -> 403 SUPERVISOR_PIN_REQUIRED
    const res61 = await testApp.request({
      method: 'POST',
      path: `/api/visits/${visitId}/void`,
      headers: {
        'Authorization': `Bearer ${freshCashierToken}`,
        'Content-Type': 'application/json'
      },
      body: { reason: 'Error en cobro' }
    });
    assert.strictEqual(res61.status, 403, 'Anulación sin PIN por cajero debe ser 403');
    assert.strictEqual(res61.body.code, 'SUPERVISOR_PIN_REQUIRED');
    pass('REM-P1-06: Cajero intentando anular factura sin PIN es rechazado (403 SUPERVISOR_PIN_REQUIRED)');

    // 6.2 Cashier attempts void with INVALID PIN -> 401 INVALID_ADMIN_PIN
    const res62 = await testApp.request({
      method: 'POST',
      path: `/api/visits/${visitId}/void`,
      headers: {
        'Authorization': `Bearer ${freshCashierToken}`,
        'Content-Type': 'application/json'
      },
      body: { reason: 'Error en cobro', admin_pin: '0000' }
    });
    assert.strictEqual(res62.status, 401, 'Anulación con PIN inválido debe ser 401');
    assert.strictEqual(res62.body.code, 'INVALID_ADMIN_PIN');
    pass('REM-P1-06: Cajero intentando anular con PIN erróneo es rechazado (401 INVALID_ADMIN_PIN)');

    // 6.3 Cashier attempts void with VALID PIN ('9821') -> 200 OK
    const res63 = await testApp.request({
      method: 'POST',
      path: `/api/visits/${visitId}/void`,
      headers: {
        'Authorization': `Bearer ${freshCashierToken}`,
        'Content-Type': 'application/json'
      },
      body: { reason: 'Error en cobro', admin_pin: '9821' }
    });
    assert.strictEqual(res63.status, 200, 'Anulación con PIN válido debe retornar 200');
    assert.strictEqual(res63.body.success, true);
    pass('REM-P1-06: Cajero con PIN administrativo válido anula factura exitosamente (200 OK)');

    // =============================================================
    // 7. REM-P1-08: Cash Register Operator Enforced from req.auth
    // =============================================================
    console.log('\n--- BLOCK 7: REM-P1-08 Operator Binding from req.auth ---');

    // 7.1 Open cash register with spoofed opened_by
    const res71 = await testApp.request({
      method: 'POST',
      path: '/api/cash-registers/open',
      headers: {
        'Authorization': `Bearer ${freshCashierToken}`,
        'Content-Type': 'application/json'
      },
      body: {
        salon_id: 1,
        opening_balance: 3000,
        opened_by: 'NOMBRE_SUPLANTADO_FRAUDULENTO'
      }
    });
    assert.strictEqual(res71.status, 200, 'Apertura de caja debe responder 200');
    const createdRegister = testApp.dbMock.tables.cash_registers.find(cr => cr.tenant_id === tenant1.tenantId && cr.status === 'Abierta');
    assert.ok(createdRegister, 'La caja debe estar registrada');
    assert.strictEqual(createdRegister.opened_by_name, 'Cajero Secundario', 'opened_by_name debe coincidir con req.auth.name y nunca con el body suplantado');
    pass('REM-P1-08: Apertura de caja vincula opened_by_name a req.auth ignorando valores suplantados');

    // 7.2 Close cash register with spoofed closed_by
    const res72 = await testApp.request({
      method: 'POST',
      path: `/api/cash-registers/${createdRegister.id}/close`,
      headers: {
        'Authorization': `Bearer ${freshCashierToken}`,
        'Content-Type': 'application/json'
      },
      body: {
        closing_balance: 3000,
        closed_by: 'OTRO_NOMBRE_FALSO'
      }
    });
    assert.strictEqual(res72.status, 200, 'Cierre de caja debe responder 200');
    const closedRegister = testApp.dbMock.tables.cash_registers.find(cr => cr.id === createdRegister.id);
    assert.strictEqual(closedRegister.closed_by, 'Cajero Secundario', 'closed_by debe coincidir con req.auth.name');
    pass('REM-P1-08: Cierre de caja vincula closed_by a req.auth ignorando valores suplantados');

    // =============================================================
    // 8. REM-P1-09: x-cron-secret on Birthday Discounts Trigger
    // =============================================================
    console.log('\n--- BLOCK 8: REM-P1-09 x-cron-secret Enforcement ---');

    // 8.1 Birthday cron trigger without secret -> 401 CRON_UNAUTHORIZED
    const res81 = await testApp.request({
      method: 'POST',
      path: '/api/marketing/send-daily-birthdays'
    });
    assert.strictEqual(res81.status, 401, 'Cron sin secreto debe retornar 401');
    assert.strictEqual(res81.body.code, 'CRON_UNAUTHORIZED');
    pass('REM-P1-09: Disparador de cumpleaños sin cabecera x-cron-secret es rechazado (401 CRON_UNAUTHORIZED)');

    // 8.2 Birthday cron trigger with invalid secret -> 401 CRON_UNAUTHORIZED
    const res82 = await testApp.request({
      method: 'POST',
      path: '/api/marketing/send-daily-birthdays',
      headers: { 'x-cron-secret': 'invalid-secret-key' }
    });
    assert.strictEqual(res82.status, 401, 'Cron con secreto inválido debe retornar 401');
    pass('REM-P1-09: Disparador de cumpleaños con x-cron-secret inválido es rechazado (401 CRON_UNAUTHORIZED)');

    // 8.3 Birthday cron trigger with valid secret -> 200 OK
    const res83 = await testApp.request({
      method: 'POST',
      path: '/api/marketing/send-daily-birthdays',
      headers: { 'x-cron-secret': process.env.CRON_SECRET }
    });
    assert.strictEqual(res83.status, 200, 'Cron con secreto válido debe retornar 200');
    assert.strictEqual(res83.body.success, true);
    pass('REM-P1-09: Disparador de cumpleaños con x-cron-secret válido ejecuta exitosamente (200 OK)');

    // =============================================================
    // 9. REM-P1-13: Global 500 Error Handler & Sanitization
    // =============================================================
    console.log('\n--- BLOCK 9: REM-P1-13 Global 500 Sanitization & Correlation ID ---');

    // Request the test simulation route mounted through the app router
    const res91 = await testApp.request({
      method: 'GET',
      path: '/api/test/simulate-500',
      headers: tenant1.headers
    });
    assert.strictEqual(res91.status, 500, 'Error interno debe ser 500');
    assert.strictEqual(res91.body.success, false);
    assert.strictEqual(res91.body.error, 'Ocurrió un error interno en el servidor.', 'Mensaje 500 debe ser sanitizado');
    assert.ok(res91.body.error_id, 'Debe incluir un identificador de correlación error_id');
    assert.strictEqual(res91.body.code, 'INTERNAL_SERVER_ERROR');
    // Ensure sensitive details are NOT in the body
    assert.ok(!JSON.stringify(res91.body).includes('sensitive_financial_table'), 'No debe filtrar consultas SQL ni detalles sensibles');
    pass('REM-P1-13: Error handler global sanitiza respuestas 500 y emite error_id de correlación sin fugar detalles');

    console.log(`\n=============================================================`);
    console.log(`✅ ALL ${passedTests} PHASE 2H-C P1 SECURITY TESTS PASSED`);
    console.log(`=============================================================\n`);

    return { success: true, passedTests };
  } finally {
    await testApp.close();
  }
}

if (require.main === module) {
  runPhase2hP1SecuritySuite()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n❌ [PHASE 2H-C TEST FAILURE]:', err);
      process.exit(1);
    });
}

module.exports = { runPhase2hP1SecuritySuite };
