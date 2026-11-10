/**
 * Infrastructure Preflight Verification Guard (Fase 1)
 *
 * Verifies physical database isolation, test role constraints, and guarantees
 * that the test role has ZERO connectivity or privileges on the production database.
 *
 * Requirements:
 * 1. current_database() === TEST_DB_NAME
 * 2. current_user === TEST_DB_USER
 * 3. current_database() !== PRODUCTION_DB_NAME
 * 4. rolsuper === false
 * 5. rolcreatedb === false
 * 6. rolcreaterole === false
 * 7. rolbypassrls === false
 * 8. Isolation vs Production:
 *    - If PRODUCTION_DB_NAME exists in cluster: has_database_privilege('CONNECT') === false
 *    - If PRODUCTION_DB_NAME not in cluster: requires auditable cluster metadata (ISOLATED_CLUSTER_AUDIT="true" or distinct host/port)
 * 9. Explicit CREATE privilege on test database
 * 10. Can create and drop objects strictly in test database
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

async function runInfrastructurePreflight({ clientPool = null, customEnv = null } = {}) {
  console.log('========================================================================');
  console.log('🛡️ PREFLIGHT REAL DE INFRAESTRUCTURA Y AISLAMIENTO FÍSICO (FASE 1)');
  console.log('========================================================================\n');

  const envSource = customEnv || process.env;

  // 1. Mandatory environment checks
  if (envSource.ALLOW_INTEGRATION_TESTS !== 'true') {
    console.error('❌ [PREFLIGHT ABORT]: ALLOW_INTEGRATION_TESTS="true" es obligatorio en process.env.');
    if (!clientPool) process.exit(1);
    throw new Error('ALLOW_INTEGRATION_TESTS="true" obligatorio');
  }

  if (envSource.ALLOW_DISPOSABLE_SCHEMA === 'true') {
    console.error('❌ [PREFLIGHT ABORT]: ALLOW_DISPOSABLE_SCHEMA está terminantemente prohibido como sustituto de aislamiento físico.');
    if (!clientPool) process.exit(1);
    throw new Error('ALLOW_DISPOSABLE_SCHEMA está terminantemente prohibido como sustituto de aislamiento físico');
  }

  const requiredVars = [
    'TEST_DB_HOST',
    'TEST_DB_PORT',
    'TEST_DB_USER',
    'TEST_DB_PASSWORD',
    'TEST_DB_NAME',
    'PRODUCTION_DB_NAME'
  ];

  const missing = requiredVars.filter(v => !envSource[v] || String(envSource[v]).trim() === '');
  if (missing.length > 0) {
    console.error(`❌ [PREFLIGHT ABORT]: Variables obligatorias faltantes: [${missing.join(', ')}].`);
    if (!clientPool) process.exit(1);
    throw new Error(`Variables obligatorias faltantes: ${missing.join(', ')}`);
  }

  const testDbName = String(envSource.TEST_DB_NAME).trim();
  const prodDbName = String(envSource.PRODUCTION_DB_NAME).trim();

  // 2. Physical database collision check
  if (testDbName.toLowerCase() === prodDbName.toLowerCase()) {
    console.error(`❌ [PREFLIGHT ABORT]: TEST_DB_NAME ("${testDbName}") no puede ser idéntica a PRODUCTION_DB_NAME ("${prodDbName}").`);
    if (!clientPool) process.exit(1);
    throw new Error('TEST_DB_NAME no puede ser idéntica a PRODUCTION_DB_NAME');
  }

  // 3. Safe test database naming convention check
  const isSafeName = (
    testDbName.endsWith('_test') ||
    testDbName.endsWith('_disposable') ||
    testDbName.startsWith('test_') ||
    testDbName.startsWith('disposable_')
  );
  if (!isSafeName) {
    console.error(`❌ [PREFLIGHT ABORT]: TEST_DB_NAME ("${testDbName}") debe comenzar o terminar con _test o _disposable.`);
    if (!clientPool) process.exit(1);
    throw new Error('Nombre de base de datos de pruebas inseguro');
  }

  // 4. Acquire connection to TEST_DB
  const pool = clientPool || new Pool({
    host: envSource.TEST_DB_HOST,
    port: parseInt(envSource.TEST_DB_PORT, 10),
    user: envSource.TEST_DB_USER,
    password: envSource.TEST_DB_PASSWORD,
    database: testDbName,
    connectionTimeoutMillis: 5000
  });

  const client = await pool.connect();

  try {
    console.log(`[CONEXIÓN] Conectado exitosamente a host "${envSource.TEST_DB_HOST}:${envSource.TEST_DB_PORT}".`);

    // Check 1: current_database()
    const dbRes = await client.query('SELECT current_database() AS db_name, current_user AS user_name');
    const currentDb = dbRes.rows[0]?.db_name;
    const currentUser = dbRes.rows[0]?.user_name;

    console.log(`[IDENTIDAD] Base de datos activa: "${currentDb}" | Usuario activo: "${currentUser}"`);

    if (currentDb !== testDbName) {
      throw new Error(`Desincronización de base: current_database()="${currentDb}" !== TEST_DB_NAME="${testDbName}"`);
    }
    console.log('  ✅ [PASS] current_database() coincide exactamente con TEST_DB_NAME.');

    if (currentUser !== envSource.TEST_DB_USER) {
      throw new Error(`SECURITY HALT: current_user="${currentUser}" difiere estrictamente de TEST_DB_USER="${envSource.TEST_DB_USER}". Discrepancia bloqueante.`);
    }
    console.log('  ✅ [PASS] current_user coincide con TEST_DB_USER.');

    // Check 2: currentDb !== prodDbName
    if (currentDb === prodDbName) {
      throw new Error(`FATAL: La base conectada es la base de producción "${prodDbName}"!`);
    }
    console.log(`  ✅ [PASS] Base de datos conectada es distinta de PRODUCTION_DB_NAME ("${prodDbName}").`);

    // Check 3: Role privileges (Must NOT be superuser, createdb, createrole, bypassrls)
    const roleRes = await client.query(`
      SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
      FROM pg_roles
      WHERE rolname = current_user
    `);

    if (roleRes.rows.length === 0) {
      throw new Error(`No se encontraron metadatos en pg_roles para el usuario "${currentUser}"`);
    }

    const role = roleRes.rows[0];
    console.log(`[PRIVILEGIOS DE ROL] Superuser: ${role.rolsuper} | CreateDB: ${role.rolcreatedb} | CreateRole: ${role.rolcreaterole} | BypassRLS: ${role.rolbypassrls}`);

    if (role.rolsuper) {
      throw new Error(`SECURITY HALT: El rol de pruebas "${currentUser}" tiene permisos de SUPERUSER! Debe ser un rol no privilegiado.`);
    }
    console.log('  ✅ [PASS] El rol de pruebas NO es superusuario (rolsuper = false).');

    if (role.rolcreatedb) {
      throw new Error(`SECURITY HALT: El rol de pruebas "${currentUser}" tiene permiso CREATEDB! No debe poder crear bases arbitrarias.`);
    }
    console.log('  ✅ [PASS] El rol de pruebas NO tiene permiso CREATEDB (rolcreatedb = false).');

    if (role.rolcreaterole) {
      throw new Error(`SECURITY HALT: El rol de pruebas "${currentUser}" tiene permiso CREATEROLE!`);
    }
    console.log('  ✅ [PASS] El rol de pruebas NO tiene permiso CREATEROLE (rolcreaterole = false).');

    if (role.rolbypassrls) {
      throw new Error(`SECURITY HALT: El rol de pruebas "${currentUser}" tiene permiso BYPASSRLS!`);
    }
    console.log('  ✅ [PASS] El rol de pruebas NO tiene permiso BYPASSRLS (rolbypassrls = false).');

    // Check 4: Check if production database exists in the connected cluster
    const checkDbExistsRes = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [prodDbName]
    );

    if (checkDbExistsRes.rows && checkDbExistsRes.rows.length > 0) {
      // Scenario A: Production database is co-located in the same PostgreSQL cluster
      const privRes = await client.query(
        "SELECT has_database_privilege(current_user, $1, 'CONNECT') AS can_connect_prod",
        [prodDbName]
      );
      const canConnectProd = privRes.rows[0]?.can_connect_prod;
      console.log(`[PRIVILEGIO PRODUCCIÓN] has_database_privilege('${currentUser}', '${prodDbName}', 'CONNECT') = ${canConnectProd}`);

      if (canConnectProd === true) {
        throw new Error(`SECURITY HALT: El rol de pruebas "${currentUser}" TIENE PRIVILEGIO DE CONEXIÓN a la base de producción "${prodDbName}" en el mismo clúster! Revocar permiso de inmediato.`);
      }
      console.log(`  ✅ [PASS] Base de producción "${prodDbName}" presente en el clúster: Acceso DENEGADO a "${currentUser}".`);
    } else {
      // Scenario B: Production database does NOT exist in this cluster (Physically separate cluster)
      // Require auditable cluster metadata or distinct host/port to prevent misspelled name false PASS
      const isAuditedCluster = envSource.ISOLATED_CLUSTER_AUDIT === 'true';
      const hasDistinctHost = envSource.PRODUCTION_DB_HOST && envSource.PRODUCTION_DB_HOST !== envSource.TEST_DB_HOST;
      const hasDistinctPort = envSource.PRODUCTION_DB_PORT && envSource.PRODUCTION_DB_PORT !== envSource.TEST_DB_PORT;

      if (!isAuditedCluster && !hasDistinctHost && !hasDistinctPort) {
        throw new Error(
          `SECURITY HALT: La base "${prodDbName}" no existe en el clúster conectado ("${envSource.TEST_DB_HOST}:${envSource.TEST_DB_PORT}"), ` +
          `pero no se ha suministrado certificación de clúster separado. ` +
          `Para evitar falsos positivos por nombres mal escritos, proporcione ISOLATED_CLUSTER_AUDIT="true" ` +
          `o configure PRODUCTION_DB_HOST / PRODUCTION_DB_PORT indicando la separación física.`
        );
      }
      console.log(`  ✅ [PASS] Aislamiento Físico por Clúster Separado verificado: La base "${prodDbName}" no reside en el clúster de pruebas y los metadatos auditables certifican separación física.`);
    }

    // Check 5: Explicit CREATE privilege on the test database
    const createDbRes = await client.query(
      "SELECT has_database_privilege(current_user, $1, 'CREATE') AS can_create_in_test_db",
      [testDbName]
    );
    if (!createDbRes.rows[0]?.can_create_in_test_db) {
      throw new Error(`SECURITY HALT: El rol de pruebas "${currentUser}" no tiene permiso CREATE sobre la base de pruebas "${testDbName}".`);
    }
    console.log(`  ✅ [PASS] has_database_privilege('${currentUser}', '${testDbName}', 'CREATE') = true.`);

    // Check 6: Safely test creating and dropping a synthetic schema in test database
    const syntheticSchema = `_preflight_schema_${Date.now()}`;
    await client.query(`CREATE SCHEMA "${syntheticSchema}";`);
    await client.query(`DROP SCHEMA "${syntheticSchema}" CASCADE;`);
    console.log(`  ✅ [PASS] Creación y eliminación de esquema sintético de prueba ("${syntheticSchema}") verificada.`);

    // Check 7: Capability to create objects strictly in test database
    await client.query('CREATE TEMPORARY TABLE _preflight_test_isolation (id INT PRIMARY KEY)');
    await client.query('DROP TABLE _preflight_test_isolation');
    console.log('  ✅ [PASS] El rol de pruebas puede crear y eliminar objetos temporales en la base de prueba.');

    // Check 8: Check for pre-existing tables in public schema and report state for Gate 0.5
    const tablesRes = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    `);

    if (tablesRes.rows.length > 0) {
      console.log(`  ℹ️ [INFO] La base de pruebas "${testDbName}" contiene ${tablesRes.rows.length} tablas preexistentes (serán reiniciadas determinísticamente en Gate 0.5).`);
    } else {
      console.log('  ✅ [PASS] Esquema public inicialmente limpio.');
    }
    console.log('  ✅ [PASS] El esquema public de la base de prueba está listo para el ciclo de calidad.');

    console.log('\n========================================================================');
    console.log('🎉 PREFLIGHT EXITOSO: Infraestructura de prueba física y aislada verificada.');
    console.log('========================================================================\n');
    return true;
  } finally {
    client.release();
    if (!clientPool) {
      await pool.end();
    }
  }
}

if (require.main === module) {
  const rootDir = path.join(__dirname, '../..');
  const testEnvFile = process.env.TEST_ENV_FILE || path.join(rootDir, '.env.test');
  if (fs.existsSync(testEnvFile)) {
    const parsed = dotenv.parse(fs.readFileSync(testEnvFile));
    if (parsed.ALLOW_INTEGRATION_TESTS) {
      console.error('\n❌ [FATAL SECURITY ABORT]: Intento de autoautorización detectado en archivo de configuración.');
      console.error('   ALLOW_INTEGRATION_TESTS no puede ser suministrado en archivos de configuración.');
      process.exit(1);
    }
    if (parsed.ISOLATED_CLUSTER_AUDIT) {
      console.error('\n❌ [FATAL SECURITY ABORT]: Certificación de clúster aislada detectada en archivo de configuración.');
      console.error('   ISOLATED_CLUSTER_AUDIT debe provenir exclusivamente de la consola del operador/DBA o del pipeline CI/CD.');
      process.exit(1);
    }
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined) {
        process.env[k] = v;
      }
    }
  }

  runInfrastructurePreflight()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`\n❌ [PREFLIGHT FAILED]: ${err.message}\n`);
      process.exit(1);
    });
}

module.exports = {
  runInfrastructurePreflight
};
