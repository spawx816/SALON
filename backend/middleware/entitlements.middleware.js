/**
 * Middleware de Autorización por Funcionalidades (Entitlements) y Límites de Plan SaaS
 * REGLA DE ORO: Obtiene el tenant exclusivamente desde req.tenantId (resuelto de forma segura por el middleware de auth).
 * Ignora cualquier tenant_id enviado en headers (x-tenant-id), query, params o body.
 */

function createEntitlementsMiddleware(entitlementsService) {
  if (!entitlementsService) {
    throw new Error('entitlementsService es requerido para instanciar createEntitlementsMiddleware');
  }

  const requirePlanFeature = (featureKey) => {
    return async (req, res, next) => {
      try {
        // Ignorar cualquier tenant_id spoofing
        const tenantId = req.tenantId;

        // Si es SuperAdmin (global o con tenant), se permite acceso irrestricto
        if (req.auth?.isSuperAdmin || req.user?.role === 'superadmin' || req.auth?.role === 'superadmin') {
          return next();
        }

        if (!tenantId) {
          return res.status(403).json({
            error: 'Contexto de salón requerido para validar permisos de plan.',
            code: 'TENANT_REQUIRED'
          });
        }

        const check = await entitlementsService.hasFeature(tenantId, featureKey);

        if (!check.allowed) {
          return res.status(403).json({
            error: check.reason || 'Esta funcionalidad no está incluida en el plan actual.',
            code: check.code || 'FEATURE_NOT_INCLUDED',
            feature: featureKey,
            currentPlan: check.currentPlan || 'BASE'
          });
        }

        req.planCode = check.currentPlan;
        next();
      } catch (err) {
        console.error(`[ENTITLEMENTS ERROR] Fallo al validar feature ${featureKey}:`, err);
        // FAIL CLOSED: Ante cualquier error interno, denegar acceso
        return res.status(403).json({
          error: 'Error interno verificando permisos de plan. Acceso denegado.',
          code: 'ENTITLEMENTS_EVALUATION_FAILED'
        });
      }
    };
  };

  const requireTenantLimit = (limitKey) => {
    return async (req, res, next) => {
      try {
        const tenantId = req.tenantId;

        // Si es SuperAdmin (global o con tenant), se permite acceso irrestricto
        if (req.auth?.isSuperAdmin || req.user?.role === 'superadmin' || req.auth?.role === 'superadmin') {
          return next();
        }

        if (!tenantId) {
          return res.status(403).json({
            error: 'Contexto de salón requerido para validar límites de plan.',
            code: 'TENANT_REQUIRED'
          });
        }

        const check = await entitlementsService.checkLimit(tenantId, limitKey);

        if (!check.allowed) {
          return res.status(403).json({
            error: check.reason || 'Has alcanzado el límite permitido por tu plan.',
            code: check.code || 'PLAN_LIMIT_REACHED',
            limit: limitKey,
            current: check.current,
            maximum: check.maximum
          });
        }

        next();
      } catch (err) {
        console.error(`[LIMITS ERROR] Fallo al validar límite ${limitKey}:`, err);
        return res.status(403).json({
          error: 'Error interno verificando límites de plan. Operación cancelada.',
          code: 'LIMIT_EVALUATION_FAILED'
        });
      }
    };
  };

  return {
    requirePlanFeature,
    requireTenantLimit
  };
}

module.exports = { createEntitlementsMiddleware };

