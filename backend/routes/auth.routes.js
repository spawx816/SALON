const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const { signAuthToken } = require('../middleware/auth.middleware');
const { requireRole, getEffectiveRole, canManageRole } = require('../middleware/rbac.middleware');

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.socket?.remoteAddress ||
         req.ip ||
         '127.0.0.1';
}

function createAuthRouter(pool, options = {}) {
  const router = express.Router();

  // Rate Limiting para Autenticación y Recuperación (REM-P1-03)
  const loginLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    skip: (req) => process.env.NODE_ENV === 'test' && req.headers['x-test-rate-limit'] !== 'force',
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos de acceso. Espera un minuto antes de reintentar.' }
  });

  const recoveryLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    skip: (req) => process.env.NODE_ENV === 'test' && req.headers['x-test-rate-limit'] !== 'force',
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes de recuperación o activación. Intenta más tarde.' }
  });

  const logSecurityAudit = async (userId, userName, action, details, req, tenantIdOverride = null) => {
    try {
      const ip = getClientIp(req);
      const userAgent = req.headers['user-agent'] || 'Unknown';
      const tenantId = tenantIdOverride || req.tenantId || null;
      await pool.query(`
        INSERT INTO security_audit_logs (user_id, user_name, action, details, ip_address, user_agent, tenant_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [userId || 'SYSTEM', userName || 'Sistema', action, details || '', ip, userAgent, tenantId]);
    } catch (e) {
      console.error('[SECURITY AUDIT LOG ERROR]:', e.message);
    }
  };

  // === PASSWORD RECOVERY & ACCOUNT ACTIVATION (STRICT TENANT-BOUND & ANTI-ENUMERATION) ===
  const handleForgotPassword = async (req, res) => {
    const { email, cedula, username } = req.body;
    const identifier = String(email || username || cedula || '').trim();
    const tenantId = req.tenantId || req.headers['x-tenant-id'] || req.body.tenant_id || null;

    if (!identifier) {
      return res.status(400).json({ error: 'Por favor, ingresa tu correo electrónico, usuario o cédula.' });
    }

    // Generic response message to prevent account enumeration
    const genericSuccess = {
      success: true,
      message: 'Si la cuenta existe en el sistema, hemos enviado un código de verificación al correo registrado.'
    };

    try {
      let targetUser = null;
      let isSystemUser = false;
      const cleanId = identifier;

      if (tenantId) {
        // Scoped lookup within tenant
        const [clients] = await pool.query(
          "SELECT id, nombre, email, cedula, tenant_id FROM clients WHERE tenant_id = ? AND (LOWER(email) = LOWER(?) OR cedula = ? OR REPLACE(cedula, '-', '') = ?) LIMIT 1",
          [tenantId, cleanId, cleanId, cleanId.replace(/\D/g, '')]
        );

        if (clients.length > 0) {
          targetUser = clients[0];
        } else {
          const [users] = await pool.query(
            "SELECT id, COALESCE(nombre, name) as nombre, email, username, tenant_id FROM users WHERE tenant_id = ? AND (LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)) LIMIT 1",
            [tenantId, cleanId, cleanId]
          );
          if (users.length > 0) {
            targetUser = users[0];
            isSystemUser = true;
          }
        }
      } else {
        // Superadmin lookup (where tenant_id IS NULL)
        const [users] = await pool.query(
          "SELECT id, COALESCE(nombre, name) as nombre, email, username, tenant_id FROM users WHERE tenant_id IS NULL AND role = 'superadmin' AND (LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)) LIMIT 1",
          [cleanId, cleanId]
        );
        if (users.length > 0) {
          targetUser = users[0];
          isSystemUser = true;
        }
      }

      if (!targetUser) {
        // Return generic success without revealing non-existence
        return res.json(genericSuccess);
      }

      const recipientEmail = targetUser.email || (targetUser.username && targetUser.username.includes('@') ? targetUser.username : null);
      if (!recipientEmail) {
        return res.json(genericSuccess);
      }

      const userTenantId = targetUser.tenant_id || null;
      const targetUserId = isSystemUser ? `USER-${targetUser.id}` : String(targetUser.id);

      // Invalidate prior unused password_reset codes for this specific tenant & user
      if (userTenantId) {
        await pool.query(
          "UPDATE verification_codes SET is_used = 1 WHERE tenant_id = ? AND (user_id = ? OR client_id = ?) AND purpose = 'password_reset' AND is_used = 0",
          [userTenantId, targetUserId, targetUserId]
        );
      } else {
        await pool.query(
          "UPDATE verification_codes SET is_used = 1 WHERE tenant_id IS NULL AND (user_id = ? OR client_id = ?) AND purpose = 'password_reset' AND is_used = 0",
          [targetUserId, targetUserId]
        );
      }

      // High entropy random code and cryptographic SHA-256 hash
      const code = crypto.randomInt(100000, 999999).toString();
      const codeHash = crypto.createHash('sha256').update(code).digest('hex');
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      await pool.query(
        'INSERT INTO verification_codes (tenant_id, user_id, client_id, identity, purpose, channel, code, code_hash, attempts, max_attempts, expires_at, is_used) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, 5, ?, 0)',
        [userTenantId, targetUserId, targetUserId, recipientEmail, 'password_reset', 'email', codeHash, expiresAt]
      );

      try {
        const [smtpRows] = await pool.query(
          userTenantId
            ? 'SELECT * FROM email_settings WHERE tenant_id = ? LIMIT 1'
            : 'SELECT * FROM email_settings WHERE tenant_id IS NULL LIMIT 1',
          userTenantId ? [userTenantId] : []
        );
        if (smtpRows.length > 0 && smtpRows[0].smtp_host) {
          const s = smtpRows[0];
          const transporter = nodemailer.createTransport({
            host: s.smtp_host,
            port: parseInt(s.smtp_port) || 587,
            secure: parseInt(s.smtp_port) === 465 || s.smtp_secure === 1,
            auth: { user: s.smtp_user, pass: s.smtp_pass },
            tls: { rejectUnauthorized: false }
          });

          await transporter.sendMail({
            from: `"${s.smtp_from || 'PLAN BEAUTY RD'}" <${s.smtp_user}>`,
            to: recipientEmail,
            subject: `🔐 Código de Recuperación de Contraseña: ${code}`,
            text: `Hola ${targetUser.nombre || 'Usuario'}, tu código de verificación para restablecer tu contraseña es: ${code}. Válido por 15 minutos.`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 30px; border: 1px solid #e2e8f0; border-radius: 16px; background: #ffffff; text-align: center;">
                <h2 style="color: #09090b; margin-top: 0;">Recuperación de Contraseña</h2>
                <p style="color: #475569; font-size: 15px;">Hola <strong>${targetUser.nombre || 'Usuario'}</strong>,</p>
                <p style="color: #475569; font-size: 14px;">Usa el siguiente código de 6 dígitos para restablecer tu contraseña:</p>
                <div style="margin: 24px 0; padding: 16px 28px; background: #f8fafc; border: 2px dashed #09090b; border-radius: 12px; display: inline-block;">
                  <span style="font-size: 32px; font-weight: 900; letter-spacing: 8px; color: #09090b; font-family: monospace;">${code}</span>
                </div>
                <p style="color: #94a3b8; font-size: 12px;">Este código expirará en 15 minutos.</p>
              </div>
            `
          });
        }
      } catch (mailErr) {
        console.warn('[FORGOT PASSWORD EMAIL WARN]:', mailErr.message);
      }

      res.json(genericSuccess);
    } catch (err) {
      console.error('[FORGOT PASSWORD ERROR]:', err);
      res.status(500).json({ error: 'Error procesando solicitud de recuperación.' });
    }
  };

  router.post('/auth/forgot-password', recoveryLimiter, handleForgotPassword);
  router.post('/forgot-password', recoveryLimiter, handleForgotPassword);

  const handleVerifyCode = async (req, res) => {
    const { code, clientId, userId } = req.body;
    const cleanCode = String(code || '').trim();
    const tenantId = req.tenantId || req.headers['x-tenant-id'] || req.body.tenant_id || null;
    const targetUserId = String(userId || clientId || '').trim();

    if (!cleanCode || !targetUserId) {
      return res.status(400).json({ error: 'Código de verificación e identificador de cuenta requeridos.' });
    }

    try {
      const inputHash = crypto.createHash('sha256').update(cleanCode).digest('hex');

      const verifySql = tenantId
        ? "SELECT id, code_hash, attempts, max_attempts, client_id, user_id, tenant_id FROM verification_codes WHERE tenant_id = ? AND (user_id = ? OR client_id = ?) AND purpose = 'password_reset' AND is_used = 0 AND expires_at > NOW() ORDER BY id DESC LIMIT 1"
        : "SELECT id, code_hash, attempts, max_attempts, client_id, user_id, tenant_id FROM verification_codes WHERE tenant_id IS NULL AND (user_id = ? OR client_id = ?) AND purpose = 'password_reset' AND is_used = 0 AND expires_at > NOW() ORDER BY id DESC LIMIT 1";
      const verifyParams = tenantId ? [tenantId, targetUserId, targetUserId] : [targetUserId, targetUserId];

      const [rows] = await pool.query(verifySql, verifyParams);

      if (rows.length === 0) {
        return res.status(400).json({ error: 'Código inválido o expirado.' });
      }

      const rec = rows[0];
      let matches = false;
      if (rec.code_hash) {
        const storedHashBuf = Buffer.from(rec.code_hash, 'hex');
        const inputHashBuf = Buffer.from(inputHash, 'hex');
        matches = storedHashBuf.length === inputHashBuf.length && crypto.timingSafeEqual(storedHashBuf, inputHashBuf);
      }

      if (!matches) {
        const currentAttempts = (rec.attempts || 0) + 1;
        if (currentAttempts >= (rec.max_attempts || 5)) {
          await pool.query('UPDATE verification_codes SET is_used = 1, attempts = ? WHERE id = ?', [currentAttempts, rec.id]);
          return res.status(400).json({ error: 'Demasiados intentos fallidos. El código ha sido invalidado.' });
        } else {
          await pool.query('UPDATE verification_codes SET attempts = ? WHERE id = ?', [currentAttempts, rec.id]);
          return res.status(400).json({ error: 'Código inválido o expirado.' });
        }
      }

      res.json({ success: true, valid: true, clientId: rec.client_id || rec.user_id });
    } catch (err) {
      res.status(500).json({ error: 'Error verificando código.' });
    }
  };

  router.post('/auth/verify-code', recoveryLimiter, handleVerifyCode);
  router.post('/verify-code', recoveryLimiter, handleVerifyCode);

  const handleResetPassword = async (req, res) => {
    const { code, newPassword, password, clientId, userId } = req.body;
    const finalPassword = newPassword || password;
    const cleanCode = String(code || '').trim();
    const tenantId = req.tenantId || req.headers['x-tenant-id'] || req.body.tenant_id || null;
    const targetUserId = String(userId || clientId || '').trim();

    if (!finalPassword || String(finalPassword).length < 4) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 4 caracteres.' });
    }

    if (!cleanCode || !targetUserId) {
      return res.status(400).json({ error: 'Código de verificación e identificador de cuenta requeridos.' });
    }

    try {
      const inputHash = crypto.createHash('sha256').update(cleanCode).digest('hex');

      const verifySql = tenantId
        ? "SELECT id, code_hash, attempts, max_attempts, client_id, user_id, tenant_id FROM verification_codes WHERE tenant_id = ? AND (user_id = ? OR client_id = ?) AND purpose = 'password_reset' AND is_used = 0 AND expires_at > NOW() ORDER BY id DESC LIMIT 1"
        : "SELECT id, code_hash, attempts, max_attempts, client_id, user_id, tenant_id FROM verification_codes WHERE tenant_id IS NULL AND (user_id = ? OR client_id = ?) AND purpose = 'password_reset' AND is_used = 0 AND expires_at > NOW() ORDER BY id DESC LIMIT 1";
      const verifyParams = tenantId ? [tenantId, targetUserId, targetUserId] : [targetUserId, targetUserId];

      const [rows] = await pool.query(verifySql, verifyParams);

      if (rows.length === 0) {
        return res.status(400).json({ error: 'El código de verificación es inválido o ha expirado.' });
      }

      const rec = rows[0];
      let matches = false;
      if (rec.code_hash) {
        const storedHashBuf = Buffer.from(rec.code_hash, 'hex');
        const inputHashBuf = Buffer.from(inputHash, 'hex');
        matches = storedHashBuf.length === inputHashBuf.length && crypto.timingSafeEqual(storedHashBuf, inputHashBuf);
      }

      if (!matches) {
        const currentAttempts = (rec.attempts || 0) + 1;
        if (currentAttempts >= (rec.max_attempts || 5)) {
          await pool.query('UPDATE verification_codes SET is_used = 1, attempts = ? WHERE id = ?', [currentAttempts, rec.id]);
          return res.status(400).json({ error: 'Demasiados intentos fallidos. El código ha sido invalidado.' });
        } else {
          await pool.query('UPDATE verification_codes SET attempts = ? WHERE id = ?', [currentAttempts, rec.id]);
          return res.status(400).json({ error: 'El código de verificación es inválido o ha expirado.' });
        }
      }

      // Mark code used immediately
      if (rec.tenant_id) {
        await pool.query('UPDATE verification_codes SET is_used = 1, used_at = NOW() WHERE id = ? AND tenant_id = ?', [rec.id, rec.tenant_id]);
      } else {
        await pool.query('UPDATE verification_codes SET is_used = 1, used_at = NOW() WHERE id = ? AND tenant_id IS NULL', [rec.id]);
      }

      const hashedPass = await bcrypt.hash(String(finalPassword), 10);
      const resolvedUserId = rec.user_id || rec.client_id;

      if (resolvedUserId && String(resolvedUserId).startsWith('USER-')) {
        const realUserId = String(resolvedUserId).replace('USER-', '');
        let uQuery = 'UPDATE users SET password_hash = ?, password = NULL, token_version = COALESCE(token_version, 1) + 1 WHERE id::text = ?';
        const uParams = [hashedPass, realUserId];
        if (rec.tenant_id) {
          uQuery += ' AND tenant_id = ?';
          uParams.push(rec.tenant_id);
        } else {
          uQuery += ' AND tenant_id IS NULL';
        }
        await pool.query(uQuery, uParams);
        return res.json({ success: true, message: 'Contraseña actualizada exitosamente.' });
      }

      if (resolvedUserId) {
        let cQuery = 'UPDATE clients SET password = ? WHERE id = ?';
        const cParams = [hashedPass, resolvedUserId];
        if (rec.tenant_id) {
          cQuery += ' AND tenant_id = ?';
          cParams.push(rec.tenant_id);
        } else {
          cQuery += ' AND tenant_id IS NULL';
        }
        await pool.query(cQuery, cParams);
        return res.json({ success: true, message: 'Contraseña restablecida correctamente.' });
      }

      res.status(404).json({ error: 'No se encontró la cuenta vinculada al código de verificación.' });
    } catch (err) {
      console.error('[RESET PASSWORD ERROR]:', err);
      res.status(500).json({ error: 'Error restableciendo la contraseña.' });
    }
  };

  router.post('/auth/reset-password', recoveryLimiter, handleResetPassword);
  router.post('/reset-password', recoveryLimiter, handleResetPassword);

  // Account activation for new B2C clients (Strict Tenant & Identity Binding)
  router.post('/auth/activate', recoveryLimiter, async (req, res) => {
    const { clientId, code, password } = req.body;
    const cleanCode = String(code || '').trim();
    const tenantId = req.tenantId || req.headers['x-tenant-id'] || req.body.tenant_id || null;

    if (!clientId) {
      return res.status(400).json({ error: 'El identificador de cliente (clientId) es requerido.' });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
    }

    if (!cleanCode) {
      return res.status(400).json({ error: 'El código de activación es requerido.' });
    }

    try {
      const inputHash = crypto.createHash('sha256').update(cleanCode).digest('hex');

      const activateSql = tenantId
        ? "SELECT id, code_hash, client_id, user_id, tenant_id FROM verification_codes WHERE tenant_id = ? AND (client_id = ? OR user_id = ?) AND purpose = 'account_activation' AND is_used = 0 AND expires_at > NOW() ORDER BY id DESC LIMIT 1"
        : "SELECT id, code_hash, client_id, user_id, tenant_id FROM verification_codes WHERE tenant_id IS NULL AND (client_id = ? OR user_id = ?) AND purpose = 'account_activation' AND is_used = 0 AND expires_at > NOW() ORDER BY id DESC LIMIT 1";
      const activateParams = tenantId ? [tenantId, String(clientId), String(clientId)] : [String(clientId), String(clientId)];

      const [verRows] = await pool.query(activateSql, activateParams);

      if (verRows.length === 0) {
        return res.status(400).json({ error: 'Código de activación inválido o expirado.' });
      }

      const rec = verRows[0];
      let matches = false;
      if (rec.code_hash) {
        const storedHashBuf = Buffer.from(rec.code_hash, 'hex');
        const inputHashBuf = Buffer.from(inputHash, 'hex');
        matches = storedHashBuf.length === inputHashBuf.length && crypto.timingSafeEqual(storedHashBuf, inputHashBuf);
      }

      if (!matches) {
        return res.status(400).json({ error: 'Código de activación inválido o expirado.' });
      }

      // Identity validation: confirm client exists within the exact tenant
      if (!rec.tenant_id) {
        return res.status(400).json({ error: 'El código de activación no tiene un salón asociado.' });
      }
      const [clientCheck] = await pool.query(
        'SELECT id FROM clients WHERE id = ? AND tenant_id = ?',
        [String(clientId), rec.tenant_id]
      );
      if (clientCheck.length === 0) {
        return res.status(403).json({ error: 'Acceso no autorizado: el cliente no pertenece al inquilino del código.' });
      }

      const hashedPassword = await bcrypt.hash(String(password), 10);
      
      let updateQuery = "UPDATE clients SET password = ?, status = 'Active' WHERE id = ?";
      const updateParams = [hashedPassword, String(clientId)];
      if (rec.tenant_id) {
        updateQuery += ' AND tenant_id = ?';
        updateParams.push(rec.tenant_id);
      } else {
        updateQuery += ' AND tenant_id IS NULL';
      }

      await pool.query(updateQuery, updateParams);
      await pool.query('UPDATE verification_codes SET is_used = 1, used_at = NOW() WHERE id = ?', [rec.id]);

      res.json({ success: true, message: 'Cuenta activada exitosamente.' });
    } catch (err) {
      console.error('[ACTIVATE ACCOUNT ERROR]:', err);
      res.status(500).json({ error: 'Error activando la cuenta.' });
    }
  });

  // === USERS & ROLES MANAGEMENT (SCOPED BY TENANT) ===
  const rejectControlPlaneOnTenantUsers = (req, res, next) => {
    const role = getEffectiveRole(req);
    if (role === 'superadmin' || req.auth?.isSuperAdmin) {
      return res.status(403).json({
        error: 'Acceso denegado: El rol de SuperAdmin pertenece al plano de control (Control Plane) y tiene estrictamente prohibido operar sobre recursos privados del salón.',
        code: 'CONTROL_PLANE_ROLE_FORBIDDEN'
      });
    }
    next();
  };

  router.get('/users', rejectControlPlaneOnTenantUsers, requireRole('propietario', 'admin'), async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de salón requerido.' });
      }

      const [rows] = await pool.query(`
        SELECT u.id,
               u.tenant_id,
               u.branch_id,
               COALESCE(u.nombre, u.name) as nombre,
               COALESCE(u.name, u.nombre) as name,
               u.username,
               u.email,
               u.role_id,
               u.role,
               COALESCE(u.salon_id, u.branch_id::text) as salon_id,
               COALESCE(u.estado, CASE WHEN u.is_active THEN 'Activo' ELSE 'Inactivo' END) as estado,
               u.is_active,
               u.hora_entrada,
               u.hora_salida,
               u.dias_laborables,
               u.tolerancia_minutos,
               u.created_at,
               COALESCE(r.nombre, u.role, 'Administrador') as role_name,
               COALESCE(r.permisos, '["all"]') as role_permissions,
               COALESCE(b.name, s.name, 'Sucursal Principal') as salon_name
        FROM users u
        LEFT JOIN roles r ON u.role_id = r.id
        LEFT JOIN branches b ON u.branch_id = b.id
        LEFT JOIN salons s ON u.salon_id = s.id
        WHERE u.tenant_id = ? AND (u.role IS NULL OR u.role != 'superadmin')
        ORDER BY u.created_at DESC
      `, [tenantId]);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/users', rejectControlPlaneOnTenantUsers, requireRole('propietario', 'admin'), async (req, res) => {
    const { nombre, name, username, email, password, role_id, role, salon_id, branch_id, estado, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos } = req.body;
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'No se pudo determinar el salón (Tenant) para crear el usuario.' });
      }

      const actorRole = getEffectiveRole(req);
      const targetRole = role ? String(role).trim().toLowerCase() : 'empleado';

      if (!canManageRole(actorRole, targetRole)) {
        return res.status(403).json({
          error: `No tienes autorización para crear usuarios con el rol '${targetRole}'.`,
          code: 'PRIVILEGE_ESCALATION_DENIED'
        });
      }

      const finalName = (nombre || name || '').trim();
      const finalEmail = (email || username || '').trim();
      if (!finalName || !finalEmail || !password) {
        return res.status(400).json({ error: 'Nombre, correo electrónico y contraseña son obligatorios.' });
      }

      // Check license limit for users in this tenant
      if (!req.auth?.isSuperAdmin) {
        if (options.entitlementsService) {
          const limitCheck = await options.entitlementsService.checkLimit(tenantId, 'users');
          if (!limitCheck.allowed) {
            return res.status(403).json({
              error: limitCheck.reason || 'Has alcanzado el límite permitido por tu plan.',
              code: limitCheck.code || 'PLAN_LIMIT_REACHED',
              limit: 'users',
              current: limitCheck.current,
              maximum: limitCheck.maximum
            });
          }
        } else {
          const [tenantRows] = await pool.query('SELECT max_users FROM tenants WHERE id = ?', [tenantId]);
          const [userCount] = await pool.query('SELECT COUNT(*) as total FROM users WHERE tenant_id = ?', [tenantId]);
          const maxUsers = parseInt(tenantRows[0]?.max_users || 3, 10);
          const currentUsers = parseInt(userCount[0]?.total || 0, 10);
          if (currentUsers >= maxUsers) {
            return res.status(403).json({
              error: 'Has alcanzado el límite permitido por tu plan.',
              code: 'PLAN_LIMIT_REACHED',
              limit: 'users',
              current: currentUsers,
              maximum: maxUsers
            });
          }
        }
      }

      // Check email uniqueness
      const [existingEmail] = await pool.query('SELECT id, tenant_id FROM users WHERE LOWER(email) = LOWER(?)', [finalEmail]);
      if (existingEmail.length > 0) {
        return res.status(400).json({ error: 'Ya existe un usuario con ese correo electrónico.' });
      }

      // Resolve branch_id within the same tenant
      let resolvedBranchId = branch_id || null;
      if (!resolvedBranchId && salon_id) {
        const [bRows] = await pool.query('SELECT id FROM branches WHERE id::text = ? AND tenant_id = ? LIMIT 1', [String(salon_id), tenantId]);
        if (bRows.length > 0) resolvedBranchId = bRows[0].id;
      }
      if (!resolvedBranchId) {
        const [mainBranch] = await pool.query('SELECT id FROM branches WHERE tenant_id = ? ORDER BY is_main DESC, created_at ASC LIMIT 1', [tenantId]);
        if (mainBranch.length > 0) resolvedBranchId = mainBranch[0].id;
      }

      const passwordHash = await bcrypt.hash(String(password), 10);
      const effectiveRole = targetRole !== 'superadmin' ? targetRole : 'admin';
      const isActive = String(estado || 'Activo').toLowerCase() !== 'inactivo';

      const [result] = await pool.query(
        `INSERT INTO users (
           tenant_id, branch_id, name, nombre, username, email, password_hash, password,
           role_id, role, salon_id, estado, is_active, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
        [
          tenantId,
          resolvedBranchId,
          finalName,
          finalName,
          username || finalEmail,
          finalEmail,
          passwordHash,
          role_id || 1,
          effectiveRole,
          salon_id || (resolvedBranchId ? String(resolvedBranchId) : '1'),
          estado || 'Activo',
          isActive,
          hora_entrada || '09:00:00',
          hora_salida || '18:00:00',
          typeof dias_laborables === 'object' ? JSON.stringify(dias_laborables) : (dias_laborables || null),
          tolerancia_minutos !== undefined ? tolerancia_minutos : 15
        ]
      );

      // Audit log without password
      try {
        await pool.query(`
          INSERT INTO security_audit_logs (user_id, user_name, action, details, tenant_id)
          VALUES (?, ?, 'USER_CREATED', ?, ?)
        `, [String(req.auth?.userId || req.auth?.id || 'SYSTEM'), req.auth?.name || 'Admin', `Usuario creado con rol ${effectiveRole}: ${finalEmail}`, tenantId]);
      } catch (e) {}

      res.json({ id: result.insertId || result[0]?.id, success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/users/:id', rejectControlPlaneOnTenantUsers, requireRole('propietario', 'admin'), async (req, res) => {
    const { id } = req.params;
    const { nombre, name, username, email, password, role_id, role, salon_id, branch_id, estado, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos } = req.body;
    try {
      const tenantId = req.tenantId;
      // Verify the user belongs to this tenant (anti-IDOR, anti-enumeration: returns 404)
      const [existing] = await pool.query('SELECT id, tenant_id, role, is_active FROM users WHERE id::text = ? AND tenant_id = ? LIMIT 1', [String(id), tenantId]);
      if (!existing || existing.length === 0) {
        return res.status(404).json({ error: 'Usuario no encontrado en este salón.' });
      }

      const actorRole = getEffectiveRole(req);
      const currentTargetRole = String(existing[0].role || 'empleado').toLowerCase();

      // Hierarchy check: can actor manage this existing user?
      if (!canManageRole(actorRole, currentTargetRole) && String(existing[0].id) !== String(req.auth.userId || req.auth.id)) {
        return res.status(403).json({
          error: 'No tienes autorización para modificar a este usuario.',
          code: 'FORBIDDEN_CANNOT_MANAGE_USER'
        });
      }

      // If updating role, check if actor can assign the new role
      if (role) {
        const newTargetRole = String(role).trim().toLowerCase();
        if (!canManageRole(actorRole, newTargetRole)) {
          return res.status(403).json({
            error: `No tienes autorización para asignar el rol '${newTargetRole}'.`,
            code: 'PRIVILEGE_ESCALATION_DENIED'
          });
        }
      }

      const finalName = nombre || name;
      const isActive = estado !== undefined ? (String(estado).toLowerCase() !== 'inactivo') : undefined;
      const safeRole = role && role !== 'superadmin' ? String(role).toLowerCase() : undefined;

      let query = `
        UPDATE users SET 
          nombre = COALESCE(?, nombre),
          name = COALESCE(?, name),
          username = COALESCE(?, username),
          email = COALESCE(?, email),
          role_id = COALESCE(?, role_id),
          role = COALESCE(?, role),
          salon_id = COALESCE(?, salon_id),
          branch_id = COALESCE(?, branch_id),
          estado = COALESCE(?, estado),
          is_active = COALESCE(?, is_active),
          hora_entrada = COALESCE(?, hora_entrada),
          hora_salida = COALESCE(?, hora_salida),
          dias_laborables = COALESCE(?, dias_laborables),
          tolerancia_minutos = COALESCE(?, tolerancia_minutos)
      `;
      const params = [
        finalName ?? null,
        finalName ?? null,
        username ?? null,
        email ?? null,
        role_id ?? null,
        safeRole ?? null,
        salon_id ?? null,
        branch_id ?? null,
        estado ?? null,
        isActive !== undefined ? isActive : null,
        hora_entrada ?? null,
        hora_salida ?? null,
        typeof dias_laborables === 'object' ? JSON.stringify(dias_laborables) : (dias_laborables ?? null),
        tolerancia_minutos ?? null
      ];

      if (password && String(password).trim() !== '') {
        const hashed = await bcrypt.hash(String(password), 10);
        query += `, password_hash = ?, password = NULL, token_version = COALESCE(token_version, 1) + 1`;
        params.push(hashed);
      }

      query += ` WHERE id::text = ? AND tenant_id = ?`;
      params.push(String(id), tenantId);

      await pool.query(query, params);

      // Audit log
      try {
        await pool.query(`
          INSERT INTO security_audit_logs (user_id, user_name, action, details, tenant_id)
          VALUES (?, ?, 'USER_UPDATED', ?, ?)
        `, [String(req.auth?.userId || req.auth?.id || 'SYSTEM'), req.auth?.name || 'Admin', `Usuario modificado con ID ${id}`, tenantId]);
      } catch (e) {}

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/users/:id', rejectControlPlaneOnTenantUsers, requireRole('propietario'), async (req, res) => {
    try {
      const { id } = req.params;
      const tenantId = req.tenantId;
      const [existing] = await pool.query('SELECT id, tenant_id, role, is_active FROM users WHERE id::text = ? AND tenant_id = ? LIMIT 1', [String(id), tenantId]);
      if (!existing || existing.length === 0) {
        return res.status(404).json({ error: 'Usuario no encontrado en este salón.' });
      }

      const targetRole = String(existing[0].role || '').toLowerCase();
      // Nadie puede eliminar al último propietario activo del tenant
      if (targetRole === 'propietario' || targetRole === 'owner') {
        const [allTenantUsers] = await pool.query(
          "SELECT id, role, is_active, estado FROM users WHERE tenant_id = ?",
          [tenantId]
        );
        const remainingOwners = allTenantUsers.filter(u => {
          const r = String(u.role || '').toLowerCase();
          const isAct = u.is_active === true || u.is_active === 1 || String(u.estado || '').toLowerCase() === 'activo';
          return (r === 'propietario' || r === 'owner') && String(u.id) !== String(id) && isAct;
        }).length;

        if (remainingOwners < 1) {
          return res.status(409).json({
            error: 'No es posible eliminar al único propietario activo del salón.',
            code: 'CANNOT_DELETE_LAST_OWNER'
          });
        }
      }

      await pool.query('DELETE FROM users WHERE id::text = ? AND tenant_id = ?', [String(id), tenantId]);
      try {
        await pool.query('UPDATE user_sessions SET is_active = 0 WHERE user_id = ? AND tenant_id = ?', [String(id), tenantId]);
      } catch (e) {}

      // Audit log
      try {
        await pool.query(`
          INSERT INTO security_audit_logs (user_id, user_name, action, details, tenant_id)
          VALUES (?, ?, 'USER_DELETED', ?, ?)
        `, [String(req.auth?.userId || req.auth?.id || 'SYSTEM'), req.auth?.name || 'Admin', `Usuario eliminado con ID ${id}`, tenantId]);
      } catch (e) {}

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/users/verify', async (req, res) => {
    const { username, email, password } = req.body;
    const id = username || email;
    try {
      const tenantId = req.tenantId;
      const [rows] = await pool.query(
        'SELECT * FROM users WHERE (username = ? OR email = ?) AND tenant_id = ? LIMIT 1',
        [id, id, tenantId]
      );
      if (rows.length === 0) return res.status(401).json({ valid: false });

      const user = rows[0];
      const storedHash = user.password_hash || user.password || '';
      let valid = false;
      if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$')) {
        valid = await bcrypt.compare(String(password || ''), storedHash);
      } else {
        valid = storedHash === password;
      }

      res.json({ valid, user: valid ? { id: user.id, nombre: user.nombre || user.name } : null });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/roles', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const [rows] = await pool.query(
        'SELECT * FROM roles WHERE tenant_id = ? ORDER BY id ASC',
        [tenantId]
      );
      res.json(rows.map(r => ({
        ...r,
        permisos: typeof r.permisos === 'string' ? JSON.parse(r.permisos || '[]') : (r.permisos || [])
      })));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/roles', async (req, res) => {
    const { nombre, descripcion, permisos } = req.body;
    try {
      const tenantId = req.tenantId;
      const [result] = await pool.query(
        'INSERT INTO roles (nombre, descripcion, permisos, tenant_id) VALUES (?, ?, ?, ?) RETURNING id',
        [nombre, descripcion || '', JSON.stringify(permisos || []), tenantId]
      );
      res.json({ id: result.insertId || result[0]?.id, success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/roles/:id', async (req, res) => {
    const { id } = req.params;
    const { nombre, descripcion, permisos } = req.body;
    try {
      const tenantId = req.tenantId;
      await pool.query(
        'UPDATE roles SET nombre = ?, descripcion = ?, permisos = ? WHERE id = ? AND tenant_id = ?',
        [nombre, descripcion || '', JSON.stringify(permisos || []), id, tenantId]
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // === LOGIN & SESSION LIFECYCLE ===
  const handleLogin = async (req, res) => {
    const { email, username, cedula, password } = req.body;
    const identifier = String(email || username || cedula || '').trim();
    const clientIp = getClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Por favor ingresa tus credenciales.' });
    }

    try {
      if (pool.isPostgres) {
        const [pgUsers] = await pool.query(`
          SELECT u.*, b.name as branch_name, u.tenant_id
          FROM users u
          LEFT JOIN branches b ON (u.branch_id::text = b.id::text AND b.tenant_id = u.tenant_id)
          WHERE (LOWER(u.email) = LOWER(?) OR LOWER(u.username) = LOWER(?))
            AND COALESCE(u.is_active, true) = true
          ORDER BY u.created_at DESC
        `, [identifier, identifier]);

        if (pgUsers && pgUsers.length > 0) {
          let matchedUser = null;
          for (const candidate of pgUsers) {
            const storedHash = candidate.password_hash || candidate.password || '';
            let isPassValid = false;

            if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$')) {
              isPassValid = await bcrypt.compare(String(password), storedHash);
            } else if (storedHash) {
              isPassValid = (password === storedHash);
              if (isPassValid) {
                const upgradedHash = await bcrypt.hash(String(password), 10);
                await pool.query('UPDATE users SET password_hash = ?, password = NULL WHERE id = ? AND (tenant_id = ? OR tenant_id IS NULL)', [upgradedHash, candidate.id, candidate.tenant_id]);
              }
            }

            if (isPassValid) {
              matchedUser = candidate;
              break;
            }
          }

          if (!matchedUser) {
            return res.status(401).json({ error: 'Contraseña incorrecta.' });
          }
          const u = matchedUser;

          const effectiveRole = String(u.role || 'admin').toLowerCase();
          const isSuperAdmin = effectiveRole === 'superadmin';

          // Obtener configuración del Tenant si el usuario pertenece a un salón
          let tenantInfo = null;
          if (!isSuperAdmin && u.tenant_id) {
            const [tRows] = await pool.query(`
              SELECT t.*, sp.name as plan_name, sp.slug as plan_slug
              FROM tenants t
              LEFT JOIN saas_plans sp ON t.plan_id = sp.id
              WHERE t.id = ?
            `, [u.tenant_id]);
            tenantInfo = tRows[0] || null;
            if (!tenantInfo) {
              return res.status(403).json({ error: 'El salón asociado a este usuario no existe.' });
            }
            if (tenantInfo.status === 'terminated' || tenantInfo.status === 'inactive') {
              return res.status(403).json({ error: 'La cuenta de este salón se encuentra inactiva o finalizada. Contacte a soporte.' });
            }
          }

          const sessionId = crypto.randomUUID();
          // Inserción obligatoria de sesión (FAIL-CLOSED: Si falla la BD, no se emite token)
          await pool.query(`
            INSERT INTO user_sessions (id, user_id, user_name, role, salon_id, ip_address, user_agent, is_active, created_at, last_activity, tenant_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW(), ?)
          `, [
            sessionId,
            String(u.id),
            u.name || u.nombre,
            effectiveRole,
            u.branch_id ? String(u.branch_id) : (u.salon_id || '1'),
            clientIp,
            userAgent,
            u.tenant_id || null
          ]);

          const token = signAuthToken({
            sub: String(u.id),
            id: String(u.id),
            email: u.email,
            name: u.name || u.nombre,
            role: effectiveRole,
            tenantId: isSuperAdmin ? null : u.tenant_id,
            branchId: u.branch_id || u.salon_id || null,
            sessionId,
            isSuperAdmin,
            tokenVersion: (u.token_version !== undefined && u.token_version !== null) ? Number(u.token_version) : 1
          });

          res.cookie('auth_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging',
            sameSite: 'lax',
            path: '/',
            maxAge: 24 * 60 * 60 * 1000
          });

          // NUNCA devolver el token en el body JSON; se transmite exclusivamente vía cookie HttpOnly
          return res.json({
            id: u.id,
            tenant_id: u.tenant_id,
            branch_id: u.branch_id,
            nombre: u.name || u.nombre,
            name: u.name || u.nombre,
            email: u.email,
            role: effectiveRole,
            rol: effectiveRole,
            isSuperAdmin: Boolean(isSuperAdmin),
            is_superadmin: Boolean(isSuperAdmin),
            permissions: ['all'],
            salon_id: u.branch_id || u.salon_id || 1,
            salon_name: u.branch_name || tenantInfo?.business_name || 'Sucursal Principal',
            tenant: tenantInfo,
            sessionId
          });
        }
      }

      // Check brute-force lockouts
      const [secSettings] = await pool.query('SELECT max_failed_attempts, lockout_minutes, tenant_id FROM security_settings LIMIT 1');
      const maxAttempts = secSettings[0]?.max_failed_attempts || 5;
      const lockoutMins = secSettings[0]?.lockout_minutes || 30;

      const [ipBlocks] = await pool.query(
        'SELECT * FROM blocked_ips WHERE ip_address = ? AND (blocked_until IS NULL OR blocked_until > NOW()) LIMIT 1',
        [clientIp]
      );
      if (ipBlocks.length > 0) {
        return res.status(403).json({ error: 'Tu dirección IP ha sido bloqueada temporalmente por múltiples intentos fallidos.' });
      }

      const [accBlocks] = await pool.query(
        'SELECT * FROM account_lockouts WHERE account_identifier = ? AND (blocked_until IS NULL OR blocked_until > NOW()) LIMIT 1',
        [identifier]
      );
      if (accBlocks.length > 0) {
        return res.status(403).json({ error: 'Esta cuenta se encuentra bloqueada temporalmente por seguridad.' });
      }

      // Check clients table (B2C client portal login)
      const cleanCedula = identifier.replace(/\D/g, '');
      const [clients] = await pool.query(`
        SELECT c.*, s.name as salon_name, c.tenant_id
        FROM clients c
        LEFT JOIN salons s ON c.salon_id = s.id AND s.tenant_id = c.tenant_id
        WHERE c.email = ? OR c.cedula = ? OR (LENGTH(?) >= 8 AND REPLACE(c.cedula, '-', '') = ?)
        LIMIT 1
      `, [identifier, identifier, cleanCedula, cleanCedula]);

      if (clients.length > 0) {
        const client = clients[0];

        if (!client.password || client.status === 'Pending_Activation') {
          return res.status(403).json({
            error: 'Debes activar tu cuenta y configurar tu contraseña primero.',
            status: 'Pending_Activation',
            id: client.id
          });
        }

        let isClientPassValid = false;
        if (String(client.password).startsWith('$2a$') || String(client.password).startsWith('$2b$')) {
          isClientPassValid = await bcrypt.compare(String(password), client.password);
        } else {
          isClientPassValid = (client.password === password);
          if (isClientPassValid) {
            const upgraded = await bcrypt.hash(String(password), 10);
            await pool.query('UPDATE clients SET password = ? WHERE id = ? AND (tenant_id = ? OR tenant_id IS NULL)', [upgraded, client.id, client.tenant_id]);
          }
        }

        if (!isClientPassValid) {
          return res.status(401).json({ error: 'Contraseña incorrecta.' });
        }

        const sessionId = crypto.randomUUID();
        // Inserción obligatoria de sesión para cliente B2C (FAIL-CLOSED)
        await pool.query(`
          INSERT INTO user_sessions (id, user_id, user_name, role, salon_id, ip_address, user_agent, is_active, created_at, last_activity, tenant_id)
          VALUES (?, ?, ?, 'client', ?, ?, ?, 1, NOW(), NOW(), ?)
        `, [
          sessionId,
          String(client.id),
          client.nombre || 'Cliente',
          String(client.salon_id || '1'),
          clientIp,
          userAgent,
          client.tenant_id || null
        ]);

        const token = signAuthToken({
          sub: String(client.id),
          id: String(client.id),
          email: client.email,
          name: client.nombre,
          role: 'client',
          tenantId: client.tenant_id,
          branchId: client.salon_id,
          sessionId,
          isSuperAdmin: false,
          isClient: true
        });

        res.cookie('auth_token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging',
          sameSite: 'lax',
          path: '/',
          maxAge: 24 * 60 * 60 * 1000
        });

        // NUNCA devolver el token en el body JSON; se transmite exclusivamente vía cookie HttpOnly
        return res.json({
          id: client.id,
          tenant_id: client.tenant_id,
          nombre: client.nombre,
          email: client.email,
          cedula: client.cedula,
          telefono: client.telefono,
          role: 'client',
          rol: 'client',
          salon_id: client.salon_id || 1,
          salon_name: client.salon_name || 'Principal',
          sessionId
        });
      }

      return res.status(401).json({ error: 'Credenciales inválidas o usuario inactivo.' });
    } catch (err) {
      console.error('[LOGIN ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  };

  router.post('/auth/login', loginLimiter, handleLogin);
  router.post('/login', loginLimiter, handleLogin);
  router.post('/auth/client-login', loginLimiter, handleLogin);
  router.post('/client-login', loginLimiter, handleLogin);

  // Explicit Logout endpoint (REM-P1-01)
  const handleLogout = async (req, res) => {
    try {
      const sessionId = req.auth?.sessionId || req.body?.sessionId;
      const userId = req.auth?.id;
      const userName = req.auth?.name;
      if (sessionId) {
        if (req.auth?.tenantId) {
          await pool.query('UPDATE user_sessions SET is_active = 0 WHERE id = ? AND tenant_id = ?', [sessionId, req.auth.tenantId]);
        } else {
          await pool.query('UPDATE user_sessions SET is_active = 0 WHERE id = ? AND tenant_id IS NULL', [sessionId]);
        }
      }
      if (userId) {
        await pool.query('UPDATE users SET token_version = COALESCE(token_version, 1) + 1 WHERE id::text = ?', [String(userId)]);
        await logSecurityAudit(userId, userName, 'USER_LOGOUT', 'Cierre de sesión voluntario', req);
      }
      res.clearCookie('auth_token');
      res.json({ success: true, message: 'Sesión finalizada exitosamente.' });
    } catch (err) {
      res.status(500).json({ error: 'Error procesando cierre de sesión.' });
    }
  };

  router.post('/auth/logout', handleLogout);
  router.post('/logout', handleLogout);

  // Remote token revocation endpoint (REM-P1-01)
  const handleRevokeTokens = async (req, res) => {
    try {
      const isPrivileged = req.auth?.role === 'propietario' || req.auth?.role === 'admin' || req.auth?.isSuperAdmin;
      const targetUserId = (req.body?.userId && isPrivileged) ? String(req.body.userId) : (req.auth?.id ? String(req.auth.id) : null);

      if (!targetUserId) {
        return res.status(400).json({ error: 'Identificador de usuario no proporcionado.' });
      }

      await pool.query('UPDATE users SET token_version = COALESCE(token_version, 1) + 1 WHERE id::text = ?', [targetUserId]);
      await pool.query('UPDATE user_sessions SET is_active = 0 WHERE user_id::text = ?', [targetUserId]);

      if (req.auth?.id) {
        await logSecurityAudit(req.auth.id, req.auth.name, 'TOKENS_REVOKED', `Tokens revocados para usuario ID: ${targetUserId}`, req);
      }

      res.json({ success: true, message: 'Todos los tokens activos del usuario han sido revocados exitosamente.' });
    } catch (err) {
      console.error('[REVOKE TOKENS ERROR]:', err);
      res.status(500).json({ error: 'Error procesando revocación de tokens.' });
    }
  };

  router.post('/auth/revoke-tokens', handleRevokeTokens);
  router.post('/revoke-tokens', handleRevokeTokens);
  router.post('/auth/session-check', async (req, res) => {
    try {
      const auth = req.auth;
      if (!auth || !auth.id) {
        return res.status(401).json({ valid: false, error: 'No autenticado o token ausente.' });
      }

      const userId = String(auth.id);
      const role = String(auth.role || '').toLowerCase();
      const sessionId = auth.sessionId || null;

      if (sessionId) {
        const [sessions] = await pool.query('SELECT is_active, tenant_id FROM user_sessions WHERE id = ? LIMIT 1', [sessionId]);
        if (!sessions || sessions.length === 0 || !sessions[0].is_active) {
          return res.status(401).json({ valid: false, reason: 'remote_terminated', error: 'Sesión finalizada remotamente.' });
        }
        if (auth.tenantId) {
          await pool.query('UPDATE user_sessions SET last_activity = NOW() WHERE id = ? AND tenant_id = ?', [sessionId, auth.tenantId]);
        } else {
          await pool.query('UPDATE user_sessions SET last_activity = NOW() WHERE id = ? AND tenant_id IS NULL', [sessionId]);
        }
      }

      if (role !== 'client') {
        const [users] = await pool.query(
          "SELECT id, nombre, name, role, salon_id, branch_id, tenant_id, estado, is_active FROM users WHERE id::text = ? LIMIT 1",
          [userId]
        );
        if (!users || users.length === 0 || users[0].estado === 'Inactivo' || users[0].is_active === false) {
          return res.status(401).json({ valid: false, reason: 'user_deleted', error: 'Usuario desactivado o eliminado.' });
        }

        const u = users[0];
        let tenantInfo = null;
        if (u.tenant_id) {
          const [tRows] = await pool.query(`
            SELECT t.*, sp.name as plan_name, sp.slug as plan_slug
            FROM tenants t
            LEFT JOIN saas_plans sp ON t.plan_id = sp.id
            WHERE t.id = ?
          `, [u.tenant_id]);
          tenantInfo = tRows[0] || null;
          if (tenantInfo && tenantInfo.status === 'suspended') {
            return res.status(403).json({ valid: false, reason: 'tenant_suspended', error: 'Salón suspendido.' });
          }
        }
        return res.json({ valid: true, tenant: tenantInfo });
      }

      return res.json({ valid: true });
    } catch (err) {
      console.error('[SESSION CHECK ERROR]:', err);
      // FAIL CLOSED: NUNCA responder valid: true ante error
      return res.status(500).json({ valid: false, error: 'Error verificando sesión en base de datos.' });
    }
  });

  router.router = router;
  return router;
}

module.exports = { createAuthRouter };
