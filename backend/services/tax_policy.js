/**
 * Política Fiscal de Facturación SaaS SalonPro
 * Define la interfaz abstracta BillingTaxPolicy y su implementación de pruebas ZeroTaxPolicy.
 * No se asume ni hardcodea ITBIS u otro impuesto hasta validación legal y contable formal.
 */

class BillingTaxPolicy {
  /**
   * Calcula el impuesto aplicable sobre una base imponible en unidades menores
   * @param {Object} params
   * @param {BigInt|number} params.amountMinor - Base imponible en centavos
   * @param {string} params.currency - 'DOP' o 'USD'
   * @param {string} params.tenantId - Identificador del suscriptor
   * @param {string} params.planCode - 'BASE' o 'PRO'
   * @returns {Object} { taxAmountMinor: BigInt, taxRateBasisPoints: number, taxDescription: string }
   */
  calculateTax({ amountMinor, currency, tenantId, planCode }) {
    throw new Error('Método calculateTax debe ser implementado por una subclase concreta de BillingTaxPolicy');
  }
}

class ZeroTaxPolicy extends BillingTaxPolicy {
  calculateTax({ amountMinor, currency, tenantId, planCode }) {
    return {
      taxAmountMinor: 0n,
      taxRateBasisPoints: 0,
      taxDescription: 'Exento / Cero Impuesto (ZeroTaxPolicy)'
    };
  }
}

module.exports = {
  BillingTaxPolicy,
  ZeroTaxPolicy
};

