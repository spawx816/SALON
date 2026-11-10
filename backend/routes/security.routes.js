const express = require('express');
const nodemailer = require('nodemailer');
const { requireRole } = require('../middleware/rbac.middleware');
const { validatePinComplexity, hashPin, verifyPin, verifyLegacyPinForRotation } = require('../services/pin_security.service');

// Actor-specific PIN lockout tracker for non-owners to prevent employee DoS on owner PIN
const actorPinLockouts = new Map();

/**
 * Helper to get clean client IP address
 */
function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
         req.socket?.remoteAddress || 
         req.ip || 
         '127.0.0.1';
}

/**
 * Security, Auth Monitor, Sessions & PIN Router
 * Scoped strictly by tenant_id (Multi-Tenant Architecture)
 * 
 * @param {import('mysql2/promise').Pool} pool
 */
function createSecurityRouter(pool) {
  const router = express.Router();

  // Helper middleware to strictly require verified tenant context
  const requireTenant = (req, res, next) => {
    // Gateway endpoints like /login-attempts, /unblock-ip can be accessed by SuperAdmin without tenantId
    const isSuperAdmin = req.auth?.isSuperAdmin;
    const tenantId = req.tenantId || req.auth?.tenantId;
    if (!tenantId && !isSuperAdmin) {
      return res.status(401).json({ error: 'Contexto de tenant requerido para operaciones de seguridad.' });
    }
    req.verifiedTenantId = tenantId;
    next();
  };

  router.use(requireTenant);

  const logSecurityAudit = async (userId, userName, action, details, req, tenantId) => {
    try {
      const ip = getClientIp(req);
      const userAgent = req.headers['user-agent'] || 'Unknown';
      await pool.query(`
        INSERT INTO security_audit_logs (user_id, user_name, action, details, ip_address, user_agent, tenant_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [userId || 'SYSTEM', userName || 'Sistema', action, details || '', ip, userAgent, tenantId || null]);
    } catch (e) {
      console.error('[SECURITY AUDIT LOG ERROR]:', e.message);
    }
  };

  // Helper to get or initialize security settings for a tenant
  const getTenantSecuritySettings = async (tenantId) => {
    if (!tenantId) return null;
    const [rows] = await pool.query(
      'SELECT * FROM security_settings WHERE tenant_id = ? LIMIT 1',
      [tenantId]
    );
    if (rows.length > 0) return rows[0];

    // Create default security settings row for this tenant
    try {
      await pool.query(`
        INSERT INTO security_settings (tenant_id, max_login_attempts, lockout_duration_minutes, require_pin_for_discounts, session_timeout_minutes, require_pin_for_settings, lockout_minutes, max_failed_attempts)
        VALUES (?, 5, 30, true, 45, true, 30, 5)
        ON CONFLICT DO NOTHING
      `, [tenantId]);
      const [newRows] = await pool.query(
        'SELECT * FROM security_settings WHERE tenant_id = ? LIMIT 1',
        [tenantId]
      );
      return newRows[0] || null;
    } catch(e) {
      return null;
    }
  };

  // 1. Solicitar código de autorización dinámico para descuento / cambio de precio
  router.post('/request-auth', async (req, res) => {
    try {
      const tenantId = req.verifiedTenantId;
      if (!tenantId) return res.status(401).json({ error: 'Tenant context required' });

      const { clientId, clientName, serviceName, staffName, type } = req.body;
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const sName = serviceName || 'Autorización de Descuento / Ajuste de Precio';
      const cName = clientName || 'Cliente General (Recepción POS)';
      const stName = staffName || 'Caja Recepción';

      // Invalidate previous pending requests of the same client in this tenant
      try {
        await pool.query(
          "UPDATE security_requests SET status = 'cancelled' WHERE client_id = ? AND status = 'pending' AND tenant_id = ?",
          [clientId || 'POS', tenantId]
        );
      } catch(e) {}

      const [result] = await pool.query(
        `INSERT INTO security_requests (client_id, client_name, service_name, staff_name, auth_code, type, status, expires_at, created_at, tenant_id)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', NOW() + INTERVAL '15 MINUTE', NOW(), ?)`,
        [clientId || 'POS', cName, sName, stName, code, type || 'discount_price', tenantId]
      );

      res.json({
        success: true,
        requestId: result.insertId,
        code: code,
        message: 'Solicitud de autorización generada exitosamente'
      });
    } catch (err) {
      console.error('[SECURITY REQUEST AUTH ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 2. Verificar código o PIN de autorización (NO HARDCODED BYPASS)
  router.post('/verify-auth', async (req, res) => {
    try {
      const tenantId = req.verifiedTenantId;
      if (!tenantId) return res.status(401).json({ error: 'Tenant context required' });

      const { pin, code, requestId } = req.body;
      const cleanPin = String(pin || code || '').trim();
      if (!cleanPin) {
        return res.status(400).json({ success: false, valid: false, error: 'Ingresa un PIN o código válido.' });
      }

      // 1. Consultar PIN dinámico y OTP en tiempo real desde la tabla security_settings para este tenant
      const secSettings = await getTenantSecuritySettings(tenantId);

      let isPinAuthorized = false;
      let authorizedRole = 'PIN Administrador';

      if (secSettings) {
        const { admin_pin, active_otp_pin, otp_expires_at } = secSettings;
        
        // PIN OTP dinámico (si está activo y no ha expirado)
        if (active_otp_pin && cleanPin === String(active_otp_pin).trim()) {
          const isExpired = otp_expires_at && new Date(otp_expires_at) < new Date();
          if (!isExpired) {
            isPinAuthorized = true;
            authorizedRole = 'PIN OTP Dinámico (Correo)';
          }
        }
        
        // PIN Maestro configurado en la base de datos para este inquilino
        if (!isPinAuthorized && admin_pin && cleanPin === String(admin_pin).trim()) {
          isPinAuthorized = true;
          authorizedRole = 'PIN Maestro Administrador';
        }
      }

      if (isPinAuthorized) {
        if (requestId) {
          try { 
            await pool.query(
              "UPDATE security_requests SET status = 'authorized' WHERE id::text = ? AND tenant_id = ?", 
              [String(requestId), tenantId]
            ); 
          } catch(e){}
        }
        await logSecurityAudit(
          req.headers['x-user-id'] || 'admin', 
          req.headers['x-user-name'] || 'Administrador', 
          'AUTH_PIN_VERIFIED', 
          `Autorización de seguridad aprobada mediante ${authorizedRole}`, 
          req,
          tenantId
        );
        return res.json({ success: true, valid: true, authorizedBy: authorizedRole });
      }

      // 2. Verificar código de solicitud dinámica en security_requests para este tenant
      const [secRows] = await pool.query(
        `SELECT id, client_name, service_name FROM security_requests 
         WHERE auth_code = ? AND status = 'pending' AND tenant_id = ? AND (expires_at IS NULL OR expires_at >= NOW()) 
         ORDER BY created_at DESC LIMIT 1`,
        [cleanPin, tenantId]
      );

      if (secRows.length > 0) {
        await pool.query(
          "UPDATE security_requests SET status = 'authorized' WHERE id = ? AND tenant_id = ?", 
          [secRows[0].id, tenantId]
        );
        await logSecurityAudit(
          req.headers['x-user-id'] || 'pos', 
          req.headers['x-user-name'] || 'Recepción POS', 
          'AUTH_CODE_VERIFIED', 
          `Código de solicitud #${secRows[0].id} autorizado para "${secRows[0].service_name}"`, 
          req,
          tenantId
        );
        return res.json({ 
          success: true, 
          valid: true, 
          authorizedBy: `Monitor de Seguridad (${secRows[0].service_name})` 
        });
      }

      // 3. Verificar en tabla verification_codes para este tenant
      const [verRows] = await pool.query(
        `SELECT id FROM verification_codes 
         WHERE code = ? AND is_used = 0 AND tenant_id = ? AND (expires_at IS NULL OR expires_at >= NOW()) 
         ORDER BY created_at DESC LIMIT 1`,
        [cleanPin, tenantId]
      );

      if (verRows.length > 0) {
        await pool.query(
          "UPDATE verification_codes SET is_used = 1 WHERE id = ? AND tenant_id = ?", 
          [verRows[0].id, tenantId]
        );
        return res.json({ success: true, valid: true, authorizedBy: 'Código de Membresía' });
      }

      // Auditoría de intento fallido
      await logSecurityAudit(
        req.headers['x-user-id'] || 'guest', 
        req.headers['x-user-name'] || 'Intento no autorizado', 
        'AUTH_PIN_FAILED', 
        'Intento fallido de autorización con PIN o código incorrecto', 
        req,
        tenantId
      );

      return res.status(401).json({ success: false, valid: false, error: 'Clave PIN o código de autorización incorrecto o expirado.' });
    } catch (err) {
      console.error('[SECURITY VERIFY AUTH ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 3. Log de solicitud (Scoped by tenant_id)
  router.post('/log-request', async (req, res) => {
    const tenantId = req.verifiedTenantId;
    if (!tenantId) return res.status(401).json({ error: 'Tenant context required' });

    const { clientId, clientName, serviceName, staffName } = req.body;
    try {
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      await pool.query(
        `INSERT INTO security_requests (client_id, client_name, service_name, staff_name, auth_code, status, expires_at, created_at, tenant_id)
         VALUES (?, ?, ?, ?, ?, 'pending', NOW() + INTERVAL '15 MINUTE', NOW(), ?)`,
        [clientId || 'POS', clientName || 'Cliente General', serviceName, staffName, code, tenantId]
      );
      res.json({ success: true, code });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 4. Lista de solicitudes activas para el Monitor de Seguridad (Scoped by tenant_id)
  router.get('/requests', async (req, res) => {
    try {
      const tenantId = req.verifiedTenantId;
      if (!tenantId) return res.json([]);

      const [requests] = await pool.query(`
        SELECT 
          id,
          COALESCE(client_name, 'Cliente General') as client_name,
          client_id,
          service_name,
          COALESCE(staff_name, 'Staff Recepción') as staff_name,
          auth_code as active_code,
          type,
          status,
          created_at,
          expires_at
        FROM security_requests
        WHERE tenant_id = ?
          AND status = 'pending' 
          AND (expires_at IS NULL OR expires_at >= NOW())
          AND created_at >= (NOW() - INTERVAL '2 hours')
        ORDER BY created_at DESC
      `, [tenantId]);

      const [otpCodes] = await pool.query(`
        SELECT 
          vc.id,
          COALESCE(c.nombre, 'Cliente Plan Beauty') as client_name,
          c.id as client_id,
          'Canje de Membresía Plan Beauty' as service_name,
          'Recepción POS' as staff_name,
          vc.code as active_code,
          'membership_otp' as type,
          'pending' as status,
          vc.created_at,
          vc.expires_at
        FROM verification_codes vc
        LEFT JOIN clients c ON vc.client_id = c.id AND c.tenant_id = vc.tenant_id
        WHERE vc.tenant_id = ?
          AND vc.is_used = 0 
          AND (vc.expires_at IS NULL OR vc.expires_at >= NOW())
          AND vc.created_at >= (NOW() - INTERVAL '2 hours')
        ORDER BY vc.created_at DESC
      `, [tenantId]);

      const seenCodes = new Set();
      const combined = [];

      (requests || []).forEach(r => {
        if (r.active_code && !seenCodes.has(r.active_code)) {
          seenCodes.add(r.active_code);
          combined.push(r);
        }
      });

      (otpCodes || []).forEach(o => {
        if (o.active_code && !seenCodes.has(o.active_code)) {
          seenCodes.add(o.active_code);
          combined.push(o);
        }
      });

      res.json(combined);
    } catch (err) {
      console.error('Error fetching security requests:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 5. Monitoreo de Sesiones Activas en Tiempo Real (Scoped by tenant_id)
  router.get('/sessions', async (req, res) => {
    try {
      const tenantId = req.verifiedTenantId;
      const isSuperAdmin = req.auth?.isSuperAdmin;

      await pool.query(`
        UPDATE user_sessions 
        SET is_active = 0 
        WHERE is_active = 1 
          AND (tenant_id = ? OR ?::boolean = true)
          AND (last_activity < (NOW() - INTERVAL '45 MINUTE') OR last_activity IS NULL)
      `, [tenantId || '00000000-0000-0000-0000-000000000000', Boolean(isSuperAdmin)]);

      let whereClauses = [
        "s.is_active = 1",
        "s.last_activity >= (NOW() - INTERVAL '45 MINUTE')"
      ];
      let params = [];

      if (!isSuperAdmin) {
        whereClauses.push("s.tenant_id = ?");
        params.push(tenantId);
      } else if (tenantId) {
        whereClauses.push("s.tenant_id = ?");
        params.push(tenantId);
      }

      const [activeRows] = await pool.query(`
        SELECT s.*, 
               COALESCE(u.nombre, s.user_name) as user_name,
               u.email as user_email,
               COALESCE(r.nombre, s.role, 'Usuario') as role,
               COALESCE(sal.name, 'Global') as salon_name
        FROM user_sessions s
        LEFT JOIN users u ON s.user_id = u.id::text AND u.tenant_id = s.tenant_id
        LEFT JOIN roles r ON u.role_id = r.id AND r.tenant_id = s.tenant_id
        LEFT JOIN salons sal ON COALESCE(s.salon_id, u.branch_id::text, u.salon_id, '1') = sal.id AND sal.tenant_id = s.tenant_id
        WHERE ${whereClauses.join(' AND ')}
        ORDER BY s.last_activity DESC
      `, params);

      res.json(activeRows);
    } catch (err) {
      console.error('[SECURITY SESSIONS ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 6. Cierre Forzado Remoto de Sesión (Scoped by tenant_id)
  router.post('/sessions/terminate', async (req, res) => {
    try {
      const tenantId = req.verifiedTenantId;
      const isSuperAdmin = req.auth?.isSuperAdmin;
      const { sessionId, userId } = req.body;

      if (!isSuperAdmin && !tenantId) return res.status(401).json({ error: 'Tenant context required' });

      if (sessionId) {
        await pool.query(
          'UPDATE user_sessions SET is_active = 0 WHERE id = ? AND (tenant_id = ? OR ?::boolean = true)',
          [sessionId, tenantId || '00000000-0000-0000-0000-000000000000', Boolean(isSuperAdmin)]
        );
      } else if (userId) {
        await pool.query(
          'UPDATE user_sessions SET is_active = 0 WHERE user_id = ? AND (tenant_id = ? OR ?::boolean = true)',
          [userId, tenantId || '00000000-0000-0000-0000-000000000000', Boolean(isSuperAdmin)]
        );
      }

      await logSecurityAudit(
        req.headers['x-user-id'] || 'admin', 
        req.headers['x-user-name'] || 'Administrador', 
        'REMOTE_SESSION_TERMINATE', 
        `Sesión finalizada forzosamente: ${sessionId ? `Sesión ID ${sessionId}` : `Usuario ID ${userId}`}`, 
        req,
        tenantId
      );
      res.json({ success: true, message: 'Sesión terminada exitosamente' });
    } catch (err) {
      console.error('[SECURITY TERMINATE SESSION ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 7. Auditoría de Actividad y Trazabilidad (Scoped by tenant_id)
  router.get('/audit-logs', async (req, res) => {
    try {
      const tenantId = req.verifiedTenantId;
      const isSuperAdmin = req.auth?.isSuperAdmin;
      const limit = parseInt(req.query.limit) || 150;

      let query = 'SELECT * FROM security_audit_logs';
      const params = [];

      if (!isSuperAdmin || tenantId) {
        query += ' WHERE tenant_id = ?';
        params.push(tenantId);
      }

      query += ' ORDER BY id DESC LIMIT ?';
      params.push(limit);

      const [rows] = await pool.query(query, params);
      res.json(rows);
    } catch (err) {
      console.error('[SECURITY AUDIT LOGS ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 8. Intentos de Entrada y Bloqueos (Gateway Level)
  router.get('/login-attempts', async (req, res) => {
    try {
      const [attempts] = await pool.query(`
        SELECT * FROM login_attempts 
        ORDER BY id DESC 
        LIMIT 100
      `);
      const [blockedIps] = await pool.query(`
        SELECT * FROM blocked_ips 
        WHERE blocked_until IS NULL OR blocked_until > NOW()
        ORDER BY id DESC
      `);
      const [blockedAccounts] = await pool.query(`
        SELECT * FROM account_lockouts 
        WHERE blocked_until IS NULL OR blocked_until > NOW()
        ORDER BY id DESC
      `);
      res.json({ attempts, blockedIps, blockedAccounts });
    } catch (err) {
      console.error('[SECURITY LOGIN ATTEMPTS ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 9. Desbloqueo Manual de IP o Cuenta (Gateway Level)
  router.post('/unblock-ip', async (req, res) => {
    try {
      const { ip_address, account_identifier } = req.body;
      if (!ip_address && !account_identifier) return res.status(400).json({ error: 'IP o Cuenta requerida' });

      if (ip_address) {
        await pool.query('DELETE FROM blocked_ips WHERE ip_address = ?', [ip_address]);
        await pool.query('DELETE FROM login_attempts WHERE ip_address = ? AND status = ?', [ip_address, 'failed']);
      }
      if (account_identifier) {
        await pool.query('DELETE FROM account_lockouts WHERE account_identifier = ?', [account_identifier]);
        await pool.query('DELETE FROM login_attempts WHERE email_or_cedula = ? AND status = ?', [account_identifier, 'failed']);
      }

      const target = account_identifier || ip_address;
      await logSecurityAudit(
        req.headers['x-user-id'] || 'admin', 
        req.headers['x-user-name'] || 'Administrador', 
        'SECURITY_UNBLOCKED_MANUALLY', 
        `Desbloqueo manual aplicado para: ${target}`, 
        req,
        req.verifiedTenantId
      );

      res.json({ success: true, message: `Desbloqueo para ${target} realizado correctamente.` });
    } catch (err) {
      console.error('[SECURITY UNBLOCK ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/unblock-account', async (req, res) => {
    try {
      const { account_identifier } = req.body;
      if (!account_identifier) return res.status(400).json({ error: 'Identificador de cuenta requerido' });

      await pool.query('DELETE FROM account_lockouts WHERE account_identifier = ?', [account_identifier]);
      await pool.query('DELETE FROM login_attempts WHERE email_or_cedula = ? AND status = ?', [account_identifier, 'failed']);

      await logSecurityAudit(
        req.headers['x-user-id'] || 'admin', 
        req.headers['x-user-name'] || 'Administrador', 
        'ACCOUNT_UNBLOCKED_MANUALLY', 
        `Cuenta desbloqueada manualmente: ${account_identifier}`, 
        req,
        req.verifiedTenantId
      );

      res.json({ success: true, message: `Cuenta ${account_identifier} desbloqueada correctamente.` });
    } catch (err) {
      console.error('[SECURITY UNBLOCK ACCOUNT ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 10. Obtener Configuración de Seguridad & PIN (Scoped by tenant_id)
  router.get('/settings', (req, res, next) => {
    const role = (req.auth?.role || req.headers['x-user-role'] || '').toLowerCase();
    if (role === 'superadmin' || req.auth?.isSuperAdmin) {
      return res.status(403).json({
        error: 'Acceso denegado: El rol de SuperAdmin pertenece al plano de control (Control Plane) y tiene estrictamente prohibido operar sobre recursos privados del salón.',
        code: 'CONTROL_PLANE_ROLE_FORBIDDEN'
      });
    }
    next();
  }, requireRole('propietario', 'owner', 'admin'), async (req, res) => {
    try {
      const tenantId = req.verifiedTenantId || req.tenantId || req.auth?.tenantId;
      if (!tenantId) return res.status(401).json({ error: 'Tenant context required' });

      const settings = await getTenantSecuritySettings(tenantId);
      if (!settings) {
        return res.json({
          require_pin_for_settings: 1,
          pin_notification_emails: '',
          max_failed_attempts: 5,
          lockout_minutes: 30,
          is_pin_configured: false
        });
      }

      // NUNCA exponer admin_pin ni admin_pin_hash al cliente
      const { admin_pin, admin_pin_hash, active_otp_pin, ...safeSettings } = settings;
      const isConfigured = Boolean(admin_pin || admin_pin_hash);
      const isLegacy = Boolean(admin_pin && !String(admin_pin).startsWith('$2'));

      res.json({
        ...safeSettings,
        is_pin_configured: isConfigured,
        is_pin_legacy: isLegacy
      });
    } catch (err) {
      console.error('[SECURITY GET SETTINGS ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 11. Guardar Configuración de Seguridad & PIN (Scoped by tenant_id)
  router.post('/settings', requireRole('propietario', 'superadmin'), async (req, res) => {
    try {
      const isSuperAdmin = (req.auth?.role || req.headers['x-user-role'] || '').toLowerCase() === 'superadmin' || Boolean(req.auth?.isSuperAdmin);
      const tenantId = req.verifiedTenantId || req.tenantId || req.auth?.tenantId || (isSuperAdmin ? req.targetTenantId || req.body?.tenant_id : null);
      if (!tenantId) return res.status(401).json({ error: 'Tenant context required' });

      const {
        require_pin_for_settings,
        pin_notification_emails,
        max_failed_attempts,
        lockout_minutes,
        admin_pin,
        current_pin
      } = req.body;

      // Obtener configuración actual para verificar si ya existe un PIN
      const currentSettings = await getTenantSecuritySettings(tenantId);
      const existingPin = currentSettings?.admin_pin_hash || currentSettings?.admin_pin;

      const userRole = (req.auth?.role || req.headers['x-user-role'] || '').toLowerCase();

      let hashedNewPin = null;
      if (admin_pin !== undefined && admin_pin !== null && String(admin_pin).trim() !== '') {
        const pinComplexity = validatePinComplexity(admin_pin);
        if (!pinComplexity.valid) {
          return res.status(400).json({
            error: pinComplexity.reason,
            code: 'WEAK_PIN_REJECTED'
          });
        }

        // Si es SuperAdmin, NUNCA puede cambiar el PIN silenciosamente: requiere ticket y motivo formal
        if (isSuperAdmin) {
          const { support_ticket_id, support_reason } = req.body;
          if (!support_ticket_id || !support_reason || String(support_reason).trim().length < 10) {
            return res.status(400).json({
              error: 'SuperAdmin requiere obligatoriamente un número de ticket de soporte (support_ticket_id) y motivo justificado (support_reason, mín 10 caracteres) para modificar el PIN.',
              code: 'SUPPORT_AUTHORIZATION_REQUIRED'
            });
          }

          // Auditoría inmutable de soporte técnico (nunca expone el PIN)
          await logSecurityAudit(
            req.headers['x-user-id'] || req.auth?.userId || 'superadmin',
            req.headers['x-user-name'] || req.auth?.name || 'SuperAdmin Support',
            'SUPERADMIN_PIN_SUPPORT_OVERRIDE',
            `Modificación de PIN por soporte técnico bajo Ticket: ${support_ticket_id}. Motivo: ${String(support_reason).trim()}`,
            req,
            tenantId
          );
        } else {
          // Si es Propietario y ya existe un PIN configurado, exigir current_pin
          if (existingPin) {
            if (!current_pin || String(current_pin).trim() === '') {
              return res.status(400).json({
                error: 'Debes ingresar el PIN actual para autorizar el cambio de clave.',
                code: 'CURRENT_PIN_REQUIRED'
              });
            }

            let isCurrentMatch = false;
            if (String(existingPin).startsWith('$2')) {
              const verifyRes = await verifyPin(current_pin, existingPin);
              isCurrentMatch = verifyRes.matched;
            } else {
              // Soporte para rotación de PIN legacy previo
              isCurrentMatch = verifyLegacyPinForRotation(current_pin, existingPin);
            }

            if (!isCurrentMatch) {
              return res.status(401).json({
                error: 'El PIN actual ingresado es incorrecto.',
                code: 'INVALID_CURRENT_PIN'
              });
            }
          }
        }

        hashedNewPin = await hashPin(admin_pin);
      }

      let query = `
        UPDATE security_settings 
        SET require_pin_for_settings = ?, pin_notification_emails = ?, max_failed_attempts = ?, lockout_minutes = ?
      `;
      let params = [
        require_pin_for_settings !== undefined ? (require_pin_for_settings ? 1 : 0) : 1,
        pin_notification_emails || '',
        parseInt(max_failed_attempts) || 5,
        parseInt(lockout_minutes) || 30
      ];

      if (hashedNewPin) {
        query += ', admin_pin = ?, admin_pin_hash = ?, pin_failed_attempts = 0, pin_locked_until = NULL';
        params.push(hashedNewPin, hashedNewPin);
      }

      query += ' WHERE tenant_id = ?';
      params.push(tenantId);

      const [updateResult] = await pool.query(query, params);

      if (updateResult.affectedRows === 0) {
        // Insert new settings row for tenant
        await pool.query(`
          INSERT INTO security_settings 
            (tenant_id, require_pin_for_settings, pin_notification_emails, max_failed_attempts, lockout_minutes, admin_pin, admin_pin_hash, pin_failed_attempts, pin_locked_until)
          VALUES 
            (?, ?, ?, ?, ?, ?, ?, 0, NULL)
        `, [
          tenantId,
          require_pin_for_settings !== undefined ? (require_pin_for_settings ? 1 : 0) : 1,
          pin_notification_emails || '',
          parseInt(max_failed_attempts) || 5,
          parseInt(lockout_minutes) || 30,
          hashedNewPin || null,
          hashedNewPin || null
        ]);
      }

      await logSecurityAudit(
        req.headers['x-user-id'] || req.auth?.userId || 'owner', 
        req.headers['x-user-name'] || req.auth?.name || 'Propietario', 
        'SECURITY_SETTINGS_UPDATED', 
        hashedNewPin ? 'Configuración de seguridad y PIN administrativo actualizado con hash adaptativo' : 'Parámetros de seguridad actualizados para el salón.', 
        req,
        tenantId
      );

      res.json({ success: true, message: 'Configuración de seguridad actualizada correctamente' });
    } catch (err) {
      console.error('[SECURITY SAVE SETTINGS ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 12. Solicitar PIN de Acceso por Correo Multi-Destinatario (OTP Dinámico Scoped by tenant_id)
  router.post('/request-pin', async (req, res) => {
    try {
      const tenantId = req.verifiedTenantId;
      if (!tenantId) return res.status(401).json({ error: 'Tenant context required' });

      const otpPin = Math.floor(100000 + Math.random() * 900000).toString();

      await pool.query(`
        UPDATE security_settings 
        SET active_otp_pin = ?, otp_expires_at = (NOW() + INTERVAL '10 MINUTE')
        WHERE tenant_id = ?
      `, [otpPin, tenantId]);

      const [secRows] = await pool.query('SELECT pin_notification_emails FROM security_settings WHERE tenant_id = ?', [tenantId]);
      const emailListRaw = secRows[0]?.pin_notification_emails || '';
      const emailRecipients = emailListRaw
        .split(/[,;\n]+/)
        .map(e => e.trim())
        .filter(e => e.length > 3 && e.includes('@'));

      if (emailRecipients.length === 0) {
        return res.status(400).json({ error: 'No hay correos configurados en el módulo de seguridad de este salón para recibir el PIN.' });
      }

      const [smtpRows] = await pool.query('SELECT * FROM email_settings WHERE tenant_id = ? LIMIT 1', [tenantId]);
      const smtp = smtpRows[0] || {};
      const transporter = nodemailer.createTransport({
        host: smtp.smtp_host || process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(smtp.smtp_port || process.env.SMTP_PORT || '587'),
        secure: smtp.smtp_secure === 1,
        auth: {
          user: smtp.smtp_user || process.env.SMTP_USER,
          pass: smtp.smtp_pass || process.env.SMTP_PASS
        }
      });

      const senderEmail = smtp.smtp_user || process.env.SMTP_USER || 'notificaciones@salonpro.io';
      const smtpFrom = `"Seguridad Salon Pro" <${senderEmail}>`;
      const clientIp = getClientIp(req);

      await transporter.sendMail({
        from: smtpFrom,
        to: emailRecipients.join(', '),
        subject: `🔐 PIN de Seguridad Salon Pro: ${otpPin} (Válido por 10 min)`,
        text: `Tu PIN de seguridad para tu salón es: ${otpPin}. Válido por 10 minutos. Solicitado desde IP: ${clientIp}`,
        html: `<p>Tu PIN de seguridad dinámico es: <strong>${otpPin}</strong> (expira en 10 minutos).</p>`
      });

      await logSecurityAudit(
        req.headers['x-user-id'] || 'admin', 
        req.headers['x-user-name'] || 'Administrador', 
        'SECURITY_PIN_REQUESTED', 
        `PIN de seguridad dinámico generado y enviado a: ${emailRecipients.join(', ')}`, 
        req,
        tenantId
      );

      res.json({
        success: true,
        message: `El PIN de seguridad fue enviado exitosamente a: ${emailRecipients.join(', ')}`,
        recipientsCount: emailRecipients.length
      });
    } catch (err) {
      console.error('[SECURITY REQUEST PIN ERROR]:', err);
      res.status(500).json({ error: 'Error al enviar el PIN por correo. Verifica la configuración SMTP en el sistema.' });
    }
  });

  // 13. Verificar PIN de Seguridad (Scoped by tenant_id)
  router.post('/verify-pin', async (req, res) => {
    try {
      const role = (req.auth?.role || req.headers['x-user-role'] || '').toLowerCase();
      if (role === 'superadmin' || req.auth?.isSuperAdmin) {
        return res.status(403).json({
          error: 'Acceso denegado: El rol de SuperAdmin pertenece al plano de control (Control Plane) y tiene estrictamente prohibido operar sobre recursos privados del salón.',
          code: 'CONTROL_PLANE_ROLE_FORBIDDEN'
        });
      }

      const tenantId = req.verifiedTenantId || req.tenantId || req.auth?.tenantId;
      if (!tenantId) return res.status(401).json({ error: 'Tenant context required' });

      const { pin } = req.body;
      if (!pin) return res.status(400).json({ error: 'Debes ingresar el PIN de seguridad' });

      const [rows] = await pool.query(
        'SELECT admin_pin, admin_pin_hash, active_otp_pin, otp_expires_at, pin_failed_attempts, pin_locked_until, max_failed_attempts, lockout_minutes FROM security_settings WHERE tenant_id = ?',
        [tenantId]
      );
      if (rows.length === 0) return res.status(401).json({ error: 'No hay PIN configurado en este salón' });

      const { admin_pin, admin_pin_hash, active_otp_pin, otp_expires_at } = rows[0];

      const actorId = req.headers['x-user-id'] || req.auth?.userId || getClientIp(req);
      const actorRole = (req.auth?.role || req.headers['x-user-role'] || 'cajero').toLowerCase();
      const isOwner = actorRole === 'propietario' || actorRole === 'owner';
      const actorKey = `${tenantId}:${actorId}`;

      // Verificación de bloqueo temporal
      const maxFailed = parseInt(rows[0].max_failed_attempts || 5, 10);
      const lockoutMinutes = parseInt(rows[0].lockout_minutes || 30, 10);
      const now = new Date();

      if (isOwner) {
        // Bloqueo del propietario registrado en la base de datos
        const lockedUntil = rows[0].pin_locked_until ? new Date(rows[0].pin_locked_until) : null;
        if (lockedUntil && lockedUntil > now) {
          const remainingMinutes = Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 60000));
          return res.status(423).json({
            success: false,
            error: `PIN administrativo bloqueado temporalmente por múltiples intentos fallidos. Intente nuevamente en ${remainingMinutes} minuto(s).`,
            code: 'PIN_TEMPORARILY_LOCKED',
            lockedUntil: lockedUntil.toISOString()
          });
        }
      } else {
        // Bloqueo aislado del empleado en memoria (un empleado NUNCA puede bloquear al propietario)
        const actorLock = actorPinLockouts.get(actorKey);
        if (actorLock && actorLock.lockedUntil && actorLock.lockedUntil > now) {
          const remainingMinutes = Math.max(1, Math.ceil((actorLock.lockedUntil.getTime() - now.getTime()) / 60000));
          return res.status(423).json({
            success: false,
            error: `Acceso por PIN bloqueado para su usuario por múltiples intentos fallidos. Intente nuevamente en ${remainingMinutes} minuto(s).`,
            code: 'PIN_TEMPORARILY_LOCKED',
            lockedUntil: actorLock.lockedUntil.toISOString()
          });
        }
      }

      const isOtpValid = active_otp_pin && (pin === active_otp_pin) && otp_expires_at && (new Date(otp_expires_at) > now);
      let isMasterValid = false;
      let isLegacyPin = false;
      const storedMaster = admin_pin_hash || admin_pin;

      if (storedMaster) {
        const verifyRes = await verifyPin(pin, storedMaster);
        isMasterValid = verifyRes.matched;
        isLegacyPin = verifyRes.isLegacy;
      }

      // Los PIN legacy NUNCA se autentican para operaciones normales; requieren rotación obligatoria
      if (isLegacyPin) {
        return res.status(403).json({
          success: false,
          error: 'El PIN de seguridad configurado en este salón está en formato legacy no encriptado y requiere rotación obligatoria por el propietario antes de ser utilizado.',
          code: 'PIN_ROTATION_REQUIRED'
        });
      }

      if (isMasterValid || isOtpValid) {
        // Reset de intentos fallidos al verificar exitosamente
        if (isOwner) {
          await pool.query(
            'UPDATE security_settings SET pin_failed_attempts = 0, pin_locked_until = NULL WHERE tenant_id = ?',
            [tenantId]
          );
        } else {
          actorPinLockouts.delete(actorKey);
        }

        await logSecurityAudit(
          req.headers['x-user-id'] || req.auth?.userId || 'admin', 
          req.headers['x-user-name'] || req.auth?.name || 'Administrador', 
          'SECURITY_PIN_VERIFIED', 
          `Acceso a área protegida autorizado mediante ${isOtpValid ? 'PIN OTP dinámico' : 'PIN Maestro'}`, 
          req,
          tenantId
        );
        return res.json({ success: true, authorized: true });
      }

      // Registro de intento fallido aislado por actor
      if (isOwner) {
        const failedAttempts = parseInt(rows[0].pin_failed_attempts || 0, 10);
        const newFailed = failedAttempts + 1;
        let newLockedUntil = null;
        if (newFailed >= maxFailed) {
          newLockedUntil = new Date(Date.now() + lockoutMinutes * 60000);
        }

        await pool.query(
          'UPDATE security_settings SET pin_failed_attempts = ?, pin_locked_until = ? WHERE tenant_id = ?',
          [newFailed, newLockedUntil ? newLockedUntil.toISOString() : null, tenantId]
        );

        if (newLockedUntil) {
          return res.status(423).json({
            success: false,
            error: `PIN administrativo bloqueado temporalmente por ${lockoutMinutes} minutos tras ${newFailed} intentos fallidos.`,
            code: 'PIN_LOCKED_OUT',
            lockedUntil: newLockedUntil.toISOString()
          });
        }
      } else {
        // Fallo de empleado registrado en tracker aislado
        const currentLock = actorPinLockouts.get(actorKey) || { attempts: 0, lockedUntil: null };
        const newFailed = currentLock.attempts + 1;
        let newLockedUntil = null;
        if (newFailed >= maxFailed) {
          newLockedUntil = new Date(Date.now() + lockoutMinutes * 60000);
        }

        actorPinLockouts.set(actorKey, {
          attempts: newFailed,
          lockedUntil: newLockedUntil
        });

        if (newLockedUntil) {
          return res.status(423).json({
            success: false,
            error: `Acceso por PIN bloqueado para su usuario por ${lockoutMinutes} minutos tras ${newFailed} intentos fallidos.`,
            code: 'PIN_LOCKED_OUT',
            lockedUntil: newLockedUntil.toISOString()
          });
        }
      }

      res.status(401).json({ success: false, error: 'PIN de seguridad inválido o expirado' });
    } catch (err) {
      console.error('[SECURITY VERIFY PIN ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 14. Configurar PIN de Seguridad (Plano de Salón - Prohibido a SuperAdmin)
  router.post('/set-pin', async (req, res) => {
    const role = (req.auth?.role || req.headers['x-user-role'] || '').toLowerCase();
    if (role === 'superadmin' || req.auth?.isSuperAdmin) {
      return res.status(403).json({
        error: 'Acceso denegado: El rol de SuperAdmin pertenece al plano de control (Control Plane) y tiene estrictamente prohibido operar sobre recursos privados del salón.',
        code: 'CONTROL_PLANE_ROLE_FORBIDDEN'
      });
    }

    const tenantId = req.verifiedTenantId || req.tenantId || req.auth?.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'Tenant context required' });

    if (role !== 'propietario' && role !== 'owner') {
      return res.status(403).json({ error: 'Solo el propietario del salón puede configurar el PIN.' });
    }

    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: 'Debe ingresar el PIN a configurar.' });

    const pinValidation = validatePinComplexity(pin);
    if (!pinValidation.valid) {
      return res.status(400).json({ error: pinValidation.error, code: 'WEAK_PIN' });
    }

    const hashedPin = await hashPin(pin);
    await pool.query(`
      INSERT INTO security_settings (tenant_id, admin_pin, admin_pin_hash, pin_failed_attempts, pin_locked_until)
      VALUES (?, ?, ?, 0, NULL)
      ON CONFLICT (tenant_id) DO UPDATE SET
        admin_pin = EXCLUDED.admin_pin,
        admin_pin_hash = EXCLUDED.admin_pin_hash,
        pin_failed_attempts = 0,
        pin_locked_until = NULL
    `, [tenantId, hashedPin, hashedPin]);

    res.json({ success: true, message: 'PIN configurado exitosamente' });
  });

  // 15. Rotar PIN de Seguridad (Plano de Salón - Prohibido a SuperAdmin)
  router.post('/rotate-pin', async (req, res) => {
    const role = (req.auth?.role || req.headers['x-user-role'] || '').toLowerCase();
    if (role === 'superadmin' || req.auth?.isSuperAdmin) {
      return res.status(403).json({
        error: 'Acceso denegado: El rol de SuperAdmin pertenece al plano de control (Control Plane) y tiene estrictamente prohibido operar sobre recursos privados del salón.',
        code: 'CONTROL_PLANE_ROLE_FORBIDDEN'
      });
    }

    const tenantId = req.verifiedTenantId || req.tenantId || req.auth?.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'Tenant context required' });

    if (role !== 'propietario' && role !== 'owner') {
      return res.status(403).json({ error: 'Solo el propietario del salón puede rotar el PIN.' });
    }

    const { current_pin, new_pin } = req.body;
    if (!current_pin || !new_pin) {
      return res.status(400).json({ error: 'Se requieren current_pin y new_pin.' });
    }

    const currentSettings = await getTenantSecuritySettings(tenantId);
    const existingPin = currentSettings?.admin_pin_hash || currentSettings?.admin_pin;
    const pinVerification = await verifyPin(current_pin, existingPin);

    if (!pinVerification.matched && !pinVerification.isLegacy) {
      return res.status(400).json({ error: 'El PIN actual ingresado es incorrecto.' });
    }

    const validation = validatePinComplexity(new_pin);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error, code: 'WEAK_PIN' });
    }

    const hashedNewPin = await hashPin(new_pin);
    await pool.query(
      'UPDATE security_settings SET admin_pin = ?, admin_pin_hash = ?, pin_failed_attempts = 0, pin_locked_until = NULL WHERE tenant_id = ?',
      [hashedNewPin, hashedNewPin, tenantId]
    );

    res.json({ success: true, message: 'PIN rotado exitosamente a formato seguro' });
  });

  return router;
}

module.exports = { createSecurityRouter };
