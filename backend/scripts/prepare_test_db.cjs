/**
 * Gate 0.5: Prepare & Reset Physical Test Database (salon_saas_test)
 *
 * Deterministically resets the public schema within the isolated test database
 * so migrations (Gate 0.6) and fixtures (Gate 0.7) can run cleanly from scratch.
 *
 * SAFETY INVARIANTS:
 * - Only operates if current_database() === TEST_DB_NAME and !== PRODUCTION_DB_NAME.
 * - Strictly verifies current_user === TEST_DB_USER.
 * - Prohibited from running on production.
 */

const { Pool } = require('pg');
const { validateTestEnvironment } = require('../utils/test_env_guard.cjs');

async function prepareTestDatabase(customPool = null) {
  console.log('========================================================================');
  console.log('🧹 GATE 0.5: PREPARACIÓN Y REINICIO DETERMINISTA DE BASE DE PRUEBAS');
  console.log('========================================================================\n');

  const testConfig = validateTestEnvironment();
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
    // 1. Verify Identity and Database Name
    const dbRes = await client.query('SELECT current_database() as db_name, current_user as user_name');
    const currentDb = dbRes.rows[0]?.db_name;
    const currentUser = dbRes.rows[0]?.user_name;

    console.log(`[CONEXIÓN] Base de datos activa: "${currentDb}" | Usuario: "${currentUser}"`);

    if (currentDb !== testConfig.database) {
      throw new Error(`SECURITY HALT: current_database()="${currentDb}" !== TEST_DB_NAME="${testConfig.database}"`);
    }

    const prodDbName = String(process.env.PRODUCTION_DB_NAME || '').trim();
    if (prodDbName && currentDb.toLowerCase() === prodDbName.toLowerCase()) {
      throw new Error(`FATAL SECURITY ABORT: Intento de reinicio sobre la base de producción "${prodDbName}"!`);
    }

    if (currentUser !== testConfig.user) {
      throw new Error(`SECURITY HALT: current_user="${currentUser}" !== TEST_DB_USER="${testConfig.user}"`);
    }

    // 2. Deterministic cleanup of public schema objects in test database
    console.log(`[REINICIO] Purgando tablas, funciones y secuencias preexistentes en "${testConfig.database}".public...`);

    // Drop all triggers in public schema
    const trgRes = await client.query(`
      SELECT trigger_name, event_object_table
      FROM information_schema.triggers
      WHERE trigger_schema = 'public';
    `);
    for (const trg of trgRes.rows) {
      await client.query(`DROP TRIGGER IF EXISTS "${trg.trigger_name}" ON "public"."${trg.event_object_table}" CASCADE;`);
    }

    // Drop all tables in public schema
    const tablesRes = await client.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public';
    `);
    for (const t of tablesRes.rows) {
      await client.query(`DROP TABLE IF EXISTS "public"."${t.tablename}" CASCADE;`);
    }

    // Drop custom functions
    await client.query('DROP FUNCTION IF EXISTS public.fn_enforce_quarantine_block() CASCADE;');

    // Drop sequences
    const seqRes = await client.query(`
      SELECT sequence_name 
      FROM information_schema.sequences 
      WHERE sequence_schema = 'public';
    `);
    for (const s of seqRes.rows) {
      await client.query(`DROP SEQUENCE IF EXISTS "public"."${s.sequence_name}" CASCADE;`);
    }

    // 3. Verify public schema is completely clean
    const verifyRes = await client.query(`
      SELECT COUNT(*) as cnt 
      FROM pg_tables 
      WHERE schemaname = 'public';
    `);
    const remainingTables = parseInt(verifyRes.rows[0]?.cnt || 0, 10);

    if (remainingTables !== 0) {
      throw new Error(`Fallo al purgar base de pruebas: aún quedan ${remainingTables} tablas en el esquema public.`);
    }

    console.log(`  ✅ [PASS] Base de pruebas "${testConfig.database}" purgada exitosamente (0 tablas en public).`);
    console.log('  ✅ [PASS] Lista para ejecución limpia de migraciones desde cero (Gate 0.6).\n');
    return true;
  } finally {
    client.release();
    if (!customPool) {
      await pool.end();
    }
  }
}

if (require.main === module) {
  prepareTestDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`\n❌ [GATE 0.5 FAILED]: ${err.message}\n`);
      process.exit(1);
    });
}

module.exports = { prepareTestDatabase };

