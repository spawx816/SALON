const express = require('express');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

/**
 * Marketing and Birthday Campaigns Router Module for Salon Pro & Plan Beauty RD
 * 
 * @param {import('mysql2/promise').Pool} pool
 */
function createMarketingRouter(pool) {
  const router = express.Router();

  // === MARKETING LOGGER & TRACKING ===
  const logSentEmailAndGetPixel = async (req, clientId, emailType, recipientEmail, subject) => {
    try {
      const [res] = await pool.query(
        'INSERT INTO email_logs (client_id, email_type, recipient_email, subject) VALUES (?, ?, ?, ?)',
        [clientId || null, emailType, recipientEmail, subject]
      );
      const emailLogId = res.insertId;
      const host = req.get('host');
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const pixelUrl = `${protocol}://${host}/api/marketing/track-open/${emailLogId}`;
      return `<img src="${pixelUrl}" width="1" height="1" style="display:none;" />`;
    } catch (err) {
      console.error('[EMAIL LOG] Error logging sent email:', err);
      return '';
    }
  };

  const getMarketingAudienceWhereClause = (filter) => {
    switch (filter) {
      case 'no_plan':
        return " AND c.id NOT IN (SELECT DISTINCT client_id FROM contracts WHERE client_id IS NOT NULL AND status IN ('Active', 'Activo'))";
      case 'active_plan':
        return " AND c.id IN (SELECT DISTINCT client_id FROM contracts WHERE client_id IS NOT NULL AND status IN ('Active', 'Activo'))";
      case 'pending_payment':
        return " AND c.id IN (SELECT DISTINCT client_id FROM contracts WHERE client_id IS NOT NULL AND (status IN ('Past Due', 'Overdue', 'Pending_Retry') OR auto_billing_enabled = 0))";
      case 'tenure_3m':
        return " AND c.id IN (SELECT client_id FROM contracts WHERE client_id IS NOT NULL AND status IN ('Active', 'Activo') AND signed_at <= DATE_SUB(CURRENT_DATE(), INTERVAL 3 MONTH))";
      case 'tenure_6m':
        return " AND c.id IN (SELECT client_id FROM contracts WHERE client_id IS NOT NULL AND status IN ('Active', 'Activo') AND signed_at <= DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH))";
      case 'tenure_9m':
        return " AND c.id IN (SELECT client_id FROM contracts WHERE client_id IS NOT NULL AND status IN ('Active', 'Activo') AND signed_at <= DATE_SUB(CURRENT_DATE(), INTERVAL 9 MONTH))";
      case 'tenure_12m':
        return " AND c.id IN (SELECT client_id FROM contracts WHERE client_id IS NOT NULL AND status IN ('Active', 'Activo') AND signed_at <= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH))";
      case 'tenure_18m':
        return " AND c.id IN (SELECT client_id FROM contracts WHERE client_id IS NOT NULL AND status IN ('Active', 'Activo') AND signed_at <= DATE_SUB(CURRENT_DATE(), INTERVAL 18 MONTH))";
      case 'all':
      default:
        return "";
    }
  };

  // Helper to dynamically locate uploaded birthday flyer in public or dist
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

  // Helper to get the absolute file path of the birthday flyer on disk
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

  // Helper to get MIME type based on file extension
  const getMimeType = (filePath) => {
    if (!filePath) return 'image/jpeg';
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.webp') return 'image/webp';
    return 'image/jpeg';
  };

  // Helper to convert dynamic/relative URLs into absolute URLs for emails
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

  // Marketing email stats
  router.get('/stats', async (req, res) => {
    try {
      const [sentRows] = await pool.query(`
        SELECT COUNT(*) as total 
        FROM email_logs 
        WHERE MONTH(sent_at) = MONTH(NOW()) AND YEAR(sent_at) = YEAR(NOW())
      `);
      const totalSent = sentRows[0]?.total || 0;

      const [openedRows] = await pool.query(`
        SELECT COUNT(*) as total 
        FROM email_logs 
        WHERE opened = 1 AND MONTH(sent_at) = MONTH(NOW()) AND YEAR(sent_at) = YEAR(NOW())
      `);
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

  // Recipient count for audience segment
  router.get('/recipient-count', async (req, res) => {
    try {
      const filter = req.query.targetFilter || req.query.filter;
      const whereAudience = getMarketingAudienceWhereClause(filter);
      const [rows] = await pool.query(`
        SELECT COUNT(*) as count 
        FROM clients c 
        WHERE c.email IS NOT NULL AND c.email != '' ${whereAudience}
      `);
      res.json({ count: rows[0]?.count || 0 });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Mass email sending
  router.post('/send-mass', async (req, res) => {
    const { subject, template, campaignType, flyerUrl, targetFilter, filter } = req.body;
    const audience = targetFilter || filter || 'all';
    try {
      const whereAudience = getMarketingAudienceWhereClause(audience);
      const [clients] = await pool.query(`
        SELECT c.id, c.email, c.nombre, s.name as salon_name, s.address as salon_address 
        FROM clients c
        LEFT JOIN salons s ON c.salon_id = s.id
        WHERE c.email IS NOT NULL AND c.email != '' ${whereAudience}
      `);
      console.log(`[MARKETING MASS SEND] Iniciando campaña: "${subject}". Segmento: "${audience}". Destinatarios calificados: ${clients.length}`);
      const [settings] = await pool.query('SELECT * FROM email_settings LIMIT 1');
      
      if (settings.length === 0) throw new Error("No hay configuración de correo.");
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
        const trackingPixel = await logSentEmailAndGetPixel(req, client.id, 'massive', client.email, subject);
        
        try {
          await transporter.sendMail({
            from: `"${s.smtp_from || 'PLAN BEAUTY'}" <${s.smtp_user}>`,
            to: client.email,
            subject: subject,
            text: campaignType === 'image' ? `Hola ${client.nombre}, te enviamos una nueva promoción. Abre el correo para ver los detalles.` : body,
            attachments: attachments,
            html: campaignType === 'image' && imageSrc ? `
              <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f9f9f9; padding: 40px 15px; text-align: center;">
                <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 15px 35px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; padding: 0; box-sizing: border-box; text-align: left;">
                  <div style="padding: 35px 30px 20px 30px;">
                    <h2 style="margin: 0; color: #000000; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 22px; font-weight: 800; text-align: left; letter-spacing: -0.5px;">
                      ¡Hola ${client.nombre}!
                    </h2>
                  </div>
                  <div style="display: block; width: 100%; text-align: center;">
                    <img src="${imageSrc}" alt="Promoción" style="width: 100%; max-width: 100%; height: auto; display: block; margin: 0 auto; border: none;" />
                  </div>
                  <div style="padding: 30px 20px; text-align: center; border-top: 1px solid #eeeeee;">
                    <p style="margin: 0; font-size: 14px; font-weight: 700; color: #000000;">${client.salon_name || 'Abatte Peluquería'}</p>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #666666;">
                      ${client.salon_address || 'Av. San Vicente de Paúl, Santo Domingo Este.'}
                    </p>
                    <p style="margin: 20px 0 0 0; font-size: 10px; color: #999999; text-transform: uppercase; letter-spacing: 1px; line-height: 1.5;">
                      Si no desea recibir estos correos, <a href="#" style="color: #999999; text-decoration: underline;">cancele su suscripción aquí</a>.
                    </p>
                    <p style="margin: 10px 0 0 0; font-size: 9px; color: #bcaaa4; text-transform: uppercase; letter-spacing: 1px;">
                      © 2026 PLAN BEAUTY RD. TU PLAN, TU BELLEZA.
                    </p>
                  </div>
                </div>
              </div>
              ${trackingPixel}
            ` : `
              <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f9f9f9; padding: 40px 0;">
                <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
                  <div style="background-color: #000000; padding: 30px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 24px; letter-spacing: 2px; font-weight: 900;">
                      PLAN<span style="color: #d4af37;">BEAUTY</span>RD
                    </h1>
                    <p style="color: #d4af37; margin: 5px 0 0 0; font-size: 10px; text-transform: uppercase; letter-spacing: 3px; font-weight: 700;">
                      TU PLAN, TU BELLEZA
                    </p>
                  </div>
                  <div style="padding: 40px 30px; line-height: 1.8; color: #333333;">
                    <h2 style="margin-top: 0; color: #000000; font-size: 20px;">¡Hola ${client.nombre}!</h2>
                    <p style="font-size: 16px;">${body.replace(/\n/g, '<br>')}</p>
                  </div>
                  <div style="background-color: #f1f1f1; padding: 30px; text-align: center; border-top: 1px solid #eeeeee;">
                    <p style="margin: 0; font-size: 14px; font-weight: 700; color: #000000;">${client.salon_name || 'Abatte Peluquería San Vicente'}</p>
                    <p style="margin: 5px 0; font-size: 12px; color: #666666;">
                      ${client.salon_address || 'Av. San Vicente de Paúl, Santo Domingo, República Dominicana'}
                    </p>
                    <div style="margin-top: 20px;">
                      <a href="https://planbeautyrd.com" style="color: #000000; text-decoration: none; font-size: 12px; font-weight: 700; margin: 0 10px;">Sitio Web</a>
                      <span style="color: #cccccc;">|</span>
                      <a href="#" style="color: #000000; text-decoration: none; font-size: 12px; font-weight: 700; margin: 0 10px;">Instagram</a>
                    </div>
                    <p style="margin-top: 30px; font-size: 10px; color: #999999; text-transform: uppercase; letter-spacing: 1px;">
                      © 2026 PLAN BEAUTY RD. TODOS LOS DERECHOS RESERVADOS.
                    </p>
                  </div>
                </div>
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

  // Upload birthday flyer
  router.post('/upload-flyer', async (req, res) => {
    try {
      const { base64Data, fileName } = req.body;
      if (!base64Data) {
        return res.status(400).json({ error: 'No se recibió ninguna imagen.' });
      }

      const base64Image = base64Data.replace(/^data:image\/\w+;base64,/, "");
      const ext = fileName ? path.extname(fileName) : '.png';
      const finalFileName = `birthday_flyer${ext}`;
      const publicDir = path.join(__dirname, '..', '..', 'public');
      const publicFilePath = path.join(publicDir, finalFileName);
      
      const distDir = path.join(__dirname, '..', '..', 'dist');
      const distFilePath = path.join(distDir, finalFileName);

      const deleteExistingFlyers = (dir) => {
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir);
          files.forEach(f => {
            if (f.startsWith('birthday_flyer.')) {
              try {
                fs.unlinkSync(path.join(dir, f));
                console.log(`[MARKETING] Deleted old flyer on disk: ${f}`);
              } catch (err) {
                console.warn(`[MARKETING] Could not delete file: ${f}`, err.message);
              }
            }
          });
        }
      };

      deleteExistingFlyers(publicDir);
      deleteExistingFlyers(distDir);

      let saved = false;

      try {
        if (!fs.existsSync(publicDir)) {
          fs.mkdirSync(publicDir, { recursive: true });
        }
        fs.writeFileSync(publicFilePath, Buffer.from(base64Image, 'base64'));
        saved = true;
      } catch (e) {
        console.warn('[MARKETING] No se pudo guardar en public:', e.message);
      }

      try {
        if (!fs.existsSync(distDir)) {
          fs.mkdirSync(distDir, { recursive: true });
        }
        fs.writeFileSync(distFilePath, Buffer.from(base64Image, 'base64'));
        saved = true;
      } catch (e) {
        console.warn('[MARKETING] No se pudo guardar en dist:', e.message);
      }

      if (!saved) {
        throw new Error('No se pudo guardar el archivo en ninguna carpeta estática.');
      }

      const flyerUrl = `/${finalFileName}?v=${Date.now()}`;
      console.log(`[MARKETING] Flyer de cumpleaños actualizado con éxito. URL: ${flyerUrl}`);
      res.json({ success: true, flyerUrl });
    } catch (err) {
      console.error('[MARKETING UPLOAD ERROR]', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Upload campaign flyer
  router.post('/upload-campaign-flyer', async (req, res) => {
    try {
      const { base64Data, fileName } = req.body;
      if (!base64Data) {
        return res.status(400).json({ error: 'No se recibió ninguna imagen.' });
      }

      const base64Image = base64Data.replace(/^data:image\/\w+;base64,/, "");
      const ext = fileName ? path.extname(fileName) : '.png';
      const finalFileName = `campaign_flyer${ext}`;
      const publicDir = path.join(__dirname, '..', '..', 'public');
      const publicFilePath = path.join(publicDir, finalFileName);
      
      const distDir = path.join(__dirname, '..', '..', 'dist');
      const distFilePath = path.join(distDir, finalFileName);

      const deleteExistingFlyers = (dir) => {
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir);
          files.forEach(f => {
            if (f.startsWith('campaign_flyer.')) {
              try {
                fs.unlinkSync(path.join(dir, f));
              } catch (err) {
                console.warn(`[MARKETING] Could not delete file: ${f}`, err.message);
              }
            }
          });
        }
      };

      deleteExistingFlyers(publicDir);
      deleteExistingFlyers(distDir);

      let saved = false;

      try {
        if (!fs.existsSync(publicDir)) {
          fs.mkdirSync(publicDir, { recursive: true });
        }
        fs.writeFileSync(publicFilePath, Buffer.from(base64Image, 'base64'));
        saved = true;
      } catch (e) {
        console.warn('[MARKETING] No se pudo guardar en public:', e.message);
      }

      try {
        if (!fs.existsSync(distDir)) {
          fs.mkdirSync(distDir, { recursive: true });
        }
        fs.writeFileSync(distFilePath, Buffer.from(base64Image, 'base64'));
        saved = true;
      } catch (e) {
        console.warn('[MARKETING] No se pudo guardar en dist:', e.message);
      }

      if (!saved) throw new Error("No se pudo escribir el archivo en disco.");

      const flyerUrl = `/${finalFileName}?v=${Date.now()}`;
      res.json({ success: true, flyerUrl });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET Marketing Settings
  router.get('/settings', async (req, res) => {
    try {
      const [rows] = await pool.query('SELECT * FROM marketing_settings WHERE id = 1 LIMIT 1');
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

  // POST Marketing Settings
  router.post('/settings', async (req, res) => {
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
          id, birthday_automation_enabled, birthday_discount, birthday_flyer_url, 
          birthday_email_subject, birthday_email_template, mass_email_template
        ) 
        VALUES (
          1, ?, ?, ?, ?, ?, ?
        )
        ON DUPLICATE KEY UPDATE 
          birthday_automation_enabled = VALUES(birthday_automation_enabled),
          birthday_discount = VALUES(birthday_discount),
          birthday_flyer_url = VALUES(birthday_flyer_url),
          birthday_email_subject = VALUES(birthday_email_subject),
          birthday_email_template = VALUES(birthday_email_template),
          mass_email_template = VALUES(mass_email_template)
      `, [
        birthday_automation_enabled === true || birthday_automation_enabled == 1 ? 1 : 0,
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

  // GET active birthday flyer URL
  router.get('/birthday-flyer', (req, res) => {
    try {
      const flyerUrl = getBirthdayFlyerUrl(req);
      res.json({ success: true, flyerUrl });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET active campaign flyer URL
  router.get('/campaign-flyer', (req, res) => {
    try {
      const flyerUrl = getCampaignFlyerUrl(req);
      res.json({ success: true, flyerUrl });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Send manual birthday promotions
  router.post('/send-birthdays', async (req, res) => {
    const { discountPercent, flyerUrl } = req.body;
    try {
      const [mSettings] = await pool.query('SELECT * FROM marketing_settings WHERE id = 1 LIMIT 1');
      const settings = mSettings[0] || {
        birthday_discount: 15,
        birthday_email_subject: '¡Feliz Cumpleaños! 🎉',
        birthday_email_template: '¡Hola {{nombre}}! Esperamos que tengas un día maravilloso. Como regalo de cumpleaños, disfruta de un {{descuento}}% de descuento en cualquiera de nuestros servicios durante esta semana. ¡Te esperamos!'
      };

      const finalDiscountPercent = discountPercent || settings.birthday_discount || 15;
      const finalSubject = settings.birthday_email_subject || '¡Feliz Cumpleaños! 🎉';
      const finalTemplate = settings.birthday_email_template || '';

      const flyerPath = getBirthdayFlyerPath();
      const attachments = [];
      let imageSrc = null;

      if (flyerPath) {
        attachments.push({
          filename: path.basename(flyerPath),
          path: flyerPath,
          cid: 'birthdayflyer',
          contentType: getMimeType(flyerPath),
          disposition: 'inline'
        });
        imageSrc = 'cid:birthdayflyer';
        console.log(`[MARKETING] Attached birthday flyer inline: ${flyerPath} with CID: birthdayflyer`);
      } else if (flyerUrl) {
        imageSrc = getAbsoluteFlyerUrl(req, flyerUrl);
      } else {
        const relativeFlyer = getBirthdayFlyerUrl(req);
        if (relativeFlyer) {
          imageSrc = getAbsoluteFlyerUrl(req, relativeFlyer);
        }
      }

      const [clients] = await pool.query(`
        SELECT DISTINCT c.id, c.email, c.nombre, s.name as salon_name, s.address as salon_address 
        FROM clients c
        JOIN contracts cn ON c.id = cn.client_id
        LEFT JOIN salons s ON c.salon_id = s.id
        WHERE DATE_FORMAT(c.fecha_nacimiento, '%m-%d') = DATE_FORMAT(NOW(), '%m-%d')
        AND cn.status = 'Active'
        AND c.email IS NOT NULL AND c.email != ''
      `);

      const [emailSettingsRows] = await pool.query('SELECT * FROM email_settings LIMIT 1');
      if (emailSettingsRows.length === 0) throw new Error("No hay configuración de correo.");
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
        const trackingPixel = await logSentEmailAndGetPixel(req, client.id, 'birthday', client.email, subject);

        try {
          await transporter.sendMail({
            from: `"${s.smtp_from || 'PLAN BEAUTY'}" <${s.smtp_user}>`,
            to: client.email,
            subject: subject,
            attachments: attachments,
            html: `
              <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #fdf8f5; padding: 40px 15px; text-align: center;">
                <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 15px 35px rgba(74, 55, 40, 0.05); border: 1px solid #f3e8df; padding: 40px 30px; box-sizing: border-box; text-align: center;">
                  <h1 style="color: #000000; font-family: Georgia, serif; font-size: 32px; font-weight: 400; margin: 0 0 25px 0; text-align: center; line-height: 1.2;">
                    Hola <span style="font-weight: 700; color: #000000;">${client.nombre}</span>
                  </h1>

                  ${messageBody ? `
                  <p style="font-family: Arial, sans-serif; font-size: 15px; color: #4a3728; line-height: 1.6; margin-bottom: 25px; text-align: center; white-space: pre-line;">
                    ${messageBody}
                  </p>
                  ` : ''}
                  
                  ${imageSrc ? `
                  <div style="text-align: center; border-radius: 16px; overflow: hidden; border: 1px solid #ebd9cc; box-shadow: 0 8px 24px rgba(74, 55, 40, 0.05); margin: 0 auto; max-width: 100%;">
                    <img src="${imageSrc}" alt="Tu Regalo de Cumpleaños" style="max-width: 100%; height: auto; display: block; margin: 0 auto;" />
                  </div>
                  ` : `
                  <div style="padding: 30px; background: #fffdfb; border: 1px dashed #ecd8c9; border-radius: 16px; color: #a17865; font-family: sans-serif;">
                    <p style="margin: 0; font-size: 18px; font-weight: 600;">Disfruta un ${finalDiscountPercent}% de Descuento</p>
                    <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.8;">Válido durante toda la semana de tu cumpleaños en cualquier servicio.</p>
                  </div>
                  `}
                </div>
                
                <div style="text-align: center; margin-top: 25px;">
                  <p style="margin: 0; font-family: Arial, sans-serif; font-size: 11px; color: #a18a78; text-transform: uppercase; letter-spacing: 2px; font-weight: 700;">
                    PLAN BEAUTY • ABATTE PELUQUERÍA
                  </p>
                  <p style="margin: 5px 0 0 0; font-family: Arial, sans-serif; font-size: 9px; color: #bcaaa4;">
                    © 2026 PLAN BEAUTY RD. TU PLAN, TU BELLEZA.
                  </p>
                </div>
              </div>
              ${trackingPixel}
            `
          });
          
          await pool.query('UPDATE clients SET last_birthday_sent_year = YEAR(NOW()) WHERE id = ?', [client.id]);
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

  // Automated daily birthdays cron endpoint
  router.post('/send-daily-birthdays', async (req, res) => {
    try {
      const [mSettings] = await pool.query('SELECT * FROM marketing_settings WHERE id = 1 LIMIT 1');
      const settings = mSettings[0] || {
        birthday_automation_enabled: 1,
        birthday_discount: 15,
        birthday_email_subject: '¡Feliz Cumpleaños! 🎉',
        birthday_email_template: '¡Hola {{nombre}}! Esperamos que tengas un día maravilloso. Como regalo de cumpleaños, disfruta de un {{descuento}}% de descuento en cualquiera de nuestros servicios durante esta semana. ¡Te esperamos!'
      };

      if (!settings.birthday_automation_enabled) {
        console.log('[DAILY CRON] Automated birthday greetings are currently disabled in settings.');
        return res.json({ success: true, sent: 0, message: 'La automatización de cumpleaños está desactivada en la configuración.' });
      }

      const finalDiscountPercent = settings.birthday_discount || 15;
      const finalSubject = settings.birthday_email_subject || '¡Feliz Cumpleaños! 🎉';
      const finalTemplate = settings.birthday_email_template || '';

      const flyerPath = getBirthdayFlyerPath();
      const attachments = [];
      let imageSrc = null;

      if (flyerPath) {
        attachments.push({
          filename: path.basename(flyerPath),
          path: flyerPath,
          cid: 'birthdayflyer',
          contentType: getMimeType(flyerPath),
          disposition: 'inline'
        });
        imageSrc = 'cid:birthdayflyer';
        console.log(`[DAILY CRON] Attached birthday flyer inline: ${flyerPath} with CID: birthdayflyer`);
      } else {
        const relativeFlyer = getBirthdayFlyerUrl(req);
        if (relativeFlyer) {
          imageSrc = getAbsoluteFlyerUrl(req, relativeFlyer);
        }
      }

      const [clients] = await pool.query(`
        SELECT DISTINCT c.id, c.email, c.nombre, s.name as salon_name, s.address as salon_address 
        FROM clients c
        JOIN contracts cn ON c.id = cn.client_id
        LEFT JOIN salons s ON c.salon_id = s.id
        WHERE DATE_FORMAT(c.fecha_nacimiento, '%m-%d') = DATE_FORMAT(NOW(), '%m-%d')
        AND cn.status = 'Active'
        AND (c.last_birthday_sent_year IS NULL OR c.last_birthday_sent_year < YEAR(NOW()))
        AND c.email IS NOT NULL AND c.email != ''
      `);

      console.log(`[DAILY BIRTHDAY CRON] Found ${clients.length} birthday clients today.`);

      if (clients.length === 0) {
        return res.json({ success: true, sent: 0, message: 'No hay cumpleañeros pendientes hoy.' });
      }

      const [emailSettingsRows] = await pool.query('SELECT * FROM email_settings LIMIT 1');
      if (emailSettingsRows.length === 0) throw new Error("No hay configuración de correo.");
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
        const trackingPixel = await logSentEmailAndGetPixel(req, client.id, 'birthday_automated', client.email, subject);

        try {
          await transporter.sendMail({
            from: `"${s.smtp_from || 'PLAN BEAUTY'}" <${s.smtp_user}>`,
            to: client.email,
            subject: subject,
            attachments: attachments,
            html: `
              <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #fdf8f5; padding: 40px 15px; text-align: center;">
                <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 15px 35px rgba(74, 55, 40, 0.05); border: 1px solid #f3e8df; padding: 40px 30px; box-sizing: border-box; text-align: center;">
                  <h1 style="color: #000000; font-family: Georgia, serif; font-size: 32px; font-weight: 400; margin: 0 0 25px 0; text-align: center; line-height: 1.2;">
                    Hola <span style="font-weight: 700; color: #000000;">${client.nombre}</span>
                  </h1>

                  ${messageBody ? `
                  <p style="font-family: Arial, sans-serif; font-size: 15px; color: #4a3728; line-height: 1.6; margin-bottom: 25px; text-align: center; white-space: pre-line;">
                    ${messageBody}
                  </p>
                  ` : ''}
                  
                  ${imageSrc ? `
                  <div style="text-align: center; border-radius: 16px; overflow: hidden; border: 1px solid #ebd9cc; box-shadow: 0 8px 24px rgba(74, 55, 40, 0.05); margin: 0 auto; max-width: 100%;">
                    <img src="${imageSrc}" alt="Tu Regalo de Cumpleaños" style="max-width: 100%; height: auto; display: block; margin: 0 auto;" />
                  </div>
                  ` : `
                  <div style="padding: 30px; background: #fffdfb; border: 1px dashed #ecd8c9; border-radius: 16px; color: #a17865; font-family: sans-serif;">
                    <p style="margin: 0; font-size: 18px; font-weight: 600;">Disfruta un ${finalDiscountPercent}% de Descuento</p>
                    <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.8;">Válido durante toda la semana de tu cumpleaños en cualquier servicio.</p>
                  </div>
                  `}
                </div>
                
                <div style="text-align: center; margin-top: 25px;">
                  <p style="margin: 0; font-family: Arial, sans-serif; font-size: 11px; color: #a18a78; text-transform: uppercase; letter-spacing: 2px; font-weight: 700;">
                    PLAN BEAUTY • ABATTE PELUQUERÍA
                  </p>
                  <p style="margin: 5px 0 0 0; font-family: Arial, sans-serif; font-size: 9px; color: #bcaaa4;">
                    © 2026 PLAN BEAUTY RD. TU PLAN, TU BELLEZA.
                  </p>
                </div>
              </div>
              ${trackingPixel}
            `
          });

          await pool.query('UPDATE clients SET last_birthday_sent_year = YEAR(NOW()) WHERE id = ?', [client.id]);
          sent++;
        } catch (e) {
          console.error(`Error enviando cumpleaños automático a ${client.email}:`, e.message);
        }
      }

      res.json({ success: true, sent });
    } catch (err) {
      console.error('[DAILY BIRTHDAY ERROR]', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createMarketingRouter };
