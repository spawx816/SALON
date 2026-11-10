/**
 * Puerto de Pasarela de Pago (PaymentGatewayPort)
 * Define el contrato abstracto para procesadores de cobro recurrentes.
 * 
 * PCI DSS COMPLIANCE INVARIANT:
 * Este puerto y todo el backend de SalonPro tienen ESTRICTAMENTE PROHIBIDO
 * recibir, transportar, registrar o almacenar PAN (Primary Account Number / 16 dígitos) o CVC/CVV.
 * La tokenización se realiza del lado del cliente / SDK del proveedor.
 */

class PaymentGatewayPort {
  /**
   * Ejecuta un cobro contra un método de pago previamente tokenizado
   * @param {Object} params
   * @param {string} params.tenantId
   * @param {BigInt|number} params.amountMinor - Monto en unidades menores (centavos)
   * @param {string} params.currency - 'DOP' o 'USD'
   * @param {string} params.paymentMethodToken - Token opaco emitido por el proveedor (pm_...)
   * @param {string} params.providerCustomerReference - Identificador del cliente en la pasarela (cus_...)
   * @param {string} params.idempotencyKey - Clave de idempotencia única
   * @param {string} params.description - Concepto del cobro
   * @returns {Promise<Object>} Resultado del cargo { success: boolean, chargeId: string, amountMinor: BigInt, currency: string, rawStatus: string }
   */
  async charge(params) {
    throw new Error('PaymentGatewayPort.charge debe ser implementado');
  }

  /**
   * Ejecuta un reembolso total o parcial sobre un cargo previo
   * @param {Object} params
   * @param {string} params.tenantId
   * @param {string} params.chargeId - Referencia del cargo original
   * @param {BigInt|number} params.amountMinor - Monto a reembolsar en centavos
   * @param {string} params.currency - Moneda original
   * @param {string} params.reason - Motivo del reembolso
   * @param {string} params.idempotencyKey - Clave de idempotencia única
   * @returns {Promise<Object>} { success: boolean, refundId: string, amountMinor: BigInt, status: string }
   */
  async refund(params) {
    throw new Error('PaymentGatewayPort.refund debe ser implementado');
  }

  /**
   * Verifica la firma criptográfica sobre el payload crudo del webhook
   * @param {Object} params
   * @param {string|Buffer} params.rawBody - Cuerpo crudo de la petición HTTP
   * @param {string} params.signatureHeader - Cabecera con la firma provista por la pasarela
   * @param {string} params.secret - Secreto compartido del webhook
   * @returns {boolean} true si la firma es válida, false en caso contrario
   */
  verifyWebhookSignature(params) {
    throw new Error('PaymentGatewayPort.verifyWebhookSignature debe ser implementado');
  }
}

module.exports = {
  PaymentGatewayPort
};

