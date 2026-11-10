/**
 * Test Environment Isolation Guard
 *
 * Strict, fail-closed enforcement of test database isolation:
 * 1. ALLOW_INTEGRATION_TESTS must be explicitly 'true' in process.env (never auto-enabled).
 * 2. Mandatory independent test DB variables:
 *    - TEST_DB_HOST
 *    - TEST_DB_PORT
 *    - TEST_DB_USER
 *    - TEST_DB_PASSWORD
 *    - TEST_DB_NAME
 *    - PRODUCTION_DB_NAME (mandatory for collision prevention)
 * 3. No fallback to DB_NAME, DB_HOST, or production config.
 * 4. TEST_DB_NAME must NEVER equal PRODUCTION_DB_NAME.
 * 5. If DB_NAME is set in environment, it must strictly match TEST_DB_NAME (fail closed on mismatch).
 * 6. TEST_DB_NAME must contain safe prefix/suffix (_test, _disposable, test_*, disposable_*).
 * 7. Returns sanitized test configuration or aborts process with exit code 1.
 */
const { Pool } = require('pg');

/**
 * Validates test environment variables with strict, fail-closed enforcement.
 * Note: allowDisposableSchema is accepted for backward signature compatibility only;
 * it grants ZERO exemption to physical database separation rules.
 */
function validateTestEnvironment({ _allowDisposableSchema = false } = {}) {
  // 1. Operator authorization check
  if (process.env.ALLOW_INTEGRATION_TESTS !== 'true') {
    console.error('\n❌ [FATAL SECURITY ABORT]: Pruebas de integración no autorizadas.');
    console.error('   Se requiere explícitamente ALLOW_INTEGRATION_TESTS="true" en el entorno del operador.');
    console.error('   El script de pruebas NUNCA se auto-habilita.');
    process.exit(1);
  }

  // 2. Mandatory TEST_DB_* parameters check
  const required = [
    'TEST_DB_HOST',
    'TEST_DB_PORT',
    'TEST_DB_USER',
    'TEST_DB_PASSWORD',
    'TEST_DB_NAME',
    'PRODUCTION_DB_NAME'
  ];

  const missing = required.filter(k => !process.env[k] || String(process.env[k]).trim() === '');
  if (missing.length > 0) {
    console.error('\n❌ [FATAL SECURITY ABORT]: Variables de entorno de base de datos aislada faltantes:');
    console.error(`   Faltan: ${missing.join(', ')}`);
    console.error('   Está terminantemente prohibido usar DB_NAME o la base de datos compartida para pruebas.');
    console.error('   PRODUCTION_DB_NAME es obligatorio para garantizar el aislamiento físico.');
    process.exit(1);
  }

  const testDbName = String(process.env.TEST_DB_NAME).trim();
  const prodDbName = String(process.env.PRODUCTION_DB_NAME).trim();

  // 3. Absolute refusal to run if TEST_DB_NAME equals PRODUCTION_DB_NAME
  if (testDbName.toLowerCase() === prodDbName.toLowerCase()) {
    console.error('\n❌ [FATAL SECURITY ABORT]: TEST_DB_NAME no puede ser idéntica a PRODUCTION_DB_NAME!');
    console.error(`   TEST_DB_NAME="${testDbName}" == PRODUCTION_DB_NAME="${prodDbName}"`);
    console.error('   Riesgo crítico de contaminación o destrucción de datos de producción/compartidos.');
    console.error('   La existencia de un schema desechable dentro de producción está estrictamente prohibida.');
    console.error('   Los esquemas desechables están permitidos únicamente dentro de una base física aislada (ej. salon_saas_test).');
    process.exit(1);
  }

  // 4. If DB_NAME is defined, strictly require that it equals TEST_DB_NAME
  if (process.env.DB_NAME && String(process.env.DB_NAME).trim() !== '') {
    const rawDbName = String(process.env.DB_NAME).trim();
    if (rawDbName.toLowerCase() !== testDbName.toLowerCase()) {
      console.error('\n❌ [FATAL SECURITY ABORT]: Contaminación operativa detectada en DB_NAME.');
      console.error(`   DB_NAME="${rawDbName}" !== TEST_DB_NAME="${testDbName}".`);
      console.error('   Si DB_NAME está definida, debe coincidir exactamente con TEST_DB_NAME.');
      process.exit(1);
    }
  }

  // 5. Suffix / prefix security constraint (Must be an explicit test database)
  const isSafeName = (
    testDbName.endsWith('_test') ||
    testDbName.endsWith('_disposable') ||
    testDbName.startsWith('test_') ||
    testDbName.startsWith('disposable_')
  );

  if (!isSafeName) {
    console.error('\n❌ [FATAL SECURITY ABORT]: Nombre de base de datos de pruebas inseguro.');
    console.error(`   TEST_DB_NAME="${testDbName}" debe comenzar o terminar con _test o _disposable.`);
    process.exit(1);
  }

  return {
    host: process.env.TEST_DB_HOST,
    port: parseInt(process.env.TEST_DB_PORT, 10),
    user: process.env.TEST_DB_USER,
    password: process.env.TEST_DB_PASSWORD,
    database: testDbName,
    productionDatabase: prodDbName
  };
}

/**
 * Creates an isolated PostgreSQL connection pool for the test runner.
 */
function createIsolatedTestPool(config) {
  const pgPool = new Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    max: 10,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000
  });

  pgPool.on('error', (err) => {
    console.error('[ISOLATED TEST POOL ERROR]:', err.message);
  });

  function normalizeSql(sql) {
    if (!sql || typeof sql !== 'string') return sql;
    let s = sql;
    let index = 1;
    s = s.replace(/\?/g, () => `$${index++}`);
    return s.trim().replace(/;\s*$/g, '');
  }

  function wrapResult(res) {
    const rows = res.rows || [];
    rows.rowCount = res.rowCount;
    rows.affectedRows = res.rowCount;
    const tuple = [rows, res.fields];
    tuple.rows = rows;
    tuple.rowCount = res.rowCount;
    tuple.fields = res.fields;
    return tuple;
  }

  return {
    isPostgres: true,
    rawPool: pgPool,
    async query(sql, params = []) {
      const pgSql = normalizeSql(sql);
      const res = await pgPool.query(pgSql, params);
      return wrapResult(res);
    },
    async execute(sql, params = []) {
      return this.query(sql, params);
    },
    async getConnection() {
      const client = await pgPool.connect();
      return {
        async query(sql, params = []) {
          const pgSql = normalizeSql(sql);
          const res = await client.query(pgSql, params);
          return wrapResult(res);
        },
        async beginTransaction() {
          await client.query('BEGIN');
        },
        async commit() {
          await client.query('COMMIT');
        },
        async rollback() {
          await client.query('ROLLBACK');
        },
        release() {
          client.release();
        }
      };
    },
    async end() {
      return pgPool.end();
    }
  };
}

function getSanitizedChildEnv(testDbConfig, port) {
  // Allowlist estricto de variables del sistema operativo necesarias para Node
  // Excluye explícitamente NODE_OPTIONS y NODE_PATH para impedir inyección de precargas
  const allowedSystemKeys = [
    'PATH', 'Path', 'path',
    'PATHEXT', 'SystemRoot', 'SystemDrive', 'windir', 'WINDIR',
    'COMSPEC', 'ComSpec', 'comspec',
    'TEMP', 'TMP', 'TMPDIR',
    'USERPROFILE', 'HOME', 'HOMEDRIVE', 'HOMEPATH',
    'APPDATA', 'LOCALAPPDATA',
    'NODE',
    'LANG', 'LC_ALL', 'TERM'
  ];

  const childEnv = {};
  for (const k of allowedSystemKeys) {
    if (process.env[k] !== undefined) {
      childEnv[k] = process.env[k];
    }
  }

  // Asigna explícitamente desde testDbConfig y fuerza modo test
  childEnv.NODE_ENV = 'test';
  childEnv.ALLOW_INTEGRATION_TESTS = 'true';
  childEnv.ENABLE_TEST_ENDPOINTS = 'true';
  childEnv.DB_TYPE = 'postgres';

  childEnv.DB_HOST = testDbConfig.host;
  childEnv.DB_PORT = String(testDbConfig.port);
  childEnv.DB_USER = testDbConfig.user;
  childEnv.DB_PASS = testDbConfig.password;
  childEnv.DB_PASSWORD = testDbConfig.password;
  childEnv.DB_NAME = testDbConfig.database;

  childEnv.TEST_DB_HOST = testDbConfig.host;
  childEnv.TEST_DB_PORT = String(testDbConfig.port);
  childEnv.TEST_DB_USER = testDbConfig.user;
  childEnv.TEST_DB_PASSWORD = testDbConfig.password;
  childEnv.TEST_DB_NAME = testDbConfig.database;

  const prodDb = testDbConfig.productionDatabase || testDbConfig.PRODUCTION_DB_NAME || process.env.PRODUCTION_DB_NAME;
  if (!prodDb || String(prodDb).trim() === '') {
    throw new Error('PRODUCTION_DB_NAME must be explicitly provided in testDbConfig or environment');
  }
  childEnv.PRODUCTION_DB_NAME = String(prodDb).trim();

  if (port) {
    childEnv.PORT = String(port);
  }

  if (process.env.JWT_SECRET) childEnv.JWT_SECRET = process.env.JWT_SECRET;
  if (process.env.HISTORICAL_TEST_PASSWORD) childEnv.HISTORICAL_TEST_PASSWORD = process.env.HISTORICAL_TEST_PASSWORD;
  if (process.env.ROTATED_SUPERADMIN_SECRET) childEnv.ROTATED_SUPERADMIN_SECRET = process.env.ROTATED_SUPERADMIN_SECRET;
  if (process.env.BACKUP_HMAC_KEY) childEnv.BACKUP_HMAC_KEY = process.env.BACKUP_HMAC_KEY;

  // Purga explícita de variables de precarga, redirección y operativas peligrosas
  const prohibitedKeys = [
    'NODE_OPTIONS', 'NODE_PATH',
    'DATABASE_URL', 'DATABASE_URL_UNPOOLED',
    'PGSERVICE', 'PGSERVICESFILE', 'PGPASSFILE', 'PGDATABASE', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD',
    'DB_URL', 'MYSQL_URL', 'POSTGRES_URL',
    'ALLOW_DISPOSABLE_SCHEMA'
  ];

  for (const k of prohibitedKeys) {
    delete childEnv[k];
  }

  return childEnv;
}

module.exports = {
  validateTestEnvironment,
  createIsolatedTestPool,
  getSanitizedChildEnv
};
