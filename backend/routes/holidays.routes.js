const express = require('express');

/**
 * Creates and configures the Express Router for Holidays & Calendar management.
 * @param {import('mysql2/promise').Pool} pool - Database connection pool
 * @returns {express.Router}
 */
function createHolidaysRouter(pool) {
  const router = express.Router();

  // 1. Obtener todos los días feriados (con opción de filtrar por año)
  router.get('/', async (req, res) => {
    try {
      const { year } = req.query;
      let query = `
        SELECT id, DATE_FORMAT(date, '%Y-%m-%d') as date, name, type, rate_multiplier, is_active, notes, created_at 
        FROM holidays
      `;
      const params = [];
      if (year) {
        query += ` WHERE YEAR(date) = ?`;
        params.push(year);
      }
      query += ` ORDER BY date ASC`;

      const [rows] = await pool.query(query, params);
      res.json(rows);
    } catch (err) {
      console.error('[HOLIDAYS GET ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 2. Crear un nuevo día feriado
  router.post('/', async (req, res) => {
    try {
      const { date, name, type, rate_multiplier, is_active, notes } = req.body;
      if (!date || !name) {
        return res.status(400).json({ error: 'La fecha y el nombre del día feriado son obligatorios.' });
      }

      const [result] = await pool.query(`
        INSERT INTO holidays (date, name, type, rate_multiplier, is_active, notes)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
          name = VALUES(name), 
          type = VALUES(type), 
          rate_multiplier = VALUES(rate_multiplier), 
          is_active = VALUES(is_active),
          notes = VALUES(notes)
      `, [
        date, 
        name, 
        type || 'Oficial', 
        rate_multiplier !== undefined ? rate_multiplier : 1.00, 
        is_active !== undefined ? is_active : 1, 
        notes || null
      ]);

      res.json({ success: true, id: result.insertId || result.id, message: 'Día feriado guardado exitosamente.' });
    } catch (err) {
      console.error('[HOLIDAYS CREATE ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 3. Actualizar un día feriado existente
  router.put('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { date, name, type, rate_multiplier, is_active, notes } = req.body;

      const [result] = await pool.query(`
        UPDATE holidays
        SET date = COALESCE(?, date),
            name = COALESCE(?, name),
            type = COALESCE(?, type),
            rate_multiplier = COALESCE(?, rate_multiplier),
            is_active = COALESCE(?, is_active),
            notes = COALESCE(?, notes)
        WHERE id = ?
      `, [date, name, type, rate_multiplier, is_active, notes, id]);

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Día feriado no encontrado.' });
      }

      res.json({ success: true, message: 'Día feriado actualizado exitosamente.' });
    } catch (err) {
      console.error('[HOLIDAYS UPDATE ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 4. Eliminar un día feriado
  router.delete('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const [result] = await pool.query('DELETE FROM holidays WHERE id = ?', [id]);
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Día feriado no encontrado.' });
      }
      res.json({ success: true, message: 'Día feriado eliminado correctamente.' });
    } catch (err) {
      console.error('[HOLIDAYS DELETE ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 5. Re-sembrar feriados oficiales de República Dominicana
  router.post('/seed', async (req, res) => {
    try {
      const year = req.body.year || 2026;
      const defaultHolidays = [
        [`${year}-01-01`, 'Año Nuevo', 'Oficial', 2.00, 1],
        [`${year}-01-06`, 'Día de los Santos Reyes', 'Oficial', 2.00, 1],
        [`${year}-01-21`, 'Día de Nuestra Señora de la Altagracia', 'Oficial', 2.00, 1],
        [`${year}-01-26`, 'Día de Duarte', 'Oficial', 2.00, 1],
        [`${year}-02-27`, 'Día de la Independencia Nacional', 'Oficial', 2.00, 1],
        [`${year}-04-03`, 'Viernes Santo', 'Oficial', 2.00, 1],
        [`${year}-05-01`, 'Día del Trabajo', 'Oficial', 2.00, 1],
        [`${year}-06-04`, 'Corpus Christi', 'Oficial', 2.00, 1],
        [`${year}-08-16`, 'Día de la Restauración', 'Oficial', 2.00, 1],
        [`${year}-09-24`, 'Día de Nuestra Señora de las Mercedes', 'Oficial', 2.00, 1],
        [`${year}-11-06`, 'Día de la Constitución', 'Oficial', 2.00, 1],
        [`${year}-12-25`, 'Día de Navidad', 'Oficial', 2.00, 1]
      ];

      for (const h of defaultHolidays) {
        await pool.query(`
          INSERT INTO holidays (date, name, type, rate_multiplier, is_active)
          VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE name = VALUES(name), type = VALUES(type), rate_multiplier = VALUES(rate_multiplier), is_active = VALUES(is_active)
        `, h);
      }

      const [rows] = await pool.query("SELECT id, DATE_FORMAT(date, '%Y-%m-%d') as date, name, type, rate_multiplier, is_active FROM holidays ORDER BY date ASC");
      res.json({ success: true, message: `Feriados del año ${year} restablecidos con éxito.`, holidays: rows });
    } catch (err) {
      console.error('[HOLIDAYS SEED ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createHolidaysRouter };
