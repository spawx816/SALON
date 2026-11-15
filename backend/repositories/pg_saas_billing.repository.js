/**
 * Repositorio PostgreSQL de Facturación SaaS (Fase 2D + Conciliación CardNet)
 * Toda consulta tenant-owned incluye obligatoriamente tenant_id.
 */

const { SaasBillingRepository } = require('./saas_billing.repository');

function toBigInt(val, fallback = 0n) {
  if (val === null || val === undefined || val === '') return fallback;
  return BigInt(val);
}

function normalizeInvoiceRow(row, items = [], payments = [], order = null) {
  if (!row) return null;
  const latestPayment = payments[0] || null;
  const orderMeta = order && typeof order.metadata === 'object' ? order.metadata : {};
  const fxSnapshot = orderMeta?.fx_snapshot || null;

  return {
    ...row,
    currency: String(row.currency || 'DOP').trim().toUpperCase(),
    subtotal_minor: toBigInt(row.subtotal_minor),
    tax_minor: toBigInt(row.tax_minor),
    total_minor: toBigInt(row.total_minor),
    amount_paid_minor: toBigInt(row.amount_paid_minor),
    amount_due_minor: toBigInt(row.amount_due_minor),
    amount_refunded_minor: toBigInt(row.amount_refunded_minor),
    items: items.map((it) => ({
      ...it,
      amount_minor: toBigInt(it.amount_minor)
    })),
    payments: payments.map((p) => ({
      ...p,
      currency: String(p.currency || 'DOP').trim().toUpperCase(),
      amount_minor: toBigInt(p.amount_minor),
      refunded_amount_minor: toBigInt(p.refunded_amount_minor)
    })),
    payment_reference: latestPayment?.gateway_reference || order?.cardnet_authorization_code || null,
    order_number: order?.order_number || null,
    order_id: order?.id || null,
    cardnet_authorization_code: order?.cardnet_authorization_code || latestPayment?.gateway_reference || null,
    cardnet_response_code: order?.cardnet_response_code || null,
    masked_card: order?.masked_card || null,
    fx_snapshot: fxSnapshot
  };
}

class PgSaasBillingRepository extends SaasBillingRepository {
  constructor(pool) {
    super();
    if (!pool) throw new Error('pool es obligatorio en PgSaasBillingRepository');
    this.pool = pool;
  }

  async getNextInvoiceNumber(tenantId, year = new Date().getUTCFullYear()) {
    if (!tenantId) throw new Error('tenant_id es obligatorio en getNextInvoiceNumber');
    const [rows] = await this.pool.query(
      `INSERT INTO saas_invoice_counters (tenant_id, year, last_number)
       VALUES (?, ?, 1)
       ON CONFLICT (tenant_id, year)
       DO UPDATE SET last_number = saas_invoice_counters.last_number + 1
       RETURNING last_number`,
      [tenantId, Number(year)]
    );
    const seq = Number(rows[0]?.last_number || 1);
    return `INV-${year}-${String(seq).padStart(5, '0')}`;
  }

  async savePaymentMethod(methodData) {
    const tenantId = methodData.tenant_id;
    if (!tenantId) throw new Error('tenant_id es obligatorio en savePaymentMethod');
    if (!methodData.token_reference) throw new Error('token_reference es obligatorio en savePaymentMethod');

    const gatewayType = methodData.gateway_type || 'cardnet';
    const providerCustomerId = methodData.provider_customer_id || null;
    const last4 = methodData.last4 ? String(methodData.last4).slice(-4) : null;
    const brand = methodData.brand ? String(methodData.brand).trim().toUpperCase() : null;
    const expMonth = methodData.exp_month ? Number(methodData.exp_month) : null;
    const expYear = methodData.exp_year ? Number(methodData.exp_year) : null;

    // Buscar si ya existe por token_reference o por (provider_customer_id + last4) para evitar duplicados en reintentos
    const [existingRows] = await this.pool.query(
      `SELECT * FROM saas_payment_methods
       WHERE tenant_id = ?
         AND (
           token_reference = ?
           OR (? IS NOT NULL AND ? IS NOT NULL AND provider_customer_id = ? AND last4 = ?)
         )
       ORDER BY created_at DESC
       LIMIT 1`,
      [tenantId, String(methodData.token_reference), providerCustomerId, last4, providerCustomerId, last4]
    );

    const [countRows] = await this.pool.query(
      `SELECT COUNT(*)::int AS cnt FROM saas_payment_methods WHERE tenant_id = ?`,
      [tenantId]
    );
    const isFirst = Number(countRows[0]?.cnt || 0) === 0;
    const makeDefault = methodData.is_default !== undefined ? Boolean(methodData.is_default) : isFirst;

    if (makeDefault) {
      await this.pool.query(
        `UPDATE saas_payment_methods SET is_default = FALSE WHERE tenant_id = ?`,
        [tenantId]
      );
    }

    if (existingRows.length > 0) {
      const existing = existingRows[0];
      const [updated] = await this.pool.query(
        `UPDATE saas_payment_methods
         SET gateway_type = ?,
             token_reference = ?,
             provider_customer_id = COALESCE(?, provider_customer_id),
             last4 = COALESCE(?, last4),
             brand = COALESCE(?, brand),
             exp_month = COALESCE(?, exp_month),
             exp_year = COALESCE(?, exp_year),
             is_default = ?
         WHERE id = ? AND tenant_id = ?
         RETURNING *`,
        [
          gatewayType,
          String(methodData.token_reference),
          providerCustomerId,
          last4,
          brand,
          expMonth,
          expYear,
          makeDefault || existing.is_default,
          existing.id,
          tenantId
        ]
      );
      return updated[0];
    }

    const [inserted] = await this.pool.query(
      `INSERT INTO saas_payment_methods (
         tenant_id, gateway_type, token_reference, provider_customer_id,
         last4, brand, exp_month, exp_year, is_default
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        tenantId,
        gatewayType,
        String(methodData.token_reference),
        providerCustomerId,
        last4,
        brand,
        expMonth,
        expYear,
        makeDefault
      ]
    );
    return inserted[0];
  }

  async getPaymentMethods(tenantId) {
    if (!tenantId) throw new Error('tenant_id es obligatorio en getPaymentMethods');
    const [rows] = await this.pool.query(
      `SELECT * FROM saas_payment_methods
       WHERE tenant_id = ?
       ORDER BY is_default DESC, created_at DESC`,
      [tenantId]
    );
    return rows;
  }

  async getDefaultPaymentMethod(tenantId) {
    if (!tenantId) throw new Error('tenant_id es obligatorio en getDefaultPaymentMethod');
    const [rows] = await this.pool.query(
      `SELECT * FROM saas_payment_methods
       WHERE tenant_id = ?
       ORDER BY is_default DESC, created_at DESC
       LIMIT 1`,
      [tenantId]
    );
    return rows[0] || null;
  }

  async setDefaultPaymentMethod(tenantId, paymentMethodId) {
    if (!tenantId) throw new Error('tenant_id es obligatorio en setDefaultPaymentMethod');
    const [target] = await this.pool.query(
      `SELECT id FROM saas_payment_methods WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [paymentMethodId, tenantId]
    );
    if (!target.length) return null;

    await this.pool.query(
      `UPDATE saas_payment_methods SET is_default = FALSE WHERE tenant_id = ?`,
      [tenantId]
    );
    const [updated] = await this.pool.query(
      `UPDATE saas_payment_methods SET is_default = TRUE WHERE id = ? AND tenant_id = ? RETURNING *`,
      [paymentMethodId, tenantId]
    );
    return updated[0] || null;
  }

  async deletePaymentMethod(tenantId, paymentMethodId) {
    if (!tenantId) throw new Error('tenant_id es obligatorio en deletePaymentMethod');
    const [rows] = await this.pool.query(
      `DELETE FROM saas_payment_methods WHERE id = ? AND tenant_id = ? RETURNING id`,
      [paymentMethodId, tenantId]
    );
    return rows.length > 0;
  }

  async createInvoice(invoiceData, items = []) {
    if (!invoiceData.tenant_id) throw new Error('tenant_id es obligatorio en createInvoice');
    const invoiceNumber = invoiceData.invoice_number || await this.getNextInvoiceNumber(invoiceData.tenant_id);
    const subtotalMinor = toBigInt(invoiceData.subtotal_minor, 0n);
    const taxMinor = toBigInt(invoiceData.tax_minor, 0n);
    const totalMinor = toBigInt(invoiceData.total_minor, 0n);
    const amountPaidMinor = toBigInt(invoiceData.amount_paid_minor, 0n);
    const amountDueMinor = invoiceData.amount_due_minor !== undefined
      ? toBigInt(invoiceData.amount_due_minor, 0n)
      : totalMinor;
    const amountRefundedMinor = toBigInt(invoiceData.amount_refunded_minor, 0n);
    const currency = String(invoiceData.currency || 'DOP').trim().toUpperCase().slice(0, 3);

    const [inserted] = await this.pool.query(
      `INSERT INTO saas_invoices (
         tenant_id, invoice_number, subscription_id, plan_code, billing_cycle,
         price_book_version, period_start, period_end,
         subtotal_minor, tax_minor, total_minor, amount_paid_minor, amount_due_minor, amount_refunded_minor,
         currency, status, due_date, paid_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        invoiceData.tenant_id,
        invoiceNumber,
        invoiceData.subscription_id || null,
        invoiceData.plan_code || 'principal',
        invoiceData.billing_cycle || 'monthly',
        invoiceData.price_book_version || 'v1_2026',
        invoiceData.period_start || null,
        invoiceData.period_end || null,
        subtotalMinor.toString(),
        taxMinor.toString(),
        totalMinor.toString(),
        amountPaidMinor.toString(),
        amountDueMinor.toString(),
        amountRefundedMinor.toString(),
        currency,
        invoiceData.status || 'open',
        invoiceData.due_date || new Date().toISOString(),
        invoiceData.paid_at || null
      ]
    );
    const invRow = inserted[0];

    const storedItems = [];
    for (const it of items) {
      const [itemRows] = await this.pool.query(
        `INSERT INTO saas_invoice_items (tenant_id, invoice_id, description, item_type, amount_minor)
         VALUES (?, ?, ?, ?, ?)
         RETURNING *`,
        [
          invoiceData.tenant_id,
          invRow.id,
          it.description || 'SaaS Line Item',
          it.item_type || 'PLAN_FEE',
          toBigInt(it.amount_minor, 0n).toString()
        ]
      );
      if (itemRows[0]) storedItems.push(itemRows[0]);
    }

    return normalizeInvoiceRow(invRow, storedItems, [], null);
  }

  async getInvoiceById(tenantId, invoiceId) {
    if (!tenantId) throw new Error('tenant_id es obligatorio en getInvoiceById');
    const [invRows] = await this.pool.query(
      `SELECT * FROM saas_invoices WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [invoiceId, tenantId]
    );
    if (!invRows.length) return null;

    const [itemRows] = await this.pool.query(
      `SELECT * FROM saas_invoice_items WHERE invoice_id = ? AND tenant_id = ? ORDER BY created_at ASC`,
      [invoiceId, tenantId]
    );
    const [payRows] = await this.pool.query(
      `SELECT * FROM saas_payments WHERE invoice_id = ? AND tenant_id = ? ORDER BY created_at DESC`,
      [invoiceId, tenantId]
    );
    const [orderRows] = await this.pool.query(
      `SELECT id, order_number, cardnet_authorization_code, cardnet_response_code, masked_card, metadata
       FROM saas_checkout_orders
       WHERE invoice_id = ? AND tenant_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [invoiceId, tenantId]
    );

    return normalizeInvoiceRow(invRows[0], itemRows, payRows, orderRows[0] || null);
  }

  async listInvoices(tenantId) {
    if (!tenantId) throw new Error('tenant_id es obligatorio en listInvoices');
    const [invRows] = await this.pool.query(
      `SELECT * FROM saas_invoices WHERE tenant_id = ? ORDER BY created_at DESC`,
      [tenantId]
    );
    if (!invRows.length) return [];

    const [itemRows] = await this.pool.query(
      `SELECT * FROM saas_invoice_items WHERE tenant_id = ? ORDER BY created_at ASC`,
      [tenantId]
    );
    const [payRows] = await this.pool.query(
      `SELECT * FROM saas_payments WHERE tenant_id = ? ORDER BY created_at DESC`,
      [tenantId]
    );
    const [orderRows] = await this.pool.query(
      `SELECT id, invoice_id, order_number, cardnet_authorization_code, cardnet_response_code, masked_card, metadata
       FROM saas_checkout_orders
       WHERE tenant_id = ? AND invoice_id IS NOT NULL
       ORDER BY created_at DESC`,
      [tenantId]
    );

    const itemsByInv = new Map();
    for (const it of itemRows) {
      if (!itemsByInv.has(it.invoice_id)) itemsByInv.set(it.invoice_id, []);
      itemsByInv.get(it.invoice_id).push(it);
    }

    const paysByInv = new Map();
    for (const p of payRows) {
      if (!paysByInv.has(p.invoice_id)) paysByInv.set(p.invoice_id, []);
      paysByInv.get(p.invoice_id).push(p);
    }

    const orderByInv = new Map();
    for (const ord of orderRows) {
      if (!orderByInv.has(ord.invoice_id)) orderByInv.set(ord.invoice_id, ord);
    }

    return invRows.map((inv) =>
      normalizeInvoiceRow(
        inv,
        itemsByInv.get(inv.id) || [],
        paysByInv.get(inv.id) || [],
        orderByInv.get(inv.id) || null
      )
    );
  }

  async updateInvoice(tenantId, invoiceId, updates) {
    if (!tenantId) throw new Error('tenant_id es obligatorio en updateInvoice');
    const sets = [];
    const params = [];

    if (updates.status !== undefined) {
      sets.push('status = ?');
      params.push(updates.status);
    }
    if (updates.amount_paid_minor !== undefined) {
      sets.push('amount_paid_minor = ?');
      params.push(toBigInt(updates.amount_paid_minor).toString());
    }
    if (updates.amount_due_minor !== undefined) {
      sets.push('amount_due_minor = ?');
      params.push(toBigInt(updates.amount_due_minor).toString());
    }
    if (updates.amount_refunded_minor !== undefined) {
      sets.push('amount_refunded_minor = ?');
      params.push(toBigInt(updates.amount_refunded_minor).toString());
    }
    if (updates.paid_at !== undefined) {
      sets.push('paid_at = ?');
      params.push(updates.paid_at);
    }

    if (!sets.length) return this.getInvoiceById(tenantId, invoiceId);

    params.push(invoiceId, tenantId);
    const [rows] = await this.pool.query(
      `UPDATE saas_invoices SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ? RETURNING *`,
      params
    );
    if (!rows.length) return null;
    return this.getInvoiceById(tenantId, invoiceId);
  }

  async markInvoicePaid(invoiceId, { amountPaidMinor } = {}) {
    const [rows] = await this.pool.query(
      `UPDATE saas_invoices
       SET status = 'paid',
           amount_paid_minor = COALESCE(?, total_minor),
           amount_due_minor = 0,
           paid_at = COALESCE(paid_at, NOW())
       WHERE id = ?
       RETURNING *`,
      [amountPaidMinor !== undefined ? toBigInt(amountPaidMinor).toString() : null, invoiceId]
    );
    return rows[0] || null;
  }

  async recordPayment(paymentData) {
    if (!paymentData.tenant_id) throw new Error('tenant_id es obligatorio en recordPayment');
    if (!paymentData.invoice_id) throw new Error('invoice_id es obligatorio en recordPayment');
    if (!paymentData.idempotency_key) throw new Error('idempotency_key es obligatorio en recordPayment');

    const currency = String(paymentData.currency || 'DOP').trim().toUpperCase().slice(0, 3);
    const [inserted] = await this.pool.query(
      `INSERT INTO saas_payments (
         tenant_id, invoice_id, amount_minor, refunded_amount_minor, currency,
         gateway_reference, status, failure_code, failure_message, idempotency_key
       )
       VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
       RETURNING *`,
      [
        paymentData.tenant_id,
        paymentData.invoice_id,
        toBigInt(paymentData.amount_minor, 0n).toString(),
        currency,
        paymentData.gateway_reference || null,
        paymentData.status || 'success',
        paymentData.failure_code || null,
        paymentData.failure_message || null,
        paymentData.idempotency_key
      ]
    );

    if (inserted.length > 0) {
      const p = inserted[0];
      return {
        ...p,
        currency: String(p.currency || 'DOP').trim().toUpperCase(),
        amount_minor: toBigInt(p.amount_minor),
        refunded_amount_minor: toBigInt(p.refunded_amount_minor)
      };
    }

    const [existing] = await this.pool.query(
      `SELECT * FROM saas_payments WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1`,
      [paymentData.tenant_id, paymentData.idempotency_key]
    );
    const p = existing[0];
    return p
      ? {
          ...p,
          currency: String(p.currency || 'DOP').trim().toUpperCase(),
          amount_minor: toBigInt(p.amount_minor),
          refunded_amount_minor: toBigInt(p.refunded_amount_minor)
        }
      : null;
  }

  async getPaymentById(tenantId, paymentId) {
    if (!tenantId) throw new Error('tenant_id es obligatorio en getPaymentById');
    const [rows] = await this.pool.query(
      `SELECT * FROM saas_payments WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [paymentId, tenantId]
    );
    if (!rows.length) return null;
    const p = rows[0];
    return {
      ...p,
      currency: String(p.currency || 'DOP').trim().toUpperCase(),
      amount_minor: toBigInt(p.amount_minor),
      refunded_amount_minor: toBigInt(p.refunded_amount_minor)
    };
  }

  async listPaymentsByInvoice(tenantId, invoiceId) {
    if (!tenantId) throw new Error('tenant_id es obligatorio en listPaymentsByInvoice');
    const [rows] = await this.pool.query(
      `SELECT * FROM saas_payments WHERE tenant_id = ? AND invoice_id = ? ORDER BY created_at DESC`,
      [tenantId, invoiceId]
    );
    return rows.map((p) => ({
      ...p,
      currency: String(p.currency || 'DOP').trim().toUpperCase(),
      amount_minor: toBigInt(p.amount_minor),
      refunded_amount_minor: toBigInt(p.refunded_amount_minor)
    }));
  }

  async updatePayment(tenantId, paymentId, updates) {
    if (!tenantId) throw new Error('tenant_id es obligatorio en updatePayment');
    const sets = [];
    const params = [];
    if (updates.status !== undefined) {
      sets.push('status = ?');
      params.push(updates.status);
    }
    if (updates.refunded_amount_minor !== undefined) {
      sets.push('refunded_amount_minor = ?');
      params.push(toBigInt(updates.refunded_amount_minor).toString());
    }
    if (!sets.length) return this.getPaymentById(tenantId, paymentId);

    params.push(paymentId, tenantId);
    const [rows] = await this.pool.query(
      `UPDATE saas_payments SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ? RETURNING *`,
      params
    );
    if (!rows.length) return null;
    const p = rows[0];
    return {
      ...p,
      currency: String(p.currency || 'DOP').trim().toUpperCase(),
      amount_minor: toBigInt(p.amount_minor),
      refunded_amount_minor: toBigInt(p.refunded_amount_minor)
    };
  }

  async recordRefund(refundData) {
    if (!refundData.tenant_id) throw new Error('tenant_id es obligatorio en recordRefund');
    const currency = String(refundData.currency || 'DOP').trim().toUpperCase().slice(0, 3);
    const [rows] = await this.pool.query(
      `INSERT INTO saas_refunds (
         tenant_id, payment_id, invoice_id, amount_minor, currency,
         status, reason, gateway_reference, idempotency_key, actor
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
       RETURNING *`,
      [
        refundData.tenant_id,
        refundData.payment_id,
        refundData.invoice_id,
        toBigInt(refundData.amount_minor, 0n).toString(),
        currency,
        refundData.status || 'success',
        refundData.reason || 'solicitud_cliente',
        refundData.gateway_reference || null,
        refundData.idempotency_key,
        refundData.actor || 'system'
      ]
    );
    if (rows.length > 0) return { ...rows[0], amount_minor: toBigInt(rows[0].amount_minor) };
    const [existing] = await this.pool.query(
      `SELECT * FROM saas_refunds WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1`,
      [refundData.tenant_id, refundData.idempotency_key]
    );
    return existing[0] ? { ...existing[0], amount_minor: toBigInt(existing[0].amount_minor) } : null;
  }

  async getRefundsByPayment(tenantId, paymentId) {
    const [rows] = await this.pool.query(
      `SELECT * FROM saas_refunds WHERE tenant_id = ? AND payment_id = ? ORDER BY created_at DESC`,
      [tenantId, paymentId]
    );
    return rows.map((r) => ({ ...r, amount_minor: toBigInt(r.amount_minor) }));
  }

  async getTotalRefundedForPayment(tenantId, paymentId) {
    const [rows] = await this.pool.query(
      `SELECT COALESCE(SUM(amount_minor), 0) AS total
       FROM saas_refunds
       WHERE tenant_id = ? AND payment_id = ? AND status = 'success'`,
      [tenantId, paymentId]
    );
    return toBigInt(rows[0]?.total, 0n);
  }

  async recordBillingEvent({ tenant_id, event_type, payload = {}, idempotency_key }) {
    if (!tenant_id) throw new Error('tenant_id es obligatorio en recordBillingEvent');
    const key = idempotency_key || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const [rows] = await this.pool.query(
      `INSERT INTO saas_billing_events (tenant_id, event_type, payload, idempotency_key)
       VALUES (?, ?, ?::jsonb, ?)
       ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
       RETURNING *`,
      [tenant_id, event_type, JSON.stringify(payload || {}), key]
    );
    if (rows.length > 0) return rows[0];
    return this.getBillingEventByIdempotencyKey(tenant_id, key);
  }

  async getBillingEventByIdempotencyKey(tenantId, idempotencyKey) {
    const [rows] = await this.pool.query(
      `SELECT * FROM saas_billing_events WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1`,
      [tenantId, idempotencyKey]
    );
    return rows[0] || null;
  }

  async recordWebhookEvent({ provider, event_id, tenant_id = null, event_type, payload_sanitized = {}, idempotency_key }) {
    const [rows] = await this.pool.query(
      `INSERT INTO saas_webhook_events (provider, event_id, tenant_id, event_type, payload_sanitized, status, idempotency_key)
       VALUES (?, ?, ?, ?, ?::jsonb, 'received', ?)
       ON CONFLICT (provider, event_id) DO NOTHING
       RETURNING *`,
      [provider, event_id, tenant_id, event_type, JSON.stringify(payload_sanitized || {}), idempotency_key || event_id]
    );
    if (rows.length > 0) return rows[0];
    return this.getWebhookEvent(provider, event_id);
  }

  async getWebhookEvent(provider, eventId) {
    const [rows] = await this.pool.query(
      `SELECT * FROM saas_webhook_events WHERE provider = ? AND event_id = ? LIMIT 1`,
      [provider, eventId]
    );
    return rows[0] || null;
  }
}

module.exports = {
  PgSaasBillingRepository
};
