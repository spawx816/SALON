/**
 * Repositorio In-Memory (Fake) para Pruebas Unitarias TDD de Entitlements
 * Reproduce exactamente los contratos de persistencia sin tocar PostgreSQL.
 */
const {
  SAAS_PLANS,
  SUBSCRIPTION_STATUSES,
  CANONICAL_PLANS_CATALOG,
  normalizePlanCode
} = require('../../services/saas_catalog.constants');

class InMemorySaasRepository {
  constructor() {
    this.plans = [...CANONICAL_PLANS_CATALOG];
    this.subscriptions = new Map(); // tenantId -> subscription
    this.overrides = new Map(); // `${tenantId}:${featureKey}` -> override
    this.events = []; // Array of audit events
    this.resourceUsage = new Map(); // `${tenantId}:${resourceKey}` -> count
  }

  // === SaasPlanRepository Interface ===
  async getAllPlans(publicOnly = false) {
    return this.plans;
  }

  async findByCode(planCode) {
    const normalized = normalizePlanCode(planCode);
    if (!normalized) return null;
    return this.plans.find(p => p.code === normalized) || null;
  }

  // === TenantSubscriptionRepository Interface ===
  async findByTenantId(tenantId) {
    if (!tenantId) throw new Error('tenant_id es requerido para consultar la suscripción');
    const sub = this.subscriptions.get(String(tenantId));
    if (!sub) return null;
    return { ...sub };
  }

  async upsertSubscription(tenantId, data) {
    if (!tenantId) throw new Error('tenant_id es requerido para upsert de suscripción');
    const planCode = normalizePlanCode(data.plan_code);
    if (!planCode) throw new Error(`Código de plan inválido: ${data.plan_code}`);

    const existing = this.subscriptions.get(String(tenantId));
    const record = {
      id: existing?.id || `sub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      tenant_id: String(tenantId),
      plan_code: planCode,
      status: data.status || existing?.status || SUBSCRIPTION_STATUSES.ACTIVE,
      current_period_start: data.current_period_start || existing?.current_period_start || new Date(),
      current_period_end: data.current_period_end !== undefined ? data.current_period_end : (existing?.current_period_end || null),
      grace_period_until: data.grace_period_until !== undefined ? data.grace_period_until : (existing?.grace_period_until || null),
      cancel_at_period_end: data.cancel_at_period_end !== undefined ? data.cancel_at_period_end : (existing?.cancel_at_period_end || false),
      created_at: existing?.created_at || new Date(),
      updated_at: new Date()
    };
    this.subscriptions.set(String(tenantId), record);
    return { ...record };
  }

  // === EntitlementsRepository Interface ===
  async findOverridesByTenantId(tenantId) {
    if (!tenantId) throw new Error('tenant_id es requerido para consultar overrides');
    const now = new Date();
    const result = [];
    for (const [key, ov] of this.overrides.entries()) {
      if (ov.tenant_id === String(tenantId)) {
        if (!ov.expires_at || new Date(ov.expires_at) > now) {
          result.push({ ...ov });
        }
      }
    }
    return result;
  }

  async upsertOverride(tenantId, overrideData) {
    if (!tenantId) throw new Error('tenant_id es requerido para upsert de override');
    const { feature_key, is_enabled, reason, actor_id, expires_at } = overrideData;
    if (!feature_key) throw new Error('feature_key es requerido');

    const key = `${tenantId}:${feature_key}`;
    const record = {
      id: `ov_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      tenant_id: String(tenantId),
      feature_key,
      is_enabled: Boolean(is_enabled),
      reason: reason || 'Override administrativo',
      actor_id: actor_id || 'system',
      expires_at: expires_at || null,
      created_at: new Date()
    };
    this.overrides.set(key, record);
    return { ...record };
  }

  async countResourceUsage(tenantId, resourceKey) {
    if (!tenantId) throw new Error('tenant_id es requerido para conteo de recursos');
    const key = `${tenantId}:${resourceKey}`;
    return this.resourceUsage.get(key) || 0;
  }

  setResourceUsage(tenantId, resourceKey, count) {
    const key = `${tenantId}:${resourceKey}`;
    this.resourceUsage.set(key, count);
  }

  // === SubscriptionAuditRepository Interface ===
  async recordEvent(eventData) {
    if (!eventData.tenant_id) throw new Error('tenant_id es requerido para registrar evento de auditoría');
    if (!eventData.new_plan) throw new Error('new_plan es requerido');
    if (!eventData.actor_id) throw new Error('actor_id es requerido');

    const record = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      tenant_id: String(eventData.tenant_id),
      previous_plan: eventData.previous_plan || null,
      new_plan: eventData.new_plan,
      previous_status: eventData.previous_status || 'active',
      new_status: eventData.new_status || 'active',
      reason: eventData.reason || 'Cambio administrativo',
      actor_id: String(eventData.actor_id),
      created_at: new Date()
    };
    this.events.push(record);
    return { ...record };
  }

  async getHistoryByTenantId(tenantId) {
    if (!tenantId) throw new Error('tenant_id es requerido para consultar historial');
    return this.events
      .filter(e => e.tenant_id === String(tenantId))
      .slice()
      .reverse();
  }
}

module.exports = { InMemorySaasRepository };
