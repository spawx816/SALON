/**
 * Servicio Central de Entitlements y Gobernanza de Planes SaaS
 * Modelo: Plan Principal único + Add-on independiente de Suscripciones/Membresías B2C.
 */
const {
  SAAS_PLANS,
  SAAS_ADDONS,
  SAAS_FEATURES,
  SUBSCRIPTION_STATUSES,
  CANONICAL_PLAN_FEATURES,
  DEFAULT_PLAN_LIMITS,
  getConfiguredPricing,
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
        let parsedBranches = null;
        if (Array.isArray(ov.enabled_branch_ids)) {
          parsedBranches = ov.enabled_branch_ids.map(String);
        } else if (typeof ov.enabled_branch_ids === 'string') {
          try {
            const p = JSON.parse(ov.enabled_branch_ids);
            if (Array.isArray(p)) parsedBranches = p.map(String);
          } catch { /* ignore malformed */ }
        }
        appliedOverrides[ov.feature_key] = {
          is_enabled: Boolean(ov.is_enabled),
          reason: ov.reason,
          expires_at: ov.expires_at,
          enabled_branch_ids: parsedBranches
        };
      }

      // Límites del plan
      const planLimits = planCode && DEFAULT_PLAN_LIMITS[planCode]
        ? { ...DEFAULT_PLAN_LIMITS[planCode] }
        : { users: 0, branches: 0 };

      // Sucursales activas del tenant (para resolución canónica de alcance por sucursal)
      const activeBranches = typeof this.entitlementsRepo?.findActiveBranchesByTenantId === 'function'
        ? await this.entitlementsRepo.findActiveBranchesByTenantId(tenantId)
        : null;

      // Conteo actual de recursos
      const usersUsage = await this.entitlementsRepo.countResourceUsage(tenantId, 'users');
      const branchesUsage = await this.entitlementsRepo.countResourceUsage(tenantId, 'branches');

      // Add-on Suscripciones/Membresías B2C (separado del plan principal, con procedencia y sucursales habilitadas)
      const membershipsOv = appliedOverrides[SAAS_FEATURES.MEMBERSHIPS];
      let membershipsActive = Boolean(isSubscriptionActive && baseFeatures[SAAS_FEATURES.MEMBERSHIPS]);
      let membershipsSource = 'none';
      if (membershipsOv && membershipsOv.is_enabled) {
        const r = String(membershipsOv.reason || '');
        if (r.startsWith('legacy_pro_transition')) {
          membershipsSource = 'legacy_pro_transition';
        } else if (r.startsWith('commercial_addon')) {
          membershipsSource = 'commercial_addon';
        } else {
          membershipsSource = 'override';
        }
      }

      let resolvedBranchIds = [];
      let resolvedBranches = [];
      if (membershipsActive) {
        const rawBranchIds = membershipsOv?.enabled_branch_ids;
        if (Array.isArray(rawBranchIds)) {
          if (Array.isArray(activeBranches)) {
            const branchMap = new Map(activeBranches.map(b => [String(b.id), b]));
            resolvedBranchIds = [...new Set(rawBranchIds.filter(id => branchMap.has(String(id))))];
            resolvedBranches = resolvedBranchIds.map(id => ({ id, name: branchMap.get(id).name }));
          } else {
            resolvedBranchIds = [...new Set(rawBranchIds)];
            resolvedBranches = resolvedBranchIds.map(id => ({ id, name: id }));
          }
          if (resolvedBranchIds.length === 0) {
            membershipsActive = false;
            baseFeatures[SAAS_FEATURES.MEMBERSHIPS] = false;
          }
        } else {
          resolvedBranchIds = Array.isArray(activeBranches) ? activeBranches.map(b => String(b.id)) : null;
          resolvedBranches = Array.isArray(activeBranches) ? activeBranches.map(b => ({ id: String(b.id), name: b.name })) : [];
        }
      } else if (Object.prototype.hasOwnProperty.call(baseFeatures, SAAS_FEATURES.MEMBERSHIPS)) {
        baseFeatures[SAAS_FEATURES.MEMBERSHIPS] = false;
      }

      const enabledBranchCount = membershipsActive
        ? (Array.isArray(resolvedBranchIds) ? resolvedBranchIds.length : (branchesUsage || 0))
        : 0;

      return {
        hasSubscription: true,
        tenantId,
        plan: planCode,
        currentPlan: planCode,
        rawPlanCode: sub.plan_code,
        status: effectiveStatus,
        subscriptionStatus: effectiveStatus,
        isActive: isSubscriptionActive,
        isSuspended: effectiveStatus === SUBSCRIPTION_STATUSES.SUSPENDED || !isSubscriptionActive,
        currentPeriodStart: sub.current_period_start,
        currentPeriodEnd: sub.current_period_end,
        features: baseFeatures,
        addons: {
          [SAAS_ADDONS.MEMBERSHIPS]: {
            active: membershipsActive,
            source: membershipsActive ? membershipsSource : 'none',
            reason: membershipsOv?.reason || null,
            expiresAt: membershipsOv?.expires_at || null,
            branchIds: membershipsActive ? resolvedBranchIds : [],
            branches: membershipsActive ? resolvedBranches : [],
            enabledBranchCount,
            isLegacyTransition: membershipsActive && membershipsSource === 'legacy_pro_transition'
          }
        },
        overrides: appliedOverrides,
        limits: planLimits,
        pricing: getConfiguredPricing(),
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

  invalidateTenantCache(_tenantId) {
    // La resolución lee estado vigente en PostgreSQL sin caché en memoria obsoleta.
  }

  async hasFeature(tenantId, featureKey, options = {}) {
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

    if (featureKey === SAAS_FEATURES.MEMBERSHIPS && options?.branchId) {
      const enabledBranchIds = entitlements.addons?.[SAAS_ADDONS.MEMBERSHIPS]?.branchIds;
      if (Array.isArray(enabledBranchIds) && !enabledBranchIds.includes(String(options.branchId))) {
        return {
          allowed: false,
          reason: 'El add-on de Suscripciones/Membresías B2C no está habilitado para esta sucursal.',
          code: 'FEATURE_NOT_INCLUDED',
          feature: featureKey,
          branchId: String(options.branchId),
          currentPlan: entitlements.plan
        };
      }
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
      const err = new Error(`Código de plan inválido: ${newPlanCode}.`);
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

    // Regla innegociable: Todo nuevo tenant inicia en Plan PRINCIPAL sin add-ons contratados
    const forcedPlan = SAAS_PLANS.PRINCIPAL;

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
      reason: 'Suscripción inicial de onboarding (Plan Principal)',
      actor_id: actorId
    });

    return sub;
  }

  async setAddonStatus(tenantId, addonCode, { enabled, source = 'commercial_addon', reason, actorId = 'superadmin', expiresAt = null, branchIds } = {}) {
    if (!tenantId) throw new Error('tenantId es obligatorio');
    if (addonCode !== SAAS_ADDONS.MEMBERSHIPS) {
      const err = new Error(`Add-on inválido: ${addonCode}`);
      err.code = 'INVALID_ADDON_CODE';
      throw err;
    }

    const enabledBool = Boolean(enabled);
    const prefix = source === 'legacy_pro_transition' ? 'legacy_pro_transition' : 'commercial_addon';
    const baseReason = reason && String(reason).trim().startsWith(prefix)
      ? String(reason).trim()
      : `${prefix}: ${(reason && String(reason).trim()) || (enabledBool ? 'Add-on Suscripciones/Membresías B2C habilitado' : 'Add-on Suscripciones/Membresías B2C desactivado')}`;

    const pool = this.entitlementsRepo?.pool;
    if (pool && typeof pool.connect === 'function') {
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const tenantRes = await client.query('SELECT id FROM tenants WHERE id = $1 FOR UPDATE', [tenantId]);
        if (!tenantRes.rows || tenantRes.rows.length === 0) {
          const err = new Error('Salón no encontrado');
          err.code = 'TENANT_NOT_FOUND';
          throw err;
        }

        const branchRes = await client.query(
          'SELECT id::text as id, name, COALESCE(is_active, true) as is_active FROM branches WHERE tenant_id = $1 ORDER BY is_main DESC, name ASC',
          [tenantId]
        );
        const tenantBranches = branchRes.rows || [];
        const branchMap = new Map(tenantBranches.map(b => [b.id, b]));

        let normalizedBranchIds = [];
        if (enabledBool) {
          if (Array.isArray(branchIds)) {
            const cleaned = [...new Set(branchIds.map(id => String(id).trim()).filter(Boolean))];
            if (cleaned.length === 0 && tenantBranches.length > 0) {
              const err = new Error('Debes seleccionar al menos una sucursal para activar el add-on.');
              err.code = 'BRANCH_SELECTION_REQUIRED';
              throw err;
            }
            const invalid = cleaned.find(id => !branchMap.has(id));
            if (invalid) {
              const err = new Error('Una o más sucursales seleccionadas no pertenecen a este salón.');
              err.code = 'INVALID_BRANCH_SELECTION';
              throw err;
            }
            normalizedBranchIds = cleaned;
          } else if (branchIds !== undefined && branchIds !== null) {
            const err = new Error('Formato inválido de sucursales para el add-on.');
            err.code = 'INVALID_BRANCH_SELECTION';
            throw err;
          } else {
            const activeOnly = tenantBranches.filter(b => b.is_active).map(b => b.id);
            normalizedBranchIds = activeOnly.length > 0 ? activeOnly : tenantBranches.map(b => b.id);
          }
        }

        const existingRes = await client.query(
          'SELECT is_enabled, reason, enabled_branch_ids FROM tenant_feature_overrides WHERE tenant_id = $1 AND feature_key = $2 FOR UPDATE',
          [tenantId, SAAS_FEATURES.MEMBERSHIPS]
        );
        const existing = existingRes.rows[0] || null;
        const existingBranches = Array.isArray(existing?.enabled_branch_ids)
          ? [...new Set(existing.enabled_branch_ids.map(String))].sort()
          : [];
        const targetBranchesSorted = [...normalizedBranchIds].sort();
        const sameBranches = existingBranches.length === targetBranchesSorted.length
          && existingBranches.every((v, i) => v === targetBranchesSorted[i]);
        const existingPrefix = String(existing?.reason || '').startsWith('legacy_pro_transition')
          ? 'legacy_pro_transition'
          : 'commercial_addon';

        if (existing && Boolean(existing.is_enabled) === enabledBool && (!enabledBool || (sameBranches && existingPrefix === prefix))) {
          await client.query(
            'UPDATE tenants SET has_memberships = $1 WHERE id = $2 AND has_memberships IS DISTINCT FROM $1',
            [enabledBool, tenantId]
          );
          await client.query('COMMIT');
          this.invalidateTenantCache(tenantId);
          const entitlements = await this.getTenantEntitlements(tenantId);
          return {
            ...(entitlements.addons?.[SAAS_ADDONS.MEMBERSHIPS] || {}),
            entitlements,
            idempotent: true
          };
        }

        const branchNames = normalizedBranchIds.map(id => branchMap.get(id)?.name || id);
        const scopeSuffix = enabledBool
          ? (branchNames.length > 0 ? ` [Sucursales: ${branchNames.join(', ')}]` : ' [Sin sucursales]')
          : ' [Alcance: 0 sucursales]';
        const fullReason = `${baseReason}${scopeSuffix}`;

        await this.entitlementsRepo.upsertOverride(tenantId, {
          feature_key: SAAS_FEATURES.MEMBERSHIPS,
          is_enabled: enabledBool,
          reason: fullReason,
          actor_id: actorId,
          expires_at: expiresAt,
          enabled_branch_ids: normalizedBranchIds
        }, client);

        await client.query(
          'UPDATE tenants SET has_memberships = $1 WHERE id = $2',
          [enabledBool, tenantId]
        );

        const subRes = await client.query(
          'SELECT plan_code, status FROM tenant_subscriptions WHERE tenant_id = $1 LIMIT 1',
          [tenantId]
        );
        const currentSub = subRes.rows[0] || null;
        await client.query(
          `INSERT INTO tenant_subscription_events (
            tenant_id, previous_plan, new_plan, previous_status, new_status, reason, actor_id, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
          [
            tenantId,
            currentSub?.plan_code || SAAS_PLANS.PRINCIPAL,
            currentSub?.plan_code || SAAS_PLANS.PRINCIPAL,
            currentSub?.status || 'active',
            currentSub?.status || 'active',
            fullReason,
            String(actorId)
          ]
        );

        await client.query('COMMIT');
        this.invalidateTenantCache(tenantId);
        const entitlements = await this.getTenantEntitlements(tenantId);
        return {
          ...(entitlements.addons?.[SAAS_ADDONS.MEMBERSHIPS] || {}),
          entitlements,
          idempotent: false
        };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    }

    // Fallback para mocks en memoria (pruebas unitarias sin PostgreSQL)
    const mockBranches = Array.isArray(branchIds) ? [...new Set(branchIds.map(String))] : null;
    const override = await this.entitlementsRepo.upsertOverride(tenantId, {
      feature_key: SAAS_FEATURES.MEMBERSHIPS,
      is_enabled: enabledBool,
      reason: baseReason,
      actor_id: actorId,
      expires_at: expiresAt,
      enabled_branch_ids: enabledBool ? mockBranches : []
    });

    const currentSub = await this.subscriptionRepo.findByTenantId(tenantId);
    await this.auditRepo.recordEvent({
      tenant_id: tenantId,
      previous_plan: currentSub?.plan_code || SAAS_PLANS.PRINCIPAL,
      new_plan: currentSub?.plan_code || SAAS_PLANS.PRINCIPAL,
      previous_status: currentSub?.status || 'active',
      new_status: currentSub?.status || 'active',
      reason: baseReason,
      actor_id: actorId
    });

    return override;
  }
}

module.exports = { EntitlementsService };
