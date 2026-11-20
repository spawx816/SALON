'use strict';

/**
 * Prueba controlada de renovación mensual consolidada limitada a UNA empresa y UNA orden.
 *
 * Modos:
 *   - Por defecto (solo lectura / preview): muestra composición del total, tasa USD/DOP,
 *     total en DOP, método de pago y estado de consentimiento SIN ejecutar ningún cobro.
 *   - Ejecución real (requiere --confirm-execute y SAAS_RENEWAL_WORKER_ENABLED=true):
 *     emite 1 única factura/orden congelada para la empresa indicada y ejecuta 1 intento controlado.
 *
 * Uso:
 *   node backend/scripts/test_single_tenant_renewal_controlled.cjs --tenant-id=<UUID> [--confirm-execute]
 */

const { pool } = require('../db');
const { ConsolidatedRenewalService } = require('../services/consolidated_renewal.service');
const { SaasFxRateService } = require('../services/saas_fx_rate.service');
const { CardNetTokenizationProvider } = require('../services/cardnet_tokenization.provider');
const { CardNetGatewayAdapter } = require('../services/cardnet_gateway.adapter');

function parseArg(prefix) {
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : null;
}

async function main() {
  const tenantId = parseArg('--tenant-id=');
  const confirmExecute = process.argv.includes('--confirm-execute');

  if (!tenantId) {
    console.error('Uso: node backend/scripts/test_single_tenant_renewal_controlled.cjs --tenant-id=<UUID> [--confirm-execute]');
    process.exit(1);
  }

  const fxRateService = new SaasFxRateService({ pool });
  const tokenizationProvider = new CardNetTokenizationProvider();
  const gatewayPort = new CardNetGatewayAdapter({ tokenizationProvider });

  const renewalService = new ConsolidatedRenewalService({
    pool,
    gatewayPort,
    fxRateService,
    workerEnabled: confirmExecute && String(process.env.SAAS_RENEWAL_WORKER_ENABLED || '').toLowerCase() === 'true',
  });

  const quote = await renewalService.calculateConsolidatedQuote({ tenantId });
  const [subRows] = await pool.query('SELECT status, periodicity_mode, auto_renew, recurring_consent_at, recurring_consent_version FROM tenant_subscriptions WHERE tenant_id = ? LIMIT 1', [tenantId]);
  const [pmRows] = await pool.query('SELECT brand, last4, exp_month, exp_year, provider_customer_id IS NOT NULL AS has_customer FROM saas_payment_methods WHERE tenant_id = ? ORDER BY is_default DESC, created_at DESC LIMIT 1', [tenantId]);

  console.log('\n📋 RESUMEN PREVIO DE COBRO CONTROLADO (1 EMPRESA / 1 ORDEN)');
  console.log('==============================================================');
  console.log('Tenant ID:', tenantId);
  console.log('Suscripción:', subRows[0] || null);
  console.log('Tarjeta registrada:', pmRows[0] || null);
  console.log('Periodicidad:', quote.periodicityMode, '| Día aniversario:', quote.anchorDay);
  console.log('Tasa USD/DOP:', quote.fxSnapshot.rateFormatted);
  console.log('Desglose (DOP):');
  for (const it of quote.lineItems) {
    console.log(`  - ${it.description}: RD$ ${(Number(it.amount_minor) / 100).toFixed(2)}`);
  }
  console.log(`TOTAL A COBRAR: RD$ ${(Number(quote.totalDopMinor) / 100).toFixed(2)} DOP`);
  console.log('Modo ejecución:', confirmExecute ? 'EJECUCIÓN SOLICITADA' : 'SOLO PREVIEW (SIN COBRO)');

  if (!confirmExecute) {
    console.log('\nℹ️  Sin cambios ni cobros realizados. Para ejecutar 1 único cargo controlado, el operador debe aprobar el importe y pasar --confirm-execute con SAAS_RENEWAL_WORKER_ENABLED=true.');
    return;
  }

  if (!renewalService.isWorkerEnabled()) {
    console.error('\n⛔ Bloqueado: SAAS_RENEWAL_WORKER_ENABLED no está en true. No se ejecutó ningún cobro.');
    process.exit(2);
  }

  const sub = subRows[0];
  const periodStart = sub?.current_period_end || new Date();
  const periodKey = new Date(periodStart).toISOString().slice(0, 10);
  const { invoice } = await renewalService.getOrCreateFrozenMonthlyInvoice({
    tenantId,
    sub,
    periodStart,
    periodEnd: quote.nextChargeDate,
    periodKey,
  });

  await pool.query(
    `INSERT INTO saas_renewal_runs (tenant_id, subscription_id, period_key, invoice_id, status, next_attempt_at)
     VALUES (?, ?, ?, ?, 'pending', NOW())
     ON CONFLICT (tenant_id, period_key) DO NOTHING`,
    [tenantId, sub?.id || null, periodKey, invoice.id]
  );

  const [runRows] = await pool.query(
    `SELECT * FROM saas_renewal_runs WHERE tenant_id = ? AND period_key = ? LIMIT 1`,
    [tenantId, periodKey]
  );
  const outcome = await renewalService._processSingleRun(runRows[0], `controlled_${process.pid}`);
  console.log('\n✅ Resultado de ejecución controlada:', JSON.stringify(outcome, null, 2));
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => pool.end().catch(() => {}));
