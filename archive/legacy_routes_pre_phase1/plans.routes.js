const express = require('express');

/**
 * Plans and Memberships Router
 * 
 * @param {import('mysql2/promise').Pool} pool 
 */
function createPlansRouter(pool) {
  const router = express.Router();

  // GET /api/plans
  router.get('/', async (req, res) => {
    try {
      const [rows] = await pool.query(`
        SELECT p.*, 
          (SELECT COUNT(*) FROM contracts c WHERE c.plan_id = p.id AND c.status IN ('Active', 'Pending_Retry', 'Activo')) as subscribers_count,
          (SELECT COUNT(*) FROM contracts c WHERE c.plan_id = p.id) as total_contracts_count
        FROM plans p
      `);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/plans
  router.post('/', async (req, res) => {
    let connection;
    try {
      const { plans, applyToExisting } = req.body;
      connection = await pool.getConnection();
      await connection.beginTransaction();

      // 1. Limpieza total de planes para evitar duplicados e inconsistencias
      await connection.query('DELETE FROM plans');

      if (Array.isArray(plans)) {
        for (const plan of plans) {
          const ensureData = (val) => {
            if (Array.isArray(val)) return JSON.stringify(val);
            if (typeof val === 'string') {
              try {
                const p = JSON.parse(val);
                return JSON.stringify(Array.isArray(p) ? p : [p]);
              } catch {
                return JSON.stringify(val.split(',').map(s => s.trim()).filter(Boolean));
              }
            }
            return JSON.stringify([]);
          };

          const servicesStr = ensureData(plan.services);
          const promoServicesStr = ensureData(plan.promo_services);
          const usageLimitsStr = JSON.stringify(plan.usage_limits || { visits: '', services: '' });

          await connection.query(
            'INSERT INTO plans (id, title, price, activation_fee, discount, color, location, services, promo_services, promo_duration_months, usage_limits) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
              plan.id,
              plan.title,
              plan.price,
              plan.activation_fee || 0,
              plan.discount || 0,
              plan.color,
              plan.location,
              servicesStr,
              promoServicesStr,
              plan.promo_duration_months || 0,
              usageLimitsStr
            ]
          );

          // 2. Sincronizar contratos si se solicita
          if (applyToExisting) {
            await connection.query(
              `UPDATE contracts SET 
                contract_services = ?, 
                contract_price = ?, 
                contract_promo_services = ?, 
                contract_promo_duration = ? 
               WHERE plan_id = ?`,
              [
                servicesStr,
                plan.price,
                promoServicesStr,
                plan.promo_duration_months || 0,
                plan.id
              ]
            );
          }
        }
      }

      await connection.commit();
      res.json({ success: true, message: 'Planes sincronizados correctamente.' });
    } catch (err) {
      if (connection) await connection.rollback();
      console.error('[DATABASE ERROR]:', err.message);
      res.status(500).json({ error: 'Fallo al guardar planes: ' + err.message });
    } finally {
      if (connection) connection.release();
    }
  });

  return router;
}

module.exports = {
  createPlansRouter
};
