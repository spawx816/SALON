/**
 * Contrato de Repositorio de Facturación SaaS (SaasBillingRepository)
 * Aísla toda persistencia de facturas, métodos de pago, cobros, reembolsos y contadores atómicos.
 */

class SaasBillingRepository {
  async getNextInvoiceNumber(tenantId, year) { throw new Error('Not implemented'); }
  async savePaymentMethod(method) { throw new Error('Not implemented'); }
  async getPaymentMethods(tenantId) { throw new Error('Not implemented'); }
  async getDefaultPaymentMethod(tenantId) { throw new Error('Not implemented'); }
  async setDefaultPaymentMethod(tenantId, paymentMethodId) { throw new Error('Not implemented'); }
  async deletePaymentMethod(tenantId, paymentMethodId) { throw new Error('Not implemented'); }

  async createInvoice(invoice, items = []) { throw new Error('Not implemented'); }
  async getInvoiceById(tenantId, invoiceId) { throw new Error('Not implemented'); }
  async listInvoices(tenantId) { throw new Error('Not implemented'); }
  async updateInvoice(tenantId, invoiceId, updates) { throw new Error('Not implemented'); }

  async recordPayment(payment) { throw new Error('Not implemented'); }
  async getPaymentById(tenantId, paymentId) { throw new Error('Not implemented'); }
  async listPaymentsByInvoice(tenantId, invoiceId) { throw new Error('Not implemented'); }
  async updatePayment(tenantId, paymentId, updates) { throw new Error('Not implemented'); }

  async recordRefund(refund) { throw new Error('Not implemented'); }
  async getRefundsByPayment(tenantId, paymentId) { throw new Error('Not implemented'); }
  async getTotalRefundedForPayment(tenantId, paymentId) { throw new Error('Not implemented'); }

  async recordBillingEvent(event) { throw new Error('Not implemented'); }
  async getBillingEventByIdempotencyKey(tenantId, idempotencyKey) { throw new Error('Not implemented'); }

  async recordWebhookEvent(webhookEvent) { throw new Error('Not implemented'); }
  async getWebhookEvent(provider, eventId) { throw new Error('Not implemented'); }
}

module.exports = {
  SaasBillingRepository
};

