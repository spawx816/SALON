const express = require('express');

/**
 * Appointments and Calendar Router (Scoped strictly by tenant_id)
 */
function createAppointmentsRouter(pool) {
  const router = express.Router();

  // GET /api/appointments
  router.get('/', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const [rows] = await pool.query('SELECT * FROM appointments WHERE tenant_id = ? ORDER BY date DESC, time DESC', [tenantId]);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/appointments
  router.post('/', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const id = `APT-${Date.now()}`;
      const { clientId, date, time, services } = req.body;
      await pool.query(
        'INSERT INTO appointments (id, tenant_id, client_id, date, time, services) VALUES (?, ?, ?, ?, ?, ?)',
        [id, tenantId, clientId, date, time, JSON.stringify(services)]
      );
      res.json({ success: true, id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = {
  createAppointmentsRouter
};
