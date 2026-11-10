/**
 * Test Suite: Phase 2H-B — Graceful Shutdown Child Process Verification
 * (backend/tests/test_phase2h_shutdown.cjs)
 * 
 * Verifies clean draining of active in-flight requests, rejection of new requests,
 * resource disposal, single shutdown invocation, and forced exit on timeout.
 */

'use strict';

const assert = require('assert');
const { fork } = require('child_process');
const http = require('http');
const path = require('path');

function sendSignal(child, signal) {
  if (child.send) {
    child.send(signal);
  } else {
    child.kill(signal);
  }
}

function makeRequest(port, method, reqPath, body = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port,
      path: reqPath,
      method,
      headers: { 'Content-Type': 'application/json' }
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, body: json || data });
      });
    });

    req.on('error', (err) => resolve({ error: err.code || err.message }));
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function spawnServer(env = {}) {
  return new Promise((resolve, reject) => {
    const script = path.resolve(__dirname, 'helpers/shutdown_test_server.cjs');
    const child = fork(script, [], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });

    let port = null;

    child.on('message', (msg) => {
      if (msg && msg.event === 'listening') {
        port = msg.port;
        resolve({ child, port });
      }
    });

    child.on('error', reject);
    setTimeout(() => {
      if (!port) reject(new Error('Timeout esperando inicio de shutdown_test_server'));
    }, 5000);
  });
}

async function runPhase2hShutdownSuite() {
  console.log('\n=== STARTING SUITE: PHASE 2H-B GRACEFUL SHUTDOWN ===\n');

  let passedTests = 0;
  function pass(msg) {
    passedTests++;
    console.log(`  [PASS ${passedTests}] ${msg}`);
  }

  // =========================================================================
  // SCENARIO 1: LIMPIA PARADA CONTROLADA (SIGTERM) CON DRENAJE EN VUELO
  // =========================================================================
  console.log('--- SCENARIO 1: PARADA CONTROLADA CON PETICIONES EN VUELO ---');

  const { child: child1, port: port1 } = await spawnServer({ SHUTDOWN_TIMEOUT_MS: '4000' });

  // 1.1: Healthcheck inicial es 200 healthy
  const initialHealth = await makeRequest(port1, 'GET', '/health');
  assert.strictEqual(initialHealth.status, 200);
  assert.strictEqual(initialHealth.body.status, 'healthy');
  pass('Flow 1.1: Healthcheck inicial reporta estado healthy (200 OK)');

  // 1.2: Iniciar petición lenta (800ms) en vuelo
  const inFlightPromise = makeRequest(port1, 'GET', '/slow-operation?delay=800');

  // Esperar 100ms para asegurar que la petición ya esté siendo atendida por el servidor
  await new Promise(r => setTimeout(r, 100));

  // 1.3: Enviar señal SIGTERM al proceso
  sendSignal(child1, 'SIGTERM');

  // 1.4: Mientras drena, una nueva petición posterior debe ser rechazada con 503 o conexión cerrada
  await new Promise(r => setTimeout(r, 50));
  const rejectedReq = await makeRequest(port1, 'POST', '/test-mutation', { foo: 'bar' });
  assert.ok(
    rejectedReq.status === 503 || rejectedReq.error === 'ECONNRESET' || rejectedReq.error === 'ECONNREFUSED',
    `Petición posterior a SIGTERM debe ser rechazada o cerrada, got ${rejectedReq.status || rejectedReq.error}`
  );
  pass('Flow 1.2: Nuevas conexiones rechazadas con 503 o cerradas tras recibir SIGTERM');

  // 1.5: La petición en vuelo iniciada previamente DEBE completar exitosamente (no cortarse a medias)
  const inFlightResult = await inFlightPromise;
  assert.strictEqual(inFlightResult.status, 200, 'Petición en vuelo debe completar con 200 OK');
  assert.strictEqual(inFlightResult.body?.success, true);
  pass('Flow 1.3: Transacción en vuelo completó exitosamente sin corte prematuro');

  // 1.6: El proceso hijo debe terminar limpiamente con código 0
  const exitCode1 = await new Promise((resolve) => child1.on('exit', (code) => resolve(code)));
  assert.strictEqual(exitCode1, 0, 'Proceso hijo debe salir con código 0');
  pass('Flow 1.4: Proceso hijo finalizó ordenadamente con código de salida 0');

  // =========================================================================
  // SCENARIO 2: PREVENCIÓN DE DOBLE EJECUCIÓN ANTE MÚLTIPLES SEÑALES
  // =========================================================================
  console.log('\n--- SCENARIO 2: IDEMPOTENCIA DE SEÑALES DE APAGADO ---');

  const { child: child2, port: port2 } = await spawnServer({ SHUTDOWN_TIMEOUT_MS: '3000' });
  assert.ok(port2 > 0);

  // Enviar SIGTERM y SIGINT consecutivas de forma inmediata
  sendSignal(child2, 'SIGTERM');
  sendSignal(child2, 'SIGINT');

  const exitCode2 = await new Promise((resolve) => child2.on('exit', (code) => resolve(code)));
  assert.strictEqual(exitCode2, 0, 'Doble señal no debe causar crash ni códigos anómalos');
  pass('Flow 2.1: Múltiples señales concurrentes (SIGTERM + SIGINT) manejadas de forma atómica y limpia (código 0)');

  // =========================================================================
  // SCENARIO 3: FORCED EXIT ANTE TIMEOUT DE LIMPIEZA BLOQUEADA
  // =========================================================================
  console.log('\n--- SCENARIO 3: SALIDA FORZADA POR TIMEOUT EXCEDIDO ---');

  const { child: child3, port: port3 } = await spawnServer({
    SHUTDOWN_TIMEOUT_MS: '600', // Timeout corto de 600ms
    SIMULATE_HANGING_CLEANUP: 'true' // Tarea de limpieza que cuelga indefinidamente
  });
  assert.ok(port3 > 0);

  const startShutdown = Date.now();
  sendSignal(child3, 'SIGTERM');

  const exitCode3 = await new Promise((resolve) => child3.on('exit', (code) => resolve(code)));
  const elapsed = Date.now() - startShutdown;

  assert.strictEqual(exitCode3, 1, 'Proceso con recurso colgado debe forzar salida con código 1');
  assert.ok(elapsed >= 500 && elapsed < 3000, `Debe expirar cerca de 600ms (demoró ${elapsed}ms)`);
  pass('Flow 3.1: Timeout forzado (600ms) interrumpe recursos bloqueados y sale con código 1');

  console.log('\n======================================================');
  console.log(`PHASE 2H-B SHUTDOWN SUMMARY: ${passedTests}/${passedTests} PASSED`);
  console.log('======================================================\n');
}

runPhase2hShutdownSuite().catch(err => {
  console.error('\n❌ PHASE 2H-B SHUTDOWN TEST FAILED:');
  console.error(err);
  process.exit(1);
});
