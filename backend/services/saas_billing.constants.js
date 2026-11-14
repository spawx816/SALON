/**
 * Constantes y Catálogo de Precios para Facturación del SaaS SalonPro (Fase 2D)
 * REGLAS INALTERABLES:
 * 1. Solo dos planes comerciales (BASE y PRO).
 * 2. Precios en unidades menores (amount_minor BIGINT) sin floats ni decimales binarios.
 * 3. Listas de precios independientes sin conversión DOP/USD.
 * 4. Versión del libro de precios registrada para trazabilidad histórica.
 * 5. Estados unificados con Fase 2A: active, past_due, suspended, cancelled, expired. (Sin trialing).
 */

const { SAAS_PLANS, LEGACY_PLAN_CODES, SUBSCRIPTION_STATUSES } = require('./saas_catalog.constants');

const SAAS_CURRENCIES = Object.freeze({
  DOP: 'DOP',
  USD: 'USD'
});

const BILLING_CYCLES = Object.freeze({
  MONTHLY: 'monthly',
  ANNUAL: 'annual'
});

const PRICE_BOOK_VERSION = 'v1_2026';

// Precios en unidades menores (centavos)
// DOP: 2,900.00 -> 290000 | USD: 49.00 -> 4900
const CANONICAL_PRICE_BOOK = Object.freeze({
  version: PRICE_BOOK_VERSION,
  prices: Object.freeze({
    [SAAS_PLANS.PRINCIPAL]: Object.freeze({
      [BILLING_CYCLES.MONTHLY]: Object.freeze({
        [SAAS_CURRENCIES.DOP]: BigInt(Math.round(Number(process.env.SAAS_PRINCIPAL_PLAN_PRICE_DOP || 0) * 100)),
        [SAAS_CURRENCIES.USD]: BigInt(Math.round(Number(process.env.SAAS_PRINCIPAL_PLAN_PRICE_USD || 0) * 100))
      }),
      [BILLING_CYCLES.ANNUAL]: Object.freeze({
        [SAAS_CURRENCIES.DOP]: BigInt(Math.round(Number(process.env.SAAS_PRINCIPAL_PLAN_PRICE_DOP || 0) * 100 * 12)),
        [SAAS_CURRENCIES.USD]: BigInt(Math.round(Number(process.env.SAAS_PRINCIPAL_PLAN_PRICE_USD || 0) * 100 * 12))
      })
    }),
    [LEGACY_PLAN_CODES.BASE]: Object.freeze({
      [BILLING_CYCLES.MONTHLY]: Object.freeze({
        [SAAS_CURRENCIES.DOP]: 290000n,
        [SAAS_CURRENCIES.USD]: 4900n
      }),
      [BILLING_CYCLES.ANNUAL]: Object.freeze({
        [SAAS_CURRENCIES.DOP]: 2900000n,
        [SAAS_CURRENCIES.USD]: 49000n
      })
    }),
    [LEGACY_PLAN_CODES.PRO]: Object.freeze({
      [BILLING_CYCLES.MONTHLY]: Object.freeze({
        [SAAS_CURRENCIES.DOP]: 590000n,
        [SAAS_CURRENCIES.USD]: 9900n
      }),
      [BILLING_CYCLES.ANNUAL]: Object.freeze({
        [SAAS_CURRENCIES.DOP]: 5900000n,
        [SAAS_CURRENCIES.USD]: 99000n
      })
    })
  })
});

const INVOICE_STATUS = Object.freeze({
  DRAFT: 'draft',
  OPEN: 'open',
  PAID: 'paid',
  PARTIALLY_REFUNDED: 'partially_refunded',
  REFUNDED: 'refunded',
  VOID: 'void',
  UNCOLLECTIBLE: 'uncollectible'
});

const PAYMENT_STATUS = Object.freeze({
  PENDING: 'pending',
  SUCCESS: 'success',
  PARTIALLY_REFUNDED: 'partially_refunded',
  REFUNDED: 'refunded',
  FAILED: 'failed'
});

const REFUND_STATUS = Object.freeze({
  SUCCESS: 'success',
  FAILED: 'failed'
});

const DUNNING_POLICY = Object.freeze({
  GRACE_PERIOD_DAYS: 5,
  MAX_RETRY_ATTEMPTS: 3,
  RETRY_INTERVALS_DAYS: Object.freeze([1, 3, 5])
});

function getPlanPriceMinor(planCode, cycle, currency) {
  const normPlan = String(planCode || '').toUpperCase();
  const normCycle = String(cycle || '').toLowerCase();
  const normCurr = String(currency || '').toUpperCase();

  if (!CANONICAL_PRICE_BOOK.prices[normPlan]) {
    throw new Error(`Plan desconocido en catálogo de facturación: "${planCode}"`);
  }
  if (!CANONICAL_PRICE_BOOK.prices[normPlan][normCycle]) {
    throw new Error(`Ciclo de facturación inválido: "${cycle}"`);
  }
  const amount = CANONICAL_PRICE_BOOK.prices[normPlan][normCycle][normCurr];
  if (amount === undefined) {
    throw new Error(`Moneda no soportada en libro de precios: "${currency}"`);
  }
  return amount;
}

function isValidCurrency(curr) {
  return curr === SAAS_CURRENCIES.DOP || curr === SAAS_CURRENCIES.USD;
}

function isValidCycle(cycle) {
  return cycle === BILLING_CYCLES.MONTHLY || cycle === BILLING_CYCLES.ANNUAL;
}

module.exports = {
  SAAS_PLANS,
  SUBSCRIPTION_STATUSES,
  SAAS_CURRENCIES,
  BILLING_CYCLES,
  PRICE_BOOK_VERSION,
  CANONICAL_PRICE_BOOK,
  INVOICE_STATUS,
  PAYMENT_STATUS,
  REFUND_STATUS,
  DUNNING_POLICY,
  getPlanPriceMinor,
  isValidCurrency,
  isValidCycle
};

