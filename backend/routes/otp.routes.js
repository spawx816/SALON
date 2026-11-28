const express = require('express');
const crypto = require('crypto');
const { resolveTransporterForTenant } = require('../services/platform_email.service');
const { verifyPin } = require('../services/pin_security.service');

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function maskEmail(email) {
  const raw = String(email || '').trim();
  const atIdx = raw.indexOf('@');
  if (atIdx <= 1) return raw;
  return `${raw.slice(0, 2)}***${raw.slice(atIdx)}`;
}

function createOtpRouter(pool) {
  const router = express.Router();

  router.use((req, res, next) => {
    const tenantId = req.tenantId || req.auth?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Contexto de empresa requerido para OTP.' });
    }
    req.verifiedTenantId = tenantId;
    next();
  });

  // POST /api/otp/generate - Generar y enviar código OTP de verificación al cliente (Membresías / Servicios)
  router.post('/generate', async (req, res) => {
    try {
      const tenantId = req.verifiedTenantId;
      const { clientId, clientEmail } = req.body || {};

      let targetEmail = String(clientEmail || '').trim();
      let clientName = 'Cliente';
      let resolvedClientId = String(clientId || '').trim();

      if (resolvedClientId && resolvedClientId !== 'undefined') {
        const [cRows] = await pool.query(
          'SELECT id, nombre, email FROM clients WHERE (id::text = ? OR cedula = ?) AND tenant_id = ? LIMIT 1',
          [resolvedClientId, resolvedClientId, tenantId]
        );
        if (cRows && cRows.length > 0) {
          resolvedClientId = String(cRows[0].id);
          clientName = cRows[0].nombre || clientName;
          if (!targetEmail) {
            targetEmail = String(cRows[0].email || '').trim();
          }
        }
      }

      const [tRows] = await pool.query(
        'SELECT business_name FROM tenants WHERE id = ? LIMIT 1',
        [tenantId]
      );
      const businessName = tRows?.[0]?.business_name || 'Etereas';

      const code = String(crypto.randomInt(100000, 1000000));
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      const codeHash = crypto.createHash('sha256').update(code).digest('hex');

      if (resolvedClientId) {
        await pool.query(
          "UPDATE verification_codes SET is_used = 1 WHERE tenant_id = ? AND client_id = ? AND purpose = 'membership_otp' AND is_used = 0",
          [tenantId, resolvedClientId]
        ).catch(() => {});
      }

      await pool.query(
        `INSERT INTO verification_codes
          (tenant_id, client_id, user_id, identity, purpose, channel, code, code_hash, attempts, max_attempts, expires_at, is_used)
         VALUES (?, ?, ?, ?, 'membership_otp', 'email', ?, ?, 0, 5, ?, 0)`,
        [tenantId, resolvedClientId || 'CLIENT', resolvedClientId || null, targetEmail || null, code, codeHash, expiresAt]
      );

      let emailSent = false;
      let emailError = null;
      if (targetEmail && targetEmail.includes('@')) {
        try {
          const { transporter, fromAddress } = await resolveTransporterForTenant(pool, tenantId, businessName);
          if (transporter && fromAddress) {
            await transporter.sendMail({
              from: fromAddress,
              to: targetEmail,
              subject: `🔐 Código de Verificación (${code}) — ${businessName}`,
              text: `Hola ${clientName}, tu código de verificación en ${businessName} es: ${code}. Válido por 15 minutos.`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border-radius: 16px; background: #ffffff; border: 1px solid #e2e8f0; text-align: center;">
                  <div style="font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: #2563eb; margin-bottom: 6px;">
                    ${escapeHtml(businessName)}
                  </div>
                  <h2 style="margin: 0 0 10px; color: #0f172a; font-size: 20px;">Código de Verificación</h2>
                  <p style="color: #475569; font-size: 14px; margin: 0 0 18px; line-height: 1.5;">
                    Hola <strong>${escapeHtml(clientName)}</strong>, utiliza este código para confirmar tu servicio en recepción:
                  </p>
                  <div style="font-size: 32px; font-weight: 900; letter-spacing: 8px; color: #0f172a; background: #f8fafc; padding: 14px 22px; border-radius: 12px; border: 2px solid #cbd5e1; display: inline-block; margin-bottom: 16px;">
                    ${code}
                  </div>
                  <p style="font-size: 12px; color: #64748b; margin: 0;">Este código expira en 15 minutos.</p>
                </div>
              `,
            });
            emailSent = true;
          } else {
            emailError = 'No hay servidor SMTP configurado.';
          }
        } catch (mailErr) {
          console.error('[OTP GENERATE EMAIL ERROR]:', mailErr.message);
          emailError = mailErr.message;
        }
      }

      const actorRole = String(req.auth?.role || req.user?.role || '').trim().toLowerCase();
      const isPrivileged = ['owner', 'propietario', 'admin', 'administrador'].includes(actorRole);

      return res.json({
        success: true,
        emailSent,
        email: targetEmail ? maskEmail(targetEmail) : null,
        ...(emailError ? { emailWarning: emailError } : {}),
        ...(isPrivileged ? { code } : {}),
      });
    } catch (err) {
      console.error('[OTP GENERATE ERROR]:', err);
      return res.status(500).json({ error: 'No se pudo generar el código de verificación.' });
    }
  });

  // GET /api/otp/active/:clientId - Consultar OTP activo (Solo Owner / Admin)
  router.get('/active/:clientId', async (req, res) => {
    try {
      const tenantId = req.verifiedTenantId;
      const actorRole = String(req.auth?.role || req.user?.role || '').trim().toLowerCase();
      const isPrivileged = ['owner', 'propietario', 'admin', 'administrador'].includes(actorRole);
      if (!isPrivileged) {
        return res.status(403).json({ error: 'Solo administradores pueden consultar el código activo en pantalla.' });
      }

      const clientId = String(req.params.clientId || '').trim();
      const [rows] = await pool.query(
        `SELECT code, identity AS email, expires_at
         FROM verification_codes
         WHERE tenant_id = ? AND client_id = ? AND is_used = 0 AND expires_at > NOW()
         ORDER BY id DESC LIMIT 1`,
        [tenantId, clientId]
      );
      if (!rows || rows.length === 0) {
        return res.json(null);
      }
      return res.json({
        code: rows[0].code,
        clientEmail: rows[0].email,
        expiresAt: rows[0].expires_at,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /api/otp/verify - Verificar y consumir código OTP de cliente (o PIN gerencial de la empresa)
  router.post('/verify', async (req, res) => {
    try {
      const tenantId = req.verifiedTenantId;
      const { clientId, code } = req.body || {};
      const cleanCode = String(code || '').trim();

      if (!cleanCode) {
        return res.status(400).json({ error: 'Ingresa el código de verificación.' });
      }

      const cleanClientId = String(clientId || '').trim();
      const [rows] = await pool.query(
        `SELECT id FROM verification_codes
         WHERE tenant_id = ?
           AND (? = '' OR client_id = ? OR client_id = 'CLIENT')
           AND code = ?
           AND is_used = 0
           AND expires_at > NOW()
         ORDER BY id DESC LIMIT 1`,
        [tenantId, cleanClientId, cleanClientId, cleanCode]
      );

      if (rows && rows.length > 0) {
        await pool.query(
          'UPDATE verification_codes SET is_used = 1, used_at = NOW() WHERE id = ? AND tenant_id = ?',
          [rows[0].id, tenantId]
        );
        return res.json({ success: true, verified: true });
      }

      // Respaldo gerencial: permitir PIN Maestro o PIN OTP dinámico de security_settings de la empresa
      const [secRows] = await pool.query(
        'SELECT admin_pin, admin_pin_hash, active_otp_pin, otp_expires_at FROM security_settings WHERE tenant_id = ? LIMIT 1',
        [tenantId]
      );
      const sec = secRows?.[0] || null;
      if (sec) {
        if (sec.active_otp_pin && cleanCode === String(sec.active_otp_pin).trim() && (!sec.otp_expires_at || new Date(sec.otp_expires_at) > new Date())) {
          return res.json({ success: true, verified: true, authorizedBy: 'PIN OTP Dinámico' });
        }
        const storedMaster = sec.admin_pin_hash || sec.admin_pin;
        if (storedMaster) {
          const vRes = await verifyPin(cleanCode, storedMaster);
          if (vRes.matched && !vRes.isLegacy) {
            return res.json({ success: true, verified: true, authorizedBy: 'PIN Maestro Administrador' });
          }
        }
      }

      return res.status(400).json({ error: 'Código de verificación incorrecto o expirado.' });
    } catch (err) {
      console.error('[OTP VERIFY ERROR]:', err);
      return res.status(500).json({ error: 'Error verificando código.' });
    }
  });

  return router;
}

module.exports = { createOtpRouter };
