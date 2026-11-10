const express = require('express');
const crypto = require('crypto');
const { createQuarantineGuard } = require('../middleware/quarantine.middleware.cjs');

/**
 * Salons / Branches Management Router (Scoped strictly by tenant_id)
 */
function createSalonsRouter(pool, options = {}) {
  const router = express.Router();

  // Fail-Closed Quarantine Protection Guard on Salon Resources
  router.use('/:id', createQuarantineGuard(pool, 'salons', 'id'));

  // GET /api/salons
  router.get('/', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de salón requerido.' });
      }

      const [branches] = await pool.query(`
        SELECT id, tenant_id, name, address, phone,
               CASE WHEN is_active THEN 'Active' ELSE 'Inactive' END as status,
               is_main, created_at
        FROM branches
        WHERE tenant_id = ?
        ORDER BY is_main DESC, created_at ASC
      `, [tenantId]);

      if (branches && branches.length > 0) {
        return res.json(branches);
      }

      const [rows] = await pool.query('SELECT * FROM salons WHERE tenant_id = ? ORDER BY id ASC', [tenantId]);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/salons/autocomplete - Search branches/salons strictly scoped to tenant (REM-P2-01)
  router.get('/autocomplete', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de salón requerido.' });
      }

      const q = String(req.query.q || '').trim();
      if (q.length < 2) {
        return res.status(400).json({ error: 'El término de búsqueda debe tener al menos 2 caracteres.' });
      }

      const rawLimit = parseInt(req.query.limit || '20', 10);
      const limit = Math.min(Math.max(rawLimit, 1), 50);
      const searchPattern = `%${q}%`;

      const [branches] = await pool.query(`
        SELECT id, tenant_id, name, address, phone, is_main
        FROM branches
        WHERE tenant_id = ?
          AND (name ILIKE ? OR address ILIKE ?)
        ORDER BY is_main DESC, name ASC
        LIMIT ?
      `, [tenantId, searchPattern, searchPattern, limit]);

      if (branches && branches.length > 0) {
        return res.json(branches);
      }

      const [rows] = await pool.query(`
        SELECT id, tenant_id, name, address, phone
        FROM salons
        WHERE tenant_id = ?
          AND (name ILIKE ? OR address ILIKE ?)
        ORDER BY name ASC
        LIMIT ?
      `, [tenantId, searchPattern, searchPattern, limit]);

      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/salons
  router.post('/', async (req, res) => {
    const { name, address, phone } = req.body;
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(403).json({ error: 'Contexto de salón requerido.' });
    }

    try {
      if (!req.auth?.isSuperAdmin) {
        if (options.entitlementsService) {
          const limitCheck = await options.entitlementsService.checkLimit(tenantId, 'branches');
          if (!limitCheck.allowed) {
            return res.status(403).json({
              error: limitCheck.reason || 'Has alcanzado el límite permitido por tu plan.',
              code: limitCheck.code || 'PLAN_LIMIT_REACHED',
              limit: 'branches',
              current: limitCheck.current,
              maximum: limitCheck.maximum
            });
          }
        } else {
          const [tenantRows] = await pool.query('SELECT max_branches FROM tenants WHERE id = ?', [tenantId]);
          const [branchCount] = await pool.query('SELECT COUNT(*) as total FROM branches WHERE tenant_id = ?', [tenantId]);
          const maxBranches = parseInt(tenantRows[0]?.max_branches || 1, 10);
          const currentBranches = parseInt(branchCount[0]?.total || 0, 10);

          if (currentBranches >= maxBranches) {
            return res.status(403).json({
              error: 'Has alcanzado el límite permitido por tu plan.',
              code: 'PLAN_LIMIT_REACHED',
              limit: 'branches',
              current: currentBranches,
              maximum: maxBranches
            });
          }
        }
      }

      const branchId = crypto.randomUUID();
      await pool.query(
        'INSERT INTO branches (id, tenant_id, name, address, phone, is_main, is_active) VALUES (?, ?, ?, ?, ?, false, true)',
        [branchId, tenantId, name, address || '', phone || '']
      );

      await pool.query(
        "INSERT INTO salons (id, tenant_id, name, address, phone, status) VALUES (?, ?, ?, ?, ?, 'Active')",
        [branchId, tenantId, name, address || '', phone || '']
      );
      return res.json({ id: branchId, success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/salons/:id
  router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { name, address, phone, status } = req.body;
    const tenantId = req.tenantId;
    try {
      await pool.query(
        'UPDATE branches SET name = ?, address = ?, phone = ?, is_active = ? WHERE id::text = ? AND tenant_id = ?',
        [name, address, phone, status !== 'Inactive', String(id), tenantId]
      );
      await pool.query(
        'UPDATE salons SET name = ?, address = ?, phone = ?, status = ? WHERE id::text = ? AND tenant_id = ?',
        [name, address, phone, status || 'Active', String(id), tenantId]
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/salons/:id
  router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const tenantId = req.tenantId;
    try {
      await pool.query('DELETE FROM branches WHERE id::text = ? AND tenant_id = ? AND is_main = false', [String(id), tenantId]);
      await pool.query('DELETE FROM salons WHERE id::text = ? AND tenant_id = ?', [String(id), tenantId]);
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
