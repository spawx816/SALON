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

  // Staff Positions (Cargos & Funciones)
  const ensurePositionsTable = async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS staff_positions (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(100) NOT NULL UNIQUE,
          description VARCHAR(255) NULL,
          base_salary DECIMAL(10,2) DEFAULT 0.00,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Seed / Update standard positions with the requested salaries
      const standardPositions = [
        ['Peluquera', 'Estilista / Especialista en cabello y secado', 18000.00],
        ['Lava pelo', 'Lavado, tratamientos capilares y asistencia', 18421.00],
        ['Manicurista', 'Cuidado y diseño de uñas', 15351.00],
        ['Encargada', 'Supervisión de operaciones y caja', 20000.00],
        ['Recepcionista', 'Atención al cliente, cobro y agendamiento', 18000.00],
        ['Cajera', 'Facturación y arqueo de caja', 18000.00]
      ];
      for (const [name, desc, sal] of standardPositions) {
        await pool.query(
          `INSERT INTO staff_positions (name, description, base_salary) 
           VALUES (?, ?, ?) 
           ON DUPLICATE KEY UPDATE description = VALUES(description), base_salary = VALUES(base_salary)`,
          [name, desc, sal]
        );
      }

      // Also import any distinct positions already existing in staff_records
      const [distinctInStaff] = await pool.query(`
        SELECT DISTINCT posicion FROM staff_records 
        WHERE posicion IS NOT NULL AND TRIM(posicion) != ''
      `);
      for (const row of distinctInStaff) {
        if (row.posicion && row.posicion.trim()) {
          await pool.query(
            'INSERT IGNORE INTO staff_positions (name, description, base_salary) VALUES (?, ?, ?)',
            [row.posicion.trim(), 'Cargo registrado en colaboradores', 0.00]
          );
        }
      }
    } catch (err) {
      console.warn('[RRHH POSITIONS INIT]', err.message);
    }
  };

  const handleGetPositions = async (req, res) => {
    try {
      await ensurePositionsTable();
      const [rows] = await pool.query(`
        SELECT 
          sp.id,
          sp.name,
          sp.description,
          sp.base_salary,
          sp.created_at,
          COALESCE(st.staff_count, 0) as staff_count
        FROM staff_positions sp
        LEFT JOIN (
          SELECT TRIM(LOWER(posicion)) as pos_clean, COUNT(*) as staff_count
          FROM staff_records
          WHERE status IS NULL OR status = '' OR status = 'Activo' OR status = 'Active' OR status = 'En Licencia'
          GROUP BY TRIM(LOWER(posicion))
        ) st ON TRIM(LOWER(sp.name)) = st.pos_clean
        ORDER BY 
          CASE 
            WHEN sp.name LIKE '%Peluquer%' THEN 1
            WHEN sp.name LIKE '%Lava%' THEN 2
            WHEN sp.name LIKE '%Manicur%' THEN 3
            WHEN sp.name LIKE '%Encargad%' THEN 4
            WHEN sp.name LIKE '%Recep%' THEN 5
            WHEN sp.name LIKE '%Cajer%' THEN 6
            ELSE 7
          END,
          sp.name ASC
      `);
      res.json(rows);
    } catch (err) {
      console.error('[GET POSITIONS ERROR]', err);
      res.status(500).json({ error: err.message });
    }
  };

  const handlePostPosition = async (req, res) => {
    try {
      await ensurePositionsTable();
      const { name, description, base_salary } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'El nombre del cargo o posición es requerido' });
      }
      const cleanName = name.trim();
      const cleanDesc = (description || '').trim();
      const cleanSalary = !isNaN(parseFloat(base_salary)) ? parseFloat(base_salary) : 0.00;

      const [result] = await pool.query(
        'INSERT INTO staff_positions (name, description, base_salary) VALUES (?, ?, ?)',
        [cleanName, cleanDesc, cleanSalary]
      );
      res.json({ id: result.insertId, name: cleanName, description: cleanDesc, base_salary: cleanSalary, success: true });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({ error: 'Ya existe un cargo o posición con ese nombre' });
      }
      console.error('[POST POSITION ERROR]', err);
      res.status(500).json({ error: err.message });
    }
  };

  const handlePutPosition = async (req, res) => {
    try {
      await ensurePositionsTable();
      const { id } = req.params;
      const { name, description, base_salary, old_name } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'El nombre del cargo es requerido' });
      }
      const cleanName = name.trim();
      const cleanDesc = (description || '').trim();
      const cleanSalary = !isNaN(parseFloat(base_salary)) ? parseFloat(base_salary) : 0.00;

      let previousName = old_name;
      if (!previousName) {
        const [curr] = await pool.query('SELECT name FROM staff_positions WHERE id = ?', [id]);
        if (curr.length > 0) previousName = curr[0].name;
      }

      await pool.query(
        'UPDATE staff_positions SET name = ?, description = ?, base_salary = ? WHERE id = ?',
        [cleanName, cleanDesc, cleanSalary, id]
      );

      // If name changed, propagate to staff_records
      if (previousName && previousName !== cleanName) {
        await pool.query(
          'UPDATE staff_records SET posicion = ? WHERE posicion = ?',
          [cleanName, previousName]
        );
      }

      res.json({ success: true, message: 'Cargo actualizado correctamente' });
    } catch (err) {
      console.error('[PUT POSITION ERROR]', err);
      res.status(500).json({ error: err.message });
    }
  };

  const handleDeletePosition = async (req, res) => {
    try {
      const { id } = req.params;
      const [pos] = await pool.query('SELECT name FROM staff_positions WHERE id = ?', [id]);
      if (pos.length > 0) {
        const posName = pos[0].name;
        const [staffCount] = await pool.query('SELECT COUNT(*) as cnt FROM staff_records WHERE posicion = ?', [posName]);
        if (staffCount[0].cnt > 0 && req.query.force !== 'true') {
          return res.status(400).json({ 
            error: `No se puede eliminar porque hay ${staffCount[0].cnt} colaborador(es) asignados a este cargo.`,
            staff_count: staffCount[0].cnt
          });
        }
      }
      await pool.query('DELETE FROM staff_positions WHERE id = ?', [id]);
      res.json({ success: true, message: 'Cargo eliminado correctamente' });
    } catch (err) {
      console.error('[DELETE POSITION ERROR]', err);
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

  // Staff Positions endpoints
  router.get('/staff-positions', handleGetPositions);
  router.post('/staff-positions', handlePostPosition);
  router.put('/staff-positions/:id', handlePutPosition);
  router.delete('/staff-positions/:id', handleDeletePosition);

  // Aliases for /rrhh/positions
  router.get('/rrhh/positions', handleGetPositions);
  router.post('/rrhh/positions', handlePostPosition);
  router.put('/rrhh/positions/:id', handlePutPosition);
  router.delete('/rrhh/positions/:id', handleDeletePosition);

  return router;
}

module.exports = { createEmployeesRouter };

