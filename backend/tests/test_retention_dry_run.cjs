/**
 * Quality Gate: Data Retention & Purge Dry-Run Protection (REM-P2-09 & Addendum 1)
 * (backend/tests/test_retention_dry_run.cjs)
 */

'use strict';

const assert = require('assert');
const { validateTestEnvironment, createIsolatedTestPool } = require('../utils/test_env_guard.cjs');
const { DataRetentionService } = require('../services/data_retention.service');

async function runRetentionDryRunTests() {
  console.log('========================================================================');
  console.log('🛡️ SUITE: MOTOR DE RETENCIÓN DE DATOS Y DRY-RUN (REM-P2-09 & Addendum 1)');
  console.log('========================================================================\n');

  const testConfig = validateTestEnvironment({ allowDisposableSchema: true });
  const pool = createIsolatedTestPool(testConfig);
  const conn = await pool.getConnection();

  const service = new DataRetentionService(pool);

  try {
    const tenantId = '88888888-0000-0000-0000-000000000001';

    await conn.query(`
      INSERT INTO tenants (id, business_name, slug, email)
      VALUES ($1, 'Tenant Retencion', 'tenant-retencion', 'retencion@test.local')
      ON CONFLICT (id) DO NOTHING;
    `, [tenantId]);

    // Clean previous test data
    await conn.query('DELETE FROM attendance WHERE tenant_id = $1', [tenantId]);
    await conn.query('DELETE FROM private_files WHERE tenant_id = $1', [tenantId]);
    await conn.query('DELETE FROM data_retention_runs WHERE tenant_id = $1', [tenantId]);

    // Ensure policies are present
    const policies = await service.listPolicies();
    assert.ok(policies.length >= 3, 'Deben existir al menos 3 políticas configuradas');
    console.log(`  📊 Políticas de retención activas detectadas: ${policies.length}`);

    // --- TEST 1: Protección de Legal Hold en facturas y contratos ---
    console.log('\n--- TEST 1: Protección estricta de Legal Hold (cero eliminaciones) ---');
    const invoiceHold = await service.runRetention({
      tenantId,
      category: 'invoices',
      isDryRun: false
    });

    assert.strictEqual(invoiceHold.legal_hold, true);
    assert.strictEqual(invoiceHold.records_purged, 0);
    assert.strictEqual(invoiceHold.summary.action, 'BLOCKED');
    console.log('  ✅ [PASS 1] Facturas protegidas por Legal Hold: purga bloqueada categóricamente');

    // --- TEST 2: Ejecución Dry-Run por defecto (sin modificaciones en DB) ---
    console.log('\n--- TEST 2: Evaluación en modo Dry-Run (cero mutaciones en datos) ---');
    // Seed attendance records: 1 recent (5 days ago) and 1 old (120 days ago)
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const oldDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);

    const att1 = '99999999-0000-0000-0000-000000000001';
    const att2 = '99999999-0000-0000-0000-000000000002';
    const file1 = '77777777-0000-0000-0000-000000000001';
    const file2 = '77777777-0000-0000-0000-000000000002';

    await conn.query(`
      INSERT INTO private_files (id, tenant_id, category, storage_path, byte_size, mime_type, sha256_hash, encryption_iv, encryption_tag)
      VALUES
        ($1, $2, 'attendance_photos', '/tmp/p1.enc', 1024, 'image/jpeg', 'h1', 'iv1', 'tag1'),
        ($3, $2, 'attendance_photos', '/tmp/p2.enc', 1024, 'image/jpeg', 'h2', 'iv2', 'tag2')
      ON CONFLICT (id) DO NOTHING;
    `, [file1, tenantId, file2]);

    await conn.query(`
      INSERT INTO attendance (id, tenant_id, employee_id, type, timestamp, photo_file_id)
      VALUES
        ($1, $2, 'EMP-01', 'check_in', $3, $4),
        ($5, $2, 'EMP-01', 'check_in', $6, $7)
      ON CONFLICT (id) DO NOTHING;
    `, [att1, tenantId, recentDate, file1, att2, oldDate, file2]);

    const dryRunRes = await service.runRetention({
      tenantId,
      category: 'attendance_photos',
      isDryRun: true
    });

    assert.strictEqual(dryRunRes.is_dry_run, true);
    assert.strictEqual(dryRunRes.records_eligible, 1);
    assert.strictEqual(dryRunRes.records_purged, 0);

    // Verify record was NOT modified in database
    const [checkAtt] = await conn.query('SELECT photo_file_id FROM attendance WHERE id = $1', [att2]);
    assert.strictEqual(checkAtt[0].photo_file_id, file2);
    console.log('  ✅ [PASS 2] Dry-run detectó 1 registro elegible sin alterar la base de datos');

    // --- TEST 3: Intento de purga física sin Feature Flag bloqueado con 403 ---
    console.log('\n--- TEST 3: Bloqueo de purga física sin feature flag (PURGE_EXECUTION_BLOCKED) ---');
    delete process.env.ENABLE_DATA_PURGE;

    let purgeBlocked = false;
    try {
      await service.runRetention({
        tenantId,
        category: 'attendance_photos',
        isDryRun: false
      });
    } catch (err) {
      purgeBlocked = true;
      assert.strictEqual(err.status, 403);
      assert.strictEqual(err.code, 'PURGE_EXECUTION_BLOCKED');
    }
    assert.ok(purgeBlocked, 'Debe bloquear ejecución física si ENABLE_DATA_PURGE no está activo');
    console.log('  ✅ [PASS 3] Intento de ejecución física rechazado con 403 PURGE_EXECUTION_BLOCKED');

    // --- TEST 4: Purga física controlada con Feature Flag activo ---
    console.log('\n--- TEST 4: Purga física autorizada con ENABLE_DATA_PURGE=true ---');
    process.env.ENABLE_DATA_PURGE = 'true';

    const execRes = await service.runRetention({
      tenantId,
      category: 'attendance_photos',
      isDryRun: false,
      executedBy: '00000000-0000-0000-0000-000000000099'
    });

    assert.strictEqual(execRes.is_dry_run, false);
    assert.strictEqual(execRes.records_purged, 1);

    // Verify old record was purged and recent preserved
    const [verifyRecent] = await conn.query('SELECT photo_file_id FROM attendance WHERE id = $1', [att1]);
    const [verifyOld] = await conn.query('SELECT photo_file_id FROM attendance WHERE id = $1', [att2]);
    assert.strictEqual(verifyRecent[0].photo_file_id, file1);
    assert.strictEqual(verifyOld[0].photo_file_id, null);
    console.log('  ✅ [PASS 4] Purga física completada: 1 registro purgado, registro reciente intacto');

    // Clean up env flag
    delete process.env.ENABLE_DATA_PURGE;

    // --- TEST 5: Verificación de auditoría persistida en data_retention_runs ---
    console.log('\n--- TEST 5: Auditoría de ejecuciones en data_retention_runs ---');
    const [runLogs] = await conn.query(`
      SELECT * FROM data_retention_runs
      WHERE tenant_id = $1
      ORDER BY executed_at DESC
    `, [tenantId]);

    assert.ok(runLogs.length >= 2);
    assert.strictEqual(runLogs[0].is_dry_run, false);
    assert.strictEqual(runLogs[0].records_purged, 1);
    console.log('  ✅ [PASS 5] Historial de ejecuciones y dry-runs auditado correctamente');

    console.log('\n========================================================================');
    console.log('🎉 TODAS LAS PRUEBAS DE RETENCIÓN Y DRY-RUN PASARON (PASS)');
    console.log('========================================================================\n');
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  runRetentionDryRunTests().catch(err => {
    console.error('\n❌ [FAIL] Error en pruebas de retención:', err);
    process.exit(1);
  });
}

module.exports = { runRetentionDryRunTests };

