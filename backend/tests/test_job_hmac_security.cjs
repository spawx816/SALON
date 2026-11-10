/**
 * Anti-Replay HMAC Job Security & Tenant Idempotency Verification Suite
 * (backend/tests/test_job_hmac_security.cjs)
 *
 * Verifies:
 * 1. Firma válida (200 OK)
 * 2. Firma inválida (401 INVALID_JOB_SIGNATURE)
 * 3. Request expirado (> 5 mins -> 401 JOB_REQUEST_EXPIRED)
 * 4. Nonce repetido (401 NONCE_ALREADY_USED)
 * 5. Body alterado (401 INVALID_JOB_SIGNATURE)
 * 6. Path alterado (401 INVALID_JOB_SIGNATURE)
 * 7. Replay exacto (401 NONCE_ALREADY_USED)
 * 8. Ejecución duplicada (Idempotencia por tenant, fecha y tipo de job)
 * 9. Secreto ausente o inseguro (403 CRON_SECRET_UNCONFIGURED)
 * 10. Aislamiento estricto entre tenants (Tenant A completado no bloquea a Tenant B)
 *
 * Persistencia verificada realmente en base de datos PostgreSQL (salon_saas_test).
 */

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { Pool } = require('pg');
const {
  createJobHmacAuthMiddleware,
  computeJobSignature,
  generateJobAuthHeaders,
  checkJobIdempotency,
  recordJobExecution
} = require('../middleware/job_hmac_auth.middleware.cjs');

async function runJobHmacSuite() {
  console.log('========================================================================');
  console.log('🛡️ SUITE: SEGURIDAD ANTI-REPLAY HMAC E IDEMPOTENCIA DE JOBS (FASE 3B.0.1)');
  console.log('========================================================================\n');

  const dbConfig = {
    host: process.env.DB_HOST || process.env.TEST_DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || process.env.TEST_DB_PORT || '5432', 10),
    user: process.env.DB_USER || process.env.TEST_DB_USER || 'salon_saas_test_user',
    password: process.env.DB_PASS || process.env.TEST_DB_PASSWORD || 'test_password',
    database: process.env.DB_NAME || process.env.TEST_DB_NAME || 'salon_saas_test'
  };

  const pool = new Pool(dbConfig);
  let passedCount = 0;

  function pass(desc) {
    passedCount++;
    console.log(`  ✅ [PASS ${passedCount}] ${desc}`);
  }

  try {
    const testSecret = 'super_secure_cron_secret_test_32chars_ok';
    process.env.CRON_SECRET = testSecret;

    const middleware = createJobHmacAuthMiddleware(pool);

    // Mock Express Request & Response helper
    function createMockExchange({ method = 'POST', path = '/api/marketing/send-daily-birthdays', headers = {}, body = {} } = {}) {
      const req = {
        method,
        path,
        originalUrl: path,
        headers: { ...headers },
        body
      };
      let status = 200;
      let responseBody = null;
      let nextCalled = false;

      const res = {
        status(s) {
          status = s;
          return res;
        },
        json(b) {
          responseBody = b;
          return res;
        }
      };

      const next = () => { nextCalled = true; };

      return { req, res, next, getResult: () => ({ status, body: responseBody, nextCalled }) };
    }

    // 1. Firma válida
    console.log('--- TEST 1: Firma HMAC Válida ---');
    const nonce1 = crypto.randomBytes(16).toString('hex');
    const ts1 = String(Date.now());
    const body1 = { mode: 'all' };
    const sig1 = computeJobSignature({
      method: 'POST',
      path: '/api/marketing/send-daily-birthdays',
      timestamp: ts1,
      nonce: nonce1,
      body: body1,
      secret: testSecret
    });

    const ex1 = createMockExchange({
      headers: {
        'x-job-timestamp': ts1,
        'x-job-nonce': nonce1,
        'x-job-signature': sig1
      },
      body: body1
    });
    await middleware(ex1.req, ex1.res, ex1.next);
    assert.strictEqual(ex1.getResult().nextCalled, true, 'Next debe ser llamado con firma válida');
    assert.strictEqual(ex1.req.jobAuth.nonce, nonce1);
    pass('Firma HMAC válida es aceptada y adjunta metadatos al request');

    // 2. Firma inválida
    console.log('\n--- TEST 2: Firma HMAC Inválida ---');
    const nonce2 = crypto.randomBytes(16).toString('hex');
    const ex2 = createMockExchange({
      headers: {
        'x-job-timestamp': String(Date.now()),
        'x-job-nonce': nonce2,
        'x-job-signature': '0000111122223333444455556666777788889999aaaabbbbccccddddeeeeffff'
      },
      body: body1
    });
    await middleware(ex2.req, ex2.res, ex2.next);
    assert.strictEqual(ex2.getResult().nextCalled, false);
    assert.strictEqual(ex2.getResult().status, 401);
    assert.strictEqual(ex2.getResult().body.code, 'INVALID_JOB_SIGNATURE');
    pass('Firma HMAC alterada/falsa es rechazada con 401 INVALID_JOB_SIGNATURE');

    // 3. Request expirado (> 5 minutos)
    console.log('\n--- TEST 3: Request Expirado (> 5 minutos) ---');
    const expiredTs = String(Date.now() - 6 * 60 * 1000); // 6 mins in past
    const nonce3 = crypto.randomBytes(16).toString('hex');
    const sig3 = computeJobSignature({
      method: 'POST',
      path: '/api/marketing/send-daily-birthdays',
      timestamp: expiredTs,
      nonce: nonce3,
      body: body1,
      secret: testSecret
    });

    const ex3 = createMockExchange({
      headers: {
        'x-job-timestamp': expiredTs,
        'x-job-nonce': nonce3,
        'x-job-signature': sig3
      },
      body: body1
    });
    await middleware(ex3.req, ex3.res, ex3.next);
    assert.strictEqual(ex3.getResult().nextCalled, false);
    assert.strictEqual(ex3.getResult().status, 401);
    assert.strictEqual(ex3.getResult().body.code, 'JOB_REQUEST_EXPIRED');
    pass('Petición fuera de la ventana de 5 minutos es rechazada con 401 JOB_REQUEST_EXPIRED');

    // 4. Nonce repetido (Ataque de replay)
    console.log('\n--- TEST 4: Nonce Repetido (Replay Attack) ---');
    // We already used nonce1 in test 1! Attempting to reuse nonce1 with fresh timestamp:
    const freshTs = String(Date.now());
    const sig4 = computeJobSignature({
      method: 'POST',
      path: '/api/marketing/send-daily-birthdays',
      timestamp: freshTs,
      nonce: nonce1, // REPEATED NONCE
      body: body1,
      secret: testSecret
    });

    const ex4 = createMockExchange({
      headers: {
        'x-job-timestamp': freshTs,
        'x-job-nonce': nonce1,
        'x-job-signature': sig4
      },
      body: body1
    });
    await middleware(ex4.req, ex4.res, ex4.next);
    assert.strictEqual(ex4.getResult().nextCalled, false);
    assert.strictEqual(ex4.getResult().status, 401);
    assert.strictEqual(ex4.getResult().body.code, 'NONCE_ALREADY_USED');
    pass('Intento de reutilizar un nonce previo es detectado y bloqueado (401 NONCE_ALREADY_USED)');

    // 5. Body alterado (Tampering)
    console.log('\n--- TEST 5: Body Alterado tras la firma ---');
    const nonce5 = crypto.randomBytes(16).toString('hex');
    const ts5 = String(Date.now());
    const sig5 = computeJobSignature({
      method: 'POST',
      path: '/api/marketing/send-daily-birthdays',
      timestamp: ts5,
      nonce: nonce5,
      body: { original_key: 'authentic' },
      secret: testSecret
    });

    const ex5 = createMockExchange({
      headers: {
        'x-job-timestamp': ts5,
        'x-job-nonce': nonce5,
        'x-job-signature': sig5
      },
      body: { original_key: 'tampered_malicious_payload' } // TAMPERED BODY
    });
    await middleware(ex5.req, ex5.res, ex5.next);
    assert.strictEqual(ex5.getResult().nextCalled, false);
    assert.strictEqual(ex5.getResult().status, 401);
    assert.strictEqual(ex5.getResult().body.code, 'INVALID_JOB_SIGNATURE');
    pass('Alteración de contenido del body invalida la firma criptográfica (401 INVALID_JOB_SIGNATURE)');

    // 6. Path alterado
    console.log('\n--- TEST 6: Path Alterado tras la firma ---');
    const nonce6 = crypto.randomBytes(16).toString('hex');
    const ts6 = String(Date.now());
    const sig6 = computeJobSignature({
      method: 'POST',
      path: '/api/marketing/send-daily-birthdays',
      timestamp: ts6,
      nonce: nonce6,
      body: body1,
      secret: testSecret
    });

    const ex6 = createMockExchange({
      method: 'POST',
      path: '/api/marketing/tampered-target-path', // TAMPERED PATH
      headers: {
        'x-job-timestamp': ts6,
        'x-job-nonce': nonce6,
        'x-job-signature': sig6
      },
      body: body1
    });
    await middleware(ex6.req, ex6.res, ex6.next);
    assert.strictEqual(ex6.getResult().nextCalled, false);
    assert.strictEqual(ex6.getResult().status, 401);
    assert.strictEqual(ex6.getResult().body.code, 'INVALID_JOB_SIGNATURE');
    pass('Alteración de la ruta HTTP objetivo invalida la firma canónica (401 INVALID_JOB_SIGNATURE)');

    // 7. Replay exacto (Mismos headers, mismo body, segundo intento idéntico)
    console.log('\n--- TEST 7: Replay Exacto Idéntico ---');
    const nonce7 = crypto.randomBytes(16).toString('hex');
    const ts7 = String(Date.now());
    const sig7 = computeJobSignature({
      method: 'POST',
      path: '/api/marketing/send-daily-birthdays',
      timestamp: ts7,
      nonce: nonce7,
      body: body1,
      secret: testSecret
    });

    // First attempt: succeeds
    const ex7First = createMockExchange({
      headers: { 'x-job-timestamp': ts7, 'x-job-nonce': nonce7, 'x-job-signature': sig7 },
      body: body1
    });
    await middleware(ex7First.req, ex7First.res, ex7First.next);
    assert.strictEqual(ex7First.getResult().nextCalled, true, 'Primer intento debe superar middleware');

    // Second identical attempt (exact replay)
    const ex7Replay = createMockExchange({
      headers: { 'x-job-timestamp': ts7, 'x-job-nonce': nonce7, 'x-job-signature': sig7 },
      body: body1
    });
    await middleware(ex7Replay.req, ex7Replay.res, ex7Replay.next);
    assert.strictEqual(ex7Replay.getResult().nextCalled, false, 'Replay exacto no debe llamar next');
    assert.strictEqual(ex7Replay.getResult().status, 401);
    assert.strictEqual(ex7Replay.getResult().body.code, 'NONCE_ALREADY_USED');
    pass('Replay idéntico exacto es abortado en la validación del nonce persistido (401 NONCE_ALREADY_USED)');

    // 8. Secreto ausente o inseguro
    console.log('\n--- TEST 8: Secreto Ausente / Inseguro ---');
    const oldSecret = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    delete process.env.JOB_SIGNATURE_SECRET;

    const ex8 = createMockExchange({
      headers: {
        'x-job-timestamp': String(Date.now()),
        'x-job-nonce': crypto.randomBytes(16).toString('hex'),
        'x-job-signature': 'any-sig'
      }
    });
    await middleware(ex8.req, ex8.res, ex8.next);
    assert.strictEqual(ex8.getResult().nextCalled, false);
    assert.strictEqual(ex8.getResult().status, 403);
    assert.strictEqual(ex8.getResult().body.code, 'CRON_SECRET_UNCONFIGURED');
    pass('Ausencia de secreto configurado en servidor rechaza de forma fail-closed (403 CRON_SECRET_UNCONFIGURED)');

    process.env.CRON_SECRET = oldSecret;

    // 9. Idempotencia de Ejecución por Tenant, Fecha y Tipo de Job
    console.log('\n--- TEST 9: Idempotencia de Ejecución de Job por Tenant y Fecha ---');
    const tenantA = '11111111-1111-4111-8111-111111111111';
    const testDate = '2026-11-10';
    const jobType = 'daily_birthdays';

    // Verify initial state: not executed
    const isInitA = await checkJobIdempotency(pool, { tenantId: tenantA, jobType, date: testDate });
    assert.strictEqual(isInitA, false, 'Tenant A no debe registrar ejecución inicial previa');

    // Record execution for Tenant A
    await recordJobExecution(pool, {
      tenantId: tenantA,
      jobType,
      date: testDate,
      metadata: { sent: 5, clientIds: ['c1', 'c2'] }
    });

    // Check idempotency again: must report executed
    const isAfterA = await checkJobIdempotency(pool, { tenantId: tenantA, jobType, date: testDate });
    assert.strictEqual(isAfterA, true, 'Tenant A debe reportar ejecución registrada');
    pass('Registro de idempotencia previene ejecuciones duplicadas para el mismo tenant y fecha');

    // 10. Aislamiento Estricto entre Tenants
    console.log('\n--- TEST 10: Aislamiento Estricto entre Tenants ---');
    const tenantB = '22222222-2222-4222-8222-222222222222';

    // Verify Tenant B on the same date is NOT blocked by Tenant A's execution
    const isInitB = await checkJobIdempotency(pool, { tenantId: tenantB, jobType, date: testDate });
    assert.strictEqual(isInitB, false, 'Tenant B debe estar pendiente de ejecución a pesar de que Tenant A ya ejecutó');

    // Record Tenant B execution
    await recordJobExecution(pool, {
      tenantId: tenantB,
      jobType,
      date: testDate,
      metadata: { sent: 3 }
    });

    const isAfterB = await checkJobIdempotency(pool, { tenantId: tenantB, jobType, date: testDate });
    assert.strictEqual(isAfterB, true, 'Tenant B ahora registra ejecución completada');

    // Re-verify Tenant A remains unaffected
    const checkAStillTrue = await checkJobIdempotency(pool, { tenantId: tenantA, jobType, date: testDate });
    assert.strictEqual(checkAStillTrue, true, 'Tenant A mantiene su registro independiente');
    pass('Aislamiento multi-tenant verificado: ejecuciones entre inquilinos no interfieren entre sí');

    console.log('\n========================================================================');
    console.log(`🎉 TODAS LAS ${passedCount} PRUEBAS DE SEGURIDAD ANTI-REPLAY HMAC PASARON (PASS)`);
    console.log('========================================================================\n');

    process.exit(0);
  } catch (err) {
    console.error('\n❌ FALLO EN SUITE DE SEGURIDAD ANTI-REPLAY:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runJobHmacSuite();
}

module.exports = { runJobHmacSuite };
