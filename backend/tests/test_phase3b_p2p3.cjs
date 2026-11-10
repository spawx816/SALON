/**
 * Master Quality Gate: Phase 3B.3 P2 & P3 Remediation Closure
 * (backend/tests/test_phase3b_p2p3.cjs)
 *
 * Sequentially executes all Phase 3B.3 quality sub-suites.
 */

'use strict';

const { runCashReconciliationTests } = require('./test_cash_reconciliation.cjs');
const { runPhysicalInventoryTests } = require('./test_physical_inventory.cjs');
const { runPaginationCursorTests } = require('./test_pagination_cursors.cjs');
const { runLoggingSanitizationTests } = require('./test_logging_sanitization.cjs');
const { runRetentionDryRunTests } = require('./test_retention_dry_run.cjs');
const { runAccessibilityModalTests } = require('./test_accessibility_modal.cjs');
const { runOpenApiSpecTests } = require('./test_openapi_spec.cjs');
const { runPerformanceIndexesTests } = require('./test_performance_indexes.cjs');

async function runMasterPhase3bP2P3() {
  console.log('========================================================================');
  console.log('🏆 MASTER RUNNER: FASE 3B.3 — CIERRE P2/P3 Y ESTABILIZACIÓN');
  console.log('========================================================================\n');

  const startTime = Date.now();

  console.log('▶ [1/8] Ejecutando Gate de Control de Arqueo y Discrepancias (REM-P2-02)...');
  await runCashReconciliationTests();

  console.log('▶ [2/8] Ejecutando Gate de Toma Física de Inventario y Ventas Concurrentes (REM-P2-03)...');
  await runPhysicalInventoryTests();

  console.log('▶ [3/8] Ejecutando Gate de Cursores Criptográficos y Búsqueda Aislada (REM-P2-01 / P2-05)...');
  await runPaginationCursorTests();

  console.log('▶ [4/8] Ejecutando Gate de Logging JSON Estructurado y Sanitización de PII (REM-P2-04 / P3-03)...');
  await runLoggingSanitizationTests();

  console.log('▶ [5/8] Ejecutando Gate de Motor de Retención y Purga Dry-Run (REM-P2-09)...');
  await runRetentionDryRunTests();

  console.log('▶ [6/8] Ejecutando Gate de Accesibilidad, Focus Trap y Tecla Escape (REM-P2-06)...');
  await runAccessibilityModalTests();

  console.log('▶ [7/8] Ejecutando Gate de Especificación OpenAPI 3.1.0 Sincronizada (REM-P3-02)...');
  await runOpenApiSpecTests();

  console.log('▶ [8/8] Ejecutando Gate de Rendimiento, Índices Compuestos y Bundle (REM-P2-08)...');
  await runPerformanceIndexesTests();

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('========================================================================');
  console.log(`🎉 TODOS LOS QUALITY GATES DE LA FASE 3B.3 APROBADOS CON ÉXITO (${durationSec}s)`);
  console.log('========================================================================\n');
}

if (require.main === module) {
  runMasterPhase3bP2P3().catch(err => {
    console.error('\n🚨 [MASTER GATE FAILED]: Error durante la ejecución de Fase 3B.3:', err);
    process.exit(1);
  });
}

module.exports = { runMasterPhase3bP2P3 };
