const express = require('express');
const axios = require('axios');

function createTestRouter(pool, { CARDNET_CONFIG, getCardNetAuthHeaders }) {
  const router = express.Router();

  router.post('/force-retry', async (req, res) => {
    const { clientId } = req.body;
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(403).json({ error: 'Contexto de salón requerido.' });
    }

    try {
      const [result] = await pool.query(
        "UPDATE contracts SET status = 'Pending_Retry', retry_count = 1, next_retry_date = DATE_SUB(NOW(), INTERVAL 5 MINUTE) WHERE client_id = ? AND tenant_id = ?",
        [clientId, tenantId]
      );
      res.json({ success: true, message: `Contrato ${clientId} listo para reintento.`, affectedRows: result.affectedRows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/manual-charge', async (req, res) => {
    const { clientId, amount } = req.body;
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(403).json({ error: 'Contexto de salón requerido.' });
    }

    try {
      const [contracts] = await pool.query(
        "SELECT card_token, id FROM contracts WHERE client_id = ? AND tenant_id = ? AND status = 'Active' LIMIT 1",
        [clientId, tenantId]
      );

      if (!contracts[0]?.card_token) {
        return res.status(404).json({ error: "No se encontró un token de tarjeta activo para este cliente." });
      }

      const token = contracts[0].card_token;
      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ error: "El monto debe ser un número válido mayor a 0." });
      }
      const amountCents = Math.round(parsedAmount * 100);

      const purchasePayload = {
        TrxToken: token,
        Order: `TEST-${Date.now().toString().slice(-6)}`,
        Amount: amountCents,
        Currency: "DOP",
        Capture: true,
        Description: `Cobro de Prueba Manual RD$ ${amount}`,
        CustomerIP: req.ip || "127.0.0.1",
        MerchantNumber: CARDNET_CONFIG.MERCHANT_NUMBER,
        MerchantTerminal: CARDNET_CONFIG.TERMINAL_ID,
        DataDo: { Tax: "0", Invoice: `INV-${Date.now().toString().slice(-6)}` }
      };

      const purchaseRes = await axios.post(
        `${CARDNET_CONFIG.BASE_URL}/api/Purchase`,
        purchasePayload,
        { headers: getCardNetAuthHeaders() }
      );

      res.json({
        success: purchaseRes.data.Response?.Transaction?.Status === "Approved" || purchaseRes.data.ResponseCode === "00",
        cardnet_response: purchaseRes.data,
        message: "Respuesta recibida de CardNet"
      });

      await pool.query(
        'INSERT INTO payments (id, tenant_id, client_id, amount, method, status, gateway_ref, description, cardnet_raw_response) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [`PAY-TEST-${Date.now()}`, tenantId, clientId, amount, 'CardNet_Manual_Test', 'Test', purchasePayload.Order, 'Prueba Manual de Certificación', JSON.stringify(purchaseRes.data)]
      );

    } catch (err) {
      console.error("[TEST] Error en cobro manual:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/clients', async (req, res) => {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(403).json({ error: 'Contexto de salón requerido.' });
    }

    try {
      const [rows] = await pool.query("SELECT id, nombre, email, cardnet_customer_id FROM clients WHERE tenant_id = ?", [tenantId]);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Route to verify global 500 error sanitization and correlation ID (REM-P1-13)
  router.get('/simulate-500', (_req, _res, next) => {
    const err = new Error('FATAL: Database connection dropped: SELECT * FROM sensitive_financial_table WHERE secret = 123');
    err.status = 500;
    return next(err);
  });

  return router;
}

module.exports = {
  createTestRouter
};
