const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { expandEffectivePermissions } = require('../domain/rbac_catalog');

const SESSION_REPLACED_MESSAGE = 'Tu sesión se cerró porque se inició sesión con esta cuenta en otro dispositivo.';

// Per-user mutex to serialize concurrent login attempts within the Node process
const userSessionLocks = new Map();

async function withUserSessionLock(lockKey, fn) {
  const key = String(lockKey || 'global');
  const prev = userSessionLocks.get(key) || Promise.resolve();
  let release;
  const next = new Promise((resolve) => {
    release = resolve;
  });
  const chain = prev.then(() => next);
  userSessionLocks.set(key, chain);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (userSessionLocks.get(key) === chain) {
      userSessionLocks.delete(key);
    }
  }
}

/**
 * Atomically creates a new active session in `user_sessions` and revokes all prior active sessions
 * for the same user. Serializes concurrent logins per user (in-memory mutex + PostgreSQL advisory xact lock).
 * For kiosk accounts (`isKioskAccount === true`), atomically revokes prior bound `kiosk_devices` and
 * subordinate brief `kiosk_employee_sessions`, then binds the new kiosk device.
 */
async function issueSingleActiveUserSession(pool, {
  userId,
  tenantId = null,
  userName = 'Usuario',
  role = 'empleado',
  salonId = '1',
  ipAddress = '127.0.0.1',
  userAgent = 'Unknown',
  isKioskAccount = false,
  assignedBranchId = null,
  req = null
}) {
  const cleanUserId = String(userId || '').trim();
  if (!cleanUserId) {
    throw new Error('userId es requerido para emitir una sesión.');
  }
  const cleanTenantId = tenantId ? String(tenantId).trim() : null;
  const lockKey = `session_lock:${cleanTenantId || 'global'}:${cleanUserId}`;

  return withUserSessionLock(lockKey, async () => {
    const sessionId = crypto.randomUUID();
    let conn = null;
    const useDedicatedConn = Boolean(
      pool &&
      pool.isPostgres &&
      !pool.isInMemory &&
      typeof pool.getConnection === 'function'
    );

    try {
      const runner = useDedicatedConn ? (conn = await pool.getConnection()) : pool;
      if (useDedicatedConn && typeof conn.beginTransaction === 'function') {
        await conn.beginTransaction();
      }

      if (useDedicatedConn) {
        await runner.query('SELECT pg_advisory_xact_lock(hashtext(?))', [lockKey]);
      }

      // 1. Revocar todas las sesiones activas previas de este mismo usuario
      if (cleanTenantId) {
        await runner.query(
          `UPDATE user_sessions
           SET is_active = 0, device_info = 'replaced_by_new_login'
           WHERE user_id = ? AND tenant_id = ? AND is_active = 1`,
          [cleanUserId, cleanTenantId]
        );
      } else {
        await runner.query(
          `UPDATE user_sessions
           SET is_active = 0, device_info = 'replaced_by_new_login'
           WHERE user_id = ? AND tenant_id IS NULL AND is_active = 1`,
          [cleanUserId]
        );
      }

      // 2. Si es cuenta Kiosco de Asistencia, revocar dispositivos previos y sesiones breves subordinadas, y vincular el nuevo
      let kioskDeviceBind = null;
      if (isKioskAccount && cleanTenantId && assignedBranchId) {
        const {
          KIOSK_DEVICE_COOKIE,
          DEVICE_TTL_MS,
          buildCookieOptions,
          bindKioskDevice,
          revokeDevicesByKioskUser
        } = require('../services/kiosk_device.service');

        await revokeDevicesByKioskUser(runner, {
          tenantId: cleanTenantId,
          userId: cleanUserId,
          reason: 'SESSION_REPLACED'
        });

        const bound = await bindKioskDevice(runner, {
          tenantId: cleanTenantId,
          branchId: String(assignedBranchId),
          deviceName: `Kiosco · ${userName}`,
          actorUserId: cleanUserId,
          actorName: userName
        });

        kioskDeviceBind = {
          cookieName: KIOSK_DEVICE_COOKIE,
          rawToken: bound.rawToken,
          cookieOptions: req ? buildCookieOptions(req, DEVICE_TTL_MS) : { httpOnly: true, path: '/', maxAge: DEVICE_TTL_MS },
          device: bound.device
        };
      }

      // 3. Insertar la nueva sesión única activa
      await runner.query(
        `INSERT INTO user_sessions (
           id, user_id, user_name, role, salon_id, ip_address, user_agent,
           device_info, is_active, created_at, last_activity, tenant_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active_session', 1, NOW(), NOW(), ?)`,
        [
          sessionId,
          cleanUserId,
          userName || 'Usuario',
          String(role || 'empleado').toLowerCase(),
          String(salonId || '1'),
          ipAddress || '127.0.0.1',
          userAgent || 'Unknown',
          cleanTenantId
        ]
      );

      if (useDedicatedConn && typeof conn.commit === 'function') {
        await conn.commit();
      }

      return { sessionId, kioskDeviceBind };
    } catch (err) {
      if (conn && typeof conn.rollback === 'function') {
        await conn.rollback().catch(() => {});
      }
      throw err;
    } finally {
      if (conn && typeof conn.release === 'function') {
        conn.release();
      }
    }
  });
}

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
    if (authHeader.toLowerCase().startsWith('basic ')) {
      // Edge HTTP Basic Auth (Caddy staging barrier) - ignore and fall through to HttpOnly cookie
    } else {
      return authHeader.trim();
    }
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
          'SELECT is_active, user_id, device_info FROM user_sessions WHERE id = ? LIMIT 1',
          [sessionId]
        );
        if (!sessionRows || sessionRows.length === 0 || !sessionRows[0].is_active) {
          let isReplaced = sessionRows?.[0]?.device_info === 'replaced_by_new_login';
          if (
            !isReplaced &&
            sessionRows?.[0] &&
            !['user_logout', 'remote_revoked', 'password_reset'].includes(String(sessionRows[0].device_info || ''))
          ) {
            const [otherActive] = await pool.query(
              'SELECT id FROM user_sessions WHERE user_id = ? AND id != ? AND is_active = 1 LIMIT 1',
              [userId, sessionId]
            ).catch(() => [[]]);
            if (otherActive && otherActive.length > 0) {
              isReplaced = true;
            }
          }

          if (typeof res.clearCookie === 'function') {
            res.clearCookie('auth_token', { path: '/' });
          }

          if (isReplaced) {
            return res.status(401).json({
              valid: false,
              reason: 'session_replaced',
              code: 'SESSION_REPLACED',
              error: SESSION_REPLACED_MESSAGE
            });
          }

          return res.status(401).json({
            valid: false,
            reason: 'session_revoked',
            code: 'SESSION_REVOKED',
            error: 'La sesión ha sido revocada o cerrada remotamente.'
          });
        }

        // Verificación estricta de pertenencia de sesión
        if (sessionRows[0].user_id && String(sessionRows[0].user_id) !== String(userId)) {
          if (typeof res.clearCookie === 'function') {
            res.clearCookie('auth_token', { path: '/' });
          }
          return res.status(401).json({
            valid: false,
            error: 'Violación de seguridad: La sesión en base de datos no pertenece al usuario del token.',
            code: 'SESSION_USER_MISMATCH'
          });
        }
      } else {
        // Si el JWT no incluye sessionId (ej. tokens de prueba), verificar si existen sesiones registradas para el usuario y todas fueron revocadas
        const [userSessRows] = await pool.query(
          'SELECT is_active, device_info FROM user_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 5',
          [userId]
        ).catch(() => [[]]);
        if (Array.isArray(userSessRows) && userSessRows.length > 0) {
          const hasAnyActive = userSessRows.some((r) => Boolean(r.is_active));
          if (!hasAnyActive) {
            return res.status(401).json({
              valid: false,
              reason: 'session_revoked',
              code: 'SESSION_REVOKED',
              error: 'La sesión ha sido revocada o cerrada remotamente.'
            });
          }
        }
      }

      let effectiveRole = String(decoded.role || '').toLowerCase();
      let isSuperAdmin = effectiveRole === 'superadmin';
      let userTenantId = null;
      let userBranchId = decoded.branchId || decoded.branch_id || null;
      let userEmail = decoded.email || '';
      let userName = decoded.name || decoded.nombre || '';
      let userRoleId = null;
      let userRoleName = null;
      let userPermissions = {};
      let authorizedBranchIds = [];
      let allBranchesAccess = false;

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
          'SELECT id, tenant_id, branch_id, salon_id, email, name, nombre, role, role_id, is_active, estado, token_version FROM users WHERE id::text = ? LIMIT 1',
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

        // -------------------------------------------------------------
        // Verificación de Revocación de Token mediante token_version (REM-P1-01)
        // -------------------------------------------------------------
        if (decoded.tokenVersion !== undefined && decoded.tokenVersion !== null) {
          const currentTokenVersion = (uRow.token_version !== undefined && uRow.token_version !== null)
            ? Number(uRow.token_version)
            : 1;
          if (Number(decoded.tokenVersion) !== currentTokenVersion) {
            return res.status(401).json({
              valid: false,
              error: 'El token de sesión ha sido revocado o las credenciales fueron modificadas.',
              code: 'TOKEN_REVOKED'
            });
          }
        }

        effectiveRole = String(uRow.role || decoded.role || 'empleado').toLowerCase();
        isSuperAdmin = effectiveRole === 'superadmin';
        const isPlatformVendedorRole = effectiveRole === 'vendedor' && !uRow.tenant_id;
        userTenantId = (isSuperAdmin || isPlatformVendedorRole) ? null : uRow.tenant_id;
        userBranchId = uRow.branch_id || uRow.salon_id || userBranchId;
        userName = uRow.name || uRow.nombre || userName;
        userEmail = uRow.email || userEmail;
        userRoleId = uRow.role_id || null;

        // Cargar alcance opcional de sucursales (si las columnas ya fueron migradas)
        try {
          const [scopeRows] = await pool.query(
            'SELECT authorized_branch_ids, all_branches_access FROM users WHERE id::text = ? LIMIT 1',
            [userId]
          );
          if (scopeRows && scopeRows[0]) {
            allBranchesAccess = Boolean(scopeRows[0].all_branches_access);
            const rawAuthBranches = scopeRows[0].authorized_branch_ids;
            if (Array.isArray(rawAuthBranches)) {
              authorizedBranchIds = rawAuthBranches.map((v) => String(v));
            } else if (typeof rawAuthBranches === 'string' && rawAuthBranches.trim()) {
              try {
                const parsedBranches = JSON.parse(rawAuthBranches);
                if (Array.isArray(parsedBranches)) {
                  authorizedBranchIds = parsedBranches.map((v) => String(v));
                }
              } catch { /* ignore invalid JSON */ }
            }
          }
        } catch {
          // Pre-migration fallback: usar branch_id único del usuario
        }

        if (!isSuperAdmin && userTenantId && userRoleId) {
          try {
            const [roleRows] = await pool.query(
              'SELECT id, nombre, permisos FROM roles WHERE id = ? AND tenant_id = ? LIMIT 1',
              [userRoleId, userTenantId]
            );
            if (roleRows && roleRows.length > 0) {
              userRoleName = roleRows[0].nombre || null;
              userPermissions = expandEffectivePermissions(roleRows[0].permisos);
            } else {
              // Fail-closed si el role_id no pertenece al tenant o fue eliminado
              userRoleId = null;
              userPermissions = {};
            }
          } catch {
            userPermissions = {};
          }
        }

        const isPlatformVendedor = effectiveRole === 'vendedor' && !userTenantId;

        if (!isSuperAdmin && !isPlatformVendedor) {
          if (!userTenantId) {
            return res.status(403).json({
              error: 'El usuario no tiene una empresa (Tenant) asignado en base de datos.',
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
              error: 'La empresa asociado a esta cuenta no existe en el sistema.',
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
              // 1. Consulta de suscripción, sesión, planes y contexto mínimo de la empresa
              (method === 'GET' && (
                cleanPath === '/api/auth/session-status' ||
                cleanPath === '/api/tenant/entitlements' ||
                cleanPath === '/api/tenant/branding' ||
                cleanPath === '/api/saas/plans' ||
                cleanPath === '/api/saas/billing/plans' ||
                cleanPath === '/api/saas/billing/subscription' ||
                cleanPath === '/api/tenant/subscription' ||
                cleanPath === '/api/saas/subscription'
              )) ||
              // 2. Facturas de suscripción, recibos propios, configuración de checkout, métodos de pago y órdenes CardNet
              (method === 'GET' && (
                cleanPath === '/api/saas/billing/invoices' ||
                cleanPath === '/api/saas/billing/payment-methods' ||
                cleanPath === '/api/saas/billing/terms/status' ||
                cleanPath === '/api/saas/billing/checkout/config' ||
                cleanPath === '/api/saas/billing/checkout/orders' ||
                /^\/api\/saas\/billing\/checkout\/orders\/by-token\/[^/]+$/.test(cleanPath) ||
                /^\/api\/saas\/billing\/checkout\/orders\/[^/]+$/.test(cleanPath) ||
                /^\/api\/saas\/billing\/invoices\/[^/]+\/receipt$/.test(cleanPath)
              )) ||
              // 3. Métodos de pago, cancelación y flujo CardNet Hosted Checkout
              (method === 'POST' && (
                cleanPath === '/api/saas/billing/payment-methods' ||
                cleanPath === '/api/saas/billing/subscription/cancel' ||
                cleanPath === '/api/saas/billing/checkout/orders' ||
                /^\/api\/saas\/billing\/checkout\/orders\/[^/]+\/(initiate-cardnet|verify-cardnet|verify|charge-token|reconcile)$/.test(cleanPath) ||
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
              // Exclusivo para PROPIETARIO de la empresa (o SuperAdmin)
              const role = effectiveRole;
              if (role !== 'propietario' && role !== 'owner' && !isSuperAdmin) {
                return res.status(403).json({
                  error: 'Acceso denegado: solo el propietario de la empresa puede gestionar la regularización y rescate de facturación en estado de suspensión.',
                  code: 'OWNER_ONLY_SUSPENSION_RESCUE'
                });
              }
              // Permite continuar hacia el endpoint de facturación
            } else if (String(tenantRows[0].status).toLowerCase() === 'pending') {
              return res.status(402).json({
                error: 'Debes completar el pago de tu suscripción para acceder al sistema.',
                code: 'PAYMENT_REQUIRED',
                paymentRequired: true
              });
            } else {
              return res.status(403).json({
                error: 'La suscripción de esta empresa se encuentra suspendida o inactiva.',
                code: 'TENANT_SUSPENDED'
              });
            }
          }
        }
      }

      // -------------------------------------------------------------
      // Validación Anti-Spoofing / Anti-IDOR para Usuarios Normales
      // -------------------------------------------------------------
      const isPlatformControlUser = isSuperAdmin || (effectiveRole === 'vendedor' && !userTenantId);
      if (!isPlatformControlUser) {
        const headerTenant = normalizeCandidateTenantId(req.headers['x-tenant-id']);
        const queryTenant = normalizeCandidateTenantId(req.query?.tenant_id);
        const bodyTenant = req.body && typeof req.body === 'object' ? normalizeCandidateTenantId(req.body.tenant_id) : null;

        for (const candidate of [headerTenant, queryTenant, bodyTenant]) {
          if (candidate && candidate !== String(userTenantId)) {
            return res.status(403).json({
              error: 'Acceso denegado: No está autorizado para acceder o modificar datos de otra empresa (Tenant).',
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
        // Control Plane (SuperAdmin / Vendedor de plataforma): req.tenantId = null siempre
        // Prohibido adoptar x-tenant-id para adoptar contexto operativo de una empresa
        const candidateTenant =
          normalizeCandidateTenantId(req.headers['x-tenant-id']) ||
          normalizeCandidateTenantId(req.query?.tenant_id) ||
          (req.body && typeof req.body === 'object' ? normalizeCandidateTenantId(req.body.tenant_id) : null);

        req.tenantId = null;
        req.targetTenantId = candidateTenant;
        delete req.headers['x-tenant-id'];
        if (req.query) delete req.query.tenant_id;

        req.headers['x-user-role'] = isSuperAdmin ? 'superadmin' : effectiveRole;
        req.headers['x-user-id'] = String(userId);
        req.headers['x-user-name'] = String(userName || userEmail || (isSuperAdmin ? 'SuperAdmin' : 'Vendedor'));
      }

      req.auth = {
        id: userId,
        userId: userId,
        email: userEmail,
        name: userName,
        role: effectiveRole,
        roleId: userRoleId,
        roleName: userRoleName,
        permissions: userPermissions,
        authorizedBranchIds,
        allBranchesAccess,
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
        error: 'Contexto de empresa (Tenant) requerido para esta operación.',
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
        error: 'Acceso denegado: El rol de SuperAdmin pertenece al plano de control (Control Plane) y tiene estrictamente prohibido operar sobre recursos privados de la empresa.',
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

  /**
   * Rejects requests made with B2C Client tokens on staff/operational routes (REM-P1-05)
   */
  const rejectClientRoleOnStaffRoutes = (req, res, next) => {
    const isClient = Boolean(req.auth?.isClient) || String(req.auth?.role || req.headers['x-user-role'] || '').toLowerCase() === 'client';
    if (isClient) {
      return res.status(403).json({
        error: 'Acceso denegado: Clientes no tienen autorización para acceder a módulos operativos o de personal de la empresa.',
        code: 'CLIENT_ROLE_FORBIDDEN'
      });
    }
    return next();
  };

  return {
    authenticate,
    requireSuperAdmin,
    requireControlPlaneRole,
    rejectControlPlaneRoleOnTenantRoutes,
    rejectClientRoleOnStaffRoutes,
    requireTenant,
    signAuthToken,
    verifyAuthToken,
    extractTokenFromRequest,
    getJwtSecret,
    issueSingleActiveUserSession,
    SESSION_REPLACED_MESSAGE
  };
}

module.exports = {
  createAuthMiddleware,
  rejectControlPlaneRoleOnTenantRoutes: (req, res, next) => {
    const role = String(req.auth?.role || req.headers['x-user-role'] || '').toLowerCase();
    const isSuperAdmin = role === 'superadmin' || Boolean(req.auth?.isSuperAdmin);
    if (isSuperAdmin) {
      return res.status(403).json({
        error: 'Acceso denegado: El rol de SuperAdmin pertenece al plano de control (Control Plane) y tiene estrictamente prohibido operar sobre recursos privados de la empresa.',
        code: 'CONTROL_PLANE_ROLE_FORBIDDEN'
      });
    }
    return next();
  },
  rejectClientRoleOnStaffRoutes: (req, res, next) => {
    const isClient = Boolean(req.auth?.isClient) || String(req.auth?.role || req.headers['x-user-role'] || '').toLowerCase() === 'client';
    if (isClient) {
      return res.status(403).json({
        error: 'Acceso denegado: Clientes no tienen autorización para acceder a módulos operativos o de personal de la empresa.',
        code: 'CLIENT_ROLE_FORBIDDEN'
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
  getJwtSecret,
  issueSingleActiveUserSession,
  SESSION_REPLACED_MESSAGE
};
