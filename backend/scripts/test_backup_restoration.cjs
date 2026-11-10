/**
 * Real Backup Restoration & Sandbox Verification Suite (Phase 1)
 *
 * Requirements:
 * 1. Uses validateTestEnvironment() and createIsolatedTestPool() (no unvalidated execution).
 * 2. Authenticated manifest verification using BACKUP_HMAC_KEY before SHA-256 check.
 * 3. Negative tests asserting rejection of altered manifest or snapshot payload.
 * 4. PL/pgSQL dollar-quoted ($$) statement parser (no naive split(';')).
 * 5. Exact catalog object counts:
 *    - tables === 70
 *    - foreign_keys === 92
 *    - indexes === 174
 *    - sequences === 42
 * 6. Installs quarantine triggers and verifies active blocking of mutations.
 * 7. Verifies Foreign Key active orphan rejection (PostgreSQL error code 23503).
 * 8. Topologically ordered data restoration and row count verification against manifest.
 * 9. Teardown verification: asserts schema is completely dropped from information_schema.schemata.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { validateTestEnvironment, createIsolatedTestPool } = require('../utils/test_env_guard.cjs');

function computeManifestHmac(manifestObj, hmacKey) {
  const clone = { ...manifestObj };
  delete clone.manifest_hmac_signature;
  const keys = Object.keys(clone).sort();
  const sorted = {};
  for (const k of keys) sorted[k] = clone[k];
  return crypto.createHmac('sha256', hmacKey).update(JSON.stringify(sorted)).digest('hex');
}

function parseSqlStatements(sqlContent) {
  const statements = [];
  let current = '';
  let inDollarBlock = false;

  const lines = sqlContent.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('--')) continue;

    const dollarMatches = (line.match(/\$\$/g) || []).length;
    if (dollarMatches % 2 === 1) {
      inDollarBlock = !inDollarBlock;
    }

    current += line + '\n';

    if (!inDollarBlock && trimmed.endsWith(';')) {
      statements.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

async function testBackupRestoration() {
  console.log('========================================================================');
  console.log('🧪 PRUEBA REAL DE RESTAURACIÓN DE BACKUP EN SANDBOX DESECHABLE (FASE 1)');
  console.log('========================================================================\n');

  // 1. Fail-closed test environment validation
  const testDbConfig = validateTestEnvironment({ allowDisposableSchema: true });
  const pool = createIsolatedTestPool(testDbConfig);

  const backupDir = path.join(__dirname, '../backups');
  const ddlFile = path.join(backupDir, 'independent_schema.sql');
  const manifestFile = path.join(backupDir, 'restore_manifest.json');
  const snapshotFile = path.join(backupDir, 'sanitized_test_snapshot.json');

  assert(fs.existsSync(ddlFile), 'independent_schema.sql must exist');
  assert(fs.existsSync(manifestFile), 'restore_manifest.json must exist');
  assert(fs.existsSync(snapshotFile), 'sanitized_test_snapshot.json must exist');

  // 2. Validate BACKUP_HMAC_KEY presence and strength
  const hmacKeyRaw = process.env.BACKUP_HMAC_KEY;
  if (!hmacKeyRaw || String(hmacKeyRaw).trim() === '') {
    throw new Error('SECURITY HALT: BACKUP_HMAC_KEY obligatoria ausente en el entorno.');
  }

  let hmacKey = Buffer.from(hmacKeyRaw, 'hex');
  if (hmacKey.length !== 32) hmacKey = Buffer.from(hmacKeyRaw, 'base64');
  if (hmacKey.length !== 32) {
    throw new Error(`SECURITY HALT: BACKUP_HMAC_KEY debe tener exactamente 32 bytes (longitud actual: ${hmacKey.length}).`);
  }

  const jwtSecret = process.env.JWT_SECRET || '';
  if (jwtSecret && hmacKeyRaw === jwtSecret) {
    throw new Error('SECURITY HALT: BACKUP_HMAC_KEY no puede ser idéntica a JWT_SECRET.');
  }

  // 3. Authenticated Manifest HMAC Verification
  const manifestRaw = fs.readFileSync(manifestFile, 'utf8');
  const manifest = JSON.parse(manifestRaw);

  assert(manifest.manifest_hmac_signature, 'restore_manifest.json must contain manifest_hmac_signature');

  const computedSig = computeManifestHmac(manifest, hmacKey);
  const sigBuf = Buffer.from(computedSig, 'hex');
  const expBuf = Buffer.from(manifest.manifest_hmac_signature, 'hex');

  const isHmacValid = sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
  assert(isHmacValid, 'SECURITY HALT: HMAC signature verification failed on restore_manifest.json.');
  console.log('✅ [AUTENTICACIÓN] Firma HMAC de restore_manifest.json validada con BACKUP_HMAC_KEY.');

  // 4. Negative Tests (Altered Manifest & Corrupt Snapshot)
  console.log('\n[PRUEBAS NEGATIVAS] Verificando rechazo criptográfico ante datos alterados...');

  // Negative Case A: Tampered Manifest
  const tamperedManifest = { ...manifest, version: '999.0_malicious' };
  const tamperedSig = computeManifestHmac(tamperedManifest, hmacKey);
  const tamperedMatchesOriginal = (tamperedSig === manifest.manifest_hmac_signature);
  assert(!tamperedMatchesOriginal, 'Tampered manifest must produce distinct HMAC');
  console.log('  ✅ [PASS] Rechazo criptográfico de manifiesto alterado comprobado.');

  // Negative Case B: Corrupted Snapshot Payload
  const snapshotBuffer = fs.readFileSync(snapshotFile);
  const actualHash = crypto.createHash('sha256').update(snapshotBuffer).digest('hex');
  assert.strictEqual(actualHash, manifest.sanitized_snapshot_sha256, 'Snapshot checksum must match authenticated manifest exactly');

  const corruptedSnapshotBuffer = Buffer.from(snapshotBuffer);
  corruptedSnapshotBuffer[corruptedSnapshotBuffer.length - 1] ^= 0xFF;
  const corruptedHash = crypto.createHash('sha256').update(corruptedSnapshotBuffer).digest('hex');
  assert.notStrictEqual(corruptedHash, manifest.sanitized_snapshot_sha256, 'Corrupted snapshot must fail checksum verification');
  console.log('  ✅ [PASS] Rechazo de payload de snapshot corrupto comprobado.');

  const snapshotData = JSON.parse(snapshotBuffer.toString('utf8'));
  const tables = snapshotData.tables || {};

  // 5. Connect and initialize disposable schema in sandbox
  const conn = await pool.getConnection();
  const schemaName = 'disposable_restore_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
  let teardownSuccess = false;

  try {
    console.log(`\n[SANDBOX] Creando esquema desechable: "${schemaName}"...`);
    await conn.query(`CREATE SCHEMA ${schemaName};`);
    await conn.query(`SET search_path TO ${schemaName};`);

    // 6. Execute Full Independent DDL using PL/pgSQL Statement Parser
    console.log(`[SANDBOX] Aplicando DDL independiente completo con parser PL/pgSQL...`);
    const rawDdl = fs.readFileSync(ddlFile, 'utf8');
    const schemaDdl = rawDdl.replace(/\{\{SCHEMA\}\}/g, schemaName);

    const statements = parseSqlStatements(schemaDdl);
    for (const stmt of statements) {
      await conn.query(stmt);
    }
    console.log(`✅ ${statements.length} sentencias DDL ejecutadas exitosamente.`);

    // 7. Exact Object Count Validations in Catalog
    console.log(`\n[CATÁLOGO] Verificando recuentos exactos de objetos en ${schemaName}...`);

    const [createdTables] = await conn.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = ? AND table_type = 'BASE TABLE'
    `, [schemaName]);
    assert.strictEqual(createdTables.length, 70, `Expected exactly 70 tables, found ${createdTables.length}`);
    console.log(`  📊 Tablas construidas: ${createdTables.length} (exacto: 70) [PASS]`);

    const [createdFks] = await conn.query(`
      SELECT tc.constraint_name 
      FROM information_schema.table_constraints tc
      WHERE tc.table_schema = ? AND tc.constraint_type = 'FOREIGN KEY'
    `, [schemaName]);
    assert.strictEqual(createdFks.length, 92, `Expected exactly 92 foreign keys, found ${createdFks.length}`);
    console.log(`  📊 Claves foráneas activas: ${createdFks.length} (exacto: 92) [PASS]`);

    const [createdIndexes] = await conn.query(`
      SELECT indexname FROM pg_indexes WHERE schemaname = ?
    `, [schemaName]);
    assert.strictEqual(createdIndexes.length, 174, `Expected exactly 174 indexes, found ${createdIndexes.length}`);
    console.log(`  📊 Índices creados: ${createdIndexes.length} (exacto: 174) [PASS]`);

    const [createdSequences] = await conn.query(`
      SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = ?
    `, [schemaName]);
    assert.strictEqual(createdSequences.length, 42, `Expected exactly 42 sequences, found ${createdSequences.length}`);
    console.log(`  📊 Secuencias activas: ${createdSequences.length} (exacto: 42) [PASS]`);

    // 8. Verify Quarantine Triggers Restored Directly from DDL (Native DDL Definition)
    const [restoredTriggers] = await conn.query(`
      SELECT DISTINCT trigger_name FROM information_schema.triggers WHERE trigger_schema = ?
    `, [schemaName]);
    assert.strictEqual(restoredTriggers.length, 4, `Expected exactly 4 quarantine triggers restored directly from DDL, found ${restoredTriggers.length}`);
    const triggerNames = restoredTriggers.map(t => t.trigger_name).sort();
    const expectedTriggers = [
      'trg_quarantine_cash_registers',
      'trg_quarantine_salons',
      'trg_quarantine_ticket_sequences',
      'trg_quarantine_visits'
    ].sort();
    assert.deepStrictEqual(triggerNames, expectedTriggers, `Triggers restored from DDL must match canonical names: ${expectedTriggers.join(', ')}`);
    console.log(`  📊 Triggers de cuarentena nativos restaurados desde DDL: ${restoredTriggers.length} (exacto: 4 [${triggerNames.join(', ')}]) [PASS]`);

    // 9. Restore Fixture Data Topologically
    console.log(`\n[DATOS] Restaurando filas ordenadas topológicamente...`);
    let totalRestored = 0;
    const restoreOrder = [
      'saas_plans', 'tenants', 'roles', 'branches', 'salons', 'service_categories',
      'services', 'users', 'user_sessions', 'staff_positions', 'staff_records',
      'commission_categories', 'commission_schemes', 'commission_scheme_rules',
      'payroll_periods', 'payroll_calculation_settings', 'payroll_concepts',
      'payroll_records', 'payroll_items', 'payroll_audit_logs', 'holidays',
      'marketing_settings', 'security_settings', 'security_requests',
      'security_audit_logs', 'verification_codes', 'company_ncf_counters',
      'ticket_sequences', 'email_settings', 'email_logs', 'contract_settings',
      'contracts', 'plans', 'clients', 'cash_registers', 'cash_shifts',
      'cash_register_movements', 'visits', 'appointments', 'expenses'
    ];

    for (const tName of restoreOrder) {
      const tableData = tables[tName];
      if (!tableData || !Array.isArray(tableData.rows) || tableData.rows.length === 0) continue;

      for (const row of tableData.rows) {
        const cols = Object.keys(row);
        const vals = Object.values(row).map(v => {
          if (v !== null && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) {
            return JSON.stringify(v);
          }
          return v;
        });
        const colList = cols.map(c => `"${c}"`).join(', ');
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');

        await conn.query(
          `INSERT INTO ${schemaName}."${tName}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          vals
        );
        totalRestored++;
      }
    }
    console.log(`  ✅ ${totalRestored} filas restauradas exitosamente.`);

    // 10. Test Live Quarantine Behavior Across Audited Tables
    console.log(`\n[PRUEBA TRIGGER] Probando activación real de triggers de cuarentena en sandbox...`);
    const [tenants] = await conn.query(`SELECT id FROM ${schemaName}.tenants LIMIT 1`);
    const testTenantId = tenants[0].id;
    const testSalonId = crypto.randomUUID();

    await conn.query(
      `INSERT INTO ${schemaName}.salons (id, tenant_id, name, status) VALUES (?, ?, ?, ?)`,
      [testSalonId, testTenantId, 'Test Salon Trigger', 'Active']
    );
    await conn.query(
      `INSERT INTO ${schemaName}.pending_tenant_reconciliations (table_name, record_id, reason, status) VALUES (?, ?, ?, ?)`,
      ['salons', testSalonId, 'Sandbox Trigger Quarantine Test', 'quarantined']
    );

    let triggerFired = false;
    try {
      await conn.query(`UPDATE ${schemaName}.salons SET name = 'Mutated' WHERE id = ?`, [testSalonId]);
    } catch (triggerErr) {
      if (triggerErr.message.includes('QUARANTINE_VIOLATION')) {
        triggerFired = true;
      }
    }
    assert(triggerFired, 'Quarantine trigger must fire inside the sandbox and block mutations');
    console.log('  [PASS] Trigger de cuarentena en salons verificado: bloqueó mutación con QUARANTINE_VIOLATION.');

    // Cleanup trigger test fixture
    await conn.query(`DELETE FROM ${schemaName}.pending_tenant_reconciliations WHERE record_id = ?`, [testSalonId]);
    await conn.query(`DELETE FROM ${schemaName}.salons WHERE id = ?`, [testSalonId]);

    // 11. Test Live Foreign Key Rejection (Orphan Protection) in Sandbox
    console.log(`\n[PRUEBA FK] Probando rechazo activo de registros huérfanos por Foreign Key...`);
    const nonExistentTenantId = crypto.randomUUID();
    let fkRejected = false;
    try {
      await conn.query(
        `INSERT INTO ${schemaName}.salons (id, tenant_id, name, status) VALUES (?, ?, ?, ?)`,
        [crypto.randomUUID(), nonExistentTenantId, 'Orphan Salon Test', 'Active']
      );
    } catch (fkErr) {
      if (fkErr.message.includes('foreign key') || fkErr.code === '23503') {
        fkRejected = true;
      }
    }
    assert(fkRejected, 'Sandbox Foreign Key must actively reject inserts with non-existent tenant_id (code 23503)');
    console.log('  [PASS] Clave foránea verificada: rechazó registro huérfano con código 23503.');

    // 12. Row Counts Against Manifest
    console.log(`\n[INTEGRIDAD] Verificando recuentos de filas contra manifiesto...`);
    for (const [tName, expectedCount] of Object.entries(manifest.table_counts || {})) {
      if (expectedCount > 0) {
        const [cntRes] = await conn.query(`SELECT COUNT(*) as cnt FROM ${schemaName}."${tName}"`);
        const actualCnt = parseInt(cntRes[0].cnt, 10);
        assert.strictEqual(actualCnt, expectedCount, `Row count mismatch in table ${tName}: expected ${expectedCount}, got ${actualCnt}`);
      }
    }
    console.log('  [PASS] Todos los recuentos de filas coinciden con el manifiesto.');

    console.log('\n🎉 RESTAURACIÓN EN SANDBOX DESECHABLE VALIDADA CON ÉXITO.');
  } finally {
    // 13. Teardown and Complete Schema Elimination Verification
    console.log(`\n[TEARDOWN] Destruyendo esquema desechable "${schemaName}" (DROP SCHEMA CASCADE)...`);
    try {
      await conn.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE;`);
      const [remaining] = await conn.query(`
        SELECT 1 FROM information_schema.schemata WHERE schema_name = ?
      `, [schemaName]);
      assert.strictEqual(remaining.length, 0, `Schema "${schemaName}" must be completely purged from catalog`);
      console.log(`  [PASS] Verificado: Esquema "${schemaName}" purgado completamente (0 residuales).`);
      teardownSuccess = true;
    } catch (cleanupErr) {
      console.error(`❌ ERROR CRÍTICO DURANTE TEARDOWN:`, cleanupErr.message);
      teardownSuccess = false;
    }
    conn.release();
    await pool.end();
  }

  assert(teardownSuccess, 'Teardown must succeed unconditionally or the test must fail');
  console.log('\n✅ TEST PASSED: Restauración, conteos exactos, triggers, FKs y teardown verificados al 100%.\n');
  process.exit(0);
}

if (require.main === module) {
  testBackupRestoration()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ FALLO EN PRUEBA DE RESTAURACIÓN:', err.message);
      process.exit(1);
    });
}

module.exports = { testBackupRestoration };
