const express = require('express');
const axios = require('axios');

/**
 * CardNet Gateway & Customer Payment Profile Router
 * 
 * @param {import('mysql2/promise').Pool} pool
 * @param {Object} options
 */
function createCardnetRouter(pool, options = {}) {
  const router = express.Router();

  const CARDNET_CONFIG = options.CARDNET_CONFIG || {
    MERCHANT_NUMBER: process.env.CARDNET_MERCHANT_NUMBER,
    TERMINAL_ID: process.env.CARDNET_TERMINAL_ID,
    BASE_URL: process.env.CARDNET_BASE_URL,
    PUBLIC_KEY: process.env.CARDNET_PUBLIC_KEY,
    PRIVATE_KEY: process.env.CARDNET_PRIVATE_KEY,
    ENV: process.env.CARDNET_ENV,
    TIMEOUT: parseInt(process.env.CARDNET_TIMEOUT) || 30000
  };

  const getCardNetAuthHeaders = options.getCardNetAuthHeaders || (() => ({
    'Content-Type': 'application/json',
    'Authorization': `Basic ${CARDNET_CONFIG.PRIVATE_KEY}`
  }));

  const sendPaymentReceiptEmail = options.sendPaymentReceiptEmail;

  // Middleware de Log para depuración
  router.use((req, res, next) => {
    console.log(`[CARDNET DEBUG] ${req.method} ${req.url}`);
    next();
  });

  // === GATEWAY STATUS ENDPOINT ===
  router.get('/status', async (req, res) => {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      
      const urlObj = new URL(CARDNET_CONFIG.BASE_URL || 'https://labservicios.cardnet.com.do');
      
      const response = await fetch(urlObj.origin, {
        method: 'GET',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      const latency = Date.now() - start;
      
      res.json({
        success: true,
        active: true,
        env: CARDNET_CONFIG.ENV || 'TEST',
        latency,
        message: `La plataforma está conectada exitosamente al entorno de ${['PROD', 'PRODUCTION'].includes(CARDNET_CONFIG.ENV) ? 'producción' : 'pruebas'} de CardNet Dominicana.`
      });
    } catch (err) {
      const latency = Date.now() - start;
      res.json({
        success: false,
        active: false,
        env: CARDNET_CONFIG.ENV || 'TEST',
        latency: err.name === 'AbortError' ? 6000 : latency,
        error: err.message,
        message: 'No se pudo establecer conexión con el servidor de CardNet Dominicana.'
      });
    }
  });

  // 1. Create or Get Customer (Alias /session para compatibilidad)
  router.post(['/customer', '/session'], async (req, res) => {
    try {
      const { email, clientId } = req.body;

      if (!email && !clientId) {
        return res.status(400).json({
          success: false,
          error: 'Debe enviar email o clientId para crear/obtener sesión de CardNet.'
        });
      }

      let existingCustomerId = null;

      // 1. Buscar en DB si ya tenemos ID
      if (clientId) {
        const [rows] = await pool.query(
          'SELECT cardnet_customer_id FROM clients WHERE id = ?',
          [clientId]
        );
        if (rows.length > 0) existingCustomerId = rows[0].cardnet_customer_id;
      }

      // 2. Si existe, intentar recuperarlo directo
      if (existingCustomerId) {
        try {
          const response = await axios.get(
            `${CARDNET_CONFIG.BASE_URL}/api/Customer/${existingCustomerId}`,
            { headers: getCardNetAuthHeaders() }
          );
          const customer = response.data.Response || response.data;
          return res.json({
            success: true,
            customerId: customer.CustomerId,
            uniqueId: customer.UniqueID,
            captureUrl: customer.CaptureURL,
            publicKey: CARDNET_CONFIG.PUBLIC_KEY,
            merchantNumber: CARDNET_CONFIG.MERCHANT_NUMBER,
            merchantTerminal: CARDNET_CONFIG.TERMINAL_ID,
            fullResponse: customer
          });
        } catch (e) {
          console.warn('[CARDNET] Customer ID in DB failed, resetting in DB to regenerate: ', e.message);
          if (clientId) {
            await pool.query('UPDATE clients SET cardnet_customer_id = NULL WHERE id = ?', [clientId]);
          }
        }
      }

      // 3. Crear o Fetch por Email
      try {
        const response = await axios.post(
          `${CARDNET_CONFIG.BASE_URL}/api/Customer`,
          { Email: email || `user-${clientId}@salonpro.do`, Enable: 'true' },
          { headers: getCardNetAuthHeaders() }
        );
        const customer = response.data.Response || response.data;
        
        if (clientId && customer.CustomerId) {
          await pool.query('UPDATE clients SET cardnet_customer_id = ? WHERE id = ?', [customer.CustomerId.toString(), clientId]);
        }

        return res.json({
          success: true,
          customerId: customer.CustomerId,
          uniqueId: customer.UniqueID,
          captureUrl: customer.CaptureURL,
          publicKey: CARDNET_CONFIG.PUBLIC_KEY,
          merchantNumber: CARDNET_CONFIG.MERCHANT_NUMBER,
          merchantTerminal: CARDNET_CONFIG.TERMINAL_ID,
          fullResponse: customer
        });
      } catch (apiErr) {
        const errorData = apiErr.response?.data || {};
        if (errorData.ResponseCode === '13' || JSON.stringify(errorData).includes("already exists")) {
          const custId = errorData.Response?.CustomerId || errorData.CustomerId;
          if (custId) {
            const retryRes = await axios.get(
              `${CARDNET_CONFIG.BASE_URL}/api/Customer/${custId}`,
              { headers: getCardNetAuthHeaders() }
            );
            const finalCust = retryRes.data.Response || retryRes.data;
            if (clientId) {
              await pool.query('UPDATE clients SET cardnet_customer_id = ? WHERE id = ?', [finalCust.CustomerId.toString(), clientId]);
            }
            return res.json({
              success: true,
              customerId: finalCust.CustomerId,
              uniqueId: finalCust.UniqueID,
              captureUrl: finalCust.CaptureURL,
              publicKey: CARDNET_CONFIG.PUBLIC_KEY,
              merchantNumber: CARDNET_CONFIG.MERCHANT_NUMBER,
              merchantTerminal: CARDNET_CONFIG.TERMINAL_ID,
              fullResponse: finalCust
            });
          }
        }
        throw apiErr;
      }
    } catch (err) {
      console.error('[CARDNET SESSION ERROR]', err.response?.data || err.message);
      res.status(500).json({
        success: false,
        error: 'Error de sesión CardNet: ' + err.message,
        details: err.response?.data
      });
    }
  });

  // 2. Get Customer (to get CaptureURL + UniqueID)
  router.get('/customer/:customerId', async (req, res) => {
    try {
      const { customerId } = req.params;
      console.log('[CARDNET] Consulting Customer:', customerId);

      const response = await axios.get(
        `${CARDNET_CONFIG.BASE_URL}/api/Customer/${customerId}`,
        { headers: getCardNetAuthHeaders() }
      );

      const customer = response.data.Response || response.data;
      res.json(customer);
    } catch (err) {
      console.error('[CARDNET] Get Customer Error:', err.response?.data || err.message);
      res.status(500).json({ error: err.message, details: err.response?.data });
    }
  });

  // 3. Activate Payment Profile (Optional/Manual Activation)
  router.post('/customer/:customerId/activate', async (req, res) => {
    try {
      const { customerId } = req.params;
      const { token, activationCode } = req.body;
      console.log('[CARDNET] Activating Profile:', token);

      const response = await axios.post(
        `${CARDNET_CONFIG.BASE_URL}/api/Customer/${customerId}/activate`,
        { Token: token, ActivationCode: activationCode || "" },
        { headers: getCardNetAuthHeaders(), timeout: CARDNET_CONFIG.TIMEOUT }
      );

      const result = response.data.Response || response.data;
      res.json(result);
    } catch (err) {
      console.error('[CARDNET] Activate Error:', err.response?.data || err.message);
      res.status(500).json({ error: err.message, details: err.response?.data });
    }
  });

  // Update Profile
  router.post('/customer/:customerId/update-profile', async (req, res) => {
    try {
      const { customerId } = req.params;
      const { paymentProfileId, expiration, enable } = req.body;
      
      if (!customerId || customerId === 'undefined') {
        throw new Error("ID de cliente de CardNet no válido.");
      }

      const response = await axios.post(
        `${CARDNET_CONFIG.BASE_URL}/api/Customer/${customerId}/PaymentProfileUpdate`,
        { 
          PaymentProfileID: paymentProfileId,
          PaymentProfileId: paymentProfileId,
          Expiration: expiration,
          Enable: enable === undefined ? true : enable
        },
        { headers: getCardNetAuthHeaders() }
      );

      res.json(response.data.Response || response.data);
    } catch (err) {
      console.error('[CARDNET] Update Profile Error:', err.response?.data || err.message);
      res.status(500).json({ error: err.message, details: err.response?.data });
    }
  });

  // Delete Profile
  router.post('/customer/:customerId/delete-profile', async (req, res) => {
    try {
      const { customerId } = req.params;
      const { paymentProfileId } = req.body;
      console.log('[CARDNET] Deleting Profile:', paymentProfileId);

      const response = await axios.post(
        `${CARDNET_CONFIG.BASE_URL}/api/Customer/${customerId}/PaymentProfileDelete`,
        { 
          PaymentProfileID: paymentProfileId,
          PaymentProfileId: paymentProfileId 
        },
        { headers: getCardNetAuthHeaders() }
      );

      const result = response.data.Response || response.data;
      res.json(result);
    } catch (err) {
      console.error('[CARDNET] Delete Profile Error:', err.response?.data || err.message);
      res.status(500).json({ error: err.message, details: err.response?.data });
    }
  });

  // === COBRO AD-HOC (MANUAL) EN PERFIL DE PAGO GUARDADO ===
  router.post('/customer/:customerId/charge-profile', async (req, res) => {
    const { customerId } = req.params;
    const { paymentProfileId, amount, description, clientId } = req.body;
    
    console.log(`[CARDNET] Cobro Ad-Hoc manual solicitado para Cliente: ${clientId}, CustomerID: ${customerId}, ProfileID: ${paymentProfileId}, Monto: RD$ ${amount}`);
    
    try {
      const isProductionEnv = CARDNET_CONFIG.ENV === 'PRODUCTION';
      const isMockProfile = !isProductionEnv && 
                            (String(paymentProfileId || '').startsWith('mock_') || String(customerId || '').startsWith('mock_'));
      
      if (!paymentProfileId && !isMockProfile) {
        return res.status(400).json({
          success: false,
          error: "Debe seleccionar una tarjeta válida para realizar el cobro."
        });
      }

      let isApproved = false;
      let purchaseResult = null;
      
      if (isMockProfile) {
        isApproved = true;
        purchaseResult = {
          Transaction: {
            Status: "Approved",
            OrderNumber: `CN-MAN-${Date.now().toString().slice(-6)}`,
            RemoteId: `MAN-${Date.now().toString().slice(-6)}`,
            Description: "Aprobado (Modo Simulación local - Ambiente de Pruebas)"
          },
          ResponseCode: "00"
        };
        console.log("[CARDNET BYPASS] [ENTORNO TEST] Aprobando cobro manual simulado automáticamente.");
      } else {
        let tokenToCharge = paymentProfileId;
        let altToken = null;

        if (clientId) {
          try {
            const [cRows] = await pool.query(
              'SELECT card_token, payment_profile_id FROM contracts WHERE client_id = ? AND status != "Cancelled" ORDER BY id DESC LIMIT 1',
              [clientId]
            );
            if (cRows.length > 0 && cRows[0].card_token && !String(cRows[0].card_token).startsWith('mock_')) {
              tokenToCharge = cRows[0].card_token;
              altToken = cRows[0].payment_profile_id || paymentProfileId;
            }
          } catch (dbErr) {
            console.warn('[CARDNET] Error consultando contrato para token:', dbErr.message);
          }
        }

        if (customerId && (!tokenToCharge || /^\d+$/.test(String(tokenToCharge)))) {
          try {
            const custRes = await axios.get(
              `${CARDNET_CONFIG.BASE_URL}/api/Customer/${customerId}`,
              { headers: getCardNetAuthHeaders(), timeout: 8000 }
            );
            const fullCust = custRes.data.Response || custRes.data;
            const profiles = fullCust.PaymentProfiles || [];
            const matched = profiles.find(p => String(p.PaymentProfileId) === String(paymentProfileId)) || profiles[0];
            if (matched && matched.Token) {
              tokenToCharge = matched.Token;
              altToken = paymentProfileId;
            }
          } catch (apiGetErr) {
            console.warn('[CARDNET] No se pudo recuperar token desde perfil CardNet:', apiGetErr.message);
          }
        }

        const amountCents = Math.round(parseFloat(amount) * 100);
        const buildPayload = (tkn) => ({
          TrxToken: tkn,
          Order: `MAN-${Date.now().toString().slice(-6)}`,
          Amount: amountCents,
          Currency: "DOP",
          Capture: true,
          Description: description || `Cobro Manual PLAN BEAUTY`,
          CustomerIP: req.ip || "127.0.0.1",
          MerchantNumber: CARDNET_CONFIG.MERCHANT_NUMBER,
          MerchantTerminal: CARDNET_CONFIG.TERMINAL_ID,
          DataDo: { Tax: "0", Invoice: `INV-${Date.now().toString().slice(-6)}` }
        });

        console.log(`[CARDNET] Token seleccionado para cobro: ${tokenToCharge} (Alt: ${altToken})`);

        try {
          let response = await axios.post(
            `${CARDNET_CONFIG.BASE_URL}/api/Purchase`,
            buildPayload(tokenToCharge),
            { headers: getCardNetAuthHeaders(), timeout: 15000 }
          );

          purchaseResult = response.data.Response || response.data;
          if (response.data.Errors && response.data.Errors.length > 0) {
            purchaseResult = {
              ...purchaseResult,
              Errors: response.data.Errors,
              ResponseCode: response.data.Errors[0].ErrorCode,
              ResponseMessage: response.data.Errors[0].Message
            };
          }

          isApproved = purchaseResult.Transaction?.Status === "Approved" || 
                       purchaseResult.ResponseCode === "00" ||
                       purchaseResult.Transaction?.Steps?.some(s => s.ResponseCode === "00");

          const errorMsg = (purchaseResult.ResponseMessage || "").toLowerCase();
          if (!isApproved && altToken && altToken !== tokenToCharge && (errorMsg.includes('token') || errorMsg.includes('inválido') || errorMsg.includes('invalido'))) {
            console.log(`[CARDNET] Primer intento con ${tokenToCharge} falló por token. Reintentando con alternativo: ${altToken}`);
            try {
              response = await axios.post(
                `${CARDNET_CONFIG.BASE_URL}/api/Purchase`,
                buildPayload(altToken),
                { headers: getCardNetAuthHeaders(), timeout: 15000 }
              );
              purchaseResult = response.data.Response || response.data;
              if (response.data.Errors && response.data.Errors.length > 0) {
                purchaseResult = {
                  ...purchaseResult,
                  Errors: response.data.Errors,
                  ResponseCode: response.data.Errors[0].ErrorCode,
                  ResponseMessage: response.data.Errors[0].Message
                };
              }
              isApproved = purchaseResult.Transaction?.Status === "Approved" || 
                           purchaseResult.ResponseCode === "00" ||
                           purchaseResult.Transaction?.Steps?.some(s => s.ResponseCode === "00");
            } catch (altErr) {
              console.warn('[CARDNET] Falló reintento con token alternativo:', altErr.message);
            }
          }
          
          if (!isApproved && !isProductionEnv) {
            const desc = (purchaseResult.ResponseMessage || purchaseResult.Transaction?.Description || "").toUpperCase();
            if (desc.includes("TR005") || purchaseResult.ResponseCode === "TR005") {
              console.log("[CARDNET] Detectado TR005 en Sandbox durante cobro manual. Aplicando Bypass.");
              isApproved = true;
            }
          }
        } catch (apiErr) {
          console.error("[CARDNET] Error consultando API de CardNet:", apiErr.message);
          if (!isProductionEnv) {
            console.log("[CARDNET] Activando fallback local de contingencia en ambiente de pruebas.");
            isApproved = true;
            purchaseResult = {
              Transaction: {
                Status: "Approved",
                OrderNumber: `CN-CONT-${Date.now().toString().slice(-6)}`,
                RemoteId: `CONT-${Date.now().toString().slice(-6)}`,
                Description: "Aprobado por contingencia local (ambiente de pruebas)"
              },
              ResponseCode: "00"
            };
          } else {
            throw new Error("No se pudo conectar con la pasarela de pagos CardNet para procesar la transacción. Intente nuevamente.");
          }
        }
      }

      const payId = `PAY-MAN-${Date.now()}`;

      if (isApproved) {
        const gatewayRef = purchaseResult?.Transaction?.OrderNumber || purchaseResult?.Transaction?.RemoteId || `CN-${Date.now().toString().slice(-6)}`;
        let targetSalonId = 1;
        if (clientId) {
          const [cRows] = await pool.query('SELECT salon_id FROM contracts WHERE client_id = ? LIMIT 1', [clientId]);
          if (cRows.length > 0 && cRows[0].salon_id) targetSalonId = cRows[0].salon_id;
          else {
            const [clRows] = await pool.query('SELECT salon_id FROM clients WHERE id = ? LIMIT 1', [clientId]);
            if (clRows.length > 0 && clRows[0].salon_id) targetSalonId = clRows[0].salon_id;
          }
        }

        await pool.query(
          'INSERT INTO payments (id, client_id, plan_id, amount, method, status, gateway_ref, description, salon_id, applied_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [payId, clientId || null, null, amount, 'Tarjeta_Guardada', 'Aprobado', gatewayRef, description || 'Cobro Manual de Suscripción', targetSalonId, 'Admin']
        );

        if (clientId) {
          await pool.query('UPDATE clients SET status = "Active" WHERE id = ?', [clientId]);
          const [contracts] = await pool.query('SELECT id, plan_id FROM contracts WHERE client_id = ? LIMIT 1', [clientId]);
          if (contracts.length > 0) {
            const intervalUnit = CARDNET_CONFIG.ENV === 'PRODUCTION' ? 'MONTH' : 'HOUR';
            await pool.query(
              `UPDATE contracts SET status = "Active", retry_count = 0, last_billed_date = NOW(), next_billing_date = DATE_ADD(NOW(), INTERVAL 1 ${intervalUnit}) WHERE id = ?`,
              [contracts[0].id]
            );
          }

          // Enviar Factura Electrónica DGII (e-CF) al correo del cliente
          try {
            const [cRows] = await pool.query('SELECT nombre, email, cedula, rnc FROM clients WHERE id = ? OR cedula = ? LIMIT 1', [clientId, clientId]);
            if (cRows.length > 0 && cRows[0].email && sendPaymentReceiptEmail) {
              sendPaymentReceiptEmail(clientId, cRows[0].nombre, cRows[0].email, amount, description || 'Cobro de Membresía / Plan Beauty', gatewayRef);
            }
          } catch (emailErr) {
            console.error('[CARDNET CHARGE EMAIL NOTICE]:', emailErr.message);
          }
        }

        res.json({ 
          success: true, 
          ResponseCode: "00", 
          Status: "Approved", 
          AuthorizationCode: purchaseResult?.Transaction?.RemoteId || "MOCK_AUTH",
          purchaseResult 
        });
      } else {
        await pool.query(
          'INSERT INTO payments (id, client_id, plan_id, amount, method, status, description, cardnet_raw_response) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [payId, clientId || null, null, amount, 'Tarjeta_Guardada', 'Rechazado', description || 'Cobro Manual Fallido', JSON.stringify(purchaseResult)]
        );

        if (clientId) {
          await pool.query('UPDATE clients SET status = "Inactive" WHERE id = ?', [clientId]);

          const [contracts] = await pool.query('SELECT id, retry_count FROM contracts WHERE client_id = ? LIMIT 1', [clientId]);
          if (contracts.length > 0) {
            const contract = contracts[0];
            const newRetryCount = contract.retry_count + 1;
            
            let newStatus = 'Pending_Retry';
            if (newRetryCount >= 90) {
              newStatus = 'Suspended';
            }

            const isProductionEnv = CARDNET_CONFIG.ENV === 'PRODUCTION';
            const nextRetrySql = isProductionEnv
              ? `CONCAT(DATE(DATE_ADD(NOW(), INTERVAL 1 DAY)), ' 17:00:00')`
              : `DATE_ADD(NOW(), INTERVAL 5 MINUTE)`;

            await pool.query(
              `UPDATE contracts SET status = ?, retry_count = ?, next_retry_date = ${nextRetrySql} WHERE id = ?`,
              [newStatus, newRetryCount, contract.id]
            );
            
            console.log(`[RETRY ENG] Cobro manual fallido de cliente: ${clientId}. Contrato establecido a ${newStatus} (Intento ${newRetryCount}/90)`);
          }
        }

        res.json({
          success: false,
          ResponseCode: purchaseResult?.ResponseCode || "05",
          Message: purchaseResult?.ResponseMessage || purchaseResult?.Transaction?.Description || 'El cobro fue declinado por el banco.',
          purchaseResult
        });
      }
    } catch (err) {
      console.error('[CARDNET] Error en cobro manual:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 4. Process Purchase (Pagar)
  router.post('/purchase', async (req, res) => {
    try {
      const { trxToken, amount, order, description, tax, invoice, customerIp } = req.body;
      console.log('[CARDNET] Processing Purchase:', amount, order);

      const payload = {
        TrxToken: trxToken,
        Order: order || `ORD-${Date.now()}`,
        Amount: Math.round(parseFloat(amount) * 100),
        Currency: "DOP",
        Capture: true,
        Description: description || "Cobro SalonPro",
        CustomerIP: customerIp || "127.0.0.1",
        MerchantNumber: CARDNET_CONFIG.MERCHANT_NUMBER,
        MerchantTerminal: CARDNET_CONFIG.TERMINAL_ID,
        DataDo: {
          Tax: "0",
          Invoice: `INV-${Date.now().toString().slice(-6)}`
        }
      };

      console.log('[CARDNET] Enviando Payload de Compra:', JSON.stringify(payload, null, 2));

      const response = await axios.post(
        `${CARDNET_CONFIG.BASE_URL}/api/Purchase`,
        payload,
        { headers: getCardNetAuthHeaders() }
      );

      const result = response.data.Response || response.data;
      res.json(result);
    } catch (err) {
      console.error('[CARDNET] Purchase Error:', err.response?.data || err.message);
      res.status(500).json({ error: err.message, details: err.response?.data });
    }
  });

  return router;
}

module.exports = { createCardnetRouter };
