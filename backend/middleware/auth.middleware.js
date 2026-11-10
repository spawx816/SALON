const jwt = require('jsonwebtoken');

/**
 * Validates the JWT secret on startup.
 * Must be at least 32 characters (256-bit entropy).
 * Fails fast and closes process if missing or weak.
 */
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || typeof secret !== 'string' || secret.trim().length < 32) {
    const errorMsg = 'FATAL SECURITY DEFENSE: JWT_SECRET environment variable is missing, empty, or insecure (< 32 characters). Server refuses to start.';
    console.error(`\n❌ [SECURITY HALT] ${errorMsg}\n`);
    throw new Error(errorMsg);
  }
  return secret.trim();
}

const JWT_ISSUER = 'salonpro-saas';
const JWT_AUDIENCE = 'salonpro-app';

// Enforce fail-fast security check immediately upon module load
getJwtSecret();

/**
 * Signs an authenticated payload into a cryptographically verified HS256 JWT.
 */
function signAuthToken(payload, expiresIn = '24h') {
  const secret = getJwtSecret();
  return jwt.sign(payload, secret, {
    algorithm: 'HS256',
    expiresIn,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE
  });
}

/**
 * Verifies an incoming HS256 JWT, enforcing algorithm, signature, expiration, issuer and audience.
 */
function verifyAuthToken(token) {
  if (!token || typeof token !== 'string') {
    const err = new Error('Token no proporcionado');
    err.code = 'TOKEN_MISSING';
    throw err;
  }

  const cleanToken = token.trim();
  const secret = getJwtSecret();

  try {
    return jwt.verify(cleanToken, secret, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      const e = new Error('El token de sesión ha expirado');
      e.code = 'TOKEN_EXPIRED';
      throw e;
    }
    if (err.name === 'JsonWebTokenError') {
      const e = new Error(`Firma o formato de token inválido: ${err.message}`);
      e.code = 'TOKEN_INVALID';
      throw e;
    }
    throw err;
  }
}

/**
 * Extracts authentication token strictly from standard Authorization header or secure HttpOnly cookie.
 * NEVER accepts tokens via query string to prevent leakages in access logs and referrer headers.
 */
function extractTokenFromRequest(req) {
  // 1. Authorization: Bearer <token>
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (authHeader && typeof authHeader === 'string') {
    if (authHeader.toLowerCase().startsWith('bearer ')) {
      return authHeader.slice(7).trim();
    }
    return authHeader.trim();
  }

  // 2. Fallback: HttpOnly cookie (cookie-parser or raw cookie header)
  if (req.cookies && req.cookies.auth_token) {
    return String(req.cookies.auth_token).trim();
  }
  if (req.headers.cookie) {
    const match = req.headers.cookie.match(/(?:^|;\s*)auth_token=([^;]+)/);
    if (match) return decodeURIComponent(match[1]).trim();
  }

  return null;
}

function normalizeCandidateTenantId(val) {
  if (val === undefined || val === null) return null;
  const str = String(val).trim();
  if (!str || str === 'null' || str === 'undefined') return null;
  return str;
}

/**
 * Express Authentication & Multi-Tenant Isolation Middleware Factory
 */
function createAuthMiddleware(pool) {
  // Fail-fast secret check on middleware creation
  getJwtSecret();

  const authenticate = async (req, res, next) => {
    try {
      if (req.auth && req.tenantId !== undefined) {
        return next();
      }

      const token = extractTokenFromRequest(req);
      if (!token) {
        return res.status(401).json({
          valid: false,
          error: 'No autenticado. Debe iniciar sesión para acceder a este recurso.',
          code: 'AUTH_REQUIRED'
        });
      }

      let decoded;
      try {
        decoded = verifyAuthToken(token);
      } catch (verifyErr) {
        return res.status(401).json({
          valid: false,
          error: verifyErr.message || 'Token de sesión inválido o expirado.',
          code: verifyErr.code || 'TOKEN_INVALID'
        });
      }

      const userId = String(decoded.sub || decoded.id || '');
      if (!userId) {
        return res.status(401).json({
          valid: false,
          error: 'Token sin identificador de usuario válido.',
          code: 'TOKEN_INVALID'
        });
      }

      // -------------------------------------------------------------
      // Verificación de Revocación de Sesión Activa y Binding de Usuario (FAIL CLOSED)
      // -------------------------------------------------------------
      const sessionId = decoded.sessionId || null;
      if (sessionId) {
        const [sessionRows] = await pool.query(
          'SELECT is_active, user_id FROM user_sessions WHERE id = ? LIMIT 1',
          [sessionId]
        );
        if (!sessionRows || sessionRows.length === 0 || !sessionRows[0].is_active) {
          return res.status(401).json({
            valid: false,
            error: 'La sesión ha sido revocada o cerrada remotamente.',
            code: 'SESSION_REVOKED'
          });
        }

        // Verificación estricta de pertenencia de sesión
        if (sessionRows[0].user_id && String(sessionRows[0].user_id) !== String(userId)) {
          return res.status(401).json({
            valid: false,
            error: 'Violación de seguridad: La sesión en base de datos no pertenece al usuario del token.',
            code: 'SESSION_USER_MISMATCH'
          });
        }
      }

      let effectiveRole = String(decoded.role || '').toLowerCase();
      let isSuperAdmin = effectiveRole === 'superadmin';
      let userTenantId = null;
      let userBranchId = decoded.branchId || decoded.branch_id || null;
      let userEmail = decoded.email || '';
      let userName = decoded.name || decoded.nombre || '';

      if (decoded.isClient) {
        // Cliente B2C
        const clientTenantId = decoded.tenantId || decoded.tenant_id;
        if (!clientTenantId) {
          return res.status(401).json({ valid: false, error: 'Token de cliente carece de tenant_id.', code: 'MISSING_CLIENT_TENANT' });
        }
        const [clientRows] = await pool.query(
          'SELECT id, tenant_id, nombre, email, status FROM clients WHERE id::text = ? AND tenant_id = ? LIMIT 1',
          [userId, clientTenantId]
        );
        if (!clientRows || clientRows.length === 0) {
          return res.status(401).json({ valid: false, error: 'Cuenta de cliente no encontrada.', code: 'USER_NOT_FOUND' });
        }
        const cRow = clientRows[0];
        if (cRow.status && String(cRow.status).toLowerCase() === 'inactivo') {
          return res.status(403).json({ valid: false, error: 'Cuenta de cliente inactiva.', code: 'USER_INACTIVE' });
        }
        effectiveRole = 'client';
        isSuperAdmin = false;
        userTenantId = cRow.tenant_id;
        userName = cRow.nombre || userName;
        userEmail = cRow.email || userEmail;
      } else {
        // Usuario Administrativo / Staff / SuperAdmin
        const [userRows] = await pool.query(
          'SELECT id, tenant_id, branch_id, salon_id, email, name, nombre, role, role_id, is_active, estado FROM users WHERE id::text = ? LIMIT 1',
          [userId]
        );
        if (!userRows || userRows.length === 0) {
          return res.status(401).json({ valid: false, error: 'Usuario no encontrado o eliminado.', code: 'USER_NOT_FOUND' });
        }
        const uRow = userRows[0];
        const isActive = uRow.is_active !== false && uRow.is_active !== 0 && String(uRow.estado || 'Activo').toLowerCase() !== 'inactivo';
        if (!isActive) {
          return res.status(403).json({ valid: false, error: 'Usuario desactivado o suspendido.', code: 'USER_INACTIVE' });
        }

        effectiveRole = String(uRow.role || decoded.role || 'admin').toLowerCase();
        isSuperAdmin = effectiveRole === 'superadmin';
        userTenantId = isSuperAdmin ? null : uRow.tenant_id;
        userBranchId = uRow.branch_id || uRow.salon_id || userBranchId;
        userName = uRow.name || uRow.nombre || userName;
        userEmail = uRow.email || userEmail;

        if (!isSuperAdmin) {
          if (!userTenantId) {
            return res.status(403).json({
              error: 'El usuario no tiene un salón (Tenant) asignado en base de datos.',
              code: 'TENANT_UNASSIGNED'
            });
          }

          // Validar estado del tenant en la base de datos
          const [tenantRows] = await pool.query(
            'SELECT id, status, business_name, plan_id FROM tenants WHERE id = ? LIMIT 1',
            [userTenantId]
          );
          if (!tenantRows || tenantRows.length === 0) {
            return res.status(403).json({
              error: 'El salón asociado a esta cuenta no existe en el sistema.',
              code: 'TENANT_NOT_FOUND'
            });
          }
          if (tenantRows[0].status && tenantRows[0].status !== 'active') {
            // -------------------------------------------------------------
            // Allowlist estricta de rescate de facturación en suspensión (AUTH-002)
            // -------------------------------------------------------------
            const cleanPath = (req.originalUrl || req.baseUrl + req.path || req.path || '').split('?')[0];
            const method = req.method.toUpperCase();

            const isBillingRescueRoute = (
              // 1. Consulta de suscripción del salón
              (method === 'GET' && (
                cleanPath === '/api/saas/billing/subscription' ||
                cleanPath === '/api/tenant/subscription' ||
                cleanPath === '/api/saas/subscription'
              )) ||
              // 2. Facturas de suscripción y recibos propios
              (method === 'GET' && (
                cleanPath === '/api/saas/billing/invoices' ||
                /^\/api\/saas\/billing\/invoices\/[^/]+\/receipt$/.test(cleanPath)
              )) ||
              // 3. Métodos de pago y pago de deuda pendiente (reactivación)
              (method === 'POST' && (
                cleanPath === '/api/saas/billing/payment-methods' ||
                cleanPath === '/api/saas/billing/pay-debt' ||
                /^\/api\/saas\/billing\/invoices\/[^/]+\/pay$/.test(cleanPath)
              )) ||
              // 4. Cierre de sesión y soporte técnico
              (method === 'POST' && (
                cleanPath === '/api/auth/logout' ||
                cleanPath === '/api/logout'
              )) ||
              ((method === 'GET' || method === 'POST') && cleanPath === '/api/contact')
            );

            if (isBillingRescueRoute) {
              // Exclusivo para PROPIETARIO del salón (o SuperAdmin)
              const role = effectiveRole;
              if (role !== 'propietario' && role !== 'owner' && !isSuperAdmin) {
                return res.status(403).json({
                  error: 'Acceso denegado: solo el propietario del salón puede gestionar la regularización y rescate de facturación en estado de suspensión.',
                  code: 'OWNER_ONLY_SUSPENSION_RESCUE'
                });
              }
              // Permite continuar hacia el endpoint de facturación
            } else {
              return res.status(403).json({
                error: 'La suscripción de este salón se encuentra suspendida o inactiva.',
                code: 'TENANT_SUSPENDED'
              });
            }
          }
        }
      }

      // -------------------------------------------------------------
      // Validación Anti-Spoofing / Anti-IDOR para Usuarios Normales
      // -------------------------------------------------------------
      if (!isSuperAdmin) {
        const headerTenant = normalizeCandidateTenantId(req.headers['x-tenant-id']);
        const queryTenant = normalizeCandidateTenantId(req.query?.tenant_id);
        const bodyTenant = req.body && typeof req.body === 'object' ? normalizeCandidateTenantId(req.body.tenant_id) : null;

        for (const candidate of [headerTenant, queryTenant, bodyTenant]) {
          if (candidate && candidate !== String(userTenantId)) {
            return res.status(403).json({
              error: 'Acceso denegado: No está autorizado para acceder o modificar datos de otro salón (Tenant).',
              code: 'CROSS_TENANT_ACCESS_DENIED'
            });
          }
        }

        req.tenantId = String(userTenantId);
        req.headers['x-tenant-id'] = String(userTenantId);
        req.headers['x-user-role'] = effectiveRole;
        req.headers['x-user-id'] = String(userId);
        req.headers['x-user-name'] = String(userName || userEmail || 'Usuario');
        if (req.query && req.query.tenant_id !== undefined) {
          req.query.tenant_id = String(userTenantId);
        }
        if (req.body && typeof req.body === 'object' && req.body.tenant_id !== undefined) {
          req.body.tenant_id = String(userTenantId);
        }
      } else {
        // SuperAdmin: pertenece ESTRICTAMENTE al Control Plane (req.tenantId = null siempre)
        // Prohibido adoptar x-tenant-id para adoptar contexto operativo de un salón
        const candidateTenant =
          normalizeCandidateTenantId(req.headers['x-tenant-id']) ||
          normalizeCandidateTenantId(req.query?.tenant_id) ||
          (req.body && typeof req.body === 'object' ? normalizeCandidateTenantId(req.body.tenant_id) : null);

        req.tenantId = null;
        req.targetTenantId = candidateTenant;
        delete req.headers['x-tenant-id'];
        if (req.query) delete req.query.tenant_id;

        req.headers['x-user-role'] = 'superadmin';
        req.headers['x-user-id'] = String(userId);
        req.headers['x-user-name'] = String(userName || userEmail || 'SuperAdmin');
      }

      req.auth = {
        id: userId,
        email: userEmail,
        name: userName,
        role: effectiveRole,
        isSuperAdmin,
        isClient: Boolean(decoded.isClient),
        tenantId: req.tenantId,
        branchId: userBranchId,
        sessionId
      };
      req.user = req.auth;

      return next();
    } catch (err) {
      console.error('[AUTH MIDDLEWARE ERROR]:', err);
      return res.status(500).json({ error: 'Error interno en verificación de autenticación.' });
    }
  };

  const requireSuperAdmin = (req, res, next) => {
    if (!req.auth || req.auth.isSuperAdmin !== true || req.auth.role !== 'superadmin') {
      return res.status(403).json({
        error: 'Acceso denegado: Se requieren privilegios verificados de SuperAdmin.',
        code: 'SUPERADMIN_REQUIRED'
      });
    }
    return next();
  };

  const requireTenant = (req, res, next) => {
    if (!req.tenantId) {
      return res.status(403).json({
        error: 'Contexto de salón (Tenant) requerido para esta operación.',
        code: 'TENANT_CONTEXT_REQUIRED'
      });
    }
    return next();
  };

  /**
   * Reject Control Plane role (SuperAdmin) on tenant-owned operational routes
   */
  const rejectControlPlaneRoleOnTenantRoutes = (req, res, next) => {
    const role = String(req.auth?.role || req.headers['x-user-role'] || '').toLowerCase();
    const isSuperAdmin = role === 'superadmin' || Boolean(req.auth?.isSuperAdmin);

    if (isSuperAdmin) {
      return res.status(403).json({
        error: 'Acceso denegado: El rol de SuperAdmin pertenece al plano de control (Control Plane) y tiene estrictamente prohibido operar sobre recursos privados del salón.',
        code: 'CONTROL_PLANE_ROLE_FORBIDDEN'
      });
    }
    return next();
  };

  /**
   * Require Control Plane role (SuperAdmin) on global SaaS management routes
   */
  const requireControlPlaneRole = (req, res, next) => {
    const role = String(req.auth?.role || req.headers['x-user-role'] || '').toLowerCase();
    const isSuperAdmin = role === 'superadmin' || Boolean(req.auth?.isSuperAdmin);

    if (!isSuperAdmin) {
      return res.status(403).json({
        error: 'Acceso denegado: Se requiere rol administrativo de Control Plane (SuperAdmin).',
        code: 'CONTROL_PLANE_ROLE_REQUIRED'
      });
    }
    return next();
  };

  return {
    authenticate,
    requireSuperAdmin,
    requireControlPlaneRole,
    rejectControlPlaneRoleOnTenantRoutes,
    requireTenant,
    signAuthToken,
    verifyAuthToken,
    extractTokenFromRequest,
    getJwtSecret
  };
}

module.exports = {
  createAuthMiddleware,
  rejectControlPlaneRoleOnTenantRoutes: (req, res, next) => {
    const role = String(req.auth?.role || req.headers['x-user-role'] || '').toLowerCase();
    const isSuperAdmin = role === 'superadmin' || Boolean(req.auth?.isSuperAdmin);
    if (isSuperAdmin) {
      return res.status(403).json({
        error: 'Acceso denegado: El rol de SuperAdmin pertenece al plano de control (Control Plane) y tiene estrictamente prohibido operar sobre recursos privados del salón.',
        code: 'CONTROL_PLANE_ROLE_FORBIDDEN'
      });
    }
    return next();
  },
  requireControlPlaneRole: (req, res, next) => {
    const role = String(req.auth?.role || req.headers['x-user-role'] || '').toLowerCase();
    const isSuperAdmin = role === 'superadmin' || Boolean(req.auth?.isSuperAdmin);
    if (!isSuperAdmin) {
      return res.status(403).json({
        error: 'Acceso denegado: Se requiere rol administrativo de Control Plane (SuperAdmin).',
        code: 'CONTROL_PLANE_ROLE_REQUIRED'
      });
    }
    return next();
  },
  signAuthToken,
  verifyAuthToken,
  extractTokenFromRequest,
  getJwtSecret
};
