const express = require('express');
const nodemailer = require('nodemailer');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

/**
 * Utility function to send satisfaction survey email to client (Scoped by tenant_id)
 */
async function sendSurveyEmail(pool, clientId, clientName, clientEmail, tenantId) {
  console.log(`[Survey Email] Preparing to send to ${clientEmail} (Client: ${clientId}, Tenant: ${tenantId})`);
  try {
    let settingsQuery = 'SELECT * FROM email_settings';
    const params = [];
    if (tenantId) {
      settingsQuery += ' WHERE tenant_id = ?';
      params.push(tenantId);
    }
    settingsQuery += ' ORDER BY id ASC LIMIT 1';

    const [settings] = await pool.query(settingsQuery, params);
    if (settings.length === 0 || !settings[0].smtp_host) {
      console.warn("[Survey Email] No SMTP settings found.");
      return;
    }

    const s = settings[0];
    if (!tenantId) {
      console.warn('[Survey Email] tenantId is required for client lookup. Skipped.');
      return;
    }

    const [clients] = await pool.query(
      'SELECT id, cedula, nombre, email FROM clients WHERE (id = ? OR cedula = ?) AND tenant_id = ? LIMIT 1',
      [clientId, clientId, tenantId]
    );
    const foundClient = clients.length > 0 ? clients[0] : null;
    const clientCedula = foundClient?.cedula || clientId;
    const finalName = clientName || foundClient?.nombre || 'Estimada clienta';
    const finalEmail = clientEmail || foundClient?.email;

    if (!finalEmail) {
      console.warn(`[Survey Email] No email available for client ${clientId}. Skipped.`);
      return;
    }

    const pendingId = Date.now().toString();
    // Insert new pending survey record or ensure it exists with Pending status (scoped by tenant)
    await pool.query(
      `INSERT INTO pending_surveys (id, tenant_id, client_id, status, created_at) 
       VALUES (?, ?, ?, 'Pending', NOW()) 
       ON CONFLICT (id) DO UPDATE SET status = 'Pending', created_at = NOW()`,
      [pendingId, tenantId || null, clientId]
    );

    const transporter = nodemailer.createTransport({
      host: s.smtp_host,
      port: parseInt(s.smtp_port),
      secure: parseInt(s.smtp_port) === 465,
      auth: { user: s.smtp_user, pass: s.smtp_pass },
      tls: { rejectUnauthorized: false },
      family: 4
    });

    const portalLink = `https://planbeautyrd.com/encuesta?cedula=${encodeURIComponent(clientCedula)}`;

    const senderBrand = s.smtp_from || 'SalonPro / Plan Beauty';

    await transporter.sendMail({
      from: `"${senderBrand}" <${s.smtp_user}>`,
      to: finalEmail,
      subject: `✨ Cuéntanos tu experiencia en ${senderBrand}`,
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; background-color: #ffffff;">
          <div style="background-color: #000000; padding: 40px 30px; text-align: center;">
            <p style="color: #ffffff; text-transform: uppercase; font-size: 11px; letter-spacing: 2px; margin: 0 0 8px 0; font-weight: 700;">${senderBrand}</p>
            <h1 style="margin: 0; font-size: 24px; color: #ffffff !important; font-weight: 900;">¡Gracias por visitarnos!</h1>
          </div>
          <div style="padding: 30px; color: #1e293b; line-height: 1.6;">
            <p style="color: #1e293b; font-size: 16px;">Hola <strong>${finalName}</strong>,</p>
            <p style="color: #1e293b;">Gracias por confiar en <strong>${senderBrand}</strong>. Fue un verdadero placer atenderte y brindarte la mejor experiencia de belleza ✨</p>
            <p style="color: #1e293b;">Tu opinión es sumamente importante para nosotros y nos ayuda a perfeccionar cada detalle de nuestro servicio.</p>
            <p style="color: #1e293b;">Por favor, tómate un minuto para completar nuestra breve encuesta de satisfacción:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${portalLink}" style="background-color: #000000; color: #ffffff !important; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: 800; display: inline-block; font-size: 15px; letter-spacing: 0.5px;">Completar Encuesta</a>
            </div>
            <p style="color: #64748b; font-size: 0.85rem; word-break: break-all;">Si el botón no funciona, copia y pega este enlace en tu navegador:<br><a href="${portalLink}" style="color: #000000;">${portalLink}</a></p>
            <p style="margin-top: 40px; border-top: 1px solid #f1f5f9; padding-top: 20px; font-size: 0.9rem; color: #64748b;">
              Atentamente,<br>
              <strong>Equipo ${senderBrand}</strong>
            </p>
          </div>
        </div>
      `
    });
    console.log(`[SURVEY] Email sent and record created for ${finalEmail}`);
  } catch (err) {
    console.error('[SURVEY ERROR]', err.message);
  }
}

/**
 * Creates router for Surveys and Gift Cards (Scoped strictly by tenant_id)
 * 
 * @param {import('mysql2/promise').Pool} pool
 * @param {Object} helpers
 */
function createGiftsSurveysRouter(pool, helpers = {}) {
  const router = express.Router();
  const { CARDNET_CONFIG, getCardNetAuthHeaders } = helpers;

  // === SURVEYS STATS & REPORTING ===
  router.get('/surveys/stats', async (req, res) => {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Autenticación requerida para estadísticas de encuestas.' });
    }

    const { startDate, endDate, salonId, staffName, clientId } = req.query;
    
    try {
      const queryParams = [tenantId];
      let querySql = `
        SELECT s.*, 
               COALESCE(s.client_name, c.nombre) as client_name,
               COALESCE(s.salon_name, sal.name) as salon_name
        FROM surveys s
        LEFT JOIN clients c ON s.client_id = c.id AND c.tenant_id = s.tenant_id
        LEFT JOIN salons sal ON s.salon_id = sal.id AND sal.tenant_id = s.tenant_id
        WHERE s.tenant_id = ?
      `;

      if (startDate) { querySql += ' AND s.created_at >= ?'; queryParams.push(startDate); }
      if (endDate) { querySql += ' AND s.created_at <= ?'; queryParams.push(endDate + ' 23:59:59'); }
      if (salonId && salonId !== 'all') { querySql += ' AND s.salon_id = ?'; queryParams.push(parseInt(salonId)); }
      if (staffName) { querySql += ' AND (s.staff_peluquera = ? OR s.staff_lava_pelo = ? OR s.staff_manicurista = ?)'; queryParams.push(staffName, staffName, staffName); }
      if (clientId) { querySql += ' AND s.client_id = ?'; queryParams.push(clientId); }

      const [rows] = await pool.query(querySql.replace(/\s+/g, ' '), queryParams);
      
      let sentQuery = `
        SELECT COUNT(ps.id) as sent_count 
        FROM pending_surveys ps
        LEFT JOIN (
          SELECT v1.client_id, v1.salon_id, v1.empleado_peluquera, v1.empleado_lava_pelo, v1.empleado_manicurista
          FROM visits v1
          INNER JOIN (
            SELECT client_id, MAX(visited_at) as max_visited_at
            FROM visits
            WHERE tenant_id = ?
            GROUP BY client_id
          ) v2 ON v1.client_id = v2.client_id AND v1.visited_at = v2.max_visited_at
          WHERE v1.tenant_id = ?
        ) last_v ON ps.client_id = last_v.client_id
        WHERE ps.tenant_id = ?
      `.replace(/\s+/g, ' ');

      const sentParams = [tenantId, tenantId, tenantId];
      if (startDate) { sentQuery += ' AND ps.created_at >= ?'; sentParams.push(startDate); }
      if (endDate) { sentQuery += ' AND ps.created_at <= ?'; sentParams.push(endDate + ' 23:59:59'); }
      if (clientId) { sentQuery += ' AND ps.client_id = ?'; sentParams.push(clientId); }
      if (salonId && salonId !== 'all') { sentQuery += ' AND last_v.salon_id = ?'; sentParams.push(parseInt(salonId)); }
      if (staffName) { sentQuery += ' AND (last_v.empleado_peluquera = ? OR last_v.empleado_lava_pelo = ? OR last_v.empleado_manicurista = ?)'; sentParams.push(staffName, staffName, staffName); }
      
      const [sentRows] = await pool.query(sentQuery, sentParams);
      const sent_count = sentRows[0]?.sent_count || 0;

      if (rows.length === 0) {
        return res.json({ nps: 0, averages: {}, total: 0, raw: [], sent_count, answered_count: 0 });
      }

      const calculateNPS = (values) => {
        let p = 0, d = 0, t = 0;
        values.forEach(v => {
          const val = parseInt(v);
          if (isNaN(val)) return;
          if (val >= 9) p++;
          else if (val <= 6) d++;
          t++;
        });
        return t > 0 ? parseFloat(((p - d) / t * 100).toFixed(2)) : 0;
      };

      const allScores = [];
      rows.forEach(r => {
        const p_vals = [
          r.q1, 
          r.q2, 
          r.staff_peluquera !== 'N/A' ? r.q3 : null,
          r.staff_lava_pelo !== 'N/A' ? r.q4 : null,
          r.staff_manicurista !== 'N/A' ? r.q5 : null,
          r.q7, 
          r.q8
        ].map(v => parseInt(v)).filter(v => v !== null && !isNaN(v) && v >= 0);
        
        allScores.push(...p_vals);
      });

      const npsGlobal = calculateNPS(allScores);
      
      const questions = ['q1', 'q2', 'q3', 'q4', 'q5', 'q7', 'q8'];
      const averages = {};
      const npsPerQuestion = {};

      questions.forEach(q => {
        const vals = rows.map(r => {
          if (q === 'q3' && r.staff_peluquera === 'N/A') return null;
          if (q === 'q4' && r.staff_lava_pelo === 'N/A') return null;
          if (q === 'q5' && r.staff_manicurista === 'N/A') return null;
          return parseInt(r[q]);
        }).filter(v => v !== null && !isNaN(v) && v >= 0);
        
        const sum = vals.reduce((a, b) => a + b, 0);
        averages[q] = vals.length > 0 ? (sum / vals.length).toFixed(1) : 0;
        npsPerQuestion[q] = calculateNPS(vals);
      });

      res.json({
        nps: npsGlobal,
        npsPerQuestion,
        averages,
        total: rows.length,
        sent_count,
        answered_count: rows.length,
        raw: rows.map(r => {
          const p_vals = [
            r.q1, 
            r.q2, 
            r.staff_peluquera !== 'N/A' ? r.q3 : null,
            r.staff_lava_pelo !== 'N/A' ? r.q4 : null,
            r.staff_manicurista !== 'N/A' ? r.q5 : null,
            r.q7, 
            r.q8
          ].map(v => parseInt(v)).filter(v => v !== null && !isNaN(v) && v >= 0);
          
          let p = 0, d = 0, t = 0;
          p_vals.forEach(v => {
            if (v >= 9) p++;
            else if (v <= 6) d++;
            t++;
          });
          const personalNps = t > 0 ? parseFloat(((p - d) / t * 100).toFixed(2)) : 0;
          return { ...r, personalNps };
        })
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/surveys', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const [rows] = await pool.query('SELECT * FROM surveys WHERE tenant_id = ?', [tenantId]);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/surveys/pending/:clientId', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { clientId } = req.params;
      const cleanCedula = String(clientId).replace(/\D/g, '');
      const [rows] = await pool.query(
        `SELECT ps.id 
         FROM pending_surveys ps
         LEFT JOIN clients c ON ps.client_id = c.id AND c.tenant_id = ps.tenant_id
         WHERE ps.tenant_id = ?
           AND (ps.client_id = ? OR ps.client_id = ? OR c.cedula = ? OR REPLACE(c.cedula, '-', '') = ?)
           AND ps.status = 'Pending' 
         ORDER BY ps.created_at DESC LIMIT 1`,
        [tenantId, clientId, cleanCedula, clientId, cleanCedula]
      );
      res.json({ hasPending: rows.length > 0 });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Manual dispatch or resend survey endpoint
  router.post('/surveys/send', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { clientId, clientName, clientEmail } = req.body;
      if (!clientId && !clientEmail) {
        return res.status(400).json({ error: 'Se requiere especificar clientId o clientEmail' });
      }

      let targetEmail = clientEmail;
      let targetName = clientName;
      let targetId = clientId;

      if (!targetEmail && clientId) {
        const cleanCedula = String(clientId).replace(/\D/g, '');
        const [c] = await pool.query(
          `SELECT id, nombre, email, cedula FROM clients 
           WHERE tenant_id = ? AND (id = ? OR cedula = ? OR REPLACE(cedula, '-', '') = ?) LIMIT 1`,
          [tenantId, clientId, clientId, cleanCedula]
        );
        if (c.length > 0) {
          targetEmail = c[0].email;
          targetName = targetName || c[0].nombre;
          targetId = c[0].id;
        }
      }

      if (!targetEmail || !targetEmail.trim()) {
        return res.status(400).json({ error: 'La clienta no tiene un correo electrónico registrado válido' });
      }

      await sendSurveyEmail(pool, targetId || 'INVITADO', targetName || 'Estimada clienta', targetEmail.trim(), tenantId);
      res.json({ success: true, message: `Encuesta de satisfacción enviada con éxito a ${targetEmail.trim()}` });
    } catch (err) {
      console.error('[API RESEND SURVEY ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/surveys', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const id = Date.now().toString();
      const { clientId, responses } = req.body;
      const cleanCedula = clientId ? String(clientId).replace(/\D/g, '') : '';

      const [visits] = await pool.query(
        'SELECT salon_id, empleado_peluquera, empleado_lava_pelo, empleado_manicurista FROM visits WHERE tenant_id = ? AND (client_id = ? OR client_id = ?) ORDER BY visited_at DESC LIMIT 1',
        [tenantId, clientId, cleanCedula]
      );
      
      const v = visits[0] || {};

      await pool.query(
        'INSERT INTO surveys (id, tenant_id, client_id, client_name, salon_id, salon_name, staff_peluquera, staff_lava_pelo, staff_manicurista, q1, q2, q3, q4, q5, q6, q7, q8) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          id, tenantId, clientId, responses.clientName || 'Cliente', 
          v.salon_id || 1, responses.salonName || 'San Vicente',
          v.empleado_peluquera || 'N/A', v.empleado_lava_pelo || 'N/A', v.empleado_manicurista || 'N/A',
          responses.q1, responses.q2, responses.q3, responses.q4, responses.q5, responses.q6, responses.q7, responses.q8
        ]
      );

      await pool.query(
        `UPDATE pending_surveys ps
         SET ps.status = 'Completed' 
         FROM clients c
         WHERE ps.tenant_id = $1
           AND c.tenant_id = $1
           AND ps.client_id = c.id
           AND (ps.client_id = $2 OR ps.client_id = $3 OR c.cedula = $2 OR REPLACE(c.cedula, '-', '') = $3) 
           AND ps.status = 'Pending'`,
        [tenantId, clientId, cleanCedula]
      );

      res.json({ id, success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // === GIFTS REDEMPTION & PURCHASE ===
  router.post('/gifts/redeem', async (req, res) => {
    const tenantId = req.tenantId;
    const { giftCode } = req.body;
    try {
      const [rows] = await pool.query('SELECT * FROM gift_cards WHERE code = ? AND tenant_id = ?', [giftCode, tenantId]);
      if (rows.length === 0) return res.status(404).json({ error: 'Código no encontrado en este salón' });
      
      const gift = rows[0];
      if (gift.status !== 'Active' && gift.status !== 'Partially_Redeemed') {
        return res.status(400).json({ error: 'Este certificado ya no está activo' });
      }
      
      const amountToRedeem = gift.balance;
      const newBalance = 0;
      const newStatus = 'Redeemed';
      
      await pool.query(
        'UPDATE gift_cards SET balance = ?, status = ?, used_at = NOW() WHERE id = ? AND tenant_id = ?', 
        [newBalance, newStatus, gift.id, tenantId]
      );

      await pool.query(
        'INSERT INTO gift_card_logs (tenant_id, gift_card_id, amount_redeemed, balance_before, balance_after) VALUES (?, ?, ?, ?, ?)',
        [tenantId, gift.id, amountToRedeem, gift.balance, newBalance]
      );

      res.json({ success: true, message: 'Certificado canjeado exitosamente' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/gifts/purchase', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { clientId, amount, details, pwToken } = req.body;
      
      let persistentToken = pwToken;
      const [clients] = await pool.query('SELECT * FROM clients WHERE id = ? AND tenant_id = ?', [clientId, tenantId]);
      const client = clients[0];
      if (!client) {
        return res.status(404).json({ error: 'Cliente no encontrado en este salón.' });
      }
      const cardnetCustomerId = client?.cardnet_customer_id;

      if (pwToken && !String(pwToken).startsWith('mock_')) {
        if (cardnetCustomerId && CARDNET_CONFIG) {
          try {
            console.log(`[CARDNET GIFT] Activando token: ${pwToken} para cliente: ${cardnetCustomerId}`);
            const activateRes = await axios.post(
              `${CARDNET_CONFIG.BASE_URL}/api/Customer/${cardnetCustomerId}/activate`,
              { Token: pwToken, ActivationCode: "" },
              { headers: getCardNetAuthHeaders ? getCardNetAuthHeaders() : {}, timeout: CARDNET_CONFIG.TIMEOUT }
            );
            
            const custData = activateRes.data.Response || activateRes.data;
            const profiles = custData.PaymentProfiles || [];
            
            const match = profiles.find(p => p.Token === pwToken) || profiles[profiles.length - 1];

            if (match) {
              persistentToken = match.Token;
              await pool.query(
                'UPDATE contracts SET payment_profile_id = ?, card_token = ? WHERE client_id = ? AND tenant_id = ?',
                [match.PaymentProfileId?.toString(), match.Token, clientId, tenantId]
              );
            }
          } catch (actErr) {
            console.warn('[CARDNET GIFT] Aviso en activación:', actErr.message);
          }
        }
      }

      if (!persistentToken) {
        if (!cardnetCustomerId) {
          return res.status(400).json({ error: 'NoSavedCard', message: 'No hay tarjeta guardada.' });
        }

        const [contracts] = await pool.query('SELECT card_token FROM contracts WHERE client_id = ? AND tenant_id = ? AND card_token IS NOT NULL ORDER BY signed_at DESC LIMIT 1', [clientId, tenantId]);
        if (contracts.length > 0 && contracts[0].card_token) {
          persistentToken = contracts[0].card_token;
        } else if (CARDNET_CONFIG && getCardNetAuthHeaders) {
          try {
            const customerRes = await axios.get(
              `${CARDNET_CONFIG.BASE_URL}/api/Customer/${cardnetCustomerId}`,
              { headers: getCardNetAuthHeaders() }
            );
            const fullCust = customerRes.data.Response || customerRes.data;
            const profiles = fullCust.PaymentProfiles || [];
            if (profiles.length > 0) {
              const activeProfile = profiles.find(p => p.Enabled) || profiles[0];
              persistentToken = activeProfile.Token;
            }
          } catch (e) {
            console.error("Error consultando perfiles en CardNet:", e.message);
          }
        }
      }

      if (!persistentToken) {
        return res.status(400).json({ error: 'NoSavedCard', message: 'No se encontró un token válido para cobrar.' });
      }

      let cleanToken = persistentToken;
      if (typeof persistentToken === 'object' && persistentToken.TokenId) {
        cleanToken = persistentToken.TokenId;
      } else if (typeof persistentToken === 'string' && persistentToken.startsWith('{')) {
        try {
          const parsed = JSON.parse(persistentToken);
          cleanToken = parsed.TokenId || persistentToken;
        } catch (e) {}
      }

      const finalAmountCents = Math.round(parseFloat(amount) * 100);

      const purchasePayload = {
        TrxToken: cleanToken,
        Order: `INIT-${Date.now().toString().slice(-6)}`,
        Amount: finalAmountCents,
        Currency: "DOP",
        Capture: true,
        Description: `Activación GiftCard + RD$ 800 Fee`,
        CustomerIP: req.ip || "127.0.0.1",
        MerchantNumber: CARDNET_CONFIG?.MERCHANT_NUMBER,
        MerchantTerminal: CARDNET_CONFIG?.TERMINAL_ID,
        DataDo: { Tax: "0", Invoice: `INV-${Date.now().toString().slice(-6)}` }
      };

      const purchaseRes = await axios.post(
        `${CARDNET_CONFIG?.BASE_URL}/api/Purchase`,
        purchasePayload,
        { headers: getCardNetAuthHeaders ? getCardNetAuthHeaders() : {} }
      );

      const purchaseResult = purchaseRes.data.Response || purchaseRes.data;
      const isProductionEnv = CARDNET_CONFIG?.ENV === 'PRODUCTION';
      const isApproved = purchaseResult.Transaction?.Status === "Approved" || 
                         purchaseResult.ResponseCode === "00" ||
                         purchaseResult.Transaction?.Steps?.some(s => s.ResponseCode === "00") ||
                         (!isProductionEnv && ((purchaseResult.ResponseMessage || purchaseResult.Transaction?.Description || "").toUpperCase().includes("TR005") || purchaseResult.ResponseCode === "TR005")); 

      if (!isApproved) {
         throw new Error(`Tarjeta declinada: ${purchaseResult?.ResponseMessage || purchaseResult?.Transaction?.Description || "Error de conexión"}`);
      }

      const giftCode = `GIFT-${Math.floor(100000 + Math.random() * 899999)}`;
      const paymentId = `PAY-GIFT-${Date.now()}`;
      
      const gatewayRef = purchaseResult?.Transaction?.OrderNumber || purchaseResult?.Transaction?.RemoteId || `GIFT-${Date.now().toString().slice(-6)}`;
      await pool.query(
        'INSERT INTO payments (id, tenant_id, client_id, plan_id, amount, method, status, gateway_ref, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [paymentId, tenantId, clientId, 'gift_card', amount, 'CardNet_Saved_Card', 'Aprobado', gatewayRef, `Compra de GiftCard para: ${details?.to || 'Invitado'}`]
      );

      await pool.query(
        'INSERT INTO gift_cards (tenant_id, code, amount, balance, client_id, recipient_name, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [tenantId, giftCode, amount, amount, clientId, details?.to || 'Invitado', 'Active']
      );

      res.json({ success: true, paymentId, giftCode });

    } catch (err) {
      console.error('Gift purchase error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Admin endpoints for Gift Cards
  router.get('/admin/gifts', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const [cards] = await pool.query(`
        SELECT g.*, c.nombre as purchaser_name 
        FROM gift_cards g 
        LEFT JOIN clients c ON g.client_id = c.id AND c.tenant_id = g.tenant_id
        WHERE g.tenant_id = ?
        ORDER BY g.created_at DESC
      `, [tenantId]);
      res.json(cards);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/admin/gifts/:id/logs', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const [logs] = await pool.query(
        'SELECT * FROM gift_card_logs WHERE gift_card_id = ? AND tenant_id = ? ORDER BY created_at DESC',
        [req.params.id, tenantId]
      );
      res.json(logs);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/admin/gifts/redeem', async (req, res) => {
    const tenantId = req.tenantId;
    const { code, amount } = req.body;
    try {
      const [cards] = await pool.query('SELECT * FROM gift_cards WHERE code = ? AND tenant_id = ?', [code, tenantId]);
      if (cards.length === 0) return res.status(404).json({ error: 'Código no encontrado en este salón' });
      
      const card = cards[0];
      if (card.status !== 'Active' && card.status !== 'Partially_Redeemed') {
        return res.status(400).json({ error: 'Esta tarjeta no está activa' });
      }
      
      if (Number(card.balance) < Number(amount)) {
        return res.status(400).json({ error: 'Saldo insuficiente' });
      }
      
      const newBalance = Number(card.balance) - Number(amount);
      const newStatus = newBalance <= 0 ? 'Redeemed' : 'Partially_Redeemed';
      
      await pool.query(
        'UPDATE gift_cards SET balance = ?, status = ? WHERE code = ? AND tenant_id = ?',
        [newBalance, newStatus, code, tenantId]
      );

      await pool.query(
        'INSERT INTO gift_card_logs (tenant_id, gift_card_id, amount_redeemed, balance_before, balance_after) VALUES (?, ?, ?, ?, ?)',
        [tenantId, card.id, amount, card.balance, newBalance]
      );
      
      res.json({ success: true, newBalance, status: newStatus });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Client Gift Card access (scoped by tenant)
  router.get('/gifts', async (req, res) => {
    const tenantId = req.tenantId;
    const { clientId, code } = req.query;
    try {
      let query = 'SELECT * FROM gift_cards WHERE tenant_id = ?';
      let params = [tenantId];
      if (clientId) {
        query += ' AND client_id = ?';
        params.push(clientId);
      } else if (code) {
        query += ' AND code = ?';
        params.push(code);
      }
      query += ' ORDER BY created_at DESC';
      const [rows] = await pool.query(query, params);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/gifts/send-email', async (req, res) => {
    const tenantId = req.tenantId;
    const { recipientEmail, giftDetails, giftCode } = req.body;
    
    try {
      const [settings] = await pool.query('SELECT * FROM email_settings WHERE tenant_id = ? LIMIT 1', [tenantId]);
      if (settings.length === 0) {
        return res.status(400).json({ error: 'Configuración de correo no encontrada para este salón' });
      }
      
      const s = settings[0];
      const transporter = nodemailer.createTransport({
        host: s.smtp_host, port: s.smtp_port, secure: s.smtp_port == 465,
        auth: { user: s.smtp_user, pass: s.smtp_pass }
      });

      await transporter.sendMail({
        from: `"${s.smtp_from || 'Plan Beauty'}" <${s.smtp_user}>`,
        to: recipientEmail,
        subject: `¡Un Regalo Especial para ti! 🎁`,
        html: `
          <div style="font-family: sans-serif; padding: 20px;">
            <h2>¡Has recibido un Regalo Especial!</h2>
            <p>ID: <strong>${giftCode}</strong></p>
            <p>De: ${giftDetails?.from || 'Alguien especial'}</p>
            <p>Para: ${giftDetails?.to || ''}</p>
          </div>
        `
      });

      res.json({ success: true, message: 'Correo enviado al destinatario exitosamente' });
    } catch (err) {
      console.error('[GIFT EMAIL ERROR]', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createGiftsSurveysRouter, sendSurveyEmail };
