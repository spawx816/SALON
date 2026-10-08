const express = require('express');
const nodemailer = require('nodemailer');

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
 * @param {import('mysql2/promise').Pool} pool
 */
function createSecurityRouter(pool) {
  const router = express.Router();

  const logSecurityAudit = async (userId, userName, action, details, req) => {
    try {
      const ip = getClientIp(req);
      const userAgent = req.headers['user-agent'] || 'Unknown';
      await pool.query(`
        INSERT INTO security_audit_logs (user_id, user_name, action, details, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [userId || 'SYSTEM', userName || 'Sistema', action, details || '', ip, userAgent]);
    } catch (e) {
      console.error('[SECURITY AUDIT LOG ERROR]:', e.message);
    }
  };

  // 1. Solicitar código de autorización dinámico para descuento / cambio de precio
  router.post('/request-auth', async (req, res) => {
    try {
      const { clientId, clientName, serviceName, staffName, type } = req.body;
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const sName = serviceName || 'Autorización de Descuento / Ajuste de Precio';
      const cName = clientName || 'Cliente General (Recepción POS)';
      const stName = staffName || 'Caja Recepción';

      // Invalidate previous pending requests of the same type/client if any
      try {
        await pool.query(
          "UPDATE security_requests SET status = 'cancelled' WHERE client_id = ? AND status = 'pending'",
          [clientId || 'POS']
        );
      } catch(e) {}

      const [result] = await pool.query(
        `INSERT INTO security_requests (client_id, client_name, service_name, staff_name, auth_code, type, status, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', DATE_ADD(NOW(), INTERVAL 15 MINUTE), NOW())`,
        [clientId || 'POS', cName, sName, stName, code, type || 'discount_price']
      );

      console.log(`[SECURITY AUTH] Generated code ${code} for "${sName}" (Staff: ${stName})`);

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

  // 2. Verificar código o PIN de autorización
  router.post('/verify-auth', async (req, res) => {
    try {
      const { pin, code, requestId } = req.body;
      const cleanPin = String(pin || code || '').trim();
      if (!cleanPin) {
        return res.status(400).json({ success: false, valid: false, error: 'Ingresa un PIN o código válido.' });
      }

      // 1. Check if it matches master admin PINs
      const masterPins = ['2026', '1234', '8888', '0000'];
      if (masterPins.includes(cleanPin)) {
        if (requestId) {
          try { await pool.query("UPDATE security_requests SET status = 'authorized' WHERE id = ?", [requestId]); } catch(e){}
        }
        return res.json({ success: true, valid: true, authorizedBy: 'Master PIN Administrador' });
      }

      // 2. Check dynamic authorization code in security_requests
      const [secRows] = await pool.query(
        `SELECT id, client_name, service_name FROM security_requests 
         WHERE auth_code = ? AND status = 'pending' AND (expires_at IS NULL OR expires_at >= NOW()) 
         ORDER BY created_at DESC LIMIT 1`,
        [cleanPin]
      );

      if (secRows.length > 0) {
        await pool.query("UPDATE security_requests SET status = 'authorized' WHERE id = ?", [secRows[0].id]);
        return res.json({ 
          success: true, 
          valid: true, 
          authorizedBy: `Monitor de Seguridad (${secRows[0].service_name})` 
        });
      }

      // 3. Check verification_codes table
      const [verRows] = await pool.query(
        `SELECT id FROM verification_codes 
         WHERE code = ? AND is_used = 0 AND (expires_at IS NULL OR expires_at >= NOW()) 
         ORDER BY created_at DESC LIMIT 1`,
        [cleanPin]
      );

      if (verRows.length > 0) {
        await pool.query("UPDATE verification_codes SET is_used = 1 WHERE id = ?", [verRows[0].id]);
        return res.json({ success: true, valid: true, authorizedBy: 'Código de Membresía' });
      }

      return res.status(401).json({ success: false, valid: false, error: 'Clave o código de autorización incorrecto o expirado.' });
    } catch (err) {
      console.error('[SECURITY VERIFY AUTH ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 3. Log de solicitud
  router.post('/log-request', async (req, res) => {
    const { clientId, clientName, serviceName, staffName } = req.body;
    try {
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      await pool.query(
        `INSERT INTO security_requests (client_id, client_name, service_name, staff_name, auth_code, status, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', DATE_ADD(NOW(), INTERVAL 15 MINUTE), NOW())`,
        [clientId || 'POS', clientName || 'Cliente General', serviceName, staffName, code]
      );
      res.json({ success: true, code });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 4. Lista de solicitudes activas para el Monitor de Seguridad
  router.get('/requests', async (req, res) => {
    try {
      // 1. Active pending requests from security_requests
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
        WHERE status = 'pending' 
          AND (expires_at IS NULL OR expires_at >= NOW())
          AND created_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
        ORDER BY created_at DESC
      `);

      // 2. Active unused codes from verification_codes (Membership / Plan Beauty redemptions)
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
        LEFT JOIN clients c ON vc.client_id = c.id
        WHERE vc.is_used = 0 
          AND (vc.expires_at IS NULL OR vc.expires_at >= NOW())
          AND vc.created_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
        ORDER BY vc.created_at DESC
      `);

      // Merge avoiding duplicates
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

  // 5. Monitoreo de Sesiones Activas en Tiempo Real (Solo usuarios genuinamente conectados)
  router.get('/sessions', async (req, res) => {
    try {
      // Desactivar automáticamente sesiones inactivas por más de 45 minutos
      await pool.query(`
        UPDATE user_sessions 
        SET is_active = 0 
        WHERE is_active = 1 AND (last_activity < DATE_SUB(NOW(), INTERVAL 45 MINUTE) OR last_activity IS NULL)
      `);

      // Consultar únicamente sesiones reales activas con latido reciente
      const [activeRows] = await pool.query(`
        SELECT s.*, 
               COALESCE(u.nombre, s.user_name) as user_name,
               u.email as user_email,
               COALESCE(r.nombre, s.role, 'Usuario') as role,
               COALESCE(sal.name, 'Global') as salon_name
        FROM user_sessions s
        LEFT JOIN users u ON s.user_id = u.id
        LEFT JOIN roles r ON u.role_id = r.id
        LEFT JOIN salons sal ON COALESCE(s.salon_id, u.salon_id) = sal.id
        WHERE s.is_active = 1 AND s.last_activity >= DATE_SUB(NOW(), INTERVAL 45 MINUTE)
        ORDER BY s.last_activity DESC
      `);

      res.json(activeRows);
    } catch (err) {
      console.error('[SECURITY SESSIONS ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 6. Cierre Forzado Remoto de Sesión
  router.post('/sessions/terminate', async (req, res) => {
    try {
      const { sessionId, userId } = req.body;
      if (sessionId) {
        await pool.query('UPDATE user_sessions SET is_active = 0 WHERE id = ?', [sessionId]);
      } else if (userId) {
        await pool.query('UPDATE user_sessions SET is_active = 0 WHERE user_id = ?', [userId]);
      }
      await logSecurityAudit(
        req.headers['x-user-id'] || 'admin', 
        req.headers['x-user-name'] || 'Administrador', 
        'REMOTE_SESSION_TERMINATE', 
        `Sesión finalizada forzosamente: ${sessionId ? `Sesión ID ${sessionId}` : `Usuario ID ${userId}`}`, 
        req
      );
      res.json({ success: true, message: 'Sesión terminada exitosamente' });
    } catch (err) {
      console.error('[SECURITY TERMINATE SESSION ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 7. Auditoría de Actividad y Trazabilidad (Audit Logs)
  router.get('/audit-logs', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 150;
      const [rows] = await pool.query(`
        SELECT * FROM security_audit_logs 
        ORDER BY id DESC 
        LIMIT ?
      `, [limit]);
      res.json(rows);
    } catch (err) {
      console.error('[SECURITY AUDIT LOGS ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 8. Intentos de Entrada y Bloqueos por Fuerza Bruta (Por Cuenta y por IP)
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

  // 9. Desbloqueo Manual de IP o Cuenta de Usuario
  router.post('/unblock-ip', async (req, res) => {
    try {
      const { ip_address, account_identifier } = req.body;
      if (!ip_address && !account_identifier) return res.status(400).json({ error: 'IP o Cuenta requerida' });

      if (ip_address) {
        await pool.query('DELETE FROM blocked_ips WHERE ip_address = ?', [ip_address]);
        await pool.query('DELETE FROM login_attempts WHERE ip_address = ? AND status = "failed"', [ip_address]);
      }
      if (account_identifier) {
        await pool.query('DELETE FROM account_lockouts WHERE account_identifier = ?', [account_identifier]);
        await pool.query('DELETE FROM login_attempts WHERE email_or_cedula = ? AND status = "failed"', [account_identifier]);
      }

      const target = account_identifier || ip_address;
      await logSecurityAudit(
        req.headers['x-user-id'] || 'admin', 
        req.headers['x-user-name'] || 'Administrador', 
        'SECURITY_UNBLOCKED_MANUALLY', 
        `Desbloqueo manual aplicado para: ${target}`, 
        req
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
      await pool.query('DELETE FROM login_attempts WHERE email_or_cedula = ? AND status = "failed"', [account_identifier]);

      await logSecurityAudit(
        req.headers['x-user-id'] || 'admin', 
        req.headers['x-user-name'] || 'Administrador', 
        'ACCOUNT_UNBLOCKED_MANUALLY', 
        `Cuenta desbloqueada manualmente: ${account_identifier}`, 
        req
      );

      res.json({ success: true, message: `Cuenta ${account_identifier} desbloqueada correctamente.` });
    } catch (err) {
      console.error('[SECURITY UNBLOCK ACCOUNT ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 10. Obtener Configuración de Seguridad & PIN
  router.get('/settings', async (req, res) => {
    try {
      const [rows] = await pool.query('SELECT require_pin_for_settings, pin_notification_emails, max_failed_attempts, lockout_minutes FROM security_settings WHERE id = 1');
      if (rows.length === 0) {
        return res.json({
          require_pin_for_settings: 1,
          pin_notification_emails: 'admin@planbeautyrd.com',
          max_failed_attempts: 5,
          lockout_minutes: 30
        });
      }
      res.json(rows[0]);
    } catch (err) {
      console.error('[SECURITY GET SETTINGS ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 11. Guardar Configuración de Seguridad & PIN
  router.post('/settings', async (req, res) => {
    try {
      const { require_pin_for_settings, pin_notification_emails, max_failed_attempts, lockout_minutes, admin_pin } = req.body;

      let query = 'UPDATE security_settings SET require_pin_for_settings = ?, pin_notification_emails = ?, max_failed_attempts = ?, lockout_minutes = ?';
      let params = [
        require_pin_for_settings !== undefined ? (require_pin_for_settings ? 1 : 0) : 1,
        pin_notification_emails || '',
        parseInt(max_failed_attempts) || 5,
        parseInt(lockout_minutes) || 30
      ];

      if (admin_pin && String(admin_pin).trim().length >= 4) {
        query += ', admin_pin = ?';
        params.push(String(admin_pin).trim());
      }

      query += ' WHERE id = 1';
      await pool.query(query, params);

      await logSecurityAudit(
        req.headers['x-user-id'] || 'admin', 
        req.headers['x-user-name'] || 'Administrador', 
        'SECURITY_SETTINGS_UPDATED', 
        `Parámetros de seguridad actualizados. Correos: ${pin_notification_emails}. Max intentos: ${max_failed_attempts}. Bloqueo: ${lockout_minutes}m.`, 
        req
      );

      res.json({ success: true, message: 'Configuración de seguridad actualizada correctamente' });
    } catch (err) {
      console.error('[SECURITY SAVE SETTINGS ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 12. Solicitar PIN de Acceso por Correo Multi-Destinatario (OTP Dinámico)
  router.post('/request-pin', async (req, res) => {
    try {
      const otpPin = Math.floor(100000 + Math.random() * 900000).toString();

      await pool.query(`
        UPDATE security_settings 
        SET active_otp_pin = ?, otp_expires_at = DATE_ADD(NOW(), INTERVAL 10 MINUTE)
        WHERE id = 1
      `, [otpPin]);

      const [secRows] = await pool.query('SELECT pin_notification_emails FROM security_settings WHERE id = 1');
      const emailListRaw = secRows[0]?.pin_notification_emails || 'admin@planbeautyrd.com,spawx816@gmail.com';
      const emailRecipients = emailListRaw
        .split(/[,;\n]+/)
        .map(e => e.trim())
        .filter(e => e.length > 3 && e.includes('@'));

      if (emailRecipients.length === 0) {
        return res.status(400).json({ error: 'No hay correos válidos configurados en el módulo de seguridad para recibir el PIN.' });
      }

      const [smtpRows] = await pool.query('SELECT * FROM email_settings WHERE id = 1');
      const smtp = smtpRows[0] || {};
      const transporter = nodemailer.createTransport({
        host: smtp.smtp_host || process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(smtp.smtp_port || process.env.SMTP_PORT || '587'),
        secure: smtp.smtp_secure === 1 || parseInt(smtp.smtp_port) === 465,
        auth: {
          user: smtp.smtp_user || process.env.SMTP_USER,
          pass: smtp.smtp_pass || process.env.SMTP_PASS
        },
        tls: { rejectUnauthorized: false }
      });

      const senderName = (smtp.smtp_from || 'Seguridad Plan Beauty').replace(/<.*>/, '').trim();
      const senderEmail = smtp.smtp_user || process.env.SMTP_USER || 'hola@planbeautyrd.com';
      const smtpFrom = `"${senderName}" <${senderEmail}>`;
      const clientIp = getClientIp(req);
      const nowStr = new Date().toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo' });

      const htmlContent = `
        <div style="font-family: Arial, sans-serif; background-color: #0f172a; color: #f8fafc; padding: 30px; border-radius: 12px; max-width: 540px; margin: 0 auto; border: 1px solid #334155;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h2 style="color: #d4af37; margin: 0; font-size: 24px; letter-spacing: 1px;">🔐 PIN DE SEGURIDAD REQUERIDO</h2>
            <p style="color: #94a3b8; font-size: 13px; margin-top: 6px;">Sistema de Gestión Salon Pro & Plan Beauty RD</p>
          </div>
          
          <div style="background: rgba(30, 41, 59, 0.8); padding: 20px; border-radius: 10px; border: 1px solid #475569; text-align: center; margin-bottom: 20px;">
            <p style="margin: 0 0 10px 0; color: #cbd5e1; font-size: 14px;">Se ha solicitado acceso a las <b>Configuraciones Críticas / Módulo de Seguridad</b>.</p>
            <div style="display: inline-block; background: #000000; border: 2px dashed #d4af37; padding: 14px 28px; border-radius: 8px; margin: 10px 0;">
              <span style="font-size: 32px; font-weight: 900; letter-spacing: 8px; color: #fbbf24; font-family: monospace;">${otpPin}</span>
            </div>
            <p style="margin: 10px 0 0 0; color: #ef4444; font-size: 12px; font-weight: bold;">⏱️ Este código expirará en 10 minutos.</p>
          </div>

          <div style="font-size: 12px; color: #64748b; line-height: 1.5; background: #0b1120; padding: 12px; border-radius: 6px;">
            <p style="margin: 0;"><b>Detalles de la solicitud:</b></p>
            <p style="margin: 2px 0;">• Dirección IP: <code style="color: #38bdf8;">${clientIp}</code></p>
            <p style="margin: 2px 0;">• Fecha y Hora: ${nowStr}</p>
            <p style="margin: 6px 0 0 0; color: #f59e0b;">Si tú no solicitaste este código, te recomendamos revisar el registro de auditoría del sistema de inmediato.</p>
          </div>
        </div>
      `;

      const mailResult = await transporter.sendMail({
        from: smtpFrom,
        to: emailRecipients.join(', '),
        subject: `🔐 PIN de Seguridad Salon Pro: ${otpPin} (Válido por 10 min)`,
        text: `Tu PIN de seguridad es: ${otpPin}. Válido por 10 minutos. Solicitado desde IP: ${clientIp}`,
        html: htmlContent
      });

      console.log(`[SECURITY REQUEST PIN SUCCESS] MessageId: ${mailResult.messageId} sent to ${emailRecipients.join(', ')}`);

      await logSecurityAudit(
        req.headers['x-user-id'] || 'admin', 
        req.headers['x-user-name'] || 'Administrador', 
        'SECURITY_PIN_REQUESTED', 
        `PIN de seguridad dinámico generado y enviado a: ${emailRecipients.join(', ')} (MessageId: ${mailResult.messageId})`, 
        req
      );

      res.json({
        success: true,
        message: `El PIN de seguridad fue enviado exitosamente a ${emailRecipients.length} ${emailRecipients.length === 1 ? 'correo' : 'correos'}: ${emailRecipients.join(', ')}`,
        recipientsCount: emailRecipients.length
      });
    } catch (err) {
      console.error('[SECURITY REQUEST PIN ERROR]:', err);
      res.status(500).json({ error: 'Error al enviar el PIN por correo. Verifica la configuración SMTP en el sistema.' });
    }
  });

  // 13. Verificar PIN de Seguridad (PIN Maestro y PIN OTP)
  router.post('/verify-pin', async (req, res) => {
    try {
      const { pin } = req.body;
      if (!pin) return res.status(400).json({ error: 'Debes ingresar el PIN de seguridad' });

      const [rows] = await pool.query('SELECT admin_pin, active_otp_pin, otp_expires_at FROM security_settings WHERE id = 1');
      if (rows.length === 0) return res.json({ success: true });

      const { admin_pin, active_otp_pin, otp_expires_at } = rows[0];
      const isOtpValid = active_otp_pin && (pin === active_otp_pin) && otp_expires_at && (new Date(otp_expires_at) > new Date());
      const isMasterValid = admin_pin && (pin === admin_pin);

      if (isMasterValid || isOtpValid) {
        await logSecurityAudit(
          req.headers['x-user-id'] || 'admin', 
          req.headers['x-user-name'] || 'Administrador', 
          'SECURITY_PIN_VERIFIED', 
          `Acceso a área protegida autorizado mediante ${isOtpValid ? 'PIN OTP dinámico' : 'PIN Maestro'}`, 
          req
        );
        return res.json({ success: true, authorized: true });
      }

      res.status(401).json({ error: 'PIN de seguridad inválido o expirado' });
    } catch (err) {
      console.error('[SECURITY VERIFY PIN ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createSecurityRouter };
