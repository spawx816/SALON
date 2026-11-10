/**
 * Motor Matemático de Prorrateo SaaS (ProrationEngine)
 * REGLAS DETERMINISTAS:
 * 1. Todos los cálculos operan sobre timestamps UTC en unidades menores (BigInt cents).
 * 2. Período formal semi-abierto: [period_start, period_end).
 * 3. effective_at queda incluido en el nuevo plan.
 * 4. Redondeo determinista: piso (floor) para crédito no usado, techo (ceil) para cargo nuevo.
 * 5. Upgrades aplican de inmediato calculando importe neto adeudado.
 * 6. Downgrades son programados para ejecutarse al final del período (period_end).
 * 7. Cero créditos negativos en facturas.
 * 8. Cero facturas con monedas mixtas.
 */

const { getPlanPriceMinor, isValidCurrency, isValidCycle } = require('./saas_billing.constants');

class ProrationEngine {
  /**
   * Calcula el prorrateo exacto para un cambio de plan
   * @param {Object} params
   * @param {string} params.currentPlan - 'BASE' o 'PRO'
   * @param {string} params.newPlan - 'BASE' o 'PRO'
   * @param {string} params.billingCycle - 'monthly' o 'annual'
   * @param {string} params.currency - 'DOP' o 'USD'
   * @param {Date|string|number} params.periodStart - Inicio del ciclo UTC
   * @param {Date|string|number} params.periodEnd - Fin del ciclo UTC
   * @param {Date|string|number} params.effectiveAt - Momento del cambio UTC
   * @returns {Object} Desglose matemático determinista
   */
  static calculateProration({
    currentPlan,
    newPlan,
    billingCycle,
    currency,
    periodStart,
    periodEnd,
    effectiveAt
  }) {
    if (!isValidCurrency(currency)) {
      throw new Error(`Moneda inválida o no soportada: "${currency}"`);
    }
    if (!isValidCycle(billingCycle)) {
      throw new Error(`Ciclo de facturación inválido: "${billingCycle}"`);
    }

    const pStartUtc = new Date(periodStart).getTime();
    const pEndUtc = new Date(periodEnd).getTime();
    const effUtc = new Date(effectiveAt).getTime();

    if (isNaN(pStartUtc) || isNaN(pEndUtc) || isNaN(effUtc)) {
      throw new Error('Fechas inválidas para cálculo de prorrateo');
    }
    if (pEndUtc <= pStartUtc) {
      throw new Error('periodEnd debe ser estrictamente posterior a periodStart');
    }

    // Duración total del ciclo en ms
    const totalDurationMs = BigInt(pEndUtc - pStartUtc);
    
    // Duración restante desde effectiveAt hasta periodEnd
    // Si effUtc <= pStartUtc -> ciclo completo restante
    // Si effUtc >= pEndUtc -> cero tiempo restante
    let remainingMs = 0n;
    if (effUtc < pStartUtc) {
      remainingMs = totalDurationMs;
    } else if (effUtc < pEndUtc) {
      remainingMs = BigInt(pEndUtc - effUtc);
    } else {
      remainingMs = 0n;
    }

    const currentPriceMinor = BigInt(getPlanPriceMinor(currentPlan, billingCycle, currency));
    const newPriceMinor = BigInt(getPlanPriceMinor(newPlan, billingCycle, currency));

    // Si los planes son idénticos, no hay cargo adicional
    if (currentPlan === newPlan) {
      return {
        isProrated: false,
        currentPlan,
        newPlan,
        billingCycle,
        currency,
        totalDurationMs: Number(totalDurationMs),
        remainingMs: Number(remainingMs),
        unusedCreditMinor: 0n,
        newPlanChargeMinor: 0n,
        netDueMinor: 0n,
        creditBalanceMinor: 0n
      };
    }

    // Cálculo matemático proporcional con BigInt:
    // unusedCreditMinor = (currentPriceMinor * remainingMs) / totalDurationMs (floor)
    // newPlanChargeMinor = ceil((newPriceMinor * remainingMs) / totalDurationMs)
    const unusedCreditMinor = remainingMs > 0n
      ? (currentPriceMinor * remainingMs) / totalDurationMs
      : 0n;

    const chargeNumerator = newPriceMinor * remainingMs;
    const newPlanChargeMinor = remainingMs > 0n
      ? (chargeNumerator + totalDurationMs - 1n) / totalDurationMs // ceil determinista entero
      : 0n;

    let netDueMinor = 0n;
    let creditBalanceMinor = 0n;

    if (newPlanChargeMinor >= unusedCreditMinor) {
      netDueMinor = newPlanChargeMinor - unusedCreditMinor;
    } else {
      creditBalanceMinor = unusedCreditMinor - newPlanChargeMinor;
    }

    return {
      isProrated: true,
      currentPlan,
      newPlan,
      billingCycle,
      currency,
      totalDurationMs: Number(totalDurationMs),
      remainingMs: Number(remainingMs),
      unusedCreditMinor,
      newPlanChargeMinor,
      netDueMinor,
      creditBalanceMinor
    };
  }
}

module.exports = {
  ProrationEngine
};

