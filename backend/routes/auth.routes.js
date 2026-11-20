const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const { signAuthToken } = require('../middleware/auth.middleware');
const { resolveTransporterForTenant } = require('../services/platform_email.service');
const {
  resolveAuthorizedPublicOrigin,
  resolveAuthorizedAssetOrigin,
  buildPasswordResetEmail,
  buildPasswordChangedEmail,
} = require('../services/password_reset_email.template');
const { requireRole, requirePermission, getEffectiveRole, canManageRole, normalizeRole } = require('../middleware/rbac.middleware');
const {
  PERMISSION_MODULES,
  isReservedRoleName,
  sanitizePermissionsPayload,
  expandEffectivePermissions,
  permissionMapGrants,
} = require('../domain/rbac_catalog');

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

  // Per-account rate limiter (in-memory sliding window, anti-enumeration)
  const accountRecoveryHits = new Map();
  const isAccountRecoveryRateLimited = (identifierKey) => {
    const key = String(identifierKey || '').toLowerCase().trim();
    if (!key) return false;
    const now = Date.now();
    const windowMs = 15 * 60 * 1000;
    const entries = (accountRecoveryHits.get(key) || []).filter((ts) => now - ts < windowMs);
    if (entries.length >= 5) {
      accountRecoveryHits.set(key, entries);
      return true;
    }
    entries.push(now);
    accountRecoveryHits.set(key, entries);
    return false;
  };

  // === PASSWORD RECOVERY & ACCOUNT ACTIVATION (STRICT TENANT-BOUND & ANTI-ENUMERATION) ===
  const handleForgotPassword = async (req, res) => {
    const { email, cedula, username, emailOrCedula } = req.body;
    const identifier = String(emailOrCedula || email || username || cedula || '').trim();
    const tenantId = req.tenantId || req.headers['x-tenant-id'] || req.body.tenant_id || null;

    if (!identifier) {
      return res.status(400).json({ error: 'Por favor, ingresa tu correo electrónico, usuario o cédula.' });
    }

    // Generic response message to prevent account enumeration
    const genericSuccess = {
      success: true,
      message: 'Si la cuenta existe en el sistema, hemos enviado un enlace de recuperación al correo registrado.'
    };

    if (process.env.NODE_ENV !== 'test' && isAccountRecoveryRateLimited(identifier)) {
      return res.json(genericSuccess);
    }

    try {
      let targetUser = null;
      let isSystemUser = false;
      const cleanId = identifier;
      const cleanDigits = cleanId.replace(/\D/g, '');

      if (tenantId) {
        // Scoped lookup within tenant
        const [clients] = await pool.query(
          "SELECT id, nombre, email, cedula, tenant_id FROM clients WHERE tenant_id = ? AND (LOWER(email) = LOWER(?) OR cedula = ? OR REPLACE(cedula, '-', '') = ?) LIMIT 1",
          [tenantId, cleanId, cleanId, cleanDigits]
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
        // Public landing lookup (no tenant context): check system users (superadmin, owners, staff) then clients
        const [users] = await pool.query(
          "SELECT id, COALESCE(nombre, name) as nombre, email, username, tenant_id FROM users WHERE (LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)) ORDER BY CASE WHEN tenant_id IS NULL THEN 0 ELSE 1 END, id DESC LIMIT 1",
          [cleanId, cleanId]
        );
        if (users.length > 0) {
          targetUser = users[0];
          isSystemUser = true;
        } else {
          const [clients] = await pool.query(
            "SELECT c.id, c.nombre, c.email, c.cedula, c.tenant_id FROM clients c INNER JOIN tenants t ON c.tenant_id = t.id WHERE t.status = 'active' AND (LOWER(c.email) = LOWER(?) OR (LENGTH(?) >= 5 AND (c.cedula = ? OR REPLACE(c.cedula, '-', '') = ?))) ORDER BY c.id DESC LIMIT 1",
            [cleanId, cleanDigits, cleanId, cleanDigits]
          );
          if (clients.length > 0) {
            targetUser = clients[0];
          }
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

      // Invalidate ALL prior unused password reset tokens/codes for this specific tenant & user
      if (userTenantId) {
        await pool.query(
          "UPDATE verification_codes SET is_used = 1 WHERE tenant_id = ? AND (user_id = ? OR client_id = ?) AND purpose IN ('password_reset', 'password_reset_link') AND is_used = 0",
          [userTenantId, targetUserId, targetUserId]
        );
      } else {
        await pool.query(
          "UPDATE verification_codes SET is_used = 1 WHERE tenant_id IS NULL AND (user_id = ? OR client_id = ?) AND purpose IN ('password_reset', 'password_reset_link') AND is_used = 0",
          [targetUserId, targetUserId]
        );
      }

      // High entropy 256-bit cryptographic token; persist ONLY its SHA-256 hash
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const ttlMinutes = Math.max(5, Math.min(120, parseInt(process.env.PASSWORD_RESET_TTL_MINUTES, 10) || 15));
      const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

      await pool.query(
        'INSERT INTO verification_codes (tenant_id, user_id, client_id, identity, purpose, channel, code, code_hash, attempts, max_attempts, expires_at, is_used) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, 5, ?, 0)',
        [userTenantId, targetUserId, targetUserId, recipientEmail, 'password_reset_link', 'email', tokenHash, expiresAt]
      );

      const publicOrigin = resolveAuthorizedPublicOrigin();
      const logoUrl = `${resolveAuthorizedAssetOrigin()}/icon-192x192.png`;
      const resetUrl = `${publicOrigin}/restablecer-contrasena?token=${rawToken}`;
      const mailContent = buildPasswordResetEmail({
        logoUrl,
        resetUrl,
        ttlMinutes,
      });

      try {
        const { transporter, fromAddress } = await resolveTransporterForTenant(pool, userTenantId, 'Etereas');

        if (transporter) {
          await transporter.sendMail({
            from: fromAddress,
            to: recipientEmail,
            subject: mailContent.subject,
            text: mailContent.text,
            html: mailContent.html,
          });
        } else {
          console.warn('[FORGOT PASSWORD EMAIL WARN]: No hay transporte SMTP configurado.');
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

  // GET /api/auth/reset-password/validate - Validate link token WITHOUT consuming it (scanner-safe)
  const handleValidateResetToken = async (req, res) => {
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    const rawToken = String(req.query?.token || '').trim();
    if (!rawToken || !/^[0-9a-f]{32,128}$/i.test(rawToken)) {
      return res.status(400).json({ valid: false, error: 'El enlace de recuperación es inválido o ha expirado.' });
    }
    try {
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const [rows] = await pool.query(
        "SELECT id FROM verification_codes WHERE code_hash = ? AND purpose = 'password_reset_link' AND is_used = 0 AND expires_at > NOW() LIMIT 1",
        [tokenHash]
      );
      if (!rows || rows.length === 0) {
        return res.status(400).json({ valid: false, error: 'El enlace de recuperación es inválido o ha expirado.' });
      }
      return res.json({ valid: true });
    } catch {
      return res.status(500).json({ valid: false, error: 'No se pudo validar el enlace de recuperación.' });
    }
  };
  router.get('/auth/reset-password/validate', recoveryLimiter, handleValidateResetToken);
  router.get('/reset-password/validate', recoveryLimiter, handleValidateResetToken);

  const handleResetPassword = async (req, res) => {
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    const { token, code, newPassword, password, clientId, userId, emailOrCedula, email, username, cedula } = req.body;
    const finalPassword = newPassword || password;
    const rawToken = String(token || '').trim();
    const cleanCode = String(code || '').trim();
    const tenantId = req.tenantId || req.headers['x-tenant-id'] || req.body.tenant_id || null;
    let targetUserId = String(userId || clientId || '').trim();
    const rawIdentifier = String(emailOrCedula || email || username || cedula || '').trim();

    if (!finalPassword || String(finalPassword).length < 4) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 4 caracteres.' });
    }

    if (rawToken) {
      try {
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        // Atomic single-use consumption: only one concurrent request can win UPDATE ... RETURNING
        const [consumedRows] = await pool.query(
          "UPDATE verification_codes SET is_used = 1, used_at = NOW() WHERE code_hash = ? AND purpose = 'password_reset_link' AND is_used = 0 AND expires_at > NOW() RETURNING id, tenant_id, user_id, client_id, identity",
          [tokenHash]
        );
        if (!consumedRows || consumedRows.length === 0) {
          return res.status(400).json({ error: 'El enlace de recuperación es inválido, ya fue utilizado o ha expirado.' });
        }
        const rec = consumedRows[0];
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
        } else if (resolvedUserId) {
          let cQuery = 'UPDATE clients SET password = ?, token_version = COALESCE(token_version, 1) + 1 WHERE id = ?';
          const cParams = [hashedPass, resolvedUserId];
          if (rec.tenant_id) {
            cQuery += ' AND tenant_id = ?';
            cParams.push(rec.tenant_id);
          } else {
            cQuery += ' AND tenant_id IS NULL';
          }
          await pool.query(cQuery, cParams);
        } else {
          return res.status(404).json({ error: 'No se encontró la cuenta vinculada al enlace.' });
        }

        // Send password-changed notification without including the new password
        if (rec.identity) {
          try {
            const { transporter, fromAddress } = await resolveTransporterForTenant(pool, rec.tenant_id || null, 'Etereas');
            if (transporter) {
              const changedAtRd = new Date().toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo' });
              const changedMail = buildPasswordChangedEmail({ changedAtRd });
              await transporter.sendMail({
                from: fromAddress,
                to: rec.identity,
                subject: changedMail.subject,
                text: changedMail.text,
                html: changedMail.html,
              });
            }
          } catch (notifyErr) {
            console.warn('[PASSWORD CHANGED NOTIFY WARN]:', notifyErr.message);
          }
        }

        return res.json({ success: true, message: 'Contraseña actualizada exitosamente. Tus sesiones anteriores fueron cerradas.' });
      } catch (err) {
        console.error('[RESET PASSWORD TOKEN ERROR]:', err.message);
        return res.status(500).json({ error: 'Error restableciendo la contraseña.' });
      }
    }

    if (!cleanCode || (!targetUserId && !rawIdentifier)) {
      return res.status(400).json({ error: 'Código de verificación e identificador de cuenta requeridos.' });
    }

    try {
      const inputHash = crypto.createHash('sha256').update(cleanCode).digest('hex');

      let resolvedTenantId = tenantId || null;

      if (!targetUserId) {
        // Resolve userId/clientId from emailOrCedula when resetting from public Landing
        const cleanDigits = rawIdentifier.replace(/\D/g, '');
        let resolvedAccount = null;
        if (tenantId) {
          const [uRows] = await pool.query(
            "SELECT id, tenant_id FROM users WHERE tenant_id = ? AND (LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)) LIMIT 1",
            [tenantId, rawIdentifier, rawIdentifier]
          );
          if (uRows.length > 0) {
            resolvedAccount = { targetId: `USER-${uRows[0].id}`, tenantId: uRows[0].tenant_id };
          } else {
            const [cRows] = await pool.query(
              "SELECT id, tenant_id FROM clients WHERE tenant_id = ? AND (LOWER(email) = LOWER(?) OR cedula = ? OR REPLACE(cedula, '-', '') = ?) LIMIT 1",
              [tenantId, rawIdentifier, rawIdentifier, cleanDigits]
            );
            if (cRows.length > 0) resolvedAccount = { targetId: String(cRows[0].id), tenantId: cRows[0].tenant_id };
          }
        } else {
          const [uRows] = await pool.query(
            "SELECT id, tenant_id FROM users WHERE (LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)) ORDER BY CASE WHEN tenant_id IS NULL THEN 0 ELSE 1 END, id DESC LIMIT 1",
            [rawIdentifier, rawIdentifier]
          );
          if (uRows.length > 0) {
            resolvedAccount = { targetId: `USER-${uRows[0].id}`, tenantId: uRows[0].tenant_id };
          } else {
            const [cRows] = await pool.query(
              "SELECT c.id, c.tenant_id FROM clients c INNER JOIN tenants t ON c.tenant_id = t.id WHERE t.status = 'active' AND (LOWER(c.email) = LOWER(?) OR (LENGTH(?) >= 5 AND (c.cedula = ? OR REPLACE(c.cedula, '-', '') = ?))) ORDER BY c.id DESC LIMIT 1",
              [rawIdentifier, cleanDigits, rawIdentifier, cleanDigits]
            );
            if (cRows.length > 0) resolvedAccount = { targetId: String(cRows[0].id), tenantId: cRows[0].tenant_id };
          }
        }

        if (!resolvedAccount) {
          return res.status(400).json({ error: 'El código de verificación es inválido o ha expirado.' });
        }

        targetUserId = resolvedAccount.targetId;
        resolvedTenantId = resolvedAccount.tenantId || null;
      }

      const [rows] = resolvedTenantId
        ? await pool.query(
            "SELECT id, code_hash, attempts, max_attempts, client_id, user_id, tenant_id FROM verification_codes WHERE tenant_id = ? AND (user_id = ? OR client_id = ?) AND purpose = 'password_reset' AND is_used = 0 AND expires_at > NOW() ORDER BY id DESC LIMIT 1",
            [resolvedTenantId, targetUserId, targetUserId]
          )
        : await pool.query(
            "SELECT id, code_hash, attempts, max_attempts, client_id, user_id, tenant_id FROM verification_codes WHERE tenant_id IS NULL AND (user_id = ? OR client_id = ?) AND purpose = 'password_reset' AND is_used = 0 AND expires_at > NOW() ORDER BY id DESC LIMIT 1",
            [targetUserId, targetUserId]
          );

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
        return res.status(400).json({ error: 'El código de activación no tiene una empresa asociado.' });
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
        error: 'Acceso denegado: El rol de SuperAdmin pertenece al plano de control (Control Plane) y tiene estrictamente prohibido operar sobre recursos privados de la empresa.',
        code: 'CONTROL_PLANE_ROLE_FORBIDDEN'
      });
    }
    if (role === 'cliente_b2c' || req.auth?.isClient) {
      return res.status(403).json({
        error: 'Acceso denegado: Los clientes B2C no tienen acceso a la gestión de personal o roles.',
        code: 'CLIENT_FORBIDDEN_STAFF_ACTION'
      });
    }
    next();
  };

  async function getAllowAdminRoleDelegation(tenantId) {
    try {
      const [rows] = await pool.query(
        'SELECT allow_admin_role_delegation FROM security_settings WHERE tenant_id = ? LIMIT 1',
        [tenantId]
      );
      return Boolean(rows?.[0]?.allow_admin_role_delegation);
    } catch {
      return false;
    }
  }

  async function canManageRolesPolicy(req) {
    const actorRole = getEffectiveRole(req);
    if (actorRole === 'propietario') return true;
    if (actorRole === 'admin') {
      return await getAllowAdminRoleDelegation(req.tenantId);
    }
    return false;
  }

  function validateRoleDelegation(req, targetPermissions) {
    const actorRole = getEffectiveRole(req);
    if (actorRole === 'propietario') return { allowed: true };
    // Admin (solo si tiene delegación habilitada explícitamente) no puede conceder permisos que no posee
    const actorPerms = req.auth?.permissions || {};
    const requestedKeys = Object.keys(targetPermissions || {}).filter((k) => targetPermissions[k] === true);
    const forbidden = requestedKeys.filter((k) => !permissionMapGrants(actorPerms, k));
    if (forbidden.length > 0) {
      return {
        allowed: false,
        forbidden,
      };
    }
    return { allowed: true };
  }

  async function validateTenantRoleId(roleId, tenantId) {
    if (roleId === undefined || roleId === null || roleId === '') {
      return { valid: true, roleRow: null };
    }
    const [rows] = await pool.query(
      'SELECT id, nombre, permisos, tenant_id FROM roles WHERE id = ? AND tenant_id = ? LIMIT 1',
      [roleId, tenantId]
    );
    if (!rows || rows.length === 0) {
      return { valid: false, error: 'El rol personalizado especificado no existe o pertenece a otra empresa.' };
    }
    return { valid: true, roleRow: rows[0] };
  }

  async function validateTenantBranches({ branch_id, salon_id, authorized_branch_ids }, tenantId) {
    const validateSingle = async (candidate) => {
      if (candidate === undefined || candidate === null || candidate === '' || String(candidate) === 'all') {
        return null;
      }
      const [rows] = await pool.query(
        'SELECT id FROM branches WHERE id::text = ? AND tenant_id = ? LIMIT 1',
        [String(candidate), tenantId]
      );
      if (!rows || rows.length === 0) {
        const err = new Error('La sucursal especificada no existe o pertenece a otra empresa.');
        err.code = 'INVALID_OR_CROSS_TENANT_BRANCH';
        err.statusCode = 403;
        throw err;
      }
      return rows[0].id;
    };

    const resolvedBranchId = await validateSingle(branch_id ?? salon_id);
    let resolvedAuthList = undefined;
    if (Array.isArray(authorized_branch_ids)) {
      resolvedAuthList = [];
      for (const bId of authorized_branch_ids) {
        const verified = await validateSingle(bId);
        if (verified !== null) resolvedAuthList.push(String(verified));
      }
      resolvedAuthList = Array.from(new Set(resolvedAuthList));
    }
    return { resolvedBranchId, resolvedAuthList };
  }

  router.get('/users', rejectControlPlaneOnTenantUsers, requirePermission('security.view'), async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de empresa requerido.' });
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
               u.authorized_branch_ids,
               u.all_branches_access,
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

  // Mutex simple por tenant para operaciones críticas de Last-Owner cuando no hay Postgres FOR UPDATE
  const lastOwnerLocks = new Map();
  async function withTenantUserLock(tenantId, fn) {
    const key = String(tenantId);
    const prev = lastOwnerLocks.get(key) || Promise.resolve();
    let release;
    const next = new Promise((res) => { release = res; });
    lastOwnerLocks.set(key, prev.then(() => next));
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (lastOwnerLocks.get(key) === next) lastOwnerLocks.delete(key);
    }
  }

  async function ensureRemainingActiveOwner(queryRunner, tenantId, targetUserId, { newRole, newIsActive }) {
    const isTargetStillOwner =
      (!newRole || normalizeRole(newRole) === 'propietario') &&
      (newIsActive === undefined || newIsActive === true);
    if (isTargetStillOwner) return;

    const lockClause = pool.isPostgres ? ' FOR UPDATE' : '';
    const [allTenantUsers] = await queryRunner.query(
      `SELECT id, role, is_active, estado FROM users WHERE tenant_id = ?${lockClause}`,
      [tenantId]
    );
    const remainingOwners = (allTenantUsers || []).filter((u) => {
      const r = normalizeRole(u.role);
      const isAct = u.is_active === true || u.is_active === 1 || String(u.estado || '').toLowerCase() === 'activo';
      return r === 'propietario' && String(u.id) !== String(targetUserId) && isAct;
    }).length;

    if (remainingOwners < 1) {
      const err = new Error('No es posible eliminar, degradar o desactivar al único propietario activo de la empresa.');
      err.code = 'CANNOT_DEGRADE_LAST_OWNER';
      err.statusCode = 409;
      throw err;
    }
  }

  router.post('/users', rejectControlPlaneOnTenantUsers, requirePermission('security.manage'), async (req, res) => {
    const {
      nombre, name, username, email, password, role_id, role,
      salon_id, branch_id, authorized_branch_ids, all_branches_access,
      estado, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos
    } = req.body;
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'No se pudo determinar la empresa (Tenant) para crear el usuario.' });
      }

      const actorRole = getEffectiveRole(req);
      const targetRole = role ? normalizeRole(role) : 'empleado';
      const isKioskRole = targetRole === 'kiosco_asistencia';

      if (targetRole === 'superadmin' || targetRole === 'cliente_b2c' || !canManageRole(actorRole, targetRole)) {
        return res.status(403).json({
          error: `No tienes autorización para crear usuarios con el rol '${targetRole}'.`,
          code: 'PRIVILEGE_ESCALATION_DENIED'
        });
      }

      if (isKioskRole) {
        if (role_id !== undefined && role_id !== null && String(role_id).trim() !== '') {
          return res.status(400).json({
            error: 'El rol reservado Kiosco de Asistencia tiene permisos fijos y restringidos; no se pueden asignar permisos operativos ni administrativos.',
            code: 'KIOSK_FIXED_PERMISSIONS'
          });
        }
        if (all_branches_access === true) {
          return res.status(400).json({
            error: 'La cuenta Kiosco de Asistencia debe estar asignada a una única sucursal.',
            code: 'KIOSK_SINGLE_BRANCH_ONLY'
          });
        }
        if (!branch_id && !salon_id) {
          return res.status(400).json({
            error: 'Debes seleccionar una sucursal obligatoria para la cuenta Kiosco de Asistencia.',
            code: 'KIOSK_BRANCH_REQUIRED'
          });
        }
      }

      const roleCheck = isKioskRole
        ? { valid: true, roleRow: null }
        : await validateTenantRoleId(role_id, tenantId);
      if (!roleCheck.valid) {
        return res.status(403).json({ error: roleCheck.error, code: 'INVALID_OR_CROSS_TENANT_ROLE' });
      }
      if (roleCheck.roleRow) {
        const rolePerms = sanitizePermissionsPayload(roleCheck.roleRow.permisos);
        const delegCheck = validateRoleDelegation(req, rolePerms);
        if (!delegCheck.allowed) {
          return res.status(403).json({
            error: `No puedes asignar un rol con permisos que no posees: ${delegCheck.forbidden.join(', ')}`,
            code: 'DELEGATION_EXCEEDS_ACTOR_PRIVILEGES'
          });
        }
      }

      const finalName = (nombre || name || '').trim();
      const finalEmail = (email || username || '').trim();
      if (!finalName || !finalEmail || !password) {
        return res.status(400).json({ error: 'Nombre, correo electrónico y contraseña son obligatorios.' });
      }

      // El rol técnico reservado 'kiosco_asistencia' NO consume asientos facturables
      if (!req.auth?.isSuperAdmin && !isKioskRole) {
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
          const [userCount] = await pool.query(
            "SELECT COUNT(*) as total FROM users WHERE tenant_id = ? AND LOWER(COALESCE(role, '')) NOT IN ('superadmin', 'cliente_b2c', 'kiosco_asistencia') AND (is_active = TRUE OR estado = 'Activo')",
            [tenantId]
          );
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

      const [existingEmail] = await pool.query('SELECT id, tenant_id FROM users WHERE LOWER(email) = LOWER(?)', [finalEmail]);
      if (existingEmail.length > 0) {
        return res.status(400).json({ error: 'Ya existe un usuario con ese correo electrónico.' });
      }

      let { resolvedBranchId, resolvedAuthList } = await validateTenantBranches(
        { branch_id, salon_id, authorized_branch_ids },
        tenantId
      );
      if (!resolvedBranchId) {
        const [mainBranch] = await pool.query('SELECT id FROM branches WHERE tenant_id = ? ORDER BY is_main DESC, created_at ASC LIMIT 1', [tenantId]);
        if (mainBranch.length > 0) resolvedBranchId = mainBranch[0].id;
      }

      const passwordHash = await bcrypt.hash(String(password), 10);
      const effectiveRole = targetRole !== 'superadmin' ? targetRole : 'empleado';
      const isActive = String(estado || 'Activo').toLowerCase() !== 'inactivo';
      const finalRoleId = roleCheck.roleRow ? roleCheck.roleRow.id : null;

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
          finalRoleId,
          effectiveRole,
          resolvedBranchId ? String(resolvedBranchId) : null,
          estado || 'Activo',
          isActive,
          hora_entrada || '09:00:00',
          hora_salida || '18:00:00',
          typeof dias_laborables === 'object' ? JSON.stringify(dias_laborables) : (dias_laborables || null),
          tolerancia_minutos !== undefined ? tolerancia_minutos : 15
        ]
      );

      const newUserId = result.insertId || result[0]?.id;
      if (newUserId && (resolvedAuthList !== undefined || all_branches_access !== undefined)) {
        try {
          await pool.query(
            'UPDATE users SET authorized_branch_ids = ?, all_branches_access = ? WHERE id::text = ? AND tenant_id = ?',
            [
              JSON.stringify(resolvedAuthList || (resolvedBranchId ? [String(resolvedBranchId)] : [])),
              Boolean(all_branches_access) && actorRole === 'propietario',
              String(newUserId),
              tenantId
            ]
          );
        } catch { /* pre-migration optional columns */ }
      }

      try {
        await pool.query(`
          INSERT INTO security_audit_logs (user_id, user_name, action, details, tenant_id)
          VALUES (?, ?, 'USER_CREATED', ?, ?)
        `, [String(req.auth?.id || 'SYSTEM'), req.auth?.name || 'Admin', `Usuario creado: ${finalEmail} (rol=${effectiveRole}, role_id=${finalRoleId || 'none'})`, tenantId]);
      } catch { }

      res.json({ id: newUserId, success: true });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message, code: err.code });
      }
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/users/:id', rejectControlPlaneOnTenantUsers, requirePermission('security.manage'), async (req, res) => {
    const { id } = req.params;
    const {
      nombre, name, username, email, password, role_id, role,
      salon_id, branch_id, authorized_branch_ids, all_branches_access,
      estado, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos
    } = req.body;
    try {
      const tenantId = req.tenantId;
      const result = await withTenantUserLock(tenantId, async () => {
        let txClient = null;
        const runner = pool.isPostgres && typeof pool.connect === 'function'
          ? (txClient = await pool.connect())
          : pool;

        try {
          if (txClient) await txClient.query('BEGIN');

          const [existing] = await runner.query(
            'SELECT id, tenant_id, role, role_id, branch_id, is_active, estado FROM users WHERE id::text = ? AND tenant_id = ? LIMIT 1',
            [String(id), tenantId]
          );
          if (!existing || existing.length === 0) {
            if (txClient) await txClient.query('ROLLBACK');
            return { status: 404, body: { error: 'Usuario no encontrado en esta empresa.' } };
          }

          const targetUser = existing[0];
          const actorId = String(req.auth?.id || '');
          const isSelfEdit = String(targetUser.id) === actorId;
          const actorRole = getEffectiveRole(req);
          const currentTargetRole = normalizeRole(targetUser.role || 'empleado');

          if (!canManageRole(actorRole, currentTargetRole) && !isSelfEdit) {
            if (txClient) await txClient.query('ROLLBACK');
            return {
              status: 403,
              body: { error: 'No tienes autorización para modificar a este usuario.', code: 'FORBIDDEN_CANNOT_MANAGE_USER' }
            };
          }

          // Impedir auto-escalada al editarse a sí mismo
          if (
            isSelfEdit &&
            (role !== undefined || role_id !== undefined || authorized_branch_ids !== undefined || all_branches_access !== undefined || estado !== undefined)
          ) {
            if (txClient) await txClient.query('ROLLBACK');
            return {
              status: 403,
              body: { error: 'No puedes modificar tu propio rol, permisos, sucursales autorizadas ni estado.', code: 'SELF_PRIVILEGE_MODIFICATION_DENIED' }
            };
          }

          if (role) {
            const newTargetRole = normalizeRole(role);
            if (newTargetRole === 'superadmin' || newTargetRole === 'cliente_b2c' || !canManageRole(actorRole, newTargetRole)) {
              if (txClient) await txClient.query('ROLLBACK');
              return {
                status: 403,
                body: { error: `No tienes autorización para asignar el rol '${newTargetRole}'.`, code: 'PRIVILEGE_ESCALATION_DENIED' }
              };
            }
          }

          if (role_id !== undefined) {
            const roleCheck = await validateTenantRoleId(role_id, tenantId);
            if (!roleCheck.valid) {
              if (txClient) await txClient.query('ROLLBACK');
              return { status: 403, body: { error: roleCheck.error, code: 'INVALID_OR_CROSS_TENANT_ROLE' } };
            }
            if (roleCheck.roleRow) {
              const rolePerms = sanitizePermissionsPayload(roleCheck.roleRow.permisos);
              const delegCheck = validateRoleDelegation(req, rolePerms);
              if (!delegCheck.allowed) {
                if (txClient) await txClient.query('ROLLBACK');
                return {
                  status: 403,
                  body: { error: `No puedes asignar permisos que no posees: ${delegCheck.forbidden.join(', ')}`, code: 'DELEGATION_EXCEEDS_ACTOR_PRIVILEGES' }
                };
              }
            }
          }

          const { resolvedBranchId, resolvedAuthList } = await validateTenantBranches(
            { branch_id, salon_id, authorized_branch_ids },
            tenantId
          );

          const isActive = estado !== undefined ? (String(estado).toLowerCase() !== 'inactivo') : undefined;
          const safeRole = role && normalizeRole(role) !== 'superadmin' ? normalizeRole(role) : undefined;
          const nextEffectiveRole = safeRole || currentTargetRole;

          // Restricciones del rol reservado Kiosco de Asistencia
          if (nextEffectiveRole === 'kiosco_asistencia') {
            if (role_id !== undefined && role_id !== null && String(role_id).trim() !== '') {
              if (txClient) await txClient.query('ROLLBACK');
              return {
                status: 400,
                body: {
                  error: 'El rol reservado Kiosco de Asistencia tiene permisos fijos; no se pueden agregar permisos operativos ni administrativos.',
                  code: 'KIOSK_FIXED_PERMISSIONS'
                }
              };
            }
            if (all_branches_access === true) {
              if (txClient) await txClient.query('ROLLBACK');
              return {
                status: 400,
                body: {
                  error: 'La cuenta Kiosco de Asistencia solo puede operar una sucursal asignada.',
                  code: 'KIOSK_SINGLE_BRANCH_ONLY'
                }
              };
            }
          }

          // Si una cuenta exenta (kiosco_asistencia) cambia a un rol facturable, validar cupo disponible antes de aplicar
          if (currentTargetRole === 'kiosco_asistencia' && nextEffectiveRole !== 'kiosco_asistencia' && !req.auth?.isSuperAdmin) {
            if (options.entitlementsService) {
              const limitCheck = await options.entitlementsService.checkLimit(tenantId, 'users');
              if (!limitCheck.allowed) {
                if (txClient) await txClient.query('ROLLBACK');
                return {
                  status: 403,
                  body: {
                    error: limitCheck.reason || 'Has alcanzado el límite de usuarios facturables de tu plan.',
                    code: limitCheck.code || 'PLAN_LIMIT_REACHED',
                    limit: 'users',
                    current: limitCheck.current,
                    maximum: limitCheck.maximum
                  }
                };
              }
            } else {
              const [tRows] = await runner.query('SELECT max_users FROM tenants WHERE id = ?', [tenantId]);
              const [uCnt] = await runner.query(
                "SELECT COUNT(*) as total FROM users WHERE tenant_id = ? AND LOWER(COALESCE(role, '')) NOT IN ('superadmin', 'cliente_b2c', 'kiosco_asistencia') AND (is_active = TRUE OR estado = 'Activo')",
                [tenantId]
              );
              const maxU = parseInt(tRows[0]?.max_users || 3, 10);
              const curU = parseInt(uCnt[0]?.total || 0, 10);
              if (curU >= maxU) {
                if (txClient) await txClient.query('ROLLBACK');
                return {
                  status: 403,
                  body: {
                    error: 'Has alcanzado el límite de usuarios facturables de tu plan.',
                    code: 'PLAN_LIMIT_REACHED',
                    limit: 'users',
                    current: curU,
                    maximum: maxU
                  }
                };
              }
            }
          }

          if (currentTargetRole === 'propietario') {
            await ensureRemainingActiveOwner(runner, tenantId, targetUser.id, {
              newRole: safeRole || currentTargetRole,
              newIsActive: isActive,
            });
          }

          const finalName = nombre || name;
          const privilegeChanged = Boolean(
            (safeRole && safeRole !== currentTargetRole) ||
            (role_id !== undefined && String(role_id) !== String(targetUser.role_id)) ||
            (resolvedBranchId && String(resolvedBranchId) !== String(targetUser.branch_id)) ||
            resolvedAuthList !== undefined ||
            all_branches_access !== undefined ||
            (isActive !== undefined && isActive !== Boolean(targetUser.is_active))
          );

          let query = `
            UPDATE users SET 
              nombre = COALESCE(?, nombre),
              name = COALESCE(?, name),
              username = COALESCE(?, username),
              email = COALESCE(?, email),
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
            safeRole ?? null,
            resolvedBranchId ? String(resolvedBranchId) : null,
            resolvedBranchId ?? null,
            estado ?? null,
            isActive !== undefined ? isActive : null,
            hora_entrada ?? null,
            hora_salida ?? null,
            typeof dias_laborables === 'object' ? JSON.stringify(dias_laborables) : (dias_laborables ?? null),
            tolerancia_minutos ?? null
          ];

          if (role_id !== undefined) {
            query += `, role_id = ?`;
            params.push(role_id === '' || role_id === null ? null : role_id);
          }
          if (password && String(password).trim() !== '') {
            const hashed = await bcrypt.hash(String(password), 10);
            query += `, password_hash = ?, password = NULL`;
            params.push(hashed);
          }
          if (privilegeChanged || (password && String(password).trim() !== '')) {
            query += `, token_version = COALESCE(token_version, 1) + 1`;
          }

          query += ` WHERE id::text = ? AND tenant_id = ?`;
          params.push(String(id), tenantId);

          await runner.query(query, params);

          if (resolvedAuthList !== undefined || all_branches_access !== undefined) {
            try {
              if (resolvedAuthList !== undefined) {
                await runner.query(
                  'UPDATE users SET authorized_branch_ids = ? WHERE id::text = ? AND tenant_id = ?',
                  [JSON.stringify(resolvedAuthList), String(id), tenantId]
                );
              }
              if (all_branches_access !== undefined && actorRole === 'propietario') {
                await runner.query(
                  'UPDATE users SET all_branches_access = ? WHERE id::text = ? AND tenant_id = ?',
                  [Boolean(all_branches_access), String(id), tenantId]
                );
              }
            } catch { /* pre-migration optional columns */ }
          }

          if (isActive === false || privilegeChanged) {
            try {
              await runner.query(
                'UPDATE user_sessions SET is_active = 0 WHERE user_id = ? AND tenant_id = ?',
                [String(id), tenantId]
              );
            } catch { }
            if (currentTargetRole === 'kiosco_asistencia') {
              try {
                const { revokeDevicesByKioskUser } = require('../services/kiosk_device.service');
                await revokeDevicesByKioskUser(runner, {
                  tenantId,
                  userId: String(id),
                  reason: isActive === false ? 'Cuenta kiosco desactivada' : 'Rol o sucursal de cuenta kiosco modificada'
                });
              } catch { }
            }
          }

          if (txClient) await txClient.query('COMMIT');

          try {
            await pool.query(`
              INSERT INTO security_audit_logs (user_id, user_name, action, details, tenant_id)
              VALUES (?, ?, 'USER_UPDATED', ?, ?)
            `, [actorId || 'SYSTEM', req.auth?.name || 'Admin', `Usuario ${id} actualizado (role=${safeRole || 'sin_cambio'}, role_id=${role_id ?? 'sin_cambio'})`, tenantId]);
          } catch { }

          return { status: 200, body: { success: true } };
        } catch (innerErr) {
          if (txClient) {
            try { await txClient.query('ROLLBACK'); } catch { }
          }
          throw innerErr;
        } finally {
          if (txClient && typeof txClient.release === 'function') txClient.release();
        }
      });

      return res.status(result.status).json(result.body);
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message, code: err.code });
      }
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/users/:id', rejectControlPlaneOnTenantUsers, requireRole('propietario'), async (req, res) => {
    try {
      const { id } = req.params;
      const tenantId = req.tenantId;
      const result = await withTenantUserLock(tenantId, async () => {
        let txClient = null;
        const runner = pool.isPostgres && typeof pool.connect === 'function'
          ? (txClient = await pool.connect())
          : pool;
        try {
          if (txClient) await txClient.query('BEGIN');

          const [existing] = await runner.query(
            'SELECT id, tenant_id, role, is_active FROM users WHERE id::text = ? AND tenant_id = ? LIMIT 1',
            [String(id), tenantId]
          );
          if (!existing || existing.length === 0) {
            if (txClient) await txClient.query('ROLLBACK');
            return { status: 404, body: { error: 'Usuario no encontrado en esta empresa.' } };
          }

          const targetRole = normalizeRole(existing[0].role || '');
          if (targetRole === 'propietario') {
            await ensureRemainingActiveOwner(runner, tenantId, existing[0].id, {
              newRole: 'empleado',
              newIsActive: false,
            });
          }

          await runner.query('DELETE FROM users WHERE id::text = ? AND tenant_id = ?', [String(id), tenantId]);
          try {
            await runner.query('UPDATE user_sessions SET is_active = 0 WHERE user_id = ? AND tenant_id = ?', [String(id), tenantId]);
          } catch { }

          if (txClient) await txClient.query('COMMIT');

          try {
            await pool.query(`
              INSERT INTO security_audit_logs (user_id, user_name, action, details, tenant_id)
              VALUES (?, ?, 'USER_DELETED', ?, ?)
            `, [String(req.auth?.id || 'SYSTEM'), req.auth?.name || 'Admin', `Usuario eliminado con ID ${id}`, tenantId]);
          } catch { }

          return { status: 200, body: { success: true } };
        } catch (innerErr) {
          if (txClient) {
            try { await txClient.query('ROLLBACK'); } catch { }
          }
          throw innerErr;
        } finally {
          if (txClient && typeof txClient.release === 'function') txClient.release();
        }
      });

      return res.status(result.status).json(result.body);
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message, code: err.code });
      }
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

  router.get('/roles/catalog', rejectControlPlaneOnTenantUsers, requirePermission('security.view'), async (req, res) => {
    try {
      const allowAdminDelegation = await getAllowAdminRoleDelegation(req.tenantId);
      const canManageRoles = await canManageRolesPolicy(req);
      res.json({
        modules: PERMISSION_MODULES,
        allowAdminDelegation,
        canManageRoles,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/roles', rejectControlPlaneOnTenantUsers, requirePermission('security.view'), async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const [rows] = await pool.query(
        'SELECT * FROM roles WHERE tenant_id = ? ORDER BY id ASC',
        [tenantId]
      );
      const [userCounts] = await pool.query(
        'SELECT role_id, COUNT(*) as total FROM users WHERE tenant_id = ? AND role_id IS NOT NULL GROUP BY role_id',
        [tenantId]
      ).catch(() => [[]]);
      const countMap = new Map((userCounts || []).map((uc) => [String(uc.role_id), Number(uc.total || 0)]));

      res.json(rows.map(r => {
        const sanitizedPerms = sanitizePermissionsPayload(r.permisos);
        return {
          ...r,
          descripcion: r.description ?? r.descripcion ?? '',
          permisos: sanitizedPerms,
          assigned_users_count: countMap.get(String(r.id)) || 0,
        };
      }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/roles', rejectControlPlaneOnTenantUsers, async (req, res) => {
    try {
      const allowed = await canManageRolesPolicy(req);
      if (!allowed) {
        return res.status(403).json({
          error: 'Solo el Propietario de la empresa puede crear o administrar roles personalizados.',
          code: 'OWNER_ONLY_ROLE_MANAGEMENT'
        });
      }

      const { nombre, descripcion, description, permisos } = req.body;
      const cleanName = String(nombre || '').trim();
      if (!cleanName) {
        return res.status(400).json({ error: 'El nombre del rol es requerido.' });
      }
      if (isReservedRoleName(cleanName)) {
        return res.status(400).json({
          error: `El nombre '${cleanName}' está reservado para roles del sistema y no puede usarse como rol personalizado.`,
          code: 'RESERVED_ROLE_NAME'
        });
      }

      const sanitizedPerms = sanitizePermissionsPayload(permisos);
      const delegCheck = validateRoleDelegation(req, sanitizedPerms);
      if (!delegCheck.allowed) {
        return res.status(403).json({
          error: `No puedes conceder permisos que no posees: ${delegCheck.forbidden.join(', ')}`,
          code: 'DELEGATION_EXCEEDS_ACTOR_PRIVILEGES'
        });
      }

      const tenantId = req.tenantId;
      const roleDesc = String(description ?? descripcion ?? '').trim();
      const [result] = await pool.query(
        'INSERT INTO roles (nombre, description, permisos, tenant_id) VALUES (?, ?, ?, ?) RETURNING id',
        [cleanName, roleDesc, JSON.stringify(sanitizedPerms), tenantId]
      );
      const newRoleId = result.insertId || result[0]?.id;

      try {
        await pool.query(`
          INSERT INTO security_audit_logs (user_id, user_name, action, details, tenant_id)
          VALUES (?, ?, 'ROLE_CREATED', ?, ?)
        `, [String(req.auth?.id || 'SYSTEM'), req.auth?.name || 'Owner', `Rol creado: ${cleanName} (id=${newRoleId})`, tenantId]);
      } catch { }

      res.json({ id: newRoleId, success: true });
    } catch (err) {
      if (err?.code === '23505') {
        return res.status(409).json({ error: 'Ya existe un rol con este nombre en tu empresa.' });
      }
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/roles/:id', rejectControlPlaneOnTenantUsers, async (req, res) => {
    try {
      const allowed = await canManageRolesPolicy(req);
      if (!allowed) {
        return res.status(403).json({
          error: 'Solo el Propietario de la empresa puede modificar roles personalizados.',
          code: 'OWNER_ONLY_ROLE_MANAGEMENT'
        });
      }

      const { id } = req.params;
      const tenantId = req.tenantId;
      const [existingRoles] = await pool.query(
        'SELECT id, nombre FROM roles WHERE id = ? AND tenant_id = ? LIMIT 1',
        [id, tenantId]
      );
      if (!existingRoles || existingRoles.length === 0) {
        return res.status(404).json({ error: 'Rol no encontrado en esta empresa.' });
      }
      if (isReservedRoleName(existingRoles[0].nombre)) {
        return res.status(403).json({ error: 'Los roles reservados del sistema no pueden ser modificados.', code: 'RESERVED_ROLE_PROTECTED' });
      }

      const { nombre, descripcion, description, permisos } = req.body;
      const cleanName = String(nombre || '').trim();
      if (!cleanName) {
        return res.status(400).json({ error: 'El nombre del rol es requerido.' });
      }
      if (isReservedRoleName(cleanName)) {
        return res.status(400).json({
          error: `El nombre '${cleanName}' está reservado para roles del sistema.`,
          code: 'RESERVED_ROLE_NAME'
        });
      }

      const sanitizedPerms = sanitizePermissionsPayload(permisos);
      const delegCheck = validateRoleDelegation(req, sanitizedPerms);
      if (!delegCheck.allowed) {
        return res.status(403).json({
          error: `No puedes conceder permisos que no posees: ${delegCheck.forbidden.join(', ')}`,
          code: 'DELEGATION_EXCEEDS_ACTOR_PRIVILEGES'
        });
      }

      const roleDesc = String(description ?? descripcion ?? '').trim();
      await pool.query(
        'UPDATE roles SET nombre = ?, description = ?, permisos = ? WHERE id = ? AND tenant_id = ?',
        [cleanName, roleDesc, JSON.stringify(sanitizedPerms), id, tenantId]
      );

      // Invalidar tokens/sesiones de usuarios con este rol para aplicar revocación inmediata
      try {
        await pool.query(
          'UPDATE users SET token_version = COALESCE(token_version, 1) + 1 WHERE role_id = ? AND tenant_id = ?',
          [id, tenantId]
        );
      } catch { }

      try {
        await pool.query(`
          INSERT INTO security_audit_logs (user_id, user_name, action, details, tenant_id)
          VALUES (?, ?, 'ROLE_UPDATED', ?, ?)
        `, [String(req.auth?.id || 'SYSTEM'), req.auth?.name || 'Owner', `Rol actualizado: ${cleanName} (id=${id})`, tenantId]);
      } catch { }

      res.json({ success: true });
    } catch (err) {
      if (err?.code === '23505') {
        return res.status(409).json({ error: 'Ya existe un rol con este nombre en tu empresa.' });
      }
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/roles/:id', rejectControlPlaneOnTenantUsers, async (req, res) => {
    try {
      const allowed = await canManageRolesPolicy(req);
      if (!allowed) {
        return res.status(403).json({
          error: 'Solo el Propietario de la empresa puede eliminar roles personalizados.',
          code: 'OWNER_ONLY_ROLE_MANAGEMENT'
        });
      }

      const { id } = req.params;
      const tenantId = req.tenantId;
      const [existingRoles] = await pool.query(
        'SELECT id, nombre FROM roles WHERE id = ? AND tenant_id = ? LIMIT 1',
        [id, tenantId]
      );
      if (!existingRoles || existingRoles.length === 0) {
        return res.status(404).json({ error: 'Rol no encontrado en esta empresa.' });
      }
      if (isReservedRoleName(existingRoles[0].nombre)) {
        return res.status(403).json({ error: 'Los roles reservados del sistema no pueden ser eliminados.', code: 'RESERVED_ROLE_PROTECTED' });
      }

      const [assigned] = await pool.query(
        'SELECT COUNT(*) as total FROM users WHERE role_id = ? AND tenant_id = ?',
        [id, tenantId]
      );
      const assignedCount = Number(assigned?.[0]?.total || 0);
      if (assignedCount > 0) {
        return res.status(409).json({
          error: `No se puede eliminar el rol porque tiene ${assignedCount} usuario(s) asignado(s). Reasigna esos usuarios antes de eliminarlo.`,
          code: 'ROLE_IN_USE',
          assignedUsersCount: assignedCount,
        });
      }

      await pool.query('DELETE FROM roles WHERE id = ? AND tenant_id = ?', [id, tenantId]);

      try {
        await pool.query(`
          INSERT INTO security_audit_logs (user_id, user_name, action, details, tenant_id)
          VALUES (?, ?, 'ROLE_DELETED', ?, ?)
        `, [String(req.auth?.id || 'SYSTEM'), req.auth?.name || 'Owner', `Rol eliminado: ${existingRoles[0].nombre} (id=${id})`, tenantId]);
      } catch { }

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
          SELECT u.*, b.name as branch_name, u.tenant_id, r.nombre as role_name, r.permisos as role_permissions
          FROM users u
          LEFT JOIN branches b ON (u.branch_id::text = b.id::text AND b.tenant_id = u.tenant_id)
          LEFT JOIN roles r ON (u.role_id = r.id AND r.tenant_id = u.tenant_id)
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

          // Obtener configuración del Tenant si el usuario pertenece a una empresa
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
              return res.status(403).json({ error: 'La empresa asociado a este usuario no existe.' });
            }
            if (tenantInfo.status === 'terminated' || tenantInfo.status === 'inactive') {
              return res.status(403).json({ error: 'La cuenta de esta empresa se encuentra inactiva o finalizada. Contacte a soporte.' });
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

          let resolvedPermissions = {};
          const normalizedSysRole = normalizeRole(effectiveRole);
          const isKioskAccount = normalizedSysRole === 'kiosco_asistencia';
          const isAdminLike = !isKioskAccount && (isSuperAdmin || ['propietario', 'admin'].includes(normalizedSysRole));
          let kioskDeviceBind = null;

          if (isKioskAccount) {
            resolvedPermissions = {};
            const assignedBranchId = u.branch_id || u.salon_id || null;
            if (!assignedBranchId) {
              return res.status(403).json({
                error: 'Esta cuenta Kiosco de Asistencia no tiene una sucursal asignada.',
                code: 'KIOSK_BRANCH_REQUIRED'
              });
            }
            const {
              KIOSK_DEVICE_COOKIE,
              DEVICE_TTL_MS,
              buildCookieOptions,
              bindKioskDevice,
            } = require('../services/kiosk_device.service');
            try {
              const bound = await bindKioskDevice(pool, {
                tenantId: u.tenant_id,
                branchId: String(assignedBranchId),
                deviceName: `Kiosco · ${u.name || u.nombre || u.email}`,
                actorUserId: String(u.id),
                actorName: u.name || u.nombre || u.email,
              });
              kioskDeviceBind = {
                cookieName: KIOSK_DEVICE_COOKIE,
                rawToken: bound.rawToken,
                cookieOptions: buildCookieOptions(req, DEVICE_TTL_MS),
              };
            } catch (bindErr) {
              console.error('[KIOSK_BIND_ERROR]:', bindErr);
              return res.status(503).json({
                error: 'No se pudo vincular este dispositivo al Kiosco de Asistencia. Intenta nuevamente.',
                code: 'KIOSK_BIND_FAILED',
              });
            }
          } else if (u.role_permissions) {
            resolvedPermissions = expandEffectivePermissions(u.role_permissions);
          } else if (isAdminLike) {
            resolvedPermissions = ['all'];
          }

          res.cookie('auth_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging',
            sameSite: 'lax',
            path: '/',
            maxAge: 24 * 60 * 60 * 1000
          });
          if (kioskDeviceBind) {
            res.cookie(kioskDeviceBind.cookieName, kioskDeviceBind.rawToken, kioskDeviceBind.cookieOptions);
          }

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
            kioskOnly: isKioskAccount,
            role_id: isKioskAccount ? null : (u.role_id || null),
            role_name: isKioskAccount ? 'Kiosco de Asistencia' : (u.role_name || null),
            isSuperAdmin: Boolean(isSuperAdmin),
            is_superadmin: Boolean(isSuperAdmin),
            permissions: resolvedPermissions,
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
        if (String(req.auth?.role || '').toLowerCase() === 'kiosco_asistencia' && req.auth?.tenantId) {
          try {
            const { KIOSK_DEVICE_COOKIE, KIOSK_SELF_SERVICE_COOKIE, revokeDevicesByKioskUser } = require('../services/kiosk_device.service');
            await revokeDevicesByKioskUser(pool, {
              tenantId: req.auth.tenantId,
              userId: String(userId),
              reason: 'Cierre de sesión de cuenta kiosco'
            });
            res.clearCookie(KIOSK_DEVICE_COOKIE, { path: '/' });
            res.clearCookie(KIOSK_SELF_SERVICE_COOKIE, { path: '/' });
          } catch { }
        }
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
  const handleSessionCheck = async (req, res) => {
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
            return res.status(403).json({ valid: false, reason: 'tenant_suspended', error: 'Empresa suspendido.' });
          }
        }
        return res.json({ valid: true, sessionId, tenant: tenantInfo });
      }

      return res.json({ valid: true, sessionId });
    } catch (err) {
      console.error('[SESSION CHECK ERROR]:', err);
      // FAIL CLOSED: NUNCA responder valid: true ante error
      return res.status(500).json({ valid: false, error: 'Error verificando sesión en base de datos.' });
    }
  };

  router.post('/auth/session-check', handleSessionCheck);
  router.get('/auth/session-status', handleSessionCheck);
  router.get('/session-status', handleSessionCheck);

  router.router = router;
  return router;
}

module.exports = { createAuthRouter };
