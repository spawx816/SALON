const express = require('express');
const nodemailer = require('nodemailer');
const axios = require('axios');

const escapeHtml = (str) => {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

function createClientsRouter(pool, options = {}) {
  const router = express.Router();

  const CARDNET_CONFIG = options.CARDNET_CONFIG || {
    BASE_URL: process.env.CARDNET_BASE_URL || 'https://labservicios.cardnet.com.do',
    PUBLIC_KEY: process.env.CARDNET_PUBLIC_KEY,
    PRIVATE_KEY: process.env.CARDNET_PRIVATE_KEY,
    ENV: process.env.CARDNET_ENV || 'TEST',
    TIMEOUT: parseInt(process.env.CARDNET_TIMEOUT) || 30000
  };

  const getCardNetAuthHeaders = options.getCardNetAuthHeaders || (() => ({
    'Content-Type': 'application/json',
    'Authorization': `Basic ${CARDNET_CONFIG.PRIVATE_KEY}`
  }));

  // GET /api/clients - Full client listing with contracts and plans enriched
  router.get('/', async (req, res) => {
    try {
      const [[clients], [contracts], [plans]] = await Promise.all([
        pool.query(`
          SELECT id, nombre, telefono, email, cedula, frecuencia, salon_id, status, registration_source, created_at, calle, numero, sector, ciudad, fecha_nacimiento
          FROM clients 
          ORDER BY nombre ASC
        `),
        pool.query(`
          SELECT id, client_id, plan_id, status, retry_count 
          FROM contracts 
          ORDER BY id ASC
        `),
        pool.query(`SELECT id, title FROM plans`)
      ]);

      const planMap = {};
      plans.forEach(p => { planMap[p.id] = p.title; });

      const contractMap = {};
      contracts.forEach(c => {
        if (c.client_id) {
          contractMap[c.client_id] = c;
        }
      });

      const result = clients.map(cl => {
        const c = contractMap[cl.id] || contractMap[cl.cedula] || null;
        let formattedBday = null;
        if (cl.fecha_nacimiento) {
          if (cl.fecha_nacimiento instanceof Date) {
            const yr = cl.fecha_nacimiento.getFullYear();
            const mo = String(cl.fecha_nacimiento.getMonth() + 1).padStart(2, '0');
            const dy = String(cl.fecha_nacimiento.getDate()).padStart(2, '0');
            formattedBday = `${yr}-${mo}-${dy}`;
          } else {
            formattedBday = String(cl.fecha_nacimiento).split('T')[0];
          }
        }

        return {
          id: cl.id,
          nombre: cl.nombre,
          telefono: cl.telefono,
          email: cl.email,
          cedula: cl.cedula,
          frecuencia: cl.frecuencia,
          salon_id: cl.salon_id,
          status: cl.status || 'Active',
          calle: cl.calle || null,
          numero: cl.numero || null,
          sector: cl.sector || null,
          ciudad: cl.ciudad || null,
          fecha_nacimiento: formattedBday,
          registration_source: cl.registration_source || 'Self',
          created_at: cl.created_at,
          contract_status: c ? c.status : null,
          retry_count: c ? c.retry_count : 0,
          planName: c && planMap[c.plan_id] ? planMap[c.plan_id] : (c ? 'Plan Beauty' : 'Sin Plan')
        };
      });

      res.json(result);
    } catch (err) {
      console.error('[API ERROR] Failed to fetch clients:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/clients - Client registration with welcome email
  router.post('/', async (req, res) => {
    try {
      const id = Date.now().toString();
      const { cedula, nombre, telefono, email, frecuencia, salon_id, calle, numero, sector, ciudad, fechaNacimiento, fecha_nacimiento, registration_source } = req.body;
      const [existing] = await pool.query('SELECT id FROM clients WHERE email = ? OR cedula = ?', [email, cedula]);
      if (existing.length > 0) {
        return res.status(400).json({ error: 'Ya existe un usuario con este correo o cédula' });
      }

      const bday = fecha_nacimiento || fechaNacimiento || null;
      const cleanBday = bday && String(bday).trim() ? String(bday).split('T')[0] : null;

      // Generate Random Password (8 chars)
      const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      let tempPassword = "";
      for (let i = 0; i < 8; i++) tempPassword += charset.charAt(Math.floor(Math.random() * charset.length));

      await pool.query(
        'INSERT INTO clients (id, cedula, nombre, telefono, email, password, must_change_password, frecuencia, salon_id, calle, numero, sector, ciudad, status, role_id, tipo, fecha_nacimiento, registration_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, cedula, nombre, telefono, email, tempPassword, 1, frecuencia || 'Mensual', salon_id || 1, calle || null, numero || null, sector || null, ciudad || null, 'Active', 2, 'client', cleanBday, registration_source || 'Self']
      );

      // Send Email
      const [settings] = await pool.query('SELECT * FROM email_settings LIMIT 1');
      if (settings.length > 0) {
        const s = settings[0];
        const transporter = nodemailer.createTransport({
          host: s.smtp_host, port: s.smtp_port, secure: s.smtp_port == 465,
          auth: { user: s.smtp_user, pass: s.smtp_pass }
        });

        try {
          await transporter.sendMail({
            from: `"${s.smtp_from || 'Abatte Peluquería'}" <${s.smtp_user}>`,
            to: email,
            subject: 'Bienvenida a Abatte Peluquería - Tus Credenciales',
            html: `
              <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 40px; border: 1px solid #eee; border-radius: 20px; background: #fff;">
                <div style="text-align: center; margin-bottom: 30px;">
                  <h1 style="color: #09090b; margin: 0; font-size: 24px; font-weight: 900;">¡Hola ${escapeHtml(nombre)}!</h1>
                </div>
                
                <p style="color: #444; line-height: 1.6;">Tu cuenta en <strong>Abatte Peluquería</strong> ha sido creada. Ya puedes acceder a tu panel de cliente para gestionar tus servicios.</p>
                
                <div style="background: #f8fafc; padding: 25px; border-radius: 16px; margin: 30px 0; border: 1px solid #e2e8f0;">
                  <p style="margin: 0 0 10px 0; font-size: 0.9rem; color: #64748b;">Tus credenciales de acceso:</p>
                  <p style="margin: 5px 0; font-size: 1.1rem;"><strong>Usuario:</strong> ${escapeHtml(email)}</p>
                  <p style="margin: 5px 0; font-size: 1.1rem;"><strong>Contraseña Temporal:</strong> <span style="background: #09090b; color: #fff; padding: 2px 8px; border-radius: 4px;">${escapeHtml(tempPassword)}</span></p>
                </div>

                <div style="text-align: center; margin: 30px 0;">
                  <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/login" style="background: #09090b; color: #fff; padding: 16px 32px; border-radius: 12px; text-decoration: none; font-weight: 800; display: inline-block;">
                    Iniciar Sesión
                  </a>
                </div>

                <p style="color: #ef4444; font-size: 0.85rem; font-weight: 700;">IMPORTANTE: Se te pedirá cambiar esta contraseña al ingresar por primera vez por motivos de seguridad.</p>
                
                <hr style="border: 0; border-top: 1px solid #eee; margin: 30px 0;" />
                <p style="font-size: 0.75rem; color: #999; text-align: center;">
                  Abatte Peluquería &copy; 2026
                </p>
              </div>
            `
          });
        } catch (mailErr) {
          console.error('Error sending welcome email:', mailErr);
        }
      }

      res.json({ id, cedula, nombre, email, status: 'Active', fecha_nacimiento: cleanBday });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/clients/change-password
  router.post('/change-password', async (req, res) => {
    const { clientId, currentPassword, newPassword } = req.body;
    try {
      const [clients] = await pool.query('SELECT password FROM clients WHERE id = ?', [clientId]);
      if (clients.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
      
      if (clients[0].password !== currentPassword) {
        return res.status(401).json({ error: 'La contraseña actual es incorrecta' });
      }

      await pool.query('UPDATE clients SET password = ?, must_change_password = 0 WHERE id = ?', [newPassword, clientId]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/clients/cedula/:cedula
  router.get('/cedula/:cedula', async (req, res) => {
    try {
      const raw = req.params.cedula;
      const cleanCedula = String(raw).replace(/\D/g, '');
      const [rows] = await pool.query(
        `SELECT * FROM clients 
         WHERE cedula = ? 
            OR REPLACE(cedula, '-', '') = ? 
            OR REPLACE(cedula, '-', '') = ? 
            OR id = ? 
            OR id = ? 
            OR email = ?
         LIMIT 1`,
        [raw, raw, cleanCedula, raw, cleanCedula, raw]
      );
      if (rows.length > 0) {
        const client = rows[0];
        if (client.fecha_nacimiento) {
          if (client.fecha_nacimiento instanceof Date) {
            const yr = client.fecha_nacimiento.getFullYear();
            const mo = String(client.fecha_nacimiento.getMonth() + 1).padStart(2, '0');
            const dy = String(client.fecha_nacimiento.getDate()).padStart(2, '0');
            client.fecha_nacimiento = `${yr}-${mo}-${dy}`;
          } else {
            client.fecha_nacimiento = String(client.fecha_nacimiento).split('T')[0];
          }
        }
        const [contracts] = await pool.query("SELECT plan_id FROM contracts WHERE client_id = ? AND status != 'Cancelled'", [client.id]);
        client.active_plan_ids = contracts.map(c => c.plan_id.toString());
        return res.json(client);
      }
      res.status(404).json({ error: 'Not found' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/clients/:id
  router.get('/:id', async (req, res) => {
    try {
      const target = req.params.id ? String(req.params.id).trim() : '';
      if (!target) return res.status(400).json({ error: 'ID is required' });

      const [rows] = await pool.query('SELECT * FROM clients WHERE id = ? OR cedula = ? OR email = ? LIMIT 1', [target, target, target]);
      if (rows.length > 0) {
        const client = rows[0];
        if (client.fecha_nacimiento) {
          if (client.fecha_nacimiento instanceof Date) {
            const yr = client.fecha_nacimiento.getFullYear();
            const mo = String(client.fecha_nacimiento.getMonth() + 1).padStart(2, '0');
            const dy = String(client.fecha_nacimiento.getDate()).padStart(2, '0');
            client.fecha_nacimiento = `${yr}-${mo}-${dy}`;
          } else {
            client.fecha_nacimiento = String(client.fecha_nacimiento).split('T')[0];
          }
        }
        const [contracts] = await pool.query("SELECT plan_id FROM contracts WHERE client_id = ? AND status != 'Cancelled'", [client.id]);
        client.active_plan_ids = contracts.map(c => c.plan_id.toString());
        return res.json(client);
      }
      res.status(404).json({ error: 'Client not found' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/clients/:id
  router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { cedula, nombre, telefono, email, calle, numero, sector, ciudad, fecha_nacimiento, fechaNacimiento, salon_id } = req.body;
    const bday = fecha_nacimiento || fechaNacimiento || null;
    const cleanBday = bday && String(bday).trim() ? String(bday).split('T')[0] : null;

    try {
      const [result] = await pool.query(
        'UPDATE clients SET cedula = ?, nombre = ?, telefono = ?, email = ?, calle = ?, numero = ?, sector = ?, ciudad = ?, fecha_nacimiento = ?, salon_id = COALESCE(?, salon_id) WHERE id = ? OR cedula = ?',
        [cedula, nombre, telefono, email, calle || null, numero || null, sector || null, ciudad || null, cleanBday, salon_id || null, id, cedula || id]
      );
      if (salon_id) {
        await pool.query('UPDATE contracts SET salon_id = ? WHERE client_id = ? OR client_id = (SELECT id FROM clients WHERE cedula = ? LIMIT 1)', [salon_id, id, cedula || id]);
      }
      res.json({ success: true, fecha_nacimiento: cleanBday, affectedRows: result.affectedRows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/clients/:id/payment-profiles - Get all registered cards in vault (deduplicated)
  router.get('/:id/payment-profiles', async (req, res) => {
    try {
      const clientId = req.params.id;
      const [clients] = await pool.query('SELECT * FROM clients WHERE id = ? OR cedula = ? LIMIT 1', [clientId, clientId]);
      if (clients.length === 0) return res.json([]);
      const client = clients[0];

      // Also get current active contract for primary card reference
      let contract = null;
      try {
        const [activeContracts] = await pool.query(
          "SELECT * FROM contracts WHERE (client_id = ? OR client_id = ?) AND status != 'Cancelled' ORDER BY id DESC LIMIT 1",
          [client.id, client.cedula]
        );
        if (activeContracts.length > 0) contract = activeContracts[0];
      } catch (cErr) {
        console.warn('[CONTRACTS QUERY NOTICE]:', cErr.message);
      }

      let cardProfiles = [];

      // 1. Try to fetch from CardNet API if client has cardnet_customer_id
      if (client.cardnet_customer_id) {
        try {
          const cardnetRes = await axios.get(
            `${CARDNET_CONFIG.BASE_URL}/api/Customer/${client.cardnet_customer_id}`,
            { headers: getCardNetAuthHeaders(), timeout: CARDNET_CONFIG.TIMEOUT }
          );
          const custData = cardnetRes.data.Response || cardnetRes.data;
          const profiles = custData.PaymentProfiles || [];
          
          if (Array.isArray(profiles) && profiles.length > 0) {
            const rawCards = profiles.map(p => {
              const pid = String(p.PaymentProfileId || p.PaymentProfileID || p.Id || '');
              const brand = (p.Brand || p.CardType || 'CARD').toUpperCase();
              const last4 = String(p.Last4 || (p.CardNumber ? p.CardNumber.slice(-4) : '••••'));
              const contractPid = String(contract?.payment_profile_id || contract?.cardnet_profile_id || '');
              const isContractCard = contract && (contractPid === pid || (contract.card_last4 === last4 && contract.card_brand?.toUpperCase() === brand));
              const isEnabled = p.Enable === true || p.Enable === 'true' || p.Enable === '1' || p.Enable === 1 || isContractCard;

              return {
                PaymentProfileId: pid,
                Brand: brand,
                Last4: last4,
                Expiration: p.Expiration || p.ExpiryDate || '',
                Enable: Boolean(isEnabled),
                IsPrimary: Boolean(isContractCard || isEnabled),
                Token: p.Token
              };
            });

            // Deduplicate by Brand + Last4: Keep the primary/enabled one or highest PaymentProfileId
            const uniqueMap = new Map();
            for (const c of rawCards) {
              const key = `${c.Brand}_${c.Last4}`;
              if (!uniqueMap.has(key)) {
                uniqueMap.set(key, c);
              } else {
                const existing = uniqueMap.get(key);
                if ((c.IsPrimary || c.Enable) && !(existing.IsPrimary || existing.Enable)) {
                  uniqueMap.set(key, c);
                } else if (c.Enable === existing.Enable && Number(c.PaymentProfileId) > Number(existing.PaymentProfileId)) {
                  uniqueMap.set(key, c);
                }
              }
            }

            cardProfiles = Array.from(uniqueMap.values());
            // Sort primary/enabled cards first
            cardProfiles.sort((a, b) => (b.IsPrimary || b.Enable ? 1 : 0) - (a.IsPrimary || a.Enable ? 1 : 0));
          }
        } catch (apiErr) {
          console.warn(`[CARDNET PROFILES] Fallback a DB para cliente ${clientId}:`, apiErr.message);
        }
      }

      // 2. If no CardNet profiles retrieved, check active/stored contracts in DB
      if (cardProfiles.length === 0 && contract && (contract.payment_profile_id || contract.cardnet_profile_id || contract.card_token || contract.card_last4)) {
        cardProfiles = [{
          PaymentProfileId: contract.payment_profile_id || contract.cardnet_profile_id || (contract.card_token ? `prof_${contract.card_token.slice(-6)}` : `prof_${client.id}`),
          Brand: (contract.card_brand || 'VISA').toUpperCase(),
          Last4: contract.card_last4 || (contract.card_token ? contract.card_token.slice(-4) : '4242'),
          Expiration: contract.card_expiration || '202812',
          Enable: contract.auto_billing_enabled !== 0 && contract.auto_billing_enabled !== false,
          IsPrimary: true,
          Token: contract.card_token
        }];
      }

      res.json(cardProfiles);
    } catch (err) {
      console.error('[CLIENT PAYMENT PROFILES ERROR]:', err.message);
      res.json([]);
    }
  });

  // POST /api/clients/:id/cleanup-duplicate-cards - Purge obsolete/disabled duplicate profiles from CardNet
  router.post('/:id/cleanup-duplicate-cards', async (req, res) => {
    try {
      const clientId = req.params.id;
      const [clients] = await pool.query('SELECT * FROM clients WHERE id = ? OR cedula = ? LIMIT 1', [clientId, clientId]);
      if (clients.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
      const client = clients[0];

      if (!client.cardnet_customer_id) {
        return res.json({ success: true, message: 'No hay customer en CardNet.', deletedCount: 0 });
      }

      const cardnetRes = await axios.get(
        `${CARDNET_CONFIG.BASE_URL}/api/Customer/${client.cardnet_customer_id}`,
        { headers: getCardNetAuthHeaders(), timeout: CARDNET_CONFIG.TIMEOUT }
      );
      const custData = cardnetRes.data.Response || cardnetRes.data;
      const profiles = custData.PaymentProfiles || [];

      if (!Array.isArray(profiles) || profiles.length <= 1) {
        return res.json({ success: true, message: 'No hay perfiles duplicados.', deletedCount: 0 });
      }

      // Group by Brand + Last4
      const grouped = {};
      profiles.forEach(p => {
        const brand = (p.Brand || p.CardType || 'CARD').toUpperCase();
        const last4 = String(p.Last4 || (p.CardNumber ? p.CardNumber.slice(-4) : '••••'));
        const key = `${brand}_${last4}`;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(p);
      });

      let deletedCount = 0;
      for (const key in grouped) {
        const list = grouped[key];
        if (list.length > 1) {
          // Sort to find the best profile to keep (enabled first, then highest ID)
          list.sort((a, b) => {
            const aEn = a.Enable === true || a.Enable === 'true' || a.Enable === '1';
            const bEn = b.Enable === true || b.Enable === 'true' || b.Enable === '1';
            if (aEn !== bEn) return bEn ? 1 : -1;
            return Number(b.PaymentProfileId || 0) - Number(a.PaymentProfileId || 0);
          });

          // Keep index 0, delete the rest
          const toDelete = list.slice(1);
          for (const item of toDelete) {
            const pid = item.PaymentProfileId || item.PaymentProfileID || item.Id;
            try {
              await axios.post(
                `${CARDNET_CONFIG.BASE_URL}/api/Customer/${client.cardnet_customer_id}/PaymentProfileDelete`,
                { PaymentProfileID: pid, PaymentProfileId: pid },
                { headers: getCardNetAuthHeaders(), timeout: CARDNET_CONFIG.TIMEOUT }
              );
              deletedCount++;
              console.log(`[CLEANUP] Deleted duplicate profile ${pid} for client ${clientId}`);
            } catch (delErr) {
              console.warn(`[CLEANUP] Error deleting profile ${pid}:`, delErr.message);
            }
          }
        }
      }

      res.json({ success: true, message: `Se depuraron ${deletedCount} perfil(es) duplicado(s).`, deletedCount });
    } catch (err) {
      console.error('[CLEANUP CARDS ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/clients/:id/set-primary-card - Set a specific card profile as the primary active card
  router.put('/:id/set-primary-card', async (req, res) => {
    try {
      const clientId = req.params.id;
      const { paymentProfileId, brand, last4, expiration, token } = req.body;

      if (!paymentProfileId) {
        return res.status(400).json({ error: 'paymentProfileId es requerido' });
      }

      const [clients] = await pool.query('SELECT * FROM clients WHERE id = ? OR cedula = ? LIMIT 1', [clientId, clientId]);
      if (clients.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
      const client = clients[0];

      // 1. If CardNet customer, enable this profile in CardNet
      if (client.cardnet_customer_id) {
        try {
          await axios.post(
            `${CARDNET_CONFIG.BASE_URL}/api/Customer/${client.cardnet_customer_id}/PaymentProfileUpdate`,
            {
              PaymentProfileID: paymentProfileId,
              PaymentProfileId: paymentProfileId,
              Expiration: expiration || undefined,
              Enable: true
            },
            { headers: getCardNetAuthHeaders(), timeout: CARDNET_CONFIG.TIMEOUT }
          );
        } catch (cardnetErr) {
          console.warn('[SET-PRIMARY-CARD] CardNet profile update notice:', cardnetErr.message);
        }
      }

      // 2. Update contracts in DB safely
      try {
        await pool.query(
          `UPDATE contracts 
           SET card_token = COALESCE(?, card_token)
           WHERE (client_id = ? OR client_id = ?) AND status != 'Cancelled'`,
          [token, client.id, client.cedula]
        );
      } catch (uErr) {
        console.warn('[SET-PRIMARY-CARD DB UPDATE NOTICE]:', uErr.message);
      }

      res.json({ success: true, message: 'Tarjeta principal actualizada con éxito' });
    } catch (err) {
      console.error('[SET-PRIMARY-CARD ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/clients/:id/payment-profile - Primary/active payment profile for a client
  router.get('/:id/payment-profile', async (req, res) => {
    try {
      const clientId = req.params.id;
      const [clients] = await pool.query('SELECT * FROM clients WHERE id = ? OR cedula = ? LIMIT 1', [clientId, clientId]);
      if (clients.length === 0) return res.json(null);
      const client = clients[0];

      let primaryCard = null;

      if (client.cardnet_customer_id) {
        try {
          const cardnetRes = await axios.get(
            `${CARDNET_CONFIG.BASE_URL}/api/Customer/${client.cardnet_customer_id}`,
            { headers: getCardNetAuthHeaders(), timeout: CARDNET_CONFIG.TIMEOUT }
          );
          const custData = cardnetRes.data.Response || cardnetRes.data;
          const profiles = custData.PaymentProfiles || [];
          
          if (Array.isArray(profiles) && profiles.length > 0) {
            const activeP = profiles.find(p => p.Enable === true || p.Enable === 'true' || p.Enable === '1' || p.Enable === 1) || profiles[0];
            primaryCard = {
              PaymentProfileId: String(activeP.PaymentProfileId || activeP.PaymentProfileID || activeP.Id),
              Brand: (activeP.Brand || activeP.CardType || 'CARD').toUpperCase(),
              Last4: String(activeP.Last4 || (activeP.CardNumber ? activeP.CardNumber.slice(-4) : '••••')),
              Expiration: activeP.Expiration || activeP.ExpiryDate || '',
              Enable: activeP.Enable === true || activeP.Enable === 'true' || activeP.Enable === '1' || activeP.Enable === 1,
              Token: activeP.Token
            };
          }
        } catch (apiErr) {
          console.warn(`[CARDNET PRIMARY PROFILE] Fallback a DB para cliente ${clientId}:`, apiErr.message);
        }
      }

      if (!primaryCard) {
        try {
          const [contracts] = await pool.query(
            "SELECT * FROM contracts WHERE (client_id = ? OR client_id = ?) AND status != 'Cancelled' ORDER BY id DESC LIMIT 1",
            [client.id, client.cedula]
          );

          if (contracts.length > 0 && (contracts[0].cardnet_profile_id || contracts[0].payment_profile_id || contracts[0].card_token || contracts[0].card_last4)) {
            const c = contracts[0];
            primaryCard = {
              PaymentProfileId: c.payment_profile_id || c.cardnet_profile_id || (c.card_token ? `prof_${c.card_token.slice(-6)}` : `prof_${client.id}`),
              Brand: (c.card_brand || 'VISA').toUpperCase(),
              Last4: c.card_last4 || (c.card_token ? c.card_token.slice(-4) : '4242'),
              Expiration: c.card_expiration || '202812',
              Enable: c.auto_billing_enabled !== 0 && c.auto_billing_enabled !== false,
              Token: c.card_token
            };
          }
        } catch (dbErr) {
          console.warn('[CONTRACTS FALLBACK NOTICE]:', dbErr.message);
        }
      }

      res.json(primaryCard);
    } catch (err) {
      console.error('[CLIENT PRIMARY PAYMENT PROFILE ERROR]:', err.message);
      res.json(null);
    }
  });

  // PUT /api/clients/:id/payment-method - Update or link a new payment card/token for client
  router.put('/:id/payment-method', async (req, res) => {
    try {
      const clientId = req.params.id;
      const { pwToken } = req.body;

      if (!pwToken) {
        return res.status(400).json({ success: false, error: 'Token de pago requerido.' });
      }

      const [clients] = await pool.query('SELECT * FROM clients WHERE id = ? OR cedula = ? LIMIT 1', [clientId, clientId]);
      if (clients.length === 0) {
        return res.status(404).json({ success: false, error: 'Cliente no encontrado.' });
      }
      const client = clients[0];

      let newPaymentProfileId = null;
      let cardBrand = 'VISA';
      let cardLast4 = '••••';
      let cardExp = '';

      if (client.cardnet_customer_id && !String(pwToken).startsWith('mock_')) {
        try {
          const activateRes = await axios.post(
            `${CARDNET_CONFIG.BASE_URL}/api/Customer/${client.cardnet_customer_id}/activate`,
            { Token: pwToken, ActivationCode: "" },
            { headers: getCardNetAuthHeaders(), timeout: CARDNET_CONFIG.TIMEOUT }
          );
          const custData = activateRes.data.Response || activateRes.data;
          const profiles = custData.PaymentProfiles || [];
          const match = profiles.find(p => p.Token === pwToken) || profiles[profiles.length - 1];
          if (match) {
            newPaymentProfileId = match.PaymentProfileId?.toString();
            cardBrand = match.Brand || 'VISA';
            cardLast4 = match.Last4 || '';
            cardExp = match.Expiration || '';
          }
        } catch (actErr) {
          console.warn('[CARDNET] Error activando token en CardNet:', actErr.message);
        }
      }

      if (!newPaymentProfileId) {
        newPaymentProfileId = String(pwToken).startsWith('mock_') ? `mock_profile_${Date.now()}` : `prof_${Date.now()}`;
      }

      // Update contracts table
      await pool.query(
        `UPDATE contracts 
         SET payment_profile_id = ?, card_token = ?, card_brand = COALESCE(?, card_brand), card_last4 = COALESCE(?, card_last4), card_expiration = COALESCE(?, card_expiration), status = 'Active', retry_count = 0, auto_billing_enabled = 1 
         WHERE client_id = ? OR client_id = ?`,
        [newPaymentProfileId, pwToken, cardBrand, cardLast4, cardExp, client.id, client.cedula]
      );

      // Ensure client status is Active
      await pool.query('UPDATE clients SET status = "Active" WHERE id = ?', [client.id]);

      res.json({
        success: true,
        message: 'Método de pago actualizado exitosamente.',
        paymentProfileId: newPaymentProfileId
      });
    } catch (err) {
      console.error('[UPDATE PAYMENT METHOD ERROR]:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = {
  createClientsRouter
};
