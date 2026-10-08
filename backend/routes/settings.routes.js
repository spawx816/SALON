const express = require('express');
const nodemailer = require('nodemailer');

/**
 * System Settings Router
 * 
 * @param {import('mysql2/promise').Pool} pool 
 */
function createSettingsRouter(pool) {
  const router = express.Router();

  // GET /api/settings/email
  router.get('/email', async (req, res) => {
    try {
      const [rows] = await pool.query('SELECT * FROM email_settings WHERE id = 1');
      const settings = rows[0] || {};
      if (settings.smtp_pass) {
        settings.smtp_pass = '********';
      }
      res.json(settings);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/settings/email
  router.post('/email', async (req, res) => {
    let { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_secure } = req.body;
    try {
      if (smtp_pass === '********' || !smtp_pass) {
        const [existing] = await pool.query('SELECT smtp_pass FROM email_settings WHERE id = 1');
        if (existing[0]?.smtp_pass) {
          smtp_pass = existing[0].smtp_pass;
        }
      }

      await pool.query(`
        INSERT INTO email_settings (id, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_secure)
        VALUES (1, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
          smtp_host = VALUES(smtp_host),
          smtp_port = VALUES(smtp_port),
          smtp_user = VALUES(smtp_user),
          smtp_pass = VALUES(smtp_pass),
          smtp_from = VALUES(smtp_from),
          smtp_secure = VALUES(smtp_secure)
      `, [smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_secure ? 1 : 0]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/settings/email/test
  router.post('/email/test', async (req, res) => {
    const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_secure, test_email } = req.body;
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
