const express = require('express');

/**
 * Operational Expenses Router (Scoped strictly by tenant_id)
 */
function createExpensesRouter(pool) {
  const router = express.Router();

  // GET /api/expenses/status
  router.get('/status', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      await pool.query('SELECT 1 FROM expenses WHERE tenant_id = ? LIMIT 1', [tenantId]);
      res.json({ ready: true });
    } catch (err) {
      res.status(503).json({ ready: false, code: 'MIGRATION_PENDING', error: err.message });
    }
  });

  // GET /api/expenses/concepts
  router.get('/concepts', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const [rows] = await pool.query(
        'SELECT DISTINCT concept as name, COALESCE(category, \'Operativo\') as category FROM expenses WHERE tenant_id = ? AND concept IS NOT NULL ORDER BY concept ASC',
        [tenantId]
      );
      res.json(rows || []);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/concepts', async (req, res) => {
    const { name, category = 'Operativo' } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'El nombre del concepto es requerido.' });
    }
    res.json({ success: true, name: String(name).trim(), category });
  });

  // GET /api/expenses/banks, /loans, /accounts (tablas dedicadas no habilitadas aún -> estado vacío real)
  router.get('/banks', (_req, res) => res.json([]));
  router.get('/loans', (_req, res) => res.json([]));
  router.get('/accounts', (_req, res) => res.json([]));

  // GET /api/expenses
  router.get('/', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { salon_id, start_date, end_date, category } = req.query;
      let query = 'SELECT * FROM expenses WHERE tenant_id = ?';
      const params = [tenantId];

      if (salon_id && salon_id !== 'all') {
        query += ' AND (salon_id::text = ? OR branch_id::text = ?)';
        params.push(String(salon_id), String(salon_id));
      }
      if (start_date && end_date) {
        query += ' AND COALESCE(date, expense_date) BETWEEN ? AND ?';
        params.push(start_date, end_date);
      }
      if (category && category !== 'all') {
        query += ' AND category = ?';
        params.push(category);
      }

      query += ' ORDER BY COALESCE(date, expense_date) DESC, created_at DESC';
      const [rows] = await pool.query(query, params);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/expenses
  router.post('/', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const {
        concept,
        description,
        category = 'Operativo',
        amount,
        date,
        payment_method = 'Efectivo',
        salon_id = 1,
        rnc_proveedor = '',
        ncf = '',
        created_by = 'Administrador'
      } = req.body;

      if (!amount || Number(amount) <= 0) {
        return res.status(400).json({ error: 'El monto del gasto debe ser mayor a 0.' });
      }

      const cleanDate = date ? String(date).split('T')[0] : new Date().toISOString().split('T')[0];

      const [result] = await pool.query(
        `INSERT INTO expenses (
           tenant_id, concept, description, category, amount, date, expense_date,
           payment_method, salon_id, rnc_proveedor, ncf, created_by, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         RETURNING id`,
        [
          tenantId,
          concept || description || 'Gasto Operativo',
          description || concept || '',
          category,
          Number(amount),
          cleanDate,
          cleanDate,
          payment_method,
          salon_id,
          rnc_proveedor,
          ncf,
          created_by
        ]
      );

      res.json({ id: result.insertId || result[0]?.id, success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/expenses/:id
  router.get('/:id', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const [rows] = await pool.query('SELECT * FROM expenses WHERE id = ? AND tenant_id = ?', [req.params.id, tenantId]);
      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'Egreso no encontrado' });
      }
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/expenses/:id/void
  router.post('/:id/void', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const [result] = await pool.query('DELETE FROM expenses WHERE id = ? AND tenant_id = ?', [req.params.id, tenantId]);
      const affected = result.affectedRows ?? result.rowCount ?? 0;
      if (affected === 0) {
        return res.status(404).json({ error: 'Egreso no encontrado' });
      }
      res.json({ success: true, voided: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/expenses/:id
  router.put('/:id', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const { concept, description, category, amount, date, payment_method, salon_id, rnc_proveedor, ncf } = req.body;
      const cleanDate = date ? String(date).split('T')[0] : null;

      await pool.query(
        `UPDATE expenses SET
           concept = COALESCE(?, concept),
           description = COALESCE(?, description),
           category = COALESCE(?, category),
           amount = COALESCE(?, amount),
           date = COALESCE(?, date),
           expense_date = COALESCE(?, expense_date),
           payment_method = COALESCE(?, payment_method),
           salon_id = COALESCE(?, salon_id),
           rnc_proveedor = COALESCE(?, rnc_proveedor),
           ncf = COALESCE(?, ncf)
         WHERE id::text = ? AND tenant_id = ?`,
        [
          concept || null,
          description !== undefined ? description : null,
          category || null,
          amount !== undefined ? Number(amount) : null,
          cleanDate,
          cleanDate,
          payment_method || null,
          salon_id || null,
          rnc_proveedor !== undefined ? rnc_proveedor : null,
          ncf !== undefined ? ncf : null,
          String(id),
          tenantId
        ]
      );

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/expenses/:id
  router.delete('/:id', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      await pool.query('DELETE FROM expenses WHERE id::text = ? AND tenant_id = ?', [String(id), tenantId]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = createExpensesRouter;
module.exports.createExpensesRouter = createExpensesRouter;
