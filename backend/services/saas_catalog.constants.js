/**
 * Catálogo Canónico Oficial de Etereas SaaS B2B
 * Modelo vigente: Un único Plan Principal + Add-on independiente de Suscripciones/Membresías B2C.
 * Precios configurables por entorno; cuando no están definidos permanecen pendientes de aprobación comercial.
 */

const SAAS_PLANS = Object.freeze({
  PRINCIPAL: 'PRINCIPAL',
});

const LEGACY_PLAN_CODES = Object.freeze({
  BASE: 'BASE',
  PRO: 'PRO',
});

const SAAS_ADDONS = Object.freeze({
  MEMBERSHIPS: 'memberships',
});

const SUBSCRIPTION_STATUSES = Object.freeze({
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  SUSPENDED: 'suspended',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
});

const SAAS_FEATURES = Object.freeze({
  // Funcionalidades incluidas en el Plan Principal
  POS: 'pos',
  CASH_REGISTERS: 'cash_registers',
  SERVICES_CATALOG: 'services_catalog',
  INVENTORY: 'inventory',
  INVENTORY_ADVANCED: 'inventory_advanced',
  COMMISSIONS: 'commissions',
  PAYROLL: 'payroll',
  ATTENDANCE: 'attendance',
  EXPENSES: 'expenses',
  DGII_ECF: 'dgii_ecf',
  REPORTS: 'reports',
  SECURITY: 'security',
  CLIENTS: 'clients',
  MARKETING: 'marketing',

  // Add-on independiente: Suscripciones y Membresías B2C (incluye contratos y cobros recurrentes B2C)
  MEMBERSHIPS: 'memberships',
});

const CANONICAL_PLAN_FEATURES = Object.freeze({
  [SAAS_PLANS.PRINCIPAL]: Object.freeze({
    [SAAS_FEATURES.POS]: true,
    [SAAS_FEATURES.CASH_REGISTERS]: true,
    [SAAS_FEATURES.SERVICES_CATALOG]: true,
    [SAAS_FEATURES.INVENTORY]: true,
    [SAAS_FEATURES.INVENTORY_ADVANCED]: true,
    [SAAS_FEATURES.COMMISSIONS]: true,
    [SAAS_FEATURES.PAYROLL]: true,
    [SAAS_FEATURES.ATTENDANCE]: true,
    [SAAS_FEATURES.EXPENSES]: true,
    [SAAS_FEATURES.DGII_ECF]: true,
    [SAAS_FEATURES.REPORTS]: true,
    [SAAS_FEATURES.SECURITY]: true,
    [SAAS_FEATURES.CLIENTS]: true,
    [SAAS_FEATURES.MARKETING]: true,
    [SAAS_FEATURES.MEMBERSHIPS]: false,
  }),
});

const DEFAULT_PLAN_LIMITS = Object.freeze({
  [SAAS_PLANS.PRINCIPAL]: Object.freeze({
    users: 3,
    branches: 1,
  }),
});

function readConfiguredPrice(envKey) {
  const raw = process.env[envKey];
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

const MEMBERSHIPS_ADDON_DEFAULT_USD = 99;
const MEMBERSHIPS_ADDON_PRICING_DISPLAY =
  'US$99/mes por sucursal + implementación e integración con pasarela de pago';

function getConfiguredPricing() {
  const principalUsd = readConfiguredPrice('SAAS_PRINCIPAL_PLAN_PRICE_USD');
  const principalDop = readConfiguredPrice('SAAS_PRINCIPAL_PLAN_PRICE_DOP');
  const extraUserUsd = readConfiguredPrice('SAAS_EXTRA_USER_PRICE_USD');
  const extraUserDop = readConfiguredPrice('SAAS_EXTRA_USER_PRICE_DOP');
  const membershipsAddonUsd =
    readConfiguredPrice('SAAS_MEMBERSHIPS_ADDON_PRICE_USD') ?? MEMBERSHIPS_ADDON_DEFAULT_USD;
  const membershipsAddonDop = readConfiguredPrice('SAAS_MEMBERSHIPS_ADDON_PRICE_DOP');

  return {
    principal: {
      usd: principalUsd,
      dop: principalDop,
      extraUserUsd,
      extraUserDop,
      isConfigured: principalUsd !== null || principalDop !== null,
    },
    addons: {
      memberships: {
        usd: membershipsAddonUsd,
        dop: membershipsAddonDop,
        billingUnit: 'per_enabled_branch',
        setupFeeQuotedSeparately: true,
        pricingDisplay: MEMBERSHIPS_ADDON_PRICING_DISPLAY,
        isConfigured: true,
      },
    },
  };
}

const CANONICAL_PLANS_CATALOG = Object.freeze([
  {
    code: SAAS_PLANS.PRINCIPAL,
    name: 'Plan Principal',
    price_monthly: readConfiguredPrice('SAAS_PRINCIPAL_PLAN_PRICE_USD'),
    price_monthly_dop: readConfiguredPrice('SAAS_PRINCIPAL_PLAN_PRICE_DOP'),
    price_per_branch: readConfiguredPrice('SAAS_PRINCIPAL_PLAN_PRICE_USD'),
    users_included: 3,
    extra_user_price: readConfiguredPrice('SAAS_EXTRA_USER_PRICE_USD'),
    branches_included: 1,
    description:
      'Operación integral del salón: POS, cajas, comprobantes DGII e-CF, Clientes/CRM, inventario avanzado multisucursal, compras y proveedores, asistencia facial, nómina, comisiones, marketing y reportes.',
    features: CANONICAL_PLAN_FEATURES[SAAS_PLANS.PRINCIPAL],
    limits: DEFAULT_PLAN_LIMITS[SAAS_PLANS.PRINCIPAL],
  },
]);

const ADDONS_CATALOG = Object.freeze([
  {
    code: SAAS_ADDONS.MEMBERSHIPS,
    feature_key: SAAS_FEATURES.MEMBERSHIPS,
    name: 'Suscripciones y Membresías B2C',
    price_monthly: readConfiguredPrice('SAAS_MEMBERSHIPS_ADDON_PRICE_USD') ?? MEMBERSHIPS_ADDON_DEFAULT_USD,
    price_monthly_dop: readConfiguredPrice('SAAS_MEMBERSHIPS_ADDON_PRICE_DOP'),
    billing_unit: 'per_enabled_branch',
    setup_fee_quoted_separately: true,
    pricing_display: MEMBERSHIPS_ADDON_PRICING_DISPLAY,
    description:
      'Módulo independiente para crear planes de membresía para tus clientes, gestionar contratos digitales y procesar cobros recurrentes B2C.',
  },
]);

function normalizePlanCode(rawCode) {
  if (rawCode === null || rawCode === undefined) return null;
  if (rawCode === 1 || rawCode === '1' || rawCode === 2 || rawCode === '2') {
    return SAAS_PLANS.PRINCIPAL;
  }
  if (typeof rawCode !== 'string') return null;
  const upper = rawCode.trim().toUpperCase();
  if (
    upper === SAAS_PLANS.PRINCIPAL ||
    upper === LEGACY_PLAN_CODES.BASE ||
    upper === LEGACY_PLAN_CODES.PRO
  ) {
    return SAAS_PLANS.PRINCIPAL;
  }
  return null;
}

function isValidPlanCode(rawCode) {
  return normalizePlanCode(rawCode) !== null;
}

function isValidStatus(rawStatus) {
  if (!rawStatus || typeof rawStatus !== 'string') return false;
  const lower = rawStatus.trim().toLowerCase();
  return Object.values(SUBSCRIPTION_STATUSES).includes(lower);
}

function isTransitionAllowed(fromPlan, toPlan) {
  const normFrom = normalizePlanCode(fromPlan);
  const normTo = normalizePlanCode(toPlan);
  return Boolean(normFrom && normTo && normFrom === normTo);
}

module.exports = {
  SAAS_PLANS,
  LEGACY_PLAN_CODES,
  SAAS_ADDONS,
  SUBSCRIPTION_STATUSES,
  SAAS_FEATURES,
  CANONICAL_PLAN_FEATURES,
  DEFAULT_PLAN_LIMITS,
  CANONICAL_PLANS_CATALOG,
  ADDONS_CATALOG,
  getConfiguredPricing,
  normalizePlanCode,
  isValidPlanCode,
  isValidStatus,
  isTransitionAllowed,
};
