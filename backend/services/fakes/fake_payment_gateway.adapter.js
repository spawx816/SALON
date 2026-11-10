/**
 * Adaptador Simulado de Pasarela de Pagos (FakePaymentGatewayAdapter)
 * Implementa PaymentGatewayPort en memoria para desarrollo local y suites de prueba TDD.
 * 
 * Cumplimiento PCI DSS: Cero PAN, cero CVC.
 * Soporta simulación determinista de cargos, rechazos, reembolsos y verificación de firmas de webhooks.
 */

const crypto = require('crypto');
const { PaymentGatewayPort } = require('../payment_gateway.port');

class FakePaymentGatewayAdapter extends PaymentGatewayPort {
  constructor(options = {}) {
    super();
    this.name = 'fake_gateway';
    this.charges = new Map(); // chargeId -> chargeRecord
    this.refunds = new Map(); // refundId -> refundRecord
    this.idempotencyMap = new Map(); // idempotencyKey -> result
    this.webhookSecret = options.webhookSecret || 'whsec_fake_test_secret_2026';
  }

  /**
   * Genera un token opaco ficticio para pruebas (ej. para checkout o setup)
   */
  generateOpaquePaymentMethodToken(type = 'card_ok', last4 = '4242') {
    const randomSuffix = crypto.randomBytes(8).toString('hex');
    return `pm_fake_${type}_${last4}_${randomSuffix}`;
  }

  generateCustomerReference(tenantId) {
    const cleanId = String(tenantId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
    return `cus_fake_${cleanId}_${crypto.randomBytes(4).toString('hex')}`;
  }

  async charge({ tenantId, amountMinor, currency, paymentMethodToken, providerCustomerReference, idempotencyKey, description }) {
    if (!tenantId) throw new Error('tenantId es obligatorio en charge');
    if (amountMinor === undefined || amountMinor === null || BigInt(amountMinor) <= 0n) {
      throw new Error('amountMinor debe ser un entero positivo mayor que cero');
    }
    if (!currency) throw new Error('currency es obligatorio');
    if (!paymentMethodToken) throw new Error('paymentMethodToken es obligatorio');
    if (!idempotencyKey) throw new Error('idempotencyKey es obligatoria en charge');

    const minorVal = BigInt(amountMinor);

    // Verificación de idempotencia estricta
    const existing = this.idempotencyMap.get(idempotencyKey);
    if (existing) {
      return { ...existing, isIdempotentReplay: true };
    }

    // Simulación determinista de fallos según sufijo del token
    const tokenStr = String(paymentMethodToken);
    if (tokenStr.includes('_declined')) {
      const err = new Error('La tarjeta fue rechazada por el banco emisor (PAYMENT_DECLINED)');
      err.code = 'PAYMENT_DECLINED';
      err.declineCode = 'do_not_honor';
      throw err;
    }
    if (tokenStr.includes('_insufficient_funds')) {
      const err = new Error('Fondos insuficientes en la cuenta (INSUFFICIENT_FUNDS)');
      err.code = 'INSUFFICIENT_FUNDS';
      err.declineCode = 'insufficient_funds';
      throw err;
    }
    if (tokenStr.includes('_network_err')) {
      const err = new Error('Error de comunicación con la red procesadora (NETWORK_TIMEOUT)');
      err.code = 'NETWORK_TIMEOUT';
      throw err;
    }

    const chargeId = `ch_fake_${crypto.randomBytes(12).toString('hex')}`;
    const chargeRecord = {
      success: true,
      chargeId,
      tenantId,
      amountMinor: minorVal,
      currency: String(currency).toUpperCase(),
      paymentMethodToken,
      providerCustomerReference,
      idempotencyKey,
      description: description || 'SaaS Subscription Charge',
      status: 'success',
      createdAt: new Date().toISOString()
    };

    this.charges.set(chargeId, chargeRecord);
    this.idempotencyMap.set(idempotencyKey, chargeRecord);

    return {
      success: true,
      chargeId,
      amountMinor: minorVal,
      currency: chargeRecord.currency,
      status: 'success',
      isIdempotentReplay: false
    };
  }

  async refund({ tenantId, chargeId, amountMinor, currency, reason, idempotencyKey }) {
    if (!tenantId) throw new Error('tenantId es obligatorio en refund');
    if (!chargeId) throw new Error('chargeId es obligatorio en refund');
    if (!idempotencyKey) throw new Error('idempotencyKey es obligatoria en refund');
    const refundAmount = BigInt(amountMinor);
    if (refundAmount <= 0n) throw new Error('amountMinor de refund debe ser mayor a cero');

    // Idempotencia
    const existing = this.idempotencyMap.get(idempotencyKey);
    if (existing) {
      return { ...existing, isIdempotentReplay: true };
    }

    const originalCharge = this.charges.get(chargeId);
    if (!originalCharge) {
      throw new Error(`Cargo no encontrado en pasarela simulada: ${chargeId}`);
    }
    if (originalCharge.tenantId !== tenantId) {
      throw new Error('Violación de tenant en reembolso (Anti-IDOR pasarela)');
    }

    const refundId = `re_fake_${crypto.randomBytes(12).toString('hex')}`;
    const refundRecord = {
      success: true,
      refundId,
      chargeId,
      tenantId,
      amountMinor: refundAmount,
      currency: currency || originalCharge.currency,
      reason: reason || 'customer_requested',
      idempotencyKey,
      status: 'success',
      createdAt: new Date().toISOString()
    };

    this.refunds.set(refundId, refundRecord);
    this.idempotencyMap.set(idempotencyKey, refundRecord);

    return {
      success: true,
      refundId,
      chargeId,
      amountMinor: refundAmount,
      currency: refundRecord.currency,
      status: 'success',
      isIdempotentReplay: false
    };
  }

  /**
   * Genera cabecera de firma HMAC válida para simular llamadas de webhook
   */
  signWebhookPayload(rawPayload, secret = this.webhookSecret) {
    const raw = typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
    return `t=${timestamp},v1=${signature}`;
  }

  verifyWebhookSignature({ rawBody, signatureHeader, secret = this.webhookSecret }) {
    if (!rawBody || !signatureHeader) return false;

    try {
      const parts = String(signatureHeader).split(',');
      const tPart = parts.find(p => p.startsWith('t='));
      const v1Part = parts.find(p => p.startsWith('v1='));

      if (!tPart || !v1Part) return false;

      const timestamp = tPart.split('=')[1];
      const receivedSig = v1Part.split('=')[1];

      const raw = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
      const expectedSig = crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');

      return crypto.timingSafeEqual(Buffer.from(receivedSig, 'hex'), Buffer.from(expectedSig, 'hex'));
    } catch (e) {
      return false;
    }
  }
}

module.exports = {
  FakePaymentGatewayAdapter
};

