/**
 * RBAC & Authorization Policy Middleware
 * (backend/middleware/rbac.middleware.js)
 * 
 * Centralized, fail-closed role-based access control.
 * Strictly derives user identity and privileges from signed JWT payload (req.auth),
 * never from client-controlled headers, query strings or payloads.
 */

'use strict';

const ROLE_HIERARCHY = Object.freeze({
  superadmin: 100,
  propietario: 80,
  owner: 80,
  admin: 60,
  cajero: 40,
  recepcionista: 30,
  estilista: 20,
  empleado: 10,
  cliente_b2c: 0
});

function normalizeRole(role) {
  const r = String(role || '').trim().toLowerCase();
  if (r === 'owner') return 'propietario';
  return r;
}

/**
 * Extracts normalized, authentic role from trusted authentication payload.
 * Actively neutralizes any header or payload spoofing attempt.
 * 
 * @param {import('express').Request} req 
 * @returns {string} Normalized role
 */
function getEffectiveRole(req) {
  if (!req.auth || typeof req.auth !== 'object') {
    return 'anonymous';
  }

  // Explicit B2C client isolation
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

  // Fallback for unrecognized role: lowest privilege
  return 'empleado';
}

/**
 * Express middleware factory enforcing that the authenticated user possesses
 * at least one of the specified allowed roles.
 * 
 * @param  {...string|string[]} allowedRoles 
 */
function requireRole(...allowedRoles) {
  const normalizedAllowed = allowedRoles.flat().map(r => normalizeRole(r));

  return (req, res, next) => {
    const userRole = getEffectiveRole(req);

    if (userRole === 'anonymous') {
      return res.status(401).json({
        error: 'Autenticación requerida para acceder a este recurso.',
        code: 'UNAUTHENTICATED'
      });
    }

    // SuperAdmin can access any tenant management if explicitly authorized
    if (userRole === 'superadmin' && normalizedAllowed.includes('superadmin')) {
      return next();
    }

    if (!normalizedAllowed.includes(userRole)) {
      return res.status(403).json({
        error: 'Acceso denegado: tu rol no tiene permisos para realizar esta operación.',
        code: 'FORBIDDEN_INSUFFICIENT_ROLE',
        currentRole: userRole,
        requiredRoles: normalizedAllowed
      });
    }

    next();
  };
}

/**
 * Checks whether an actor can manage, create, or update a user with targetRole.
 * Prevents horizontal or vertical privilege escalation.
 * 
 * @param {string} actorRole 
 * @param {string} targetRole 
 * @returns {boolean}
 */
function canManageRole(actorRole, targetRole) {
  const actor = normalizeRole(actorRole);
  const target = normalizeRole(targetRole);

  const actorLevel = ROLE_HIERARCHY[actor] ?? -1;
  const targetLevel = ROLE_HIERARCHY[target] ?? -1;

  if (actorLevel < 0 || targetLevel < 0) return false;

  // SuperAdmin can manage anyone
  if (actor === 'superadmin') return true;

  // Propietario can manage anyone within the salon, but NOT superadmin
  if (actor === 'propietario') {
    return target !== 'superadmin';
  }

  // Admin can ONLY manage roles with strictly lower hierarchy level than admin
  if (actor === 'admin') {
    return targetLevel < ROLE_HIERARCHY.admin;
  }

  // Any other role cannot manage users
  return false;
}

module.exports = {
  ROLE_HIERARCHY,
  getEffectiveRole,
  requireRole,
  canManageRole
};
