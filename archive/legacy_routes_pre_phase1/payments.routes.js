const express = require('express');

/**
 * Payments & Financial Transaction Tracking Router
 * 
 * @param {import('mysql2/promise').Pool} pool
 */
function createPaymentsRouter(pool, options = {}) {
  const router = express.Router();
  const sendPaymentReceiptEmail = options.sendPaymentReceiptEmail;

  // 1. Registrar pago general
  router.post('/', async (req, res) => {
    try {
      const id = `PAY-${Date.now()}`;
      const { clientId, planId, amount, method, appliedBy, salonId } = req.body;
      await pool.query(
        'INSERT INTO payments (id, client_id, plan_id, amount, method, status, applied_by, salon_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, clientId, planId, amount, method || 'Tarjeta', 'Aprobado', appliedBy || 'Sistema', salonId || null]
      );
      res.json({ success: true, id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2. Listar pagos aprobados con información de sucursal, cliente y plan
  router.get('/', async (req, res) => {
    try {
      const [rows] = await pool.query(`
        SELECT p.*, 
               COALESCE(p.salon_id, cl.salon_id, 1) as salon_id, 
               cl.nombre as client_name,
               pl.title as plan_title
        FROM payments p
        LEFT JOIN clients cl ON p.client_id = cl.id
        LEFT JOIN plans pl ON p.plan_id = pl.id
        WHERE p.status = 'Aprobado'
        ORDER BY p.created_at DESC
      `);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 3. Obtener historial de pagos de un cliente específico
  router.get('/client/:clientId', async (req, res) => {
    try {
      const [rows] = await pool.query(
        'SELECT * FROM payments WHERE client_id = ? ORDER BY created_at DESC', 
        [req.params.clientId]
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 4. Reenviar Factura / Recibo por email
  router.post('/:id/resend-receipt', async (req, res) => {
    try {
      const [rows] = await pool.query(`
        SELECT p.*, c.nombre as client_name, c.email as client_email, c.cedula as client_cedula
        FROM payments p
        LEFT JOIN clients c ON (p.client_id = c.id OR p.client_id = c.cedula)
        WHERE p.id = ? LIMIT 1
      `, [req.params.id]);

      if (rows.length === 0) return res.status(404).json({ error: 'Pago no encontrado' });
      const pay = rows[0];

      if (!pay.client_email) {
        return res.status(400).json({ error: 'El cliente no tiene correo electrónico registrado.' });
      }

      if (sendPaymentReceiptEmail) {
        await sendPaymentReceiptEmail(
          pay.client_id,
          pay.client_name || 'Cliente',
          pay.client_email,
          pay.amount,
          pay.description || 'Cobro Plan Beauty',
          pay.gateway_ref || pay.id
        );
      }

      res.json({ success: true, message: `Factura reenviada exitosamente a ${pay.client_email}` });
    } catch (err) {
      console.error('[RESEND RECEIPT ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 5. Limpieza de pagos duplicados históricos en el mismo día
  router.post('/clean-duplicates', async (req, res) => {
    try {
      const [allFailedPayments] = await pool.query(`
        SELECT id, client_id, DATE(created_at) as date_only, created_at 
        FROM payments 
        WHERE method = 'CardNet_Auto' OR status LIKE 'Fallido%' OR status LIKE 'Error_Conexion%'
        ORDER BY client_id, created_at ASC
      `);

      const seenKey = new Set();
      const idsToDelete = [];

      for (const pay of allFailedPayments) {
        const key = `${pay.client_id}_${pay.date_only}`;
        if (seenKey.has(key)) {
          idsToDelete.push(pay.id);
        } else {
          seenKey.add(key);
        }
      }

      if (idsToDelete.length > 0) {
        for (let i = 0; i < idsToDelete.length; i += 100) {
          const batch = idsToDelete.slice(i, i + 100);
          await pool.query('DELETE FROM payments WHERE id IN (?)', [batch]);
        }
      }

      // Sincronizar retry_count en contratos
      const [contractsToSync] = await pool.query(`
        SELECT id, client_id FROM contracts WHERE status IN ('Pending_Retry', 'Pending_Payment', 'Pendiente_Pago', 'Past_Due')
      `);

      for (const contract of contractsToSync) {
        const [countRes] = await pool.query(`
          SELECT COUNT(DISTINCT DATE(created_at)) as actual_days 
          FROM payments 
          WHERE client_id = ? AND (status LIKE 'Fallido%' OR status LIKE 'Error_Conexion%')
        `, [contract.client_id]);

        const actualDays = countRes[0]?.actual_days || 0;
        await pool.query(
          'UPDATE contracts SET retry_count = ? WHERE id = ?',
          [actualDays, contract.id]
        );
      }

      res.json({
        success: true,
        deletedDuplicates: idsToDelete.length,
        syncedContracts: contractsToSync.length,
        message: `Se eliminaron ${idsToDelete.length} registros duplicados y se sincronizaron ${contractsToSync.length} contratos.`
      });
    } catch (err) {
      console.error('[CLEAN DUPLICATES ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createPaymentsRouter };
