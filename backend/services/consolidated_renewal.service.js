'use strict';

const crypto = require('crypto');
const {
  SAAS_PLANS,
  SAAS_ADDONS,
  getConfiguredPricing,
} = require('./saas_catalog.constants');
const {
  INVOICE_STATUS,
  PAYMENT_STATUS,
  DUNNING_POLICY,
  PRICE_BOOK_VERSION,
} = require('./saas_billing.constants');
const { ZeroTaxPolicy } = require('./tax_policy');
const {
  convertUsdMinorToDopMinor,
  parseAndScaleRate,
} = require('./saas_fx_rate.service');
const {
  PERIODICITY_MODES,
  computeNextPeriodEnd,
  toPeriodKey,
} = require('./calendar_billing.utils');
const { classifyCardNetResponseCode } = require('./cardnet_tokenization.provider');

class ConsolidatedRenewalService {
  constructor({
    pool,
    gatewayPort,
    fxRateService,
    lifecycleService = null,
    taxPolicy = new ZeroTaxPolicy(),
    notifier = null,
    clock = () => new Date(),
    workerEnabled = null,
  }) {
    this.pool = pool;
    this.gatewayPort = gatewayPort;
    this.fxRateService = fxRateService;
    this.lifecycleService = lifecycleService;
    this.taxPolicy = taxPolicy;
    this.notifier = notifier;
    this.clock = clock;
    this._workerEnabledOverride = workerEnabled;
  }

  isWorkerEnabled() {
    if (this._workerEnabledOverride !== null && this._workerEnabledOverride !== undefined) {
      return Boolean(this._workerEnabledOverride);
    }
    return String(process.env.SAAS_RENEWAL_WORKER_ENABLED || '').toLowerCase() === 'true';
  }

  /**
   * Calcula la cotización mensual consolidada en DOP (sucursales facturables + usuarios extra + add-ons por sucursal + impuestos),
   * excluyendo cargos únicos de implementación.
   */
  async calculateConsolidatedQuote({ tenantId, fxRateOverride = null }) {
    if (!tenantId) throw new Error('tenantId es obligatorio');

    const [subRows] = await this.pool.query(
      `SELECT * FROM tenant_subscriptions WHERE tenant_id = ? LIMIT 1`,
      [tenantId]
    );
    const sub = subRows?.[0] || null;
    if (!sub) {
      const err = new Error('Suscripción no encontrada para calcular renovación.');
      err.code = 'SUBSCRIPTION_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const [branchRows] = await this.pool.query(
      `SELECT COUNT(*)::int AS cnt FROM branches WHERE tenant_id = ? AND COALESCE(is_active, true) = true`,
      [tenantId]
    );
    const activeBranches = Number(branchRows?.[0]?.cnt || 0);
    const billableBranches = Math.max(1, activeBranches || Number(sub.branches_limit || 1));
    const extraUsers = Math.max(0, Number(sub.extra_users_count || 0));

    let addonBranches = Math.max(0, Number(sub.addon_branches_count || 0));
    if (addonBranches === 0) {
      const [entRows] = await this.pool.query(
        `SELECT enabled FROM tenant_entitlements WHERE tenant_id = ? AND feature_code = ? LIMIT 1`,
        [tenantId, SAAS_ADDONS.MEMBERSHIPS]
      ).catch(() => [[]]);
      if (entRows?.[0]?.enabled === true) {
        addonBranches = billableBranches;
      }
    }
    addonBranches = Math.min(billableBranches, addonBranches);

    const pricing = getConfiguredPricing();
    const branchUsd = Number(pricing?.principal?.usd ?? 99);
    const extraUserUsd = Number(pricing?.principal?.extraUserUsd ?? 30);
    const addonUsd = Number(pricing?.addons?.memberships?.usd ?? 99);

    const branchUsdMinor = BigInt(Math.round(branchUsd * 100)) * BigInt(billableBranches);
    const extraUserUsdMinor = BigInt(Math.round(extraUserUsd * 100)) * BigInt(extraUsers);
    const addonUsdMinor = BigInt(Math.round(addonUsd * 100)) * BigInt(addonBranches);
    const subtotalUsdMinor = branchUsdMinor + extraUserUsdMinor + addonUsdMinor;

    const fxRate = fxRateOverride || (await this.fxRateService.requireCurrentRate('USD_DOP'));
    const parsedRate = parseAndScaleRate(fxRate.rateFormatted ?? fxRate.rate);

    const branchDopMinor = convertUsdMinorToDopMinor(branchUsdMinor, parsedRate.rateScaledBigInt);
    const extraUserDopMinor = convertUsdMinorToDopMinor(extraUserUsdMinor, parsedRate.rateScaledBigInt);
    const addonDopMinor = convertUsdMinorToDopMinor(addonUsdMinor, parsedRate.rateScaledBigInt);
    const subtotalDopMinor = branchDopMinor + extraUserDopMinor + addonDopMinor;

    const taxCalc = this.taxPolicy.calculateTax({
      amountMinor: subtotalDopMinor,
      currency: 'DOP',
      tenantId,
      planCode: sub.plan_code || SAAS_PLANS.PRINCIPAL,
    });
    const taxDopMinor = BigInt(taxCalc?.taxAmountMinor || 0n);
    const totalDopMinor = subtotalDopMinor + taxDopMinor;

    const lineItems = [
      {
        item_type: 'PLAN_BRANCHES',
        description: `Plan Principal Etereas (${billableBranches} ${billableBranches === 1 ? 'sucursal' : 'sucursales'})`,
        amount_minor: branchDopMinor,
        usd_minor: branchUsdMinor.toString(),
      },
    ];
    if (extraUserDopMinor > 0n) {
      lineItems.push({
        item_type: 'EXTRA_USERS',
        description: `Usuarios adicionales (${extraUsers})`,
        amount_minor: extraUserDopMinor,
        usd_minor: extraUserUsdMinor.toString(),
      });
    }
    if (addonDopMinor > 0n) {
      lineItems.push({
        item_type: 'ADDON_MEMBERSHIPS',
        description: `Add-on Membresías B2C (${addonBranches} ${addonBranches === 1 ? 'sucursal' : 'sucursales'})`,
        amount_minor: addonDopMinor,
        usd_minor: addonUsdMinor.toString(),
      });
    }
    if (taxDopMinor > 0n) {
      lineItems.push({
        item_type: 'TAX',
        description: taxCalc.taxDescription || 'Impuestos aplicables',
        amount_minor: taxDopMinor,
      });
    }

    const periodicityMode = sub.periodicity_mode || PERIODICITY_MODES.FIXED_30_DAYS;
    const anchorDay =
      sub.billing_anchor_day ||
      (sub.current_period_start ? new Date(sub.current_period_start).getUTCDate() : this.clock().getUTCDate());
    const nextChargeDate = sub.current_period_end
      ? new Date(sub.current_period_end).toISOString()
      : computeNextPeriodEnd({
          periodStart: this.clock(),
          periodicityMode,
          anchorDay,
        }).toISOString();

    return {
      tenantId,
      planCode: sub.plan_code || SAAS_PLANS.PRINCIPAL,
      periodicityMode,
      anchorDay,
      nextChargeDate,
      currency: 'DOP',
      billableBranches,
      extraUsers,
      addonBranches,
      fxSnapshot: {
        pair: 'USD_DOP',
        rate: parsedRate.rateNumber,
        rateFormatted: parsedRate.rateStr,
        rateScaled: parsedRate.rateScaledBigInt.toString(),
        rateId: fxRate.id ?? null,
      },
      subtotalUsdMinor: subtotalUsdMinor.toString(),
      subtotalDopMinor: subtotalDopMinor.toString(),
      taxDopMinor: taxDopMinor.toString(),
      totalDopMinor: totalDopMinor.toString(),
      lineItems,
      excludesOneTimeImplementation: true,
    };
  }

  /**
   * Crea o recupera de forma idempotente la factura mensual congelada (snapshot de conceptos, tasa y total DOP).
   * Los reintentos NUNCA recalculan la deuda.
   */
  async getOrCreateFrozenMonthlyInvoice({ tenantId, sub, periodStart, periodEnd, periodKey }) {
    const invIdempKey = `renewal_inv_${tenantId}_${periodKey}`;
    const [existingRows] = await this.pool.query(
      `SELECT * FROM saas_invoices WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1`,
      [tenantId, invIdempKey]
    );
    if (existingRows?.[0]) {
      return { invoice: existingRows[0], created: false };
    }

    const quote = await this.calculateConsolidatedQuote({ tenantId });
    const now = this.clock();
    const year = now.getUTCFullYear();

    await this.pool.query(
      `INSERT INTO saas_invoice_counters (tenant_id, year, last_number)
       VALUES (?, ?, 0) ON CONFLICT (tenant_id, year) DO NOTHING`,
      [tenantId, year]
    );
    const [cntRows] = await this.pool.query(
      `UPDATE saas_invoice_counters SET last_number = last_number + 1
       WHERE tenant_id = ? AND year = ? RETURNING last_number`,
      [tenantId, year]
    );
    const seq = Number(cntRows?.[0]?.last_number || 1);
    const invoiceNumber = `INV-${year}-${String(seq).padStart(5, '0')}`;
    const invoiceId = crypto.randomUUID();

    const metadata = {
      type: 'consolidated_monthly_renewal',
      period_key: periodKey,
      periodicity_mode: quote.periodicityMode,
      anchor_day: quote.anchorDay,
      billable_branches: quote.billableBranches,
      extra_users: quote.extraUsers,
      addon_branches: quote.addonBranches,
      fx_snapshot: quote.fxSnapshot,
    };

    const [inserted] = await this.pool.query(
      `INSERT INTO saas_invoices (
         id, tenant_id, invoice_number, subscription_id, plan_code, billing_cycle, price_book_version,
         period_start, period_end, subtotal_minor, tax_minor, total_minor, amount_paid_minor,
         amount_due_minor, amount_refunded_minor, currency, status, due_date, idempotency_key,
         fx_rate_scaled, fx_rate_formatted, metadata, created_at
       ) VALUES (?, ?, ?, ?, ?, 'monthly', ?, ?, ?, ?, ?, ?, 0, ?, 0, 'DOP', ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
       RETURNING *`,
      [
        invoiceId,
        tenantId,
        invoiceNumber,
        sub.id || null,
        quote.planCode,
        PRICE_BOOK_VERSION,
        new Date(periodStart).toISOString(),
        new Date(periodEnd).toISOString(),
        quote.subtotalDopMinor,
        quote.taxDopMinor,
        quote.totalDopMinor,
        quote.totalDopMinor,
        INVOICE_STATUS.OPEN,
        new Date(periodStart).toISOString(),
        invIdempKey,
        quote.fxSnapshot.rateScaled,
        quote.fxSnapshot.rateFormatted,
        JSON.stringify(metadata),
        now.toISOString(),
      ]
    );

    if (!inserted?.[0]) {
      const [raceRows] = await this.pool.query(
        `SELECT * FROM saas_invoices WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1`,
        [tenantId, invIdempKey]
      );
      return { invoice: raceRows[0], created: false };
    }

    for (const item of quote.lineItems) {
      await this.pool.query(
        `INSERT INTO saas_invoice_items (tenant_id, invoice_id, description, item_type, amount_minor, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [tenantId, invoiceId, item.description, item.item_type, item.amount_minor.toString(), now.toISOString()]
      );
    }

    return { invoice: inserted[0], created: true };
  }

  /**
   * Verifica autorización explícita vigente de cobro recurrente + ausencia de revocación posterior.
   */
  async _hasRecurringAuthorization(tenantId, sub) {
    if (!sub || sub.auto_renew === false || sub.cancel_at_period_end === true || !sub.recurring_consent_at) {
      return false;
    }
    if (!sub.recurring_consent_version) {
      return false;
    }
    const [rows] = await this.pool.query(
      `SELECT recurring_authorized FROM tenant_terms_acceptances
       WHERE tenant_id = ?
       ORDER BY accepted_at_utc DESC LIMIT 1`,
      [tenantId]
    ).catch(() => [[]]);
    if (rows && rows.length > 0 && rows[0].recurring_authorized === false) {
      return false;
    }
    return true;
  }

  async _getDefaultPaymentMethod(tenantId) {
    const [rows] = await this.pool.query(
      `SELECT * FROM saas_payment_methods
       WHERE tenant_id = ?
       ORDER BY is_default DESC, created_at DESC LIMIT 1`,
      [tenantId]
    );
    return rows?.[0] || null;
  }

  async _notifyOwner(tenantId, eventType, payload) {
    if (this.notifier && typeof this.notifier.notify === 'function') {
      await this.notifier.notify({ tenantId, eventType, payload }).catch(() => {});
    }
  }

  /**
   * Worker persistente de renovaciones mensuales consolidadas.
   * Por defecto DESACTIVADO hasta autorización expresa tras pruebas.
   */
  async processDueRenewals({ limit = 20, workerId = `worker_${process.pid}` } = {}) {
    if (!this.isWorkerEnabled()) {
      return {
        executed: false,
        reason: 'RENEWAL_WORKER_DISABLED',
        processed: 0,
        results: [],
      };
    }

    const now = this.clock();
    const nowIso = now.toISOString();
    const lockUntilIso = new Date(now.getTime() + 120000).toISOString();

    // 1. Separar descubrimiento global de tenants activos de la consulta scoped por tenant_id
    const [activeTenants] = await this.pool.query(
      `SELECT id FROM tenants WHERE status = 'active' ORDER BY id ASC LIMIT ?`,
      [Math.max(limit * 5, 100)]
    );

    const dueSubs = [];
    for (const t of activeTenants || []) {
      if (dueSubs.length >= limit) break;
      const [subRows] = await this.pool.query(
        `SELECT * FROM tenant_subscriptions
         WHERE tenant_id = ?
           AND status = 'active'
           AND COALESCE(auto_renew, TRUE) = TRUE
           AND COALESCE(cancel_at_period_end, FALSE) = FALSE
           AND current_period_end IS NOT NULL
           AND current_period_end <= ?
         ORDER BY current_period_end ASC
         LIMIT 1`,
        [t.id, nowIso]
      );
      if (subRows && subRows[0]) {
        dueSubs.push(subRows[0]);
      }
    }

    for (const sub of dueSubs || []) {
      const periodKey = toPeriodKey(sub.current_period_end);
      await this.pool.query(
        `INSERT INTO saas_renewal_runs (tenant_id, subscription_id, period_key, status, next_attempt_at, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?, ?)
         ON CONFLICT (tenant_id, period_key) DO NOTHING`,
        [sub.tenant_id, sub.id || null, periodKey, nowIso, nowIso, nowIso]
      );
    }

    // 2. Tomar tareas vencidas de forma atómica (evita doble cobro entre workers concurrentes)
    const [candidates] = await this.pool.query(
      `SELECT r.id
       FROM saas_renewal_runs r
       JOIN tenant_subscriptions s ON s.tenant_id = r.tenant_id
       WHERE r.status IN ('pending', 'retry_scheduled', 'reconciling')
         AND (r.locked_until IS NULL OR r.locked_until < ?)
         AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= ?)
         AND s.status IN ('active', 'past_due')
         AND COALESCE(s.auto_renew, TRUE) = TRUE
         AND COALESCE(s.cancel_at_period_end, FALSE) = FALSE
       ORDER BY r.created_at ASC
       LIMIT ?`,
      [nowIso, nowIso, limit]
    );

    const results = [];
    for (const cand of candidates || []) {
      const [claimedRows] = await this.pool.query(
        `UPDATE saas_renewal_runs
         SET locked_until = ?, locked_by = ?, updated_at = ?
         WHERE id = ?
           AND status IN ('pending', 'retry_scheduled', 'reconciling')
           AND (locked_until IS NULL OR locked_until < ?)
         RETURNING *`,
        [lockUntilIso, workerId, nowIso, cand.id, nowIso]
      );
      const run = claimedRows?.[0];
      if (!run) continue;

      const outcome = await this._processSingleRun(run, workerId);
      results.push(outcome);
    }

    return {
      executed: true,
      processed: results.length,
      results,
    };
  }

  async _processSingleRun(run, workerId) {
    const now = this.clock();
    const nowIso = now.toISOString();
    const tenantId = run.tenant_id;

    try {
      const [subRows] = await this.pool.query(
        `SELECT * FROM tenant_subscriptions WHERE tenant_id = ? LIMIT 1`,
        [tenantId]
      );
      const sub = subRows?.[0];
      if (!sub || sub.status === 'cancelled' || sub.status === 'suspended' || sub.auto_renew === false || sub.cancel_at_period_end === true) {
        await this.pool.query(
          `UPDATE saas_renewal_runs SET status = 'cancelled', locked_until = NULL, updated_at = ? WHERE id = ?`,
          [nowIso, run.id]
        );
        return { tenantId, periodKey: run.period_key, status: 'cancelled' };
      }

      const authorized = await this._hasRecurringAuthorization(tenantId, sub);
      const pm = await this._getDefaultPaymentMethod(tenantId);
      if (!authorized || !pm) {
        await this.pool.query(
          `UPDATE saas_renewal_runs
           SET status = 'failed_final', last_response_code = 'NO_AUTH_OR_PM', last_error = ?, locked_until = NULL, updated_at = ?
           WHERE id = ?`,
          ['Falta autorización recurrente vigente o método de pago CardNet registrado.', nowIso, run.id]
        );
        if (this.lifecycleService) {
          await this.lifecycleService.handlePaymentFailure(tenantId, {
            invoiceId: run.invoice_id,
            failureCode: 'NO_AUTH_OR_PM',
            failureMessage: 'Se requiere actualizar tarjeta o autorizar renovación.',
          });
        }
        await this._notifyOwner(tenantId, 'RENEWAL_REQUIRES_ACTION', { reason: 'NO_AUTH_OR_PM' });
        return { tenantId, periodKey: run.period_key, status: 'failed_final', reason: 'NO_AUTH_OR_PM' };
      }

      const periodStart = sub.current_period_end ? new Date(sub.current_period_end) : now;
      const periodicityMode = sub.periodicity_mode || PERIODICITY_MODES.FIXED_30_DAYS;
      const anchorDay = sub.billing_anchor_day || periodStart.getUTCDate();
      const periodEnd = computeNextPeriodEnd({ periodStart, periodicityMode, anchorDay });

      // Congelar factura mensual (si ya existe, reutiliza el monto y tasa congelados)
      const { invoice } = await this.getOrCreateFrozenMonthlyInvoice({
        tenantId,
        sub,
        periodStart,
        periodEnd,
        periodKey: run.period_key,
      });

      if (invoice.status === INVOICE_STATUS.PAID) {
        await this.pool.query(
          `UPDATE saas_renewal_runs SET status = 'paid', invoice_id = ?, locked_until = NULL, updated_at = ? WHERE id = ?`,
          [invoice.id, nowIso, run.id]
        );
        return { tenantId, periodKey: run.period_key, status: 'already_paid', invoiceId: invoice.id };
      }

      // Conciliar respuesta incierta previa (o caída de worker tras lease vencido) ANTES de intentar un nuevo cargo
      const [uncertainRows] = await this.pool.query(
        `SELECT * FROM saas_payments
         WHERE tenant_id = ? AND invoice_id = ? AND (requires_reconciliation = TRUE OR status = 'pending')
         ORDER BY created_at DESC LIMIT 1`,
        [tenantId, invoice.id]
      );
      if (uncertainRows?.[0]) {
        const prevPay = uncertainRows[0];
        if (this.gatewayPort && typeof this.gatewayPort.reconcileTransaction === 'function') {
          const rec = await this.gatewayPort.reconcileTransaction({
            tenantId,
            transactionId: prevPay.gateway_reference,
            orderNumber: prevPay.gateway_reference,
            idempotencyKey: prevPay.idempotency_key,
          });
          if (rec?.approved) {
            await this.pool.query(
              `UPDATE saas_payments
               SET status = 'success', gateway_reference = COALESCE(?, gateway_reference), requires_reconciliation = FALSE
               WHERE id = ? AND tenant_id = ?`,
              [rec.transactionId || rec.authorizationCode || null, prevPay.id, tenantId]
            );
            return await this._finalizeApprovedRenewal({ run, sub, invoice, periodStart, periodEnd, gatewayRef: rec.transactionId || rec.authorizationCode });
          }
          if (rec?.pending) {
            await this.pool.query(
              `UPDATE saas_renewal_runs SET status = 'reconciling', invoice_id = ?, locked_until = NULL, updated_at = ? WHERE id = ?`,
              [invoice.id, nowIso, run.id]
            );
            return { tenantId, periodKey: run.period_key, status: 'reconciling', invoiceId: invoice.id };
          }
          // Confirmed not approved -> close uncertain payment as failed before charging
          await this.pool.query(
            `UPDATE saas_payments SET status = 'failed', requires_reconciliation = FALSE, failure_code = COALESCE(?, 'RECONCILED_NOT_APPROVED') WHERE id = ? AND tenant_id = ?`,
            [rec?.responseCode || null, prevPay.id, tenantId]
          );
        } else {
          // No se puede conciliar -> nunca volver a cobrar automáticamente a ciegas
          await this.pool.query(
            `UPDATE saas_renewal_runs SET status = 'reconciling', invoice_id = ?, locked_until = NULL, updated_at = ? WHERE id = ?`,
            [invoice.id, nowIso, run.id]
          );
          return { tenantId, periodKey: run.period_key, status: 'reconciling_manual_required', invoiceId: invoice.id };
        }
      }

      // Ejecutar único intento lógico (persistiendo intención PENDING antes de invocar al procesador para tolerar caídas)
      const attemptNumber = Number(run.attempts_count || 0) + 1;
      const chargeIdempKey = `renewal_ch_${tenantId}_${invoice.id}_att_${attemptNumber}`;
      const orderNum = `RN${invoice.invoice_number.replace(/[^A-Z0-9]/gi, '').slice(-10)}A${attemptNumber}`.slice(0, 20);

      const [pendingPayRows] = await this.pool.query(
        `INSERT INTO saas_payments (
           tenant_id, invoice_id, amount_minor, currency, gateway_reference, status,
           idempotency_key, attempt_number, is_retriable, requires_reconciliation, created_at
         ) VALUES (?, ?, ?, 'DOP', ?, 'pending', ?, ?, TRUE, TRUE, ?)
         ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
         RETURNING id`,
        [tenantId, invoice.id, invoice.amount_due_minor, orderNum, chargeIdempKey, attemptNumber, nowIso]
      );
      const pendingPayId = pendingPayRows?.[0]?.id;
      await this.pool.query(
        `UPDATE saas_renewal_runs
         SET status = 'reconciling', invoice_id = ?, attempts_count = ?, updated_at = ?
         WHERE id = ?`,
        [invoice.id, attemptNumber, nowIso, run.id]
      );

      let chargeRes;
      try {
        chargeRes = await this.gatewayPort.charge({
          tenantId,
          amountMinor: BigInt(invoice.amount_due_minor),
          currency: 'DOP',
          paymentMethodToken: pm.token_reference,
          providerCustomerReference: pm.provider_customer_id,
          idempotencyKey: chargeIdempKey,
          orderNumber: orderNum,
          description: `Renovación mensual consolidada ${invoice.invoice_number}`,
        });
      } catch (gwErr) {
        const isTimeout = gwErr.code === 'CARDNET_TIMEOUT' || gwErr.code === 'GATEWAY_TIMEOUT' || gwErr.statusCode === 504;
        if (isTimeout) {
          if (pendingPayId) {
            await this.pool.query(
              `UPDATE saas_payments
               SET gateway_reference = COALESCE(?, gateway_reference), failure_code = 'TIMEOUT', failure_message = ?
               WHERE id = ? AND tenant_id = ?`,
              [gwErr.transactionId || null, gwErr.message, pendingPayId, tenantId]
            );
          }
          await this.pool.query(
            `UPDATE saas_renewal_runs
             SET status = 'reconciling', invoice_id = ?, attempts_count = ?, last_response_code = 'TIMEOUT', last_error = ?, locked_until = NULL, updated_at = ?
             WHERE id = ?`,
            [invoice.id, attemptNumber, gwErr.message, nowIso, run.id]
          );
          return { tenantId, periodKey: run.period_key, status: 'reconciling', invoiceId: invoice.id, attemptNumber };
        }
        throw gwErr;
      }

      if (chargeRes?.approved || chargeRes?.success) {
        const gwRef = chargeRes.chargeId || chargeRes.transactionId || chargeRes.authorizationCode || orderNum;
        if (pendingPayId) {
          await this.pool.query(
            `UPDATE saas_payments
             SET status = 'success', gateway_reference = ?, is_retriable = FALSE, requires_reconciliation = FALSE
             WHERE id = ? AND tenant_id = ?`,
            [gwRef, pendingPayId, tenantId]
          );
        }
        return await this._finalizeApprovedRenewal({ run, sub, invoice, periodStart, periodEnd, gatewayRef: gwRef });
      }

      // Rechazo del procesador: clasificar según reglas oficiales
      const classification = classifyCardNetResponseCode(chargeRes?.responseCode, chargeRes?.responseMessage);
      const isRetriable = Boolean(chargeRes?.retriable ?? classification.retriable) && !classification.requiresAuthentication;
      const canScheduleMore = isRetriable && attemptNumber < DUNNING_POLICY.MAX_RETRY_ATTEMPTS;

      if (pendingPayId) {
        await this.pool.query(
          `UPDATE saas_payments
           SET status = 'failed',
               gateway_reference = COALESCE(?, gateway_reference),
               failure_code = ?,
               failure_message = ?,
               is_retriable = ?,
               requires_reconciliation = FALSE
           WHERE id = ? AND tenant_id = ?`,
          [
            chargeRes?.transactionId || null,
            chargeRes?.responseCode || 'DECLINED',
            chargeRes?.responseMessage || 'Cargo rechazado',
            isRetriable,
            pendingPayId,
            tenantId,
          ]
        );
      }

      if (this.lifecycleService) {
        await this.lifecycleService.handlePaymentFailure(tenantId, {
          invoiceId: invoice.id,
          failureCode: chargeRes?.responseCode || 'DECLINED',
          failureMessage: chargeRes?.responseMessage || 'Cargo rechazado',
        });
      }

      if (canScheduleMore) {
        const daysDelay = DUNNING_POLICY.RETRY_INTERVALS_DAYS[Math.min(attemptNumber - 1, DUNNING_POLICY.RETRY_INTERVALS_DAYS.length - 1)] || 1;
        const nextRetryAt = new Date(now.getTime() + daysDelay * 86400000).toISOString();
        await this.pool.query(
          `UPDATE saas_renewal_runs
           SET status = 'retry_scheduled', invoice_id = ?, attempts_count = ?, next_attempt_at = ?,
               last_response_code = ?, last_error = ?, locked_until = NULL, updated_at = ?
           WHERE id = ?`,
          [invoice.id, attemptNumber, nextRetryAt, chargeRes?.responseCode || 'DECLINED', chargeRes?.responseMessage || null, nowIso, run.id]
        );
        await this._notifyOwner(tenantId, 'RENEWAL_RETRY_SCHEDULED', {
          invoiceId: invoice.id,
          responseCode: chargeRes?.responseCode,
          nextRetryAt,
        });
        return { tenantId, periodKey: run.period_key, status: 'retry_scheduled', attemptNumber, nextRetryAt };
      }

      await this.pool.query(
        `UPDATE saas_renewal_runs
         SET status = 'failed_final', invoice_id = ?, attempts_count = ?,
             last_response_code = ?, last_error = ?, locked_until = NULL, updated_at = ?
         WHERE id = ?`,
        [invoice.id, attemptNumber, chargeRes?.responseCode || 'DECLINED', chargeRes?.responseMessage || null, nowIso, run.id]
      );
      await this._notifyOwner(tenantId, 'RENEWAL_FAILED_FINAL', {
        invoiceId: invoice.id,
        responseCode: chargeRes?.responseCode,
        requiresAuthentication: classification.requiresAuthentication,
      });
      return {
        tenantId,
        periodKey: run.period_key,
        status: 'failed_final',
        attemptNumber,
        responseCode: chargeRes?.responseCode,
        requiresAuthentication: classification.requiresAuthentication,
      };
    } catch (err) {
      await this.pool.query(
        `UPDATE saas_renewal_runs SET last_error = ?, locked_until = NULL, updated_at = ? WHERE id = ?`,
        [err.message, nowIso, run.id]
      ).catch(() => {});
      return { tenantId, periodKey: run.period_key, status: 'error', error: err.message, workerId };
    }
  }

  async _finalizeApprovedRenewal({ run, sub, invoice, periodStart, periodEnd, gatewayRef }) {
    const nowIso = this.clock().toISOString();

    await this.pool.query(
      `UPDATE saas_invoices
       SET status = 'paid', amount_paid_minor = total_minor, amount_due_minor = 0, paid_at = COALESCE(paid_at, ?)
       WHERE id = ? AND tenant_id = ?`,
      [nowIso, invoice.id, run.tenant_id]
    );

    await this.pool.query(
      `UPDATE tenant_subscriptions
       SET status = 'active',
           grace_period_until = NULL,
           current_period_start = ?,
           current_period_end = ?,
           updated_at = ?
       WHERE tenant_id = ?`,
      [periodStart.toISOString(), periodEnd.toISOString(), nowIso, run.tenant_id]
    );

    await this.pool.query(
      `UPDATE saas_renewal_runs
       SET status = 'paid', invoice_id = ?, last_response_code = '00', last_error = NULL, locked_until = NULL, updated_at = ?
       WHERE id = ?`,
      [invoice.id, nowIso, run.id]
    );

    await this._notifyOwner(run.tenant_id, 'RENEWAL_PAID_RECEIPT', {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      totalDopMinor: String(invoice.total_minor),
      nextDueDate: periodEnd.toISOString(),
      gatewayRef,
    });

    return {
      tenantId: run.tenant_id,
      periodKey: run.period_key,
      status: 'paid',
      invoiceId: invoice.id,
      nextPeriodEnd: periodEnd.toISOString(),
    };
  }
}

module.exports = {
  ConsolidatedRenewalService,
};
