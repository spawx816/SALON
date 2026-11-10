const express = require('express');

/**
 * Loyalty Plans & Subscriptions Router (Scoped strictly by tenant_id)
 */
function createPlansRouter(pool) {
  const router = express.Router();

  // GET /api/plans
  router.get('/', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de salón requerido.' });
      }

      let [rows] = await pool.query(`
        SELECT p.*, COUNT(c.id) as subscriber_count 
        FROM plans p
        LEFT JOIN contracts c ON p.id = c.plan_id AND c.tenant_id = p.tenant_id AND c.status = 'Active'
        WHERE p.tenant_id = ?
        GROUP BY p.tenant_id, p.id
        ORDER BY p.price ASC
      `, [tenantId]);

      // Si el salón es nuevo y aún no tiene planes inicializados, sembrar planes base para este tenant
      if (!rows || rows.length === 0) {
        const defaultPlans = [
          ['silver', 'Plan Silver', 1500, '4 lavados y secados al mes', JSON.stringify(['4 Lavados mensuales', 'Secado incluido'])],
          ['gold', 'Plan Beauty Pro', 1950, '4 lavados profundos + hidratación', JSON.stringify(['4 Lavados mensuales', '15% desc. en servicios extra'])],
          ['black', 'Plan VIP Black', 3200, 'Lavados ilimitados + manicure', JSON.stringify(['Lavados ilimitados', '20% desc. en servicios extra'])]
        ];
        for (const [id, name, price, desc, features] of defaultPlans) {
          await pool.query(
            'INSERT INTO plans (tenant_id, id, name, price, description, features) VALUES (?, ?, ?, ?, ?, ?::jsonb) ON CONFLICT (tenant_id, id) DO NOTHING',
            [tenantId, id, name, price, desc, features]
          );
        }
        [rows] = await pool.query(`
          SELECT p.*, COUNT(c.id) as subscriber_count 
          FROM plans p
          LEFT JOIN contracts c ON p.id = c.plan_id AND c.tenant_id = p.tenant_id AND c.status = 'Active'
          WHERE p.tenant_id = ?
          GROUP BY p.tenant_id, p.id
          ORDER BY p.price ASC
        `, [tenantId]);
      }

      res.json(rows.map(p => ({
        ...p,
        subscriber_count: Number(p.subscriber_count || 0),
        features: typeof p.features === 'string' ? JSON.parse(p.features || '[]') : (p.features || [])
      })));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/plans - Reemplaza planes ÚNICAMENTE del tenant autenticado (NUNCA global)
  router.post('/', async (req, res) => {
    const plans = req.body;
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(403).json({ error: 'Contexto de salón requerido.' });
    }
    if (!Array.isArray(plans)) {
      return res.status(400).json({ error: 'Se requiere un arreglo de planes válido.' });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query('DELETE FROM plans WHERE tenant_id = ?', [tenantId]);
      for (const p of plans) {
        const planId = String(p.id || p.name || `plan_${Date.now()}`).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        const planTitle = p.title || p.name || 'Plan';
        const planName = p.name || p.title || 'Plan';
        await connection.query(
          'INSERT INTO plans (tenant_id, id, name, title, price, description, features) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [tenantId, planId, planName, planTitle, p.price, p.description || '', JSON.stringify(p.features || [])]
        );
        // Sincronizar automáticamente los contratos de este salón vinculados a este plan
        await connection.query(
          'UPDATE contracts SET plan_name = ?, precio_mensual = ? WHERE plan_id = ? AND tenant_id = ?',
          [p.name, p.price, planId, tenantId]
        );
      }
      await connection.commit();
      res.json({ success: true });
    } catch (err) {
      await connection.rollback();
      res.status(500).json({ error: err.message });
    } finally {
      connection.release();
    }
  });

  return router;
}

module.exports = {
  createPlansRouter
};
