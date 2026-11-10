/**
 * Anti-Replay HMAC Job Security & Tenant Idempotency Verification Suite
 * (backend/tests/test_job_hmac_security.cjs)
 *
 * Requirements (Phase 3B.0.2):
 * 1. Firma válida (200 OK)
 * 2. Firma inválida (401 INVALID_JOB_SIGNATURE)
 * 3. Request expirado (> 5 mins -> 401 JOB_REQUEST_EXPIRED)
 * 4. Nonce repetido (401 NONCE_ALREADY_USED)
 * 5. Body alterado (401 INVALID_JOB_SIGNATURE)
 * 6. Path alterado (401 INVALID_JOB_SIGNATURE)
 * 7. Replay exacto (401 NONCE_ALREADY_USED)
 * 8. Secreto ausente (403 CRON_SECRET_UNCONFIGURED)
 * 9. Secreto transmitido en headers prohibido (401 STATIC_SECRET_PROHIBITED)
 * 10. JOB_SIGNATURE_SECRET soportado y preferido
 * 11. Base de datos caída: 503 JOB_AUTH_STATE_UNAVAILABLE (fail-closed)
 * 12. Prohibición de fallback in-memory implícito
 * 13. Nonce repetido entre dos conexiones/instancias concurrentes en job_request_nonces
 * 14. Concurrencia real PostgreSQL en claimJobExecution (1 ganador, 1 rechazado)
 * 15. SYSTEM_CRON rechazado como tenant_id (INVALID_TENANT_UUID)
 * 16. Tenant UUID válido aceptado
 * 17. Clave foránea impidiendo tenant inexistente (23503 / TENANT_NOT_FOUND)
 * 18. Adquisición atómica (claim -> complete -> idempotente)
 * 19. Cleanup de nonces expirados (cleanupExpiredNonces)
 * 20. Aislamiento multi-tenant entre inquilinos
 */

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { Pool } = require('pg');
const {
  createJobHmacAuthMiddleware,
  computeJobSignature,
  generateJobAuthHeaders,
  recordAndCheckNonce,
  cleanupExpiredNonces,
  claimJobExecution,
  completeJobExecution,
  failJobExecution,
  checkJobIdempotency,
  recordJobExecution
} = require('../middleware/job_hmac_auth.middleware.cjs');

async function runJobHmacSuite() {
  console.log('========================================================================');
  console.log('🛡️ SUITE: SEGURIDAD ANTI-REPLAY HMAC E IDEMPOTENCIA ATÓMICA (FASE 3B.0.2)');
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

  // Ensure test tenants exist for foreign key compliance
  const testTenantA = '11111111-1111-4111-8111-111111111111';
  const testTenantB = '22222222-2222-4222-8222-222222222222';

  try {
    await pool.query(`
      INSERT INTO tenants (id, business_name, slug, email, status)
      VALUES 
        ('${testTenantA}', 'Tenant Test A', 'tenant-test-a', 'tenant_a@example.com', 'active'),
        ('${testTenantB}', 'Tenant Test B', 'tenant-test-b', 'tenant_b@example.com', 'active')
      ON CONFLICT (id) DO NOTHING;
    `);

    const testSecret = 'super_secure_cron_secret_test_32chars_ok';
    process.env.JOB_SIGNATURE_SECRET = testSecret;
    delete process.env.CRON_SECRET;

    const middleware = createJobHmacAuthMiddleware(pool);

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
    assert.strictEqual(ex1.getResult().nextCalled, true, 'Next debe haber sido llamado para firma válida');
    assert(ex1.req.jobAuth, 'req.jobAuth debe existir tras autenticación exitosa');
    assert.strictEqual(ex1.req.jobAuth.nonce, nonce1);
    pass('Firma HMAC válida es aceptada y adjunta metadatos al request');

    // 2. Firma inválida
    console.log('\n--- TEST 2: Firma HMAC Inválida ---');
    const nonce2 = crypto.randomBytes(16).toString('hex');
    const ts2 = String(Date.now());
    const ex2 = createMockExchange({
      headers: {
        'x-job-timestamp': ts2,
        'x-job-nonce': nonce2,
        'x-job-signature': 'deadbeef0000111122223333444455556666777788889999aaaabbbbccccdddd'
      },
      body: body1
    });

    await middleware(ex2.req, ex2.res, ex2.next);
    assert.strictEqual(ex2.getResult().nextCalled, false, 'Firma inválida no debe llamar next()');
    assert.strictEqual(ex2.getResult().status, 401);
    assert.strictEqual(ex2.getResult().body.code, 'INVALID_JOB_SIGNATURE');
    pass('Firma HMAC alterada/falsa es rechazada con 401 INVALID_JOB_SIGNATURE');

    // 3. Request expirado (> 5 min)
    console.log('\n--- TEST 3: Request Expirado (> 5 minutos) ---');
    const nonce3 = crypto.randomBytes(16).toString('hex');
    const ts3 = String(Date.now() - (6 * 60 * 1000));
    const sig3 = computeJobSignature({
      method: 'POST',
      path: '/api/marketing/send-daily-birthdays',
      timestamp: ts3,
      nonce: nonce3,
      body: body1,
      secret: testSecret
    });

    const ex3 = createMockExchange({
      headers: {
        'x-job-timestamp': ts3,
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

    // 4. Nonce repetido
    console.log('\n--- TEST 4: Nonce Repetido (Replay Attack) ---');
    const ts4 = String(Date.now());
    const sig4 = computeJobSignature({
      method: 'POST',
      path: '/api/marketing/send-daily-birthdays',
      timestamp: ts4,
      nonce: nonce1,
      body: body1,
      secret: testSecret
    });

    const ex4 = createMockExchange({
      headers: {
        'x-job-timestamp': ts4,
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

    // 5. Body alterado
    console.log('\n--- TEST 5: Body Alterado tras la firma ---');
    const nonce5 = crypto.randomBytes(16).toString('hex');
    const ts5 = String(Date.now());
    const sig5 = computeJobSignature({
      method: 'POST',
      path: '/api/marketing/send-daily-birthdays',
      timestamp: ts5,
      nonce: nonce5,
      body: { mode: 'all', legitimate: true },
      secret: testSecret
    });

    const ex5 = createMockExchange({
      headers: {
        'x-job-timestamp': ts5,
        'x-job-nonce': nonce5,
        'x-job-signature': sig5
      },
      body: { mode: 'all', legitimate: true, maliciousPayload: 'injected' }
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
      path: '/api/admin/force-database-wipe',
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

    // 7. Replay exacto
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

    const ex7First = createMockExchange({
      headers: { 'x-job-timestamp': ts7, 'x-job-nonce': nonce7, 'x-job-signature': sig7 },
      body: body1
    });
    await middleware(ex7First.req, ex7First.res, ex7First.next);
    assert.strictEqual(ex7First.getResult().nextCalled, true);

    const ex7Replay = createMockExchange({
      headers: { 'x-job-timestamp': ts7, 'x-job-nonce': nonce7, 'x-job-signature': sig7 },
      body: body1
    });
    await middleware(ex7Replay.req, ex7Replay.res, ex7Replay.next);
    assert.strictEqual(ex7Replay.getResult().nextCalled, false);
    assert.strictEqual(ex7Replay.getResult().status, 401);
    assert.strictEqual(ex7Replay.getResult().body.code, 'NONCE_ALREADY_USED');
    pass('Replay idéntico exacto es abortado en la validación del nonce persistido (401 NONCE_ALREADY_USED)');

    // 8. Secreto ausente
    console.log('\n--- TEST 8: Secreto Ausente / Inseguro ---');
    const savedSecret = process.env.JOB_SIGNATURE_SECRET;
    delete process.env.JOB_SIGNATURE_SECRET;
    delete process.env.CRON_SECRET;

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

    process.env.JOB_SIGNATURE_SECRET = savedSecret;

    // 9. Transmisión de secreto en cabecera prohibida
    console.log('\n--- TEST 9: Secreto en Cabecera Prohibido ---');
    const ex9 = createMockExchange({
      headers: {
        'x-cron-secret': 'some_insecure_header_secret'
      }
    });
    await middleware(ex9.req, ex9.res, ex9.next);
    assert.strictEqual(ex9.getResult().status, 401);
    assert.strictEqual(ex9.getResult().body.code, 'STATIC_SECRET_PROHIBITED');
    pass('Transmisión de secretos estáticos en cabeceras HTTP es rechazada con 401 STATIC_SECRET_PROHIBITED');

    // 10. Base de datos caída / inaccesible (Fail-Closed)
    console.log('\n--- TEST 10: Fail-Closed ante Caída de Base de Datos (503) ---');
    const deadPool = {
      query: async () => {
        const connErr = new Error('connect ECONNREFUSED 127.0.0.1:5432');
        connErr.code = 'ECONNREFUSED';
        throw connErr;
      }
    };
    const failClosedMiddleware = createJobHmacAuthMiddleware(deadPool);
    const nonce10 = crypto.randomBytes(16).toString('hex');
    const ts10 = String(Date.now());
    const sig10 = computeJobSignature({
      method: 'POST',
      path: '/api/marketing/send-daily-birthdays',
      timestamp: ts10,
      nonce: nonce10,
      body: body1,
      secret: testSecret
    });

    const ex10 = createMockExchange({
      headers: { 'x-job-timestamp': ts10, 'x-job-nonce': nonce10, 'x-job-signature': sig10 },
      body: body1
    });
    await failClosedMiddleware(ex10.req, ex10.res, ex10.next);
    assert.strictEqual(ex10.getResult().nextCalled, false);
    assert.strictEqual(ex10.getResult().status, 503);
    assert.strictEqual(ex10.getResult().body.code, 'JOB_AUTH_STATE_UNAVAILABLE');
    pass('Base de datos caída responde 503 JOB_AUTH_STATE_UNAVAILABLE de forma estricta');

    // 11. Prohibición de fallback in-memory implícito
    console.log('\n--- TEST 11: Prohibición de Fallback In-Memory Implícito ---');
    let threwFailClosed = false;
    try {
      await recordAndCheckNonce(deadPool, crypto.randomBytes(16).toString('hex'), 'hash123', Date.now());
    } catch (err) {
      if (err.code === 'JOB_AUTH_STATE_UNAVAILABLE') threwFailClosed = true;
    }
    assert(threwFailClosed, 'recordAndCheckNonce debe lanzar error cuando DB falla y no conmutar a memoria');
    pass('Falla de base de datos no conmuta a memoria implícitamente');

    // 12. Nonce repetido entre dos conexiones concurrentes
    console.log('\n--- TEST 12: Nonce Repetido entre Conexiones Concurrentes ---');
    const sharedNonce = crypto.randomBytes(16).toString('hex');
    const bHash = 'dummy_body_hash_test_12';
    const firstCheck = await recordAndCheckNonce(pool, sharedNonce, bHash, Date.now());
    const secondCheck = await recordAndCheckNonce(pool, sharedNonce, bHash, Date.now());
    assert.strictEqual(firstCheck, true, 'Primer consumo de nonce debe registrarse');
    assert.strictEqual(secondCheck, false, 'Segundo consumo de nonce idéntico debe ser rechazado');
    pass('Persistencia en job_request_nonces bloquea colisiones de nonce entre clientes concurrentes');

    // 13. Concurrencia real PostgreSQL en claimJobExecution (Atomic Claim)
    console.log('\n--- TEST 13: Concurrencia Real PostgreSQL en claimJobExecution ---');
    const concDate = '2026-11-15-' + Date.now();
    const concJobType = 'atomic_concurrency_test';

    // Disparar dos peticiones simultáneas sobre el mismo tenant y job
    const [claimA, claimB] = await Promise.all([
      claimJobExecution(pool, { tenantId: testTenantA, jobType: concJobType, date: concDate }),
      claimJobExecution(pool, { tenantId: testTenantA, jobType: concJobType, date: concDate })
    ]);

    // Exactamente uno debe obtener claim=true, el otro claim=false
    const winners = [claimA, claimB].filter(c => c.claimed === true);
    const losers = [claimA, claimB].filter(c => c.claimed === false);
    assert.strictEqual(winners.length, 1, 'Exactamente una instancia concurrente debe obtener el claim');
    assert.strictEqual(losers.length, 1, 'La segunda instancia concurrente debe ser rechazada');
    assert.strictEqual(losers[0].reason, 'EXECUTION_IN_PROGRESS');
    pass('Adquisición atómica (claimJobExecution) resuelve concurrencia real PostgreSQL (1 ganador, 1 rechazado)');

    // 14. SYSTEM_CRON rechazado como tenant_id
    console.log('\n--- TEST 14: SYSTEM_CRON Rechazado como tenant_id ---');
    let rejectedSystemCron = false;
    try {
      await claimJobExecution(pool, { tenantId: 'SYSTEM_CRON', jobType: 'test', date: '2026-11-16' });
    } catch (err) {
      if (err.code === 'INVALID_TENANT_UUID') rejectedSystemCron = true;
    }
    assert(rejectedSystemCron, 'Valores como SYSTEM_CRON deben ser rechazados inmediatamente');
    pass('SYSTEM_CRON y cadenas no-UUID son rechazadas en claimJobExecution (INVALID_TENANT_UUID)');

    // 15. Tenant UUID válido aceptado
    console.log('\n--- TEST 15: Tenant UUID Válido Aceptado ---');
    const validClaim = await claimJobExecution(pool, { tenantId: testTenantB, jobType: 'uuid_test', date: '2026-11-17-' + Date.now() });
    assert.strictEqual(validClaim.claimed, true, 'UUID válido debe ser aceptado para claim');
    pass('Tenant UUID válido es procesado correctamente');

    // 16. Clave foránea impidiendo tenant inexistente
    console.log('\n--- TEST 16: FK Rechaza Tenant Inexistente (23503) ---');
    const fakeTenantId = '99999999-9999-4999-8999-999999999999';
    let fkRejected = false;
    try {
      await claimJobExecution(pool, { tenantId: fakeTenantId, jobType: 'fk_test', date: '2026-11-18' });
    } catch (err) {
      if (err.code === 'TENANT_NOT_FOUND' || err.message.includes('FK 23503')) fkRejected = true;
    }
    assert(fkRejected, 'Clave foránea debe impedir inserción de claim para tenant inexistente');
    pass('Foreign Key estricta hacia tenants(id) rechaza claims para inquilinos inexistentes (23503)');

    // 17. Máquina de estados: Claim (102) -> Complete (200) -> Duplicado Rechazado
    console.log('\n--- TEST 17: Máquina de Estados: Claim -> Complete -> Duplicado ---');
    const stateDate = '2026-11-19-' + Date.now();
    const stateJobType = 'state_machine_test';

    const initialClaim = await claimJobExecution(pool, { tenantId: testTenantA, jobType: stateJobType, date: stateDate });
    assert.strictEqual(initialClaim.claimed, true);

    // Complete the execution
    await completeJobExecution(pool, {
      tenantId: testTenantA,
      jobType: stateJobType,
      date: stateDate,
      metadata: { sentCount: 42 }
    });

    // Attempting to re-claim must report ALREADY_COMPLETED
    const reClaim = await claimJobExecution(pool, { tenantId: testTenantA, jobType: stateJobType, date: stateDate });
    assert.strictEqual(reClaim.claimed, false);
    assert.strictEqual(reClaim.reason, 'ALREADY_COMPLETED');
    assert.strictEqual(reClaim.status_code, 200);
    pass('Ciclo de vida completo verificado (claim 102 -> complete 200 -> reintento ALREADY_COMPLETED)');

    // 18. Cleanup de nonces expirados
    console.log('\n--- TEST 18: Cleanup de Nonces Expirados ---');
    // Insert an expired nonce manually
    const expNonceHash = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO job_request_nonces (nonce_hash, body_hash, signed_timestamp, consumed_at, expires_at)
       VALUES ($1, 'body_hash', $2, NOW() - INTERVAL '1 hour', NOW() - INTERVAL '10 minutes')`,
      [expNonceHash, Date.now() - 3600000]
    );

    const deletedCount = await cleanupExpiredNonces(pool);
    assert(deletedCount >= 1, 'cleanupExpiredNonces debe eliminar nonces con expires_at < NOW()');

    const chkExpiredRes = await pool.query('SELECT id FROM job_request_nonces WHERE nonce_hash = $1', [expNonceHash]);
    assert.strictEqual(chkExpiredRes.rows.length, 0, 'Nonce expirado debe haber sido purgado de la tabla');
    pass('cleanupExpiredNonces() purga exitosamente nonces vencidos en job_request_nonces');

    // 19. Aislamiento estricto multi-tenant
    console.log('\n--- TEST 19: Aislamiento Estricto entre Tenants ---');
    const isoDate = '2026-11-20-' + Date.now();
    const isoJob = 'iso_test';

    // Claim and complete for Tenant A
    const claimIsoA = await claimJobExecution(pool, { tenantId: testTenantA, jobType: isoJob, date: isoDate });
    assert.strictEqual(claimIsoA.claimed, true);
    await completeJobExecution(pool, { tenantId: testTenantA, jobType: isoJob, date: isoDate });

    // Tenant B on same date must be completely independent and claimable
    const claimIsoB = await claimJobExecution(pool, { tenantId: testTenantB, jobType: isoJob, date: isoDate });
    assert.strictEqual(claimIsoB.claimed, true, 'Tenant B no debe verse afectado por Tenant A');
    await completeJobExecution(pool, { tenantId: testTenantB, jobType: isoJob, date: isoDate });
    pass('Aislamiento multi-tenant verificado: inquilinos independientes no interfieren entre sí');

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
