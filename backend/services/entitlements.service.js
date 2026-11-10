/**
 * Servicio Central de Entitlements y Gobernanza de Planes SaaS
 * Aplica reglas de autorización, matriz Base/Pro, resolución de overrides y control de límites.
 */
const {
  SAAS_PLANS,
  SUBSCRIPTION_STATUSES,
  CANONICAL_PLAN_FEATURES,
  DEFAULT_PLAN_LIMITS,
  normalizePlanCode,
  isTransitionAllowed
} = require('./saas_catalog.constants');

class EntitlementsService {
  constructor({ saasPlanRepo, subscriptionRepo, entitlementsRepo, auditRepo, clock }) {
    this.saasPlanRepo = saasPlanRepo;
    this.subscriptionRepo = subscriptionRepo;
    this.entitlementsRepo = entitlementsRepo;
    this.auditRepo = auditRepo;
    this.clock = typeof clock === 'function' ? clock : (() => new Date());
  }

  async getTenantEntitlements(tenantId) {
    try {
      if (!tenantId) {
        return {
          hasSubscription: false,
          status: 'none',
          plan: null,
          features: {},
          limits: {},
          usage: {}
        };
      }

      const sub = await this.subscriptionRepo.findByTenantId(tenantId);
      if (!sub) {
        return {
          hasSubscription: false,
          status: 'none',
          plan: null,
          features: {},
          limits: {},
          usage: {}
        };
      }

      const planCode = normalizePlanCode(sub.plan_code);
      const rawStatus = sub.status || SUBSCRIPTION_STATUSES.ACTIVE;
      const now = typeof this.clock === 'function' ? this.clock() : new Date();
      const isPeriodExpired = Boolean(sub.current_period_end && new Date(sub.current_period_end) < now);
      
      let effectiveStatus = rawStatus;
      if (rawStatus === SUBSCRIPTION_STATUSES.CANCELLED && isPeriodExpired) {
        effectiveStatus = SUBSCRIPTION_STATUSES.EXPIRED;
      } else if (rawStatus === SUBSCRIPTION_STATUSES.ACTIVE && isPeriodExpired) {
        effectiveStatus = SUBSCRIPTION_STATUSES.EXPIRED;
      }

      // Reglas canónicas de activación de acceso comercial:
      // - active: acceso normal
      // - past_due: acceso temporal ÚNICAMENTE mientras grace_period_until sea futuro
      // - cancelled: acceso temporal hasta current_period_end
      // - suspended: acceso bloqueado
      // - expired: acceso bloqueado
      let isSubscriptionActive = false;
      if (effectiveStatus === SUBSCRIPTION_STATUSES.ACTIVE) {
        isSubscriptionActive = true;
      } else if (effectiveStatus === SUBSCRIPTION_STATUSES.PAST_DUE) {
        const isGraceActive = Boolean(sub.grace_period_until && new Date(sub.grace_period_until) > now);
        isSubscriptionActive = isGraceActive;
      } else if (effectiveStatus === SUBSCRIPTION_STATUSES.CANCELLED) {
        const isPeriodValid = Boolean(sub.current_period_end && new Date(sub.current_period_end) >= now);
        isSubscriptionActive = isPeriodValid;
      }

      // Base features: Si la suscripción no está activa, ninguna funcionalidad protegida está concedida (FAIL CLOSED)
      let baseFeatures = {};
      if (isSubscriptionActive && planCode && CANONICAL_PLAN_FEATURES[planCode]) {
        baseFeatures = { ...CANONICAL_PLAN_FEATURES[planCode] };
      } else if (planCode && CANONICAL_PLAN_FEATURES[planCode]) {
        for (const k of Object.keys(CANONICAL_PLAN_FEATURES[planCode])) {
          baseFeatures[k] = false;
        }
      }

      // Aplicar Overrides auditables no expirados (si la suscripción está activa)
      const overrides = isSubscriptionActive
        ? await this.entitlementsRepo.findOverridesByTenantId(tenantId)
        : [];

      const appliedOverrides = {};
      for (const ov of overrides) {
        baseFeatures[ov.feature_key] = Boolean(ov.is_enabled);
        appliedOverrides[ov.feature_key] = {
          is_enabled: Boolean(ov.is_enabled),
          reason: ov.reason,
          expires_at: ov.expires_at
        };
      }

      // Límites del plan
      const planLimits = planCode && DEFAULT_PLAN_LIMITS[planCode]
        ? { ...DEFAULT_PLAN_LIMITS[planCode] }
        : { users: 0, branches: 0 };

      // Conteo actual de recursos
      const usersUsage = await this.entitlementsRepo.countResourceUsage(tenantId, 'users');
      const branchesUsage = await this.entitlementsRepo.countResourceUsage(tenantId, 'branches');

      return {
        hasSubscription: true,
        tenantId,
        plan: planCode,
        currentPlan: planCode,
        status: effectiveStatus,
        subscriptionStatus: effectiveStatus,
        isActive: isSubscriptionActive,
        isSuspended: effectiveStatus === SUBSCRIPTION_STATUSES.SUSPENDED || !isSubscriptionActive,
        currentPeriodStart: sub.current_period_start,
        currentPeriodEnd: sub.current_period_end,
        features: baseFeatures,
        overrides: appliedOverrides,
        limits: planLimits,
        usage: {
          users: usersUsage,
          branches: branchesUsage
        }
      };
    } catch (err) {
      // FAIL CLOSED: Error en repositorio o red retorna estado vacío y sin permisos
      return {
        hasSubscription: false,
        status: 'error',
        plan: null,
        features: {},
        limits: {},
        usage: {}
      };
    }
  }

  async hasFeature(tenantId, featureKey) {
    if (!tenantId) {
      return { allowed: false, reason: 'TENANT_REQUIRED', code: 'TENANT_REQUIRED' };
    }

    const entitlements = await this.getTenantEntitlements(tenantId);

    if (!entitlements.hasSubscription) {
      return {
        allowed: false,
        reason: 'El salón no tiene suscripción registrada.',
        code: 'SUBSCRIPTION_NOT_FOUND',
        currentPlan: null
      };
    }

    if (!entitlements.isActive) {
      const statusCode = entitlements.status === SUBSCRIPTION_STATUSES.SUSPENDED
        ? 'SUBSCRIPTION_SUSPENDED'
        : entitlements.status === SUBSCRIPTION_STATUSES.PAST_DUE
        ? 'SUBSCRIPTION_PAST_DUE_GRACE_EXPIRED'
        : entitlements.status === SUBSCRIPTION_STATUSES.CANCELLED
        ? 'SUBSCRIPTION_CANCELLED'
        : entitlements.status === SUBSCRIPTION_STATUSES.EXPIRED
        ? 'SUBSCRIPTION_EXPIRED'
        : 'SUBSCRIPTION_INACTIVE';

      return {
        allowed: false,
        reason: `La suscripción del salón se encuentra ${entitlements.status}.`,
        code: statusCode,
        currentPlan: entitlements.plan
      };
    }

    const hasAccess = Boolean(entitlements.features[featureKey]);
    if (!hasAccess) {
      return {
        allowed: false,
        reason: 'Esta funcionalidad no está incluida en el plan actual.',
        code: 'FEATURE_NOT_INCLUDED',
        feature: featureKey,
        currentPlan: entitlements.plan
      };
    }

    return {
      allowed: true,
      currentPlan: entitlements.plan,
      feature: featureKey
    };
  }

  async checkLimit(tenantId, limitKey) {
    if (!tenantId) {
      return { allowed: false, reason: 'TENANT_REQUIRED', code: 'TENANT_REQUIRED' };
    }

    const entitlements = await this.getTenantEntitlements(tenantId);

    if (!entitlements.hasSubscription || !entitlements.isActive) {
      return {
        allowed: false,
        reason: 'Suscripción no activa.',
        code: 'SUBSCRIPTION_INACTIVE',
        currentPlan: entitlements.plan
      };
    }

    const maxAllowed = entitlements.limits[limitKey] ?? 0;
    const current = entitlements.usage[limitKey] ?? 0;

    if (current >= maxAllowed) {
      return {
        allowed: false,
        reason: 'Has alcanzado el límite permitido por tu plan.',
        code: 'PLAN_LIMIT_REACHED',
        limit: limitKey,
        current,
        maximum: maxAllowed,
        currentPlan: entitlements.plan
      };
    }

    return {
      allowed: true,
      limit: limitKey,
      current,
      maximum: maxAllowed,
      currentPlan: entitlements.plan
    };
  }

  async changeTenantPlan(tenantId, newPlanCode, options = {}) {
    if (!tenantId) throw new Error('tenantId es obligatorio');
    const actorId = typeof options === 'string' ? options : (options.actorId || 'superadmin');
    const reason = typeof options === 'object' ? (options.reason || 'Cambio de plan administrativo') : 'Cambio de plan administrativo';

    const normalizedNew = normalizePlanCode(newPlanCode);
    if (!normalizedNew) {
      const err = new Error(`Código de plan inválido: ${newPlanCode}. Solo se permite BASE o PRO.`);
      err.code = 'INVALID_PLAN_CODE';
      throw err;
    }

    const currentSub = await this.subscriptionRepo.findByTenantId(tenantId);
    const previousPlan = currentSub ? normalizePlanCode(currentSub.plan_code) : null;
    const previousStatus = currentSub ? currentSub.status : 'none';

    if (previousPlan && !isTransitionAllowed(previousPlan, normalizedNew)) {
      const err = new Error(`Transición no permitida de ${previousPlan} a ${normalizedNew}`);
      err.code = 'INVALID_TRANSITION';
      throw err;
    }

    const updated = await this.subscriptionRepo.upsertSubscription(tenantId, {
      plan_code: normalizedNew,
      status: currentSub ? currentSub.status : SUBSCRIPTION_STATUSES.ACTIVE
    });

    await this.auditRepo.recordEvent({
      tenant_id: tenantId,
      previous_plan: previousPlan,
      new_plan: normalizedNew,
      previous_status: previousStatus,
      new_status: updated.status,
      reason,
      actor_id: actorId
    });

    return {
      ...updated,
      previous_plan: previousPlan,
      new_plan: normalizedNew
    };
  }

  async createInitialSubscription(tenantId, options = {}) {
    if (!tenantId) throw new Error('tenantId es obligatorio');
    const actorId = typeof options === 'string' ? options : (options.actorId || 'system');
    const status = (typeof options === 'object' && options.status) ? options.status : SUBSCRIPTION_STATUSES.ACTIVE;

    // Regla innegociable: Todo nuevo tenant inicia en BASE
    const forcedPlan = SAAS_PLANS.BASE;

    const sub = await this.subscriptionRepo.upsertSubscription(tenantId, {
      plan_code: forcedPlan,
      status
    });

    await this.auditRepo.recordEvent({
      tenant_id: tenantId,
      previous_plan: null,
      new_plan: forcedPlan,
      previous_status: null,
      new_status: status,
      reason: 'Suscripción inicial de onboarding (Plan Base)',
      actor_id: actorId
    });

    return sub;
  }
}

module.exports = { EntitlementsService };
