/**
 * Catálogo Canónico Oficial de Planes SaaS B2B y Funcionalidades para SalonPro
 * REGLA INNEGOCIABLE: Solo existen dos planes comerciales (BASE y PRO).
 * Prohibido Enterprise, Premium, Business, Free o cualquier tercer nivel.
 */

const SAAS_PLANS = Object.freeze({
  BASE: 'BASE',
  PRO: 'PRO'
});

const SUBSCRIPTION_STATUSES = Object.freeze({
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  SUSPENDED: 'suspended',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired'
});

const SAAS_FEATURES = Object.freeze({
  // Módulos incluidos en ambos planes (Base y Pro)
  POS: 'pos',
  CASH_REGISTERS: 'cash_registers',
  SERVICES_CATALOG: 'services_catalog',
  INVENTORY: 'inventory',
  COMMISSIONS: 'commissions',
  PAYROLL: 'payroll',
  ATTENDANCE: 'attendance',
  EXPENSES: 'expenses',
  DGII_ECF: 'dgii_ecf',
  REPORTS: 'reports',
  SECURITY: 'security',

  // Módulos PRO exclusivos
  CLIENTS: 'clients',
  MEMBERSHIPS: 'memberships',
  MARKETING: 'marketing',
  INVENTORY_ADVANCED: 'inventory_advanced'
});

const CANONICAL_PLAN_FEATURES = Object.freeze({
  [SAAS_PLANS.BASE]: Object.freeze({
    [SAAS_FEATURES.POS]: true,
    [SAAS_FEATURES.CASH_REGISTERS]: true,
    [SAAS_FEATURES.SERVICES_CATALOG]: true,
    [SAAS_FEATURES.INVENTORY]: true,
    [SAAS_FEATURES.COMMISSIONS]: true,
    [SAAS_FEATURES.PAYROLL]: true,
    [SAAS_FEATURES.ATTENDANCE]: true,
    [SAAS_FEATURES.EXPENSES]: true,
    [SAAS_FEATURES.DGII_ECF]: true,
    [SAAS_FEATURES.REPORTS]: true,
    [SAAS_FEATURES.SECURITY]: true,
    [SAAS_FEATURES.CLIENTS]: false,
    [SAAS_FEATURES.MEMBERSHIPS]: false,
    [SAAS_FEATURES.MARKETING]: false,
    [SAAS_FEATURES.INVENTORY_ADVANCED]: false
  }),
  [SAAS_PLANS.PRO]: Object.freeze({
    [SAAS_FEATURES.POS]: true,
    [SAAS_FEATURES.CASH_REGISTERS]: true,
    [SAAS_FEATURES.SERVICES_CATALOG]: true,
    [SAAS_FEATURES.INVENTORY]: true,
    [SAAS_FEATURES.COMMISSIONS]: true,
    [SAAS_FEATURES.PAYROLL]: true,
    [SAAS_FEATURES.ATTENDANCE]: true,
    [SAAS_FEATURES.EXPENSES]: true,
    [SAAS_FEATURES.DGII_ECF]: true,
    [SAAS_FEATURES.REPORTS]: true,
    [SAAS_FEATURES.SECURITY]: true,
    [SAAS_FEATURES.CLIENTS]: true,
    [SAAS_FEATURES.MEMBERSHIPS]: true,
    [SAAS_FEATURES.MARKETING]: true,
    [SAAS_FEATURES.INVENTORY_ADVANCED]: true
  })
});

const DEFAULT_PLAN_LIMITS = Object.freeze({
  [SAAS_PLANS.BASE]: Object.freeze({
    users: 3,
    branches: 1
  }),
  [SAAS_PLANS.PRO]: Object.freeze({
    users: 3,
    branches: 1
  })
});

const CANONICAL_PLANS_CATALOG = Object.freeze([
  {
    code: SAAS_PLANS.BASE,
    name: 'Plan Base',
    price_monthly: 49.0,
    price_per_branch: 49.0,
    users_included: 3,
    extra_user_price: 15.0,
    branches_included: 1,
    description: 'Facturación POS, Comprobantes Fiscales e-CF DGII, Cajas Registradoras, Catálogo, Inventario Operativo de Sucursal, Comisiones y Control de Nómina.',
    features: CANONICAL_PLAN_FEATURES[SAAS_PLANS.BASE],
    limits: DEFAULT_PLAN_LIMITS[SAAS_PLANS.BASE]
  },
  {
    code: SAAS_PLANS.PRO,
    name: 'Plan Pro',
    price_monthly: 99.0,
    price_per_branch: 99.0,
    users_included: 3,
    extra_user_price: 15.0,
    branches_included: 1,
    description: 'Todo lo incluido en Plan Base más Inventario Avanzado Multisucursal, Compras y Proveedores, Directorio CRM de Clientas, Motor de Membresías Plan Beauty y Marketing.',
    features: CANONICAL_PLAN_FEATURES[SAAS_PLANS.PRO],
    limits: DEFAULT_PLAN_LIMITS[SAAS_PLANS.PRO]
  }
]);

function normalizePlanCode(rawCode) {
  if (!rawCode || typeof rawCode !== 'string') return null;
  const upper = rawCode.trim().toUpperCase();
  if (upper === SAAS_PLANS.BASE || upper === SAAS_PLANS.PRO) {
    return upper;
  }
  // Tolerancia solo para identificador numérico legado (1 = BASE, 2 = PRO)
  if (rawCode === '1' || rawCode === 1) return SAAS_PLANS.BASE;
  if (rawCode === '2' || rawCode === 2) return SAAS_PLANS.PRO;
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
  if (!normFrom || !normTo) return false;
  if (normFrom === normTo) return true; // Re-afirmación
  return (
    (normFrom === SAAS_PLANS.BASE && normTo === SAAS_PLANS.PRO) ||
    (normFrom === SAAS_PLANS.PRO && normTo === SAAS_PLANS.BASE)
  );
}

module.exports = {
  SAAS_PLANS,
  SUBSCRIPTION_STATUSES,
  SAAS_FEATURES,
  CANONICAL_PLAN_FEATURES,
  DEFAULT_PLAN_LIMITS,
  CANONICAL_PLANS_CATALOG,
  normalizePlanCode,
  isValidPlanCode,
  isValidStatus,
  isTransitionAllowed
};

