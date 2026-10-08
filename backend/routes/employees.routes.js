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

  // Helper de sincronización bidireccional: Personal RRHH (staff_records) -> Usuarios de Acceso (users)
  async function syncStaffToUser(staffData, oldStaffRecord = null) {
    try {
      const { 
        nombre, email, salon_id, profile_photo, hora_entrada, hora_salida, 
        dias_laborables, tolerancia_minutos, status 
      } = staffData;

      const cleanNombre = (nombre || '').trim();
      const cleanEmail = (email && String(email).trim()) ? String(email).trim() : null;
      const cleanSalonId = (salon_id && !isNaN(parseInt(salon_id, 10))) ? parseInt(salon_id, 10) : null;
      const cleanTolerancia = !isNaN(parseInt(tolerancia_minutos, 10)) ? parseInt(tolerancia_minutos, 10) : 15;

      // Buscar usuario correspondiente por email o nombre
      let userRecord = null;
      if (cleanEmail) {
        const [byEmail] = await pool.query('SELECT id FROM users WHERE email = ?', [cleanEmail]);
        if (byEmail.length > 0) userRecord = byEmail[0];
      }
      if (!userRecord && oldStaffRecord?.email) {
        const [byOldEmail] = await pool.query('SELECT id FROM users WHERE email = ?', [oldStaffRecord.email]);
        if (byOldEmail.length > 0) userRecord = byOldEmail[0];
      }
      if (!userRecord && cleanNombre) {
        const [byName] = await pool.query('SELECT id FROM users WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?))', [cleanNombre]);
        if (byName.length > 0) userRecord = byName[0];
      }
      if (!userRecord && oldStaffRecord?.nombre) {
        const [byOldName] = await pool.query('SELECT id FROM users WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?))', [oldStaffRecord.nombre]);
        if (byOldName.length > 0) userRecord = byOldName[0];
      }

      if (userRecord) {
        // Actualizar todos los datos del usuario en tiempo real
        await pool.query(
          `UPDATE users SET 
            nombre = COALESCE(?, nombre),
            email = COALESCE(?, email),
            salon_id = ?,
            profile_photo = COALESCE(?, profile_photo),
            hora_entrada = ?,
            hora_salida = ?,
            dias_laborables = ?,
            tolerancia_minutos = ?
          WHERE id = ?`,
          [
            cleanNombre,
            cleanEmail || null,
            cleanSalonId,
            profile_photo || null,
            hora_entrada || null,
            hora_salida || null,
            dias_laborables || null,
            cleanTolerancia,
            userRecord.id
          ]
        );

        // Si el estado del personal pasa a Inactivo / Cancelado, revocar de inmediato las sesiones activas
        if (status && (status.toLowerCase().includes('inactiv') || status.toLowerCase().includes('cancel') || status.toLowerCase().includes('desvincul'))) {
          await pool.query('UPDATE user_sessions SET is_active = 0 WHERE user_id = ?', [userRecord.id]);
          console.log(`[RRHH -> USERS SYNC] Sesiones cerradas de forma forzosa para ${cleanNombre} (ID: ${userRecord.id}) por estado ${status}`);
        }
      }
    } catch (syncErr) {
      console.warn('[RRHH -> USERS SYNC WARN]:', syncErr.message);
    }
  }

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

      await syncStaffToUser(req.body);
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

      const [current] = await pool.query('SELECT * FROM staff_records WHERE id = ?', [id]);
      const oldRecord = current && current[0] ? current[0] : null;
      const schemeChanged = oldRecord && oldRecord.commission_scheme_id !== schemeIdVal;

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

      // Sincronizar automáticamente hacia el registro de usuario en users y user_sessions
      await syncStaffToUser(req.body, oldRecord);

      res.json({ success: true, message: 'Ficha actualizada y sincronizada correctamente con usuarios' });
    } catch (err) {
      console.error('Error updating staff record:', err);
      res.status(500).json({ error: err.message });
    }
  };

  const handleDeleteStaff = async (req, res) => {
    try {
      const { id } = req.params;
      const [staffRows] = await pool.query('SELECT nombre, email FROM staff_records WHERE id = ?', [id]);
      const staff = staffRows[0];

      if (staff) {
        // Cerrar forzosamente cualquier sesión activa del usuario eliminado
        if (staff.email) {
          await pool.query('UPDATE user_sessions s JOIN users u ON s.user_id = u.id SET s.is_active = 0 WHERE u.email = ?', [staff.email]);
        }
        if (staff.nombre) {
          await pool.query('UPDATE user_sessions s JOIN users u ON s.user_id = u.id SET s.is_active = 0 WHERE LOWER(TRIM(u.nombre)) = LOWER(TRIM(?))', [staff.nombre]);
        }
      }

      await pool.query('DELETE FROM staff_records WHERE id = ?', [id]);
      res.json({ success: true, message: 'Colaborador eliminado y sesiones revocadas' });
    } catch (err) {
      console.error('Error deleting staff record:', err);
      res.status(500).json({ error: err.message });
    }
  };

  // Staff Positions (Cargos & Funciones)
  let isPositionsInitialized = false;
  const ensurePositionsTable = async () => {
    if (isPositionsInitialized) return;
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

      // Seed standard positions ONLY if the table is completely empty (first time run)
      const [existing] = await pool.query('SELECT COUNT(*) as count FROM staff_positions');
      if (existing && existing[0] && existing[0].count === 0) {
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
            `INSERT IGNORE INTO staff_positions (name, description, base_salary) VALUES (?, ?, ?)`,
            [name, desc, sal]
          );
        }
      }

      isPositionsInitialized = true;
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
      const { name, description, base_salary, old_name, sync_salaries } = req.body;
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

      // If sync_salaries is true (or undefined), update staff_records with the new base salary
      if (sync_salaries === true || sync_salaries === 'true' || sync_salaries === undefined) {
        await pool.query(
          'UPDATE staff_records SET salario_base = ? WHERE posicion = ? OR posicion = ?',
          [cleanSalary, cleanName, previousName]
        );
      }

      res.json({ success: true, message: 'Cargo y fichas de colaboradores actualizados correctamente' });
    } catch (err) {
      console.error('[PUT POSITION ERROR]', err);
      res.status(500).json({ error: err.message });
    }
  };

  const handleDeletePosition = async (req, res) => {
    try {
      const { id } = req.params;
      const nameQuery = req.query.name ? String(req.query.name).trim() : null;
      const isNumeric = !isNaN(parseInt(id, 10)) && /^\d+$/.test(String(id).trim());
      
      let posName = nameQuery || null;
      let posId = null;

      if (isNumeric) {
        posId = parseInt(id, 10);
        const [rows] = await pool.query('SELECT id, name FROM staff_positions WHERE id = ?', [posId]);
        if (rows.length > 0) {
          posName = rows[0].name;
        }
      } else {
        const decoded = decodeURIComponent(id).trim();
        if (!posName) posName = decoded;
        const [rows] = await pool.query('SELECT id, name FROM staff_positions WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))', [posName]);
        if (rows.length > 0) {
          posId = rows[0].id;
        }
      }

      if (!posName && nameQuery) {
        posName = nameQuery;
      }

      if (posName && req.query.force !== 'true') {
        const [staffCount] = await pool.query('SELECT COUNT(*) as cnt FROM staff_records WHERE LOWER(TRIM(posicion)) = LOWER(TRIM(?))', [posName]);
        if (staffCount[0] && staffCount[0].cnt > 0) {
          return res.status(400).json({ 
            error: `No se puede eliminar porque hay ${staffCount[0].cnt} colaborador(es) asignados a este cargo.`,
            staff_count: staffCount[0].cnt
          });
        }
      }

      if (posId) {
        await pool.query('DELETE FROM staff_positions WHERE id = ?', [posId]);
      }
      if (posName) {
        await pool.query('DELETE FROM staff_positions WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))', [posName]);
      }

      // If force delete, clear position in staff_records so no orphan positions or reactivation loops exist
      if (posName && req.query.force === 'true') {
        await pool.query('UPDATE staff_records SET posicion = "" WHERE LOWER(TRIM(posicion)) = LOWER(TRIM(?))', [posName]);
      }

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

