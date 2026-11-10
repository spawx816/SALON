/**
 * Final Teardown: Clean Test Database (salon_saas_test)
 *
 * Removes ephemeral fixtures, test schemas, or cleans objects created during the test run.
 *
 * SAFETY INVARIANTS (FAIL-CLOSED):
 * 1. current_database() === TEST_DB_NAME
 * 2. current_database() !== PRODUCTION_DB_NAME
 * 3. current_user === TEST_DB_USER
 */

const { Pool } = require('pg');
const { validateTestEnvironment } = require('../utils/test_env_guard.cjs');

async function teardownTestDatabase(customPool = null, customEnv = null) {
  console.log('========================================================================');
  console.log('🧹 TEARDOWN: LIMPIEZA FINAL DE LA BASE DE PRUEBAS FÍSICA');
  console.log('========================================================================\n');

  const testConfig = customEnv ? {
    host: customEnv.TEST_DB_HOST,
    port: parseInt(customEnv.TEST_DB_PORT, 10),
    user: customEnv.TEST_DB_USER,
    password: customEnv.TEST_DB_PASSWORD,
    database: customEnv.TEST_DB_NAME,
    productionDatabase: customEnv.PRODUCTION_DB_NAME
  } : validateTestEnvironment();

  const pool = customPool || new Pool({
    host: testConfig.host,
    port: testConfig.port,
    user: testConfig.user,
    password: testConfig.password,
    database: testConfig.database,
    connectionTimeoutMillis: 5000
  });

  const client = await pool.connect();

  try {
    const dbRes = await client.query('SELECT current_database() as db_name, current_user as user_name');
    const currentDb = dbRes.rows[0]?.db_name;
    const currentUser = dbRes.rows[0]?.user_name;

    // Condition 1: current_database() === TEST_DB_NAME
    if (currentDb !== testConfig.database) {
      throw new Error(`SECURITY HALT: current_database()="${currentDb}" !== TEST_DB_NAME="${testConfig.database}"`);
    }

    // Condition 2: current_database() !== PRODUCTION_DB_NAME
    const prodDbName = String(testConfig.productionDatabase || process.env.PRODUCTION_DB_NAME || '').trim();
    if (!prodDbName) {
      throw new Error('SECURITY HALT: PRODUCTION_DB_NAME es obligatorio para validar el teardown.');
    }
    if (currentDb.toLowerCase() === prodDbName.toLowerCase()) {
      throw new Error(`FATAL SECURITY ABORT: Intento de limpieza sobre la base de producción "${prodDbName}"!`);
    }

    // Condition 3: current_user === TEST_DB_USER
    if (currentUser !== testConfig.user) {
      throw new Error(`SECURITY HALT: current_user="${currentUser}" !== TEST_DB_USER="${testConfig.user}"`);
    }

    // Drop any ephemeral test schemas left by tests (e.g. disposable_*, quarantine_test_*, etc.)
    const schemasRes = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'disposable_%' 
         OR schema_name LIKE 'quarantine_test_%'
         OR schema_name LIKE '_preflight_%';
    `);

    for (const row of schemasRes.rows) {
      console.log(`  [CLEANUP] Eliminando esquema residual de prueba: "${row.schema_name}"...`);
      await client.query(`DROP SCHEMA IF EXISTS "${row.schema_name}" CASCADE;`);
    }

    console.log('  ✅ [PASS] Limpieza final de base de pruebas completada exitosamente.\n');
    return true;
  } finally {
    client.release();
    if (!customPool) {
      await pool.end();
    }
  }
}

if (require.main === module) {
  teardownTestDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`\n❌ [TEARDOWN FAILED]: ${err.message}\n`);
      process.exit(1);
    });
}

module.exports = { teardownTestDatabase };
