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
  constructor({ pool, cardnetProvider, tokenizationProvider = null, fxRateService = null, entitlementsService, lifecycleService, billingRepo }) {
    this.pool = pool;
    this.cardnetProvider = cardnetProvider;
    this.tokenizationProvider = tokenizationProvider;
    this.fxRateService = fxRateService;
    this.entitlementsService = entitlementsService;
    this.lifecycleService = lifecycleService;
    this.billingRepo = billingRepo;
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
    const branchUsdMinor = BigInt(Math.round(Number(unitUsd) * 100)) * BigInt(safeBranches);
    const extraUserUsdMinor =
      safeExtraUsers > 0 ? BigInt(Math.round(Number(extraUserUsd || 0) * 100)) * BigInt(safeExtraUsers) : 0n;
    const addonUsdMinor = safeAddonEnabled ? BigInt(Math.round(addonUsd * 100)) * BigInt(safeAddonBranches) : 0n;

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
      currency: 'DOP',
      billingCycle: 'monthly',
      subtotalMinor: subtotalDopMinor,
      taxMinor: taxDopMinor,
      totalMinor: totalDopMinor,
      fxSnapshot,
    };
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
      return {
        order: sanitizeOrderForClient(order),
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
      // 1. Activar suscripción principal del tenant en PostgreSQL / lifecycleService
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

      // 1b. Activar estado del tenant en plataforma (desbloquea el acceso operativo tras pago verificado)
      await this.pool.query(
        `UPDATE tenants SET status = 'active' WHERE id = ? AND status = 'pending'`,
        [order.tenant_id]
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

      // 3. Si era pago de factura pendiente, marcarla pagada
      if (order.invoice_id && this.billingRepo && typeof this.billingRepo.markInvoicePaid === 'function') {
        await this.billingRepo.markInvoicePaid(order.invoice_id, {
          amountPaidMinor: BigInt(order.total_minor),
          externalReference: order.cardnet_authorization_code || order.order_number,
        });
      }

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
}

module.exports = {
  SaasCheckoutService,
  ORDER_STATUS,
  sanitizeOrderForClient,
};
