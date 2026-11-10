const express = require('express');

/**
 * Employees, Staff Records and Positions Router (Scoped strictly by tenant_id)
 */
function createEmployeesRouter(pool) {
  const router = express.Router();

  // GET /api/employees
  router.get('/', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de salón requerido.' });
      }

      if (pool.isPostgres) {
        try {
          const [pgRows] = await pool.query(`
            SELECT id, tenant_id, branch_id, name as nombre, role as posicion, phone as telefono, email,
                   commission_rate, base_salary as salario_base, is_active, created_at,
                   CASE WHEN is_active THEN 'Activo' ELSE 'Inactivo' END as status
            FROM employees
            WHERE tenant_id = ?
            ORDER BY name ASC
          `, [tenantId]);
          if (pgRows && pgRows.length > 0) {
            return res.json(pgRows);
          }
        } catch (pgErr) {}
      }

      const [rows] = await pool.query(`
        SELECT s.*, COALESCE(b.name, sal.name, s.localidad, 'Principal') as salon_name 
        FROM staff_records s
        LEFT JOIN branches b ON s.salon_id::text = b.id::text AND b.tenant_id = s.tenant_id
        LEFT JOIN salons sal ON s.salon_id::text = sal.id::text AND sal.tenant_id = s.tenant_id
        WHERE s.tenant_id = ?
        ORDER BY s.nombre ASC
      `, [tenantId]);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Gestión de Posiciones de Personal (staff_positions) ---
  router.get('/positions', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      let [rows] = await pool.query(
        'SELECT * FROM staff_positions WHERE tenant_id = ? ORDER BY name ASC',
        [tenantId]
      );
      if (rows.length === 0) {
        const defaultPositions = ['Estilista', 'Manicurista', 'Lava Pelo', 'Recepcionista', 'Maquillista', 'Encargada'];
        for (const pos of defaultPositions) {
          await pool.query(
            'INSERT INTO staff_positions (tenant_id, name) VALUES (?, ?) ON CONFLICT (tenant_id, name) DO NOTHING',
            [tenantId, pos]
          );
        }
        [rows] = await pool.query('SELECT * FROM staff_positions WHERE tenant_id = ? ORDER BY name ASC', [tenantId]);
      }
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/positions', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { name } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre de la posición es requerido' });
      const cleanName = name.trim();
      await pool.query(
        'INSERT INTO staff_positions (tenant_id, name) VALUES (?, ?) ON CONFLICT (tenant_id, name) DO NOTHING',
        [tenantId, cleanName]
      );
      const [rows] = await pool.query('SELECT * FROM staff_positions WHERE tenant_id = ? ORDER BY name ASC', [tenantId]);
      res.json({ success: true, positions: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/positions/:id', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const { name } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre es requerido' });
      const cleanName = name.trim();

      const [oldPos] = await pool.query('SELECT name FROM staff_positions WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      if (oldPos.length === 0) {
        return res.status(404).json({ error: 'Posición no encontrada en este salón' });
      }
      await pool.query('UPDATE staff_positions SET name = ? WHERE id = ? AND tenant_id = ?', [cleanName, id, tenantId]);

      if (oldPos[0].name !== cleanName) {
        await pool.query('UPDATE staff_records SET posicion = ? WHERE posicion = ? AND tenant_id = ?', [cleanName, oldPos[0].name, tenantId]);
      }

      const [rows] = await pool.query('SELECT * FROM staff_positions WHERE tenant_id = ? ORDER BY name ASC', [tenantId]);
      res.json({ success: true, positions: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/positions/:id', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      await pool.query('DELETE FROM staff_positions WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      const [rows] = await pool.query('SELECT * FROM staff_positions WHERE tenant_id = ? ORDER BY name ASC', [tenantId]);
      res.json({ success: true, positions: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/employees
  router.post('/', async (req, res) => {
    const { nombre, posicion, localidad, salon_id, status, cedula, telefono, email, fecha_entrada, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos, salario_base, tipo_salario, commission_scheme_id, scheme_effective_date } = req.body;
    try {
      const tenantId = req.tenantId;
      const cleanDate = fecha_entrada && fecha_entrada.trim() !== '' ? fecha_entrada : null;
      const cleanSchemeDate = scheme_effective_date && scheme_effective_date.trim() !== '' ? scheme_effective_date : null;
      const [result] = await pool.query(
        'INSERT INTO staff_records (tenant_id, nombre, posicion, localidad, salon_id, status, cedula, telefono, email, fecha_entrada, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos, salario_base, tipo_salario, commission_scheme_id, scheme_effective_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
        [
          tenantId,
          nombre,
          posicion || 'Estilista',
          localidad || 'Principal',
          salon_id || 1,
          status || 'Activo',
          cedula || null,
          telefono || null,
          email || null,
          cleanDate,
          hora_entrada || '09:00:00',
          hora_salida || '18:00:00',
          typeof dias_laborables === 'object' ? JSON.stringify(dias_laborables) : (dias_laborables || null),
          tolerancia_minutos !== undefined ? tolerancia_minutos : 15,
          parseFloat(salario_base) || 0,
          tipo_salario || 'fijo_mas_comision',
          commission_scheme_id || null,
          cleanSchemeDate
        ]
      );
      res.json({ id: result.insertId || result[0]?.id, success: true });
    } catch (err) {
      console.error('Error creating employee:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/employees/:id
  router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { nombre, posicion, localidad, salon_id, status, cedula, telefono, email, fecha_entrada, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos, salario_base, tipo_salario, commission_scheme_id, scheme_effective_date } = req.body;
    try {
      const tenantId = req.tenantId;
      const cleanDate = fecha_entrada !== undefined ? (fecha_entrada && String(fecha_entrada).trim() !== '' ? (String(fecha_entrada).includes('T') ? String(fecha_entrada).split('T')[0] : fecha_entrada) : null) : undefined;
      const cleanSchemeDate = scheme_effective_date !== undefined ? (scheme_effective_date && String(scheme_effective_date).trim() !== '' ? (String(scheme_effective_date).includes('T') ? String(scheme_effective_date).split('T')[0] : scheme_effective_date) : null) : undefined;
      await pool.query(
        `UPDATE staff_records SET 
          nombre = COALESCE(?, nombre), 
          posicion = COALESCE(?, posicion), 
          localidad = COALESCE(?, localidad), 
          salon_id = COALESCE(?, salon_id), 
          status = COALESCE(?, status), 
          cedula = COALESCE(?, cedula), 
          telefono = COALESCE(?, telefono), 
          email = COALESCE(?, email), 
          fecha_entrada = COALESCE(?, fecha_entrada),
          hora_entrada = COALESCE(?, hora_entrada),
          hora_salida = COALESCE(?, hora_salida),
          dias_laborables = COALESCE(?, dias_laborables),
          tolerancia_minutos = COALESCE(?, tolerancia_minutos),
          salario_base = COALESCE(?, salario_base),
          tipo_salario = COALESCE(?, tipo_salario),
          commission_scheme_id = ?,
          scheme_effective_date = ?
        WHERE id = ? AND tenant_id = ?`,
        [
          nombre,
          posicion,
          localidad,
          salon_id,
          status,
          cedula,
          telefono,
          email !== undefined ? email : null,
          cleanDate !== undefined ? cleanDate : null,
          hora_entrada,
          hora_salida,
          typeof dias_laborables === 'object' ? JSON.stringify(dias_laborables) : dias_laborables,
          tolerancia_minutos,
          salario_base !== undefined ? parseFloat(salario_base) : null,
          tipo_salario || null,
          commission_scheme_id !== undefined ? (commission_scheme_id || null) : null,
          cleanSchemeDate !== undefined ? cleanSchemeDate : null,
          id,
          tenantId
        ]
      );
      res.json({ success: true });
    } catch (err) {
      console.error('Error updating employee:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/employees/:id
  router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
      const tenantId = req.tenantId;
      await pool.query('DELETE FROM staff_records WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      res.json({ success: true });
    } catch (err) {
      console.error('Error deleting employee:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = {
  createEmployeesRouter
};
