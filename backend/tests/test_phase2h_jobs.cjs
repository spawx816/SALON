/**
 * Test Suite: Phase 2H-B — Standalone Billing Workers & Distributed Schedulers
 * (backend/tests/test_phase2h_jobs.cjs)
 * 
 * Verifies distributed locking, race-condition prevention, retry backoff,
 * dead-letter queue, and tenant isolation (ZERO PostgreSQL, ZERO external network).
 */

'use strict';

const assert = require('assert');
const { fork } = require('child_process');
const path = require('path');
const { InMemoryJobRepository } = require('../services/job_repository.service.cjs');
const { InMemoryDistributedLock } = require('../services/distributed_lock.service.cjs');
const { BillingWorkerService } = require('../workers/billing_worker.service.cjs');

async function runPhase2hJobsSuite() {
  console.log('\n=== STARTING SUITE: PHASE 2H-B WORKERS & SCHEDULERS ===\n');

  let passedTests = 0;
  function pass(msg) {
    passedTests++;
    console.log(`  [PASS ${passedTests}] ${msg}`);
  }

  let currentTime = new Date('2026-11-09T12:00:00Z');
  const clock = {
    now: () => new Date(currentTime)
  };

  const jobRepo = new InMemoryJobRepository({ clock });
  const distributedLock = new InMemoryDistributedLock({ clock });

  // Gateway mock with call tracking
  const gatewayCalls = [];
  const fakeGateway = {
    charge: async (params) => {
      gatewayCalls.push({ ...params });
      if (params.cardToken === 'FAIL_CARD') {
        throw new Error('Card declined: Insufficient funds (PAN 4111-2222-3333-4444 CVV 123)');
      }
      return { success: true, transactionId: `tx_${Date.now()}` };
    }
  };

  // =========================================================================
  // SECCIÓN 1: DISTRIBUTED LOCKING Y LEASES
  // =========================================================================
  console.log('--- SECCIÓN 1: DISTRIBUTED LOCKING Y EXCLUSIÓN MUTUA ---');

  // 1.1: Adquisición de lock exclusivo
  const lockKey = 'job_lock_1001';
  const acq1 = await distributedLock.acquire(lockKey, 10000, 'worker_A');
  assert.strictEqual(acq1, true, 'Worker A debe adquirir el lock');

  // 1.2: Segundo worker intentando adquirir el mismo lock falla
  const acq2 = await distributedLock.acquire(lockKey, 10000, 'worker_B');
  assert.strictEqual(acq2, false, 'Worker B no debe poder adquirir el lock retenido por Worker A');
  pass('Flow 1.1: Exclusión mutua garantizada: Worker B no adquiere lock de Worker A');

  // 1.3: Worker B no puede liberar el lock de Worker A
  const releaseBad = await distributedLock.release(lockKey, 'worker_B');
  assert.strictEqual(releaseBad, false, 'Worker B no puede liberar lock ajeno');

  // 1.4: Worker A libera su propio lock y luego Worker B sí puede adquirirlo
  const releaseGood = await distributedLock.release(lockKey, 'worker_A');
  assert.strictEqual(releaseGood, true, 'Worker A libera su lock exitosamente');
  const acq3 = await distributedLock.acquire(lockKey, 10000, 'worker_B');
  assert.strictEqual(acq3, true, 'Worker B adquiere el lock liberado');
  await distributedLock.release(lockKey, 'worker_B');
  pass('Flow 1.2: Liberación segura y transferencia de lease a nuevo worker');

  // 1.5: Lease abandonado expira tras TTL y puede ser reclamado
  await distributedLock.acquire(lockKey, 5000, 'worker_crashed');
  currentTime = new Date(currentTime.getTime() + 6000); // Avanzar 6s
  const acqAfterExpiry = await distributedLock.acquire(lockKey, 10000, 'worker_recovery');
  assert.strictEqual(acqAfterExpiry, true, 'Worker de recuperación adquiere lock cuyo lease expiró');
  await distributedLock.release(lockKey, 'worker_recovery');
  pass('Flow 1.3: Recuperación automática ante leases abandonados por workers caídos');

  // =========================================================================
  // SECCIÓN 2: CONCURRENCIA DE WORKERS Y COBRO ÚNICO
  // =========================================================================
  console.log('\n--- SECCIÓN 2: SIMULACIÓN DE CONCURRENCIA Y PREVENCIÓN DE DOBLE COBRO ---');

  // 2.1: Crear job de cobro recurrente
  const jobId = 'job_subscription_001';
  await jobRepo.createJob({
    id: jobId,
    tenantId: 'tenant_salon_alpha',
    type: 'saas_recurring_billing',
    scheduledAt: currentTime,
    payload: {
      amountCents: 4900,
      currency: 'USD',
      cardToken: 'tok_valid_visa'
    },
    idempotencyKey: 'idem_sub_001'
  });

  const worker1 = new BillingWorkerService({
    jobRepo,
    distributedLock,
    paymentGateway: fakeGateway,
    clock,
    workerId: 'worker_node_1'
  });

  const worker2 = new BillingWorkerService({
    jobRepo,
    distributedLock,
    paymentGateway: fakeGateway,
    clock,
    workerId: 'worker_node_2'
  });

  // Ejecutar ambos workers simultáneamente compitiendo por el mismo lote
  const [res1, res2] = await Promise.all([
    worker1.processBatch(),
    worker2.processBatch()
  ]);

  // Exactamente uno debió procesar y el otro encontrar el lock retenido
  const totalProcessed = res1.processed + res2.processed;
  const totalLocked = res1.locked + res2.locked;
  const totalSucceeded = res1.succeeded + res2.succeeded;

  assert.strictEqual(totalProcessed, 1, 'Exactamente 1 worker debe procesar el job');
  assert.strictEqual(totalLocked, 1, 'El segundo worker debe registrar LOCK_NOT_ACQUIRED');
  assert.strictEqual(totalSucceeded, 1, 'El cobro debe tener éxito exactamente una vez');
  assert.strictEqual(gatewayCalls.length, 1, 'La pasarela de pago sólo debe invocarse UNA vez');
  pass('Flow 2.1: Competencia concurrente: sólo 1 worker cobra, el segundo es rechazado por lock');

  // 2.2: Job completado no se vuelve a cobrar en siguientes pasadas
  const repeatRun = await worker1.processBatch();
  assert.strictEqual(repeatRun.processed, 0, 'No debe procesar jobs ya completados');
  assert.strictEqual(gatewayCalls.length, 1, 'No se genera segundo cargo en pasarela');
  pass('Flow 2.2: Job completado permanece en estado terminal y no duplica cobros');

  // =========================================================================
  // SECCIÓN 3: REINTENTOS CON BACKOFF, DEAD-LETTER Y SANITIZACIÓN DE PII
  // =========================================================================
  console.log('\n--- SECCIÓN 3: RESILIENCIA, BACKOFF, DEAD-LETTER Y SANITIZACIÓN ---');

  const failJobId = 'job_failing_tenant';
  await jobRepo.createJob({
    id: failJobId,
    tenantId: 'tenant_salon_fail',
    type: 'saas_recurring_billing',
    scheduledAt: currentTime,
    maxAttempts: 3,
    payload: {
      amountCents: 2500,
      currency: 'DOP',
      cardToken: 'FAIL_CARD'
    }
  });

  // Intento 1: Falla y programa reintento para +60s
  await worker1.processBatch();
  let jobState = await jobRepo.getJob(failJobId);
  assert.strictEqual(jobState.attempts, 1);
  assert.strictEqual(jobState.status, 'pending');
  assert.ok(!jobState.last_error.includes('4111-2222-3333-4444'), 'Error sanitizado no debe contener PAN');
  assert.ok(!jobState.last_error.includes('123'), 'Error sanitizado no debe contener CVV');
  assert.ok(jobState.last_error.includes('[CARD_MASKED]'), 'PAN debe ser enmascarado');
  pass('Flow 3.1: Intento fallido programa reintento y sanitiza datos de tarjeta en logs de error');

  // Avanzar reloj 65s e intentar Intento 2
  currentTime = new Date(currentTime.getTime() + 65000);
  await worker1.processBatch();
  jobState = await jobRepo.getJob(failJobId);
  assert.strictEqual(jobState.attempts, 2);
  assert.strictEqual(jobState.status, 'pending');
  pass('Flow 3.2: Reintento respetó backoff temporal');

  // Avanzar reloj 310s e intentar Intento 3 (máximo de intentos alcanzado)
  currentTime = new Date(currentTime.getTime() + 310000);
  await worker1.processBatch();
  jobState = await jobRepo.getJob(failJobId);
  assert.strictEqual(jobState.attempts, 3);
  assert.strictEqual(jobState.status, 'dead_letter', 'Tras 3 intentos fallidos debe pasar a dead_letter');
  pass('Flow 3.3: Tras exceder límite de reintentos pasa a dead_letter queue para revisión');

  // =========================================================================
  // SECCIÓN 4: AISLAMIENTO MULTI-TENANT EN WORKERS
  // =========================================================================
  console.log('\n--- SECCIÓN 4: AISLAMIENTO MULTI-TENANT ---');

  // Crear 2 jobs en el mismo lote: uno con tarjeta errónea (Tenant X) y otro con tarjeta válida (Tenant Y)
  await jobRepo.createJob({
    id: 'job_tenant_x_fail',
    tenantId: 'tenant_X',
    type: 'saas_recurring_billing',
    scheduledAt: currentTime,
    payload: { amountCents: 5000, cardToken: 'FAIL_CARD' }
  });

  await jobRepo.createJob({
    id: 'job_tenant_y_ok',
    tenantId: 'tenant_Y',
    type: 'saas_recurring_billing',
    scheduledAt: currentTime,
    payload: { amountCents: 5000, cardToken: 'tok_valid_mastercard' }
  });

  const batchRes = await worker1.processBatch();
  assert.strictEqual(batchRes.processed, 2, 'Debe procesar ambos jobs');
  assert.strictEqual(batchRes.succeeded, 1, 'Tenant Y debe tener éxito');
  assert.strictEqual(batchRes.failed, 1, 'Tenant X falla sin bloquear a Tenant Y');

  const jobY = await jobRepo.getJob('job_tenant_y_ok');
  assert.strictEqual(jobY.status, 'completed', 'Tenant Y completó exitosamente a pesar de fallo en Tenant X');
  pass('Flow 4.1: Aislamiento total: un tenant fallido no detiene jobs de otros tenants en el lote');

  // =========================================================================
  // SECCIÓN 5: FAIL-SAFE DEL WORKER CLI ENTRYPOINT
  // =========================================================================
  console.log('\n--- SECCIÓN 5: FAIL-SAFE DE EJECUCIÓN DEL WORKER CLI ---');

  const workerScriptPath = path.resolve(__dirname, '../workers/billing.worker.cjs');

  // 5.1: Ejecución sin ENABLE_BILLING_WORKER debe salir con código 1
  const failSafeExitCode = await new Promise((resolve) => {
    const proc = fork(workerScriptPath, [], {
      env: { ...process.env, ENABLE_BILLING_WORKER: 'false' },
      stdio: 'ignore'
    });
    proc.on('exit', (code) => resolve(code));
  });
  assert.strictEqual(failSafeExitCode, 1, 'Worker debe fallar con código 1 si no está habilitado explícitamente');
  pass('Flow 5.1: Worker CLI falla de forma segura con código 1 sin configuración explícita');

  // 5.2: Ejecución con ENABLE_BILLING_WORKER=true y --once sale con código 0
  const successExitCode = await new Promise((resolve) => {
    const proc = fork(workerScriptPath, ['--once'], {
      env: { ...process.env, ENABLE_BILLING_WORKER: 'true' },
      stdio: 'ignore'
    });
    proc.on('exit', (code) => resolve(code));
  });
  assert.strictEqual(successExitCode, 0, 'Worker en modo habilitado con --once debe salir con código 0');
  pass('Flow 5.2: Worker CLI ejecuta autochequeo y finaliza limpiamente con código 0');

  console.log('\n======================================================');
  console.log(`PHASE 2H-B JOBS SUMMARY: ${passedTests}/${passedTests} PASSED`);
  console.log('======================================================\n');
}

runPhase2hJobsSuite().catch(err => {
  console.error('\n❌ PHASE 2H-B JOBS TEST FAILED:');
  console.error(err);
  process.exit(1);
});

