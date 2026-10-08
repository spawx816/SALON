const express = require('express');

/**
 * Employees and RRHH Staff Router
 * 
 * @param {import('mysql2/promise').Pool} pool 
 */
function createEmployeesRouter(pool) {
  const router = express.Router();

  // GET employees
  const handleGetEmployees = async (req, res) => {
    try {
      const { light } = req.query;
      if (light === 'true') {
        const [rows] = await pool.query(`
          SELECT id, nombre, posicion as rol, status, salon_id, email
          FROM staff_records 
          WHERE status = 'Activo' OR status = 'Active'
          ORDER BY nombre ASC
        `);
        return res.json(rows);
      }
      const [rows] = await pool.query(`
        SELECT 
          id, 
          nombre, 
          posicion as rol, 
          status,
          profile_photo,
          hora_entrada,
          hora_salida,
          dias_laborables,
          tolerancia_minutos,
          salon_id,
          email
        FROM staff_records 
        WHERE status = 'Activo' OR status = 'Active'
        ORDER BY nombre ASC
      `);
      res.json(rows);
    } catch (err) {
      console.error('[EMPLOYEES FETCH ERROR]', err.message);
      res.status(500).json({ error: err.message });
    }
  };

  const handlePostEmployees = async (req, res) => {
    try {
      const id = Date.now().toString();
      const { nombre, rol } = req.body;
      await pool.query(
        'INSERT INTO employees (id, nombre, rol) VALUES (?, ?, ?)',
        [id, nombre, rol]
      );
      res.json({ id, nombre, rol });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };

  const handleDeleteEmployees = async (req, res) => {
    try {
      await pool.query('DELETE FROM employees WHERE id = ?', [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };

  // Staff Records (RRHH)
  const handleGetStaff = async (req, res) => {
    try {
      const { light } = req.query;
      if (light === 'true') {
        const [rows] = await pool.query('SELECT id, nombre, cedula, contacto, posicion, email, localidad, salon_id, status FROM staff_records ORDER BY nombre ASC');
        return res.json(rows);
      }
      const [rows] = await pool.query('SELECT * FROM staff_records ORDER BY nombre ASC');
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };

  const handlePostStaff = async (req, res) => {
    try {
      const { 
        nombre, cedula, contacto, posicion, email, direccion, localidad, 
        fecha_entrada, profile_photo, hora_entrada, hora_salida, dias_laborables, 
        tolerancia_minutos, salon_id, commission_scheme_id, tipo_salario, salario_base 
      } = req.body;
      const schemeIdVal = commission_scheme_id ? parseInt(commission_scheme_id, 10) : null;
      const cleanTipoSalario = tipo_salario || 'fijo_mas_comision';
      const cleanSalarioBase = !isNaN(parseFloat(salario_base)) ? parseFloat(salario_base) : 0.00;

      const [result] = await pool.query(
        'INSERT INTO staff_records (nombre, cedula, contacto, posicion, email, direccion, localidad, fecha_entrada, profile_photo, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos, salon_id, commission_scheme_id, scheme_effective_date, tipo_salario, salario_base) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)',
        [
          nombre, 
          cedula, 
          contacto, 
          posicion, 
          email || null,
          direccion, 
          localidad, 
          fecha_entrada,
          profile_photo || null,
          hora_entrada || null,
          hora_salida || null,
          dias_laborables || null,
          tolerancia_minutos !== undefined ? tolerancia_minutos : 15,
          salon_id || null,
          schemeIdVal,
          cleanTipoSalario,
          cleanSalarioBase
        ]
      );
      res.json({ id: result.insertId, success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };

  const handlePutStaff = async (req, res) => {
    try {
      const { id } = req.params;
      const { 
        nombre, cedula, contacto, posicion, email, direccion, localidad, 
        fecha_entrada, fecha_salida, status, profile_photo, hora_entrada, 
        hora_salida, dias_laborables, tolerancia_minutos, salon_id, commission_scheme_id,
        tipo_salario, salario_base
      } = req.body;

      const cleanNombre = (nombre || '').trim();
      const cleanCedula = (cedula || '').trim();
      const cleanContacto = (contacto || '').trim();
      const cleanPosicion = (posicion || '').trim();
      const cleanEmail = (email && String(email).trim()) ? String(email).trim() : null;
      const cleanDireccion = (direccion && String(direccion).trim()) ? String(direccion).trim() : null;
      const cleanLocalidad = (localidad && String(localidad).trim()) ? String(localidad).trim() : null;
      const cleanStatus = status || 'Activo';
      const cleanTipoSalario = tipo_salario || 'fijo_mas_comision';
      const cleanSalarioBase = !isNaN(parseFloat(salario_base)) ? parseFloat(salario_base) : 0.00;

      let cleanFechaEntrada = null;
      if (fecha_entrada && String(fecha_entrada).trim()) {
        cleanFechaEntrada = String(fecha_entrada).split('T')[0];
      } else {
        cleanFechaEntrada = new Date().toISOString().split('T')[0];
      }

      let cleanFechaSalida = null;
      if (fecha_salida && String(fecha_salida).trim()) {
        cleanFechaSalida = String(fecha_salida).split('T')[0];
      }

      const cleanTolerancia = !isNaN(parseInt(tolerancia_minutos, 10)) ? parseInt(tolerancia_minutos, 10) : 15;
      const cleanSalonId = (salon_id && !isNaN(parseInt(salon_id, 10))) ? parseInt(salon_id, 10) : null;
      const schemeIdVal = (commission_scheme_id && !isNaN(parseInt(commission_scheme_id, 10))) ? parseInt(commission_scheme_id, 10) : null;

      const [current] = await pool.query('SELECT commission_scheme_id FROM staff_records WHERE id = ?', [id]);
      const schemeChanged = current && current[0] && current[0].commission_scheme_id !== schemeIdVal;

      if (schemeChanged) {
        await pool.query(
          'UPDATE staff_records SET nombre=?, cedula=?, contacto=?, posicion=?, email=?, direccion=?, localidad=?, fecha_entrada=?, fecha_salida=?, status=?, profile_photo=?, hora_entrada=?, hora_salida=?, dias_laborables=?, tolerancia_minutos=?, salon_id=?, commission_scheme_id=?, scheme_effective_date=NOW(), tipo_salario=?, salario_base=? WHERE id=?',
          [
            cleanNombre, cleanCedula, cleanContacto, cleanPosicion, cleanEmail, cleanDireccion, cleanLocalidad, 
            cleanFechaEntrada, cleanFechaSalida, cleanStatus, profile_photo || null, hora_entrada || null, 
            hora_salida || null, dias_laborables || null, cleanTolerancia, cleanSalonId, schemeIdVal, cleanTipoSalario, cleanSalarioBase, id
          ]
        );
      } else {
        await pool.query(
          'UPDATE staff_records SET nombre=?, cedula=?, contacto=?, posicion=?, email=?, direccion=?, localidad=?, fecha_entrada=?, fecha_salida=?, status=?, profile_photo=?, hora_entrada=?, hora_salida=?, dias_laborables=?, tolerancia_minutos=?, salon_id=?, commission_scheme_id=?, tipo_salario=?, salario_base=? WHERE id=?',
          [
            cleanNombre, cleanCedula, cleanContacto, cleanPosicion, cleanEmail, cleanDireccion, cleanLocalidad, 
            cleanFechaEntrada, cleanFechaSalida, cleanStatus, profile_photo || null, hora_entrada || null, 
            hora_salida || null, dias_laborables || null, cleanTolerancia, cleanSalonId, schemeIdVal, cleanTipoSalario, cleanSalarioBase, id
          ]
        );
      }

      if (cleanEmail && cleanNombre) {
        try {
          await pool.query('UPDATE users SET email = ? WHERE nombre = ? AND (email != ? OR email IS NULL)', [cleanEmail, cleanNombre, cleanEmail]);
        } catch (uErr) {
          console.warn('[RRHH] Could not sync user email:', uErr.message);
        }
      }

      res.json({ success: true, message: 'Ficha actualizada correctamente' });
    } catch (err) {
      console.error('Error updating staff record:', err);
      res.status(500).json({ error: err.message });
    }
  };

  const handleDeleteStaff = async (req, res) => {
    try {
      await pool.query('DELETE FROM staff_records WHERE id = ?', [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      console.error('Error deleting staff record:', err);
      res.status(500).json({ error: err.message });
    }
  };

  // Route handlers for direct /api mounting
  router.get('/employees', handleGetEmployees);
  router.post('/employees', handlePostEmployees);
  router.delete('/employees/:id', handleDeleteEmployees);

  router.get('/rrhh/staff', handleGetStaff);
  router.post('/rrhh/staff', handlePostStaff);
  router.put('/rrhh/staff/:id', handlePutStaff);
  router.delete('/rrhh/staff/:id', handleDeleteStaff);

  return router;
}

module.exports = { createEmployeesRouter };
