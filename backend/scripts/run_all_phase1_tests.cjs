/**
 * Phase 1 Master Quality Gate Runner
 *
 * Runs all Phase 1 security, isolation, migration, and build verification gates sequentially.
 * Enforces fail-closed: Stops immediately if any check fails (non-zero exit code).
 *
 * Pipeline Order:
 *   Gate 0   : Comprobar aislamiento físico (infrastructure_preflight.cjs)
 *   try:
 *     Gate 0.5 : Preparar o reiniciar exclusivamente la base física de pruebas (prepare_test_db.cjs)
 *     Gate 0.6 : Ejecutar el migration runner canónico desde cero (migrate_all.cjs)
 *     Gate 0.7 : Verificar catálogo de migraciones y restricciones (verify_strict_matrix.cjs)
 *     Gate 1..11: Suites de integración, lint y build
 *   finally:
 *     Teardown : Limpieza incondicional de la base de pruebas (teardown_test_db.cjs)
 *
 * Modes:
 *   --preflight-only : Validates mandatory operator configuration and exits 0 before executing gates.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const rootDir = path.join(__dirname, '../..');

/**
 * Strict Environment Allowlist Builder for Child Gates
 *
 * NEVER uses `{ ...process.env }`.
 * Retains ONLY essential OS runtime keys (PATH, SystemRoot, TEMP, etc.)
 * Excludes NODE_OPTIONS and NODE_PATH to prevent module preloading or hijacking.
 */
function buildStrictChildEnv(testConfig) {
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

  const sanitized = {};
  for (const k of allowedSystemKeys) {
    if (process.env[k] !== undefined) {
      sanitized[k] = process.env[k];
    }
  }

  // Force strict test environment
  sanitized.NODE_ENV = 'test';
  sanitized.ALLOW_INTEGRATION_TESTS = 'true';
  sanitized.ENABLE_TEST_ENDPOINTS = 'true';
  sanitized.DB_TYPE = 'postgres';

  sanitized.DB_HOST = testConfig.TEST_DB_HOST;
  sanitized.DB_PORT = String(testConfig.TEST_DB_PORT || '5432');
  sanitized.DB_USER = testConfig.TEST_DB_USER;
  sanitized.DB_PASSWORD = testConfig.TEST_DB_PASSWORD;
  sanitized.DB_PASS = testConfig.TEST_DB_PASSWORD;
  sanitized.DB_NAME = testConfig.TEST_DB_NAME;

  sanitized.TEST_DB_HOST = testConfig.TEST_DB_HOST;
  sanitized.TEST_DB_PORT = String(testConfig.TEST_DB_PORT || '5432');
  sanitized.TEST_DB_USER = testConfig.TEST_DB_USER;
  sanitized.TEST_DB_PASSWORD = testConfig.TEST_DB_PASSWORD;
  sanitized.TEST_DB_NAME = testConfig.TEST_DB_NAME;

  if (!testConfig.PRODUCTION_DB_NAME || String(testConfig.PRODUCTION_DB_NAME).trim() === '') {
    throw new Error('PRODUCTION_DB_NAME must be explicitly provided in testConfig');
  }
  sanitized.PRODUCTION_DB_NAME = String(testConfig.PRODUCTION_DB_NAME).trim();

  sanitized.HISTORICAL_TEST_PASSWORD = testConfig.HISTORICAL_TEST_PASSWORD;
  sanitized.ROTATED_SUPERADMIN_SECRET = testConfig.ROTATED_SUPERADMIN_SECRET;
  sanitized.JWT_SECRET = testConfig.JWT_SECRET;
  sanitized.BACKUP_HMAC_KEY = testConfig.BACKUP_HMAC_KEY;

  if (process.env.ISOLATED_CLUSTER_AUDIT) {
    sanitized.ISOLATED_CLUSTER_AUDIT = process.env.ISOLATED_CLUSTER_AUDIT;
  }

  if (process.env.TEST_ENV_FILE) {
    sanitized.TEST_ENV_FILE = process.env.TEST_ENV_FILE;
  }

  // Explicit strip of any dangerous operational, preloading, & PG redirect variables
  const prohibitedKeys = [
    'NODE_OPTIONS', 'NODE_PATH',
    'DATABASE_URL', 'DATABASE_URL_UNPOOLED',
    'PGSERVICE', 'PGSERVICESFILE', 'PGPASSFILE', 'PGDATABASE', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD',
    'DB_URL', 'MYSQL_URL', 'POSTGRES_URL',
    'PROD_DB_HOST', 'PROD_DB_NAME', 'PROD_DB_USER', 'PROD_DB_PASSWORD',
    'ALLOW_DISPOSABLE_SCHEMA'
  ];

  for (const k of prohibitedKeys) {
    delete sanitized[k];
  }

  return sanitized;
}

// Pipeline de Gates Principales (Gate 0 se ejecuta antes de operaciones destructivas; Teardown va en finally)
const PRE_DESTRUCTIVE_GATE = {
  name: '0. Infrastructure Preflight',
  command: 'node backend/scripts/infrastructure_preflight.cjs'
};

const DESTRUCTIVE_AND_EXECUTION_GATES = [
  { name: '0.5. Prepare & Reset Physical Test DB', command: 'node backend/scripts/prepare_test_db.cjs' },
  { name: '0.6. Canonical Migration Runner from Scratch', command: 'node backend/migrations/migrate_all.cjs' },
  { name: '0.7. Verify Strict Matrix & Canonical Schema', command: 'node backend/scripts/verify_strict_matrix.cjs' },
  { name: '1. Runner Guards', command: 'node backend/scripts/test_runner_negative_checks.cjs' },
  { name: '2. Server Parity', command: 'node backend/scripts/test_canonical_server_parity.cjs' },
  { name: '3. AST Scanner', command: 'node backend/scripts/test_scanner_negative_suite.cjs && node backend/scripts/ast_multitenant_scanner.cjs' },
  { name: '4. Synthetic Quarantine', command: 'node backend/scripts/test_synthetic_quarantine_all7.cjs' },
  { name: '5. PII & Fixture Audit', command: 'node backend/scripts/test_no_pii_in_fixtures.cjs' },
  { name: '6. Backup Restoration', command: 'node backend/scripts/test_backup_restoration.cjs' },
  { name: '7. Historical Rotation', command: 'node backend/scripts/test_historical_rotation.cjs' },
  { name: '8. Account Recovery Security', command: 'node backend/tests/test_account_recovery_security.cjs' },
  { name: '9. Phase 1 Multi-Tenant Suite (69 checks)', command: 'node backend/test_phase1_multitenant_security.cjs' },
  { name: '10. Lint (Frontend & Backend)', command: 'npm run lint' },
  { name: '11. Production Build', command: 'npm run build' }
];

function runPhase1MasterRunner() {
  const testEnvFile = process.env.TEST_ENV_FILE || path.join(rootDir, '.env.test');

  // Read strictly from designated test env file if present; NEVER read backend/.env
  let testEnvConfig = {};
  if (fs.existsSync(testEnvFile)) {
    testEnvConfig = dotenv.parse(fs.readFileSync(testEnvFile));
  }

  // 1. Reject if configuration file attempts to set ALLOW_INTEGRATION_TESTS or ISOLATED_CLUSTER_AUDIT
  if (testEnvConfig.ALLOW_INTEGRATION_TESTS) {
    console.error('\n❌ [FATAL SECURITY ABORT]: Intento de autoautorización detectado en archivo de configuración.');
    console.error('   ALLOW_INTEGRATION_TESTS no puede ser suministrado en archivos de configuración.');
    process.exit(1);
  }

  if (testEnvConfig.ISOLATED_CLUSTER_AUDIT) {
    console.error('\n❌ [FATAL SECURITY ABORT]: Certificación de clúster aislada detectada en archivo de configuración.');
    console.error('   ISOLATED_CLUSTER_AUDIT debe provenir exclusivamente de la consola del operador/DBA o del pipeline CI/CD.');
    process.exit(1);
  }

  // 2. Operator explicit authorization check: MUST come strictly from process.env
  if (process.env.ALLOW_INTEGRATION_TESTS !== 'true') {
    console.error('\n❌ [FATAL SECURITY ABORT]: Pruebas de integración no autorizadas.');
    console.error('   Se requiere explícitamente ALLOW_INTEGRATION_TESTS="true" en process.env del operador.');
    console.error('   Está prohibido autoautorizar la ejecución a través de .env.test o scripts internos.');
    process.exit(1);
  }

  // 3. Mandatory independent test DB variables & metadata (Zero fallbacks to DB_* or backend/.env)
  const requiredTestDbVars = [
    'TEST_DB_HOST',
    'TEST_DB_PORT',
    'TEST_DB_USER',
    'TEST_DB_PASSWORD',
    'TEST_DB_NAME',
    'PRODUCTION_DB_NAME'
  ];

  const missingDbVars = requiredTestDbVars.filter(k => {
    const val = process.env[k] || testEnvConfig[k];
    return !val || String(val).trim() === '';
  });

  if (missingDbVars.length > 0) {
    console.error('\n❌ [FATAL SECURITY ABORT]: Variables de base de datos aislada o metadatos faltantes:');
    console.error(`   Faltan: ${missingDbVars.join(', ')}`);
    console.error('   Está terminantemente prohibido usar DB_NAME o la base de datos operativa para pruebas.');
    console.error('   Proporcione las variables TEST_DB_* y PRODUCTION_DB_NAME externamente o en .env.test.');
    process.exit(1);
  }

  // 4. Mandatory security credentials & secrets: MUST be provided (Zero hardcoded defaults)
  const requiredSecurityVars = [
    'HISTORICAL_TEST_PASSWORD',
    'ROTATED_SUPERADMIN_SECRET',
    'JWT_SECRET',
    'BACKUP_HMAC_KEY'
  ];

  const missingSecurityVars = requiredSecurityVars.filter(k => {
    const val = process.env[k] || testEnvConfig[k];
    return !val || String(val).trim() === '';
  });

  if (missingSecurityVars.length > 0) {
    console.error('\n❌ [FATAL SECURITY ABORT]: Credenciales y secretos obligatorios ausentes (sin valores por defecto):');
    console.error(`   Faltan: ${missingSecurityVars.join(', ')}`);
    console.error('   Deben ser provistos obligatoriamente en process.env o .env.test sin valores predeterminados.');
    process.exit(1);
  }

  const testDbName = String(process.env.TEST_DB_NAME || testEnvConfig.TEST_DB_NAME).trim();
  const prodDbName = String(process.env.PRODUCTION_DB_NAME || testEnvConfig.PRODUCTION_DB_NAME).trim();

  // 5. Collision & Safe Naming Checks
  if (testDbName.toLowerCase() === prodDbName.toLowerCase()) {
    console.error(`\n❌ [FATAL SECURITY ABORT]: TEST_DB_NAME ("${testDbName}") no puede ser idéntica a PRODUCTION_DB_NAME ("${prodDbName}").`);
    process.exit(1);
  }

  const isSafeName = (
    testDbName.endsWith('_test') ||
    testDbName.endsWith('_disposable') ||
    testDbName.startsWith('test_') ||
    testDbName.startsWith('disposable_')
  );

  if (!isSafeName) {
    console.error(`\n❌ [FATAL SECURITY ABORT]: Nombre de base de datos de pruebas inseguro: "${testDbName}".`);
    console.error('   TEST_DB_NAME debe comenzar o terminar con _test o _disposable.');
    process.exit(1);
  }

  // 6. Check for disallowed ALLOW_DISPOSABLE_SCHEMA attempts
  if (process.env.ALLOW_DISPOSABLE_SCHEMA === 'true' || testEnvConfig.ALLOW_DISPOSABLE_SCHEMA === 'true') {
    console.error('\n❌ [FATAL SECURITY ABORT]: Uso desestimado de ALLOW_DISPOSABLE_SCHEMA detectado.');
    console.error('   La existencia de un schema diferente dentro de producción no cuenta como aislamiento.');
    console.error('   Se requiere una base de datos física separada.');
    process.exit(1);
  }

  const resolvedConfig = {
    TEST_DB_HOST: process.env.TEST_DB_HOST || testEnvConfig.TEST_DB_HOST,
    TEST_DB_PORT: process.env.TEST_DB_PORT || testEnvConfig.TEST_DB_PORT || '5432',
    TEST_DB_USER: process.env.TEST_DB_USER || testEnvConfig.TEST_DB_USER,
    TEST_DB_PASSWORD: process.env.TEST_DB_PASSWORD || testEnvConfig.TEST_DB_PASSWORD,
    TEST_DB_NAME: testDbName,
    PRODUCTION_DB_NAME: prodDbName,
    HISTORICAL_TEST_PASSWORD: process.env.HISTORICAL_TEST_PASSWORD || testEnvConfig.HISTORICAL_TEST_PASSWORD,
    ROTATED_SUPERADMIN_SECRET: process.env.ROTATED_SUPERADMIN_SECRET || testEnvConfig.ROTATED_SUPERADMIN_SECRET,
    JWT_SECRET: process.env.JWT_SECRET || testEnvConfig.JWT_SECRET,
    BACKUP_HMAC_KEY: process.env.BACKUP_HMAC_KEY || testEnvConfig.BACKUP_HMAC_KEY
  };

  const strictChildEnv = buildStrictChildEnv(resolvedConfig);

  // 7. Check if running in --preflight-only mode
  const isPreflightOnly = process.argv.includes('--preflight-only');
  if (isPreflightOnly) {
    console.log('========================================================================');
    console.log('🛡️ VALIDACIÓN PREFLIGHT DEL RUNNER MAESTRO (--preflight-only)');
    console.log('========================================================================\n');
    console.log('✅ Autorización explícita de operador confirmada (process.env.ALLOW_INTEGRATION_TESTS=true).');
    console.log(`✅ Base de datos de pruebas aislada verificada: "${testDbName}".`);
    console.log(`✅ Metadato de producción protegido: "${prodDbName}".`);
    console.log('✅ Todas las variables obligatorias y secretos están provistos sin fallbacks.');
    console.log('✅ Entorno de procesos hijos sanitizado mediante allowlist estricto.');
    console.log('\n[PREFLIGHT-ONLY]: Configuración validada exitosamente. Deteniendo antes de ejecutar gates.\n');
    process.exit(0);
  }

  console.log('========================================================================');
  console.log('🚀 EJECUTANDO LOS QUALITY GATES DE FASE 1 (FAIL-CLOSED RUNNER)');
  console.log('========================================================================\n');

  const results = [];

  // Paso 1: Gate 0 Preflight no destructivo
  console.log(`\n▶ [EJECUTANDO] ${PRE_DESTRUCTIVE_GATE.name}...`);
  const gate0Start = Date.now();
  try {
    execSync(PRE_DESTRUCTIVE_GATE.command, {
      cwd: rootDir,
      env: strictChildEnv,
      stdio: 'inherit'
    });
    const elapsed = ((Date.now() - gate0Start) / 1000).toFixed(2);
    results.push({ name: PRE_DESTRUCTIVE_GATE.name, status: 'PASS', exitCode: 0, elapsed: `${elapsed}s` });
    console.log(`✅ [PASS] ${PRE_DESTRUCTIVE_GATE.name} (${elapsed}s)`);
  } catch (err) {
    const elapsed = ((Date.now() - gate0Start) / 1000).toFixed(2);
    const exitCode = err.status || 1;
    results.push({ name: PRE_DESTRUCTIVE_GATE.name, status: 'FAIL', exitCode, elapsed: `${elapsed}s` });
    console.error(`❌ [FAIL] ${PRE_DESTRUCTIVE_GATE.name} falló con código ${exitCode} (${elapsed}s)`);
    console.table(results);
    process.exit(exitCode);
  }

  // Paso 2: Operaciones destructivas y suites protegidas con Teardown incondicional
  let destructiveStarted = false;
  let executionError = null;
  let teardownError = null;

  try {
    destructiveStarted = true;
    for (const gate of DESTRUCTIVE_AND_EXECUTION_GATES) {
      console.log(`\n▶ [EJECUTANDO] ${gate.name}...`);
      const startTime = Date.now();
      try {
        execSync(gate.command, {
          cwd: rootDir,
          env: strictChildEnv,
          stdio: 'inherit'
        });
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        results.push({ name: gate.name, status: 'PASS', exitCode: 0, elapsed: `${elapsed}s` });
        console.log(`✅ [PASS] ${gate.name} (${elapsed}s)`);
      } catch (err) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        const exitCode = err.status || 1;
        results.push({ name: gate.name, status: 'FAIL', exitCode, elapsed: `${elapsed}s` });
        console.error(`❌ [FAIL] ${gate.name} falló con código de salida ${exitCode} (${elapsed}s)`);
        executionError = err;
        break; // Romper el ciclo para ir directamente al teardown en finally
      }
    }
  } finally {
    if (destructiveStarted) {
      console.log('\n========================================================================');
      console.log('🧹 [TEARDOWN INCONDICIONAL] EJECUTANDO LIMPIEZA DE BASE DE PRUEBAS');
      console.log('========================================================================\n');
      const teardownStart = Date.now();
      try {
        execSync('node backend/scripts/teardown_test_db.cjs', {
          cwd: rootDir,
          env: strictChildEnv,
          stdio: 'inherit'
        });
        const elapsed = ((Date.now() - teardownStart) / 1000).toFixed(2);
        results.push({ name: 'Final Teardown', status: 'PASS', exitCode: 0, elapsed: `${elapsed}s` });
        console.log(`✅ [PASS] Final Teardown (${elapsed}s)`);
      } catch (tErr) {
        const elapsed = ((Date.now() - teardownStart) / 1000).toFixed(2);
        const tExitCode = tErr.status || 1;
        results.push({ name: 'Final Teardown', status: 'FAIL', exitCode: tExitCode, elapsed: `${elapsed}s` });
        console.error(`❌ [FAIL] Final Teardown falló con código de salida ${tExitCode} (${elapsed}s)`);
        teardownError = tErr;
      }
    }
  }

  console.log('\n========================================================================');
  console.log('📊 RESUMEN DE EJECUCIÓN DE QUALITY GATES');
  console.log('========================================================================\n');
  console.table(results);

  if (executionError) {
    if (teardownError) {
      console.error('\n⚠️ [ALERTA DE ERROR DUAL]: Fallaron tanto la ejecución de gates como el teardown.');
      console.error(`   Error de ejecución: ${executionError.message}`);
      console.error(`   Error de teardown: ${teardownError.message}`);
    }
    process.exit(executionError.status || 1);
  }

  if (teardownError) {
    process.exit(teardownError.status || 1);
  }

  console.log('\n========================================================================');
  console.log('🎉 TODOS LOS QUALITY GATES DE FASE 1 COMPLETADOS CON ÉXITO (EXIT CODE 0)');
  console.log('========================================================================\n');
  process.exit(0);
}

if (require.main === module) {
  runPhase1MasterRunner();
}

module.exports = {
  buildStrictChildEnv,
  PRE_DESTRUCTIVE_GATE,
  DESTRUCTIVE_AND_EXECUTION_GATES,
  runPhase1MasterRunner
};
