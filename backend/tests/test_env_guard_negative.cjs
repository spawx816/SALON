'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');

const guardPath = path.resolve(__dirname, '../utils/test_env_guard.cjs').replace(/\\/g, '/');

function runGuardWithEnv(envOverrides) {
  const cleanEnv = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    ...envOverrides,
  };
  return spawnSync(
    process.execPath,
    ['-e', `require('${guardPath}').validateTestEnvironment();`],
    { env: cleanEnv, encoding: 'utf8' }
  );
}

console.log('🛡️ Probando rechazo fail-closed de configuraciones operativas en test_env_guard...');

// 1. Sin ALLOW_INTEGRATION_TESTS='true'
const r1 = runGuardWithEnv({
  TEST_DB_HOST: '127.0.0.1',
  TEST_DB_PORT: '5432',
  TEST_DB_USER: 'test_runner',
  TEST_DB_PASSWORD: 'secret',
  TEST_DB_NAME: 'salon_saas_test',
  PRODUCTION_DB_NAME: 'salon_saas_prod',
});
assert.strictEqual(r1.status, 1, 'Debe abortar sin ALLOW_INTEGRATION_TESTS=true');

// 2. Sin TEST_DB_* explícitas (aunque exista DB_NAME)
const r2 = runGuardWithEnv({
  ALLOW_INTEGRATION_TESTS: 'true',
  DB_NAME: 'salon_saas_db',
  PRODUCTION_DB_NAME: 'salon_saas_prod',
});
assert.strictEqual(r2.status, 1, 'Debe abortar sin TEST_DB_* explícitas');

// 3. TEST_DB_NAME === PRODUCTION_DB_NAME
const r3 = runGuardWithEnv({
  ALLOW_INTEGRATION_TESTS: 'true',
  TEST_DB_HOST: '127.0.0.1',
  TEST_DB_PORT: '5432',
  TEST_DB_USER: 'test_runner',
  TEST_DB_PASSWORD: 'secret',
  TEST_DB_NAME: 'salon_saas_prod',
  PRODUCTION_DB_NAME: 'salon_saas_prod',
});
assert.strictEqual(r3.status, 1, 'Debe abortar si TEST_DB_NAME === PRODUCTION_DB_NAME');

// 4. DB_NAME contaminado !== TEST_DB_NAME
const r4 = runGuardWithEnv({
  ALLOW_INTEGRATION_TESTS: 'true',
  TEST_DB_HOST: '127.0.0.1',
  TEST_DB_PORT: '5432',
  TEST_DB_USER: 'test_runner',
  TEST_DB_PASSWORD: 'secret',
  TEST_DB_NAME: 'salon_saas_test',
  DB_NAME: 'salon_saas_db',
  PRODUCTION_DB_NAME: 'salon_saas_prod',
});
assert.strictEqual(r4.status, 1, 'Debe abortar si DB_NAME !== TEST_DB_NAME');

// 5. Nombre sin sufijo/prefijo seguro
const r5 = runGuardWithEnv({
  ALLOW_INTEGRATION_TESTS: 'true',
  TEST_DB_HOST: '127.0.0.1',
  TEST_DB_PORT: '5432',
  TEST_DB_USER: 'test_runner',
  TEST_DB_PASSWORD: 'secret',
  TEST_DB_NAME: 'salon_saas_db',
  PRODUCTION_DB_NAME: 'salon_saas_prod',
});
assert.strictEqual(r5.status, 1, 'Debe abortar si TEST_DB_NAME no termina/empieza con _test/_disposable');

console.log('  ✅ 5/5 casos negativos rechazaron configuraciones operativas sin conectar a ninguna BD.');
