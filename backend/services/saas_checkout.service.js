const crypto = require('crypto');
const {
  SAAS_PLANS,
  SAAS_ADDONS,
  getConfiguredPricing,
} = require('./saas_catalog.constants');
const {
  convertUsdMinorToDopMinor,
  parseAndScaleRate,
} = require('./saas_fx_rate.service');

const ORDER_STATUS = Object.freeze({
  PENDING_PAYMENT: 'pending_payment',
  PROCESSING: 'processing',
  APPROVED: 'approved',
  DECLINED: 'declined',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  UNKNOWN_TIMEOUT: 'unknown_timeout',
});

function generateOrderNumber() {
  const ts = Date.now().toString(36).toUpperCase().slice(-7);
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `ET${ts}${rand}`.slice(0, 20);
}

function sanitizeOrderForClient(order) {
  if (!order) return null;
  // Nunca exponer cardnet_session_key ni datos internos sensibles al cliente
  const {
    cardnet_session_key: _hiddenKey,
    ...safe
  } = order;
  return {
    ...safe,
    subtotal_minor: String(safe.subtotal_minor ?? 0),
    tax_minor: String(safe.tax_minor ?? 0),
    total_minor: String(safe.total_minor ?? 0),
  };
}

class SaasCheckoutService {
  constructor({ pool, cardnetProvider, tokenizationProvider = null, fxRateService = null, entitlementsService, lifecycleService, billingRepo, errorAlertService = null }) {
    this.pool = pool;
    this.cardnetProvider = cardnetProvider;
    this.tokenizationProvider = tokenizationProvider;
    this.fxRateService = fxRateService;
    this.entitlementsService = entitlementsService;
    this.lifecycleService = lifecycleService;
    this.billingRepo = billingRepo;
    this.errorAlertService = errorAlertService;
  }

  _shouldUseTokenization() {
    if (!this.tokenizationProvider) return false;
    const tokStatus = this.tokenizationProvider.getConfigurationStatus();
    if (tokStatus.configured || tokStatus.blockedInProduction) return true;
    const hostedStatus = this.cardnetProvider?.getConfigurationStatus?.();
    if (hostedStatus?.configured) return false;
    return Boolean(this.tokenizationProvider.publicKey || this.tokenizationProvider.privateKey);
  }

  getGatewayStatus() {
    if (this._shouldUseTokenization()) {
      return this.tokenizationProvider.getConfigurationStatus();
    }
    return this.cardnetProvider?.getConfigurationStatus?.() || { configured: false };
  }

  calculateCanonicalAmounts({
    branchesCount = 1,
    extraUsersCount = 0,
    wantsMembershipsAddon = false,
    addonBranchesCount = 0,
    fxRate = null,
  }) {
    const pricing = getConfiguredPricing();
    const unitUsd = pricing?.principal?.usd;
    if (unitUsd === null || unitUsd === undefined || Number(unitUsd) <= 0) {
      const err = new Error('El precio vigente del Plan Principal no está configurado.');
      err.code = 'PLAN_PRICE_NOT_CONFIGURED';
      err.statusCode = 500;
      throw err;
    }

    const safeBranches = Math.max(1, Math.min(50, parseInt(branchesCount, 10) || 1));
    const safeExtraUsers = Math.max(0, Math.min(500, parseInt(extraUsersCount, 10) || 0));
    const safeAddonEnabled = Boolean(wantsMembershipsAddon);
    const safeAddonBranches = safeAddonEnabled
      ? Math.max(1, Math.min(safeBranches, parseInt(addonBranchesCount, 10) || 1))
      : 0;

    const extraUserUsd = pricing?.principal?.extraUserUsd;
    if (safeExtraUsers > 0 && (extraUserUsd === null || extraUserUsd === undefined)) {
      const err = new Error('La tarifa de usuarios adicionales requiere cotización comercial.');
      err.code = 'EXTRA_USER_QUOTE_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    const addonUsd = Number(pricing?.addons?.memberships?.usd ?? 99);
    const branchesPerBlock = Number(pricing?.addons?.memberships?.branchesPerBlock ?? 3);
    const principalMembershipsCount = Math.max(1, Math.ceil(safeBranches / 3));
    const grantedBranches = principalMembershipsCount * 3;
    const addonBlocksCount = safeAddonEnabled ? Math.max(1, Math.ceil(safeAddonBranches / branchesPerBlock)) : 0;
    const branchUsdMinor = BigInt(Math.round(Number(unitUsd) * 100)) * BigInt(principalMembershipsCount);
    const extraUserUsdMinor =
      safeExtraUsers > 0 ? BigInt(Math.round(Number(extraUserUsd || 0) * 100)) * BigInt(safeExtraUsers) : 0n;
    const addonUsdMinor = safeAddonEnabled ? BigInt(Math.round(addonUsd * 100)) * BigInt(addonBlocksCount) : 0n;

    const subtotalUsdMinor = branchUsdMinor + extraUserUsdMinor + addonUsdMinor;
    const taxUsdMinor = 0n; // B2B SaaS export/digital services; extensible por política fiscal
    const totalUsdMinor = subtotalUsdMinor + taxUsdMinor;

    if (!fxRate) {
      return {
        planCode: SAAS_PLANS.PRINCIPAL,
        branchesCount: safeBranches,
        extraUsersCount: safeExtraUsers,
        wantsMembershipsAddon: safeAddonEnabled,
        addonBranchesCount: safeAddonBranches,
        addonBlocksCount,
        addonBranchCapacity: addonBlocksCount * branchesPerBlock,
        currency: 'USD',
        billingCycle: 'monthly',
        subtotalMinor: subtotalUsdMinor,
        taxMinor: taxUsdMinor,
        totalMinor: totalUsdMinor,
        fxSnapshot: null,
      };
    }

    const parsedRate = parseAndScaleRate(fxRate.rateFormatted ?? fxRate.rate);
    const branchDopMinor = convertUsdMinorToDopMinor(branchUsdMinor, parsedRate.rateScaledBigInt);
    const extraUserDopMinor = convertUsdMinorToDopMinor(extraUserUsdMinor, parsedRate.rateScaledBigInt);
    const addonDopMinor = convertUsdMinorToDopMinor(addonUsdMinor, parsedRate.rateScaledBigInt);
    const subtotalDopMinor = branchDopMinor + extraUserDopMinor + addonDopMinor;
    const taxDopMinor = convertUsdMinorToDopMinor(taxUsdMinor, parsedRate.rateScaledBigInt);
    const totalDopMinor = subtotalDopMinor + taxDopMinor;

    const fxSnapshot = {
      pair: fxRate.pair || 'USD_DOP',
      rate: parsedRate.rateNumber,
      rate_formatted: parsedRate.rateStr,
      rate_scaled_10000: parsedRate.rateScaledBigInt.toString(),
      rate_id: fxRate.id ?? null,
      rate_updated_at: fxRate.updatedAt ?? fxRate.updated_at ?? null,
      snapshot_at: new Date().toISOString(),
      usd: {
        currency: 'USD',
        branches_minor: branchUsdMinor.toString(),
        extra_users_minor: extraUserUsdMinor.toString(),
        addon_minor: addonUsdMinor.toString(),
        subtotal_minor: subtotalUsdMinor.toString(),
        tax_minor: taxUsdMinor.toString(),
        total_minor: totalUsdMinor.toString(),
      },
      dop: {
        currency: 'DOP',
        branches_minor: branchDopMinor.toString(),
        extra_users_minor: extraUserDopMinor.toString(),
        addon_minor: addonDopMinor.toString(),
        subtotal_minor: subtotalDopMinor.toString(),
        tax_minor: taxDopMinor.toString(),
        total_minor: totalDopMinor.toString(),
      },
    };

    return {
      planCode: SAAS_PLANS.PRINCIPAL,
      branchesCount: safeBranches,
      extraUsersCount: safeExtraUsers,
      wantsMembershipsAddon: safeAddonEnabled,
      addonBranchesCount: safeAddonBranches,
      addonBlocksCount,
      addonBranchCapacity: addonBlocksCount * branchesPerBlock,
      currency: 'DOP',
      billingCycle: 'monthly',
      subtotalMinor: subtotalDopMinor,
      taxMinor: taxDopMinor,
      totalMinor: totalDopMinor,
      fxSnapshot,
    };
  }

  /**
   * Cotiza la contratación o ampliación del add-on Suscripciones y Membresías B2C
   * bajo la regla comercial: US$99/mes por bloque de capacidad de hasta 3 sucursales habilitadas.
   * Valida que cada sucursal seleccionada pertenezca al tenant y cuente con licencia principal activa.
   */
  async calculateProratedAddonBlocksQuote({ tenantId, branchIds = [], fxRate = null, effectiveAt = new Date() }) {
    if (!tenantId) throw new Error('tenantId es requerido para cotizar el add-on de Membresías');

    const cleanedIds = Array.isArray(branchIds)
      ? [...new Set(branchIds.map((id) => String(id).trim()).filter(Boolean))]
      : [];

    const [tenantRows] = await this.pool.query(
      `SELECT COALESCE(licensed_branches, max_branches, 1) AS licensed_branches FROM tenants WHERE id = ? LIMIT 1`,
      [tenantId]
    );
    const licensedBranches = Math.max(1, Number(tenantRows?.[0]?.licensed_branches || 1));

    const [branchRows] = await this.pool.query(
      `SELECT id::text AS id, name, COALESCE(is_active, true) AS is_active
       FROM branches
       WHERE tenant_id = ?
       ORDER BY is_main DESC, created_at ASC`,
      [tenantId]
    );
    const allBranches = branchRows || [];
    const branchMap = new Map(allBranches.map((b) => [String(b.id), b]));

    if (cleanedIds.length === 0) {
      const err = new Error('Debes seleccionar al menos una sucursal con licencia activa para habilitar Membresías.');
      err.code = 'BRANCH_SELECTION_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    for (const bId of cleanedIds) {
      const bObj = branchMap.get(bId);
      if (!bObj) {
        const err = new Error('Una o más sucursales seleccionadas no pertenecen a tu empresa.');
        err.code = 'INVALID_BRANCH_SELECTION';
        err.statusCode = 400;
        throw err;
      }
      if (!bObj.is_active) {
        const err = new Error(`La sucursal "${bObj.name}" no tiene una licencia principal activa.`);
        err.code = 'BRANCH_LICENSE_REQUIRED';
        err.statusCode = 400;
        throw err;
      }
    }

    if (cleanedIds.length > licensedBranches) {
      const err = new Error(`Seleccionaste ${cleanedIds.length} sucursales, pero tu plan principal solo tiene ${licensedBranches} licencia(s) de sucursal activa(s).`);
      err.code = 'BRANCH_LICENSE_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    // Consultar capacidad actual de bloques del add-on
    let periodStart = null;
    let periodEnd = null;
    let subAddonBlocks = 0;
    const [subRows] = await this.pool.query(
      `SELECT current_period_start, current_period_end, COALESCE(addon_blocks_count, 0) AS addon_blocks_count
       FROM tenant_subscriptions WHERE tenant_id = ? LIMIT 1`,
      [tenantId]
    ).catch(() => [[]]);
    if (subRows?.[0]) {
      if (subRows[0].current_period_start) periodStart = new Date(subRows[0].current_period_start);
      if (subRows[0].current_period_end) periodEnd = new Date(subRows[0].current_period_end);
      subAddonBlocks = Number(subRows[0].addon_blocks_count || 0);
    }

    const [ovRows] = await this.pool.query(
      `SELECT is_enabled, enabled_branch_ids, COALESCE(acquired_blocks, 0) AS acquired_blocks
       FROM tenant_feature_overrides
       WHERE tenant_id = ? AND feature_key = 'memberships' AND (expires_at IS NULL OR expires_at > NOW())
       LIMIT 1`,
      [tenantId]
    ).catch(() => [[]]);
    const ov = ovRows?.[0] || null;
    const currentlyActive = Boolean(ov?.is_enabled);
    const currentEnabledBranchIds = currentlyActive && Array.isArray(ov?.enabled_branch_ids)
      ? ov.enabled_branch_ids.map(String)
      : [];
    const currentAcquiredBlocks = currentlyActive
      ? Math.max(Number(ov?.acquired_blocks || 0), subAddonBlocks, Math.ceil(Math.max(1, currentEnabledBranchIds.length) / 3))
      : Math.max(Number(ov?.acquired_blocks || 0), subAddonBlocks);

    const branchesPerBlock = 3;
    const currentAcquiredCapacity = currentAcquiredBlocks * branchesPerBlock;
    const requiredBlocks = Math.ceil(cleanedIds.length / branchesPerBlock);
    const targetBranchCapacity = requiredBlocks * branchesPerBlock;
    const additionalBlocksToBuy = Math.max(0, requiredBlocks - currentAcquiredBlocks);
    const newAcquiredBlocks = Math.max(currentAcquiredBlocks, requiredBlocks);
    const newAcquiredCapacity = newAcquiredBlocks * branchesPerBlock;
    const availableCapacityAfter = Math.max(0, newAcquiredCapacity - cleanedIds.length);
    const requiresPayment = additionalBlocksToBuy > 0;

    const now = new Date(effectiveAt);
    if (!periodStart || !periodEnd || isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime()) || periodEnd <= periodStart) {
      periodStart = now;
      periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    }
    const totalDurationMs = BigInt(periodEnd.getTime() - periodStart.getTime());
    let remainingMs = BigInt(Math.max(0, periodEnd.getTime() - now.getTime()));
    if (remainingMs <= 0n || remainingMs > totalDurationMs) {
      remainingMs = totalDurationMs;
    }

    const pricing = getConfiguredPricing();
    const blockMonthlyUsd = Number(pricing?.addons?.memberships?.usd ?? 99);
    const blockMonthlyUsdMinor = BigInt(Math.round(blockMonthlyUsd * 100));
    const additionalMonthlyUsdMinor = blockMonthlyUsdMinor * BigInt(additionalBlocksToBuy);

    const proratedAddonUsdMinor = requiresPayment
      ? (totalDurationMs > 0n ? (additionalMonthlyUsdMinor * remainingMs + totalDurationMs - 1n) / totalDurationMs : additionalMonthlyUsdMinor)
      : 0n;

    let rateObj = fxRate;
    if (!rateObj && this.fxRateService) {
      if (typeof this.fxRateService.requireCurrentRate === 'function') {
        rateObj = await this.fxRateService.requireCurrentRate('USD_DOP').catch(() => null);
      } else if (typeof this.fxRateService.getEffectiveRate === 'function') {
        rateObj = await this.fxRateService.getEffectiveRate('USD_DOP').catch(() => null);
      }
    }
    if (!rateObj && requiresPayment) {
      const err = new Error('No hay una tasa de cambio USD → DOP válida configurada.');
      err.code = 'FX_RATE_NOT_CONFIGURED';
      err.statusCode = 409;
      throw err;
    }

    const rateVal = (typeof rateObj === 'object' && rateObj !== null)
      ? (rateObj.rateFormatted ?? rateObj.rate_numeric ?? rateObj.rate)
      : rateObj;
    const parsedRate = rateVal ? parseAndScaleRate(rateVal) : { rateNumber: 1, rateStr: '1.0000', rateScaledBigInt: 10000n };
    const totalDopMinor = convertUsdMinorToDopMinor(proratedAddonUsdMinor, parsedRate.rateScaledBigInt);
    const remainingDays = Math.ceil(Number(remainingMs) / (1000 * 60 * 60 * 24));
    const isProrated = remainingMs < totalDurationMs;

    const fxSnapshot = rateObj ? {
      pair: rateObj.pair || 'USD_DOP',
      rate: parsedRate.rateNumber,
      rate_formatted: parsedRate.rateStr,
      rate_scaled_10000: parsedRate.rateScaledBigInt.toString(),
      rate_id: rateObj.id ?? null,
      snapshot_at: new Date().toISOString(),
      usd: {
        currency: 'USD',
        addon_minor: proratedAddonUsdMinor.toString(),
        subtotal_minor: proratedAddonUsdMinor.toString(),
        tax_minor: '0',
        total_minor: proratedAddonUsdMinor.toString(),
      },
      dop: {
        currency: 'DOP',
        addon_minor: totalDopMinor.toString(),
        subtotal_minor: totalDopMinor.toString(),
        tax_minor: '0',
        total_minor: totalDopMinor.toString(),
      },
    } : null;

    return {
      addonCode: SAAS_ADDONS.MEMBERSHIPS,
      billingUnit: 'per_block_up_to_3_branches',
      branchesPerBlock,
      blockMonthlyUsd,
      licensedBranches,
      selectedBranchIds: cleanedIds,
      selectedBranches: cleanedIds.map((id) => ({ id, name: branchMap.get(id)?.name || id })),
      selectedBranchesCount: cleanedIds.length,
      currentAcquiredBlocks,
      currentAcquiredCapacity,
      currentUsedCapacity: currentEnabledBranchIds.length,
      currentAvailableCapacity: Math.max(0, currentAcquiredCapacity - currentEnabledBranchIds.length),
      requiredBlocks,
      targetBranchCapacity,
      additionalBlocksToBuy,
      newAcquiredBlocks,
      newAcquiredCapacity,
      newUsedCapacity: cleanedIds.length,
      newAvailableCapacity: availableCapacityAfter,
      requiresPayment,
      withinAcquiredCapacity: !requiresPayment,
      currentAddonMonthlyUsd: currentAcquiredBlocks * blockMonthlyUsd,
      newAddonMonthlyUsd: newAcquiredBlocks * blockMonthlyUsd,
      additionalMonthlyUsd: additionalBlocksToBuy * blockMonthlyUsd,
      remainingDays,
      isProrated,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      subtotalUsdMinor: proratedAddonUsdMinor.toString(),
      taxUsdMinor: '0',
      totalUsdMinor: proratedAddonUsdMinor.toString(),
      subtotalDopMinor: totalDopMinor.toString(),
      taxDopMinor: '0',
      totalDopMinor: totalDopMinor.toString(),
      setupFeeQuotedSeparately: true,
      fxSnapshot,
      fxRate: rateObj ? {
        pair: rateObj.pair || 'USD_DOP',
        rate: parsedRate.rateNumber,
        rateFormatted: parsedRate.rateStr,
      } : null,
    };
  }

  /**
   * Contrata o actualiza el alcance de sucursales del add-on Membresías por bloques de hasta 3 sucursales.
   * - Si las sucursales seleccionadas caben dentro de la capacidad ya adquirida (additionalBlocksToBuy === 0),
   *   actualiza la asignación de sucursales sin generar ningún cobro adicional.
   * - Si requiere bloques adicionales, crea la orden con snapshot y ejecuta el pago con tarjeta guardada o CardNet checkout.
   */
  async contractMembershipsAddonBlocks({
    tenantId,
    branchIds = [],
    paymentMethodChoice = 'saved_card',
    actorUserId = null,
    clientIp = null,
    returnBaseUrl = null,
  }) {
    const quote = await this.calculateProratedAddonBlocksQuote({ tenantId, branchIds });

    if (!quote.requiresPayment) {
      if (this.entitlementsService) {
        await this.entitlementsService.setAddonStatus(tenantId, SAAS_ADDONS.MEMBERSHIPS, {
          enabled: true,
          source: 'commercial_addon',
          reason: `Asignación de sucursales actualizada dentro de capacidad contratada (${quote.newUsedCapacity}/${quote.newAcquiredCapacity} sucursales, ${quote.newAcquiredBlocks} bloque(s))`,
          actorId: actorUserId || 'owner',
          branchIds: quote.selectedBranchIds,
          acquiredBlocks: quote.newAcquiredBlocks,
        });
      }
      return {
        success: true,
        activated: true,
        paid: false,
        charged: false,
        withinAcquiredCapacity: true,
        quote,
        message: `Sucursales habilitadas actualizadas (${quote.newUsedCapacity} de ${quote.newAcquiredCapacity} disponibles en tus ${quote.newAcquiredBlocks} bloque(s) contratado(s)) sin cargo adicional.`,
      };
    }

    const orderId = crypto.randomUUID();
    const orderNumber = generateOrderNumber();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const metadata = {
      type: 'addon_memberships_blocks',
      addon_code: SAAS_ADDONS.MEMBERSHIPS,
      selected_branch_ids: quote.selectedBranchIds,
      selected_branches: quote.selectedBranches,
      previous_acquired_blocks: quote.currentAcquiredBlocks,
      additional_blocks_to_buy: quote.additionalBlocksToBuy,
      new_acquired_blocks: quote.newAcquiredBlocks,
      new_acquired_capacity: quote.newAcquiredCapacity,
      block_monthly_usd: quote.blockMonthlyUsd,
      new_addon_monthly_usd: quote.newAddonMonthlyUsd,
      fx_snapshot: quote.fxSnapshot,
      proration: {
        remainingDays: quote.remainingDays,
        isProrated: quote.isProrated,
        periodStart: quote.periodStart,
        periodEnd: quote.periodEnd,
      },
    };

    const [rows] = await this.pool.query(
      `INSERT INTO saas_checkout_orders (
         id, tenant_id, order_number, status, currency, subtotal_minor, tax_minor, total_minor,
         plan_code, billing_cycle, branches_count, extra_users_count, memberships_addon_enabled,
         addon_branches_count, addon_blocks_count, addon_branch_ids,
         created_by_user_id, source, idempotency_key, expires_at, metadata
       )
       VALUES (?, ?, ?, ?, 'DOP', ?, 0, ?, ?, 'monthly', ?, 0, TRUE, ?, ?, ?::jsonb, ?, 'addon_memberships', ?, ?, ?::jsonb)
       RETURNING *`,
      [
        orderId,
        tenantId,
        orderNumber,
        ORDER_STATUS.PENDING_PAYMENT,
        quote.totalDopMinor,
        quote.totalDopMinor,
        SAAS_PLANS.PRINCIPAL,
        quote.licensedBranches,
        quote.selectedBranchesCount,
        quote.newAcquiredBlocks,
        JSON.stringify(quote.selectedBranchIds),
        actorUserId,
        `addon-mem-${orderId}`,
        expiresAt.toISOString(),
        JSON.stringify(metadata),
      ]
    );
    const order = sanitizeOrderForClient(rows[0]);

    if (paymentMethodChoice === 'saved_card') {
      const payResult = await this.payAddBranchWithSavedMethod({
        orderId: order.id,
        tenantId,
        actorUserId,
        clientIp,
      });
      return {
        success: true,
        activated: payResult.activated,
        paid: true,
        charged: true,
        withinAcquiredCapacity: false,
        quote,
        order: payResult.order,
        message: `Add-on de Membresías contratado y activado (${quote.newAcquiredBlocks} bloque(s), capacidad hasta ${quote.newAcquiredCapacity} sucursales).`,
      };
    }

    const checkoutResult = await this.initiateCardnetCheckout({
      orderId: order.id,
      tenantId,
      clientIp,
      returnBaseUrl,
    });

    return {
      success: true,
      needsCheckout: true,
      requiresCheckout: true,
      quote,
      order,
      checkout: checkoutResult.checkout || checkoutResult,
    };
  }

  /**
   * Cotiza asientos de usuarios adicionales (+US$30/mes por usuario adicional, prorrateado en el ciclo vigente).
   */
  async calculateProratedExtraSeatsQuote({ tenantId, additionalSeats = 1, fxRate = null, effectiveAt = new Date() }) {
    if (!tenantId) throw new Error('tenantId es requerido');
    const addedSeats = Math.max(1, Math.min(100, parseInt(additionalSeats, 10) || 1));

    const [tenantRows] = await this.pool.query(
      `SELECT COALESCE(licensed_branches, max_branches, 1) AS licensed_branches,
              COALESCE(extra_user_seats, 0) AS extra_user_seats
       FROM tenants WHERE id = ? LIMIT 1`,
      [tenantId]
    );
    const licensedBranches = Math.max(1, Number(tenantRows?.[0]?.licensed_branches || 1));
    const currentExtraSeats = Math.max(0, Number(tenantRows?.[0]?.extra_user_seats || 0));
    const currentMaxUsers = (licensedBranches * 3) + currentExtraSeats;
    const newExtraSeats = currentExtraSeats + addedSeats;
    const newMaxUsers = (licensedBranches * 3) + newExtraSeats;

    let periodStart = null;
    let periodEnd = null;
    const [subRows] = await this.pool.query(
      `SELECT current_period_start, current_period_end FROM tenant_subscriptions WHERE tenant_id = ? LIMIT 1`,
      [tenantId]
    ).catch(() => [[]]);
    if (subRows?.[0]?.current_period_start) periodStart = new Date(subRows[0].current_period_start);
    if (subRows?.[0]?.current_period_end) periodEnd = new Date(subRows[0].current_period_end);

    const now = new Date(effectiveAt);
    if (!periodStart || !periodEnd || isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime()) || periodEnd <= periodStart) {
      periodStart = now;
      periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    }
    const totalDurationMs = BigInt(periodEnd.getTime() - periodStart.getTime());
    let remainingMs = BigInt(Math.max(0, periodEnd.getTime() - now.getTime()));
    if (remainingMs <= 0n || remainingMs > totalDurationMs) remainingMs = totalDurationMs;

    const pricing = getConfiguredPricing();
    const seatMonthlyUsd = Number(pricing?.principal?.extraUserUsd ?? 30);
    const addedMonthlyUsdMinor = BigInt(Math.round(seatMonthlyUsd * 100)) * BigInt(addedSeats);
    const proratedSeatsUsdMinor = totalDurationMs > 0n
      ? (addedMonthlyUsdMinor * remainingMs + totalDurationMs - 1n) / totalDurationMs
      : addedMonthlyUsdMinor;

    let rateObj = fxRate;
    if (!rateObj && this.fxRateService) {
      rateObj = await this.fxRateService.requireCurrentRate('USD_DOP');
    }
    if (!rateObj) {
      const err = new Error('No hay una tasa de cambio USD → DOP válida configurada.');
      err.code = 'FX_RATE_NOT_CONFIGURED';
      err.statusCode = 409;
      throw err;
    }
    const rateVal = typeof rateObj === 'object' ? (rateObj.rateFormatted ?? rateObj.rate_numeric ?? rateObj.rate) : rateObj;
    const parsedRate = parseAndScaleRate(rateVal);
    const totalDopMinor = convertUsdMinorToDopMinor(proratedSeatsUsdMinor, parsedRate.rateScaledBigInt);
    const remainingDays = Math.ceil(Number(remainingMs) / (1000 * 60 * 60 * 24));
    const isProrated = remainingMs < totalDurationMs;

    const fxSnapshot = {
      pair: rateObj.pair || 'USD_DOP',
      rate: parsedRate.rateNumber,
      rate_formatted: parsedRate.rateStr,
      rate_scaled_10000: parsedRate.rateScaledBigInt.toString(),
      rate_id: rateObj.id ?? null,
      snapshot_at: new Date().toISOString(),
      usd: {
        currency: 'USD',
        extra_users_minor: proratedSeatsUsdMinor.toString(),
        subtotal_minor: proratedSeatsUsdMinor.toString(),
        tax_minor: '0',
        total_minor: proratedSeatsUsdMinor.toString(),
      },
      dop: {
        currency: 'DOP',
        extra_users_minor: totalDopMinor.toString(),
        subtotal_minor: totalDopMinor.toString(),
        tax_minor: '0',
        total_minor: totalDopMinor.toString(),
      },
    };

    return {
      licensedBranches,
      currentExtraSeats,
      additionalSeats: addedSeats,
      newExtraSeats,
      currentMaxUsers,
      newMaxUsers,
      seatMonthlyUsd,
      additionalMonthlyUsd: addedSeats * seatMonthlyUsd,
      remainingDays,
      isProrated,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      subtotalUsdMinor: proratedSeatsUsdMinor.toString(),
      taxUsdMinor: '0',
      totalUsdMinor: proratedSeatsUsdMinor.toString(),
      subtotalDopMinor: totalDopMinor.toString(),
      taxDopMinor: '0',
      totalDopMinor: totalDopMinor.toString(),
      fxSnapshot,
      fxRate: {
        pair: rateObj.pair || 'USD_DOP',
        rate: parsedRate.rateNumber,
        rateFormatted: parsedRate.rateStr,
      },
    };
  }

  async contractExtraSeats({
    tenantId,
    additionalSeats = 1,
    paymentMethodChoice = 'saved_card',
    actorUserId = null,
    clientIp = null,
    returnBaseUrl = null,
  }) {
    const quote = await this.calculateProratedExtraSeatsQuote({ tenantId, additionalSeats });
    const orderId = crypto.randomUUID();
    const orderNumber = generateOrderNumber();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const metadata = {
      type: 'extra_user_seats',
      additional_seats: quote.additionalSeats,
      previous_extra_seats: quote.currentExtraSeats,
      new_extra_seats: quote.newExtraSeats,
      new_max_users: quote.newMaxUsers,
      seat_monthly_usd: quote.seatMonthlyUsd,
      fx_snapshot: quote.fxSnapshot,
      proration: {
        remainingDays: quote.remainingDays,
        isProrated: quote.isProrated,
        periodStart: quote.periodStart,
        periodEnd: quote.periodEnd,
      },
    };

    const [rows] = await this.pool.query(
      `INSERT INTO saas_checkout_orders (
         id, tenant_id, order_number, status, currency, subtotal_minor, tax_minor, total_minor,
         plan_code, billing_cycle, branches_count, extra_users_count, memberships_addon_enabled,
         created_by_user_id, source, idempotency_key, expires_at, metadata
       )
       VALUES (?, ?, ?, ?, 'DOP', ?, 0, ?, ?, 'monthly', ?, ?, FALSE, ?, 'extra_seats', ?, ?, ?::jsonb)
       RETURNING *`,
      [
        orderId,
        tenantId,
        orderNumber,
        ORDER_STATUS.PENDING_PAYMENT,
        quote.totalDopMinor,
        quote.totalDopMinor,
        SAAS_PLANS.PRINCIPAL,
        quote.licensedBranches,
        quote.additionalSeats,
        actorUserId,
        `extra-seats-${orderId}`,
        expiresAt.toISOString(),
        JSON.stringify(metadata),
      ]
    );
    const order = sanitizeOrderForClient(rows[0]);

    if (paymentMethodChoice === 'saved_card') {
      const payResult = await this.payAddBranchWithSavedMethod({
        orderId: order.id,
        tenantId,
        actorUserId,
        clientIp,
      });
      return {
        success: true,
        activated: payResult.activated,
        paid: true,
        charged: true,
        quote,
        order: payResult.order,
        message: `+${quote.additionalSeats} usuario(s) adicional(es) contratado(s) exitosamente (capacidad total: ${quote.newMaxUsers} usuarios).`,
      };
    }

    const checkoutResult = await this.initiateCardnetCheckout({
      orderId: order.id,
      tenantId,
      clientIp,
      returnBaseUrl,
    });

    return {
      success: true,
      needsCheckout: true,
      requiresCheckout: true,
      quote,
      order,
      checkout: checkoutResult.checkout || checkoutResult,
    };
  }

  /**
   * Cotiza de forma canónica y en backend la contratación de una sucursal adicional,
   * aplicando la política matemática de prorrateo existente (ProrationEngine) y FX rate.
   */
  async calculateProratedBranchOrderAmounts({ tenantId, wantsMembershipsAddon = false, fxRate = null, effectiveAt = new Date() }) {
    if (!tenantId) throw new Error('tenantId es requerido para cotizar sucursal adicional');

    let periodStart = null;
    let periodEnd = null;
    let currentBranches = 1;
    let licensedBranches = 1;

    try {
      const [subRows] = await this.pool.query(
        `SELECT current_period_start, current_period_end FROM tenant_subscriptions WHERE tenant_id = ? LIMIT 1`,
        [tenantId]
      );
      if (subRows[0]?.current_period_start) periodStart = new Date(subRows[0].current_period_start);
      if (subRows[0]?.current_period_end) periodEnd = new Date(subRows[0].current_period_end);

      const [tenantRows] = await this.pool.query(
        `SELECT COALESCE(licensed_branches, max_branches, 3) as licensed_branches FROM tenants WHERE id = ? LIMIT 1`,
        [tenantId]
      );
      if (tenantRows[0]) {
        const rawLic = Math.max(1, Number(tenantRows[0].licensed_branches || 1));
        licensedBranches = Math.max(rawLic, Math.ceil(rawLic / 3) * 3);
      }

      const [branchCountRows] = await this.pool.query(
        `SELECT COUNT(*)::int as total FROM branches WHERE tenant_id = ? AND is_active = true`,
        [tenantId]
      );
      if (branchCountRows[0]) currentBranches = Number(branchCountRows[0].total ?? branchCountRows[0].count ?? 1);
    } catch (_) { }

    const availableLicenses = Math.max(0, licensedBranches - currentBranches);
    const canCreateWithoutPayment = availableLicenses > 0;

    const now = new Date(effectiveAt);
    if (!periodStart || !periodEnd || isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime()) || periodEnd <= periodStart) {
      periodStart = now;
      periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    }

    const totalDurationMs = BigInt(periodEnd.getTime() - periodStart.getTime());
    let remainingMs = BigInt(Math.max(0, periodEnd.getTime() - now.getTime()));
    if (remainingMs <= 0n || remainingMs > totalDurationMs) {
      remainingMs = totalDurationMs;
    }

    const pricing = getConfiguredPricing();
    const branchMonthlyUsd = Number(pricing?.principal?.usd ?? 99);
    const addonMonthlyUsd = Number(pricing?.addons?.memberships?.usd ?? 99);

    const branchMonthlyUsdMinor = BigInt(Math.round(branchMonthlyUsd * 100));
    const addonMonthlyUsdMinor = BigInt(Math.round(addonMonthlyUsd * 100));

    // Prorrateo determinista entero ceil (según ProrationEngine canónico)
    const proratedBranchUsdMinor = canCreateWithoutPayment
      ? 0n
      : (totalDurationMs > 0n ? (branchMonthlyUsdMinor * remainingMs + totalDurationMs - 1n) / totalDurationMs : branchMonthlyUsdMinor);

    const proratedAddonUsdMinor = (!canCreateWithoutPayment && wantsMembershipsAddon)
      ? (totalDurationMs > 0n ? (addonMonthlyUsdMinor * remainingMs + totalDurationMs - 1n) / totalDurationMs : addonMonthlyUsdMinor)
      : 0n;

    const subtotalUsdMinor = proratedBranchUsdMinor + proratedAddonUsdMinor;
    const taxUsdMinor = 0n;
    const totalUsdMinor = subtotalUsdMinor + taxUsdMinor;

    let rateObj = fxRate;
    if (!rateObj && this.fxRateService) {
      if (typeof this.fxRateService.requireCurrentRate === 'function') {
        rateObj = await this.fxRateService.requireCurrentRate('USD_DOP');
      } else if (typeof this.fxRateService.getEffectiveRate === 'function') {
        rateObj = await this.fxRateService.getEffectiveRate('USD_DOP');
      }
    }
    if (!rateObj && !canCreateWithoutPayment) {
      const err = new Error('No hay una tasa de cambio USD → DOP válida configurada. El administrador debe configurarla antes de generar cobros.');
      err.code = 'FX_RATE_NOT_CONFIGURED';
      err.statusCode = 409;
      throw err;
    }

    const rateVal = (typeof rateObj === 'object' && rateObj !== null)
      ? (rateObj.rateFormatted ?? rateObj.rate_numeric ?? rateObj.rate)
      : rateObj;
    const parsedRate = rateVal ? parseAndScaleRate(rateVal) : { rateNumber: 1, rateStr: '1.0000', rateScaledBigInt: 10000n };
    const branchDopMinor = convertUsdMinorToDopMinor(proratedBranchUsdMinor, parsedRate.rateScaledBigInt);
    const addonDopMinor = convertUsdMinorToDopMinor(proratedAddonUsdMinor, parsedRate.rateScaledBigInt);
    const subtotalDopMinor = branchDopMinor + addonDopMinor;
    const taxDopMinor = 0n;
    const totalDopMinor = subtotalDopMinor + taxDopMinor;

    const remainingDays = Math.ceil(Number(remainingMs) / (1000 * 60 * 60 * 24));
    const isProrated = remainingMs < totalDurationMs;
    const nextMembershipsCount = Math.max(1, Math.ceil((currentBranches + 1) / 3));
    const nextMonthlyUsd = nextMembershipsCount * branchMonthlyUsd + (wantsMembershipsAddon ? addonMonthlyUsd : 0);

    const fxSnapshot = rateObj ? {
      pair: rateObj.pair || 'USD_DOP',
      rate: parsedRate.rateNumber,
      rate_formatted: parsedRate.rateStr,
      rate_scaled_10000: parsedRate.rateScaledBigInt.toString(),
      rate_id: rateObj.id ?? null,
      rate_updated_at: rateObj.updatedAt ?? rateObj.updated_at ?? null,
      snapshot_at: new Date().toISOString(),
      usd: {
        currency: 'USD',
        branches_minor: proratedBranchUsdMinor.toString(),
        addon_minor: proratedAddonUsdMinor.toString(),
        subtotal_minor: subtotalUsdMinor.toString(),
        tax_minor: '0',
        total_minor: totalUsdMinor.toString(),
      },
      dop: {
        currency: 'DOP',
        branches_minor: branchDopMinor.toString(),
        addon_minor: addonDopMinor.toString(),
        subtotal_minor: subtotalDopMinor.toString(),
        tax_minor: '0',
        total_minor: totalDopMinor.toString(),
      },
    } : null;

    return {
      currentBranches,
      newBranchesCount: currentBranches + 1,
      licensedBranches,
      availableLicenses,
      canCreateWithoutPayment,
      usersIncludedPerBranch: 3,
      branchMonthlyUsd,
      wantsMembershipsAddon: Boolean(wantsMembershipsAddon),
      addonMonthlyUsd,
      remainingDays,
      isProrated,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      proratedBranchUsdMinor: proratedBranchUsdMinor.toString(),
      proratedAddonUsdMinor: proratedAddonUsdMinor.toString(),
      subtotalUsdMinor: subtotalUsdMinor.toString(),
      taxUsdMinor: taxUsdMinor.toString(),
      totalUsdMinor: totalUsdMinor.toString(),
      branchDopMinor: branchDopMinor.toString(),
      addonDopMinor: addonDopMinor.toString(),
      subtotalDopMinor: subtotalDopMinor.toString(),
      taxDopMinor: taxDopMinor.toString(),
      totalDopMinor: totalDopMinor.toString(),
      nextMonthlyUsd,
      fxSnapshot,
      fxRate: rateObj ? {
        pair: rateObj.pair || 'USD_DOP',
        rate: parsedRate.rateNumber,
        rateFormatted: parsedRate.rateStr,
      } : null,
    };
  }

  /**
   * Crea orden de checkout para una nueva sucursal y la registra como pendiente en branches.
   */
  async createAddBranchOrder({ tenantId, branchData, wantsMembershipsAddon = false, actorUserId = null, clientIp = null }) {
    if (!tenantId) throw new Error('Contexto de empresa requerido.');
    if (!branchData || !branchData.name || !String(branchData.name).trim()) {
      const err = new Error('El nombre de la sucursal es obligatorio.');
      err.code = 'BRANCH_NAME_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    const calc = await this.calculateProratedBranchOrderAmounts({ tenantId, wantsMembershipsAddon });
    if (calc.canCreateWithoutPayment) {
      return { canCreateWithoutPayment: true, quote: calc };
    }

    // Reusar orden pendiente reciente (evitar duplicados por doble clic)
    const [existingPending] = await this.pool.query(
      `SELECT * FROM saas_checkout_orders
       WHERE tenant_id = ? AND source = 'branch_addon' AND status = 'pending_payment' AND expires_at > NOW()
         AND (metadata->'branch_data'->>'name') = ?
       ORDER BY created_at DESC LIMIT 1`,
      [tenantId, branchData.name.trim()]
    );
    if (existingPending.length > 0) {
      const existing = existingPending[0];
      const meta = existing.metadata || {};
      return {
        canCreateWithoutPayment: false,
        branchId: meta.branch_id,
        order: sanitizeOrderForClient(existing),
        quote: calc,
      };
    }

    const branchId = crypto.randomUUID();
    const orderNumber = generateOrderNumber();
    const orderId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    // La sucursal NO se inserta en branches/salons hasta que el pago sea aprobado en _activateAfterPayment
    // 1. Guardar orden con snapshot exacto de la sucursal a crear tras aprobar el cobro
    const metadata = {
      type: 'add_branch',
      branch_id: branchId,
      branch_data: {
        name: branchData.name.trim(),
        address: branchData.address || '',
        phone: branchData.phone || '',
        maps_url: branchData.maps_url || '',
      },
      wants_memberships_addon: Boolean(wantsMembershipsAddon),
      fx_snapshot: calc.fxSnapshot,
      proration: {
        remainingDays: calc.remainingDays,
        isProrated: calc.isProrated,
        periodStart: calc.periodStart,
        periodEnd: calc.periodEnd,
      },
      pricing: {
        branchMonthlyUsd: calc.branchMonthlyUsd,
        addonMonthlyUsd: calc.addonMonthlyUsd,
        nextMonthlyUsd: calc.nextMonthlyUsd,
      },
    };

    const [rows] = await this.pool.query(
      `INSERT INTO saas_checkout_orders (
         id, tenant_id, order_number, status, currency, subtotal_minor, tax_minor, total_minor,
         plan_code, billing_cycle, branches_count, extra_users_count, memberships_addon_enabled,
         created_by_user_id, source, idempotency_key, expires_at, metadata
       )
       VALUES (?, ?, ?, ?, 'DOP', ?, 0, ?, ?, 'monthly', 1, 0, ?, ?, 'branch_addon', ?, ?, ?::jsonb)
       RETURNING *`,
      [
        orderId,
        tenantId,
        orderNumber,
        ORDER_STATUS.PENDING_PAYMENT,
        calc.totalDopMinor,
        calc.totalDopMinor,
        SAAS_PLANS.PRINCIPAL,
        Boolean(wantsMembershipsAddon),
        actorUserId,
        `branch-addon-${orderId}`,
        expiresAt.toISOString(),
        JSON.stringify(metadata),
      ]
    );

    const orderRecord = rows[0] || {
      id: orderId,
      order_number: orderNumber,
      tenant_id: tenantId,
      status: ORDER_STATUS.PENDING_PAYMENT,
      currency: 'DOP',
      subtotal_minor: calc.totalDopMinor,
      total_minor: calc.totalDopMinor,
      plan_code: SAAS_PLANS.PRINCIPAL,
      billing_cycle: 'monthly',
      branches_count: 1,
      extra_users_count: 0,
      memberships_addon_enabled: Boolean(wantsMembershipsAddon),
      created_by_user_id: actorUserId,
      source: 'branch_addon',
      expires_at: expiresAt.toISOString(),
      metadata,
    };

    return {
      canCreateWithoutPayment: false,
      branchId,
      order: sanitizeOrderForClient(orderRecord),
      quote: calc,
    };
  }

  /**
   * Ejecuta el cobro directo de una orden de sucursal con el método de pago guardado autorizado.
   */
  async payAddBranchWithSavedMethod({ orderId, tenantId, actorUserId = null, clientIp = null }) {
    const [rows] = await this.pool.query(
      `SELECT * FROM saas_checkout_orders WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [orderId, tenantId]
    );
    if (!rows.length) {
      const err = new Error('Orden de contratación no encontrada.');
      err.code = 'ORDER_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }
    const order = rows[0];

    // Idempotencia: si ya está aprobada y activada, no volver a cobrar
    if (order.status === ORDER_STATUS.APPROVED && order.activated_at) {
      return { order: sanitizeOrderForClient(order), activated: true, alreadyProcessed: true };
    }

    if (!this.billingRepo || typeof this.billingRepo.getDefaultPaymentMethod !== 'function') {
      const err = new Error('No hay método de pago configurado.');
      err.code = 'NO_PAYMENT_METHOD';
      err.statusCode = 400;
      throw err;
    }

    const defaultPm = await this.billingRepo.getDefaultPaymentMethod(tenantId);
    if (!defaultPm || !defaultPm.token_reference) {
      const err = new Error('No se encontró una tarjeta guardada reutilizable autorizada.');
      err.code = 'NO_SAVED_CARD';
      err.statusCode = 400;
      throw err;
    }

    if (!this.tokenizationProvider || typeof this.tokenizationProvider.purchaseWithToken !== 'function') {
      const err = new Error('Proveedor de tokenización CardNet no disponible.');
      err.code = 'PROVIDER_UNAVAILABLE';
      err.statusCode = 502;
      throw err;
    }

    const meta = typeof order.metadata === 'object' && order.metadata ? order.metadata : {};
    const branchName = meta.branch_data?.name || 'Sucursal adicional';

    const purchase = await this.tokenizationProvider.purchaseWithToken({
      trxToken: defaultPm.token_reference,
      orderNumber: order.order_number,
      totalMinor: order.total_minor,
      currency: 'DOP',
      description: `Pago sucursal adicional: ${branchName} (#${order.order_number})`,
      clientIp,
    });

    const purchaseMessage = purchase.responseMessage || purchase.message || null;
    const purchaseReference = purchase.reference || purchase.retrievalReferenceNumber || purchase.transactionId || null;

    const isApproved = Boolean(purchase.approved || purchase.outcome === 'approved' || purchase.status === 'approved');
    if (isApproved) {
      const maskedCard = defaultPm.brand && defaultPm.last4
        ? `${defaultPm.brand} ****${defaultPm.last4}`
        : (purchase.maskedCard || null);

      await this.pool.query(
        `UPDATE saas_checkout_orders
         SET status = ?, paid_at = COALESCE(paid_at, NOW()),
             cardnet_authorization_code = ?, cardnet_reference = ?,
             cardnet_response_code = ?, cardnet_response_message = ?,
             masked_card = COALESCE(?, masked_card),
             last_error = NULL, updated_at = NOW()
         WHERE id = ? AND tenant_id = ?`,
        [
          ORDER_STATUS.APPROVED,
          purchase.authorizationCode,
          purchaseReference,
          purchase.responseCode,
          purchaseMessage,
          maskedCard,
          order.id,
          tenantId,
        ]
      );

      const [paidRows] = await this.pool.query('SELECT * FROM saas_checkout_orders WHERE id = ? LIMIT 1', [order.id]);
      return this._activateAfterPayment(paidRows[0], actorUserId);
    }

    const isDeclined = purchase.outcome === 'declined' || purchase.status === 'declined' || (!isApproved && !purchase.pending);
    if (isDeclined) {
      await this.pool.query(
        `UPDATE saas_checkout_orders
         SET status = ?, last_error = ?, cardnet_response_code = ?,
             cardnet_response_message = ?, cardnet_reference = COALESCE(?, cardnet_reference),
             updated_at = NOW()
         WHERE id = ? AND tenant_id = ?`,
        [ORDER_STATUS.DECLINED, purchaseMessage, purchase.responseCode, purchaseMessage, purchaseReference, order.id, tenantId]
      );
      const err = new Error(purchaseMessage || 'Tarjeta declinada por la entidad emisora.');
      err.code = 'PAYMENT_DECLINED';
      err.responseCode = purchase.responseCode;
      err.statusCode = 402;
      throw err;
    }

    // unknown_timeout
    await this.pool.query(
      `UPDATE saas_checkout_orders
       SET status = ?, last_error = ?, cardnet_response_code = ?, updated_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      [ORDER_STATUS.UNKNOWN_TIMEOUT, purchaseMessage, purchase.responseCode, order.id, tenantId]
    );
    const err = new Error(purchaseMessage || 'Respuesta incierta de CardNet. Se requiere conciliación.');
    err.code = 'PAYMENT_UNKNOWN_TIMEOUT';
    err.statusCode = 504;
    throw err;
  }

  async createOrder({
    tenantId,
    actorUserId = null,
    source = 'self_service',
    invoiceId = null,
    branchesCount = 1,
    extraUsersCount = 0,
    wantsMembershipsAddon = false,
    addonBranchesCount = 0,
    idempotencyKey = null,
    metadata = {},
    dbConn = null,
  }) {
    if (!tenantId) {
      const err = new Error('Tenant requerido');
      err.code = 'TENANT_REQUIRED';
      err.statusCode = 403;
      throw err;
    }

    const queryRunner = dbConn || this.pool;
    const effectiveIdempotencyKey =
      String(idempotencyKey || '').trim() || `chk_${tenantId}_${crypto.randomUUID()}`;

    // Idempotencia por clave
    const [existingRows] = await queryRunner.query(
      'SELECT * FROM saas_checkout_orders WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1',
      [tenantId, effectiveIdempotencyKey]
    );
    if (existingRows.length > 0) {
      return sanitizeOrderForClient(existingRows[0]);
    }

    let calc;
    if (source === 'debt_payment' && invoiceId) {
      const invoice = this.billingRepo ? await this.billingRepo.getInvoiceById(invoiceId) : null;
      if (!invoice || String(invoice.tenant_id) !== String(tenantId)) {
        const err = new Error('Factura no encontrada para esta empresa.');
        err.code = 'INVOICE_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }
      const dueMinor = BigInt(invoice.amount_due_minor || invoice.total_minor || 0);
      if (dueMinor <= 0n || invoice.status === 'paid') {
        const err = new Error('Esta factura ya se encuentra pagada.');
        err.code = 'INVOICE_ALREADY_PAID';
        err.statusCode = 409;
        throw err;
      }
      // Reusar orden pendiente activa para esta factura si existe
      const [pendingForInvoice] = await this.pool.query(
        `SELECT * FROM saas_checkout_orders
         WHERE tenant_id = ? AND invoice_id = ? AND status IN ('pending_payment', 'processing') AND expires_at > NOW()
         ORDER BY created_at DESC LIMIT 1`,
        [tenantId, invoiceId]
      );
      if (pendingForInvoice.length > 0) {
        return sanitizeOrderForClient(pendingForInvoice[0]);
      }

      const invoiceCurrency = String(invoice.currency || 'USD').toUpperCase();
      if (invoiceCurrency === 'USD') {
        if (!this.fxRateService) {
          const err = new Error('No hay una tasa de cambio USD → DOP configurada.');
          err.code = 'FX_RATE_NOT_CONFIGURED';
          err.statusCode = 409;
          throw err;
        }
        const fxRate = await this.fxRateService.requireCurrentRate('USD_DOP');
        const parsedRate = parseAndScaleRate(fxRate.rateFormatted ?? fxRate.rate);
        const dopDueMinor = convertUsdMinorToDopMinor(dueMinor, parsedRate.rateScaledBigInt);
        calc = {
          planCode: SAAS_PLANS.PRINCIPAL,
          branchesCount: 1,
          extraUsersCount: 0,
          wantsMembershipsAddon: false,
          addonBranchesCount: 0,
          currency: 'DOP',
          billingCycle: 'monthly',
          subtotalMinor: dopDueMinor,
          taxMinor: 0n,
          totalMinor: dopDueMinor,
          fxSnapshot: {
            pair: fxRate.pair || 'USD_DOP',
            rate: parsedRate.rateNumber,
            rate_formatted: parsedRate.rateStr,
            rate_scaled_10000: parsedRate.rateScaledBigInt.toString(),
            rate_id: fxRate.id ?? null,
            rate_updated_at: fxRate.updatedAt ?? fxRate.updated_at ?? null,
            snapshot_at: new Date().toISOString(),
            usd: {
              currency: 'USD',
              subtotal_minor: dueMinor.toString(),
              tax_minor: '0',
              total_minor: dueMinor.toString(),
            },
            dop: {
              currency: 'DOP',
              subtotal_minor: dopDueMinor.toString(),
              tax_minor: '0',
              total_minor: dopDueMinor.toString(),
            },
          },
        };
      } else {
        calc = {
          planCode: SAAS_PLANS.PRINCIPAL,
          branchesCount: 1,
          extraUsersCount: 0,
          wantsMembershipsAddon: false,
          addonBranchesCount: 0,
          currency: invoiceCurrency,
          billingCycle: 'monthly',
          subtotalMinor: dueMinor,
          taxMinor: 0n,
          totalMinor: dueMinor,
          fxSnapshot: null,
        };
      }
    } else {
      if (!this.fxRateService) {
        const err = new Error(
          'No hay una tasa de cambio USD → DOP válida configurada. El administrador debe configurarla antes de generar cobros.'
        );
        err.code = 'FX_RATE_NOT_CONFIGURED';
        err.statusCode = 409;
        throw err;
      }
      const fxRate = await this.fxRateService.requireCurrentRate('USD_DOP');
      calc = this.calculateCanonicalAmounts({
        branchesCount,
        extraUsersCount,
        wantsMembershipsAddon,
        addonBranchesCount,
        fxRate,
      });
    }

    const orderId = crypto.randomUUID();
    const orderNumber = generateOrderNumber();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // Ventana oficial de 30 minutos de sesión CardNet
    const paymentLinkToken =
      source === 'superadmin_payment_link' ? crypto.randomBytes(24).toString('hex') : null;
    const sanitizedMetadata = { ...(metadata || {}) };
    delete sanitizedMetadata.fx_snapshot;
    delete sanitizedMetadata.fxRate;
    delete sanitizedMetadata.rate;
    delete sanitizedMetadata.total_minor;
    delete sanitizedMetadata.totalMinor;
    delete sanitizedMetadata.currency;
    if (calc.fxSnapshot) {
      sanitizedMetadata.fx_snapshot = calc.fxSnapshot;
    }

    await queryRunner.query(
      `INSERT INTO saas_checkout_orders (
        id, order_number, tenant_id, invoice_id, created_by_user_id, source, payment_link_token,
        plan_code, branches_count, extra_users_count, memberships_addon_enabled, addon_branches_count,
        currency, subtotal_minor, tax_minor, total_minor, billing_cycle, status, gateway_provider,
        auto_renew_enabled, idempotency_key, expires_at, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'cardnet_hosted', FALSE, ?, ?, ?, NOW(), NOW())`,
      [
        orderId,
        orderNumber,
        tenantId,
        invoiceId || null,
        actorUserId || null,
        source,
        paymentLinkToken,
        calc.planCode,
        calc.branchesCount,
        calc.extraUsersCount,
        calc.wantsMembershipsAddon,
        calc.addonBranchesCount,
        calc.currency,
        String(calc.subtotalMinor),
        String(calc.taxMinor),
        String(calc.totalMinor),
        calc.billingCycle,
        ORDER_STATUS.PENDING_PAYMENT,
        effectiveIdempotencyKey,
        expiresAt,
        JSON.stringify(sanitizedMetadata),
      ]
    );

    const [createdRows] = await queryRunner.query('SELECT * FROM saas_checkout_orders WHERE id = ? LIMIT 1', [orderId]);
    return sanitizeOrderForClient(createdRows[0]);
  }

  async createSuperAdminPaymentLink({
    tenantId,
    actorUserId,
    branchesCount = 1,
    extraUsersCount = 0,
    wantsMembershipsAddon = false,
    addonBranchesCount = 0,
    note = '',
  }) {
    const order = await this.createOrder({
      tenantId,
      actorUserId,
      source: 'superadmin_payment_link',
      branchesCount,
      extraUsersCount,
      wantsMembershipsAddon,
      addonBranchesCount,
      metadata: {
        createdByRole: 'superadmin',
        note: String(note || '').slice(0, 300),
      },
    });

    // Registrar en auditoría de suscripciones sin activar el plan ni marcar pagado
    try {
      await this.pool.query(
        `INSERT INTO tenant_subscription_events (
          tenant_id, previous_plan, new_plan, previous_status, new_status, reason, actor_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          tenantId,
          SAAS_PLANS.PRINCIPAL,
          SAAS_PLANS.PRINCIPAL,
          'pending_payment',
          'pending_payment',
          `Enlace de pago SaaS generado por SuperAdmin (Orden ${order.order_number})${note ? `: ${String(note).slice(0, 150)}` : ''}`,
          actorUserId || 'superadmin',
        ]
      );
    } catch (_) {
      // No bloquear generación de enlace si la tabla de eventos no existe en un entorno de prueba
    }

    return {
      order,
      paymentPath: `/pago-saas/${order.payment_link_token}`,
    };
  }

  async listOrdersForTenant(tenantId) {
    const [rows] = await this.pool.query(
      'SELECT * FROM saas_checkout_orders WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 25',
      [tenantId]
    );
    return rows.map(sanitizeOrderForClient);
  }

  async getOrderForTenant(orderId, tenantId) {
    const [rows] = await this.pool.query(
      'SELECT * FROM saas_checkout_orders WHERE id = ? AND tenant_id = ? LIMIT 1',
      [orderId, tenantId]
    );
    return rows.length > 0 ? sanitizeOrderForClient(rows[0]) : null;
  }

  async getOrderByTokenForTenant(token, tenantId) {
    const [rows] = await this.pool.query(
      'SELECT * FROM saas_checkout_orders WHERE payment_link_token = ? AND tenant_id = ? LIMIT 1',
      [token, tenantId]
    );
    return rows.length > 0 ? sanitizeOrderForClient(rows[0]) : null;
  }

  async initiateCardnetCheckout({ orderId, tenantId, clientIp = null, returnBaseUrl = null, actorEmail = null }) {
    const [rows] = await this.pool.query(
      'SELECT * FROM saas_checkout_orders WHERE id = ? AND tenant_id = ? LIMIT 1',
      [orderId, tenantId]
    );
    if (rows.length === 0) {
      const err = new Error('Orden de pago no encontrada.');
      err.code = 'ORDER_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const order = rows[0];
    if (order.status === ORDER_STATUS.APPROVED) {
      const err = new Error('Esta orden ya fue pagada y aprobada.');
      err.code = 'ORDER_ALREADY_PAID';
      err.statusCode = 409;
      throw err;
    }

    if ([ORDER_STATUS.CANCELLED, ORDER_STATUS.DECLINED, ORDER_STATUS.EXPIRED].includes(order.status)) {
      const err = new Error('Esta orden no admite nuevos intentos; genera o retoma una nueva orden pendiente.');
      err.code = 'ORDER_NOT_PAYABLE';
      err.statusCode = 409;
      throw err;
    }

    // Modo 1: CardNet Tokenización / PWCheckout (servicios/tokens/v1)
    if (this._shouldUseTokenization()) {
      // Reutilizar sesión PWCheckout vigente si el cliente cerró y reabrió el checkout
      if (
        order.status === ORDER_STATUS.PROCESSING &&
        order.cardnet_session_id &&
        order.cardnet_session_key &&
        new Date(order.expires_at).getTime() > Date.now()
      ) {
        this.tokenizationProvider.assertReadyForCheckout();
        return {
          order: sanitizeOrderForClient(order),
          checkout: {
            mode: 'pwcheckout_iframe',
            uniqueId: order.cardnet_session_id,
            customerId: order.cardnet_session_key,
            captureUrl: `${this.tokenizationProvider.baseUrl}/Capture`,
            publicKey: this.tokenizationProvider.publicKey,
            reusedSession: true,
          },
        };
      }

      let customerEmail = actorEmail ? String(actorEmail).trim() : '';
      if (!customerEmail) {
        const [uRows] = await this.pool.query(
          "SELECT email FROM users WHERE tenant_id = ? AND role IN ('owner', 'propietario') ORDER BY id ASC LIMIT 1",
          [tenantId]
        );
        customerEmail = uRows?.[0]?.email || `owner-${tenantId}@etereasapp.com`;
      }

      const session = await this.tokenizationProvider.createCustomerSession({ email: customerEmail });
      const newExpiry = new Date(Date.now() + 30 * 60 * 1000);
      await this.pool.query(
        `UPDATE saas_checkout_orders
         SET status = ?, cardnet_session_id = ?, cardnet_session_key = ?, expires_at = ?, updated_at = NOW()
         WHERE id = ? AND tenant_id = ? AND status IN ('pending_payment', 'processing', 'unknown_timeout')`,
        [ORDER_STATUS.PROCESSING, session.uniqueId, session.customerId, newExpiry, order.id, tenantId]
      );

      const [updatedRows] = await this.pool.query('SELECT * FROM saas_checkout_orders WHERE id = ? LIMIT 1', [order.id]);
      return {
        order: sanitizeOrderForClient(updatedRows[0]),
        checkout: {
          mode: 'pwcheckout_iframe',
          uniqueId: session.uniqueId,
          customerId: session.customerId,
          captureUrl: session.captureUrl,
          publicKey: session.publicKey,
          reusedSession: false,
        },
      };
    }

    // Modo 2: CardNet Hosted Checkout (ecommerce.cardnet.com.do/sessions + /authorize)
    // Si ya tiene una sesión CardNet activa y no expirada, reutilizarla para evitar cobros duplicados por doble clic
    if (
      order.status === ORDER_STATUS.PROCESSING &&
      order.cardnet_session_id &&
      new Date(order.expires_at).getTime() > Date.now()
    ) {
      return {
        order: sanitizeOrderForClient(order),
        checkout: {
          mode: 'hosted_post',
          authorizeUrl: `${this.cardnetProvider.baseUrl}/authorize`,
          sessionId: order.cardnet_session_id,
          reusedSession: true,
        },
      };
    }

    const base = (returnBaseUrl || this.cardnetProvider.publicBaseUrl).replace(/\/+$/, '');
    const returnUrl = `${base}/saas-checkout/retorno?orderId=${encodeURIComponent(order.id)}`;
    const cancelUrl = `${base}/saas-checkout/retorno?orderId=${encodeURIComponent(order.id)}&cancelled=1`;

    const session = await this.cardnetProvider.createSession({
      orderNumber: order.order_number,
      transactionId: order.order_number,
      totalMinor: order.total_minor,
      taxMinor: order.tax_minor,
      currency: order.currency,
      returnUrl,
      cancelUrl,
      clientIp,
    });

    const newExpiry = new Date(Date.now() + 30 * 60 * 1000);
    await this.pool.query(
      `UPDATE saas_checkout_orders
       SET status = ?, cardnet_session_id = ?, cardnet_session_key = ?, expires_at = ?, updated_at = NOW()
       WHERE id = ? AND tenant_id = ? AND status IN ('pending_payment', 'processing', 'unknown_timeout')`,
      [ORDER_STATUS.PROCESSING, session.sessionId, session.sessionKey, newExpiry, order.id, tenantId]
    );

    const [updatedRows] = await this.pool.query('SELECT * FROM saas_checkout_orders WHERE id = ? LIMIT 1', [order.id]);
    return {
      order: sanitizeOrderForClient(updatedRows[0]),
      checkout: {
        mode: 'hosted_post',
        authorizeUrl: session.authorizeUrl,
        sessionId: session.sessionId,
        reusedSession: false,
      },
    };
  }

  async chargeOrderWithToken({ orderId, tenantId, trxToken, clientIp = null, actorUserId = null }) {
    if (!this.tokenizationProvider) {
      const err = new Error('Proveedor CardNet Tokenización no inicializado.');
      err.code = 'CARDNET_PROVIDER_UNAVAILABLE';
      err.statusCode = 503;
      throw err;
    }

    const [rows] = await this.pool.query(
      'SELECT * FROM saas_checkout_orders WHERE id = ? AND tenant_id = ? LIMIT 1',
      [orderId, tenantId]
    );
    if (rows.length === 0) {
      const err = new Error('Orden de pago no encontrada.');
      err.code = 'ORDER_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const order = rows[0];

    if (order.status === ORDER_STATUS.APPROVED && order.activated_at) {
      return {
        order: sanitizeOrderForClient(order),
        activated: true,
        alreadyProcessed: true,
      };
    }

    if (order.status === ORDER_STATUS.APPROVED && !order.activated_at) {
      return this._activateAfterPayment(order, actorUserId);
    }

    if ([ORDER_STATUS.CANCELLED, ORDER_STATUS.DECLINED, ORDER_STATUS.EXPIRED].includes(order.status)) {
      const err = new Error('Esta orden ya fue cerrada; inicia una nueva orden de pago.');
      err.code = 'ORDER_NOT_PAYABLE';
      err.statusCode = 409;
      throw err;
    }

    if (order.status === ORDER_STATUS.UNKNOWN_TIMEOUT) {
      const err = new Error('El intento anterior quedó pendiente de confirmación con CardNet. Concilia la orden antes de reintentar.');
      err.code = 'RECONCILIATION_REQUIRED';
      err.statusCode = 409;
      throw err;
    }

    const [claimRes] = await this.pool.query(
      `UPDATE saas_checkout_orders
       SET status = ?, cardnet_response_code = 'CHARGING', updated_at = NOW()
       WHERE id = ? AND tenant_id = ?
         AND status IN ('pending_payment', 'processing')
         AND COALESCE(cardnet_response_code, '') <> 'CHARGING'`,
      [ORDER_STATUS.PROCESSING, order.id, tenantId]
    );
    if (!claimRes?.affectedRows) {
      const err = new Error('El pago de esta orden ya se está procesando. Espera la confirmación antes de reintentar.');
      err.code = 'PAYMENT_IN_PROGRESS';
      err.statusCode = 409;
      throw err;
    }

    let result;
    console.info('[SAAS CHECKOUT] CARDNET_PURCHASE_STARTED', {
      orderId: order.id,
      orderNumber: order.order_number,
      tenantId,
      currency: order.currency,
      totalMinor: String(order.total_minor),
    });
    try {
      result = await this.tokenizationProvider.purchaseWithToken({
        trxToken,
        orderNumber: order.order_number,
        totalMinor: order.total_minor,
        taxMinor: order.tax_minor,
        currency: order.currency,
        description: `Suscripción Etereas (${order.order_number})`,
        clientIp,
      });
    } catch (err) {
      console.error('[SAAS CHECKOUT] CARDNET_PURCHASE_ERROR', {
        orderId: order.id,
        orderNumber: order.order_number,
        tenantId,
        code: err.code || null,
        message: err.message,
      });
      if (err.code === 'CARDNET_TIMEOUT') {
        await this.pool.query(
          `UPDATE saas_checkout_orders
           SET status = ?, reconcile_attempts = reconcile_attempts + 1, last_error = ?, cardnet_response_code = ?, updated_at = NOW()
           WHERE id = ? AND tenant_id = ? AND status IN ('pending_payment', 'processing', 'unknown_timeout')`,
          [ORDER_STATUS.UNKNOWN_TIMEOUT, err.message, 'TIMEOUT', order.id, tenantId]
        );
      } else {
        await this.pool.query(
          `UPDATE saas_checkout_orders
           SET cardnet_response_code = NULL, last_error = ?, updated_at = NOW()
           WHERE id = ? AND tenant_id = ? AND cardnet_response_code = 'CHARGING'`,
          [err.message, order.id, tenantId]
        );
      }
      throw err;
    }

    if (result.approved) {
      console.info('[SAAS CHECKOUT] CARDNET_PURCHASE_APPROVED', {
        orderId: order.id,
        orderNumber: order.order_number,
        tenantId,
        responseCode: result.responseCode,
        authorizationCode: result.authorizationCode,
        maskedCard: result.maskedCard,
      });
      await this.pool.query(
        `UPDATE saas_checkout_orders
         SET status = ?,
             paid_at = COALESCE(paid_at, NOW()),
             cardnet_authorization_code = ?,
             cardnet_reference = ?,
             cardnet_response_code = ?,
             cardnet_response_message = ?,
             masked_card = COALESCE(?, masked_card),
             last_error = NULL,
             updated_at = NOW()
         WHERE id = ? AND tenant_id = ?`,
        [
          ORDER_STATUS.APPROVED,
          result.authorizationCode,
          result.retrievalReferenceNumber || result.transactionId || null,
          result.responseCode,
          result.responseMessage,
          result.maskedCard,
          order.id,
          tenantId,
        ]
      );

      const [approvedRows] = await this.pool.query('SELECT * FROM saas_checkout_orders WHERE id = ? LIMIT 1', [order.id]);
      return this._activateAfterPayment(approvedRows[0], actorUserId);
    }

    console.warn('[SAAS CHECKOUT] CARDNET_PURCHASE_DECLINED', {
      orderId: order.id,
      orderNumber: order.order_number,
      tenantId,
      responseCode: result.responseCode,
      responseMessage: result.responseMessage,
    });

    await this.pool.query(
      `UPDATE saas_checkout_orders
       SET status = ?, cardnet_response_code = ?, cardnet_response_message = ?, updated_at = NOW()
       WHERE id = ? AND tenant_id = ? AND status IN ('pending_payment', 'processing', 'unknown_timeout')`,
      [ORDER_STATUS.DECLINED, result.responseCode, result.responseMessage, order.id, tenantId]
    );

    const [declinedRows] = await this.pool.query('SELECT * FROM saas_checkout_orders WHERE id = ? LIMIT 1', [order.id]);
    return {
      order: sanitizeOrderForClient(declinedRows[0]),
      activated: false,
      declined: true,
      message: result.responseMessage,
    };
  }

  async verifyAndFinalizeOrder({ orderId, tenantId, cancelledByUser = false, actorUserId = null }) {
    const [rows] = await this.pool.query(
      'SELECT * FROM saas_checkout_orders WHERE id = ? AND tenant_id = ? LIMIT 1',
      [orderId, tenantId]
    );
    if (rows.length === 0) {
      const err = new Error('Orden de pago no encontrada.');
      err.code = 'ORDER_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const order = rows[0];

    // Ya pagada y activada: respuesta idempotente sin volver a consultar/cobrar
    if (order.status === ORDER_STATUS.APPROVED && order.activated_at) {
      let currentOrder = order;
      if (!order.invoice_id && this.billingRepo) {
        await this._syncOrderFinancialRecords(order, actorUserId);
        const [refreshed] = await this.pool.query('SELECT * FROM saas_checkout_orders WHERE id = ? LIMIT 1', [order.id]);
        if (refreshed[0]) currentOrder = refreshed[0];
      }
      return {
        order: sanitizeOrderForClient(currentOrder),
        activated: true,
        alreadyProcessed: true,
      };
    }

    // Ya pagada en CardNet pero falló la activación interna: reconciliar sin volver a cobrar
    if (order.status === ORDER_STATUS.APPROVED && !order.activated_at) {
      return this._activateAfterPayment(order, actorUserId);
    }

    if (!order.cardnet_session_id || !order.cardnet_session_key) {
      if (cancelledByUser && order.status === ORDER_STATUS.PENDING_PAYMENT) {
        await this.pool.query(
          `UPDATE saas_checkout_orders SET status = ?, updated_at = NOW() WHERE id = ? AND tenant_id = ?`,
          [ORDER_STATUS.CANCELLED, order.id, tenantId]
        );
        const [cancelledRows] = await this.pool.query('SELECT * FROM saas_checkout_orders WHERE id = ? LIMIT 1', [order.id]);
        return { order: sanitizeOrderForClient(cancelledRows[0]), activated: false };
      }
      const err = new Error('La orden aún no tiene una sesión de checkout CardNet iniciada.');
      err.code = 'CHECKOUT_NOT_INITIATED';
      err.statusCode = 409;
      throw err;
    }

    const verification = await this.cardnetProvider.verifySession({
      sessionId: order.cardnet_session_id,
      sessionKey: order.cardnet_session_key,
      expectedOrderNumber: order.order_number,
      expectedAmountMinor: order.total_minor,
      expectedCurrency: order.currency,
    });

    if (verification.outcome === 'approved') {
      await this.pool.query(
        `UPDATE saas_checkout_orders
         SET status = ?, paid_at = COALESCE(paid_at, NOW()),
             cardnet_authorization_code = ?, cardnet_reference = ?,
             cardnet_response_code = ?, cardnet_response_message = ?,
             masked_card = COALESCE(?, masked_card),
             last_error = NULL, updated_at = NOW()
         WHERE id = ? AND tenant_id = ?`,
        [
          ORDER_STATUS.APPROVED,
          verification.authorizationCode,
          verification.reference,
          verification.responseCode,
          verification.message,
          verification.maskedCard,
          order.id,
          tenantId,
        ]
      );

      const [paidRows] = await this.pool.query('SELECT * FROM saas_checkout_orders WHERE id = ? LIMIT 1', [order.id]);
      return this._activateAfterPayment(paidRows[0], actorUserId);
    }

    if (verification.outcome === 'declined') {
      await this.pool.query(
        `UPDATE saas_checkout_orders
         SET status = ?, cardnet_response_code = ?, cardnet_response_message = ?,
             masked_card = COALESCE(?, masked_card), updated_at = NOW()
         WHERE id = ? AND tenant_id = ? AND status <> 'approved'`,
        [
          cancelledByUser ? ORDER_STATUS.CANCELLED : ORDER_STATUS.DECLINED,
          verification.responseCode,
          verification.message,
          verification.maskedCard,
          order.id,
          tenantId,
        ]
      );
      const [declinedRows] = await this.pool.query('SELECT * FROM saas_checkout_orders WHERE id = ? LIMIT 1', [order.id]);
      return { order: sanitizeOrderForClient(declinedRows[0]), activated: false };
    }

    if (verification.outcome === 'expired') {
      const nextStatus = cancelledByUser ? ORDER_STATUS.CANCELLED : ORDER_STATUS.EXPIRED;
      await this.pool.query(
        `UPDATE saas_checkout_orders
         SET status = ?, cardnet_response_code = ?, cardnet_response_message = ?, updated_at = NOW()
         WHERE id = ? AND tenant_id = ? AND status <> 'approved'`,
        [nextStatus, verification.responseCode, verification.message, order.id, tenantId]
      );
      const [expRows] = await this.pool.query('SELECT * FROM saas_checkout_orders WHERE id = ? LIMIT 1', [order.id]);
      return { order: sanitizeOrderForClient(expRows[0]), activated: false };
    }

    if (verification.outcome === 'invalid_verification') {
      await this.pool.query(
        `UPDATE saas_checkout_orders
         SET last_error = ?, cardnet_response_code = ?, updated_at = NOW()
         WHERE id = ? AND tenant_id = ? AND status <> 'approved'`,
        [verification.message, verification.responseCode, order.id, tenantId]
      );
      const err = new Error(verification.message);
      err.code = verification.responseCode || 'INVALID_GATEWAY_VERIFICATION';
      err.statusCode = 409;
      throw err;
    }

    // unknown_timeout (permite conciliación posterior sin volver a cobrar)
    const fallbackStatus = cancelledByUser ? ORDER_STATUS.CANCELLED : ORDER_STATUS.UNKNOWN_TIMEOUT;
    await this.pool.query(
      `UPDATE saas_checkout_orders
       SET status = ?, reconcile_attempts = reconcile_attempts + 1,
           last_error = ?, cardnet_response_code = ?, updated_at = NOW()
       WHERE id = ? AND tenant_id = ? AND status <> 'approved'`,
      [fallbackStatus, verification.message, verification.responseCode, order.id, tenantId]
    );
    const [timeoutRows] = await this.pool.query('SELECT * FROM saas_checkout_orders WHERE id = ? LIMIT 1', [order.id]);
    return { order: sanitizeOrderForClient(timeoutRows[0]), activated: false, needsReconciliation: true };
  }

  async _activateAfterPayment(order, actorUserId = null) {
    try {
      // 0. Si ya estaba activada, respuesta idempotente estricta sin duplicar recursos
      if (order.activated_at) {
        return {
          order: sanitizeOrderForClient(order),
          activated: true,
          alreadyProcessed: true,
        };
      }

      const meta = typeof order.metadata === 'object' && order.metadata ? order.metadata : {};
      const isAddBranch = meta.type === 'add_branch';
      const isAddonBlocks = meta.type === 'addon_memberships_blocks';
      const isExtraSeats = meta.type === 'extra_user_seats';

      if (isAddonBlocks) {
        const selectedBranchIds = Array.isArray(meta.selected_branch_ids)
          ? meta.selected_branch_ids
          : (Array.isArray(order.addon_branch_ids) ? order.addon_branch_ids : []);
        const newBlocks = Math.max(1, Number(meta.new_acquired_blocks || order.addon_blocks_count || 1));
        if (this.entitlementsService) {
          await this.entitlementsService.setAddonStatus(order.tenant_id, SAAS_ADDONS.MEMBERSHIPS, {
            enabled: true,
            source: 'commercial_addon',
            reason: `Contratación Add-on Membresías (${newBlocks} bloque(s), hasta ${newBlocks * 3} sucursales · Orden ${order.order_number})`,
            actorId: actorUserId || order.created_by_user_id || 'cardnet_checkout',
            branchIds: selectedBranchIds,
            acquiredBlocks: newBlocks,
          });
          if (typeof this.entitlementsService.invalidateTenantCache === 'function') {
            this.entitlementsService.invalidateTenantCache(order.tenant_id);
          }
        }
      } else if (isExtraSeats) {
        const addedSeats = Math.max(1, Number(meta.additional_seats || order.extra_users_count || 1));
        await this.pool.query(
          `UPDATE tenants
           SET extra_user_seats = COALESCE(extra_user_seats, 0) + ?,
               max_users = (COALESCE(licensed_branches, max_branches, 1) * 3) + COALESCE(extra_user_seats, 0) + ?,
               updated_at = NOW()
           WHERE id = ?`,
          [addedSeats, addedSeats, order.tenant_id]
        );
        await this.pool.query(
          `UPDATE tenant_subscriptions
           SET extra_users_count = COALESCE(extra_users_count, 0) + ?,
               updated_at = NOW()
           WHERE tenant_id = ?`,
          [addedSeats, order.tenant_id]
        ).catch(() => { });
        if (this.entitlementsService && typeof this.entitlementsService.invalidateTenantCache === 'function') {
          this.entitlementsService.invalidateTenantCache(order.tenant_id);
        }
      } else if (isAddBranch) {
        // A1. Crear o activar la sucursal en branches y salons SOLO tras confirmar pago aprobado
        if (meta.branch_id) {
          const bName = String(meta.branch_data?.name || 'Nueva Sucursal').trim();
          const bAddr = String(meta.branch_data?.address || '').trim();
          const bPhone = String(meta.branch_data?.phone || '').trim();
          await this.pool.query(
            `INSERT INTO branches (id, tenant_id, name, address, phone, is_main, is_active)
             VALUES (?, ?, ?, ?, ?, false, true)
             ON CONFLICT (id) DO UPDATE SET is_active = true, name = EXCLUDED.name, address = EXCLUDED.address, phone = EXCLUDED.phone`,
            [String(meta.branch_id), order.tenant_id, bName, bAddr, bPhone]
          );
          await this.pool.query(
            `INSERT INTO salons (id, tenant_id, name, address, phone, status)
             VALUES (?, ?, ?, ?, ?, 'Active')
             ON CONFLICT (id) DO UPDATE SET status = 'Active', name = EXCLUDED.name, address = EXCLUDED.address, phone = EXCLUDED.phone`,
            [String(meta.branch_id), order.tenant_id, bName, bAddr, bPhone]
          );
        }

        // A2. Comprar otra membresía otorga un bloque de +3 sucursales (+9 usuarios base incluidos)
        await this.pool.query(
          `UPDATE tenants
           SET licensed_branches = GREATEST(3, CEIL(COALESCE(licensed_branches, max_branches, 1)::numeric / 3) * 3) + 3,
               max_branches = GREATEST(3, CEIL(COALESCE(max_branches, licensed_branches, 1)::numeric / 3) * 3) + 3,
               max_users = (GREATEST(3, CEIL(COALESCE(licensed_branches, max_branches, 1)::numeric / 3) * 3) + 3) * 3 + COALESCE(extra_user_seats, 0),
               updated_at = NOW()
           WHERE id = ?`,
          [order.tenant_id]
        );

        // A3. Si contrató el add-on Membresías para esta sucursal, activarlo de forma canónica
        if (meta.wants_memberships_addon && this.entitlementsService) {
          await this.entitlementsService.setAddonStatus(order.tenant_id, SAAS_ADDONS.MEMBERSHIPS, {
            enabled: true,
            source: 'commercial_addon',
            reason: `Add-on contratado con sucursal ${meta.branch_data?.name || ''} (Orden ${order.order_number})`,
            actorId: actorUserId || order.created_by_user_id || 'cardnet_checkout',
          });
        }

        if (this.entitlementsService && typeof this.entitlementsService.invalidateTenantCache === 'function') {
          this.entitlementsService.invalidateTenantCache(order.tenant_id);
        }
      } else {
        // Flujo estándar de activación de suscripción de plan principal
        if (this.lifecycleService && typeof this.lifecycleService.activateOrRenewAfterPayment === 'function') {
          await this.lifecycleService.activateOrRenewAfterPayment({
            tenantId: order.tenant_id,
            planCode: order.plan_code || SAAS_PLANS.PRINCIPAL,
            branchesCount: order.branches_count,
            extraUsersCount: order.extra_users_count,
            orderNumber: order.order_number,
            actorId: actorUserId || order.created_by_user_id || 'cardnet_checkout',
          });
        } else {
          await this.pool.query(
            `UPDATE tenant_subscriptions
             SET plan_code = ?, status = 'active',
                 current_period_start = COALESCE(current_period_start, NOW()),
                 current_period_end = NOW() + INTERVAL '30 days',
                 updated_at = NOW()
             WHERE tenant_id = ?`,
            [order.plan_code || SAAS_PLANS.PRINCIPAL, order.tenant_id]
          );
        }

        // 1b. Activar estado del tenant y sincronizar capacidad contratada (1 membresía = hasta 3 sucursales)
        const orderMemberships = Math.max(1, Math.ceil(Math.max(1, Number(order.branches_count || 1)) / 3));
        const orderBranches = orderMemberships * 3;
        const orderExtraSeats = Math.max(0, Number(order.extra_users_count || 0));
        await this.pool.query(
          `UPDATE tenants
           SET status = CASE WHEN status = 'pending' THEN 'active' ELSE status END,
               licensed_branches = GREATEST(COALESCE(licensed_branches, max_branches, 1), ?),
               max_branches = GREATEST(COALESCE(max_branches, licensed_branches, 1), ?),
               extra_user_seats = GREATEST(COALESCE(extra_user_seats, 0), ?),
               max_users = (GREATEST(COALESCE(licensed_branches, max_branches, 1), ?) * 3) + GREATEST(COALESCE(extra_user_seats, 0), ?),
               updated_at = NOW()
           WHERE id = ?`,
          [orderBranches, orderBranches, orderExtraSeats, orderBranches, orderExtraSeats, order.tenant_id]
        );

        // 2. Si contrató el add-on Suscripciones/Membresías B2C, activarlo de forma canónica
        if (order.memberships_addon_enabled && this.entitlementsService) {
          await this.entitlementsService.setAddonStatus(order.tenant_id, SAAS_ADDONS.MEMBERSHIPS, {
            enabled: true,
            source: 'commercial_addon',
            reason: `Activado tras pago verificado en CardNet (Orden ${order.order_number})`,
            actorId: actorUserId || order.created_by_user_id || 'cardnet_checkout',
          });
        }
      }

      // 3. Conciliar método de pago, factura comercial SaaS y registro de pago (idempotente, usando snapshot de la orden)
      await this._syncOrderFinancialRecords(order, actorUserId);

      await this.pool.query(
        `UPDATE saas_checkout_orders
         SET activated_at = NOW(), last_error = NULL, updated_at = NOW()
         WHERE id = ? AND tenant_id = ?`,
        [order.id, order.tenant_id]
      );

      const [finalRows] = await this.pool.query('SELECT * FROM saas_checkout_orders WHERE id = ? LIMIT 1', [order.id]);
      return {
        order: sanitizeOrderForClient(finalRows[0]),
        activated: true,
      };
    } catch (err) {
      // Pago aprobado en CardNet pero falló la actualización interna -> mantener status='approved' y activated_at=NULL para reconciliar sin cobrar de nuevo
      this.errorAlertService?.reportBusinessAnomaly({
        code: 'CARDNET_APPROVED_ACTIVATION_FAILED',
        title: `CRÍTICO: Pago CardNet aprobado pero falló la activación interna de la orden ${order.order_number || order.id}`,
        details: {
          orderId: order.id,
          orderNumber: order.order_number,
          tenantId: order.tenant_id,
          amountDopCents: order.total_dop_cents,
          error: err.message,
        },
        tenantId: order.tenant_id,
        path: '/api/saas/billing/checkout/_activateAfterPayment',
      }).catch(() => { });
      await this.pool.query(
        `UPDATE saas_checkout_orders
         SET reconcile_attempts = reconcile_attempts + 1, last_error = ?, updated_at = NOW()
         WHERE id = ? AND tenant_id = ?`,
        [err.message || 'Error interno activando suscripción', order.id, order.tenant_id]
      );
      const [pendingActRows] = await this.pool.query('SELECT * FROM saas_checkout_orders WHERE id = ? LIMIT 1', [order.id]);
      return {
        order: sanitizeOrderForClient(pendingActRows[0]),
        activated: false,
        activationError: err.message,
        needsReconciliation: true,
      };
    }
  }

  /**
   * Concilia una orden ya aprobada con método de pago, factura comercial SaaS y pago
   * sin volver a cobrar en CardNet.
   */
  async reconcileApprovedOrder({ orderId, tenantId, actorUserId = null }) {
    const [rows] = await this.pool.query(
      'SELECT * FROM saas_checkout_orders WHERE id = ? AND tenant_id = ? LIMIT 1',
      [orderId, tenantId]
    );
    if (rows.length === 0) {
      const err = new Error('Orden de pago no encontrada.');
      err.code = 'ORDER_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const order = rows[0];
    if (order.status !== ORDER_STATUS.APPROVED) {
      const err = new Error('Solo se pueden conciliar órdenes con pago aprobado.');
      err.code = 'ORDER_NOT_APPROVED';
      err.statusCode = 409;
      throw err;
    }

    if (!order.activated_at) {
      return this._activateAfterPayment(order, actorUserId);
    }

    const financial = await this._syncOrderFinancialRecords(order, actorUserId);
    const [refreshed] = await this.pool.query('SELECT * FROM saas_checkout_orders WHERE id = ? LIMIT 1', [order.id]);
    return {
      order: sanitizeOrderForClient(refreshed[0] || order),
      activated: true,
      reconciled: true,
      invoice: financial.invoice || null,
      paymentMethod: financial.paymentMethod
        ? {
          id: financial.paymentMethod.id,
          brand: financial.paymentMethod.brand,
          last4: financial.paymentMethod.last4,
          expMonth: financial.paymentMethod.exp_month,
          expYear: financial.paymentMethod.exp_year,
          isDefault: financial.paymentMethod.is_default,
        }
        : null,
    };
  }

  /**
   * Sincroniza de forma idempotente:
   * 1) Método de pago reutilizable desde CardNet (si existe PaymentProfile).
   * 2) Factura comercial SaaS + ítem(s) + registro de pago con la instantánea exacta de la orden.
   */
  async _syncOrderFinancialRecords(order, actorUserId = null) {
    let savedPaymentMethod = null;

    // 1. Persistir método de pago reutilizable si CardNet devolvió PaymentProfiles
    if (
      this.billingRepo &&
      typeof this.billingRepo.savePaymentMethod === 'function' &&
      this.tokenizationProvider &&
      typeof this.tokenizationProvider.getCustomerProfile === 'function' &&
      order.cardnet_session_key
    ) {
      try {
        const profile = await this.tokenizationProvider.getCustomerProfile(order.cardnet_session_key);
        const candidates = Array.isArray(profile?.paymentProfiles) ? profile.paymentProfiles : [];
        const chosen = candidates.find((p) => p.enabled) || candidates[0];
        if (chosen && (chosen.token || chosen.paymentProfileId)) {
          savedPaymentMethod = await this.billingRepo.savePaymentMethod({
            tenant_id: order.tenant_id,
            gateway_type: 'cardnet',
            token_reference: chosen.token || chosen.paymentProfileId,
            provider_customer_id: profile.customerId || String(order.cardnet_session_key),
            last4: chosen.last4,
            brand: chosen.brand,
            exp_month: chosen.expMonth,
            exp_year: chosen.expYear,
            is_default: true,
          });

          if (!order.masked_card && chosen.brand && chosen.last4) {
            const masked = `${chosen.brand} ****${chosen.last4}`;
            await this.pool.query(
              `UPDATE saas_checkout_orders SET masked_card = ?, updated_at = NOW() WHERE id = ? AND tenant_id = ?`,
              [masked, order.id, order.tenant_id]
            );
          }
        }
      } catch (pmErr) {
        console.warn('[SAAS_CHECKOUT] No se pudo consultar PaymentProfiles de CardNet (se conserva pago):', pmErr.message);
      }
    }

    if (!this.billingRepo) {
      return { invoice: null, paymentMethod: savedPaymentMethod };
    }

    const totalMinor = BigInt(order.total_minor || 0);
    const subtotalMinor = BigInt(order.subtotal_minor ?? totalMinor);
    const taxMinor = BigInt(order.tax_minor || 0);
    const currency = String(order.currency || 'DOP').trim().toUpperCase();
    const gatewayRef = order.cardnet_authorization_code || order.cardnet_reference || order.order_number;
    const paymentIdempKey = `pay_ord_${order.id}`;

    let invoice = null;
    if (order.invoice_id && typeof this.billingRepo.getInvoiceById === 'function') {
      invoice = await this.billingRepo.getInvoiceById(order.tenant_id, order.invoice_id);
      if (invoice && invoice.status !== 'paid' && typeof this.billingRepo.markInvoicePaid === 'function') {
        await this.billingRepo.markInvoicePaid(invoice.id, {
          tenantId: invoice.tenant_id || order.tenant_id,
          amountPaidMinor: totalMinor,
          externalReference: gatewayRef,
        });
      }
    }

    if (!invoice && typeof this.billingRepo.createInvoice === 'function') {
      let subscriptionId = null;
      let periodStart = order.paid_at || order.created_at || new Date().toISOString();
      let periodEnd = new Date(new Date(periodStart).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
      try {
        const [subRows] = await this.pool.query(
          `SELECT id, current_period_start, current_period_end FROM tenant_subscriptions WHERE tenant_id = ? LIMIT 1`,
          [order.tenant_id]
        );
        if (subRows[0]) {
          subscriptionId = subRows[0].id || null;
          if (subRows[0].current_period_start) periodStart = subRows[0].current_period_start;
          if (subRows[0].current_period_end) periodEnd = subRows[0].current_period_end;
        }
      } catch (_) {
        // Fallback a fechas derivadas de la orden
      }

      const meta = typeof order.metadata === 'object' && order.metadata ? order.metadata : {};
      const fx = meta.fx_snapshot || null;

      let itemDesc = '';
      if (meta.type === 'addon_memberships_blocks') {
        const addedBlocks = Number(meta.additional_blocks_to_buy || 1);
        const totalBlocks = Number(meta.new_acquired_blocks || addedBlocks);
        const prorationText = meta.proration?.isProrated ? ` (Prorrateo ${meta.proration.remainingDays} días)` : '';
        itemDesc = `Add-on Suscripciones y Membresías B2C (+${addedBlocks} ${addedBlocks === 1 ? 'bloque' : 'bloques'} · capacidad total hasta ${totalBlocks * 3} sucursales)${prorationText} · Orden #${order.order_number}`;
      } else if (meta.type === 'extra_user_seats') {
        const addedSeats = Number(meta.additional_seats || order.extra_users_count || 1);
        const prorationText = meta.proration?.isProrated ? ` (Prorrateo ${meta.proration.remainingDays} días)` : '';
        itemDesc = `Usuarios adicionales (+${addedSeats} ${addedSeats === 1 ? 'asiento' : 'asientos'})${prorationText} · Orden #${order.order_number}`;
      } else if (meta.type === 'add_branch') {
        const branchName = meta.branch_data?.name || 'Sucursal adicional';
        const addonText = meta.wants_memberships_addon ? ' + Add-on Membresías B2C' : '';
        const prorationText = meta.proration?.isProrated ? ` (Prorrateo ${meta.proration.remainingDays} días)` : '';
        itemDesc = `Sucursal adicional "${branchName}" (+3 usuarios)${addonText}${prorationText} · Orden #${order.order_number}`;
      } else {
        const branches = Number(order.branches_count || 1);
        const extraUsers = Number(order.extra_users_count || 0);
        const parts = [`Plan Principal (${branches} ${branches === 1 ? 'sucursal' : 'sucursales'})`];
        if (extraUsers > 0) parts.push(`${extraUsers} usuario${extraUsers === 1 ? '' : 's'} adicional${extraUsers === 1 ? '' : 'es'}`);
        if (order.memberships_addon_enabled) parts.push('Add-on Membresías B2C');
        itemDesc = `${parts.join(' + ')} · Orden #${order.order_number}`;
      }

      invoice = await this.billingRepo.createInvoice(
        {
          tenant_id: order.tenant_id,
          subscription_id: subscriptionId,
          plan_code: order.plan_code || SAAS_PLANS.PRINCIPAL,
          billing_cycle: 'monthly',
          price_book_version: meta.price_book_version || 'v1_2026',
          period_start: periodStart,
          period_end: periodEnd,
          subtotal_minor: subtotalMinor,
          tax_minor: taxMinor,
          total_minor: totalMinor,
          amount_paid_minor: totalMinor,
          amount_due_minor: 0n,
          amount_refunded_minor: 0n,
          currency,
          status: 'paid',
          due_date: order.paid_at || order.created_at || new Date().toISOString(),
          paid_at: order.paid_at || new Date().toISOString(),
        },
        [
          {
            description: itemDesc,
            item_type: 'PLAN_FEE',
            amount_minor: subtotalMinor,
          },
        ]
      );

      await this.pool.query(
        `UPDATE saas_checkout_orders SET invoice_id = ?, updated_at = NOW() WHERE id = ? AND tenant_id = ?`,
        [invoice.id, order.id, order.tenant_id]
      );
    }

    if (invoice && typeof this.billingRepo.recordPayment === 'function') {
      await this.billingRepo.recordPayment({
        tenant_id: order.tenant_id,
        invoice_id: invoice.id,
        amount_minor: totalMinor,
        currency,
        gateway_reference: gatewayRef,
        status: 'success',
        idempotency_key: paymentIdempKey,
      });

      if (typeof this.billingRepo.recordBillingEvent === 'function') {
        await this.billingRepo.recordBillingEvent({
          tenant_id: order.tenant_id,
          event_type: 'SAAS_CHECKOUT_RECONCILED',
          payload: {
            order_id: order.id,
            order_number: order.order_number,
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number,
            total_minor: totalMinor.toString(),
            currency,
            actor: actorUserId || order.created_by_user_id || 'system',
          },
          idempotency_key: `rec_ord_${order.id}`,
        });
      }

      if (typeof this.billingRepo.getInvoiceById === 'function') {
        invoice = await this.billingRepo.getInvoiceById(order.tenant_id, invoice.id);
      }
    }

    return { invoice, paymentMethod: savedPaymentMethod };
  }
}

module.exports = {
  SaasCheckoutService,
  ORDER_STATUS,
  sanitizeOrderForClient,
};
