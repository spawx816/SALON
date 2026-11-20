'use strict';

const { PaymentGatewayPort } = require('./payment_gateway.port');

class CardNetGatewayAdapter extends PaymentGatewayPort {
  constructor({ tokenizationProvider }) {
    super();
    this.tokenizationProvider = tokenizationProvider;
  }

  async charge({
    amountMinor,
    currency = 'DOP',
    paymentMethodToken,
    orderNumber,
    idempotencyKey,
    description,
    clientIp = '127.0.0.1',
  }) {
    if (!this.tokenizationProvider) {
      throw new Error('CardNetTokenizationProvider no inicializado.');
    }
    const result = await this.tokenizationProvider.purchaseWithToken({
      trxToken: paymentMethodToken,
      orderNumber: orderNumber || idempotencyKey,
      totalMinor: Number(amountMinor),
      taxMinor: 0,
      currency,
      description,
      clientIp,
    });
    return {
      success: result.approved,
      approved: result.approved,
      chargeId: result.transactionId || result.authorizationCode || result.retrievalReferenceNumber,
      transactionId: result.transactionId,
      authorizationCode: result.authorizationCode,
      responseCode: result.responseCode,
      responseMessage: result.responseMessage,
      retriable: result.retriable,
      requiresAuthentication: result.requiresAuthentication,
      declineCategory: result.declineCategory,
    };
  }

  async reconcileTransaction({ transactionId }) {
    if (!this.tokenizationProvider || typeof this.tokenizationProvider.queryTransaction !== 'function') {
      return { found: false, approved: false, pending: true };
    }
    return this.tokenizationProvider.queryTransaction({ transactionId });
  }
}

module.exports = {
  CardNetGatewayAdapter,
};
