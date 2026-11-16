/**
 * RBAC & Authorization Policy Middleware
 * (backend/middleware/rbac.middleware.js)
 *
 * Centralized, fail-closed role-based & permission-based access control.
 * Strictly derives user identity, role, permissions and branch scope from
 * authenticated database state (req.auth), never from client headers or payloads.
 */

'use strict';

const {
  ROLE_HIERARCHY,
  VERIFIED_ROLE_ALIASES,
  permissionMapGrants,
  VALID_CANONICAL_KEYS,
  VALID_LEGACY_KEYS,
} = require('../domain/rbac_catalog');

function normalizeRole(role) {
  const r = String(role || '').trim().toLowerCase();
  return VERIFIED_ROLE_ALIASES[r] || r;
}

/**
 * Extracts normalized, authentic role from trusted authentication payload.
 * Never promotes unknown roles or 'contador' to admin.
 */
function getEffectiveRole(req) {
  if (!req.auth || typeof req.auth !== 'object') {
    return 'anonymous';
  }

  if (req.auth.isClient) {
    return 'cliente_b2c';
  }

  if (req.auth.isSuperAdmin) {
    return 'superadmin';
  }

  const rawRole = normalizeRole(req.auth.role);
  if (rawRole in ROLE_HIERARCHY) {
    return rawRole;
  }

  return 'empleado';
}

/**
 * Express middleware factory enforcing that the authenticated user possesses
 * at least one of the specified allowed system roles.
 */
function requireRole(...allowedRoles) {
  const normalizedAllowed = allowedRoles.flat().map((r) => normalizeRole(r));

  return (req, res, next) => {
    const userRole = getEffectiveRole(req);

    if (userRole === 'anonymous') {
      return res.status(401).json({
        error: 'Autenticación requerida para acceder a este recurso.',
        code: 'UNAUTHENTICATED',
      });
    }

    if (userRole === 'superadmin' && normalizedAllowed.includes('superadmin')) {
      return next();
    }

    if (!normalizedAllowed.includes(userRole)) {
      return res.status(403).json({
        error: 'Acceso denegado: tu rol no tiene permisos para realizar esta operación.',
        code: 'FORBIDDEN_INSUFFICIENT_ROLE',
        currentRole: userRole,
        requiredRoles: normalizedAllowed,
      });
    }

    next();
  };
}

/**
 * Canonical permission middleware (fail-closed).
 * Verifies against persisted role permissions resolved from database in auth.middleware.
 * - Unknown permission keys ALWAYS deny.
 * - B2C clients & SuperAdmin (on tenant operational routes) are ALWAYS denied.
 * - Tenant Owner ('propietario') is granted all tenant operational permissions
 *   (add-on availability is still gated separately by requirePlanFeature).
 * - Other roles must hold at least one of the required permissions in req.auth.permissions.
 */
function requirePermission(...requiredPerms) {
  const permsList = requiredPerms.flat().filter(Boolean);

  return (req, res, next) => {
    const userRole = getEffectiveRole(req);

    if (userRole === 'anonymous') {
      return res.status(401).json({
        error: 'Autenticación requerida para acceder a este recurso.',
        code: 'UNAUTHENTICATED',
      });
    }

    if (userRole === 'cliente_b2c' || req.auth?.isClient) {
      return res.status(403).json({
        error: 'Acceso denegado: operación reservada para personal autorizado.',
        code: 'CLIENT_FORBIDDEN_STAFF_ACTION',
      });
    }

    if (userRole === 'superadmin') {
      return res.status(403).json({
        error: 'Acceso denegado: SuperAdmin pertenece al Control Plane y no opera rutas operativas de empresa.',
        code: 'CONTROL_PLANE_FORBIDDEN_ON_TENANT',
      });
    }

    // Fail-closed if route misconfigured with empty or unknown permission keys
    if (
      permsList.length === 0 ||
      permsList.some((p) => !VALID_CANONICAL_KEYS.has(p) && !VALID_LEGACY_KEYS.has(p))
    ) {
      return res.status(403).json({
        error: 'Acceso denegado: permiso no reconocido.',
        code: 'UNKNOWN_PERMISSION_DENIED',
      });
    }

    // Tenant Owner has full operational permissions within their tenant
    if (userRole === 'propietario') {
      return next();
    }

    // Legacy Admin without a custom role_id retains standard admin operational access
    // (role management & SaaS billing remain protected separately by requireRole('propietario'))
    const hasCustomRole = Boolean(req.auth?.roleId);
    const permsMap = req.auth?.permissions;

    if (userRole === 'admin' && !hasCustomRole) {
      return next();
    }

    const granted = permsList.some((perm) => permissionMapGrants(permsMap, perm));
    if (!granted) {
      return res.status(403).json({
        error: 'Acceso denegado: no cuentas con el permiso requerido para esta acción.',
        code: 'FORBIDDEN_MISSING_PERMISSION',
        requiredPermissions: permsList,
      });
    }

    return next();
  };
}

/**
 * Resolves the user's authorized branch scope inside their tenant.
 * Never assumes tenant-wide branch access for non-owner users unless explicitly configured.
 */
function getBranchScope(req) {
  const userRole = getEffectiveRole(req);
  if (userRole === 'propietario') {
    return { allBranches: true, branchIds: [] };
  }
  if (userRole === 'admin' && !req.auth?.roleId && req.auth?.allBranchesAccess !== false) {
    return { allBranches: true, branchIds: [] };
  }

  const allBranches = Boolean(req.auth?.allBranchesAccess);
  const rawList = Array.isArray(req.auth?.authorizedBranchIds) ? req.auth.authorizedBranchIds : [];
  const normalizedIds = Array.from(
    new Set(
      [
        ...rawList,
        req.auth?.branchId,
      ]
        .filter((v) => v !== undefined && v !== null && String(v).trim() !== '' && String(v) !== 'null')
        .map((v) => String(v).trim())
    )
  );

  return { allBranches, branchIds: normalizedIds };
}

function isBranchAuthorized(req, targetBranchId) {
  const scope = getBranchScope(req);
  if (scope.allBranches) return true;
  if (!targetBranchId || String(targetBranchId) === 'all') return false;
  return scope.branchIds.includes(String(targetBranchId).trim());
}

/**
 * Checks whether an actor can manage, create, or update a user with targetRole.
 */
function canManageRole(actorRole, targetRole) {
  const actor = normalizeRole(actorRole);
  const target = normalizeRole(targetRole);

  const actorLevel = ROLE_HIERARCHY[actor] ?? -1;
  const targetLevel = ROLE_HIERARCHY[target] ?? -1;

  if (actorLevel < 0 || targetLevel < 0) return false;

  if (actor === 'superadmin') return true;
  if (actor === 'propietario') return target !== 'superadmin';
  if (actor === 'admin') return targetLevel < ROLE_HIERARCHY.admin;

  return false;
}

module.exports = {
  ROLE_HIERARCHY,
  normalizeRole,
  getEffectiveRole,
  requireRole,
  requirePermission,
  getBranchScope,
  isBranchAuthorized,
  canManageRole,
};
