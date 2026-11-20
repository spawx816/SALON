/**
 * Servicio Central de Facturación SaaS (SaasBillingService)
 * Orquesta la emisión de facturas con snapshot de precios, cargos mediante PaymentGatewayPort,
 * reembolsos totales y parciales con guardias estrictas, upgrades con prorrateo y procesamiento seguro de webhooks.
 */

const {
  SAAS_PLANS,
  INVOICE_STATUS,
  PAYMENT_STATUS,
  REFUND_STATUS,
  PRICE_BOOK_VERSION,
  getPlanPriceMinor,
  isValidCurrency,
  isValidCycle
} = require('./saas_billing.constants');
const { LEGACY_PLAN_CODES } = require('./saas_catalog.constants');
const { ProrationEngine } = require('./proration_engine');
const { ZeroTaxPolicy } = require('./tax_policy');

class SaasBillingService {
  constructor({
    billingRepo,
    subscriptionRepo,
    gatewayPort,
    lifecycleService,
    taxPolicy = new ZeroTaxPolicy(),
    jobScheduler = null
  }) {
    this.billingRepo = billingRepo;
    this.subscriptionRepo = subscriptionRepo;
    this.gatewayPort = gatewayPort;
    this.lifecycleService = lifecycleService;
    this.taxPolicy = taxPolicy;
    this.jobScheduler = jobScheduler;
  }

  async createSubscriptionInvoice({ tenantId, planCode, billingCycle, currency, periodStart, periodEnd }) {
    if (!tenantId) throw new Error('tenantId es obligatorio');
    if (!isValidCurrency(currency)) throw new Error(`Moneda inválida: ${currency}`);
    if (!isValidCycle(billingCycle)) throw new Error(`Ciclo inválido: ${billingCycle}`);

    const baseAmountMinor = BigInt(getPlanPriceMinor(planCode, billingCycle, currency));
    const taxCalculation = this.taxPolicy.calculateTax({
      amountMinor: baseAmountMinor,
      currency,
      tenantId,
      planCode
    });
    const taxMinor = BigInt(taxCalculation.taxAmountMinor || 0n);
    const totalMinor = baseAmountMinor + taxMinor;

    const lineItems = [
      {
        description: `Suscripción SalonPro ${planCode} (${billingCycle})`,
        item_type: 'PLAN_FEE',
        amount_minor: baseAmountMinor
      }
    ];

    if (taxMinor > 0n) {
      lineItems.push({
        description: taxCalculation.taxDescription || 'Impuestos aplicables',
        item_type: 'TAX',
        amount_minor: taxMinor
      });
    }

    const sub = await this.subscriptionRepo.findByTenantId(tenantId);

    const invoice = await this.billingRepo.createInvoice({
      tenant_id: tenantId,
      subscription_id: sub?.id || null,
      plan_code: planCode,
      billing_cycle: billingCycle,
      price_book_version: PRICE_BOOK_VERSION,
      period_start: periodStart ? new Date(periodStart).toISOString() : new Date().toISOString(),
      period_end: periodEnd ? new Date(periodEnd).toISOString() : null,
      subtotal_minor: baseAmountMinor,
      tax_minor: taxMinor,
      total_minor: totalMinor,
      amount_paid_minor: 0n,
      amount_due_minor: totalMinor,
      amount_refunded_minor: 0n,
      currency,
      status: INVOICE_STATUS.OPEN
    }, lineItems);

    return invoice;
  }

  async chargeInvoice({ tenantId, invoiceId, idempotencyKey }) {
    if (!tenantId || !invoiceId) throw new Error('tenantId e invoiceId son requeridos');
    const invoice = await this.billingRepo.getInvoiceById(tenantId, invoiceId);
    if (!invoice) throw new Error(`Factura ${invoiceId} no encontrada para tenant ${tenantId}`);

    if (invoice.status === INVOICE_STATUS.PAID) {
      return { success: true, alreadyPaid: true, invoice };
    }

    const defaultPaymentMethod = await this.billingRepo.getDefaultPaymentMethod(tenantId);
    if (!defaultPaymentMethod) {
      const err = new Error('No existe método de pago predeterminado configurado');
      err.code = 'NO_PAYMENT_METHOD';
      throw err;
    }

    const key = idempotencyKey || `ch_${tenantId}_${invoiceId}_${invoice.amount_due_minor}`;

    try {
      const chargeResult = await this.gatewayPort.charge({
        tenantId,
        amountMinor: invoice.amount_due_minor,
        currency: invoice.currency,
        paymentMethodToken: defaultPaymentMethod.token_reference,
        providerCustomerReference: defaultPaymentMethod.provider_customer_id,
        idempotencyKey: key,
        description: `Cobro Factura ${invoice.invoice_number}`
      });

      // Registrar pago exitoso
      const payment = await this.billingRepo.recordPayment({
        tenant_id: tenantId,
        invoice_id: invoiceId,
        amount_minor: invoice.amount_due_minor,
        currency: invoice.currency,
        gateway_reference: chargeResult.chargeId,
        status: PAYMENT_STATUS.SUCCESS,
        idempotency_key: key
      });

      // Actualizar factura a PAID
      const updatedInvoice = await this.billingRepo.updateInvoice(tenantId, invoiceId, {
        status: INVOICE_STATUS.PAID,
        amount_paid_minor: invoice.total_minor,
        amount_due_minor: 0n,
        paid_at: new Date().toISOString()
      });

      // Notificar al ciclo de vida
      if (this.lifecycleService) {
        await this.lifecycleService.handlePaymentSuccess(tenantId, {
          invoiceId,
          amountMinor: invoice.amount_due_minor,
          currency: invoice.currency
        });
      }

      return {
        success: true,
        payment,
        invoice: updatedInvoice
      };
    } catch (chargeErr) {
      // Registrar pago fallido
      await this.billingRepo.recordPayment({
        tenant_id: tenantId,
        invoice_id: invoiceId,
        amount_minor: invoice.amount_due_minor,
        currency: invoice.currency,
        status: PAYMENT_STATUS.FAILED,
        failure_code: chargeErr.code || 'CHARGE_FAILED',
        failure_message: chargeErr.message,
        idempotency_key: key
      });

      if (this.lifecycleService) {
        await this.lifecycleService.handlePaymentFailure(tenantId, {
          invoiceId,
          failureCode: chargeErr.code || 'CHARGE_FAILED',
          failureMessage: chargeErr.message
        });
      }

      throw chargeErr;
    }
  }

  async processUpgrade({ tenantId, newPlan = LEGACY_PLAN_CODES.PRO, actorId, idempotencyKey }) {
    if (!tenantId) throw new Error('tenantId es obligatorio');
    if (newPlan !== LEGACY_PLAN_CODES.PRO && newPlan !== SAAS_PLANS.PRINCIPAL) {
      throw new Error('Plan de destino no soportado para upgrade');
    }

    // Verificación de idempotencia
    if (idempotencyKey && this.billingRepo?.getBillingEventByIdempotencyKey) {
      const existingEvent = await this.billingRepo.getBillingEventByIdempotencyKey(tenantId, idempotencyKey);
      if (existingEvent) {
        const inv = existingEvent.payload?.invoiceId
          ? await this.billingRepo.getInvoiceById(tenantId, existingEvent.payload.invoiceId)
          : null;
        return {
          success: true,
          isIdempotentReplay: true,
          newPlan,
          invoice: inv,
          payment: { status: 'success' }
        };
      }
    }

    const sub = await this.subscriptionRepo.findByTenantId(tenantId);
    if (!sub) throw new Error('Suscripción no encontrada');

    if (sub.plan_code === newPlan) {
      throw new Error(`La empresa ya se encuentra en Plan ${newPlan}`);
    }

    const currency = sub.currency || 'DOP';
    const cycle = sub.billing_cycle || 'monthly';
    const now = new Date();
    const periodStart = sub.current_period_start || now.toISOString();
    const periodEnd = sub.current_period_end || new Date(now.getTime() + 30 * 86400000).toISOString();

    const proration = ProrationEngine.calculateProration({
      currentPlan: sub.plan_code,
      newPlan,
      billingCycle: cycle,
      currency,
      periodStart,
      periodEnd,
      effectiveAt: now
    });

    let invoice = null;
    let payment = null;

    if (proration.netDueMinor > 0n) {
      const lineItems = [
        {
          description: `Upgrade a Plan ${newPlan} prorrateado (${proration.remainingMs} ms restantes)`,
          item_type: 'PRORATION_CHARGE',
          amount_minor: proration.newPlanChargeMinor
        },
        {
          description: `Crédito por tiempo no consumido en Plan ${sub.plan_code}`,
          item_type: 'PRORATION_CREDIT',
          amount_minor: -proration.unusedCreditMinor
        }
      ];

      invoice = await this.billingRepo.createInvoice({
        tenant_id: tenantId,
        subscription_id: sub.id,
        plan_code: newPlan,
        billing_cycle: cycle,
        price_book_version: PRICE_BOOK_VERSION,
        period_start: now.toISOString(),
        period_end: periodEnd,
        subtotal_minor: proration.netDueMinor,
        tax_minor: 0n,
        total_minor: proration.netDueMinor,
        amount_paid_minor: 0n,
        amount_due_minor: proration.netDueMinor,
        amount_refunded_minor: 0n,
        currency,
        status: INVOICE_STATUS.OPEN
      }, lineItems);

      // Cobrar inmediatamente el monto neto adeudado
      const chargeRes = await this.chargeInvoice({
        tenantId,
        invoiceId: invoice.id,
        idempotencyKey: idempotencyKey || `upg_ch_${tenantId}_${invoice.id}`
      });
      payment = chargeRes.payment;
      invoice = chargeRes.invoice;
    }

    // Actualizar suscripción en repositorio de Fase 2A
    const updatedSub = {
      ...sub,
      plan_code: newPlan,
      updated_at: now.toISOString()
    };

    if (this.subscriptionRepo.upsertSubscription) {
      await this.subscriptionRepo.upsertSubscription(tenantId, updatedSub);
    } else if (this.subscriptionRepo.update) {
      await this.subscriptionRepo.update(tenantId, updatedSub);
    } else if (this.subscriptionRepo.save) {
      await this.subscriptionRepo.save(updatedSub);
    }

    // Registrar evento de auditoría
    await this.billingRepo.recordBillingEvent({
      tenant_id: tenantId,
      event_type: 'PLAN_UPGRADE_EXECUTED',
      payload: {
        fromPlan: sub.plan_code,
        toPlan: newPlan,
        netDueMinor: String(proration.netDueMinor),
        invoiceId: invoice?.id || null,
        actorId
      },
      idempotency_key: idempotencyKey || `evt_upg_${tenantId}_${now.getTime()}`
    });

    return {
      success: true,
      newPlan,
      proration,
      invoice,
      payment
    };
  }

  async processRefund({ tenantId, paymentId, amountMinor, reason = 'customer_request', actorId, idempotencyKey }) {
    if (!tenantId || !paymentId) throw new Error('tenantId y paymentId son requeridos');
    const payment = await this.billingRepo.getPaymentById(tenantId, paymentId);
    if (!payment) throw new Error(`Pago ${paymentId} no encontrado para tenant ${tenantId}`);

    if (payment.status === PAYMENT_STATUS.FAILED) {
      throw new Error('No se puede reembolsar un pago fallido');
    }

    const refundAmount = BigInt(amountMinor);
    if (refundAmount <= 0n) {
      throw new Error('amountMinor debe ser un entero positivo mayor que cero');
    }

    // Validar límite acumulado de reembolsos para no superar lo pagado
    const previousRefunded = await this.billingRepo.getTotalRefundedForPayment(tenantId, paymentId);
    const newTotalRefunded = previousRefunded + refundAmount;

    if (newTotalRefunded > payment.amount_minor) {
      const remainingAllowed = payment.amount_minor - previousRefunded;
      const err = new Error(
        `Monto de reembolso (${refundAmount}) excede el remanente disponible del pago (${remainingAllowed})`
      );
      err.code = 'REFUND_EXCEEDS_PAYMENT';
      err.details = { paidMinor: payment.amount_minor, previousRefunded, remainingAllowed };
      throw err;
    }

    const key = idempotencyKey || `ref_${tenantId}_${paymentId}_${refundAmount}_${Date.now()}`;

    // Ejecutar en pasarela
    const gwRefund = await this.gatewayPort.refund({
      tenantId,
      chargeId: payment.gateway_reference,
      amountMinor: refundAmount,
      currency: payment.currency,
      reason,
      idempotencyKey: key
    });

    // Registrar entidad saas_refunds
    const refundRecord = await this.billingRepo.recordRefund({
      tenant_id: tenantId,
      payment_id: paymentId,
      invoice_id: payment.invoice_id,
      amount_minor: refundAmount,
      currency: payment.currency,
      gateway_reference: gwRefund.refundId,
      status: REFUND_STATUS.SUCCESS,
      reason,
      idempotency_key: key,
      actor: actorId || 'system'
    });

    // Determinar nuevo estado del pago:
    // REGLA: No marcar todo como REFUNDED si solo es un reembolso parcial
    const isFullRefund = (newTotalRefunded === payment.amount_minor);
    const newPaymentStatus = isFullRefund ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PARTIALLY_REFUNDED;

    await this.billingRepo.updatePayment(tenantId, paymentId, {
      status: newPaymentStatus,
      refunded_amount_minor: newTotalRefunded
    });

    // Actualizar factura
    const invoice = await this.billingRepo.getInvoiceById(tenantId, payment.invoice_id);
    if (invoice) {
      const invRefundTotal = BigInt(invoice.amount_refunded_minor || 0n) + refundAmount;
      const newInvoiceStatus = (invRefundTotal >= invoice.total_minor)
        ? INVOICE_STATUS.REFUNDED
        : INVOICE_STATUS.PARTIALLY_REFUNDED;

      await this.billingRepo.updateInvoice(tenantId, payment.invoice_id, {
        status: newInvoiceStatus,
        amount_refunded_minor: invRefundTotal
      });
    }

    return {
      success: true,
      refund: refundRecord,
      paymentStatus: newPaymentStatus,
      isFullRefund,
      totalRefundedMinor: newTotalRefunded
    };
  }

  async handleWebhook({ provider, rawBody, signatureHeader, secret }) {
    if (!provider) throw new Error('provider es obligatorio en webhook');
    const normalizedProvider = String(provider).trim().toLowerCase();

    // 0. Validar que el adaptador realmente soporta el mecanismo oficial de autenticación del proveedor.
    // Un HMAC interno del adaptador simulado NO acredita compatibilidad con CardNet.
    if (normalizedProvider === 'cardnet') {
      const supportsOfficialCardnetWebhook =
        typeof this.gatewayPort?.supportsProviderWebhook === 'function'
          ? Boolean(this.gatewayPort.supportsProviderWebhook('cardnet'))
          : false;
      if (!supportsOfficialCardnetWebhook) {
        const err = new Error('CardNet no tiene habilitado un mecanismo oficial verificado de firma de webhooks; use conciliación server-to-server.');
        err.code = 'WEBHOOK_PROVIDER_AUTH_NOT_SUPPORTED';
        err.statusCode = 501;
        throw err;
      }
    }

    // 1. Verificar firma criptográfica sobre el body crudo (fail-closed: sin secreto hardcodeado)
    const webhookSecret = secret ||
      process.env[`SAAS_WEBHOOK_SECRET_${normalizedProvider.toUpperCase()}`] ||
      this.gatewayPort?.webhookSecret ||
      null;

    if (!webhookSecret) {
      const err = new Error('Secreto de webhook no configurado para el proveedor');
      err.code = 'INVALID_WEBHOOK_SIGNATURE';
      err.statusCode = 401;
      throw err;
    }

    const isValidSig = this.gatewayPort.verifyWebhookSignature({
      rawBody,
      signatureHeader,
      secret: webhookSecret
    });

    if (!isValidSig) {
      const err = new Error('Firma de webhook inválida');
      err.code = 'INVALID_WEBHOOK_SIGNATURE';
      err.statusCode = 401;
      throw err;
    }

    // 2. Parsear payload de forma segura
    let event;
    try {
      event = typeof rawBody === 'string' ? JSON.parse(rawBody) : JSON.parse(rawBody.toString('utf8'));
    } catch (e) {
      const err = new Error('Payload JSON de webhook inválido');
      err.statusCode = 400;
      throw err;
    }

    const eventId = event.id || event.eventId;
    if (!eventId) throw new Error('El evento de webhook no contiene identificador');

    // 3. Distinguir duplicado ya completado/encolado (terminal) de evento pendiente/fallido recuperable
    const TERMINAL_STATUSES = new Set(['enqueued', 'processed', 'completed']);
    const existing = await this.billingRepo.getWebhookEvent(provider, eventId);
    if (existing && TERMINAL_STATUSES.has(String(existing.status || '').toLowerCase())) {
      return {
        success: true,
        idempotentReplay: true,
        status: existing.status,
        eventId,
        resolvedTenantId: existing.tenant_id || null
      };
    }
    const isRecoveryAttempt = Boolean(existing && ['received', 'failed', 'unresolved_tenant'].includes(String(existing.status || '').toLowerCase()));

    // 4. Resolver internamente el tenant SOLO desde referencias confiables en BD (Anti-Tamper):
    // REGLA ESTRICTA: NUNCA confiar en tenant_id ni metadata.internalTenantId enviados en el payload.
    const obj = event.data?.object && typeof event.data.object === 'object' ? event.data.object : {};
    const orderNumber = event.data?.order_number || event.data?.orderNumber || obj.order_number || obj.orderNumber || event.order_number || null;
    const orderId = event.data?.order_id || event.data?.orderId || obj.order_id || obj.orderId || null;
    const paymentId = event.data?.payment_id || event.data?.paymentId || obj.payment_id || obj.paymentId || null;
    const gatewayReference = event.data?.gateway_reference || event.data?.transaction_id || obj.gateway_reference || obj.transaction_id || obj.id || null;
    const providerCustomerId = event.data?.customer || obj.customer || event.customer || null;

    let orderRef = null;
    let paymentRef = null;
    let paymentMethodRef = null;

    if (typeof this.billingRepo.resolveWebhookReference === 'function') {
      const resolved = await this.billingRepo.resolveWebhookReference({
        orderNumber,
        orderId,
        paymentId,
        gatewayReference,
        providerCustomerId
      });
      orderRef = resolved?.order || null;
      paymentRef = resolved?.payment || null;
      paymentMethodRef = resolved?.paymentMethod || null;
    }

    // 4a. Rechazar discrepancias cross-tenant entre referencias internas del evento (orden / pago / cliente)
    const matchedTenants = new Set(
      [orderRef?.tenant_id, paymentRef?.tenant_id, paymentMethodRef?.tenant_id].filter(Boolean).map(String)
    );
    if (matchedTenants.size > 1) {
      const err = new Error('Discrepancia de empresa entre las referencias internas del evento de webhook');
      err.code = 'WEBHOOK_TENANT_MISMATCH';
      err.statusCode = 422;
      throw err;
    }

    const resolvedTenantId = matchedTenants.size === 1 ? Array.from(matchedTenants)[0] : null;

    // 4b. Rechazar discrepancias de importe y moneda frente a la orden o pago interno confiable
    const primaryFinancialRef = orderRef || paymentRef || null;
    const rawEventAmount = event.data?.amount_minor ?? event.data?.amount ?? obj.amount_minor ?? obj.amount;
    const rawEventCurrency = event.data?.currency ?? obj.currency ?? event.currency;

    if (primaryFinancialRef) {
      if (rawEventAmount !== undefined && rawEventAmount !== null && rawEventAmount !== '') {
        let parsedEventAmount;
        try {
          parsedEventAmount = BigInt(rawEventAmount);
        } catch (_) {
          const err = new Error('Importe de webhook inválido');
          err.code = 'WEBHOOK_AMOUNT_MISMATCH';
          err.statusCode = 422;
          throw err;
        }
        if (parsedEventAmount !== BigInt(primaryFinancialRef.expected_amount_minor)) {
          const err = new Error('Discrepancia de importe entre el evento de webhook y la orden/pago interno');
          err.code = 'WEBHOOK_AMOUNT_MISMATCH';
          err.statusCode = 422;
          throw err;
        }
      }

      if (rawEventCurrency !== undefined && rawEventCurrency !== null && String(rawEventCurrency).trim() !== '') {
        const normalizedEventCurrency = String(rawEventCurrency).trim().toUpperCase();
        const expectedCurrency = String(primaryFinancialRef.expected_currency || '').trim().toUpperCase();
        if (expectedCurrency && normalizedEventCurrency !== expectedCurrency) {
          const err = new Error('Discrepancia de moneda entre el evento de webhook y la orden/pago interno');
          err.code = 'WEBHOOK_CURRENCY_MISMATCH';
          err.statusCode = 422;
          throw err;
        }
      }
    }

    // 5. Sanitizar payload (cero tokens sensibles, firmas o PAN)
    const sanitizedPayload = {
      type: event.type,
      id: event.id,
      created: event.created,
      amount: rawEventAmount,
      currency: rawEventCurrency ? String(rawEventCurrency).trim().toUpperCase() : undefined,
      status: event.data?.status ?? obj.status,
      order_number: orderNumber || undefined
    };

    // 6. Deduplicación atómica por (provider, event_id) mediante ON CONFLICT DO NOTHING RETURNING
    if (!isRecoveryAttempt) {
      const persisted = await this.billingRepo.recordWebhookEvent({
        provider,
        event_id: eventId,
        tenant_id: resolvedTenantId,
        event_type: event.type,
        payload_sanitized: sanitizedPayload,
        status: resolvedTenantId ? 'received' : 'unresolved_tenant',
        idempotency_key: eventId
      });

      if (persisted && persisted._inserted === false) {
        return {
          success: true,
          idempotentReplay: true,
          status: persisted.status,
          eventId,
          resolvedTenantId: persisted.tenant_id || null
        };
      }
    }

    // 7. Si no se pudo resolver la empresa desde una referencia interna confiable, NO aplicar efectos
    if (!resolvedTenantId) {
      if (isRecoveryAttempt) {
        return {
          success: true,
          idempotentReplay: true,
          processed: false,
          unresolvedTenant: true,
          status: 'unresolved_tenant',
          eventId,
          resolvedTenantId: null
        };
      }
      return {
        success: true,
        processed: false,
        unresolvedTenant: true,
        status: 'unresolved_tenant',
        eventId,
        resolvedTenantId: null
      };
    }

    // 8. Encolar efectos en outbox (si falla o cae antes de marcar terminal, queda recuperable como 'failed'/'received')
    try {
      if (this.jobScheduler) {
        await this.jobScheduler.scheduleJob({
          jobType: 'PROCESS_WEBHOOK_EVENT',
          tenantId: resolvedTenantId,
          payload: { provider, eventType: event.type, eventId, sanitizedPayload },
          idempotencyKey: `wh_proc_${provider}_${eventId}`
        });
      }
      const finalStatus = this.jobScheduler ? 'enqueued' : 'processed';
      if (typeof this.billingRepo.updateWebhookEventStatus === 'function') {
        await this.billingRepo.updateWebhookEventStatus(provider, eventId, {
          status: finalStatus,
          tenant_id: resolvedTenantId
        });
      }
      return {
        success: true,
        processed: true,
        recovered: isRecoveryAttempt,
        status: finalStatus,
        eventId,
        resolvedTenantId
      };
    } catch (scheduleErr) {
      if (typeof this.billingRepo.updateWebhookEventStatus === 'function') {
        await this.billingRepo.updateWebhookEventStatus(provider, eventId, {
          status: 'failed',
          tenant_id: resolvedTenantId
        }).catch(() => {});
      }
      throw scheduleErr;
    }
  }
}

module.exports = {
  SaasBillingService
};

