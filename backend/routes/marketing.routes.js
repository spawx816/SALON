const express = require('express');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

/**
 * Marketing and Birthday Campaigns Router Module for Salon Pro & Plan Beauty RD (Strictly Scoped by tenant_id)
 * 
 * @param {import('mysql2/promise').Pool} pool
 */
function createMarketingRouter(pool) {
  const router = express.Router();

  // === MARKETING LOGGER & TRACKING ===
  const logSentEmailAndGetPixel = async (req, clientId, emailType, recipientEmail, subject, tenantId) => {
    try {
      const [res] = await pool.query(
        'INSERT INTO email_logs (tenant_id, client_id, email_type, recipient_email, subject) VALUES (?, ?, ?, ?, ?)',
        [tenantId || null, clientId || null, emailType, recipientEmail, subject]
      );
      const emailLogId = res.insertId || res[0]?.id;
      const host = req.get('host');
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const pixelUrl = `${protocol}://${host}/api/marketing/track-open/${emailLogId}`;
      return `<img src="${pixelUrl}" width="1" height="1" style="display:none;" />`;
    } catch (err) {
      console.error('[EMAIL LOG] Error logging sent email:', err);
      return '';
    }
  };

  const getMarketingAudienceWhereClause = (filter, tenantId) => {
    switch (filter) {
      case 'no_plan':
        return ` AND c.id NOT IN (SELECT DISTINCT client_id FROM contracts WHERE tenant_id = '${tenantId}' AND client_id IS NOT NULL AND status IN ('Active', 'Activo'))`;
      case 'active_plan':
        return ` AND c.id IN (SELECT DISTINCT client_id FROM contracts WHERE tenant_id = '${tenantId}' AND client_id IS NOT NULL AND status IN ('Active', 'Activo'))`;
      case 'pending_payment':
        return ` AND c.id IN (SELECT DISTINCT client_id FROM contracts WHERE tenant_id = '${tenantId}' AND client_id IS NOT NULL AND (status IN ('Past Due', 'Overdue', 'Pending_Retry') OR auto_billing_enabled = 0))`;
      case 'tenure_3m':
        return ` AND c.id IN (SELECT client_id FROM contracts WHERE tenant_id = '${tenantId}' AND client_id IS NOT NULL AND status IN ('Active', 'Activo') AND signed_at <= DATE_SUB(CURRENT_DATE(), INTERVAL 3 MONTH))`;
      case 'tenure_6m':
        return ` AND c.id IN (SELECT client_id FROM contracts WHERE tenant_id = '${tenantId}' AND client_id IS NOT NULL AND status IN ('Active', 'Activo') AND signed_at <= DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH))`;
      case 'tenure_9m':
        return ` AND c.id IN (SELECT client_id FROM contracts WHERE tenant_id = '${tenantId}' AND client_id IS NOT NULL AND status IN ('Active', 'Activo') AND signed_at <= DATE_SUB(CURRENT_DATE(), INTERVAL 9 MONTH))`;
      case 'tenure_12m':
        return ` AND c.id IN (SELECT client_id FROM contracts WHERE tenant_id = '${tenantId}' AND client_id IS NOT NULL AND status IN ('Active', 'Activo') AND signed_at <= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH))`;
      case 'tenure_18m':
        return ` AND c.id IN (SELECT client_id FROM contracts WHERE tenant_id = '${tenantId}' AND client_id IS NOT NULL AND status IN ('Active', 'Activo') AND signed_at <= DATE_SUB(CURRENT_DATE(), INTERVAL 18 MONTH))`;
      case 'all':
      default:
        return "";
    }
  };

  const getBirthdayFlyerUrl = (req) => {
    const publicDir = path.join(__dirname, '..', '..', 'public');
    const distDir = path.join(__dirname, '..', '..', 'dist');
    let flyerFile = null;
    if (fs.existsSync(publicDir)) {
      const files = fs.readdirSync(publicDir);
      flyerFile = files.find(f => f.startsWith('birthday_flyer.'));
    }
    if (!flyerFile && fs.existsSync(distDir)) {
      const files = fs.readdirSync(distDir);
      flyerFile = files.find(f => f.startsWith('birthday_flyer.'));
    }
    if (flyerFile) {
      return `/${flyerFile}?v=${Date.now()}`;
    }
    return null;
  };

  const getBirthdayFlyerPath = () => {
    const publicDir = path.join(__dirname, '..', '..', 'public');
    const distDir = path.join(__dirname, '..', '..', 'dist');
    let flyerFile = null;
    if (fs.existsSync(publicDir)) {
      const files = fs.readdirSync(publicDir);
      flyerFile = files.find(f => f.startsWith('birthday_flyer.'));
      if (flyerFile) return path.join(publicDir, flyerFile);
    }
    if (fs.existsSync(distDir)) {
      const files = fs.readdirSync(distDir);
      flyerFile = files.find(f => f.startsWith('birthday_flyer.'));
      if (flyerFile) return path.join(distDir, flyerFile);
    }
    return null;
  };

  const getCampaignFlyerPath = () => {
    const publicDir = path.join(__dirname, '..', '..', 'public');
    const distDir = path.join(__dirname, '..', '..', 'dist');
    let flyerFile = null;
    if (fs.existsSync(publicDir)) {
      const files = fs.readdirSync(publicDir);
      flyerFile = files.find(f => f.startsWith('campaign_flyer.'));
      if (flyerFile) return path.join(publicDir, flyerFile);
    }
    if (fs.existsSync(distDir)) {
      const files = fs.readdirSync(distDir);
      flyerFile = files.find(f => f.startsWith('campaign_flyer.'));
      if (flyerFile) return path.join(distDir, flyerFile);
    }
    return null;
  };

  const getCampaignFlyerUrl = (req) => {
    const flyerPath = getCampaignFlyerPath();
    if (flyerPath) {
      return `/${path.basename(flyerPath)}`;
    }
    return '';
  };

  const getMimeType = (filePath) => {
    if (!filePath) return 'image/jpeg';
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.webp') return 'image/webp';
    return 'image/jpeg';
  };

  const getAbsoluteFlyerUrl = (req, relativeUrl) => {
    if (!relativeUrl) return null;
    if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
      return relativeUrl;
    }
    let baseUrl = '';
    if (process.env.FRONTEND_URL && !process.env.FRONTEND_URL.includes('localhost')) {
      baseUrl = process.env.FRONTEND_URL.replace(/\/$/, '');
    } else {
      const host = req ? req.get('host') : process.env.BACKEND_HOST || 'planbeautyrd.com';
      const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
      const protocol = isLocal ? 'http' : 'https';
      if (isLocal) {
        baseUrl = 'https://planbeautyrd.com';
      } else {
        baseUrl = `${protocol}://${host}`;
      }
    }
    const cleanRelative = relativeUrl.startsWith('/') ? relativeUrl : `/${relativeUrl}`;
    return `${baseUrl}${cleanRelative}`;
  };

  // Track email open pixel
  router.get('/track-open/:id', async (req, res) => {
    const { id } = req.params;
    try {
      await pool.query(
        'UPDATE email_logs SET opened = 1, opened_at = CURRENT_TIMESTAMP WHERE id = ? AND opened = 0',
        [id]
      );
    } catch (err) {
      console.error('[EMAIL TRACK] Error updating tracking state:', err.message);
    }
    const buf = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    res.writeHead(200, {
      'Content-Type': 'image/gif',
      'Content-Length': buf.length,
      'Cache-Control': 'no-store, no-cache, must-revalidate, private'
    });
    res.end(buf);
  });

  // Marketing email stats (Scoped by tenant)
  router.get('/stats', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de salón requerido.' });
      }

      const [sentRows] = await pool.query(`
        SELECT COUNT(*) as total 
        FROM email_logs 
        WHERE tenant_id = ? AND MONTH(sent_at) = MONTH(NOW()) AND YEAR(sent_at) = YEAR(NOW())
      `, [tenantId]);
      const totalSent = sentRows[0]?.total || 0;

      const [openedRows] = await pool.query(`
        SELECT COUNT(*) as total 
        FROM email_logs 
        WHERE tenant_id = ? AND opened = 1 AND MONTH(sent_at) = MONTH(NOW()) AND YEAR(sent_at) = YEAR(NOW())
      `, [tenantId]);
      const totalOpened = openedRows[0]?.total || 0;

      const openRate = totalSent > 0 ? Math.round((totalOpened / totalSent) * 100) : 0;

      res.json({
        success: true,
        totalSent,
        openRate
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Recipient count for audience segment (Scoped by tenant)
  router.get('/recipient-count', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de salón requerido.' });
      }
      const filter = req.query.targetFilter || req.query.filter;
      const whereAudience = getMarketingAudienceWhereClause(filter, tenantId);
      const [rows] = await pool.query(`
        SELECT COUNT(*) as count 
        FROM clients c 
        WHERE c.tenant_id = ? AND c.email IS NOT NULL AND c.email != '' ${whereAudience}
      `, [tenantId]);
      res.json({ count: rows[0]?.count || 0 });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Mass email sending (Scoped by tenant)
  router.post('/send-mass', async (req, res) => {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(403).json({ error: 'Contexto de salón requerido.' });
    }

    const { subject, template, campaignType, flyerUrl, targetFilter, filter } = req.body;
    const audience = targetFilter || filter || 'all';
    try {
      const whereAudience = getMarketingAudienceWhereClause(audience, tenantId);
      const [clients] = await pool.query(`
        SELECT c.id, c.email, c.nombre, s.name as salon_name, s.address as salon_address 
        FROM clients c
        LEFT JOIN salons s ON c.salon_id::text = s.id::text AND s.tenant_id = c.tenant_id
        WHERE c.tenant_id = ? AND c.email IS NOT NULL AND c.email != '' ${whereAudience}
      `, [tenantId]);
      
      const [settings] = await pool.query('SELECT * FROM email_settings WHERE tenant_id = ? LIMIT 1', [tenantId]);
      if (settings.length === 0 || !settings[0].smtp_host) {
        throw new Error("No hay configuración de correo activa para este salón.");
      }
      const s = settings[0];

      const flyerPath = getCampaignFlyerPath();
      const attachments = [];
      let imageSrc = null;

      if (campaignType === 'image') {
        if (flyerPath) {
          attachments.push({
            filename: path.basename(flyerPath),
            path: flyerPath,
            cid: 'campaignflyer',
            contentType: getMimeType(flyerPath),
            disposition: 'inline'
          });
          imageSrc = 'cid:campaignflyer';
        } else if (flyerUrl) {
          imageSrc = getAbsoluteFlyerUrl(req, flyerUrl);
        }
      }

      const transporter = nodemailer.createTransport({
        host: s.smtp_host, port: s.smtp_port, secure: s.smtp_port == 465,
        auth: { user: s.smtp_user, pass: s.smtp_pass }
      });

      let sent = 0;
      for (const client of clients) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        const body = template ? template.replace(/\{\{nombre\}\}/g, client.nombre) : '';
        const trackingPixel = await logSentEmailAndGetPixel(req, client.id, 'massive', client.email, subject, tenantId);
        
        try {
          await transporter.sendMail({
            from: `"${s.smtp_from || 'PLAN BEAUTY'}" <${s.smtp_user}>`,
            to: client.email,
            subject: subject,
            text: campaignType === 'image' ? `Hola ${client.nombre}, te enviamos una nueva promoción. Abre el correo para ver los detalles.` : body,
            attachments: attachments,
            html: `
              <div style="font-family: sans-serif; padding: 20px;">
                <h2>Hola ${client.nombre}</h2>
                <p>${body.replace(/\n/g, '<br>')}</p>
              </div>
              ${trackingPixel}
            `
          });
          sent++;
        } catch (e) {
          console.error(`Error enviando a ${client.email}:`, e.message);
        }
      }

      res.json({ success: true, sent });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET Marketing Settings (Scoped by tenant)
  router.get('/settings', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de salón requerido.' });
      }

      const [rows] = await pool.query('SELECT * FROM marketing_settings WHERE tenant_id = ? LIMIT 1', [tenantId]);
      if (rows.length === 0) {
        return res.json({
          birthday_automation_enabled: 1,
          birthday_discount: 15,
          birthday_flyer_url: '',
          birthday_email_subject: '¡Feliz Cumpleaños! 🎉',
          birthday_email_template: '¡Hola {{nombre}}! Esperamos que tengas un día maravilloso. Como regalo de cumpleaños, disfruta de un {{descuento}}% de descuento en cualquiera de nuestros servicios durante esta semana. ¡Te esperamos!',
          mass_email_template: '¡Hola {{nombre}}! Tenemos una oferta para ti.'
        });
      }
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST Marketing Settings (Scoped by tenant)
  router.post('/settings', async (req, res) => {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(403).json({ error: 'Contexto de salón requerido.' });
    }

    const { 
      birthday_automation_enabled, 
      birthday_discount, 
      birthday_flyer_url, 
      birthday_email_subject, 
      birthday_email_template, 
      mass_email_template 
    } = req.body;
    try {
      await pool.query(`
        INSERT INTO marketing_settings (
          tenant_id, birthday_automation_enabled, birthday_discount, birthday_flyer_url, 
          birthday_email_subject, birthday_email_template, mass_email_template
        ) 
        VALUES (
          ?, ?, ?, ?, ?, ?, ?
        )
        ON CONFLICT (tenant_id) DO UPDATE SET 
          birthday_automation_enabled = EXCLUDED.birthday_automation_enabled,
          birthday_discount = EXCLUDED.birthday_discount,
          birthday_flyer_url = EXCLUDED.birthday_flyer_url,
          birthday_email_subject = EXCLUDED.birthday_email_subject,
          birthday_email_template = EXCLUDED.birthday_email_template,
          mass_email_template = EXCLUDED.mass_email_template
      `, [
        tenantId,
        birthday_automation_enabled === true || birthday_automation_enabled == 1,
        parseInt(birthday_discount) || 15,
        birthday_flyer_url || '',
        birthday_email_subject || '¡Feliz Cumpleaños! 🎉',
        birthday_email_template || '',
        mass_email_template || ''
      ]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Send manual birthday promotions (Scoped by tenant)
  router.post('/send-birthdays', async (req, res) => {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(403).json({ error: 'Contexto de salón requerido.' });
    }

    const role = (req.auth?.role || req.headers['x-user-role'] || '').toLowerCase();
    if (role !== 'propietario' && role !== 'admin' && !req.auth?.isSuperAdmin) {
      return res.status(403).json({ error: 'Acceso denegado: Se requieren permisos administrativos para disparar campañas de marketing.', code: 'ADMIN_ROLE_REQUIRED' });
    }

    const { discountPercent, flyerUrl } = req.body;
    try {
      const [mSettings] = await pool.query('SELECT * FROM marketing_settings WHERE tenant_id = ? LIMIT 1', [tenantId]);
      const settings = mSettings[0] || {
        birthday_discount: 15,
        birthday_email_subject: '¡Feliz Cumpleaños! 🎉',
        birthday_email_template: '¡Hola {{nombre}}! Esperamos que tengas un día maravilloso. Como regalo de cumpleaños, disfruta de un {{descuento}}% de descuento en cualquiera de nuestros servicios durante esta semana. ¡Te esperamos!'
      };

      const finalDiscountPercent = discountPercent || settings.birthday_discount || 15;
      const finalSubject = settings.birthday_email_subject || '¡Feliz Cumpleaños! 🎉';
      const finalTemplate = settings.birthday_email_template || '';

      const [clients] = await pool.query(`
        SELECT DISTINCT c.id, c.email, c.nombre, s.name as salon_name, s.address as salon_address 
        FROM clients c
        JOIN contracts cn ON c.id = cn.client_id AND cn.tenant_id = c.tenant_id
        LEFT JOIN salons s ON c.salon_id::text = s.id::text AND s.tenant_id = c.tenant_id
        WHERE c.tenant_id = ?
          AND DATE_FORMAT(c.fecha_nacimiento, '%m-%d') = DATE_FORMAT(NOW(), '%m-%d')
          AND cn.status = 'Active'
          AND c.email IS NOT NULL AND c.email != ''
      `, [tenantId]);

      const [emailSettingsRows] = await pool.query('SELECT * FROM email_settings WHERE tenant_id = ? LIMIT 1', [tenantId]);
      if (emailSettingsRows.length === 0 || !emailSettingsRows[0].smtp_host) {
        throw new Error("No hay configuración de correo configurada para este salón.");
      }
      const s = emailSettingsRows[0];

      const transporter = nodemailer.createTransport({
        host: s.smtp_host, port: s.smtp_port, secure: s.smtp_port == 465,
        auth: { user: s.smtp_user, pass: s.smtp_pass }
      });

      let sent = 0;
      for (const client of clients) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        const subject = finalSubject.replace(/\{\{nombre\}\}/g, client.nombre).replace(/\{\{descuento\}\}/g, finalDiscountPercent);
        const messageBody = finalTemplate.replace(/\{\{nombre\}\}/g, client.nombre).replace(/\{\{descuento\}\}/g, finalDiscountPercent);
        const trackingPixel = await logSentEmailAndGetPixel(req, client.id, 'birthday', client.email, subject, tenantId);

        try {
          await transporter.sendMail({
            from: `"${s.smtp_from || 'PLAN BEAUTY'}" <${s.smtp_user}>`,
            to: client.email,
            subject: subject,
            html: `
              <div style="font-family: sans-serif; padding: 20px;">
                <h2>¡Feliz Cumpleaños ${client.nombre}!</h2>
                <p>${messageBody.replace(/\n/g, '<br>')}</p>
              </div>
              ${trackingPixel}
            `
          });
          
          await pool.query('UPDATE clients SET last_birthday_sent_year = EXTRACT(YEAR FROM NOW()) WHERE id = ? AND tenant_id = ?', [client.id, tenantId]);
          sent++;
        } catch (e) {
          console.error(`Error enviando cumple a ${client.email}:`, e.message);
        }
      }

      res.json({ success: true, sent });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  const { checkJobIdempotency, recordJobExecution } = require('../middleware/job_hmac_auth.middleware.cjs');

  // Automated daily birthdays cron endpoint (Iterates per tenant strictly with Anti-Replay & Idempotency)
  router.post('/send-daily-birthdays', async (req, res) => {
    try {
      const todayDateStr = new Date().toISOString().slice(0, 10);
      const targetTenantId = req.body?.tenant_id ? String(req.body.tenant_id) : null;

      // 1. Single-tenant targeted execution idempotency check
      if (targetTenantId) {
        const isDuplicate = await checkJobIdempotency(pool, {
          tenantId: targetTenantId,
          jobType: 'daily_birthdays',
          date: todayDateStr
        });
        if (isDuplicate) {
          return res.status(409).json({
            error: 'JOB_DUPLICATE_EXECUTION',
            message: 'El job de cumpleaños ya fue ejecutado para este tenant en la fecha de hoy.',
            code: 'JOB_DUPLICATE_EXECUTION'
          });
        }
      }

      const [activeTenants] = targetTenantId 
        ? await pool.query("SELECT id FROM tenants WHERE id = ? AND status = 'active'", [targetTenantId])
        : await pool.query("SELECT id FROM tenants WHERE status = 'active'");

      let totalSent = 0;
      let processedTenants = 0;

      for (const t of activeTenants) {
        const tenantId = t.id;

        // Check per-tenant idempotency
        const alreadyRan = await checkJobIdempotency(pool, {
          tenantId,
          jobType: 'daily_birthdays',
          date: todayDateStr
        });
        if (alreadyRan) continue;

        const [mSettings] = await pool.query('SELECT * FROM marketing_settings WHERE tenant_id = ? LIMIT 1', [tenantId]);
        if (mSettings.length === 0 || !mSettings[0].birthday_automation_enabled) {
          await recordJobExecution(pool, { tenantId, jobType: 'daily_birthdays', date: todayDateStr, metadata: { sent: 0, reason: 'automation_disabled' } });
          continue;
        }

        const settings = mSettings[0];
        const [clients] = await pool.query(`
          SELECT DISTINCT c.id, c.email, c.nombre 
          FROM clients c
          JOIN contracts cn ON c.id = cn.client_id AND cn.tenant_id = c.tenant_id
          WHERE c.tenant_id = ?
            AND DATE_FORMAT(c.fecha_nacimiento, '%m-%d') = DATE_FORMAT(NOW(), '%m-%d')
            AND cn.status = 'Active'
            AND (c.last_birthday_sent_year IS NULL OR c.last_birthday_sent_year < EXTRACT(YEAR FROM NOW()))
            AND c.email IS NOT NULL AND c.email != ''
        `, [tenantId]);

        let tenantSent = 0;

        if (clients.length > 0) {
          const [emailSettingsRows] = await pool.query('SELECT * FROM email_settings WHERE tenant_id = ? LIMIT 1', [tenantId]);
          if (emailSettingsRows.length > 0 && emailSettingsRows[0].smtp_host) {
            const s = emailSettingsRows[0];
            const transporter = nodemailer.createTransport({
              host: s.smtp_host, port: s.smtp_port, secure: s.smtp_port == 465,
              auth: { user: s.smtp_user, pass: s.smtp_pass }
            });

            for (const client of clients) {
              try {
                await transporter.sendMail({
                  from: `"${s.smtp_from || 'PLAN BEAUTY'}" <${s.smtp_user}>`,
                  to: client.email,
                  subject: settings.birthday_email_subject || '¡Feliz Cumpleaños! 🎉',
                  text: `Hola ${client.nombre}, te deseamos un muy feliz cumpleaños!`
                });
                await pool.query('UPDATE clients SET last_birthday_sent_year = EXTRACT(YEAR FROM NOW()) WHERE id = ? AND tenant_id = ?', [client.id, tenantId]);
                tenantSent++;
              } catch (e) {}
            }
          }
        }

        totalSent += tenantSent;
        processedTenants++;

        // Record execution idempotency for tenant
        await recordJobExecution(pool, {
          tenantId,
          jobType: 'daily_birthdays',
          date: todayDateStr,
          metadata: { sent: tenantSent, clientsCount: clients.length }
        });
      }

      res.json({ success: true, sent: totalSent, processedTenants });
    } catch (err) {
      console.error('[DAILY BIRTHDAY ERROR]', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createMarketingRouter };
