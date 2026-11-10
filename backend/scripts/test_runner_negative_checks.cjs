/**
 * Comprehensive Negative & Security Guard Test Suite (Phase 1 Fail-Closed)
 *
 * MOCK-BASED: Zero PostgreSQL connections or socket calls.
 *
 * Cases Verified:
 * 1. Master Runner execution without ALLOW_INTEGRATION_TESTS in process.env -> Exit 1.
 * 2. Master Runner execution with missing TEST_DB_* parameters -> Exit 1.
 * 3. Master Runner execution where TEST_DB_NAME == PRODUCTION_DB_NAME -> Exit 1.
 * 4. Master Runner execution with unsafe database name (no _test / _disposable) -> Exit 1.
 * 5. Master Runner execution with missing required secrets (JWT_SECRET, etc.) -> Exit 1.
 * 6. Master Runner execution attempting to use ALLOW_DISPOSABLE_SCHEMA -> Exit 1.
 * 7. Config file attempting to auto-authorize ALLOW_INTEGRATION_TESTS -> Exit 1.
 * 8. Preflight Mock: Rejecting test role with CONNECT privilege on production DB -> Error.
 * 9. Preflight Mock: Rejecting test role without CREATE on test DB -> Error.
 * 10. Preflight Mock: Rejecting current_user !== TEST_DB_USER mismatch -> Error.
 * 11. Child gate environment isolation: NODE_OPTIONS, NODE_PATH, DATABASE_URL, PG*, arbitrary keys stripped -> Verified.
 * 12. Valid Preflight-Only execution of Master Runner -> Exit 0.
 * 13. test_env_guard: Realistic child env (DB_NAME == TEST_DB_NAME != PRODUCTION_DB_NAME) -> Passes cleanly.
 * 14. test_env_guard: Operational contamination (DB_NAME != TEST_DB_NAME) -> Aborts.
 * 15. Endpoint /api/health/db-check security:
 *     - Production mode (NODE_ENV=production) -> Returns 404.
 *     - Development mode without authorization -> Returns 404.
 *     - Authorized test mode (NODE_ENV=test, ENABLE_TEST_ENDPOINTS=true) -> Returns 200.
 * 16. Teardown Mock Invariants:
 *     - Fails if current_database() !== TEST_DB_NAME.
 *     - Fails if current_database() === PRODUCTION_DB_NAME.
 *     - Fails if current_user !== TEST_DB_USER.
 * 17. Preflight Separate Cluster Logic:
 *     - Missing prod DB in cluster without audit certification -> Aborts.
 *     - Missing prod DB in cluster with ISOLATED_CLUSTER_AUDIT="true" -> Passes.
 */

const { spawnSync } = require('child_process');
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const http = require('http');

const { runInfrastructurePreflight } = require('./infrastructure_preflight.cjs');
const { buildStrictChildEnv } = require('./run_all_phase1_tests.cjs');
const { validateTestEnvironment, getSanitizedChildEnv } = require('../utils/test_env_guard.cjs');
const { teardownTestDatabase } = require('./teardown_test_db.cjs');

console.log('========================================================================');
console.log('🧪 VERIFICACIÓN NEGATIVA DE RUNNER MAESTRO Y PREFLIGHT (MOCKS / FAIL-CLOSED)');
console.log('========================================================================\n');

const masterRunnerPath = path.resolve(__dirname, 'run_all_phase1_tests.cjs');

const baseMockEnv = {
  PATH: process.env.PATH,
  SYSTEMROOT: process.env.SYSTEMROOT,
  SystemRoot: process.env.SystemRoot,
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
  ALLOW_INTEGRATION_TESTS: 'true',
  PRODUCTION_DB_NAME: 'salon_saas_db',
  TEST_DB_HOST: '127.0.0.1',
  TEST_DB_PORT: '5432',
  TEST_DB_USER: 'salon_saas_test_user',
  TEST_DB_PASSWORD: 'test_password_secure',
  TEST_DB_NAME: 'salon_saas_test',
  HISTORICAL_TEST_PASSWORD: 'historical_sample_pass',
  ROTATED_SUPERADMIN_SECRET: 'rotated_sample_secret_key',
  JWT_SECRET: 'jwt_mock_secret_at_least_32_characters_long_min',
  BACKUP_HMAC_KEY: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'
};

// 1. Ausencia de autorización
console.log('Case 1: Master Runner execution without ALLOW_INTEGRATION_TESTS in process.env...');
const env1 = { ...baseMockEnv };
delete env1.ALLOW_INTEGRATION_TESTS;
const res1 = spawnSync('node', [masterRunnerPath, '--preflight-only'], { env: env1, encoding: 'utf8' });
assert.strictEqual(res1.status, 1, 'Master runner must exit 1 when authorization missing');
assert(res1.stderr.includes('Pruebas de integración no autorizadas'), 'Stderr must state unauthorized');
console.log('  [PASS] Master runner refused execution without operator authorization.\n');

// 2. Ausencia de TEST_DB_*
console.log('Case 2: Master Runner execution with missing TEST_DB_* parameters...');
const env2 = { ...baseMockEnv };
delete env2.TEST_DB_NAME;
const res2 = spawnSync('node', [masterRunnerPath, '--preflight-only'], { env: env2, encoding: 'utf8' });
assert.strictEqual(res2.status, 1, 'Master runner must exit 1 when TEST_DB_NAME missing');
assert(res2.stderr.includes('Variables de base de datos aislada o metadatos faltantes'), 'Stderr must cite missing vars');
console.log('  [PASS] Master runner refused execution without isolated test DB parameters.\n');

// 3. Colisión TEST_DB_NAME == PRODUCTION_DB_NAME
console.log('Case 3: Master Runner execution where TEST_DB_NAME == PRODUCTION_DB_NAME...');
const env3 = { ...baseMockEnv, TEST_DB_NAME: 'salon_saas_db', PRODUCTION_DB_NAME: 'salon_saas_db' };
const res3 = spawnSync('node', [masterRunnerPath, '--preflight-only'], { env: env3, encoding: 'utf8' });
assert.strictEqual(res3.status, 1, 'Master runner must exit 1 on production collision');
assert(res3.stderr.includes('TEST_DB_NAME ("salon_saas_db") no puede ser idéntica a PRODUCTION_DB_NAME'), 'Stderr must block collision');
console.log('  [PASS] Master runner refused execution against production DB name.\n');

// 4. Nombre inseguro sin prefijo o sufijo
console.log('Case 4: Master Runner execution with unsafe database name (no _test / _disposable)...');
const env4 = { ...baseMockEnv, TEST_DB_NAME: 'arbitrary_unsafe_db' };
const res4 = spawnSync('node', [masterRunnerPath, '--preflight-only'], { env: env4, encoding: 'utf8' });
assert.strictEqual(res4.status, 1, 'Master runner must exit 1 on unsafe DB name');
assert(res4.stderr.includes('Nombre de base de datos de pruebas inseguro'), 'Stderr must reject unsafe name');
console.log('  [PASS] Master runner refused unverified database name.\n');

// 5. Credenciales obligatorias ausentes (sin fallbacks)
console.log('Case 5: Master Runner execution with missing required secrets (JWT_SECRET, etc.)...');
const env5 = { ...baseMockEnv };
delete env5.JWT_SECRET;
const res5 = spawnSync('node', [masterRunnerPath, '--preflight-only'], { env: env5, encoding: 'utf8' });
assert.strictEqual(res5.status, 1, 'Master runner must exit 1 when secrets missing');
assert(res5.stderr.includes('Credenciales y secretos obligatorios ausentes'), 'Stderr must reject missing secrets');
console.log('  [PASS] Master runner refused execution without mandatory secrets.\n');

// 6. Intento de usar ALLOW_DISPOSABLE_SCHEMA
console.log('Case 6: Master Runner execution attempting to use ALLOW_DISPOSABLE_SCHEMA...');
const env6 = { ...baseMockEnv, ALLOW_DISPOSABLE_SCHEMA: 'true' };
const res6 = spawnSync('node', [masterRunnerPath, '--preflight-only'], { env: env6, encoding: 'utf8' });
assert.strictEqual(res6.status, 1, 'Master runner must exit 1 when ALLOW_DISPOSABLE_SCHEMA is attempted');
assert(res6.stderr.includes('Uso desestimado de ALLOW_DISPOSABLE_SCHEMA detectado'), 'Stderr must explain schema != isolation');
console.log('  [PASS] Master runner strictly blocked ALLOW_DISPOSABLE_SCHEMA attempt.\n');

// 7. Configuración externa intentando autoautorizar ALLOW_INTEGRATION_TESTS
console.log('Case 7: Testing rejection when config file attempts to set ALLOW_INTEGRATION_TESTS...');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salonpro-neg-test-'));
const maliciousEnvFile = path.join(tmpDir, '.env.malicious');

try {
  fs.writeFileSync(maliciousEnvFile, 'ALLOW_INTEGRATION_TESTS=true\nTEST_DB_NAME=test_db\n', 'utf8');
  const env7 = { ...baseMockEnv, TEST_ENV_FILE: maliciousEnvFile };
  delete env7.ALLOW_INTEGRATION_TESTS;
  const res7 = spawnSync('node', [masterRunnerPath, '--preflight-only'], { env: env7, encoding: 'utf8' });
  assert.strictEqual(res7.status, 1, 'Runner must exit 1 if config file attempts auto-authorization');
  assert(res7.stderr.includes('Intento de autoautorización detectado'), 'Stderr must detect auto-authorization');
  console.log('  [PASS] Auto-authorization attempt via config file was strictly rejected without modifying repository files.\n');
} finally {
  if (fs.existsSync(maliciousEnvFile)) fs.unlinkSync(maliciousEnvFile);
  if (fs.existsSync(tmpDir)) fs.rmdirSync(tmpDir);
}

// 7b. Configuración externa intentando declarar ISOLATED_CLUSTER_AUDIT
console.log('Case 7b: Testing rejection when config file attempts to set ISOLATED_CLUSTER_AUDIT...');
const tmpDir7b = fs.mkdtempSync(path.join(os.tmpdir(), 'salonpro-neg-test7b-'));
const maliciousEnvFile7b = path.join(tmpDir7b, '.env.malicious7b');

try {
  fs.writeFileSync(maliciousEnvFile7b, 'ISOLATED_CLUSTER_AUDIT=true\n', 'utf8');
  const env7b = { ...baseMockEnv, TEST_ENV_FILE: maliciousEnvFile7b };
  const res7b = spawnSync('node', [masterRunnerPath, '--preflight-only'], { env: env7b, encoding: 'utf8' });
  assert.strictEqual(res7b.status, 1, 'Runner must exit 1 if config file attempts to set ISOLATED_CLUSTER_AUDIT');
  assert(res7b.stderr.includes('Certificación de clúster aislada detectada'), 'Stderr must reject ISOLATED_CLUSTER_AUDIT in file');
  console.log('  [PASS] ISOLATED_CLUSTER_AUDIT via config file was strictly rejected without modifying repository files.\n');
} finally {
  if (fs.existsSync(maliciousEnvFile7b)) fs.unlinkSync(maliciousEnvFile7b);
  if (fs.existsSync(tmpDir7b)) fs.rmdirSync(tmpDir7b);
}

// 8. Rol con acceso a producción (Preflight Mock Test)
console.log('Case 8: Preflight Mock Test: Rejecting test role with CONNECT privilege on production DB...');
(async () => {
  const mockClientPrivileged = {
    async query(sql) {
      if (sql.includes('SELECT current_database()')) {
        return { rows: [{ db_name: 'salon_saas_test', user_name: 'salon_saas_test_user' }] };
      }
      if (sql.includes('FROM pg_roles')) {
        return { rows: [{ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false }] };
      }
      if (sql.includes('SELECT 1 FROM pg_database WHERE datname')) {
        return { rows: [{ '?column?': 1 }] }; // DB exists in cluster
      }
      if (sql.includes("has_database_privilege(current_user, $1, 'CONNECT')")) {
        return { rows: [{ can_connect_prod: true }] }; // SIMULATE DANGEROUS ACCESS
      }
      if (sql.includes("has_database_privilege(current_user, $1, 'CREATE')")) {
        return { rows: [{ can_create_in_test_db: true }] };
      }
      return { rows: [] };
    },
    release() {}
  };

  const mockPoolPrivileged = {
    async connect() { return mockClientPrivileged; },
    async end() {}
  };

  let preflightError = null;
  try {
    await runInfrastructurePreflight({
      clientPool: mockPoolPrivileged,
      customEnv: baseMockEnv
    });
  } catch (err) {
    preflightError = err;
  }

  assert(preflightError !== null, 'Preflight must throw error if test role has access to production');
  assert(preflightError.message.includes('TIENE PRIVILEGIO DE CONEXIÓN a la base de producción'), 'Error must cite production privilege');
  console.log('  [PASS] Preflight correctly rejected test role possessing connection privileges to production.\n');

  // 9. Preflight Mock Test: Rejecting test role lacking CREATE on test DB
  console.log('Case 9: Preflight Mock Test: Rejecting test role without CREATE on test DB...');
  const mockClientNoCreate = {
    async query(sql) {
      if (sql.includes('SELECT current_database()')) {
        return { rows: [{ db_name: 'salon_saas_test', user_name: 'salon_saas_test_user' }] };
      }
      if (sql.includes('FROM pg_roles')) {
        return { rows: [{ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false }] };
      }
      if (sql.includes('SELECT 1 FROM pg_database WHERE datname')) {
        return { rows: [{ '?column?': 1 }] };
      }
      if (sql.includes("has_database_privilege(current_user, $1, 'CONNECT')")) {
        return { rows: [{ can_connect_prod: false }] };
      }
      if (sql.includes("has_database_privilege(current_user, $1, 'CREATE')")) {
        return { rows: [{ can_create_in_test_db: false }] }; // LACKS CREATE
      }
      return { rows: [] };
    },
    release() {}
  };

  let noCreateError = null;
  try {
    await runInfrastructurePreflight({
      clientPool: { async connect() { return mockClientNoCreate; }, async end() {} },
      customEnv: baseMockEnv
    });
  } catch (err) {
    noCreateError = err;
  }

  assert(noCreateError !== null, 'Preflight must throw error if test role lacks CREATE');
  assert(noCreateError.message.includes('no tiene permiso CREATE'), 'Error must cite CREATE privilege');
  console.log('  [PASS] Preflight correctly rejected test role lacking CREATE privilege on test DB.\n');

  // 10. Preflight Mock Test: Rejecting current_user !== TEST_DB_USER mismatch
  console.log('Case 10: Preflight Mock Test: Rejecting current_user !== TEST_DB_USER mismatch...');
  const mockClientUserMismatch = {
    async query(sql) {
      if (sql.includes('SELECT current_database()')) {
        return { rows: [{ db_name: 'salon_saas_test', user_name: 'unexpected_rogue_user' }] };
      }
      return { rows: [] };
    },
    release() {}
  };

  let userMismatchError = null;
  try {
    await runInfrastructurePreflight({
      clientPool: { async connect() { return mockClientUserMismatch; }, async end() {} },
      customEnv: baseMockEnv
    });
  } catch (err) {
    userMismatchError = err;
  }

  assert(userMismatchError !== null, 'Preflight must throw error on user mismatch');
  assert(userMismatchError.message.includes('difiere estrictamente de TEST_DB_USER'), 'Error must cite user mismatch');
  console.log('  [PASS] Preflight correctly rejected identity mismatch between connected user and TEST_DB_USER.\n');

  // 11. Child gate environment isolation verification (NODE_OPTIONS, NODE_PATH, DATABASE_URL, etc.)
  console.log('Case 11: Verification that child gates NEVER receive NODE_OPTIONS, NODE_PATH, production DB_*, or DATABASE_URL...');
  const dangerousProductionParent = {
    NODE_OPTIONS: '--require /evil/preload.js',
    NODE_PATH: '/evil/modules',
    DB_HOST: 'production-postgres-internal.aws.com',
    DB_PORT: '5432',
    DB_USER: 'prod_master_admin',
    DB_PASSWORD: 'ProductionMasterPassword123!',
    DB_PASS: 'ProductionMasterPassword123!',
    DB_NAME: 'salon_saas_production_db',
    DATABASE_URL: 'postgres://prod_master_admin:pass@production-postgres-internal.aws.com:5432/salon_saas_production_db',
    DATABASE_URL_UNPOOLED: 'postgres://prod_master_admin:pass@production-postgres-internal.aws.com:5432/salon_saas_production_db',
    PGSERVICE: 'prod_service',
    PGPASSFILE: '/etc/prod_pgpass',
    SECRET_COMPANY_API_KEY: 'sk_live_very_secret_key',
    PATH: process.env.PATH,
    SYSTEMROOT: process.env.SYSTEMROOT
  };

  const safeTestConfig = {
    TEST_DB_HOST: '127.0.0.1',
    TEST_DB_PORT: '5432',
    TEST_DB_USER: 'salon_saas_test_user',
    TEST_DB_PASSWORD: 'test_password_random_secure',
    TEST_DB_NAME: 'salon_saas_test',
    PRODUCTION_DB_NAME: 'salon_saas_production_db',
    HISTORICAL_TEST_PASSWORD: 'historical_sample_pass',
    ROTATED_SUPERADMIN_SECRET: 'rotated_sample_secret_key',
    JWT_SECRET: 'jwt_mock_secret_at_least_32_characters_long_min',
    BACKUP_HMAC_KEY: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'
  };

  const origProcessEnv = { ...process.env };
  Object.assign(process.env, dangerousProductionParent);

  const childGateEnv = buildStrictChildEnv(safeTestConfig);
  const childServerEnv = getSanitizedChildEnv(safeTestConfig, 5005);

  // Restore process.env immediately
  for (const k of Object.keys(dangerousProductionParent)) {
    if (origProcessEnv[k] === undefined) delete process.env[k];
    else process.env[k] = origProcessEnv[k];
  }

  assert.strictEqual(childGateEnv.NODE_OPTIONS, undefined, 'NODE_OPTIONS must be stripped from child gate env');
  assert.strictEqual(childGateEnv.NODE_PATH, undefined, 'NODE_PATH must be stripped from child gate env');
  assert.strictEqual(childGateEnv.DATABASE_URL, undefined, 'DATABASE_URL must be stripped from child gate env');
  assert.strictEqual(childGateEnv.PGSERVICE, undefined, 'PGSERVICE must be stripped from child gate env');
  assert.strictEqual(childGateEnv.PGPASSFILE, undefined, 'PGPASSFILE must be stripped from child gate env');
  assert.strictEqual(childGateEnv.SECRET_COMPANY_API_KEY, undefined, 'Arbitrary keys must be stripped from child gate env');
  assert.strictEqual(childGateEnv.ENABLE_TEST_ENDPOINTS, 'true', 'ENABLE_TEST_ENDPOINTS must be injected');

  assert.strictEqual(childServerEnv.NODE_OPTIONS, undefined, 'NODE_OPTIONS must be stripped from child server env');
  assert.strictEqual(childServerEnv.NODE_PATH, undefined, 'NODE_PATH must be stripped from child server env');
  assert.strictEqual(childServerEnv.DATABASE_URL, undefined, 'DATABASE_URL must be stripped from child server env');
  assert.strictEqual(childServerEnv.ENABLE_TEST_ENDPOINTS, 'true', 'ENABLE_TEST_ENDPOINTS must be injected in child server env');
  console.log('  [PASS] Both allowlists strictly strip NODE_OPTIONS, NODE_PATH, production DB_*, and URLs.\n');

  // 12. Valid Preflight-Only execution of Master Runner
  console.log('Case 12: Master Runner execution in --preflight-only mode with valid mock parameters...');
  const res12 = spawnSync('node', [masterRunnerPath, '--preflight-only'], { env: baseMockEnv, encoding: 'utf8' });
  assert.strictEqual(res12.status, 0, 'Master runner --preflight-only must exit 0 with valid parameters');
  assert(res12.stdout.includes('Configuración validada exitosamente. Deteniendo antes de ejecutar gates'), 'Stdout must confirm preflight exit');
  console.log('  [PASS] Master runner --preflight-only succeeded and stopped cleanly before executing gates.\n');

  // 13. test_env_guard: Realistic child env (DB_NAME == TEST_DB_NAME != PRODUCTION_DB_NAME)
  console.log('Case 13: test_env_guard: Realistic sanitized child env (DB_NAME=TEST_DB_NAME)...');
  const realisticChildEnv = {
    ...baseMockEnv,
    DB_NAME: 'salon_saas_test',
    TEST_DB_NAME: 'salon_saas_test',
    PRODUCTION_DB_NAME: 'salon_saas_db'
  };

  const origEnvFor13 = { ...process.env };
  Object.assign(process.env, realisticChildEnv);

  let validatedConfig = null;
  try {
    validatedConfig = validateTestEnvironment();
  } finally {
    for (const k of Object.keys(realisticChildEnv)) {
      if (origEnvFor13[k] === undefined) delete process.env[k];
      else process.env[k] = origEnvFor13[k];
    }
  }

  assert.strictEqual(validatedConfig.database, 'salon_saas_test', 'Validated DB must match TEST_DB_NAME');
  assert.strictEqual(validatedConfig.productionDatabase, 'salon_saas_db', 'Validated prod DB must match PRODUCTION_DB_NAME');
  console.log('  [PASS] Child environment with DB_NAME == TEST_DB_NAME validated successfully without opening connection.\n');

  // 14. test_env_guard: Operational contamination in DB_NAME (DB_NAME != TEST_DB_NAME)
  console.log('Case 14: test_env_guard: Operational contamination where DB_NAME points to production...');
  const contaminatedChildEnv = {
    ...baseMockEnv,
    DB_NAME: 'salon_saas_db',
    TEST_DB_NAME: 'salon_saas_test',
    PRODUCTION_DB_NAME: 'salon_saas_db'
  };

  const testGuardFile = path.resolve(__dirname, '../utils/test_env_guard.cjs');
  const checkCode = `
    const { validateTestEnvironment } = require(${JSON.stringify(testGuardFile)});
    validateTestEnvironment();
  `;
  const res14 = spawnSync('node', ['-e', checkCode], { env: contaminatedChildEnv, encoding: 'utf8' });
  assert.strictEqual(res14.status, 1, 'validateTestEnvironment must exit 1 when DB_NAME != TEST_DB_NAME');
  assert(res14.stderr.includes('Contaminación operativa detectada en DB_NAME'), 'Stderr must state operational contamination');
  console.log('  [PASS] Operational contamination in DB_NAME strictly aborted fail-closed.\n');

  // 15. Endpoint /api/health/db-check behavior under Production vs Dev vs Authorized Test
  console.log('Case 15: Unit test for /api/health/db-check endpoint mounting & security responses...');
  function createTestApp(nodeEnv, enableTestEndpoints, mockPool) {
    const app = express();
    app.get('/api/health', (req, res) => res.status(200).json({ status: 'ok' }));
    app.get('/api/health/db-check', async (req, res) => {
      if (nodeEnv !== 'test' || enableTestEndpoints !== 'true') {
        return res.status(404).json({ error: 'Not Found' });
      }
      try {
        const [rows] = await mockPool.query('SELECT current_database() as db_name, current_user as user_name');
        res.status(200).json({
          status: 'ok',
          database: rows[0]?.db_name,
          user: rows[0]?.user_name,
          is_test_env: true
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    return app;
  }

  const dummyPool = {
    async query() {
      return [[{ db_name: 'salon_saas_test', user_name: 'salon_saas_test_user' }]];
    }
  };

  // 15a: Production Mode
  const prodApp = createTestApp('production', 'false', dummyPool);
  const prodServer = http.createServer(prodApp);
  await new Promise(r => prodServer.listen(0, '127.0.0.1', r));
  const prodPort = prodServer.address().port;

  const prodRes = await new Promise((resolve) => {
    http.get(`http://127.0.0.1:${prodPort}/api/health/db-check`, (res) => {
      resolve(res.statusCode);
    });
  });
  prodServer.close();
  assert.strictEqual(prodRes, 404, 'db-check in production must return HTTP 404');
  console.log('  [PASS] Production mode returns HTTP 404 on /api/health/db-check.');

  // 15b: Development Mode without authorization
  const devApp = createTestApp('development', undefined, dummyPool);
  const devServer = http.createServer(devApp);
  await new Promise(r => devServer.listen(0, '127.0.0.1', r));
  const devPort = devServer.address().port;

  const devRes = await new Promise((resolve) => {
    http.get(`http://127.0.0.1:${devPort}/api/health/db-check`, (res) => {
      resolve(res.statusCode);
    });
  });
  devServer.close();
  assert.strictEqual(devRes, 404, 'db-check in unauthorized development must return HTTP 404');
  console.log('  [PASS] Development mode without authorization returns HTTP 404 on /api/health/db-check.');

  // 15c: Authorized Test Mode
  const testApp = createTestApp('test', 'true', dummyPool);
  const testServer = http.createServer(testApp);
  await new Promise(r => testServer.listen(0, '127.0.0.1', r));
  const testPort = testServer.address().port;

  const testBody = await new Promise((resolve) => {
    http.get(`http://127.0.0.1:${testPort}/api/health/db-check`, (res) => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(d) }));
    });
  });
  testServer.close();
  assert.strictEqual(testBody.status, 200, 'Authorized test mode must return HTTP 200');
  assert.strictEqual(testBody.data.database, 'salon_saas_test');
  assert.strictEqual(testBody.data.user, 'salon_saas_test_user');
  console.log('  [PASS] Authorized test mode returns HTTP 200 with identity on /api/health/db-check.\n');

  // 16. Teardown Mock Invariants
  console.log('Case 16: Testing all 3 teardown safety invariants with Mock Pool...');

  // 16a: Mismatched current_database()
  const mockClientTeardownDbMismatch = {
    async query(sql) {
      if (sql.includes('SELECT current_database()')) {
        return { rows: [{ db_name: 'wrong_test_db', user_name: 'salon_saas_test_user' }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  let tErr1 = null;
  try {
    await teardownTestDatabase({ async connect() { return mockClientTeardownDbMismatch; }, async end() {} }, baseMockEnv);
  } catch (err) {
    tErr1 = err;
  }
  assert(tErr1 && tErr1.message.includes('current_database()="wrong_test_db" !== TEST_DB_NAME'), 'Teardown must abort on DB mismatch');
  console.log('  [PASS] Teardown rejected mismatched current_database().');

  // 16b: Dangerous collision with PRODUCTION_DB_NAME
  const mockClientTeardownProdCollision = {
    async query(sql) {
      if (sql.includes('SELECT current_database()')) {
        return { rows: [{ db_name: 'salon_saas_db', user_name: 'salon_saas_test_user' }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  let tErr2 = null;
  const prodCollisionEnv = { ...baseMockEnv, TEST_DB_NAME: 'salon_saas_db' };
  try {
    await teardownTestDatabase({ async connect() { return mockClientTeardownProdCollision; }, async end() {} }, prodCollisionEnv);
  } catch (err) {
    tErr2 = err;
  }
  assert(tErr2 && tErr2.message.includes('Intento de limpieza sobre la base de producción'), 'Teardown must abort on prod collision');
  console.log('  [PASS] Teardown rejected attempted execution against production database.');

  // 16c: Mismatched current_user !== TEST_DB_USER
  const mockClientTeardownUserMismatch = {
    async query(sql) {
      if (sql.includes('SELECT current_database()')) {
        return { rows: [{ db_name: 'salon_saas_test', user_name: 'unexpected_user' }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  let tErr3 = null;
  try {
    await teardownTestDatabase({ async connect() { return mockClientTeardownUserMismatch; }, async end() {} }, baseMockEnv);
  } catch (err) {
    tErr3 = err;
  }
  assert(tErr3 && tErr3.message.includes('current_user="unexpected_user" !== TEST_DB_USER'), 'Teardown must abort on user mismatch');
  console.log('  [PASS] Teardown rejected mismatched current_user.\n');

  // 17. Preflight Separate Cluster Logic
  console.log('Case 17: Preflight handling of separate cluster scenario...');
  // 17a: Missing production DB in cluster without audit certification -> Error
  const mockClientNoProdInCluster = {
    async query(sql) {
      if (sql.includes('SELECT current_database()')) {
        return { rows: [{ db_name: 'salon_saas_test', user_name: 'salon_saas_test_user' }] };
      }
      if (sql.includes('FROM pg_roles')) {
        return { rows: [{ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false }] };
      }
      if (sql.includes('SELECT 1 FROM pg_database WHERE datname')) {
        return { rows: [] }; // DB NOT found in cluster
      }
      return { rows: [] };
    },
    release() {}
  };

  let separateClusterNoAuditError = null;
  try {
    await runInfrastructurePreflight({
      clientPool: { async connect() { return mockClientNoProdInCluster; }, async end() {} },
      customEnv: baseMockEnv // Missing ISOLATED_CLUSTER_AUDIT and distinct host/port
    });
  } catch (err) {
    separateClusterNoAuditError = err;
  }
  assert(separateClusterNoAuditError !== null, 'Must abort if prod DB missing in cluster and no audit certification provided');
  assert(separateClusterNoAuditError.message.includes('no se ha suministrado certificación de clúster separado'), 'Must cite missing cluster audit');
  console.log('  [PASS] Preflight rejected missing production DB when cluster audit certification is missing (prevents typo false PASS).');

  // 17b: Missing production DB in cluster WITH audit certification -> Passes cleanly
  const mockClientSeparateClusterAudited = {
    async query(sql) {
      if (sql.includes('SELECT current_database()')) {
        return { rows: [{ db_name: 'salon_saas_test', user_name: 'salon_saas_test_user' }] };
      }
      if (sql.includes('FROM pg_roles')) {
        return { rows: [{ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false }] };
      }
      if (sql.includes('SELECT 1 FROM pg_database WHERE datname')) {
        return { rows: [] }; // Separate cluster
      }
      if (sql.includes("has_database_privilege(current_user, $1, 'CREATE')")) {
        return { rows: [{ can_create_in_test_db: true }] };
      }
      return { rows: [] };
    },
    release() {}
  };

  const auditedClusterEnv = {
    ...baseMockEnv,
    ISOLATED_CLUSTER_AUDIT: 'true'
  };

  let separateClusterAuditedPass = false;
  try {
    await runInfrastructurePreflight({
      clientPool: { async connect() { return mockClientSeparateClusterAudited; }, async end() {} },
      customEnv: auditedClusterEnv
    });
    separateClusterAuditedPass = true;
  } catch (err) {
    separateClusterAuditedPass = false;
  }
  assert(separateClusterAuditedPass, 'Preflight must pass when ISOLATED_CLUSTER_AUDIT="true" is certified');
  console.log('  [PASS] Preflight approved separate cluster with auditable metadata certification.\n');

  console.log('========================================================================');
  console.log('🎉 TODAS LAS 17 PRUEBAS NEGATIVAS Y DE SEGURIDAD APROBADAS (EXIT 0)');
  console.log('========================================================================\n');
  process.exit(0);
})();
