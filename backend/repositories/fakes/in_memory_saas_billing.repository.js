/**
 * Repositorio en Memoria para Facturación SaaS (InMemorySaasBillingRepository)
 * Aislamiento estricto multi-tenant por Map, secuencias atómicas por tenant y soporte completo para reembolsos.
 */

const crypto = require('crypto');
const { SaasBillingRepository } = require('../saas_billing.repository');

class InMemorySaasBillingRepository extends SaasBillingRepository {
  constructor() {
    super();
    this.counters = new Map(); // `${tenantId}:${year}` -> number
    this.paymentMethods = new Map(); // id -> method
    this.invoices = new Map(); // id -> invoice
    this.invoiceItems = new Map(); // invoiceId -> [items]
    this.payments = new Map(); // id -> payment
    this.refunds = new Map(); // id -> refund
    this.billingEvents = new Map(); // `${tenantId}:${key}` -> event
    this.webhookEvents = new Map(); // `${provider}:${eventId}` -> event
  }

  async getNextInvoiceNumber(tenantId, year = new Date().getUTCFullYear()) {
    if (!tenantId) throw new Error('tenantId es obligatorio para getNextInvoiceNumber');
    const counterKey = `${tenantId}:${year}`;
    const current = this.counters.get(counterKey) || 0;
    const next = current + 1;
    this.counters.set(counterKey, next);
    const padded = String(next).padStart(5, '0');
    return `INV-${year}-${padded}`;
  }

  async savePaymentMethod(method) {
    if (!method.tenant_id) throw new Error('tenant_id es obligatorio en savePaymentMethod');
    const id = method.id || `pm_${crypto.randomBytes(8).toString('hex')}`;
    const record = {
      id,
      tenant_id: method.tenant_id,
      gateway_type: method.gateway_type || 'fake_gateway',
      token_reference: method.token_reference,
      provider_customer_id: method.provider_customer_id,
      last4: method.last4 || '4242',
      brand: method.brand || 'visa',
      exp_month: method.exp_month || 12,
      exp_year: method.exp_year || 2028,
      is_default: Boolean(method.is_default),
      created_at: method.created_at || new Date().toISOString()
    };

    // Si es default, desmarcar los anteriores del mismo tenant
    if (record.is_default) {
      for (const [mId, m] of this.paymentMethods.entries()) {
        if (m.tenant_id === method.tenant_id) {
          m.is_default = false;
        }
      }
    }

    this.paymentMethods.set(id, record);
    return { ...record };
  }

  async getPaymentMethods(tenantId) {
    return Array.from(this.paymentMethods.values())
      .filter(m => m.tenant_id === tenantId);
  }

  async getDefaultPaymentMethod(tenantId) {
    const list = await this.getPaymentMethods(tenantId);
    return list.find(m => m.is_default) || list[0] || null;
  }

  async setDefaultPaymentMethod(tenantId, paymentMethodId) {
    const method = this.paymentMethods.get(paymentMethodId);
    if (!method || method.tenant_id !== tenantId) return null;
    for (const m of this.paymentMethods.values()) {
      if (m.tenant_id === tenantId) {
        m.is_default = (m.id === paymentMethodId);
      }
    }
    return { ...method, is_default: true };
  }

  async deletePaymentMethod(tenantId, paymentMethodId) {
    const method = this.paymentMethods.get(paymentMethodId);
    if (!method || method.tenant_id !== tenantId) return false;
    this.paymentMethods.delete(paymentMethodId);
    return true;
  }

  async createInvoice(invoiceData, items = []) {
    if (!invoiceData.tenant_id) throw new Error('tenant_id es obligatorio en createInvoice');
    const id = invoiceData.id || `inv_${crypto.randomBytes(8).toString('hex')}`;
    const invoiceNumber = invoiceData.invoice_number || await this.getNextInvoiceNumber(invoiceData.tenant_id);

    const record = {
      id,
      tenant_id: invoiceData.tenant_id,
      invoice_number: invoiceNumber,
      subscription_id: invoiceData.subscription_id || null,
      plan_code: invoiceData.plan_code,
      billing_cycle: invoiceData.billing_cycle || 'monthly',
      price_book_version: invoiceData.price_book_version || 'v1_2026',
      period_start: invoiceData.period_start,
      period_end: invoiceData.period_end,
      subtotal_minor: BigInt(invoiceData.subtotal_minor || 0n),
      tax_minor: BigInt(invoiceData.tax_minor || 0n),
      total_minor: BigInt(invoiceData.total_minor || 0n),
      amount_paid_minor: BigInt(invoiceData.amount_paid_minor || 0n),
      amount_due_minor: BigInt(invoiceData.amount_due_minor || invoiceData.total_minor || 0n),
      amount_refunded_minor: BigInt(invoiceData.amount_refunded_minor || 0n),
      currency: String(invoiceData.currency || 'DOP').toUpperCase(),
      status: invoiceData.status || 'open',
      due_date: invoiceData.due_date || new Date().toISOString(),
      paid_at: invoiceData.paid_at || null,
      created_at: invoiceData.created_at || new Date().toISOString()
    };

    this.invoices.set(id, record);

    const storedItems = items.map((it, idx) => ({
      id: it.id || `item_${id}_${idx + 1}`,
      tenant_id: invoiceData.tenant_id,
      invoice_id: id,
      description: it.description || 'SaaS Line Item',
      item_type: it.item_type || 'PLAN_FEE',
      amount_minor: BigInt(it.amount_minor || 0n),
      created_at: new Date().toISOString()
    }));

    this.invoiceItems.set(id, storedItems);

    return { ...record, items: storedItems };
  }

  async getInvoiceById(tenantId, invoiceId) {
    const inv = this.invoices.get(invoiceId);
    if (!inv || inv.tenant_id !== tenantId) return null;
    const items = this.invoiceItems.get(invoiceId) || [];
    return { ...inv, items };
  }

  async listInvoices(tenantId) {
    const list = Array.from(this.invoices.values())
      .filter(i => i.tenant_id === tenantId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return list.map(inv => ({
      ...inv,
      items: this.invoiceItems.get(inv.id) || []
    }));
  }

  async updateInvoice(tenantId, invoiceId, updates) {
    const inv = this.invoices.get(invoiceId);
    if (!inv || inv.tenant_id !== tenantId) return null;

    if (updates.status !== undefined) inv.status = updates.status;
    if (updates.amount_paid_minor !== undefined) inv.amount_paid_minor = BigInt(updates.amount_paid_minor);
    if (updates.amount_due_minor !== undefined) inv.amount_due_minor = BigInt(updates.amount_due_minor);
    if (updates.amount_refunded_minor !== undefined) inv.amount_refunded_minor = BigInt(updates.amount_refunded_minor);
    if (updates.paid_at !== undefined) inv.paid_at = updates.paid_at;

    return { ...inv, items: this.invoiceItems.get(invoiceId) || [] };
  }

  async recordPayment(paymentData) {
    if (!paymentData.tenant_id) throw new Error('tenant_id es obligatorio en recordPayment');
    const id = paymentData.id || `pay_${crypto.randomBytes(8).toString('hex')}`;
    const record = {
      id,
      tenant_id: paymentData.tenant_id,
      invoice_id: paymentData.invoice_id,
      amount_minor: BigInt(paymentData.amount_minor),
      refunded_amount_minor: 0n,
      currency: String(paymentData.currency).toUpperCase(),
      gateway_reference: paymentData.gateway_reference || null,
      status: paymentData.status || 'success',
      failure_code: paymentData.failure_code || null,
      failure_message: paymentData.failure_message || null,
      idempotency_key: paymentData.idempotency_key,
      created_at: paymentData.created_at || new Date().toISOString()
    };

    this.payments.set(id, record);
    return { ...record };
  }

  async getPaymentById(tenantId, paymentId) {
    const pay = this.payments.get(paymentId);
    if (!pay || pay.tenant_id !== tenantId) return null;
    return { ...pay };
  }

  async listPaymentsByInvoice(tenantId, invoiceId) {
    return Array.from(this.payments.values())
      .filter(p => p.tenant_id === tenantId && p.invoice_id === invoiceId);
  }

  async updatePayment(tenantId, paymentId, updates) {
    const pay = this.payments.get(paymentId);
    if (!pay || pay.tenant_id !== tenantId) return null;

    if (updates.status !== undefined) pay.status = updates.status;
    if (updates.refunded_amount_minor !== undefined) pay.refunded_amount_minor = BigInt(updates.refunded_amount_minor);

    return { ...pay };
  }

  async recordRefund(refundData) {
    if (!refundData.tenant_id) throw new Error('tenant_id es obligatorio en recordRefund');
    const id = refundData.id || `ref_${crypto.randomBytes(8).toString('hex')}`;
    const record = {
      id,
      tenant_id: refundData.tenant_id,
      payment_id: refundData.payment_id,
      invoice_id: refundData.invoice_id,
      amount_minor: BigInt(refundData.amount_minor),
      currency: String(refundData.currency).toUpperCase(),
      status: refundData.status || 'success',
      reason: refundData.reason || 'solicitud_cliente',
      gateway_reference: refundData.gateway_reference || null,
      idempotency_key: refundData.idempotency_key,
      actor: refundData.actor || 'system',
      created_at: refundData.created_at || new Date().toISOString()
    };

    this.refunds.set(id, record);
    return { ...record };
  }

  async getRefundsByPayment(tenantId, paymentId) {
    return Array.from(this.refunds.values())
      .filter(r => r.tenant_id === tenantId && r.payment_id === paymentId);
  }

  async getTotalRefundedForPayment(tenantId, paymentId) {
    const list = await this.getRefundsByPayment(tenantId, paymentId);
    return list
      .filter(r => r.status === 'success')
      .reduce((sum, r) => sum + BigInt(r.amount_minor), 0n);
  }

  async recordBillingEvent({ tenant_id, event_type, payload = {}, idempotency_key }) {
    if (!tenant_id) throw new Error('tenant_id es obligatorio en recordBillingEvent');
    const key = idempotency_key || `evt_${crypto.randomBytes(8).toString('hex')}`;
    const fullKey = `${tenant_id}:${key}`;
    const record = {
      id: `bevt_${crypto.randomBytes(8).toString('hex')}`,
      tenant_id,
      event_type,
      payload,
      idempotency_key: key,
      created_at: new Date().toISOString()
    };
    this.billingEvents.set(fullKey, record);
    return { ...record };
  }

  async getBillingEventByIdempotencyKey(tenantId, idempotencyKey) {
    return this.billingEvents.get(`${tenantId}:${idempotencyKey}`) || null;
  }

  async recordWebhookEvent({ provider, event_id, tenant_id = null, event_type, payload_sanitized = {}, idempotency_key }) {
    const key = `${provider}:${event_id || idempotency_key}`;
    const record = {
      id: `wh_${crypto.randomBytes(8).toString('hex')}`,
      provider,
      event_id,
      tenant_id,
      event_type,
      payload_sanitized,
      status: 'received',
      idempotency_key: idempotency_key || event_id,
      created_at: new Date().toISOString()
    };
    this.webhookEvents.set(key, record);
    return { ...record };
  }

  async getWebhookEvent(provider, eventId) {
    return this.webhookEvents.get(`${provider}:${eventId}`) || null;
  }
}

module.exports = {
  InMemorySaasBillingRepository
};

