const express = require('express');

function createSalonsRouter(pool) {
  const router = express.Router();

  // GET /api/salons
  router.get('/', async (req, res) => {
    try {
      const [rows] = await pool.query(`
        SELECT 
          s.*, 
          COUNT(DISTINCT active_contracts.client_id) as client_count,
          COALESCE(SUM(active_contracts.effective_price), 0) as total_revenue
        FROM salons s
        LEFT JOIN (
          SELECT 
            COALESCE(co.salon_id, cl.salon_id) as salon_id,
            co.client_id,
            MAX(COALESCE(co.contract_price, p.price)) as effective_price
          FROM contracts co
          JOIN plans p ON co.plan_id = p.id
          LEFT JOIN clients cl ON co.client_id = cl.id
          WHERE co.status IN ('Active', 'Activo')
          GROUP BY co.client_id, COALESCE(co.salon_id, cl.salon_id)
        ) active_contracts ON s.id = active_contracts.salon_id
        GROUP BY s.id
        ORDER BY s.name ASC
      `);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/salons
  router.post('/', async (req, res) => {
    try {
      const { name, address, phone, maps_url } = req.body;
      const [result] = await pool.query(
        'INSERT INTO salons (name, address, phone, maps_url) VALUES (?, ?, ?, ?)',
        [name, address, phone || '', maps_url || '']
      );
      res.json({ id: result.insertId, name, address, phone, maps_url });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/salons/:id
  router.put('/:id', async (req, res) => {
    try {
      const { name, address, phone, maps_url } = req.body;
      await pool.query(
        'UPDATE salons SET name = ?, address = ?, phone = ?, maps_url = ? WHERE id = ?',
        [name, address, phone || '', maps_url || '', req.params.id]
      );
      res.json({ success: true, id: req.params.id, name, address, phone, maps_url });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/salons/:id
  router.delete('/:id', async (req, res) => {
    try {
      await pool.query('DELETE FROM salons WHERE id = ?', [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = {
  createSalonsRouter
};
