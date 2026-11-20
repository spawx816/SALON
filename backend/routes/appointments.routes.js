const express = require('express');
const { getEffectiveRole, requirePermission } = require('../middleware/rbac.middleware');

/**
 * Appointments and Calendar Router (Scoped strictly by tenant_id + B2C self-isolation + RBAC)
 */
function createAppointmentsRouter(pool) {
  const router = express.Router();

  // GET /api/appointments
  router.get('/', (req, res, next) => {
    const role = getEffectiveRole(req);
    if (role === 'cliente_b2c' || req.auth?.isClient) return next();
    return requirePermission('pos.visits.view', 'pos.visits.create', 'clients.view')(req, res, next);
  }, async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const role = getEffectiveRole(req);
      if (role === 'cliente_b2c' || req.auth?.isClient) {
        const [rows] = await pool.query(
          'SELECT * FROM appointments WHERE tenant_id = ? AND client_id::text = ? ORDER BY date DESC, time DESC',
          [tenantId, String(req.auth?.id || '')]
        );
        return res.json(rows);
      }
      const [rows] = await pool.query('SELECT * FROM appointments WHERE tenant_id = ? ORDER BY date DESC, time DESC', [tenantId]);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/appointments
  router.post('/', (req, res, next) => {
    const role = getEffectiveRole(req);
    if (role === 'cliente_b2c' || req.auth?.isClient) return next();
    return requirePermission('pos.visits.create', 'clients.edit')(req, res, next);
  }, async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const role = getEffectiveRole(req);
      const id = `APT-${Date.now()}`;
      const { clientId, date, time, services } = req.body;
      const effectiveClientId = (role === 'cliente_b2c' || req.auth?.isClient) ? String(req.auth?.id || '') : clientId;
      await pool.query(
        'INSERT INTO appointments (id, tenant_id, client_id, date, time, services) VALUES (?, ?, ?, ?, ?, ?)',
        [id, tenantId, effectiveClientId, date, time, JSON.stringify(services)]
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
