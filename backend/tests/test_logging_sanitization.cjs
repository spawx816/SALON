/**
 * Quality Gate: Structured JSON Logging & PII Sanitization (REM-P2-04, REM-P3-03 & Addendum 6)
 * (backend/tests/test_logging_sanitization.cjs)
 */

'use strict';

const assert = require('assert');
const { JsonLogger, sanitizePayload, maskEmail, maskPhone, maskCedula } = require('../utils/logger');

async function runLoggingSanitizationTests() {
  console.log('========================================================================');
  console.log('🛡️ SUITE: LOGGING JSON Y SANITIZACIÓN DE PII / SECRETOS (REM-P2-04/P3-03)');
  console.log('========================================================================\n');

  // --- TEST 1: Enmascaramiento de PII personal individual ---
  console.log('--- TEST 1: Enmascaramiento de correo, teléfono y cédula ---');
  const maskedEmail = maskEmail('maria.gonzalez@example.com');
  assert.strictEqual(maskedEmail, 'm***z@example.com');

  const maskedPhone = maskPhone('809-555-1234');
  assert.strictEqual(maskedPhone, '***-***-1234');

  const maskedCedula = maskCedula('402-1234567-8');
  assert.strictEqual(maskedCedula, '***-*****67-8');
  console.log('  ✅ [PASS 1] Funciones de enmascaramiento de PII validadas');

  // --- TEST 2: Sanitización de campos prohibidos (Secretos, PINs, Tarjetas, Firmas) ---
  console.log('\n--- TEST 2: Redacción profunda de contraseñas, PINs, CVV y tokens ---');
  const sensitivePayload = {
    user_id: '11111111-2222-3333-4444-555555555555',
    password: 'SuperSecretPassword123!',
    pin: '849201',
    supervisor_pin: '123456',
    card_number: '4532117182910293',
    cvv: '992',
    token: 'jwt.token.string',
    cookie: 'session_id=abcdef',
    authorization: 'Bearer eyJhbGciOiJIUzI1Ni...',
    signature_data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...',
    nested: {
      client_email: 'cliente@gmail.com',
      client_phone: '8294445566',
      secret: 'very_secret_api_key'
    }
  };

  const safe = sanitizePayload(sensitivePayload);
  assert.strictEqual(safe.password, '[REDACTED_SECRET]');
  assert.strictEqual(safe.pin, '[REDACTED_SECRET]');
  assert.strictEqual(safe.supervisor_pin, '[REDACTED_SECRET]');
  assert.strictEqual(safe.card_number, '[REDACTED_SECRET]');
  assert.strictEqual(safe.cvv, '[REDACTED_SECRET]');
  assert.strictEqual(safe.token, '[REDACTED_SECRET]');
  assert.strictEqual(safe.cookie, '[REDACTED_SECRET]');
  assert.strictEqual(safe.authorization, '[REDACTED_SECRET]');
  assert.strictEqual(safe.signature_data, '[REDACTED_SECRET]');
  assert.strictEqual(safe.nested.secret, '[REDACTED_SECRET]');
  assert.strictEqual(safe.nested.client_email, 'c***e@gmail.com');
  assert.strictEqual(safe.nested.client_phone, '***-***-5566');
  console.log('  ✅ [PASS 2] Todos los secretos y campos sensibles fueron redactados');

  // --- TEST 3: Preservación de nombres operativos legítimos (Addendum 6) ---
  console.log('\n--- TEST 3: Preservación de campos operativos no sensibles (Addendum 6) ---');
  const operationalData = {
    service_name: 'Lavado y Secado Estilo Libre',
    salon_name: 'Sede Central Bella Vista',
    branch_name: 'Sucursal Piantini',
    category_name: 'Peluquería',
    role: 'cajero',
    event_name: 'INVOICE_GENERATED'
  };

  const safeOperational = sanitizePayload(operationalData);
  assert.strictEqual(safeOperational.service_name, 'Lavado y Secado Estilo Libre');
  assert.strictEqual(safeOperational.salon_name, 'Sede Central Bella Vista');
  assert.strictEqual(safeOperational.branch_name, 'Sucursal Piantini');
  assert.strictEqual(safeOperational.category_name, 'Peluquería');
  assert.strictEqual(safeOperational.role, 'cajero');
  assert.strictEqual(safeOperational.event_name, 'INVOICE_GENERATED');
  console.log('  ✅ [PASS 3] Nombres operativos y metadatos preservados sin redacción destructiva');

  // --- TEST 4: Estructura JSON estandarizada del Logger ---
  console.log('\n--- TEST 4: Emisión de logs en formato JSON estructurado ---');
  const capturedLogs = [];
  const testLogger = new JsonLogger({
    service: 'salonpro-api',
    env: 'test',
    output: (serialized) => capturedLogs.push(serialized)
  });

  testLogger.info('TEST_AUDIT_EVENT', {
    correlation_id: 'aaaa1111-bbbb-cccc-dddd-eeee22223333',
    tenant_id: 'tenant-uuid-1',
    actor_id: 'user-uuid-2',
    action: 'VISIT_PROCESSED',
    total_cents: 60000,
    service_name: 'Lavado Sencillo',
    client_email: 'cliente_vip@gmail.com'
  });

  assert.strictEqual(capturedLogs.length, 1);
  const parsedLog = JSON.parse(capturedLogs[0]);

  assert.ok(parsedLog.timestamp, 'Debe contener timestamp UTC');
  assert.strictEqual(parsedLog.level, 'info');
  assert.strictEqual(parsedLog.service, 'salonpro-api');
  assert.strictEqual(parsedLog.env, 'test');
  assert.strictEqual(parsedLog.correlation_id, 'aaaa1111-bbbb-cccc-dddd-eeee22223333');
  assert.strictEqual(parsedLog.tenant_id, 'tenant-uuid-1');
  assert.strictEqual(parsedLog.actor_id, 'user-uuid-2');
  assert.strictEqual(parsedLog.event, 'TEST_AUDIT_EVENT');
  assert.strictEqual(parsedLog.service_name, 'Lavado Sencillo');
  assert.strictEqual(parsedLog.client_email, 'c***p@gmail.com');

  // Negative test: verify no raw secrets present in serialized output
  assert.strictEqual(capturedLogs[0].includes('cliente_vip@gmail.com'), false);
  console.log('  ✅ [PASS 4] Log estructurado en JSON con correlación, tenant y PII enmascarada');

  console.log('\n========================================================================');
  console.log('🎉 TODAS LAS PRUEBAS DE LOGGING Y SANITIZACIÓN PASARON (PASS)');
  console.log('========================================================================\n');
}

if (require.main === module) {
  runLoggingSanitizationTests().catch(err => {
    console.error('\n❌ [FAIL] Error en pruebas de logging:', err);
    process.exit(1);
  });
}

module.exports = { runLoggingSanitizationTests };
