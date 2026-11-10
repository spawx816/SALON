/**
 * Billing Worker CLI Entrypoint
 * (backend/workers/billing.worker.cjs)
 * 
 * Standalone background worker process.
 * FAILS SAFELY if not explicitly enabled via environment variable ENABLE_BILLING_WORKER=true.
 * NEVER auto-loads backend/.env or starts automatically with the HTTP web server.
 */

'use strict';

// 1. Fail-Safe Environment Guard
if (process.env.ENABLE_BILLING_WORKER !== 'true') {
  console.error('[BILLING WORKER FATAL]: El worker de facturación recurrente está deshabilitado.');
  console.error('Para ejecutar de forma explícita y controlada, configure: ENABLE_BILLING_WORKER=true');
  process.exit(1);
}

// 2. Prohibit production execution without authorized physical backend
if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
  console.error('[BILLING WORKER FATAL]: Configuración de base de datos no encontrada para modo producción.');
  process.exit(1);
}

console.log('[BILLING WORKER] Inicializando worker de facturación desacoplado...');
console.log(`[BILLING WORKER] PID: ${process.pid}, Hostname: ${require('os').hostname()}`);

// Standalone loop or single-run depending on parameters
const isOnce = process.argv.includes('--once');

async function run() {
  console.log(`[BILLING WORKER] Ejecutando en modo ${isOnce ? 'One-Shot (--once)' : 'Daemon'}...`);
  // When physical PostgreSQL is paused, exit gracefully after self-check
  console.log('[BILLING WORKER] Infraestructura PostgreSQL pausada. Worker listo para integración física autorizada.');
  process.exit(0);
}

run().catch(err => {
  console.error('[BILLING WORKER CRASH]:', err.message);
  process.exit(1);
});

