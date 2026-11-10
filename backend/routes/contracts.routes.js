const express = require('express');
const { getPrivateStorageAdapter } = require('../services/private_storage_adapter');

function createContractsRouter(pool) {
  const router = express.Router();

  // GET /api/contracts/settings - Scoped by tenant
  router.get('/settings', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const [rows] = await pool.query('SELECT * FROM contract_settings WHERE tenant_id = ? LIMIT 1', [tenantId]);
      res.json(rows[0] || { content: '' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/contracts/settings - Scoped by tenant
  router.post('/settings', async (req, res) => {
    const { content } = req.body;
    try {
      const tenantId = req.tenantId;
      if (pool.isPostgres) {
        await pool.query(
          `INSERT INTO contract_settings (tenant_id, content, updated_at)
           VALUES (?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT (tenant_id) DO UPDATE SET content = EXCLUDED.content, updated_at = CURRENT_TIMESTAMP`,
          [tenantId, content]
        );
      } else {
        await pool.query(
          'INSERT INTO contract_settings (id, tenant_id, content) VALUES (1, ?, ?) ON DUPLICATE KEY UPDATE content = ?',
          [tenantId, content, content]
        );
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/contracts - List all contracts for the authenticated tenant
  router.get('/', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const [rows] = await pool.query(`
        SELECT c.*,
               COALESCE(c.plan_name, p.title, p.name) as resolved_plan_name,
               COALESCE(c.precio_mensual, p.price) as resolved_price,
               cl.nombre as client_name,
               cl.cedula as client_cedula,
               cl.telefono as client_phone,
               cl.email as client_email,
               cl.salon_id,
               COALESCE(b.name, s.name, 'Sucursal Principal') as salon_name
        FROM contracts c
        LEFT JOIN plans p ON c.plan_id = p.id AND p.tenant_id = c.tenant_id
        LEFT JOIN clients cl ON c.client_id = cl.id AND cl.tenant_id = c.tenant_id
        LEFT JOIN branches b ON cl.salon_id::text = b.id::text AND b.tenant_id = c.tenant_id
        LEFT JOIN salons s ON cl.salon_id::text = s.id::text AND s.tenant_id = c.tenant_id
        WHERE c.tenant_id = ?
        ORDER BY c.signed_at DESC
      `, [tenantId]);
      res.json(rows);
    } catch (err) {
      console.error('[CONTRACTS GET ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/contracts/client/:clientId - Get contracts for a specific client within the authenticated tenant
  router.get('/client/:clientId', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { clientId } = req.params;
      const cleanCedula = String(clientId).replace(/\D/g, '');

      const [rows] = await pool.query(`
        SELECT c.*,
               COALESCE(c.plan_name, p.title, p.name) as resolved_plan_name,
               COALESCE(c.precio_mensual, p.price) as resolved_price,
               cl.nombre as client_name,
               cl.cedula as client_cedula
        FROM contracts c
        LEFT JOIN plans p ON c.plan_id = p.id AND p.tenant_id = c.tenant_id
        LEFT JOIN clients cl ON c.client_id = cl.id AND cl.tenant_id = c.tenant_id
        WHERE c.tenant_id = ?
          AND (c.client_id = ?
           OR cl.nombre = ?
           OR cl.cedula = ?
           OR (LENGTH(?) >= 8 AND REPLACE(cl.cedula, '-', '') = ?))
        ORDER BY c.signed_at DESC
      `, [tenantId, clientId, clientId, clientId, cleanCedula, cleanCedula]);

      res.json(rows);
    } catch (err) {
      console.error('[CONTRACTS BY CLIENT ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/contracts - Create or renew a contract within the authenticated tenant
  router.post('/', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const {
        id,
        client_id,
        clientId,
        plan_id,
        planId,
        plan_name,
        status = 'Active',
        wash_Quota = 4,
        washes_used = 0,
        precio_mensual,
        signature_data,
        document_photo,
        selfie_photo,
        card_token,
        payment_profile_id,
        auto_billing_enabled = 1,
        salon_id,
        method = 'Efectivo'
      } = req.body;

      const targetClientId = client_id || clientId;
      const targetPlanId = plan_id || planId || 'gold';

      if (!targetClientId) {
        return res.status(400).json({ error: 'client_id es obligatorio para crear un contrato.' });
      }

      // Validar que el cliente pertenece al tenant autenticado
      const [clientCheck] = await pool.query(
        'SELECT id, salon_id FROM clients WHERE id = ? AND tenant_id = ? LIMIT 1',
        [targetClientId, tenantId]
      );
      if (clientCheck.length === 0) {
        return res.status(404).json({ error: 'Cliente no encontrado en este salón.' });
      }

      // Validar sucursal
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

      const contractId = id || `CON-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

      const [planRows] = await pool.query('SELECT * FROM plans WHERE id = ? AND tenant_id = ? LIMIT 1', [targetPlanId, tenantId]);
      const resolvedName = plan_name || planRows[0]?.name || 'Plan Beauty';
      const resolvedPrice = precio_mensual !== undefined ? precio_mensual : (planRows[0]?.price || 1950);

      // Save sensitive signature & identity documents in private encrypted storage
      let signatureFileId = null;
      let docPhotoFileId = null;
      let selfiePhotoFileId = null;

      try {
        const storage = getPrivateStorageAdapter({ pool });
        if (signature_data && typeof signature_data === 'string' && signature_data.length > 20) {
          const savedSig = await storage.saveBase64({
            tenantId,
            category: 'contract_signature',
            base64Data: signature_data
          });
          signatureFileId = savedSig.id;
        }

        if (document_photo && typeof document_photo === 'string' && document_photo.length > 20) {
          const savedDoc = await storage.saveBase64({
            tenantId,
            category: 'contract_document',
            base64Data: document_photo
          });
          docPhotoFileId = savedDoc.id;
        }

        if (selfie_photo && typeof selfie_photo === 'string' && selfie_photo.length > 20) {
          const savedSelfie = await storage.saveBase64({
            tenantId,
            category: 'contract_selfie',
            base64Data: selfie_photo
          });
          selfiePhotoFileId = savedSelfie.id;
        }
      } catch (storageErr) {
        console.warn('[CONTRACT_STORAGE_WARN] Could not encrypt contract artifacts:', storageErr.message);
      }

      await pool.query(
        `INSERT INTO contracts (
           id, tenant_id, client_id, plan_id, plan_name, status, wash_Quota, washes_used,
           precio_mensual, signature_data, signature_file_id, document_photo, document_photo_file_id,
           selfie_photo, selfie_photo_file_id, card_token, payment_profile_id, auto_billing_enabled,
           current_period_start, current_period_end, next_billing_date, signed_at
         ) VALUES (
           ?, ?, ?, ?, ?, ?, ?, ?,
           ?, NULL, ?, NULL, ?,
           NULL, ?, ?, ?, ?,
           NOW(), DATE_ADD(NOW(), INTERVAL 30 DAY), DATE_ADD(NOW(), INTERVAL 30 DAY), NOW()
         )`,
        [
          contractId,
          tenantId,
          targetClientId,
          targetPlanId,
          resolvedName,
          status,
          wash_Quota,
          washes_used,
          resolvedPrice,
          signatureFileId,
          docPhotoFileId,
          selfiePhotoFileId,
          card_token || null,
          payment_profile_id || null,
          auto_billing_enabled ? 1 : 0
        ]
      );

      await pool.query("UPDATE clients SET status = 'Active' WHERE id = ? AND tenant_id = ?", [targetClientId, tenantId]);

      if (req.body.record_payment) {
        const payId = `PAY-${Date.now()}`;
        await pool.query(
          `INSERT INTO payments (id, tenant_id, client_id, plan_id, amount, method, status, salon_id, description, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'Aprobado', ?, ?, NOW())`,
          [payId, tenantId, targetClientId, targetPlanId, resolvedPrice, method, validatedSalonId, `Suscripción ${resolvedName}`]
        );
      }

      res.json({ id: contractId, tenant_id: tenantId, success: true });
    } catch (err) {
      console.error('[CONTRACTS POST ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/contracts/:id - Update contract within the authenticated tenant
  router.put('/:id', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const {
        plan_id,
        plan_name,
        status,
        wash_Quota,
        washes_used,
        precio_mensual,
        next_billing_date,
        current_period_start,
        current_period_end,
        auto_billing_enabled
      } = req.body;

      const [result] = await pool.query(
        `UPDATE contracts SET
           plan_id = COALESCE(?, plan_id),
           plan_name = COALESCE(?, plan_name),
           status = COALESCE(?, status),
           wash_Quota = COALESCE(?, wash_Quota),
           washes_used = COALESCE(?, washes_used),
           precio_mensual = COALESCE(?, precio_mensual),
           next_billing_date = COALESCE(?, next_billing_date),
           current_period_start = COALESCE(?, current_period_start),
           current_period_end = COALESCE(?, current_period_end),
           auto_billing_enabled = COALESCE(?, auto_billing_enabled)
         WHERE id = ? AND tenant_id = ?`,
        [
          plan_id !== undefined ? plan_id : null,
          plan_name !== undefined ? plan_name : null,
          status !== undefined ? status : null,
          wash_Quota !== undefined ? wash_Quota : null,
          washes_used !== undefined ? washes_used : null,
          precio_mensual !== undefined ? precio_mensual : null,
          next_billing_date !== undefined ? next_billing_date : null,
          current_period_start !== undefined ? current_period_start : null,
          current_period_end !== undefined ? current_period_end : null,
          auto_billing_enabled !== undefined ? (auto_billing_enabled ? 1 : 0) : null,
          id,
          tenantId
        ]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Contrato no encontrado' });
      }

      res.json({ success: true });
    } catch (err) {
      console.error('[CONTRACTS PUT ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/contracts/:id - Delete contract within the authenticated tenant
  router.delete('/:id', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const [result] = await pool.query('DELETE FROM contracts WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Contrato no encontrado' });
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createContractsRouter };
