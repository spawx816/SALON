const express = require('express');

/**
 * Operational Expenses Router (Scoped strictly by tenant_id)
 */
function createExpensesRouter(pool) {
  const router = express.Router();

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
