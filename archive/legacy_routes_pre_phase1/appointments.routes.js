const express = require('express');

/**
 * Appointments and Calendar Router
 * 
 * @param {import('mysql2/promise').Pool} pool 
 */
function createAppointmentsRouter(pool) {
  const router = express.Router();

  // POST /api/appointments
  router.post('/', async (req, res) => {
    try {
      const id = `APT-${Date.now()}`;
      const { clientId, date, time, services } = req.body;
      await pool.query(
        'INSERT INTO appointments (id, client_id, date, time, services) VALUES (?, ?, ?, ?, ?)',
        [id, clientId, date, time, JSON.stringify(services)]
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
