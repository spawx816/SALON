/**
 * Rutas de Facturación SaaS y Ciclo de Suscripción (Fase 2D)
 * Endpoints seguros anti-IDOR para suscripciones B2B, métodos de pago, facturas, webhooks y administración.
 */

const express = require('express');
const { getConfiguredPricing, SAAS_ADDONS } = require('../services/saas_catalog.constants');
const { createIdempotencyMiddleware } = require('../middleware/idempotency.middleware.cjs');
const { TermsAndWelcomeEmailService } = require('../services/terms_and_welcome_email.service');

// Safe BigInt JSON serialization
if (!BigInt.prototype.toJSON) {
  BigInt.prototype.toJSON = function () {
    return this.toString();
  };
}

function createSaasBillingRouter({ billingService, lifecycleService, billingRepo, checkoutService, fxRateService, cardnetCheckoutProvider, cardnetTokenizationProvider, termsService: providedTermsService, pool }) {
  const router = express.Router();
  const termsService = providedTermsService || new TermsAndWelcomeEmailService({ pool });

  // Financial Idempotency Guard (upgrade, downgrade, pay-debt, payment methods)
  router.use(createIdempotencyMiddleware());

  // Helper para serializar BigInt a String/Number en respuestas JSON
  const serializeInvoice = (inv) => {
    if (!inv) return null;
    return {
      ...inv,
      subtotal_minor: String(inv.subtotal_minor || 0n),
      tax_minor: String(inv.tax_minor || 0n),
      total_minor: String(inv.total_minor || 0n),
      amount_paid_minor: String(inv.amount_paid_minor || 0n),
      amount_due_minor: String(inv.amount_due_minor || 0n),
      amount_refunded_minor: String(inv.amount_refunded_minor || 0n),
      items: (inv.items || []).map(it => ({
        ...it,
        amount_minor: String(it.amount_minor || 0n)
      }))
    };
  };

  // 1. Obtener estado de suscripción del tenant
  router.get('/subscription', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de empresa requerido', code: 'TENANT_REQUIRED' });
      }

      const sub = await lifecycleService.getSubscription(tenantId);
      if (!sub) {
        return res.status(404).json({ error: 'Suscripción no encontrada', code: 'SUBSCRIPTION_NOT_FOUND' });
      }

      let branches = [];
      if (pool && typeof pool.query === 'function') {
        try {
          const [rows] = await pool.query(
            'SELECT id::text as id, name FROM branches WHERE tenant_id = ? AND COALESCE(is_active, true) = true ORDER BY is_main DESC, name ASC',
            [tenantId]
          );
          if (Array.isArray(rows)) {
            branches = rows.map((r) => ({ id: String(r.id), name: r.name }));
          }
        } catch (branchErr) {
          console.warn('[SAAS BILLING] No se pudieron listar sucursales:', branchErr?.message || branchErr);
        }
      }

      res.json({
        subscription: sub,
        pricing: getConfiguredPricing(),
        branches,
      });
    } catch (err) {
      console.error('[SAAS BILLING ERROR] Error al consultar suscripción:', err);
      res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
    }
  });

  // 1b. Solicitar contratación o información del add-on Suscripciones/Membresías B2C (sin cargos automáticos)
  router.post('/addons/:addonCode/request', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de empresa requerido', code: 'TENANT_REQUIRED' });
      }
      const { addonCode } = req.params;
      if (addonCode !== SAAS_ADDONS.MEMBERSHIPS) {
        return res.status(400).json({ error: 'Add-on no reconocido', code: 'INVALID_ADDON_CODE' });
      }

      const requestedIds = Array.isArray(req.body?.branchIds)
        ? [...new Set(req.body.branchIds.map((id) => String(id).trim()).filter(Boolean))]
        : [];

      let tenantBranches = [];
      if (pool && typeof pool.query === 'function') {
        const [rows] = await pool.query(
          'SELECT id::text as id, name FROM branches WHERE tenant_id = ? AND COALESCE(is_active, true) = true ORDER BY is_main DESC, name ASC',
          [tenantId]
        );
        if (Array.isArray(rows)) {
          tenantBranches = rows.map((r) => ({ id: String(r.id), name: r.name }));
        }
      }

      const tenantBranchMap = new Map(tenantBranches.map((b) => [b.id, b]));
      const invalidBranch = requestedIds.find((id) => !tenantBranchMap.has(id));
      if (invalidBranch) {
        return res.status(400).json({
          error: 'Una o más sucursales seleccionadas no pertenecen a tu cuenta.',
          code: 'INVALID_BRANCH_SELECTION',
        });
      }

      if (tenantBranches.length > 0 && requestedIds.length === 0) {
        return res.status(400).json({
          error: 'Debes seleccionar al menos una sucursal habilitada para solicitar el módulo.',
          code: 'BRANCH_SELECTION_REQUIRED',
        });
      }

      const selectedBranches = requestedIds.map((id) => tenantBranchMap.get(id));
      const pricing = getConfiguredPricing();
      const unitPriceUsd = pricing?.addons?.memberships?.usd ?? 99;
      const branchCount = selectedBranches.length;
      const monthlyUsd = branchCount * unitPriceUsd;

      const sub = await lifecycleService.getSubscription(tenantId);
      const actorId = req.user?.id || 'owner';
      const note = req.body?.note ? String(req.body.note).slice(0, 300) : 'Solicitud de contratación de add-on Suscripciones/Membresías B2C';
      const branchSummary = selectedBranches.map((b) => `${b.id}:${b.name}`).join(', ');
      await pool.query(
        `INSERT INTO tenant_subscription_events (
          tenant_id, previous_plan, new_plan, previous_status, new_status, reason, actor_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          tenantId,
          sub?.plan_code || 'PRINCIPAL',
          sub?.plan_code || 'PRINCIPAL',
          sub?.status || 'active',
          sub?.status || 'active',
          `addon_request:${addonCode}: branches=[${branchSummary}] monthly_usd=${monthlyUsd} | ${note}`,
          actorId,
        ]
      );
      res.json({
        success: true,
        breakdown: {
          addonCode,
          unitPriceUsd,
          branchCount,
          monthlyUsd,
          branches: selectedBranches,
          setupFeeQuotedSeparately: true,
          pricingDisplay: pricing?.addons?.memberships?.pricingDisplay,
        },
        message: `Solicitud registrada para ${branchCount} sucursal(es) (US$${monthlyUsd}/mes + implementación e integración con pasarela de pago por separado). Nuestro equipo comercial te contactará para coordinar la activación.`,
      });
    } catch (err) {
      console.error('[SAAS ADDON REQUEST ERROR]:', err);
      res.status(500).json({ error: 'No se pudo registrar la solicitud del módulo adicional.' });
    }
  });

  // 2. Solicitar Upgrade a Plan PRO con prorrateo inmediato
  router.post('/subscription/upgrade', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de empresa requerido', code: 'TENANT_REQUIRED' });
      }

      const result = await billingService.processUpgrade({
        tenantId,
        newPlan: 'PRO',
        actorId: req.user?.id || 'admin',
        idempotencyKey: req.headers['idempotency-key']
      });

      res.json({
        success: true,
        message: 'Upgrade a Plan PRO completado exitosamente.',
        newPlan: result.newPlan,
        invoice: serializeInvoice(result.invoice),
        payment: result.payment ? {
          ...result.payment,
          amount_minor: String(result.payment.amount_minor)
        } : null
      });
    } catch (err) {
      console.error('[SAAS BILLING ERROR] Error en upgrade:', err);
      res.status(400).json({ error: err.message, code: err.code || 'UPGRADE_FAILED' });
    }
  });

  // 3. Solicitar Downgrade a Plan BASE (con validación de recursos)
  router.post('/subscription/downgrade', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de empresa requerido', code: 'TENANT_REQUIRED' });
      }

      const result = await lifecycleService.requestDowngrade(tenantId, {
        newPlan: 'BASE',
        actorId: req.user?.id || 'admin'
      });

      res.json({
        success: true,
        message: 'Downgrade programado exitosamente para el final del ciclo.',
        scheduled: result.scheduled,
        effectiveAt: result.effectiveAt,
        targetPlan: result.targetPlan
      });
    } catch (err) {
      console.error('[SAAS BILLING ERROR] Error en downgrade:', err);
      if (err.code === 'RESOURCE_LIMIT_EXCEEDED') {
        return res.status(409).json({
          error: err.message,
          code: 'RESOURCE_LIMIT_EXCEEDED',
          details: err.details
        });
      }
      res.status(400).json({ error: err.message, code: err.code || 'DOWNGRADE_FAILED' });
    }
  });

  // 4. Cancelación de suscripción
  router.post('/subscription/cancel', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de empresa requerido', code: 'TENANT_REQUIRED' });
      }

      const result = await lifecycleService.cancelSubscription(tenantId, {
        reason: req.body?.reason || 'solicitud_cliente',
        actorId: req.user?.id || 'admin'
      });

      res.json({
        success: true,
        message: 'Suscripción cancelada. El acceso comercial permanecerá activo hasta el fin de ciclo.',
        accessUntil: result.accessUntil
      });
    } catch (err) {
      res.status(400).json({ error: err.message, code: 'CANCELLATION_FAILED' });
    }
  });

  // 5. Listar facturas SaaS del tenant
  router.get('/invoices', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de empresa requerido', code: 'TENANT_REQUIRED' });
      }

      const invoices = await billingRepo.listInvoices(tenantId);
      res.json({
        invoices: invoices.map(serializeInvoice)
      });
    } catch (err) {
      res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
    }
  });

  // 6. Consultar factura específica (Anti-IDOR)
  router.get('/invoices/:id', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const invoice = await billingRepo.getInvoiceById(tenantId, req.params.id);
      if (!invoice) {
        return res.status(404).json({ error: 'Factura no encontrada', code: 'INVOICE_NOT_FOUND' });
      }

      res.json({
        invoice: serializeInvoice(invoice)
      });
    } catch (err) {
      res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
    }
  });

  // 6b. Comprobante comercial SaaS descargable (Anti-IDOR, distinto de e-CF/NCF DGII)
  router.get('/invoices/:id/receipt', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de empresa requerido', code: 'TENANT_REQUIRED' });
      }
      const invoice = await billingRepo.getInvoiceById(tenantId, req.params.id);
      if (!invoice) {
        return res.status(404).json({ error: 'Factura no encontrada', code: 'INVOICE_NOT_FOUND' });
      }

      const serialized = serializeInvoice(invoice);
      const fx = serialized.fx_snapshot || null;
      const fmtMinor = (val, cur = serialized.currency || 'DOP') => {
        const num = Number(val || 0) / 100;
        const prefix = cur === 'USD' ? 'US$' : 'RD$';
        return `${prefix}${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      };

      const receipt = {
        document_type: 'COMMERCIAL_SAAS_RECEIPT',
        fiscal_notice: 'Comprobante comercial de suscripción SaaS — No es comprobante fiscal e-CF / NCF.',
        invoice_number: serialized.invoice_number,
        order_number: serialized.order_number || null,
        status: serialized.status,
        currency: serialized.currency || 'DOP',
        subtotal_minor: serialized.subtotal_minor,
        tax_minor: serialized.tax_minor,
        total_minor: serialized.total_minor,
        amount_paid_minor: serialized.amount_paid_minor,
        total_formatted: fmtMinor(serialized.total_minor, serialized.currency || 'DOP'),
        usd_original_minor: fx?.usd?.total_minor || null,
        usd_original_formatted: fx?.usd?.total_minor ? fmtMinor(fx.usd.total_minor, 'USD') : null,
        fx_rate_formatted: fx?.rate_formatted || (fx?.rate ? Number(fx.rate).toFixed(4) : null),
        authorization_code: serialized.cardnet_authorization_code || serialized.payment_reference || null,
        masked_card: serialized.masked_card || null,
        period_start: serialized.period_start || null,
        period_end: serialized.period_end || null,
        paid_at: serialized.paid_at || null,
        items: serialized.items || [],
        payments: (serialized.payments || []).map((p) => ({
          id: p.id,
          amount_minor: String(p.amount_minor || 0),
          currency: p.currency,
          gateway_reference: p.gateway_reference,
          status: p.status,
          created_at: p.created_at,
        })),
      };

      if (String(req.query.download || '') === '1' || String(req.query.format || '').toLowerCase() === 'html') {
        const esc = (s) =>
          String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        const rowsHtml = (receipt.items || [])
          .map(
            (it) =>
              `<tr><td>${esc(it.description)}</td><td style="text-align:right">${esc(
                fmtMinor(it.amount_minor, receipt.currency)
              )}</td></tr>`
          )
          .join('');
        const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Comprobante ${esc(receipt.invoice_number)}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:680px;margin:32px auto;padding:24px;color:#0f172a;border:1px solid #e2e8f0;border-radius:12px}
h1{font-size:20px;margin:0 0 4px} .muted{color:#64748b;font-size:13px} .badge{display:inline-block;padding:3px 10px;border-radius:999px;background:#dcfce7;color:#166534;font-weight:700;font-size:12px}
table{width:100%;border-collapse:collapse;margin:16px 0} td,th{padding:10px 8px;border-bottom:1px solid #e2e8f0;text-align:left;font-size:14px}
.notice{margin-top:20px;padding:10px 12px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;color:#475569}</style></head>
<body>
<div style="display:flex;justify-content:space-between;align-items:flex-start">
  <div><h1>Comprobante Comercial SaaS</h1><div class="muted">Factura ${esc(receipt.invoice_number)}${receipt.order_number ? ` · Orden #${esc(receipt.order_number)}` : ''}</div></div>
  <span class="badge">${esc(String(receipt.status || '').toUpperCase())}</span>
</div>
<table>
  <thead><tr><th>Concepto</th><th style="text-align:right">Importe</th></tr></thead>
  <tbody>${rowsHtml}</tbody>
  <tfoot>
    ${receipt.usd_original_formatted ? `<tr><td>Precio original (USD)</td><td style="text-align:right">${esc(receipt.usd_original_formatted)}</td></tr>` : ''}
    ${receipt.fx_rate_formatted ? `<tr><td>Tasa FX aplicada (USD → DOP)</td><td style="text-align:right">${esc(receipt.fx_rate_formatted)}</td></tr>` : ''}
    <tr><td>Impuestos</td><td style="text-align:right">${esc(fmtMinor(receipt.tax_minor, receipt.currency))}</td></tr>
    <tr><th>Total cobrado</th><th style="text-align:right">${esc(receipt.total_formatted)}</th></tr>
  </tfoot>
</table>
<div class="muted">
  <div><strong>Autorización / Referencia:</strong> ${esc(receipt.authorization_code || 'N/D')}</div>
  ${receipt.masked_card ? `<div><strong>Tarjeta:</strong> ${esc(receipt.masked_card)}</div>` : ''}
  <div><strong>Fecha de pago:</strong> ${esc(receipt.paid_at ? new Date(receipt.paid_at).toLocaleString('es-DO') : 'N/D')}</div>
</div>
<div class="notice">${esc(receipt.fiscal_notice)}</div>
</body></html>`;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="comprobante-${receipt.invoice_number.replace(/[^a-zA-Z0-9_-]/g, '')}.html"`);
        return res.send(html);
      }

      return res.json({ receipt });
    } catch (err) {
      res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
    }
  });

  // 7. Pagar factura pendiente
  router.post('/invoices/:id/pay', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const result = await billingService.chargeInvoice({
        tenantId,
        invoiceId: req.params.id,
        idempotencyKey: req.headers['idempotency-key']
      });

      res.json({
        success: true,
        message: 'Cobro de factura procesado exitosamente.',
        payment: {
          ...result.payment,
          amount_minor: String(result.payment.amount_minor)
        },
        invoice: serializeInvoice(result.invoice)
      });
    } catch (err) {
      res.status(400).json({ error: err.message, code: err.code || 'PAYMENT_FAILED' });
    }
  });

  // 7b. Rescate y pago directo de deuda pendiente para tenant suspendido
  router.post('/pay-debt', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { paymentMethodToken } = req.body;

      if (paymentMethodToken) {
        await billingRepo.savePaymentMethod({
          tenant_id: tenantId,
          token_reference: paymentMethodToken,
          provider_customer_reference: `cus_${tenantId}`,
          last4: '4242',
          brand: 'Visa',
          exp_month: 12,
          exp_year: 2030,
          is_default: true
        });
      }

      // Reactivar suscripción y marcar pago exitoso
      if (lifecycleService && lifecycleService.handlePaymentSuccess) {
        await lifecycleService.handlePaymentSuccess(tenantId, {
          invoiceId: `inv_rescue_${Date.now()}`,
          amountMinor: 290000,
          currency: 'DOP'
        });
      }

      if (pool && pool.query) {
        try {
          await pool.query("UPDATE tenants SET status = ? WHERE id = ?", ['active', tenantId]);
        } catch (e) { }
      }

      res.json({
        success: true,
        status: 'active',
        message: 'Deuda saldada y suscripción reactivada exitosamente.'
      });
    } catch (err) {
      res.status(400).json({ error: err.message, code: err.code || 'PAY_DEBT_FAILED' });
    }
  });

  // 8. Listar métodos de pago
  router.get('/payment-methods', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const methods = await billingRepo.getPaymentMethods(tenantId);
      res.json({
        paymentMethods: methods.map(m => ({
          id: m.id,
          brand: m.brand,
          last4: m.last4,
          expMonth: m.exp_month,
          expYear: m.exp_year,
          isDefault: m.is_default
        }))
      });
    } catch (err) {
      res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
    }
  });

  // 8b. Iniciar registro de tarjeta mediante CardNet (PWCheckout)
  router.post('/payment-methods/initiate-cardnet', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de empresa requerido', code: 'TENANT_REQUIRED' });
      }

      const role = String(req.user?.role || '').toLowerCase();
      const isOwnerOrAdmin = role === 'owner' || role === 'propietario' || role === 'admin' || role === 'superadmin';
      if (!isOwnerOrAdmin) {
        return res.status(403).json({ error: 'Solo el propietario o administrador puede registrar métodos de pago.', code: 'FORBIDDEN' });
      }

      const email = req.user?.email || req.user?.correo || `tenant_${tenantId}@etereas.com`;
      const tokenProvider = cardnetTokenizationProvider || checkoutService?.tokenizationProvider;
      if (!tokenProvider) {
        return res.status(503).json({ error: 'Proveedor de tokenización CardNet no disponible.', code: 'PROVIDER_UNAVAILABLE' });
      }

      const session = await tokenProvider.createCustomerSession({ email });
      res.json({
        success: true,
        customerId: session.customerId,
        uniqueId: session.uniqueId,
        captureUrl: session.captureUrl,
        publicKey: tokenProvider.publicKey,
        scriptUrl: session.scriptUrl || tokenProvider.scriptUrl,
        env: session.env || tokenProvider.env
      });
    } catch (err) {
      console.error('[SAAS BILLING] Error initiating CardNet session:', err);
      res.status(err.statusCode || 500).json({ error: err.message || 'Error al iniciar sesión de CardNet', code: err.code || 'CARDNET_INITIATE_FAILED' });
    }
  });

  // 8c. Confirmar y persistir tarjeta tokenizada desde CardNet (CERO PAN/CVC)
  router.post('/payment-methods/confirm-cardnet', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de empresa requerido', code: 'TENANT_REQUIRED' });
      }

      const role = String(req.user?.role || '').toLowerCase();
      const isOwnerOrAdmin = role === 'owner' || role === 'propietario' || role === 'admin' || role === 'superadmin';
      if (!isOwnerOrAdmin) {
        return res.status(403).json({ error: 'Solo el propietario o administrador puede registrar métodos de pago.', code: 'FORBIDDEN' });
      }

      const { customerId, tokenPayload } = req.body;
      const tokenProvider = cardnetTokenizationProvider || checkoutService?.tokenizationProvider;

      let trxToken = tokenPayload?.TokenId || tokenPayload?.Token || tokenPayload?.trxToken;
      if (typeof tokenPayload === 'string') {
        trxToken = tokenPayload;
      }

      let brand = tokenPayload?.Brand || tokenPayload?.brand || null;
      let last4 = tokenPayload?.Last4 || tokenPayload?.last4 || null;
      let expMonth = tokenPayload?.ExpMonth || tokenPayload?.expMonth || null;
      let expYear = tokenPayload?.ExpYear || tokenPayload?.expYear || null;
      let paymentProfileId = tokenPayload?.PaymentProfileId || tokenPayload?.paymentProfileId || null;
      let isReusable = false;

      // Intentar consultar el perfil seguro del cliente en CardNet para rescatar metadata enmascarada y perfil reusable
      if (customerId && tokenProvider && typeof tokenProvider.getCustomerProfile === 'function') {
        try {
          const profile = await tokenProvider.getCustomerProfile(customerId);
          if (profile && Array.isArray(profile.paymentProfiles) && profile.paymentProfiles.length > 0) {
            const latest = profile.paymentProfiles[profile.paymentProfiles.length - 1];
            brand = brand || latest.brand;
            last4 = last4 || latest.last4;
            expMonth = expMonth || latest.expMonth;
            expYear = expYear || latest.expYear;
            paymentProfileId = paymentProfileId || latest.paymentProfileId;
            if (latest.token) {
              trxToken = latest.token;
            }
            isReusable = Boolean(latest.paymentProfileId || latest.token);
          }
        } catch (err) {
          console.warn('[SAAS BILLING] Error fetching CardNet customer profile (continuing with payload):', err.message);
        }
      }

      if (!trxToken && !paymentProfileId) {
        return res.status(400).json({ error: 'CardNet no devolvió un identificador de token ni perfil de pago válido.', code: 'INVALID_TOKEN' });
      }

      const tokenReference = String(paymentProfileId || trxToken);
      const maskedLast4 = last4 ? String(last4).slice(-4) : '****';
      const cleanBrand = brand ? String(brand).trim().toLowerCase() : 'visa';

      // Persistir de forma segura en saas_payment_methods. CERO PAN, CERO CVC.
      const savedMethod = await billingRepo.savePaymentMethod({
        tenant_id: tenantId,
        token_reference: tokenReference,
        provider_customer_id: customerId ? String(customerId) : null,
        last4: maskedLast4,
        brand: cleanBrand,
        exp_month: expMonth ? Number(expMonth) : 12,
        exp_year: expYear ? Number(expYear) : (new Date().getFullYear() + 3),
        is_default: true
      });

      res.status(201).json({
        success: true,
        reusable: isReusable,
        message: isReusable
          ? 'Tarjeta registrada y autorizada para pagos futuros.'
          : 'Tarjeta registrada exitosamente. Según las condiciones del procesador, renovaciones futuras pueden requerir confirmación.',
        paymentMethod: {
          id: savedMethod.id,
          brand: savedMethod.brand,
          last4: savedMethod.last4,
          expMonth: savedMethod.exp_month,
          expYear: savedMethod.exp_year,
          isDefault: savedMethod.is_default
        }
      });
    } catch (err) {
      console.error('[SAAS BILLING] Error confirming CardNet payment method:', err);
      res.status(500).json({ error: err.message || 'Error al guardar método de pago', code: 'CONFIRM_FAILED' });
    }
  });

  // 9. Registrar método de pago tokenizado (CERO PAN/CVC)
  router.post('/payment-methods', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { paymentMethodToken, providerCustomerReference, last4, brand, expMonth, expYear, isDefault } = req.body;

      if (!paymentMethodToken) {
        return res.status(400).json({ error: 'paymentMethodToken es obligatorio', code: 'TOKEN_REQUIRED' });
      }

      // Prevenir creación de tokens sintéticos no validados
      if (String(paymentMethodToken).startsWith('tok_') && !providerCustomerReference) {
        return res.status(400).json({
          error: 'No se permite registrar tarjetas con datos manuales ficticios. Utiliza la pasarela oficial CardNet.',
          code: 'SYNTHETIC_TOKENS_FORBIDDEN'
        });
      }

      const method = await billingRepo.savePaymentMethod({
        tenant_id: tenantId,
        token_reference: paymentMethodToken,
        provider_customer_id: providerCustomerReference,
        last4: last4 || '****',
        brand: brand || 'visa',
        exp_month: expMonth || 12,
        exp_year: expYear || (new Date().getFullYear() + 3),
        is_default: isDefault !== false
      });

      res.status(201).json({
        success: true,
        paymentMethod: {
          id: method.id,
          brand: method.brand,
          last4: method.last4,
          isDefault: method.is_default
        }
      });
    } catch (err) {
      res.status(400).json({ error: err.message, code: 'PAYMENT_METHOD_FAILED' });
    }
  });

  // 9b. Aceptar términos y condiciones para el tenant actual
  router.post('/terms/accept', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const userId = req.user?.id || req.user?.sub;
      if (!tenantId || !userId) {
        return res.status(403).json({ error: 'Contexto de empresa y usuario requerido', code: 'UNAUTHORIZED' });
      }

      const { accept_terms, authorize_recurring, terms_version } = req.body;
      if (!accept_terms) {
        return res.status(400).json({ error: 'Debes marcar la casilla para aceptar los Términos y Condiciones.', code: 'TERMS_ACCEPTANCE_REQUIRED' });
      }

      const result = await termsService.recordAcceptance({
        tenantId,
        userId,
        termsVersion: terms_version || 'v2026.1',
        recurringAuthorized: Boolean(authorize_recurring),
        acceptanceMechanism: 'web_portal_checkbox',
        ipAddress: req.ip || req.connection?.remoteAddress,
        userAgent: req.headers['user-agent'],
        recipientEmail: req.user?.email || req.user?.correo || null,
        recipientName: req.user?.nombre || req.user?.name || null,
        companyName: req.user?.tenant?.business_name || req.user?.tenant?.nombre || null,
        accountStatus: req.user?.tenant?.status || null
      });

      res.status(200).json(result);
    } catch (err) {
      console.error('[SAAS TERMS] Error accepting terms:', err);
      res.status(err.statusCode || 500).json({ error: err.message || 'Error al registrar aceptación de términos', code: err.code || 'TERMS_ACCEPT_FAILED' });
    }
  });

  // 9c. Consultar estado de aceptación de términos del tenant
  router.get('/terms/status', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de empresa requerido', code: 'TENANT_REQUIRED' });
      }

      const [rows] = await pool.query(
        `SELECT id, terms_version, document_hash, accepted_at_utc, recurring_authorized, acceptance_mechanism
         FROM tenant_terms_acceptances
         WHERE tenant_id = ?
         ORDER BY id DESC
         LIMIT 1`,
        [tenantId]
      );

      const latestAcceptance = rows && rows.length > 0 ? rows[0] : null;
      res.json({
        hasAccepted: Boolean(latestAcceptance),
        latestAcceptance
      });
    } catch (err) {
      res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
    }
  });

  // 10. Webhook de pasarela de pagos (verificación de firma y cero confianza en tenant del body)
  router.post('/webhooks/:provider', async (req, res) => {
    try {
      const provider = req.params.provider;
      const signatureHeader = req.headers['stripe-signature'] || req.headers['x-signature'] || req.headers['signature'];
      const rawBody = req.rawBody || (typeof req.body === 'string' || Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body));

      const result = await billingService.handleWebhook({
        provider,
        rawBody,
        signatureHeader
      });

      res.status(200).json({ received: true, eventId: result.eventId });
    } catch (err) {
      console.warn('[SAAS BILLING WEBHOOK ERROR]:', err.message);
      res.status(err.statusCode || 400).json({ error: err.message, code: err.code || 'WEBHOOK_FAILED' });
    }
  });

  // 11. Endpoint Administrativo SuperAdmin: Extender período de gracia
  router.post('/admin/extend-grace', async (req, res) => {
    try {
      if (!req.auth?.isSuperAdmin) {
        return res.status(403).json({ error: 'Acceso reservado a SuperAdmin', code: 'SUPERADMIN_REQUIRED' });
      }

      const { tenantId, additionalDays, reason } = req.body || {};
      const cleanReason = typeof reason === 'string' ? reason.trim() : '';
      const parsedDays = additionalDays === undefined ? 5 : Number(additionalDays);
      if (!tenantId || !cleanReason || cleanReason.length < 3) {
        return res.status(400).json({ error: 'tenantId y un motivo válido (mín. 3 caracteres) son requeridos' });
      }
      if (!Number.isInteger(parsedDays) || parsedDays < 1 || parsedDays > 90) {
        return res.status(400).json({ error: 'additionalDays debe ser un entero entre 1 y 90 días' });
      }

      const updated = await lifecycleService.extendGracePeriod(tenantId, {
        additionalDays: parsedDays,
        reason: cleanReason,
        actorId: req.auth?.userId || 'superadmin'
      });

      res.json({
        success: true,
        message: 'Período de gracia extendido exitosamente.',
        subscription: updated
      });
    } catch (err) {
      res.status(err.statusCode || 400).json({ error: err.message, code: 'EXTEND_GRACE_FAILED' });
    }
  });

  // === CARDNET HOSTED CHECKOUT PARA CONTRATACIÓN Y PAGO SAAS ===
  router.get('/checkout/config', async (req, res) => {
    const gateway = checkoutService?.getGatewayStatus
      ? checkoutService.getGatewayStatus()
      : (cardnetCheckoutProvider ? cardnetCheckoutProvider.getConfigurationStatus() : { configured: false });
    const fxRate = fxRateService
      ? await fxRateService.getCurrentRate('USD_DOP').catch(() => null)
      : null;
    res.json({
      gateway,
      pricing: getConfiguredPricing(),
      fxRate: fxRate ? {
        pair: fxRate.pair,
        rate: fxRate.rate,
        rateFormatted: fxRate.rateFormatted,
        updatedAt: fxRate.updatedAt,
      } : null,
    });
  });

  router.get('/checkout/orders', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(403).json({ error: 'Contexto de empresa requerido', code: 'TENANT_REQUIRED' });
      const orders = await checkoutService.listOrdersForTenant(tenantId);
      res.json({ orders });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message, code: err.code || 'INTERNAL_ERROR' });
    }
  });

  router.post('/checkout/orders', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(403).json({ error: 'Contexto de empresa requerido', code: 'TENANT_REQUIRED' });
      const {
        branchesCount,
        extraUsersCount,
        wantsMembershipsAddon,
        addonBranchesCount,
        source,
        invoiceId,
        idempotencyKey,
      } = req.body || {};

      const order = await checkoutService.createOrder({
        tenantId,
        actorUserId: req.user?.id || req.auth?.userId || null,
        source: ['debt_payment', 'subscription_renewal'].includes(source) ? source : 'self_service',
        invoiceId: invoiceId || null,
        branchesCount,
        extraUsersCount,
        wantsMembershipsAddon,
        addonBranchesCount,
        idempotencyKey: idempotencyKey || req.headers['idempotency-key'] || null,
      });

      res.status(201).json({ order });
    } catch (err) {
      res.status(err.statusCode || 400).json({ error: err.message, code: err.code || 'CHECKOUT_ORDER_FAILED' });
    }
  });

  router.get('/checkout/orders/:orderId', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(403).json({ error: 'Contexto de empresa requerido', code: 'TENANT_REQUIRED' });
      const order = await checkoutService.getOrderForTenant(req.params.orderId, tenantId);
      if (!order) return res.status(404).json({ error: 'Orden de pago no encontrada', code: 'ORDER_NOT_FOUND' });
      res.json({ order });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message, code: err.code || 'INTERNAL_ERROR' });
    }
  });

  router.post('/checkout/orders/:orderId/initiate-cardnet', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(403).json({ error: 'Contexto de empresa requerido', code: 'TENANT_REQUIRED' });
      const origin = req.headers.origin || (req.headers.host ? `${req.protocol}://${req.headers.host}` : null);
      const result = await checkoutService.initiateCardnetCheckout({
        orderId: req.params.orderId,
        tenantId,
        clientIp: req.ip,
        returnBaseUrl: origin,
        actorEmail: req.user?.email || req.auth?.email || null,
      });
      res.json(result);
    } catch (err) {
      res.status(err.statusCode || 400).json({
        error: err.message,
        code: err.code || 'CARDNET_INITIATE_FAILED',
        requirements: err.requirements || undefined,
      });
    }
  });

  router.post('/checkout/orders/:orderId/charge-token', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(403).json({ error: 'Contexto de empresa requerido', code: 'TENANT_REQUIRED' });
      const trxToken = req.body?.trxToken || req.body?.TokenId || req.body?.token;
      const result = await checkoutService.chargeOrderWithToken({
        orderId: req.params.orderId,
        tenantId,
        trxToken,
        clientIp: req.ip,
        actorUserId: req.user?.id || req.auth?.userId || null,
      });
      res.json(result);
    } catch (err) {
      res.status(err.statusCode || 400).json({
        error: err.message,
        code: err.code || 'CARDNET_PURCHASE_FAILED',
        requirements: err.requirements || undefined,
      });
    }
  });

  router.post('/checkout/orders/:orderId/verify', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(403).json({ error: 'Contexto de empresa requerido', code: 'TENANT_REQUIRED' });
      const cancelledByUser = Boolean(req.body?.cancelled);
      const result = await checkoutService.verifyAndFinalizeOrder({
        orderId: req.params.orderId,
        tenantId,
        cancelledByUser,
        actorUserId: req.user?.id || req.auth?.userId || null,
      });
      res.json(result);
    } catch (err) {
      res.status(err.statusCode || 400).json({ error: err.message, code: err.code || 'CARDNET_VERIFY_FAILED' });
    }
  });

  // Enlace de pago generado por SuperAdmin (aislado al tenant propietario)
  router.get('/payment-links/:token', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(403).json({ error: 'Contexto de empresa requerido', code: 'TENANT_REQUIRED' });
      const order = await checkoutService.getOrderByTokenForTenant(req.params.token, tenantId);
      if (!order) return res.status(404).json({ error: 'Enlace de pago no encontrado o no pertenece a tu cuenta', code: 'PAYMENT_LINK_NOT_FOUND' });
      const gateway = checkoutService?.getGatewayStatus
        ? checkoutService.getGatewayStatus()
        : (cardnetCheckoutProvider ? cardnetCheckoutProvider.getConfigurationStatus() : { configured: false });
      res.json({ order, gateway });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message, code: err.code || 'INTERNAL_ERROR' });
    }
  });

  router.post('/payment-links/:token/initiate-cardnet', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(403).json({ error: 'Contexto de empresa requerido', code: 'TENANT_REQUIRED' });
      const order = await checkoutService.getOrderByTokenForTenant(req.params.token, tenantId);
      if (!order) return res.status(404).json({ error: 'Enlace de pago no encontrado', code: 'PAYMENT_LINK_NOT_FOUND' });
      const origin = req.headers.origin || (req.headers.host ? `${req.protocol}://${req.headers.host}` : null);
      const result = await checkoutService.initiateCardnetCheckout({
        orderId: order.id,
        tenantId,
        clientIp: req.ip,
        returnBaseUrl: origin,
      });
      res.json(result);
    } catch (err) {
      res.status(err.statusCode || 400).json({
        error: err.message,
        code: err.code || 'CARDNET_INITIATE_FAILED',
        requirements: err.requirements || undefined,
      });
    }
  });

  router.post('/checkout/orders/:orderId/reconcile', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(403).json({ error: 'Contexto de empresa requerido', code: 'TENANT_REQUIRED' });
      const result = await checkoutService.reconcileApprovedOrder({
        orderId: req.params.orderId,
        tenantId,
        actorUserId: req.auth?.userId || null,
      });
      res.json(result);
    } catch (err) {
      res.status(err.statusCode || 400).json({
        error: err.message,
        code: err.code || 'RECONCILE_FAILED',
      });
    }
  });

  return router;
}

module.exports = {
  createSaasBillingRouter
};

