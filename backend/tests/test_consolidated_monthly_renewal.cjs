'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { validateTestEnvironment, createIsolatedTestPool } = require('../utils/test_env_guard.cjs');
const { up: applyRenewalMigration } = require('../migrations/20261119_consolidated_monthly_renewal.cjs');
const {
  PERIODICITY_MODES,
  addCalendarMonthPreservingAnchor,
  computeNextPeriodEnd,
} = require('../services/calendar_billing.utils');
const { ConsolidatedRenewalService } = require('../services/consolidated_renewal.service');
const { classifyCardNetResponseCode } = require('../services/cardnet_tokenization.provider');

async function main() {
  const testConfig = validateTestEnvironment();
  const pool = createIsolatedTestPool(testConfig);

  const [ctx] = await pool.query('SELECT current_database() AS db, current_user AS usr');
  assert.strictEqual(ctx[0].db, testConfig.database);
  console.log(`🔄 Iniciando pruebas de Renovación Mensual Consolidada en db="${ctx[0].db}"...`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_terms_acceptances (
      id SERIAL PRIMARY KEY,
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      user_id UUID NOT NULL,
      terms_version VARCHAR(50) NOT NULL,
      document_hash VARCHAR(64) NOT NULL,
      accepted_at_utc TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      acceptance_mechanism VARCHAR(50) NOT NULL DEFAULT 'checkbox_onboarding',
      ip_address VARCHAR(50),
      user_agent TEXT,
      recurring_authorized BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
  await applyRenewalMigration(pool);

  // 1. Pruebas unitarias de mes calendario y recuperación de aniversario de fin de mes
  {
    const jan31 = new Date('2026-01-31T12:00:00.000Z');
    const feb28 = addCalendarMonthPreservingAnchor(jan31, 31);
    assert.strictEqual(feb28.toISOString().slice(0, 10), '2026-02-28');
    const mar31 = addCalendarMonthPreservingAnchor(feb28, 31);
    assert.strictEqual(mar31.toISOString().slice(0, 10), '2026-03-31');
    const apr30 = addCalendarMonthPreservingAnchor(mar31, 31);
    assert.strictEqual(apr30.toISOString().slice(0, 10), '2026-04-30');
    const may31 = addCalendarMonthPreservingAnchor(apr30, 31);
    assert.strictEqual(may31.toISOString().slice(0, 10), '2026-05-31');

    // Año bisiesto 2024
    const leapFeb = addCalendarMonthPreservingAnchor(new Date('2024-01-31T12:00:00.000Z'), 31);
    assert.strictEqual(leapFeb.toISOString().slice(0, 10), '2024-02-29');
    const leapMar = addCalendarMonthPreservingAnchor(leapFeb, 31);
    assert.strictEqual(leapMar.toISOString().slice(0, 10), '2024-03-31');

    // Suscripción previa de 30 días no se altera automáticamente
    const fixedNext = computeNextPeriodEnd({
      periodStart: jan31,
      periodicityMode: PERIODICITY_MODES.FIXED_30_DAYS,
      anchorDay: 31,
    });
    assert.strictEqual(fixedNext.toISOString().slice(0, 10), '2026-03-02');
    console.log('  ✅ 1. Periodicidad por mes calendario, fin de mes (31->28/29->31) y preservación de 30 días previos verificadas.');
  }

  // Clasificación oficial de códigos CardNet
  {
    assert.strictEqual(classifyCardNetResponseCode('00').category, 'approved');
    assert.strictEqual(classifyCardNetResponseCode('51').retriable, true);
    assert.strictEqual(classifyCardNetResponseCode('54').retriable, false);
    assert.strictEqual(classifyCardNetResponseCode('3DS').requiresAuthentication, true);
    console.log('  ✅ 2. Clasificación oficial de códigos CardNet (00, soft 51, hard 54, 3DS) verificada.');
  }

  const tag = crypto.randomBytes(4).toString('hex');
  const tenantIds = [];
  const createTenantFixture = async ({
    anchorDay = 31,
    periodStart = '2026-01-31T10:00:00.000Z',
    periodEnd = '2026-02-28T10:00:00.000Z',
    branchesCount = 1,
    extraUsersCount = 0,
    addonBranchesCount = 0,
    status = 'active',
    autoRenew = true,
    cancelAtPeriodEnd = false,
    periodicityMode = 'calendar_month',
  } = {}) => {
    const tId = crypto.randomUUID();
    tenantIds.push(tId);
    const subId = crypto.randomUUID();
    const userId = crypto.randomUUID();

    await pool.query(
      `INSERT INTO tenants (id, business_name, email, slug, status) VALUES (?, ?, ?, ?, 'active')`,
      [tId, `Renewal Salon ${tId.slice(0, 6)}`, `own-${tId.slice(0, 6)}@test.local`, `ren-${tId.slice(0, 6)}-${tag}`]
    );
    await pool.query(
      `INSERT INTO users (id, tenant_id, name, email, password_hash, role, is_active) VALUES (?, ?, 'Owner', ?, 'test_hash_only', 'propietario', TRUE)`,
      [userId, tId, `own-${tId.slice(0, 6)}@test.local`]
    );
    for (let i = 0; i < branchesCount; i++) {
      await pool.query(
        `INSERT INTO branches (id, tenant_id, name, is_main, is_active) VALUES (?, ?, ?, ?, TRUE)`,
        [crypto.randomUUID(), tId, `Sucursal ${i + 1}`, i === 0]
      );
    }
    await pool.query(
      `INSERT INTO tenant_subscriptions (
         id, tenant_id, plan_code, status, billing_cycle, currency, periodicity_mode,
         billing_anchor_day, auto_renew, cancel_at_period_end, recurring_consent_at, recurring_consent_version,
         extra_users_count, addon_branches_count, current_period_start, current_period_end
       ) VALUES (?, ?, 'PRINCIPAL', ?, 'monthly', 'DOP', ?, ?, ?, ?, NOW(), 'v2026.1', ?, ?, ?, ?)`,
      [
        subId,
        tId,
        status,
        periodicityMode,
        anchorDay,
        autoRenew,
        cancelAtPeriodEnd,
        extraUsersCount,
        addonBranchesCount,
        periodStart,
        periodEnd,
      ]
    );
    await pool.query(
      `INSERT INTO saas_payment_methods (tenant_id, gateway_type, token_reference, provider_customer_id, last4, brand, exp_month, exp_year, is_default)
       VALUES (?, 'cardnet', ?, ?, '4242', 'visa', 12, 2029, TRUE)`,
      [tId, `tok_cardnet_${tId.slice(0, 8)}`, `cus_${tId.slice(0, 8)}`]
    );
    return { tId, subId, userId };
  };

  try {
    let currentRate = 60.0;
    const fxRateService = {
      async requireCurrentRate() {
        return { id: 1, pair: 'USD_DOP', rate: currentRate, rateFormatted: currentRate.toFixed(4) };
      },
    };

    const prevExtraPrice = process.env.SAAS_EXTRA_USER_PRICE_USD;
    process.env.SAAS_EXTRA_USER_PRICE_USD = '30';

    // 3. Cotización consolidada multi-sucursal + usuarios extra + add-ons (sin cargos únicos) + worker desactivado por defecto
    {
      const { tId } = await createTenantFixture({
        branchesCount: 3,
        extraUsersCount: 2,
        addonBranchesCount: 2,
        periodEnd: '2027-01-01T10:00:00.000Z',
      });
      const disabledWorker = new ConsolidatedRenewalService({ pool, fxRateService, gatewayPort: {} });
      assert.strictEqual(disabledWorker.isWorkerEnabled(), false);
      const resDisabled = await disabledWorker.processDueRenewals();
      assert.strictEqual(resDisabled.executed, false);
      assert.strictEqual(resDisabled.reason, 'RENEWAL_WORKER_DISABLED');

      const quote = await disabledWorker.calculateConsolidatedQuote({ tenantId: tId });
      // (1 membresía de hasta 3 sucursales * 99 + 2*30 + 2*99) = 99 + 60 + 198 = 357 USD * 60.00 = 21,420.00 DOP (2142000 minor)
      assert.strictEqual(quote.currency, 'DOP');
      assert.strictEqual(quote.subtotalUsdMinor, '35700');
      assert.strictEqual(quote.totalDopMinor, '2142000');
      assert.strictEqual(quote.excludesOneTimeImplementation, true);
      console.log('  ✅ 3. Cotización consolidada (3 sucursales + 2 usuarios + 2 add-ons en DOP) y bloqueo por defecto del worker verificados.');
    }

    // 4. Workers concurrentes + renovación mes calendario (Feb 28 -> Mar 31) sin doble cobro
    {
      const { tId } = await createTenantFixture({
        anchorDay: 31,
        periodStart: '2026-01-31T10:00:00.000Z',
        periodEnd: '2026-02-28T10:00:00.000Z',
        branchesCount: 2,
        addonBranchesCount: 1,
      });

      let chargeCount = 0;
      const gatewayPort = {
        async charge({ amountMinor, currency }) {
          chargeCount += 1;
          assert.strictEqual(currency, 'DOP');
          assert.strictEqual(amountMinor > 0n, true);
          await new Promise((r) => setTimeout(r, 40));
          return { approved: true, success: true, transactionId: `TX-${chargeCount}`, responseCode: '00' };
        },
      };
      const notifications = [];
      const notifier = { async notify(ev) { notifications.push(ev); } };
      const clock = () => new Date('2026-02-28T12:00:00.000Z');

      const w1 = new ConsolidatedRenewalService({ pool, gatewayPort, fxRateService, notifier, clock, workerEnabled: true });
      const w2 = new ConsolidatedRenewalService({ pool, gatewayPort, fxRateService, notifier, clock, workerEnabled: true });

      const [res1, res2] = await Promise.all([w1.processDueRenewals({ workerId: 'w1' }), w2.processDueRenewals({ workerId: 'w2' })]);
      if (chargeCount !== 1) {
        console.error('DEBUG res1/res2:', JSON.stringify({ res1, res2 }, null, 2));
      }
      assert.strictEqual(chargeCount, 1, 'Workers concurrentes nunca deben ejecutar dos cobros');

      const [subAfter] = await pool.query('SELECT current_period_end FROM tenant_subscriptions WHERE tenant_id = ?', [tId]);
      assert.strictEqual(new Date(subAfter[0].current_period_end).toISOString().slice(0, 10), '2026-03-31');
      assert.ok(notifications.some((n) => n.tenantId === tId && n.eventType === 'RENEWAL_PAID_RECEIPT'));
      console.log('  ✅ 4. Concurrencia de workers sin doble cobro + recuperación de aniversario (28 Feb -> 31 Mar) + recibo verificados.');
    }

    // 5. Cambio de tasa tras fallo blando: el reintento NO recalcula la deuda congelada
    {
      currentRate = 60.0;
      const { tId } = await createTenantFixture({
        periodStart: '2026-03-01T10:00:00.000Z',
        periodEnd: '2026-04-01T10:00:00.000Z',
        branchesCount: 1,
      });
      let nowTime = new Date('2026-04-01T12:00:00.000Z');
      const chargedAmounts = [];
      let shouldFail = true;
      const gatewayPort = {
        async charge({ tenantId: cTid, amountMinor }) {
          if (cTid === tId) chargedAmounts.push(String(amountMinor));
          if (shouldFail) {
            return { approved: false, responseCode: '51', responseMessage: 'Fondos insuficientes', retriable: true };
          }
          return { approved: true, success: true, transactionId: `TX-RETRY-${cTid.slice(0, 6)}`, responseCode: '00' };
        },
      };

      const svc = new ConsolidatedRenewalService({ pool, gatewayPort, fxRateService, clock: () => nowTime, workerEnabled: true });
      await svc.processDueRenewals({ workerId: 'w-retry' });
      assert.deepStrictEqual(chargedAmounts, ['594000']); // 99 USD * 60 = 5940 DOP

      // Cambiar tasa manual a 65.00 DOP antes del reintento -> deuda debe mantenerse congelada en 594000
      currentRate = 65.0;
      shouldFail = false;
      nowTime = new Date('2026-04-03T12:00:00.000Z');
      await svc.processDueRenewals({ workerId: 'w-retry' });
      assert.deepStrictEqual(chargedAmounts, ['594000', '594000']);
      console.log('  ✅ 5. Deuda y tasa congeladas al emitir factura: cambio de tasa no altera el monto en reintentos.');
    }

    // 6. Respuesta perdida (timeout) después de cobro aprobado -> conciliación evita doble cobro
    {
      currentRate = 60.0;
      const { tId } = await createTenantFixture({
        periodStart: '2026-04-01T10:00:00.000Z',
        periodEnd: '2026-05-01T10:00:00.000Z',
        branchesCount: 1,
      });
      let chargeCalls = 0;
      let reconcileCalls = 0;
      const gatewayPort = {
        async charge({ tenantId: cTid }) {
          if (cTid === tId) {
            chargeCalls += 1;
            const err = new Error('Timeout leyendo respuesta de CardNet');
            err.code = 'CARDNET_TIMEOUT';
            err.transactionId = 'TX-LOST-RESP-1';
            throw err;
          }
          return { approved: true, success: true, transactionId: `TX-OTHER-${cTid.slice(0, 6)}`, responseCode: '00' };
        },
        async reconcileTransaction({ transactionId }) {
          reconcileCalls += 1;
          assert.strictEqual(transactionId, 'TX-LOST-RESP-1');
          return { found: true, approved: true, transactionId: 'TX-LOST-RESP-1', responseCode: '00' };
        },
      };

      const svc = new ConsolidatedRenewalService({
        pool,
        gatewayPort,
        fxRateService,
        clock: () => new Date('2026-05-01T12:00:00.000Z'),
        workerEnabled: true,
      });
      const r1 = await svc.processDueRenewals({ workerId: 'w-rec' });
      assert.strictEqual(r1.results.find((r) => r.tenantId === tId).status, 'reconciling');
      assert.strictEqual(chargeCalls, 1);

      const r2 = await svc.processDueRenewals({ workerId: 'w-rec' });
      assert.strictEqual(r2.results.find((r) => r.tenantId === tId).status, 'paid');
      assert.strictEqual(reconcileCalls, 1);
      assert.strictEqual(chargeCalls, 1, 'No debe volver a cobrar si la conciliación confirma aprobación');
      console.log('  ✅ 6. Respuesta perdida tras cobro aprobado: conciliación previa evita segundo cargo.');
    }

    // 7. Rechazo definitivo (54), cancelación y suspensión (sin acumulación de períodos)
    {
      const hard = await createTenantFixture({
        periodStart: '2026-05-01T10:00:00.000Z',
        periodEnd: '2026-06-01T10:00:00.000Z',
      });
      const cancelled = await createTenantFixture({
        periodStart: '2026-05-01T10:00:00.000Z',
        periodEnd: '2026-06-01T10:00:00.000Z',
        autoRenew: false,
        cancelAtPeriodEnd: true,
      });
      const suspended = await createTenantFixture({
        periodStart: '2026-05-01T10:00:00.000Z',
        periodEnd: '2026-06-01T10:00:00.000Z',
        status: 'suspended',
      });

      const chargedTenants = [];
      const gatewayPort = {
        async charge({ tenantId }) {
          chargedTenants.push(tenantId);
          return { approved: false, responseCode: '54', responseMessage: 'Tarjeta expirada', retriable: false };
        },
      };
      const svc = new ConsolidatedRenewalService({
        pool,
        gatewayPort,
        fxRateService,
        clock: () => new Date('2026-06-01T12:00:00.000Z'),
        workerEnabled: true,
      });
      const res = await svc.processDueRenewals({ workerId: 'w-hard' });
      const hardRes = res.results.find((r) => r.tenantId === hard.tId);
      assert.strictEqual(hardRes.status, 'failed_final');
      assert.ok(!chargedTenants.includes(cancelled.tId), 'Suscripción cancelada no debe cobrarse');
      assert.ok(!chargedTenants.includes(suspended.tId), 'Suscripción suspendida no debe acumular ni cobrar');
      console.log('  ✅ 7. Rechazo definitivo sin reintentos ciegos + bloqueo de cobro en canceladas y suspendidas verificados.');
    }

    // 8. Caída del worker después de cobro aprobado + expiración de lease (sin segundo cobro)
    {
      const { tId } = await createTenantFixture({
        periodStart: '2026-06-01T10:00:00.000Z',
        periodEnd: '2026-07-01T10:00:00.000Z',
      });
      let chargeCalls = 0;
      let reconcileCalls = 0;
      const gatewayPort = {
        async charge({ tenantId: cTid, orderNumber }) {
          if (cTid !== tId) return { approved: true, success: true, responseCode: '00' };
          chargeCalls += 1;
          // Simular caída abrupta del proceso después de que CardNet procesó el cargo
          throw new Error(`CRASH_AFTER_PROVIDER_CHARGE:${orderNumber}`);
        },
        async reconcileTransaction({ orderNumber }) {
          reconcileCalls += 1;
          return { found: true, approved: true, transactionId: `TX-REC-${orderNumber}`, responseCode: '00' };
        },
      };

      const crashClock = () => new Date('2026-07-01T12:00:00.000Z');
      const wCrash = new ConsolidatedRenewalService({ pool, gatewayPort, fxRateService, clock: crashClock, workerEnabled: true });
      await wCrash.processDueRenewals({ workerId: 'w-crash' });
      assert.strictEqual(chargeCalls, 1);

      // Avanzar reloj más allá del lease (3 minutos después) y correr otro worker
      const recoveryClock = () => new Date('2026-07-01T12:03:00.000Z');
      const wRecover = new ConsolidatedRenewalService({ pool, gatewayPort, fxRateService, clock: recoveryClock, workerEnabled: true });
      const recRes = await wRecover.processDueRenewals({ workerId: 'w-recover' });
      assert.strictEqual(recRes.results.find((r) => r.tenantId === tId).status, 'paid');
      assert.strictEqual(chargeCalls, 1, 'Lease vencido tras caída NO debe volver a cobrar sin conciliación');
      assert.strictEqual(reconcileCalls, 1);
      console.log('  ✅ 8. Caída tras cobro + lease vencido: concilia antes de cobrar y evita doble cargo.');
    }

    // 9. Revocación de autorización con factura pendiente impide cobro automático posterior
    {
      const { tId, userId } = await createTenantFixture({
        periodStart: '2026-07-01T10:00:00.000Z',
        periodEnd: '2026-08-01T10:00:00.000Z',
      });
      let chargeCalls = 0;
      let shouldDecline = true;
      const gatewayPort = {
        async charge({ tenantId: cTid }) {
          if (cTid !== tId) return { approved: true, success: true, responseCode: '00' };
          chargeCalls += 1;
          if (shouldDecline) return { approved: false, responseCode: '51', responseMessage: 'Fondos insuficientes', retriable: true };
          return { approved: true, success: true, responseCode: '00' };
        },
      };

      const svc = new ConsolidatedRenewalService({
        pool,
        gatewayPort,
        fxRateService,
        clock: () => new Date('2026-08-01T12:00:00.000Z'),
        workerEnabled: true,
      });
      await svc.processDueRenewals({ workerId: 'w-rev-1' });
      assert.strictEqual(chargeCalls, 1);

      // Owner revoca autorización mientras la factura sigue pendiente
      await pool.query(
        `INSERT INTO tenant_terms_acceptances (tenant_id, user_id, terms_version, document_hash, accepted_at_utc, acceptance_mechanism, recurring_authorized)
         VALUES (?, ?, 'v2026.1', 'revoked', NOW(), 'owner_revocation', FALSE)`,
        [tId, userId]
      );
      await pool.query(`UPDATE tenant_subscriptions SET auto_renew = FALSE WHERE tenant_id = ?`, [tId]);

      shouldDecline = false;
      const svc2 = new ConsolidatedRenewalService({
        pool,
        gatewayPort,
        fxRateService,
        clock: () => new Date('2026-08-03T12:00:00.000Z'),
        workerEnabled: true,
      });
      await svc2.processDueRenewals({ workerId: 'w-rev-2' });
      assert.strictEqual(chargeCalls, 1, 'Factura pendiente NO debe cobrarse tras revocación de autorización');
      console.log('  ✅ 9. Factura pendiente bloqueada tras revocación de autorización.');
    }

    if (prevExtraPrice === undefined) delete process.env.SAAS_EXTRA_USER_PRICE_USD;
    else process.env.SAAS_EXTRA_USER_PRICE_USD = prevExtraPrice;

    console.log('\n🎉 TODAS LAS PRUEBAS DE RENOVACIÓN MENSUAL CONSOLIDADA PASARON.');
  } finally {
    if (tenantIds.length > 0) {
      await pool.query('DELETE FROM saas_renewal_runs WHERE tenant_id = ANY(?)', [tenantIds]).catch(() => {});
      await pool.query('DELETE FROM saas_payments WHERE tenant_id = ANY(?)', [tenantIds]).catch(() => {});
      await pool.query('DELETE FROM saas_invoice_items WHERE tenant_id = ANY(?)', [tenantIds]).catch(() => {});
      await pool.query('DELETE FROM saas_invoices WHERE tenant_id = ANY(?)', [tenantIds]).catch(() => {});
      await pool.query('DELETE FROM saas_invoice_counters WHERE tenant_id = ANY(?)', [tenantIds]).catch(() => {});
      await pool.query('DELETE FROM saas_payment_methods WHERE tenant_id = ANY(?)', [tenantIds]).catch(() => {});
      await pool.query('DELETE FROM tenant_subscriptions WHERE tenant_id = ANY(?)', [tenantIds]).catch(() => {});
      await pool.query('DELETE FROM branches WHERE tenant_id = ANY(?)', [tenantIds]).catch(() => {});
      await pool.query('DELETE FROM users WHERE tenant_id = ANY(?)', [tenantIds]).catch(() => {});
      await pool.query('DELETE FROM tenants WHERE id = ANY(?)', [tenantIds]).catch(() => {});
    }
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ ERROR EN PRUEBAS DE RENOVACIÓN CONSOLIDADA:', err);
  process.exit(1);
});
