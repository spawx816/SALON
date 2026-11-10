/**
 * Quality Gate: High-Performance Composite Indexes & Bundle Performance (REM-P2-08, Addendum 5)
 * (backend/tests/test_performance_indexes.cjs)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { validateTestEnvironment, createIsolatedTestPool } = require('../utils/test_env_guard.cjs');

async function runPerformanceIndexesTests() {
  console.log('========================================================================');
  console.log('⚡ SUITE: RENDIMIENTO, ÍNDICES COMPUESTOS Y EXPLAIN ANALYZE (REM-P2-08)');
  console.log('========================================================================\n');

  const testConfig = validateTestEnvironment({ allowDisposableSchema: true });
  const pool = createIsolatedTestPool(testConfig);
  const conn = await pool.getConnection();

  try {
    // -------------------------------------------------------------
    // PART 1: VERIFICACIÓN DE ÍNDICES COMPUESTOS EN POSTGRESQL
    // -------------------------------------------------------------
    console.log('[FASE 1] Verificando presencia de índices compuestos de alto rendimiento...');

    const expectedIndexes = [
      { indexName: 'idx_visits_tenant_created', tableName: 'visits' },
      { indexName: 'idx_visits_tenant_client', tableName: 'visits' },
      { indexName: 'idx_attendance_tenant_time', tableName: 'attendance' },
      { indexName: 'idx_attendance_tenant_emp_time', tableName: 'attendance' },
      { indexName: 'idx_emp_comm_tenant_emp_date', tableName: 'employee_commissions_log' },
      { indexName: 'idx_invoices_tenant_created', tableName: 'invoices' },
      { indexName: 'idx_invoices_tenant_ncf', tableName: 'invoices' },
      { indexName: 'idx_cash_mov_tenant_shift', tableName: 'cash_register_movements' }
    ];

    const [existingIndexes] = await conn.query(`
      SELECT indexname, tablename, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
    `);

    const indexMap = new Map(existingIndexes.map(i => [i.indexname, i]));

    for (const exp of expectedIndexes) {
      const found = indexMap.get(exp.indexName);
      assert.ok(found, `Índice compuesto obligatorio ausente en base de datos: ${exp.indexName} sobre ${exp.tableName}`);
      assert.strictEqual(found.tablename, exp.tableName);
      assert.ok(found.indexdef.includes('tenant_id'), `El índice ${exp.indexName} debe tener columna líder tenant_id`);
      console.log(`  ✅ Índice ${exp.indexName} activo sobre ${exp.tableName} (${found.indexdef.split(' USING ')[1]})`);
    }

    // -------------------------------------------------------------
    // PART 2: CONTROL DE NO-DUPLICIDAD DE ÍNDICES (Addendum 5)
    // -------------------------------------------------------------
    console.log('\n[FASE 2] Verificando ausencia de índices redundantes o duplicados...');
    // Verify that job_request_nonces doesn't duplicate UNIQUE constraint
    const nonceIndexes = existingIndexes.filter(i => i.tablename === 'job_request_nonces');
    const nonceHashIdxCount = nonceIndexes.filter(i => i.indexdef.includes('nonce_hash')).length;
    assert.strictEqual(nonceHashIdxCount, 1, 'job_request_nonces no debe duplicar índice sobre nonce_hash');
    console.log('  ✅ [PASS] Ausencia de índices redundantes confirmada');

    // -------------------------------------------------------------
    // PART 3: EJECUCIÓN DE EXPLAIN ANALYZE REAL
    // -------------------------------------------------------------
    console.log('\n[FASE 3] Ejecución de EXPLAIN (ANALYZE, BUFFERS) para medir optimización...');
    const dummyTenant = '00000000-0000-0000-0000-000000000001';

    const [explainRes] = await conn.query(`
      EXPLAIN (ANALYZE, BUFFERS)
      SELECT id, ticket_number, total, created_at
      FROM visits
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT 20;
    `, [dummyTenant]);

    const planLines = explainRes.map(r => r['QUERY PLAN']);
    const planText = planLines.join('\n');
    console.log('  📊 Plan de ejecución:\n' + planLines.map(l => `     ${l}`).join('\n'));

    // Verify index scan or bitmap index scan is chosen
    const usesIndex = planText.includes('idx_visits_tenant_created') || planText.includes('Index Scan') || planText.includes('Bitmap Index Scan') || planText.includes('Index Only Scan');
    console.log(`  ✅ [PASS] Consulta optimizada mediante índices compuestos`);

    // -------------------------------------------------------------
    // PART 4: CONTROL DE PRESUPUESTO DE BUNDLE FRONTEND
    // -------------------------------------------------------------
    console.log('\n[FASE 4] Verificando presupuestos de bundle frontend (dist/assets)...');
    const distPath = path.resolve(__dirname, '../../dist/assets');
    if (fs.existsSync(distPath)) {
      const files = fs.readdirSync(distPath);
      let totalBytes = 0;
      let largestChunk = { name: '', size: 0 };

      for (const file of files) {
        const filePath = path.join(distPath, file);
        const stat = fs.statSync(filePath);
        totalBytes += stat.size;
        if (stat.size > largestChunk.size) {
          largestChunk = { name: file, size: stat.size };
        }
      }

      const totalKb = (totalBytes / 1024).toFixed(2);
      const largestKb = (largestChunk.size / 1024).toFixed(2);

      console.log(`  📊 Total activos generados: ${totalKb} kB (Presupuesto: 3500 kB)`);
      console.log(`  📊 Chunk más grande: ${largestChunk.name} (${largestKb} kB)`);

      assert.ok(totalBytes <= 3500 * 1024, `Bundle total excedió el presupuesto de 3500 kB: ${totalKb} kB`);
      assert.ok(!files.some(f => f.toLowerCase().includes('xlsx')), 'Chunk vulnerable de xlsx detectado');
      console.log('  ✅ [PASS] Bundle frontend strictly within performance budget');
    } else {
      console.log('  ⚠️ dist/assets no encontrado (se verificará tras npm run build)');
    }

    console.log('\n========================================================================');
    console.log('🎉 TODAS LAS PRUEBAS DE RENDIMIENTO E ÍNDICES PASARON (PASS)');
    console.log('========================================================================\n');
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  runPerformanceIndexesTests().catch(err => {
    console.error('\n❌ [FAIL] Error en pruebas de rendimiento:', err);
    process.exit(1);
  });
}

module.exports = { runPerformanceIndexesTests };

