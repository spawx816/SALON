const express = require('express');
const nodemailer = require('nodemailer');

/**
 * System Settings Router (Scoped strictly by tenant_id)
 */
function createSettingsRouter(pool) {
  const router = express.Router();

  // GET /api/settings/email
  router.get('/email', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const [rows] = await pool.query('SELECT * FROM email_settings WHERE tenant_id = ? LIMIT 1', [tenantId]);
      const settings = (rows && rows[0]) ? rows[0] : {
        smtp_host: '',
        smtp_port: 587,
        smtp_user: '',
        smtp_pass: '',
        smtp_from: 'SALON PRO',
        smtp_secure: 1
      };
      if (settings.smtp_pass) {
        settings.smtp_pass = '********';
      }
      res.json(settings);
    } catch (err) {
      res.json({
        smtp_host: '',
        smtp_port: 587,
        smtp_user: '',
        smtp_pass: '',
        smtp_from: 'SALON PRO',
        smtp_secure: 1
      });
    }
  });

  // POST /api/settings/email
  router.post('/email', async (req, res) => {
    const tenantId = req.tenantId;
    let { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_secure } = req.body;
    try {
      if (smtp_pass === '********' || !smtp_pass) {
        try {
          const [existing] = await pool.query('SELECT smtp_pass FROM email_settings WHERE tenant_id = ? LIMIT 1', [tenantId]);
          if (existing[0]?.smtp_pass) {
            smtp_pass = existing[0].smtp_pass;
          }
        } catch {}
      }

      await pool.query(`
        INSERT INTO email_settings (tenant_id, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_secure)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (tenant_id) DO UPDATE SET
          smtp_host = EXCLUDED.smtp_host,
          smtp_port = EXCLUDED.smtp_port,
          smtp_user = EXCLUDED.smtp_user,
          smtp_pass = EXCLUDED.smtp_pass,
          smtp_from = EXCLUDED.smtp_from,
          smtp_secure = EXCLUDED.smtp_secure,
          updated_at = CURRENT_TIMESTAMP
      `, [tenantId, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_secure ? 1 : 0]);

      res.json({ success: true, message: 'Configuración SMTP guardada con éxito.' });
    } catch (err) {
      console.error('[EMAIL SETTINGS SAVE ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/settings/email/test
  router.post('/email/test', async (req, res) => {
    const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, test_email } = req.body;
    try {
      const isPort465 = parseInt(smtp_port) === 465;

      const transporter = nodemailer.createTransport({
        host: smtp_host,
        port: parseInt(smtp_port),
        secure: isPort465,
        auth: {
          user: smtp_user,
          pass: smtp_pass
        },
        tls: {
          rejectUnauthorized: false
        },
        family: 4,
        connectionTimeout: 10000,
        greetingTimeout: 10000
      });

      await transporter.verify();

      await transporter.sendMail({
        from: `"${smtp_from || 'SalonPro Test'}" <${smtp_user}>`,
        to: test_email,
        subject: 'Prueba de Conexión - SalonPro',
        text: 'Este es un correo de prueba para verificar tu configuración SMTP en SalonPro.',
        html: `
          <div style="font-family: sans-serif; padding: 20px; border: 1px solid #10b981; border-radius: 10px; background: #f0fdf4;">
            <h2 style="color: #059669; margin-top: 0;">¡Conexión Exitosa!</h2>
            <p>Este correo confirma que la configuración de tu servidor SMTP en <strong>SalonPro</strong> funciona correctamente.</p>
            <hr style="border: none; border-top: 1px solid #d1fae5; margin: 20px 0;" />
            <p style="font-size: 0.8rem; color: #666;">Enviado desde: ${smtp_host}:${smtp_port}</p>
          </div>
        `
      });

      res.json({ success: true, message: 'Correo de prueba enviado con éxito.' });
    } catch (err) {
      console.error('[EMAIL TEST] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = {
  createSettingsRouter
};
