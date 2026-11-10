/**
 * Master Verification Suite: Phase 3B.2B (Cierre de los P1 Restantes)
 *
 * Runs all quality gates and remediation test suites for Phase 3B.2B:
 * 1. REM-P1-14: Dependency security & pinned versions.
 * 2. REM-P1-12 & REM-P1-15: Elimination of xlsx & bundle budget enforcement.
 * 3. REM-P1-10 & REM-P1-11: PrivateStorageAdapter AES-256-GCM encryption at rest.
 * 4. REM-P1-18: Atomic inventory concurrency, SELECT FOR UPDATE & void idempotency.
 * 5. REM-P1-16: Batch commissions calculation & O(1) query complexity benchmark.
 * 6. REM-P1-17: Tenant data portability, password re-auth & sanitized 24h export.
 */

'use strict';

const { execSync } = require('child_process');
const path = require('path');
const { runStoragePrivateSuite } = require('./test_storage_private.cjs');
const { runInventoryConcurrencySuite } = require('./test_inventory_concurrency.cjs');
const { runCommissionsBatchBenchmark } = require('./test_commissions_batch_benchmark.cjs');
const { runTenantExportSuite } = require('./test_tenant_export.cjs');

async function runMasterPhase3bP1Suite() {
  console.log('========================================================================');
  console.log('🏆 MASTER SUITE: FASE 3B.2B — CIERRE DE LOS P1 RESTANTES');
  console.log('========================================================================\n');

  // Gate 1: Dependencies Audit
  console.log('▶ [1/6] Ejecutando Gate de Dependencias (REM-P1-14)...');
  execSync(`node "${path.join(__dirname, '../scripts/test_dependencies.cjs')}"`, { stdio: 'inherit' });

  // Gate 2: Bundle Budget
  console.log('\n▶ [2/6] Ejecutando Gate de Presupuesto de Bundle (REM-P1-12 / REM-P1-15)...');
  execSync(`node "${path.join(__dirname, '../scripts/test_bundle_budget.cjs')}"`, { stdio: 'inherit' });

  // Gate 3: Encrypted Storage
  console.log('\n▶ [3/6] Ejecutando Suite de Almacenamiento Privado Cifrado (REM-P1-10 / REM-P1-11)...');
  await runStoragePrivateSuite();

  // Gate 4: Inventory Concurrency
  console.log('\n▶ [4/6] Ejecutando Suite de Inventario Concurrente (REM-P1-18)...');
  await runInventoryConcurrencySuite();

  // Gate 5: Batch Commissions Benchmark
  console.log('\n▶ [5/6] Ejecutando Benchmark de Comisiones Masivas en Lote (REM-P1-16)...');
  await runCommissionsBatchBenchmark();

  // Gate 6: Tenant Portability
  console.log('\n▶ [6/6] Ejecutando Suite de Portabilidad y Exportación GDPR (REM-P1-17)...');
  await runTenantExportSuite();

  console.log('\n========================================================================');
  console.log('🎉 TODOS LOS QUALITY GATES Y SUITES DE LA FASE 3B.2B APROBADOS (PASS)');
  console.log('========================================================================\n');
}

if (require.main === module) {
  runMasterPhase3bP1Suite().catch(err => {
    console.error('\n❌ ERROR EN MASTER SUITE FASE 3B.2B:', err);
    process.exit(1);
  });
}

module.exports = { runMasterPhase3bP1Suite };

