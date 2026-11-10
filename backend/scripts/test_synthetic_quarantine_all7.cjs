/**
 * Test: Synthetic Quarantine Enforcement Suite (All 7 Records over Canonical Server Subprocess)
 *
 * Requirements:
 * 1. Strict test isolation via validateTestEnvironment() (NO allowDisposableSchema bypass, physical test DB only).
 * 2. Launches canonical backend/server.js as an ISOLATED CHILD PROCESS (NO in-process require/import).
 * 3. Before running requests, verifies /api/health/db-check confirms:
 *    - current_database() === TEST_DB_NAME
 *    - current_user === TEST_DB_USER
 *    If check fails, kills and awaits subprocess exit immediately before creating fixtures.
 * 4. Mounts 7 purely synthetic fixtures (IDs prefixed with synth-) with ZERO reuse of historical IDs.
 * 5. Creates a synthetic session in user_sessions and signs a canonical JWT embedding sessionId.
 * 6. Verifies database triggers block direct SQL UPDATE and DELETE on all 7 quarantined records.
 * 7. Verifies canonical route handlers reject quarantined operations with HTTP 423 Locked.
 * 8. Fixture cleanup is executed strictly in `finally`, verifying that 0 synthetic records remain.
 * 9. Subprocess termination is gracefully awaited.
 *
 * SAFETY GUARD: Prepared for execution on the physical isolated test database (salon_saas_test).
 * Will fail closed if run without operator authorization (ALLOW_INTEGRATION_TESTS).
 */

const http = require('http');
const net = require('net');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const { validateTestEnvironment, createIsolatedTestPool, getSanitizedChildEnv } = require('../utils/test_env_guard.cjs');

const SYNTHETIC_TENANT_ID = crypto.randomUUID();
const SYNTHETIC_USER_ID = crypto.randomUUID();
const SYNTHETIC_BRANCH_ID = crypto.randomUUID();
const SYNTHETIC_SESSION_ID = crypto.randomUUID();

// 7 Purely Synthetic Records (ZERO reuse of historical production IDs)
const QUARANTINED_FIXTURES = [
  { table: 'salons', id: 'synth-salon-alpha-001', reason: 'Synthetic Salón Alpha 001 quarantine test' },
  { table: 'salons', id: 'synth-salon-beta-002', reason: 'Synthetic Salón Beta 002 quarantine test' },
  { table: 'cash_registers', id: 'synth-register-omega-003', reason: 'Synthetic Caja Omega 003 quarantine test' },
  { table: 'visits', id: 'synth-visit-delta-004', reason: 'Synthetic Visita Delta 004 quarantine test' },
  { table: 'ticket_sequences', id: 'synth-seq-gamma-005', reason: 'Synthetic Secuencia Gamma 005 quarantine test' },
  { table: 'ticket_sequences', id: 'synth-seq-theta-006', reason: 'Synthetic Secuencia Theta 006 quarantine test' },
  { table: 'ticket_sequences', id: 'synth-seq-lambda-007', reason: 'Synthetic Secuencia Lambda 007 quarantine test' }
];

function getEphemeralPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function makeHttpRequest(port, method, pathName, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };

    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathName,
      method,
      headers: reqHeaders
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json;
        try { json = JSON.parse(data); } catch { json = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

function terminateProcess(child) {
  return new Promise((resolve) => {
    if (!child || child.killed || child.exitCode !== null) {
      return resolve();
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      resolve();
    }, 4000);

    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });

    try {
      child.kill('SIGTERM');
    } catch {
      resolve();
    }
  });
}

async function waitForServerHealth(port, maxWaitMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await makeHttpRequest(port, 'GET', '/api/health/db-check');
      if (res.status === 200 && res.body && res.body.status === 'ok') {
        return res.body;
      }
    } catch {
      // Server not ready yet, retry after small delay
    }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error(`Timeout waiting for child server to become healthy on port ${port} (${maxWaitMs}ms)`);
}

async function runSyntheticQuarantineSuite() {
  console.log('========================================================================');
  console.log('🧪 PRUEBA CANÓNICA DE CUARENTENA: SUBPROCESO DE SERVIDOR Y 7 FIXTURES');
  console.log('========================================================================\n');

  // 1. Fail-closed test environment validation
  const testConfig = validateTestEnvironment();
  const ephemeralPort = await getEphemeralPort();
  const serverPath = path.resolve(__dirname, '../server.js');

  console.log(`[SUBPROCESO] Levantando backend/server.js en puerto efímero :${ephemeralPort}...`);
  const childEnv = getSanitizedChildEnv(testConfig, ephemeralPort);

  let childProcess = null;
  let pool = null;
  let conn = null;
  let passed = 0;
  let fixturesCreated = false;

  try {
    // 2. Launch child server with sanitized allowlist environment
    childProcess = spawn(process.execPath, [serverPath], {
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    childProcess.stderr.on('data', data => {
      const str = data.toString();
      if (str.includes('FATAL') || str.includes('SECURITY HALT')) {
        console.error('[CHILD SERVER FATAL]:', str.trim());
      }
    });

    // 3. Verify /api/health/db-check BEFORE touching any database or fixtures
    console.log('[VERIFICACIÓN AISLAMIENTO] Consultando /api/health/db-check en subproceso...');
    let healthInfo;
    try {
      healthInfo = await waitForServerHealth(ephemeralPort);
    } catch (healthErr) {
      console.error('❌ [HANDSHAKE FAILED]:', healthErr.message);
      await terminateProcess(childProcess);
      throw healthErr;
    }

    console.log(`  [HEALTH CHECK] Base de datos reportada: "${healthInfo.database}" | Usuario: "${healthInfo.user}"`);

    if (healthInfo.database !== testConfig.database) {
      await terminateProcess(childProcess);
      throw new Error(`SECURITY HALT: Subproceso conectado a base no autorizada "${healthInfo.database}" !== TEST_DB_NAME="${testConfig.database}"`);
    }
    if (healthInfo.user !== testConfig.user) {
      await terminateProcess(childProcess);
      throw new Error(`SECURITY HALT: Subproceso conectado como usuario no autorizado "${healthInfo.user}" !== TEST_DB_USER="${testConfig.user}"`);
    }
    console.log('  ✅ [PASS] Subproceso canónico validado: current_database() y current_user coinciden con TEST_DB_*.\n');

    // 4. Initialize database connection pool for fixture insertion
    pool = createIsolatedTestPool(testConfig);
    conn = await pool.getConnection();

    // 5. Setup synthetic tenant and administrative test user in physical test DB
    console.log('[SETUP] Insertando inquilino, usuario y sesión administrativa sintética...');
    fixturesCreated = true;

    await conn.query(`
      INSERT INTO tenants (id, business_name, legal_name, slug, email, status)
      VALUES (?, 'Synthetic Quarantine Salon', 'Synthetic Quarantine Salon SRL', ?, 'test-quarantine@example.com', 'active')
      ON CONFLICT (id) DO NOTHING;
    `, [SYNTHETIC_TENANT_ID, 'synth-salon-' + Date.now()]);

    await conn.query(`
      INSERT INTO branches (id, tenant_id, name, is_main, is_active)
      VALUES (?, ?, 'Sucursal Sintética Principal', true, true)
      ON CONFLICT (id) DO NOTHING;
    `, [SYNTHETIC_BRANCH_ID, SYNTHETIC_TENANT_ID]);

    await conn.query(`
      INSERT INTO users (id, tenant_id, branch_id, email, password, name, role, is_active)
      VALUES (?, ?, ?, 'admin-quarantine@example.com', '$2b$10$syntheticHashForSecurityTestingPurposesOnly1234567890', 'Admin Sintético', 'admin', true)
      ON CONFLICT (id) DO NOTHING;
    `, [SYNTHETIC_USER_ID, SYNTHETIC_TENANT_ID, SYNTHETIC_BRANCH_ID]);

    // Insert synthetic session in user_sessions
    await conn.query(`
      INSERT INTO user_sessions (id, user_id, tenant_id, is_active, created_at)
      VALUES (?, ?, ?, true, NOW())
      ON CONFLICT (id) DO NOTHING;
    `, [SYNTHETIC_SESSION_ID, SYNTHETIC_USER_ID, SYNTHETIC_TENANT_ID]);

    // Generate signed JWT for the synthetic admin user including sessionId
    const jwtSecret = process.env.JWT_SECRET;
    assert(jwtSecret && jwtSecret.length >= 32, 'JWT_SECRET must be at least 32 characters');
    const authToken = jwt.sign({
      sub: SYNTHETIC_USER_ID,
      tenantId: SYNTHETIC_TENANT_ID,
      branchId: SYNTHETIC_BRANCH_ID,
      sessionId: SYNTHETIC_SESSION_ID,
      role: 'admin',
      email: 'admin-quarantine@example.com',
      name: 'Admin Sintético'
    }, jwtSecret, {
      algorithm: 'HS256',
      expiresIn: '1h',
      issuer: 'salonpro-saas',
      audience: 'salonpro-app'
    });

    const authHeaders = {
      'Authorization': `Bearer ${authToken}`
    };

    // 6. Insert the 7 purely synthetic quarantined records
    console.log('[FIXTURES] Insertando 7 registros sintéticos en cuarentena (IDs synth-*)...');
    for (const fix of QUARANTINED_FIXTURES) {
      await conn.query(`
        INSERT INTO pending_tenant_reconciliations (table_name, record_id, reason, status)
        VALUES (?, ?, ?, 'quarantined')
        ON CONFLICT (table_name, record_id) DO UPDATE SET status = 'quarantined', reason = EXCLUDED.reason;
      `, [fix.table, fix.id, fix.reason]);

      if (fix.table === 'salons') {
        await conn.query(`
          INSERT INTO salons (id, tenant_id, name, status)
          VALUES (?, ?, 'Synthetic Salon ' || ?, 'Active')
          ON CONFLICT (id) DO NOTHING;
        `, [fix.id, SYNTHETIC_TENANT_ID, fix.id]);
      } else if (fix.table === 'cash_registers') {
        await conn.query(`
          INSERT INTO cash_registers (id, tenant_id, branch_id, status)
          VALUES (?, ?, ?, 'Abierta')
          ON CONFLICT (id) DO NOTHING;
        `, [fix.id, SYNTHETIC_TENANT_ID, SYNTHETIC_BRANCH_ID]);
      } else if (fix.table === 'visits') {
        await conn.query(`
          INSERT INTO visits (id, tenant_id, total, status)
          VALUES (?, ?, 1500.00, 'Facturado')
          ON CONFLICT (id) DO NOTHING;
        `, [fix.id, SYNTHETIC_TENANT_ID]);
      } else if (fix.table === 'ticket_sequences') {
        await conn.query(`
          INSERT INTO ticket_sequences (id, tenant_id, last_sequence)
          VALUES (?, ?, 10)
          ON CONFLICT (id) DO NOTHING;
        `, [fix.id, SYNTHETIC_TENANT_ID]);
      }
    }
    console.log('  ✅ [PASS] 7 fixtures puramente sintéticos cargados en base de pruebas.\n');

    // 7. Test Trigger Block on all 7 synthetic records (UPDATE and DELETE)
    console.log('[VERIFICACIÓN 1] Verificando bloqueo por Trigger de Base de Datos (UPDATE y DELETE)...');
    for (const fix of QUARANTINED_FIXTURES) {
      let updateBlocked = false;
      try {
        if (fix.table === 'salons') {
          await conn.query('UPDATE salons SET name = \'Mutated\' WHERE id = ?', [fix.id]);
        } else if (fix.table === 'cash_registers') {
          await conn.query('UPDATE cash_registers SET status = \'Cerrada\' WHERE id = ?', [fix.id]);
        } else if (fix.table === 'visits') {
          await conn.query('UPDATE visits SET total = 9999 WHERE id = ?', [fix.id]);
        } else if (fix.table === 'ticket_sequences') {
          await conn.query('UPDATE ticket_sequences SET last_sequence = 9999 WHERE id = ?', [fix.id]);
        }
      } catch (err) {
        if (err.message.includes('QUARANTINE_VIOLATION')) {
          updateBlocked = true;
        }
      }
      assert(updateBlocked, `Direct SQL UPDATE on ${fix.table}/${fix.id} must be blocked by trigger`);

      let deleteBlocked = false;
      try {
        await conn.query(`DELETE FROM ${fix.table} WHERE id = ?`, [fix.id]);
      } catch (err) {
        if (err.message.includes('QUARANTINE_VIOLATION')) {
          deleteBlocked = true;
        }
      }
      assert(deleteBlocked, `Direct SQL DELETE on ${fix.table}/${fix.id} must be blocked by trigger`);

      console.log(`  ✅ [PASS] Trigger bloqueó exitosamente UPDATE y DELETE en ${fix.table}/${fix.id}`);
      passed += 2;
    }

    // 8. Test Canonical Express App Endpoints over Spawned Child Server
    console.log('\n[VERIFICACIÓN 2] Probando rutas canónicas en el subproceso servidor...');

    // 8.1 PUT /api/salons/synth-salon-alpha-001 -> HTTP 423
    console.log('[RUTA 1] PUT /api/salons/synth-salon-alpha-001...');
    const resSalonPut = await makeHttpRequest(ephemeralPort, 'PUT', '/api/salons/synth-salon-alpha-001', authHeaders, { name: 'Mutated' });
    assert.strictEqual(resSalonPut.status, 423, 'PUT on quarantined salon must return HTTP 423');
    assert.strictEqual(resSalonPut.body.code, 'QUARANTINE_VIOLATION', 'Code must be QUARANTINE_VIOLATION');
    console.log('  ✅ [PASS] PUT /api/salons/:id bloqueado con HTTP 423 Locked.');
    passed++;

    // 8.2 DELETE /api/salons/synth-salon-beta-002 -> HTTP 423
    console.log('[RUTA 2] DELETE /api/salons/synth-salon-beta-002...');
    const resSalonDel = await makeHttpRequest(ephemeralPort, 'DELETE', '/api/salons/synth-salon-beta-002', authHeaders);
    assert.strictEqual(resSalonDel.status, 423, 'DELETE on quarantined salon must return HTTP 423');
    assert.strictEqual(resSalonDel.body.code, 'QUARANTINE_VIOLATION', 'Code must be QUARANTINE_VIOLATION');
    console.log('  ✅ [PASS] DELETE /api/salons/:id bloqueado con HTTP 423 Locked.');
    passed++;

    // 8.3 POST /api/cash-registers/synth-register-omega-003/close -> HTTP 423
    console.log('[RUTA 3] POST /api/cash-registers/synth-register-omega-003/close...');
    const resCashClose = await makeHttpRequest(ephemeralPort, 'POST', '/api/cash-registers/synth-register-omega-003/close', authHeaders, { closing_balance: 500 });
    assert.strictEqual(resCashClose.status, 423, 'POST /close on quarantined cash register must return HTTP 423');
    assert.strictEqual(resCashClose.body.code, 'QUARANTINE_VIOLATION', 'Code must be QUARANTINE_VIOLATION');
    console.log('  ✅ [PASS] POST /api/cash-registers/:id/close bloqueado con HTTP 423 Locked.');
    passed++;

    // 8.4 GET /api/cash-registers/synth-register-omega-003/close-report -> HTTP 423
    console.log('[RUTA 4] GET /api/cash-registers/synth-register-omega-003/close-report...');
    const resCashReport = await makeHttpRequest(ephemeralPort, 'GET', '/api/cash-registers/synth-register-omega-003/close-report', authHeaders);
    assert.strictEqual(resCashReport.status, 423, 'GET /close-report on quarantined cash register must return HTTP 423');
    assert.strictEqual(resCashReport.body.code, 'QUARANTINE_VIOLATION', 'Code must be QUARANTINE_VIOLATION');
    console.log('  ✅ [PASS] GET /api/cash-registers/:id/close-report bloqueado con HTTP 423 Locked.');
    passed++;

    // 8.5 PUT /api/visits/synth-visit-delta-004/draft -> HTTP 423
    console.log('[RUTA 5] PUT /api/visits/synth-visit-delta-004/draft...');
    const resVisitDraft = await makeHttpRequest(ephemeralPort, 'PUT', '/api/visits/synth-visit-delta-004/draft', authHeaders, { notes: 'Mutated' });
    assert.strictEqual(resVisitDraft.status, 423, 'PUT /draft on quarantined visit must return HTTP 423');
    assert.strictEqual(resVisitDraft.body.code, 'QUARANTINE_VIOLATION', 'Code must be QUARANTINE_VIOLATION');
    console.log('  ✅ [PASS] PUT /api/visits/:id/draft bloqueado con HTTP 423 Locked.');
    passed++;

    // 8.6 POST /api/visits/synth-visit-delta-004/void -> HTTP 423
    console.log('[RUTA 6] POST /api/visits/synth-visit-delta-004/void...');
    const resVisitVoid = await makeHttpRequest(ephemeralPort, 'POST', '/api/visits/synth-visit-delta-004/void', authHeaders, { reason: 'Test void' });
    assert.strictEqual(resVisitVoid.status, 423, 'POST /void on quarantined visit must return HTTP 423');
    assert.strictEqual(resVisitVoid.body.code, 'QUARANTINE_VIOLATION', 'Code must be QUARANTINE_VIOLATION');
    console.log('  ✅ [PASS] POST /api/visits/:id/void bloqueado con HTTP 423 Locked.');
    passed++;

    // 8.7 POST /api/dgii/sequences con id synth-seq-gamma-005 -> HTTP 423
    console.log('[RUTA 7] POST /api/dgii/sequences (con secuencia sintética en cuarentena)...');
    const resSeqPut = await makeHttpRequest(ephemeralPort, 'POST', '/api/dgii/sequences', authHeaders, {
      id: 'synth-seq-gamma-005',
      type_code: 'B01',
      prefix: 'B01',
      current_number: 100
    });
    assert.strictEqual(resSeqPut.status, 423, 'POST /sequences with quarantined sequence ID must return HTTP 423');
    assert.strictEqual(resSeqPut.body.code, 'QUARANTINE_VIOLATION', 'Code must be QUARANTINE_VIOLATION');
    console.log('  ✅ [PASS] POST /api/dgii/sequences bloqueado con HTTP 423 Locked.');
    passed++;

    // 8.8 Operación legítima no en cuarentena
    console.log('[RUTA 8] Operación legítima no en cuarentena (GET /api/salons)...');
    const resSalonsList = await makeHttpRequest(ephemeralPort, 'GET', '/api/salons', authHeaders);
    assert.strictEqual(resSalonsList.status, 200, 'Non-quarantined GET on salons must return HTTP 200');
    console.log('  ✅ [PASS] Operación legítima no en cuarentena procesada exitosamente (HTTP 200).');
    passed++;

  } finally {
    // 9. Teardown Seguro incondicional en finally
    if (fixturesCreated && conn) {
      console.log('\n[TEARDOWN] Purgando fixtures sintéticos en bloque finally...');
      try {
        for (const fix of QUARANTINED_FIXTURES) {
          await conn.query('DELETE FROM pending_tenant_reconciliations WHERE table_name = ? AND record_id = ?', [fix.table, fix.id]);
          if (fix.table === 'salons') {
            await conn.query('DELETE FROM salons WHERE id = ?', [fix.id]);
          } else if (fix.table === 'cash_registers') {
            await conn.query('DELETE FROM cash_registers WHERE id = ?', [fix.id]);
          } else if (fix.table === 'visits') {
            await conn.query('DELETE FROM visits WHERE id = ?', [fix.id]);
          } else if (fix.table === 'ticket_sequences') {
            await conn.query('DELETE FROM ticket_sequences WHERE id = ?', [fix.id]);
          }
        }
        await conn.query('DELETE FROM user_sessions WHERE id = ?', [SYNTHETIC_SESSION_ID]);
        await conn.query('DELETE FROM users WHERE id = ?', [SYNTHETIC_USER_ID]);
        await conn.query('DELETE FROM branches WHERE id = ?', [SYNTHETIC_BRANCH_ID]);
        await conn.query('DELETE FROM tenants WHERE id = ?', [SYNTHETIC_TENANT_ID]);

        // Verificación estricta post-cleanup: ninguno de los 7 fixtures debe existir
        for (const fix of QUARANTINED_FIXTURES) {
          const [checkRows] = await conn.query(`SELECT id FROM ${fix.table} WHERE id = ?`, [fix.id]);
          assert.strictEqual(checkRows.length, 0, `Fixture ${fix.id} must be deleted`);
          const [checkRecon] = await conn.query('SELECT record_id FROM pending_tenant_reconciliations WHERE record_id = ?', [fix.id]);
          assert.strictEqual(checkRecon.length, 0, `Reconciliation record ${fix.id} must be deleted`);
        }
        console.log('  ✅ [PASS] Fixtures sintéticos purgados y verificados al 100% (0 registros sintéticos restantes).\n');
      } catch (cleanupErr) {
        console.error('❌ [CLEANUP ERROR]:', cleanupErr.message);
      }
    }

    if (conn) {
      conn.release();
    }
    if (pool) {
      await pool.end();
    }

    // Esperar terminación efectiva del proceso hijo
    if (childProcess) {
      await terminateProcess(childProcess);
      console.log('  ✅ [PASS] Subproceso de servidor finalizado y esperado exitosamente.');
    }
  }

  console.log('========================================================================');
  console.log(`🎉 TODAS LAS ${passed} VERIFICACIONES CANÓNICAS DE CUARENTENA APROBADAS`);
  console.log('========================================================================\n');
  process.exit(0);
}

if (require.main === module) {
  runSyntheticQuarantineSuite().catch(err => {
    console.error('\n❌ [FATAL QUARANTINE TEST ERROR]:', err);
    process.exit(1);
  });
}

module.exports = { runSyntheticQuarantineSuite };
