const express = require('express');
const nodemailer = require('nodemailer');

// HTML Escaping helper function to prevent HTML/XSS injection in email templates
const escapeHtml = (str) => {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

/**
 * Creates and configures the Express Router for Contact Form & Messages.
 * @param {import('mysql2/promise').Pool} pool - Database connection pool
 * @returns {express.Router}
 */
function createContactRouter(pool) {
  const router = express.Router();

  // 1. Enviar mensaje de contacto público
  router.post('/', async (req, res) => {
    const { nombre, email, mensaje, telefono } = req.body || {};
    
    const cleanNombre = String(nombre || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanMensaje = String(mensaje || '').trim();
    const cleanTelefono = String(telefono || '').trim();

    if (!cleanNombre || !cleanEmail || !cleanMensaje) {
      return res.status(400).json({ error: 'Todos los campos requeridos (nombre, correo y mensaje) deben estar completos.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({ error: 'Por favor ingresa un correo electrónico válido.' });
    }

    try {
      const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
      
      // Guardar mensaje en base de datos
      const [result] = await pool.query(
        'INSERT INTO contact_messages (nombre, email, telefono, mensaje, ip_address) VALUES (?, ?, ?, ?, ?)',
        [cleanNombre, cleanEmail, cleanTelefono || null, cleanMensaje, ip]
      );

      // Enviar notificación por correo al equipo de soporte / administración
      try {
        const [settingsRows] = await pool.query('SELECT * FROM email_settings LIMIT 1');
        let transporter;
        let fromAddress = '"Plan Beauty RD Soporte" <hola@planbeautyrd.com>';
        let adminRecipient = 'hola@planbeautyrd.com';

        if (settingsRows && settingsRows.length > 0) {
          const s = settingsRows[0];
          transporter = nodemailer.createTransport({
            host: s.smtp_host || 'smtp.hostinger.com',
            port: s.smtp_port || 465,
            secure: s.smtp_secure === 1,
            auth: {
              user: s.smtp_user || 'hola@planbeautyrd.com',
              pass: s.smtp_pass || 'z5!CIiplZ'
            }
          });
          fromAddress = `"${s.smtp_from || 'Plan Beauty'}" <${s.smtp_user || 'hola@planbeautyrd.com'}>`;
          if (s.smtp_user) adminRecipient = s.smtp_user;
        } else {
          transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.hostinger.com',
            port: parseInt(process.env.SMTP_PORT) || 465,
            secure: true,
            auth: {
              user: process.env.SMTP_USER || 'hola@planbeautyrd.com',
              pass: process.env.SMTP_PASS || 'z5!CIiplZ'
            }
          });
        }

        // Notificación al equipo
        await transporter.sendMail({
          from: fromAddress,
          to: adminRecipient,
          replyTo: cleanEmail,
          subject: `📩 Nuevo Mensaje de Contacto: ${escapeHtml(cleanNombre)}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 25px; border-radius: 16px; background: #ffffff; border: 1px solid #e2e8f0;">
              <div style="background: #d4af37; padding: 14px 20px; border-radius: 10px; color: #ffffff; font-weight: 800; font-size: 18px; margin-bottom: 20px;">
                Plan Beauty RD • Nuevo Mensaje Web
              </div>
              <p style="color: #334155; font-size: 15px; margin-bottom: 15px;">Has recibido una nueva consulta a través del formulario de contacto web:</p>
              <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                <tr>
                  <td style="padding: 10px 12px; background: #f8fafc; font-weight: bold; width: 140px; border: 1px solid #e2e8f0; color: #475569;">Nombre:</td>
                  <td style="padding: 10px 12px; border: 1px solid #e2e8f0; color: #0f172a; font-weight: 600;">${escapeHtml(cleanNombre)}</td>
                </tr>
                <tr>
                  <td style="padding: 10px 12px; background: #f8fafc; font-weight: bold; border: 1px solid #e2e8f0; color: #475569;">Correo:</td>
                  <td style="padding: 10px 12px; border: 1px solid #e2e8f0;"><a href="mailto:${escapeHtml(cleanEmail)}" style="color: #d4af37; font-weight: 600;">${escapeHtml(cleanEmail)}</a></td>
                </tr>
                ${cleanTelefono ? `<tr><td style="padding: 10px 12px; background: #f8fafc; font-weight: bold; border: 1px solid #e2e8f0; color: #475569;">Teléfono:</td><td style="padding: 10px 12px; border: 1px solid #e2e8f0; color: #0f172a;">${escapeHtml(cleanTelefono)}</td></tr>` : ''}
                <tr>
                  <td style="padding: 10px 12px; background: #f8fafc; font-weight: bold; border: 1px solid #e2e8f0; color: #475569;">Fecha:</td>
                  <td style="padding: 10px 12px; border: 1px solid #e2e8f0; color: #64748b;">${new Date().toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo' })}</td>
                </tr>
              </table>
              <div style="background: #fdfaf0; border-left: 4px solid #d4af37; padding: 16px; border-radius: 8px; margin-bottom: 20px;">
                <strong style="color: #78350f; display: block; margin-bottom: 8px; font-size: 14px;">Mensaje o Consulta:</strong>
                <p style="margin: 0; color: #1e293b; white-space: pre-wrap; line-height: 1.6; font-size: 15px;">${escapeHtml(cleanMensaje)}</p>
              </div>
              <p style="font-size: 12px; color: #94a3b8; text-align: center; margin-top: 25px;">
                Sistema Automatizado Plan Beauty RD
              </p>
            </div>
          `
        });

        // Confirmación al cliente
        transporter.sendMail({
          from: fromAddress,
          to: cleanEmail,
          subject: `✨ Hemos recibido tu mensaje | Plan Beauty RD`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 550px; margin: 0 auto; padding: 25px; border-radius: 16px; background: #ffffff; border: 1px solid #e2e8f0; text-align: center;">
              <div style="font-size: 38px; margin-bottom: 12px;">💌</div>
              <h2 style="color: #0f172a; margin: 0 0 10px 0; font-weight: 800;">¡Hola ${escapeHtml(cleanNombre)}!</h2>
              <p style="color: #475569; font-size: 15px; line-height: 1.6; margin-bottom: 20px;">
                Gracias por ponerte en contacto con nosotros. Hemos recibido tu mensaje satisfactoriamente y un representante de nuestro equipo te responderá en la mayor brevedad posible.
              </p>
              <div style="background: #f8fafc; border-radius: 12px; padding: 16px; text-align: left; margin-bottom: 25px; border: 1px solid #e2e8f0;">
                <strong style="font-size: 12px; color: #64748b; text-transform: uppercase; display: block; margin-bottom: 6px; letter-spacing: 0.5px;">Tu mensaje:</strong>
                <p style="margin: 0; color: #334155; font-size: 14px; white-space: pre-wrap; font-style: italic;">"${escapeHtml(cleanMensaje)}"</p>
              </div>
              <p style="color: #64748b; font-size: 13px; margin-bottom: 0;">
                Para soporte directo o citas también puedes contactarnos al <strong>(809) 561-5000</strong>.
              </p>
            </div>
          `
        }).catch(clientErr => console.warn('[CONTACT EMAIL CLIENT RECEIPT]:', clientErr.message));

      } catch (mailErr) {
        console.error('[CONTACT EMAIL ERROR]:', mailErr.message);
      }

      res.json({ success: true, message: '¡Mensaje enviado con éxito! Nos comunicaremos contigo a la mayor brevedad.', id: result.insertId });
    } catch (err) {
      console.error('[CONTACT POST ERROR]:', err);
      res.status(500).json({ error: 'Hubo un inconveniente al enviar tu mensaje. Por favor intenta de nuevo.' });
    }
  });

  // 2. Obtener lista de mensajes recibidos (para panel administrativo)
  router.get('/messages', async (req, res) => {
    try {
      const [rows] = await pool.query('SELECT * FROM contact_messages ORDER BY id DESC LIMIT 100');
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createContactRouter };
