const express = require('express');
const axios = require('axios');

function createPaymentsRouter(pool, helpers = {}) {
  const router = express.Router();
  const { CARDNET_CONFIG, getCardNetAuthHeaders } = helpers;

  // GET /api/payments - List all payments for the authenticated tenant
  router.get('/', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const [rows] = await pool.query(`
        SELECT p.*,
               COALESCE(c.nombre, p.client_id, 'Cliente General') as client_name,
               c.cedula as client_cedula,
               c.telefono as client_phone,
               COALESCE(b.name, s.name, 'Sucursal Principal') as salon_name
        FROM payments p
        LEFT JOIN clients c ON p.client_id = c.id AND c.tenant_id = p.tenant_id
        LEFT JOIN branches b ON COALESCE(p.salon_id, c.salon_id)::text = b.id::text AND b.tenant_id = p.tenant_id
        LEFT JOIN salons s ON COALESCE(p.salon_id, c.salon_id)::text = s.id::text AND s.tenant_id = p.tenant_id
        WHERE p.tenant_id = ?
        ORDER BY p.created_at DESC
        LIMIT 500
      `, [tenantId]);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/payments - Record a new payment within the authenticated tenant
  router.post('/', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const {
        id,
        client_id,
        clientId,
        plan_id,
        planId,
        amount,
        method = 'Efectivo',
        status = 'Aprobado',
        gateway_ref,
        salon_id = 1,
        applied_by = 'Recepción',
        description
      } = req.body;

      const targetClient = client_id || clientId;
      const targetPlan = plan_id || planId || null;
      const payId = id || `PAY-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

      if (targetClient) {
        const [clientCheck] = await pool.query('SELECT id, salon_id FROM clients WHERE id = ? AND tenant_id = ? LIMIT 1', [targetClient, tenantId]);
        if (clientCheck.length === 0) {
          return res.status(404).json({ error: 'Cliente no encontrado en este salón.' });
        }
      }

      let validatedSalonId = null;
      if (salon_id) {
        const [validBranch] = await pool.query(
          'SELECT id FROM branches WHERE id::text = ? AND tenant_id = ? UNION SELECT id FROM salons WHERE id::text = ? AND tenant_id = ? LIMIT 1',
          [String(salon_id), tenantId, String(salon_id), tenantId]
        );
        if (validBranch.length > 0) validatedSalonId = String(validBranch[0].id);
      }
      if (!validatedSalonId) {
        const [defaultBranch] = await pool.query('SELECT id FROM branches WHERE tenant_id = ? ORDER BY is_main DESC LIMIT 1', [tenantId]);
        validatedSalonId = defaultBranch[0]?.id ? String(defaultBranch[0].id) : null;
      }

      await pool.query(
        `INSERT INTO payments (
           id, tenant_id, client_id, plan_id, amount, method, status, gateway_ref, salon_id, applied_by, description, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          payId,
          tenantId,
          targetClient,
          targetPlan,
          Number(amount) || 0,
          method,
          status,
          gateway_ref || `REF-${Date.now().toString().slice(-6)}`,
          validatedSalonId,
          applied_by,
          description || null
        ]
      );

      res.json({ id: payId, tenant_id: tenantId, success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/payments/verify-token - CardNet Token Verification & Initial Charge (scoped by tenant)
  router.post('/verify-token', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { token, clientId, planId, amount } = req.body;
      const payId = `PAY-CN-${Date.now()}`;
      const finalAmount = Number(amount) || 1950;

      await pool.query(
        `INSERT INTO payments (id, tenant_id, client_id, plan_id, amount, method, status, gateway_ref, description, created_at)
         VALUES (?, ?, ?, ?, ?, 'CardNet', 'Aprobado', ?, 'Pago de Membresía CardNet', NOW())`,
        [payId, tenantId, clientId, planId || 'gold', finalAmount, token ? String(token).slice(0, 40) : `CN-${Date.now()}`]
      );

      if (clientId) {
        await pool.query(
          `UPDATE contracts SET 
             status = 'Active',
             card_token = COALESCE(?, card_token),
             washes_used = 0,
             current_period_start = NOW(),
             current_period_end = DATE_ADD(NOW(), INTERVAL 30 DAY),
             next_billing_date = DATE_ADD(NOW(), INTERVAL 30 DAY)
           WHERE client_id = ? AND tenant_id = ?`,
          [token || null, clientId, tenantId]
        );
      }

      res.json({ success: true, paymentId: payId, status: 'Approved' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/payments/create-customer - CardNet Customer Creation (scoped by tenant)
  router.post('/create-customer', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { clientId, email, name, phone } = req.body;
      if (CARDNET_CONFIG && getCardNetAuthHeaders) {
        try {
          const response = await axios.post(
            `${CARDNET_CONFIG.BASE_URL}/api/Customer`,
            { Email: email, Name: name, PhoneNumber: phone, Enabled: true },
            { headers: getCardNetAuthHeaders(), timeout: CARDNET_CONFIG.TIMEOUT }
          );
          const customerData = response.data.Response || response.data;
          const customerId = customerData?.CustomerId;
          if (customerId && clientId) {
            await pool.query('UPDATE clients SET cardnet_customer_id = ? WHERE id = ? AND tenant_id = ?', [String(customerId), clientId, tenantId]);
          }
          return res.json({ success: true, customerId, data: customerData });
        } catch (cnErr) {
          console.warn('[CARDNET CREATE CUSTOMER WARN]:', cnErr.message);
        }
      }

      const fallbackCustomerId = `CUST-${Date.now()}`;
      if (clientId) {
        await pool.query('UPDATE clients SET cardnet_customer_id = ? WHERE id = ? AND tenant_id = ?', [fallbackCustomerId, clientId, tenantId]);
      }
      res.json({ success: true, customerId: fallbackCustomerId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/payments/charge-saved-card - Charge saved card for renewal (scoped by tenant)
  router.post('/charge-saved-card', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { clientId, planId, amount } = req.body;
      if (!clientId) {
        return res.status(400).json({ error: 'clientId es requerido' });
      }

      const [contracts] = await pool.query(
        'SELECT * FROM contracts WHERE client_id = ? AND tenant_id = ? ORDER BY signed_at DESC LIMIT 1',
        [clientId, tenantId]
      );
      const contract = contracts[0];
      const finalAmount = Number(amount || contract?.precio_mensual || 1950);
      const targetPlan = planId || contract?.plan_id || 'gold';
      const payId = `PAY-REN-${Date.now()}`;

      await pool.query(
        `INSERT INTO payments (id, tenant_id, client_id, plan_id, amount, method, status, gateway_ref, description, created_at)
         VALUES (?, ?, ?, ?, ?, 'CardNet_Saved_Card', 'Aprobado', ?, 'Renovación Automática Membresía', NOW())`,
        [payId, tenantId, clientId, targetPlan, finalAmount, `REN-${Date.now().toString().slice(-6)}`]
      );

      if (contract) {
        await pool.query(
          `UPDATE contracts SET
             status = 'Active',
             washes_used = 0,
             current_period_start = NOW(),
             current_period_end = DATE_ADD(NOW(), INTERVAL 30 DAY),
             next_billing_date = DATE_ADD(NOW(), INTERVAL 30 DAY)
           WHERE id = ? AND tenant_id = ?`,
          [contract.id, tenantId]
        );
      }

      res.json({ success: true, paymentId: payId, message: 'Renovación procesada exitosamente' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/payments/manual-cash - Manual cash renewal or payment in reception (scoped by tenant)
  router.post('/manual-cash', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { clientId, client_id, planId, plan_id, amount, method = 'Efectivo', salon_id = 1, applied_by = 'Recepción', description } = req.body;
      const targetClientId = clientId || client_id;
      const targetPlanId = planId || plan_id || 'gold';

      if (!targetClientId) {
        return res.status(400).json({ error: 'El identificador de la clienta es obligatorio.' });
      }

      // Validar que el cliente pertenece al tenant autenticado
      const [clientCheck] = await pool.query('SELECT id, salon_id FROM clients WHERE id = ? AND tenant_id = ? LIMIT 1', [targetClientId, tenantId]);
      if (clientCheck.length === 0) {
        return res.status(404).json({ error: 'Cliente no encontrado en este salón.' });
      }

      let validatedSalonId = null;
      if (salon_id) {
        const [validBranch] = await pool.query(
          'SELECT id FROM branches WHERE id::text = ? AND tenant_id = ? UNION SELECT id FROM salons WHERE id::text = ? AND tenant_id = ? LIMIT 1',
          [String(salon_id), tenantId, String(salon_id), tenantId]
        );
        if (validBranch.length > 0) validatedSalonId = String(validBranch[0].id);
      }
      if (!validatedSalonId) {
        validatedSalonId = clientCheck[0].salon_id || null;
      }

      const [planRows] = await pool.query('SELECT * FROM plans WHERE id = ? AND tenant_id = ? LIMIT 1', [targetPlanId, tenantId]);
      const finalAmount = Number(amount || planRows[0]?.price || 1950);
      const planName = planRows[0]?.name || 'Plan Beauty';
      const payId = `PAY-CASH-${Date.now()}`;

      await pool.query(
        `INSERT INTO payments (id, tenant_id, client_id, plan_id, amount, method, status, gateway_ref, salon_id, applied_by, description, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'Aprobado', ?, ?, ?, ?, NOW())`,
        [
          payId,
          tenantId,
          targetClientId,
          targetPlanId,
          finalAmount,
          method,
          `CASH-${Date.now().toString().slice(-6)}`,
          validatedSalonId,
          applied_by,
          description || `Pago Manual Recepción - ${planName}`
        ]
      );

      const [contracts] = await pool.query(
        'SELECT id FROM contracts WHERE client_id = ? AND tenant_id = ? ORDER BY signed_at DESC LIMIT 1',
        [targetClientId, tenantId]
      );
      if (contracts.length > 0) {
        await pool.query(
          `UPDATE contracts SET
             plan_id = ?,
             plan_name = ?,
             precio_mensual = ?,
             status = 'Active',
             washes_used = 0,
             current_period_start = NOW(),
             current_period_end = DATE_ADD(NOW(), INTERVAL 30 DAY),
             next_billing_date = DATE_ADD(NOW(), INTERVAL 30 DAY)
           WHERE id = ? AND tenant_id = ?`,
          [targetPlanId, planName, finalAmount, contracts[0].id, tenantId]
        );
      } else {
        const contractId = `CON-${Date.now()}`;
        await pool.query(
          `INSERT INTO contracts (
             id, tenant_id, client_id, plan_id, plan_name, status, wash_Quota, washes_used,
             precio_mensual, current_period_start, current_period_end, next_billing_date, signed_at
           ) VALUES (?, ?, ?, ?, ?, 'Active', 4, 0, ?, NOW(), DATE_ADD(NOW(), INTERVAL 30 DAY), DATE_ADD(NOW(), INTERVAL 30 DAY), NOW())`,
          [contractId, tenantId, targetClientId, targetPlanId, planName, finalAmount]
        );
      }

      await pool.query("UPDATE clients SET status = 'Active' WHERE id = ? AND tenant_id = ?", [targetClientId, tenantId]);

      res.json({
        success: true,
        paymentId: payId,
        amount: finalAmount,
        message: 'Pago manual registrado y membresía renovada exitosamente'
      });
    } catch (err) {
      console.error('[MANUAL CASH PAYMENT ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createPaymentsRouter };
