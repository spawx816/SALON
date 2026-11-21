const express = require('express');
const axios = require('axios');
const nodemailer = require('nodemailer');
const { getPrivateStorageAdapter } = require('../services/private_storage_adapter');

/**
 * Attendance and Facial Recognition Module for Empresa Pro & Plan Beauty RD
 * Scoped strictly by tenant_id (Multi-Tenant Architecture)
 * 
 * @param {import('mysql2/promise').Pool} pool
 */
function createAttendanceRouter(pool) {
  const router = express.Router();

  // Helper middleware to strictly require verified tenant context
  const requireTenant = (req, res, next) => {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Contexto de tenant requerido para operaciones de asistencia.' });
    }
    req.verifiedTenantId = tenantId;
    next();
  };

  router.use(requireTenant);

  // === ATTENDANCE / PONCHEO ===

  // PUT /api/users/:id/profile-photo - Save profile photo encrypted in private storage
  router.put('/users/:id/profile-photo', async (req, res) => {
    try {
      const { id } = req.params;
      const { profile_photo } = req.body;
      const tenantId = req.verifiedTenantId;

      if (!profile_photo) {
        return res.status(400).json({ error: 'La foto de perfil es requerida.' });
      }

      let fileId = null;
      try {
        const storage = getPrivateStorageAdapter({ pool });
        const saved = await storage.saveBase64({
          tenantId,
          category: 'profile_photo',
          base64Data: profile_photo
        });
        fileId = saved.id;
      } catch (storageErr) {
        console.warn('[STORAGE_ADAPTER_WARN] Could not encrypt profile photo:', storageErr.message);
      }

      await pool.query(
        'UPDATE users SET profile_photo = NULL, profile_photo_file_id = ? WHERE id::text = ? AND tenant_id = ?',
        [fileId, String(id), tenantId]
      );

      // Also try staff_records if not in users
      await pool.query(
        'UPDATE staff_records SET profile_photo = NULL, profile_photo_file_id = ? WHERE id::text = ? AND tenant_id = ?',
        [fileId, String(id), tenantId]
      );

      res.json({ success: true, message: 'Foto de perfil de asistencia actualizada exitosamente.', file_id: fileId });
    } catch (err) {
      console.error('[ATTENDANCE ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/users/:id/profile-photo - Retrieve profile photo for an employee
  router.get('/users/:id/profile-photo', async (req, res) => {
    try {
      const { id } = req.params;
      const tenantId = req.verifiedTenantId;
      const role = String(req.auth?.role || '').toLowerCase();
      const isSelf = String(req.auth?.id || '') === String(id);
      if (!isSelf && !['propietario', 'admin', 'gerente', 'supervisor'].includes(role)) {
        return res.status(403).json({ error: 'No tienes permiso para acceder a fotografías biométricas.' });
      }

      const [rows] = await pool.query(
        'SELECT profile_photo, profile_photo_file_id FROM users WHERE id::text = ? AND tenant_id = ?',
        [String(id), tenantId]
      );

      let targetFileId = rows && rows[0] ? rows[0].profile_photo_file_id : null;
      let rawBase64 = rows && rows[0] ? rows[0].profile_photo : null;

      if (!targetFileId && !rawBase64) {
        const [staffRows] = await pool.query(
          'SELECT profile_photo, profile_photo_file_id FROM staff_records WHERE id::text = ? AND tenant_id = ?',
          [String(id), tenantId]
        );
        if (staffRows && staffRows[0]) {
          targetFileId = staffRows[0].profile_photo_file_id;
          rawBase64 = staffRows[0].profile_photo;
        }
      }

      if (targetFileId) {
        try {
          const storage = getPrivateStorageAdapter({ pool });
          const fileData = await storage.readFile({ tenantId, fileId: targetFileId });
          const dataUri = `data:${fileData.mimeType};base64,${fileData.buffer.toString('base64')}`;
          return res.json({ profile_photo: dataUri, file_id: targetFileId });
        } catch (readErr) {
          console.warn('[STORAGE_READ_WARN]', readErr.message);
        }
      }

      if (rawBase64) {
        return res.json({ profile_photo: rawBase64 });
      }

      return res.status(404).json({ error: 'Empleado o foto no encontrada.' });
    } catch (err) {
      console.error('[ATTENDANCE ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/attendance/today/:employeeId - Get today's attendance logs for an employee (Scoped by tenant_id)
  router.get('/today/:employeeId', async (req, res) => {
    try {
      const { employeeId } = req.params;
      const tenantId = req.verifiedTenantId;
      const [rows] = await pool.query(`
        SELECT id, type, timestamp FROM attendance 
        WHERE employee_id = ? AND tenant_id = ? AND DATE(timestamp) = DATE(NOW())
        ORDER BY timestamp DESC
      `, [String(employeeId), tenantId]);
      res.json(rows);
    } catch (err) {
      console.error('[ATTENDANCE ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/attendance/schedule-overrides - Fetch all schedule overrides (audit log)
  router.get('/schedule-overrides', async (req, res) => {
    try {
      const { salonId } = req.query;
      const tenantId = req.verifiedTenantId || req.tenantId;
      let query = `
        SELECT o.*, COALESCE(s.nombre, u.nombre, u.name) AS "employeeName", COALESCE(s.salon_id, u.salon_id) AS salon_id
        FROM schedule_overrides o
        LEFT JOIN staff_records s ON o.employee_id = s.id::text AND s.tenant_id = o.tenant_id
        LEFT JOIN users u ON o.employee_id = u.id::text AND u.tenant_id = o.tenant_id
        WHERE o.tenant_id = ?
      `;
      const params = [tenantId];
      if (salonId) {
        query += ` AND COALESCE(s.salon_id, u.salon_id)::text = ?`;
        params.push(String(salonId));
      }
      query += ` ORDER BY o.date DESC, o.created_at DESC`;
      const [rows] = await pool.query(query, params);
      res.json(rows);
    } catch (err) {
      console.error('[ATTENDANCE ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  async function upsertScheduleOverride(runner, { tenantId, employeeId, date, origEntrada, origSalida, newEntrada, newSalida, reason, createdBy }) {
    await runner.query(
      `INSERT INTO schedule_overrides
       (employee_id, date, original_hora_entrada, original_hora_salida, new_hora_entrada, new_hora_salida, reason, created_by, status, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Activo', ?)
       ON CONFLICT (tenant_id, employee_id, date) DO UPDATE SET
         original_hora_entrada = EXCLUDED.original_hora_entrada,
         original_hora_salida = EXCLUDED.original_hora_salida,
         new_hora_entrada = EXCLUDED.new_hora_entrada,
         new_hora_salida = EXCLUDED.new_hora_salida,
         reason = EXCLUDED.reason,
         created_by = EXCLUDED.created_by,
         status = 'Activo'`,
      [String(employeeId), date, origEntrada, origSalida, newEntrada, newSalida, reason, createdBy, tenantId]
    );
  }

  // Helper para resolver el horario programado o descanso de un empleado en una fecha dada
  async function getEmployeeScheduleForDate(conn, empId, dateStr, tenantId) {
    const [over] = await conn.query(
      "SELECT new_hora_entrada, new_hora_salida FROM schedule_overrides WHERE tenant_id = ? AND employee_id = ? AND date = ? AND status = 'Activo'",
      [tenantId, String(empId), dateStr]
    );
    if (over.length > 0) {
      return {
        nombre: null,
        entrada: over[0].new_hora_entrada,
        salida: over[0].new_hora_salida,
        isDescanso: (!over[0].new_hora_entrada && !over[0].new_hora_salida)
      };
    }

    let [empData] = await conn.query(
      'SELECT id, nombre, hora_entrada, hora_salida, dias_laborables FROM staff_records WHERE tenant_id = ? AND id::text = ?',
      [tenantId, String(empId)]
    );
    if (empData.length === 0) {
      const [usrData] = await conn.query(
        'SELECT id, nombre, hora_entrada, hora_salida, dias_laborables FROM users WHERE tenant_id = ? AND id::text = ?',
        [tenantId, String(empId)]
      );
      empData = usrData;
    }

    const emp = empData.length > 0 ? empData[0] : null;
    const empName = emp ? emp.nombre : `Empleado #${empId}`;
    if (!emp) {
      return { nombre: empName, entrada: '09:00:00', salida: '18:00:00', isDescanso: false };
    }

    const dateObj = new Date(`${dateStr}T12:00:00-04:00`);
    const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const dayName = dayNames[dateObj.getDay()];
    const normDay = normalizeDayName(dayName);

    let entrada = null;
    let salida = null;
    let isWorking = false;

    if (emp.dias_laborables && typeof emp.dias_laborables === 'string' && emp.dias_laborables.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(emp.dias_laborables);
        const matchKey = Object.keys(parsed).find(k => normalizeDayName(k) === normDay);
        if (matchKey && parsed[matchKey]) {
          const ds = parsed[matchKey];
          if (ds.entrada && ds.salida) {
            entrada = ds.entrada.length === 5 ? `${ds.entrada}:00` : ds.entrada;
            salida = ds.salida.length === 5 ? `${ds.salida}:00` : ds.salida;
            isWorking = true;
          }
        }
      } catch (e) { }
    } else if (emp.dias_laborables) {
      const workingDays = emp.dias_laborables.split(',').map(d => normalizeDayName(d));
      if (workingDays.includes(normDay)) {
        entrada = emp.hora_entrada || '08:00:00';
        salida = emp.hora_salida || '17:00:00';
        isWorking = true;
      }
    } else if (emp.hora_entrada && emp.hora_salida) {
      entrada = emp.hora_entrada;
      salida = emp.hora_salida;
      isWorking = true;
    }

    return {
      nombre: empName,
      entrada: isWorking ? entrada : null,
      salida: isWorking ? salida : null,
      isDescanso: !isWorking
    };
  }

  // POST /api/attendance/schedule-swap - Swap shifts/schedules between two employees OR self-swap dates
  router.post('/schedule-swap', async (req, res) => {
    const tenantId = req.verifiedTenantId || req.tenantId;
    const connection = await pool.getConnection();
    try {
      const {
        employeeId1, employeeId2,
        date, date1, date2,
        dateFree, dateWork,
        newHoraEntrada, newHoraSalida,
        mode, reason, createdBy
      } = req.body;

      const isSelfSwap = mode === 'self' || (employeeId1 && employeeId1 === employeeId2) || (dateFree && dateWork);

      if (isSelfSwap) {
        const empId = employeeId1 || req.body.employeeId;
        const dFree = dateFree || date1;
        const dWork = dateWork || date2;

        if (!empId || !dFree || !dWork || !createdBy) {
          return res.status(400).json({ error: 'Faltan parámetros obligatorios para el cambio de día libre (empleado, fecha libre y fecha laborable).' });
        }

        await connection.beginTransaction();

        const schedFree = await getEmployeeScheduleForDate(connection, empId, dFree, tenantId);
        const resolvedEntrada = newHoraEntrada || schedFree.entrada || '08:00:00';
        const resolvedSalida = newHoraSalida || schedFree.salida || '17:00:00';

        // 1. Fecha que pasa a ser LIBRE
        const reasonFree = `Día libre intercambiado por laborar el ${dWork} - ${reason || 'Acuerdo de horario'}`;
        await connection.query(
          `INSERT INTO schedule_overrides 
           (tenant_id, employee_id, date, original_hora_entrada, original_hora_salida, new_hora_entrada, new_hora_salida, reason, created_by, status)
           VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, 'Activo')
           ON CONFLICT (tenant_id, employee_id, date) DO UPDATE SET
           original_hora_entrada = EXCLUDED.original_hora_entrada,
           original_hora_salida = EXCLUDED.original_hora_salida,
           new_hora_entrada = NULL,
           new_hora_salida = NULL,
           reason = EXCLUDED.reason,
           created_by = EXCLUDED.created_by,
           status = 'Activo'`,
          [tenantId, String(empId), dFree, schedFree.entrada, schedFree.salida, reasonFree, createdBy]
        );

        // Purgar Ausencia en dFree dentro del tenant
        await connection.query(
          "DELETE FROM attendance WHERE tenant_id = ? AND employee_id::text = ? AND (DATE(timestamp) = ? OR DATE(timestamp AT TIME ZONE 'America/Santo_Domingo') = ?) AND type = 'Ausencia'",
          [tenantId, String(empId), dFree, dFree]
        );

        // 2. Fecha que pasa a ser LABORABLE
        const schedWork = await getEmployeeScheduleForDate(connection, empId, dWork, tenantId);
        const reasonWork = `Día laborable trasladado del ${dFree} - ${reason || 'Acuerdo de horario'}`;
        await connection.query(
          `INSERT INTO schedule_overrides 
           (tenant_id, employee_id, date, original_hora_entrada, original_hora_salida, new_hora_entrada, new_hora_salida, reason, created_by, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Activo')
           ON CONFLICT (tenant_id, employee_id, date) DO UPDATE SET
           original_hora_entrada = EXCLUDED.original_hora_entrada,
           original_hora_salida = EXCLUDED.original_hora_salida,
           new_hora_entrada = EXCLUDED.new_hora_entrada,
           new_hora_salida = EXCLUDED.new_hora_salida,
           reason = EXCLUDED.reason,
           created_by = EXCLUDED.created_by,
           status = 'Activo'`,
          [tenantId, String(empId), dWork, schedWork.entrada, schedWork.salida, resolvedEntrada, resolvedSalida, reasonWork, createdBy]
        );

        await connection.commit();
        return res.json({
          success: true,
          message: `Cambio de día libre registrado para ${schedFree.nombre}: ${dFree} pasa a ser Libre y ${dWork} pasa a ser Laborable (${resolvedEntrada.slice(0, 5)} - ${resolvedSalida.slice(0, 5)}).`
        });
      }

      // --- Intercambio SWAP entre 2 empleados ---
      const swapDate1 = date1 || date;
      const swapDate2 = date2 || date;

      if (!employeeId1 || !employeeId2 || !swapDate1 || !createdBy) {
        return res.status(400).json({ error: 'Faltan parámetros obligatorios para el intercambio de turnos entre 2 empleados.' });
      }

      if (String(employeeId1) === String(employeeId2)) {
        return res.status(400).json({ error: 'Debes seleccionar dos empleados diferentes para realizar el intercambio.' });
      }

      await connection.beginTransaction();

      const sched1 = await getEmployeeScheduleForDate(connection, employeeId1, swapDate1, tenantId);
      const sched2 = await getEmployeeScheduleForDate(connection, employeeId2, swapDate2, tenantId);

      const desc1 = sched1.isDescanso ? 'Día Libre' : `${(sched1.entrada || '').slice(0, 5)} - ${(sched1.salida || '').slice(0, 5)}`;
      const desc2 = sched2.isDescanso ? 'Día Libre' : `${(sched2.entrada || '').slice(0, 5)} - ${(sched2.salida || '').slice(0, 5)}`;

      const reason1 = `Intercambio de turno con ${sched2.nombre} (Pasa de ${desc1} a ${desc2}) - ${reason || 'Acuerdo de horario'}`;
      const reason2 = `Intercambio de turno con ${sched1.nombre} (Pasa de ${desc2} a ${desc1}) - ${reason || 'Acuerdo de horario'}`;

      // Empleado 1 recibe el turno/horario del Empleado 2 en swapDate1
      await upsertScheduleOverride(connection, {
        tenantId,
        employeeId: employeeId1,
        date,
        origEntrada: sched1.entrada,
        origSalida: sched1.salida,
        newEntrada: sched2.entrada,
        newSalida: sched2.salida,
        reason: reason1,
        createdBy,
      });

      // Empleado 2 recibe el turno/horario del Empleado 1 en swapDate2
      await upsertScheduleOverride(connection, {
        tenantId,
        employeeId: employeeId2,
        date,
        origEntrada: sched2.entrada,
        origSalida: sched2.salida,
        newEntrada: sched1.entrada,
        newSalida: sched1.salida,
        reason: reason2,
        createdBy,
      });

      // Purgar ausencias autogeneradas en las fechas de swap para ambos empleados dentro del tenant
      await connection.query(
        "DELETE FROM attendance WHERE tenant_id = ? AND employee_id::text = ? AND (DATE(timestamp) = ? OR DATE(timestamp AT TIME ZONE 'America/Santo_Domingo') = ?) AND type = 'Ausencia'",
        [tenantId, String(employeeId1), swapDate1, swapDate1]
      );
      await connection.query(
        "DELETE FROM attendance WHERE tenant_id = ? AND employee_id::text = ? AND (DATE(timestamp) = ? OR DATE(timestamp AT TIME ZONE 'America/Santo_Domingo') = ?) AND type = 'Ausencia'",
        [tenantId, String(employeeId2), swapDate2, swapDate2]
      );

      await connection.commit();
      res.json({
        success: true,
        message: `Intercambio de turnos registrado con éxito: ${sched1.nombre} ahora tiene ${desc2} y ${sched2.nombre} tiene ${desc1}.`
      });
    } catch (err) {
      await connection.rollback();
      console.error('[ATTENDANCE ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    } finally {
      connection.release();
    }
  });

  // POST /api/attendance/schedule-override - Create or update a schedule override / Assign extraordinary rest day
  router.post('/schedule-override', async (req, res) => {
    try {
      const tenantId = req.verifiedTenantId || req.tenantId;
      const { employeeId, date, newHoraEntrada, newHoraSalida, isDescanso, reason, createdBy, adminPin } = req.body;

      if (!employeeId || !date || (!isDescanso && (!newHoraEntrada || !newHoraSalida)) || !reason || !createdBy) {
        return res.status(400).json({ error: 'Faltan parámetros obligatorios.' });
      }

      // Si es un descanso extraordinario, aplicar validación de perfil / autorización obligatoria
      if (isDescanso) {
        const userRole = (req.auth?.role || req.headers['x-user-role'] || req.body?.userRole || '').toLowerCase().trim();
        const isAdmin = userRole === 'admin' || userRole === 'administrador' || userRole === 'propietario' || userRole === 'owner' || userRole === 'gerente';

        if (!isAdmin) {
          // Perfil Recepción o no-admin: Requiere PIN de Administrador obligatorio
          const cleanPin = String(adminPin || '').trim();
          if (!cleanPin) {
            return res.status(403).json({
              error: 'Autorización requerida: Para asignar días de descanso extraordinarios desde el perfil de Recepción, se requiere obligatoriamente autorización con clave PIN de administrador.'
            });
          }

          // Validar PIN estrictamente contra security_settings del tenant (sin PINs hardcodeados)
          const [secSettings] = await pool.query('SELECT admin_pin, admin_pin_hash, active_otp_pin, otp_expires_at FROM security_settings WHERE tenant_id = ? LIMIT 1', [tenantId]);
          const sec = secSettings[0] || {};
          let isAuthorized = false;

          if (sec.active_otp_pin && cleanPin === String(sec.active_otp_pin).trim()) {
            if (!sec.otp_expires_at || new Date(sec.otp_expires_at) >= new Date()) {
              isAuthorized = true;
            }
          }
          if (!isAuthorized && (sec.admin_pin_hash || sec.admin_pin)) {
            const { verifyPin } = require('../services/pin_security.service');
            const verifyRes = await verifyPin(cleanPin, sec.admin_pin_hash || sec.admin_pin);
            isAuthorized = Boolean(verifyRes.matched);
          }

          if (!isAuthorized) {
            return res.status(403).json({
              error: 'PIN de Administrador incorrecto. No se autorizó la asignación del descanso extraordinario.'
            });
          }
        }
      }

      // Obtener horario original del empleado como referencia dentro del tenant
      const sched = await getEmployeeScheduleForDate(pool, employeeId, date, tenantId);
      const origEntrada = sched.entrada;
      const origSalida = sched.salida;

      const entradaVal = isDescanso ? null : newHoraEntrada;
      const salidaVal = isDescanso ? null : newHoraSalida;
      const finalReason = isDescanso
        ? (reason.startsWith('[Descanso Extraordinario]') ? reason : `[Descanso Extraordinario] ${reason}`)
        : reason;

      await upsertScheduleOverride(pool, {
        tenantId,
        employeeId,
        date,
        origEntrada,
        origSalida,
        newEntrada: newHoraEntrada,
        newSalida: newHoraSalida,
        reason,
        createdBy,
      });

      // Si es descanso, purgar cualquier ausencia registrada para ese día dentro del tenant
      if (isDescanso) {
        await pool.query(
          "DELETE FROM attendance WHERE tenant_id = ? AND employee_id::text = ? AND (DATE(timestamp) = ? OR DATE(timestamp AT TIME ZONE 'America/Santo_Domingo') = ?) AND type = 'Ausencia'",
          [tenantId, String(employeeId), date, date]
        );
      }

      res.json({
        success: true,
        message: isDescanso
          ? 'Día de descanso extraordinario asignado y autorizado exitosamente.'
          : 'Cambio de horario temporal registrado con éxito.'
      });
    } catch (err) {
      console.error('[ATTENDANCE ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/attendance/schedule-override/:id - Delete (annul) a schedule override
  router.delete('/schedule-override/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const [result] = await pool.query(
        "UPDATE schedule_overrides SET status = 'Anulado' WHERE id = ?",
        [String(id)]
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Cambio de horario no encontrado.' });
      }
      res.json({ success: true, message: 'Cambio de horario anulado con éxito.' });
    } catch (err) {
      console.error('[ATTENDANCE ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Helper functions for Dominican Republic Timezone (America/Santo_Domingo, UTC-4)
  function getDRDateString(date = new Date()) {
    const options = { timeZone: 'America/Santo_Domingo', year: 'numeric', month: '2-digit', day: '2-digit' };
    const formatter = new Intl.DateTimeFormat('en-US', options);
    const parts = formatter.formatToParts(date);
    const year = parts.find(p => p.type === 'year').value;
    const month = parts.find(p => p.type === 'month').value;
    const day = parts.find(p => p.type === 'day').value;
    return `${year}-${month}-${day}`;
  }

  function getDRTimestampString(date = new Date()) {
    const dateStr = getDRDateString(date);
    const timeOptions = { timeZone: 'America/Santo_Domingo', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    const timeFormatter = new Intl.DateTimeFormat('en-US', timeOptions);
    const timeParts = timeFormatter.formatToParts(date);
    const hour = timeParts.find(p => p.type === 'hour').value;
    const minute = timeParts.find(p => p.type === 'minute').value;
    const second = timeParts.find(p => p.type === 'second').value;
    return `${dateStr} ${hour}:${minute}:${second}`;
  }

  function normalizeDayName(name) {
    if (!name) return '';
    return name.trim().toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  async function verifyFacesWithCompreFace(webCamBuffer, refPhotoBuffer) {
    const compreFaceUrl = process.env.COMPREFACE_URL;
    const apiKey = process.env.COMPREFACE_API_KEY;

    if (!compreFaceUrl || !apiKey) {
      throw new Error('Servicio de verificación facial (CompreFace) no configurado en el servidor.');
    }

    try {
      const FormData = require('form-data');
      const form = new FormData();
      form.append('source_image', refPhotoBuffer, { filename: 'ref.jpg', contentType: 'image/jpeg' });
      form.append('target_image', webCamBuffer, { filename: 'webcam.jpg', contentType: 'image/jpeg' });

      const response = await axios.post(`${compreFaceUrl.replace(/\/$/, '')}/api/v1/verification/verify`, form, {
        headers: {
          ...form.getHeaders(),
          'x-api-key': apiKey
        },
        timeout: 8000
      });

      const data = response.data;
      if (data && data.result && data.result.length > 0) {
        const firstResult = data.result[0];
        const similarity = Array.isArray(firstResult?.face_matches) && firstResult.face_matches.length > 0
          ? firstResult.face_matches.reduce((max, m) => Math.max(max, Number(m?.similarity || 0)), 0)
          : Number(firstResult?.similarity || 0);
        const threshold = 0.75;
        return {
          isIdentical: similarity >= threshold,
          confidence: similarity
        };
      }
      return { isIdentical: false, confidence: 0 };
    } catch (e) {
      console.error('[COMPREFACE API ERROR]:', e.response?.data || e.message);
      throw new Error('Servicio de reconocimiento facial no disponible o error al procesar imágenes.');
    }
  }

  function base64ToBuffer(base64Str) {
    if (!base64Str) return null;
    const parts = base64Str.split(',');
    const rawBase64 = parts.length > 1 ? parts[1] : parts[0];
    return Buffer.from(rawBase64, 'base64');
  }

  // POST /api/attendance/punch - Record employee check-in or check-out
  router.post('/punch', async (req, res) => {
    try {
      const tenantId = req.verifiedTenantId;
      const { employeeId, type, photo, geolocation, deviceInfo } = req.body;

      if (!employeeId || !type || !photo) {
        return res.status(400).json({ error: 'Faltan datos obligatorios (empleado, tipo o foto).' });
      }

      let [employees] = await pool.query(
        'SELECT id, nombre, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos, profile_photo, profile_photo_file_id FROM staff_records WHERE id::text = ? AND tenant_id = ?',
        [String(employeeId), tenantId]
      );
      if (employees.length === 0) {
        const [systemUsers] = await pool.query(
          'SELECT id, nombre, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos, profile_photo, profile_photo_file_id FROM users WHERE id::text = ? AND tenant_id = ?',
          [String(employeeId), tenantId]
        );
        if (systemUsers.length === 0) {
          return res.status(404).json({ error: 'Empleado no encontrado en esta empresa.' });
        }
        employees = systemUsers;
      }

      const emp = employees[0];

      if (emp.profile_photo_file_id || emp.profile_photo) {
        try {
          const webCamBuffer = base64ToBuffer(photo);
          let refPhotoBuffer = null;
          if (emp.profile_photo_file_id) {
            const storage = getPrivateStorageAdapter({ pool });
            const fileData = await storage.readFile({ tenantId, fileId: emp.profile_photo_file_id });
            if (fileData?.buffer) refPhotoBuffer = fileData.buffer;
          } else if (emp.profile_photo) {
            refPhotoBuffer = base64ToBuffer(emp.profile_photo);
          }

          if (!webCamBuffer) {
            return res.status(400).json({ error: 'La captura de cámara enviada no es válida.' });
          }
          if (!refPhotoBuffer) {
            return res.status(400).json({ error: 'La foto de perfil del empleado no contiene datos de imagen válidos.' });
          }

          const verifyResult = await verifyFacesWithCompreFace(webCamBuffer, refPhotoBuffer);
          if (!verifyResult.isIdentical) {
            return res.status(400).json({ error: 'Verificación biométrica fallida. Su rostro no coincide con el empleado seleccionado.' });
          }
        } catch (faceErr) {
          console.error('[COMPREFACE EXCEPTION]:', faceErr.message);
          return res.status(400).json({ error: faceErr.message || 'Error al validar la biometría.' });
        }
      }

      let status = 'Normal';
      let latenessMinutes = 0;
      let extraMinutes = 0;

      const todayDateStr = getDRDateString();
      const [overrides] = await pool.query(
        "SELECT new_hora_entrada, new_hora_salida FROM schedule_overrides WHERE employee_id = ? AND date = ? AND status = 'Activo' AND tenant_id = ?",
        [String(employeeId), todayDateStr, tenantId]
      );

      const nowDRString = new Date().toLocaleString('en-US', { timeZone: 'America/Santo_Domingo' });
      const nowDRDate = new Date(nowDRString);
      const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
      const todayName = dayNames[nowDRDate.getDay()];

      let baseHoraEntrada = emp.hora_entrada;
      let baseHoraSalida = emp.hora_salida;

      if (emp.dias_laborables && emp.dias_laborables.trim().startsWith('{')) {
        try {
          const parsedSchedule = JSON.parse(emp.dias_laborables);
          const normalizedToday = normalizeDayName(todayName);
          const matchingKey = Object.keys(parsedSchedule).find(k => normalizeDayName(k) === normalizedToday);
          const daySched = matchingKey ? parsedSchedule[matchingKey] : null;
          if (daySched) {
            baseHoraEntrada = daySched.entrada || null;
            baseHoraSalida = daySched.salida || null;
          } else {
            baseHoraEntrada = null;
            baseHoraSalida = null;
          }
        } catch (e) {
          console.error("Error parsing employee daily schedule JSON:", e.message);
        }
      }

      let targetEntrada = overrides.length > 0 ? overrides[0].new_hora_entrada : baseHoraEntrada;
      let targetSalida = overrides.length > 0 ? overrides[0].new_hora_salida : baseHoraSalida;

      const punchHours = nowDRDate.getHours();
      const punchMinutes = nowDRDate.getMinutes();
      const currentMinutesFromMidnight = punchHours * 60 + punchMinutes;

      if (type === 'Check-In' && targetEntrada) {
        const [schedH, schedM] = targetEntrada.split(':').map(Number);
        const schedMinutesFromMidnight = schedH * 60 + schedM;
        const diff = currentMinutesFromMidnight - schedMinutesFromMidnight;
        const tolerance = emp.tolerancia_minutos !== null && emp.tolerancia_minutos !== undefined ? emp.tolerancia_minutos : 15;

        if (diff > tolerance) {
          status = 'Tardanza';
          latenessMinutes = diff;
        }
      } else if (type === 'Check-Out' && targetSalida) {
        const [schedH, schedM] = targetSalida.split(':').map(Number);
        const schedMinutesFromMidnight = schedH * 60 + schedM;
        const diff = currentMinutesFromMidnight - schedMinutesFromMidnight;

        if (diff > 0) {
          extraMinutes = diff;
        } else if (diff < 0) {
          status = 'Salida Temprana';
        }
      }

      const punchId = `ATT-${Date.now()}-${String(employeeId)}-${type.toUpperCase()}`;

      if (type === 'Check-In') {
        await pool.query(
          "DELETE FROM attendance WHERE employee_id = ? AND DATE(timestamp) = ? AND type = 'Ausencia' AND tenant_id = ?",
          [String(employeeId), todayDateStr, tenantId]
        );
      }

      let punchPhotoFileId = null;
      if (photo && typeof photo === 'string' && photo.length > 20) {
        try {
          const storage = getPrivateStorageAdapter({ pool });
          const savedFile = await storage.saveBase64({
            tenantId,
            category: 'attendance_photo',
            base64Data: photo,
            retentionDays: 90
          });
          punchPhotoFileId = savedFile.id;
        } catch (storageErr) {
          console.warn('[STORAGE_ADAPTER_WARN] Could not encrypt attendance punch photo:', storageErr.message);
        }
      }

      await pool.query(
        `INSERT INTO attendance (
           id, employee_id, type, photo, photo_file_id, geolocation, device_info, 
           timestamp, status, lateness_minutes, extra_minutes, tenant_id
         ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          punchId,
          String(employeeId),
          type,
          punchPhotoFileId,
          geolocation || null,
          deviceInfo || null,
          getDRTimestampString(),
          status,
          latenessMinutes,
          extraMinutes,
          tenantId
        ]
      );

      res.json({ success: true, message: `Ponche de ${type === 'Check-In' ? 'Entrada' : 'Salida'} registrado como ${status} correctamente.`, name: emp.nombre, photo_file_id: punchPhotoFileId });
    } catch (err) {
      console.error('[ATTENDANCE ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/attendance/today - Lightweight: only real punches for today (Scoped by tenant_id)
  router.get('/today', async (req, res) => {
    try {
      const tenantId = req.verifiedTenantId;
      const { salonId } = req.query;
      const todayStr = getDRDateString();
      let query = `
        SELECT a.id, a.employee_id, a.type, a.status, a.timestamp, a.lateness_minutes, a.extra_minutes
        FROM attendance a
        LEFT JOIN staff_records s ON a.employee_id = s.id::text AND s.tenant_id = a.tenant_id
        LEFT JOIN users u ON a.employee_id = u.id::text AND u.tenant_id = a.tenant_id
        WHERE a.tenant_id = ? AND DATE(a.timestamp) = ? AND a.type IN ('Check-In', 'Check-Out')
      `;
      const params = [tenantId, todayStr];
      if (salonId) {
        query += ` AND COALESCE(s.salon_id, u.salon_id) = ?`;
        params.push(String(salonId));
      }
      query += ` ORDER BY a.timestamp ASC`;
      const [rows] = await pool.query(query, params);
      res.json(rows);
    } catch (err) {
      console.error('[ATTENDANCE TODAY ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/attendance/punch-photo/:id - Stream decrypted punch validation photo (Scoped by tenant_id)
  router.get('/punch-photo/:id', async (req, res) => {
    try {
      const tenantId = req.verifiedTenantId;
      const [rows] = await pool.query(
        'SELECT photo, photo_file_id FROM attendance WHERE id = ? AND tenant_id = ? LIMIT 1',
        [String(req.params.id), tenantId]
      );
      if (!rows || rows.length === 0) return res.status(404).end();
      const rec = rows[0];

      if (rec.photo_file_id) {
        const storage = getPrivateStorageAdapter({ pool });
        const fileData = await storage.readFile({ tenantId, fileId: rec.photo_file_id });
        res.setHeader('Content-Type', fileData.mimeType || 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=300');
        return res.send(fileData.buffer);
      }

      if (rec.photo) {
        const match = String(rec.photo).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
        if (match) {
          res.setHeader('Content-Type', match[1]);
          res.setHeader('Cache-Control', 'private, max-age=300');
          return res.send(Buffer.from(match[2], 'base64'));
        }
      }
      return res.status(404).end();
    } catch (err) {
      console.error('[ATTENDANCE PUNCH PHOTO ERROR]:', err.message);
      return res.status(404).end();
    }
  });

  // GET /api/attendance/history - Fetch historical attendance logs for admin panel (Scoped by tenant_id)
  router.get('/history', async (req, res) => {
    try {
      const tenantId = req.verifiedTenantId;
      const { startDate, endDate, employeeId, salonId } = req.query;

      const start = startDate || getDRDateString(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
      const end = endDate || getDRDateString();

      const [staff] = await pool.query(
        "SELECT id, nombre, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos, salon_id, fecha_entrada FROM staff_records WHERE tenant_id = ? AND (status = 'Activo' OR status = 'Active')",
        [tenantId]
      );
      const [users] = await pool.query(
        "SELECT u.id, COALESCE(u.nombre, u.name) AS nombre, u.role, u.hora_entrada, u.hora_salida, u.dias_laborables, u.tolerancia_minutos, u.salon_id, r.nombre AS role_name, u.created_at AS fecha_entrada FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.tenant_id = ? AND (u.is_active IS NULL OR u.is_active = TRUE)",
        [tenantId]
      );
      const systemStaff = users.filter(u => {
        const role = String(u.role_name || u.role || '').toLowerCase();
        const sysRole = String(u.role || '').toLowerCase();
        return !role.includes('admin') && !role.includes('client') && sysRole !== 'kiosco_asistencia' && sysRole !== 'propietario' && sysRole !== 'owner';
      });

      let allEmployees = [...staff];
      systemStaff.forEach(sysUser => {
        const sysName = String(sysUser.nombre || '').toLowerCase().trim();
        if (sysName && !allEmployees.some(c => String(c.nombre || '').toLowerCase().trim() === sysName)) {
          allEmployees.push(sysUser);
        }
      });

      if (salonId) {
        allEmployees = allEmployees.filter(emp => String(emp.salon_id) === String(salonId));
      }

      const [rangeOverrides] = await pool.query(
        "SELECT employee_id, TO_CHAR(date, 'YYYY-MM-DD') as \"dateStr\", new_hora_entrada, new_hora_salida FROM schedule_overrides WHERE tenant_id = ? AND date >= ? AND date <= ? AND status = 'Activo'",
        [tenantId, start, end]
      );
      const overrideMap = new Map();
      rangeOverrides.forEach(o => {
        overrideMap.set(`${o.employee_id}:${o.dateStr}`, o);
      });

      const [existingPunches] = await pool.query(
        "SELECT employee_id, TO_CHAR(timestamp, 'YYYY-MM-DD') as \"dateStr\", type FROM attendance WHERE tenant_id = ? AND timestamp >= ? AND timestamp <= ?",
        [tenantId, `${start} 00:00:00`, `${end} 23:59:59`]
      );

      const absentSet = new Set(existingPunches.filter(p => p.type === 'Ausencia').map(p => `${p.employee_id}:${p.dateStr}`));
      const checkinSet = new Set(existingPunches.filter(p => p.type === 'Check-In').map(p => `${p.employee_id}:${p.dateStr}`));

      const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
      const curDate = new Date(start + 'T12:00:00');
      const endDateObj = new Date(end + 'T12:00:00');
      const todayStr = getDRDateString();

      while (curDate <= endDateObj) {
        const dateStr = getDRDateString(curDate);
        const dayName = dayNames[curDate.getDay()];

        for (const emp of allEmployees) {
          const empHireDateStr = emp.fecha_entrada ? getDRDateString(new Date(emp.fecha_entrada)) : null;
          if (empHireDateStr && dateStr < empHireDateStr) continue;

          let isWorkingDay = false;
          if (emp.dias_laborables && emp.dias_laborables.trim().startsWith('{')) {
            try {
              const parsed = JSON.parse(emp.dias_laborables);
              const normalizedDay = normalizeDayName(dayName);
              const matchingKey = Object.keys(parsed).find(k => normalizeDayName(k) === normalizedDay);
              const daySched = matchingKey ? parsed[matchingKey] : null;
              if (daySched && daySched.entrada && daySched.salida) isWorkingDay = true;
            } catch (e) { }
          } else if (emp.dias_laborables) {
            const workingDays = emp.dias_laborables.split(',');
            const normalizedDay = normalizeDayName(dayName);
            isWorkingDay = workingDays.some(d => normalizeDayName(d) === normalizedDay);
          }

          const override = overrideMap.get(`${emp.id}:${dateStr}`);
          let shouldWork = isWorkingDay;
          if (override) {
            // Si el override no tiene hora de entrada ni salida, es un Descanso Extraordinario Autorizado
            if (!override.new_hora_entrada && !override.new_hora_salida) {
              shouldWork = false;
            } else {
              shouldWork = true;
            }
          }

          if (shouldWork && dateStr < todayStr) {
            const key = `${emp.id}:${dateStr}`;
            if (!checkinSet.has(key) && !absentSet.has(key)) {
              const absentId = `ABSENT-${dateStr}-${emp.id}`;
              try {
                await pool.query(
                  `INSERT INTO attendance (id, tenant_id, employee_id, type, photo, geolocation, device_info, timestamp, status, lateness_minutes, extra_minutes)
                   VALUES (?, ?, ?, 'Ausencia', NULL, NULL, 'Generado automáticamente por sistema', ?, 'Ausencia', 0, 0)
                   ON CONFLICT (id) DO NOTHING`,
                  [absentId, tenantId, String(emp.id), `${dateStr} 23:59:59`]
                );
                absentSet.add(key);
              } catch (e) { }
            }
          }
        }
        curDate.setDate(curDate.getDate() + 1);
      }

      let query = `
        SELECT 
          a.id, a.employee_id, 
          COALESCE(s.nombre, u.nombre, u.name) AS "employeeName",
          COALESCE(s.salon_id, u.salon_id) AS salon_id,
          a.type, a.status, a.timestamp,
          a.lateness_minutes, a.extra_minutes,
          a.photo, a.photo_file_id, a.geolocation, a.device_info,
          a.is_manual, a.modified_by, a.modified_at, a.modification_reason
        FROM attendance a
        LEFT JOIN staff_records s ON a.employee_id = s.id::text AND s.tenant_id = a.tenant_id
        LEFT JOIN users u ON a.employee_id = u.id::text AND u.tenant_id = a.tenant_id
        WHERE a.tenant_id = ? AND a.timestamp >= ? AND a.timestamp <= ?
      `;
      const queryParams = [tenantId, `${start} 00:00:00`, `${end} 23:59:59`];

      if (employeeId) {
        query += ` AND a.employee_id = ?`;
        queryParams.push(String(employeeId));
      }
      if (salonId) {
        query += ` AND COALESCE(s.salon_id, u.salon_id) = ?`;
        queryParams.push(String(salonId));
      }

      query += ` ORDER BY a.timestamp DESC`;
      const [rows] = await pool.query(query, queryParams);
      const hydratedRows = (rows || []).map((row) => ({
        ...row,
        photo: row.photo_file_id
          ? `/api/attendance/punch-photo/${encodeURIComponent(row.id)}?v=${encodeURIComponent(row.photo_file_id)}`
          : (row.photo || null),
      }));
      res.json(hydratedRows);
    } catch (err) {
      console.error('[ATTENDANCE HISTORY ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/attendance/pending - Fetch all pending attendance records (missing check-in/out)
  router.get('/pending', async (req, res) => {
    try {
      const tenantId = req.verifiedTenantId;
      const { startDate, endDate, employeeId, salonId } = req.query;

      const start = startDate || getDRDateString(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
      const end = endDate || getDRDateString();

      const [staff] = await pool.query(
        "SELECT id, nombre, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos, salon_id FROM staff_records WHERE tenant_id = ? AND (status = 'Activo' OR status = 'Active')",
        [tenantId]
      );
      const [users] = await pool.query(
        "SELECT u.id, COALESCE(u.nombre, u.name) AS nombre, u.role, u.hora_entrada, u.hora_salida, u.dias_laborables, u.tolerancia_minutos, u.salon_id, r.nombre AS role_name FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.tenant_id = ? AND (u.is_active IS NULL OR u.is_active = TRUE)",
        [tenantId]
      );
      const systemStaff = users.filter(u => {
        const role = String(u.role_name || u.role || '').toLowerCase();
        const sysRole = String(u.role || '').toLowerCase();
        return !role.includes('admin') && !role.includes('client') && sysRole !== 'kiosco_asistencia' && sysRole !== 'propietario' && sysRole !== 'owner';
      });

      const allEmployees = [...staff];
      systemStaff.forEach(sysUser => {
        const sysName = String(sysUser.nombre || '').toLowerCase().trim();
        if (sysName && !allEmployees.some(c => String(c.nombre || '').toLowerCase().trim() === sysName)) {
          allEmployees.push(sysUser);
        }
      });

      let filteredEmployees = allEmployees;
      if (employeeId) {
        filteredEmployees = filteredEmployees.filter(e => String(e.id) === String(employeeId));
      }
      if (salonId) {
        filteredEmployees = filteredEmployees.filter(e => String(e.salon_id) === String(salonId));
      }

      const [rangeOverrides] = await pool.query(
        "SELECT employee_id, TO_CHAR(date, 'YYYY-MM-DD') as \"dateStr\", new_hora_entrada, new_hora_salida FROM schedule_overrides WHERE tenant_id = ? AND date >= ? AND date <= ? AND status = 'Activo'",
        [tenantId, start, end]
      );
      const overrideMap = new Map();
      rangeOverrides.forEach(o => {
        overrideMap.set(`${o.employee_id}:${o.dateStr}`, o);
      });

      const [punches] = await pool.query(
        "SELECT id, employee_id, type, TO_CHAR(timestamp, 'YYYY-MM-DD') as \"dateStr\", TO_CHAR(timestamp, 'HH24:MI:SS') as \"timeStr\", timestamp, status, is_manual, modified_by, modified_at, modification_reason FROM attendance WHERE tenant_id = ? AND timestamp >= ? AND timestamp <= ?",
        [tenantId, `${start} 00:00:00`, `${end} 23:59:59`]
      );

      const punchMap = new Map();
      punches.forEach(p => {
        const key = `${p.employee_id}:${p.dateStr}`;
        if (!punchMap.has(key)) {
          punchMap.set(key, []);
        }
        punchMap.get(key).push(p);
      });

      const pendingIncidents = [];
      const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

      const curDate = new Date(start + 'T12:00:00');
      const endDateObj = new Date(end + 'T12:00:00');
      const todayStr = getDRDateString();

      while (curDate <= endDateObj) {
        const dateStr = getDRDateString(curDate);
        const dayName = dayNames[curDate.getDay()];

        for (const emp of filteredEmployees) {
          let isWorkingDay = false;
          let empDailyHoraEntrada = emp.hora_entrada;
          let empDailyHoraSalida = emp.hora_salida;

          if (emp.dias_laborables && emp.dias_laborables.trim().startsWith('{')) {
            try {
              const parsed = JSON.parse(emp.dias_laborables);
              const normalizedDay = normalizeDayName(dayName);
              const matchingKey = Object.keys(parsed).find(k => normalizeDayName(k) === normalizedDay);
              const daySched = matchingKey ? parsed[matchingKey] : null;
              if (daySched && daySched.entrada && daySched.salida) {
                isWorkingDay = true;
                empDailyHoraEntrada = daySched.entrada;
                empDailyHoraSalida = daySched.salida;
              }
            } catch (e) { }
          } else if (emp.dias_laborables) {
            const workingDays = emp.dias_laborables.split(',');
            const normalizedDay = normalizeDayName(dayName);
            isWorkingDay = workingDays.some(d => normalizeDayName(d) === normalizedDay);
          }

          const effectiveOverride = overrideMap.get(`${emp.id}:${dateStr}`);
          let shouldWork = isWorkingDay;
          if (effectiveOverride) {
            if (!effectiveOverride.new_hora_entrada && !effectiveOverride.new_hora_salida) {
              shouldWork = false;
            } else {
              shouldWork = true;
            }
          }

          if (shouldWork) {
            const key = `${emp.id}:${dateStr}`;
            const dayPunches = punchMap.get(key) || [];

            const checkIn = dayPunches.find(p => p.type === 'Check-In');
            const checkOut = dayPunches.find(p => p.type === 'Check-Out');
            const isAbsent = dayPunches.some(p => p.type === 'Ausencia');

            if (isAbsent && !checkIn && !checkOut) continue;

            const isPastDay = dateStr < todayStr;
            const isToday = dateStr === todayStr;

            let missingType = null;
            if (isPastDay) {
              if (!checkIn && checkOut) missingType = 'missing_checkin';
              else if (checkIn && !checkOut) missingType = 'missing_checkout';
              else if (!checkIn && !checkOut) missingType = 'missing_both';
            } else if (isToday) {
              if (checkIn && !checkOut) {
                const targetOut = effectiveOverride ? effectiveOverride.new_hora_salida : empDailyHoraSalida;
                if (targetOut) {
                  const nowDR = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Santo_Domingo' }));
                  const [outH, outM] = targetOut.split(':').map(Number);
                  const scheduledOutMins = outH * 60 + outM;
                  const currentMins = nowDR.getHours() * 60 + nowDR.getMinutes();
                  if (currentMins > scheduledOutMins + 60) {
                    missingType = 'missing_checkout';
                  }
                }
              }
            }

            if (missingType) {
              pendingIncidents.push({
                employeeId: emp.id,
                employeeName: emp.nombre,
                salonId: emp.salon_id,
                date: dateStr,
                incidentType: missingType,
                expectedEntrada: effectiveOverride ? effectiveOverride.new_hora_entrada : empDailyHoraEntrada,
                expectedSalida: effectiveOverride ? effectiveOverride.new_hora_salida : empDailyHoraSalida,
                actualCheckIn: checkIn ? checkIn.timeStr : null,
                actualCheckOut: checkOut ? checkOut.timeStr : null,
                punches: dayPunches
              });
            }
          }
        }
        curDate.setDate(curDate.getDate() + 1);
      }

      res.json(pendingIncidents);
    } catch (err) {
      console.error('[ATTENDANCE PENDING ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/attendance/adjust - Manually adjust missing check-in/out with audit log (Scoped by tenant_id)
  router.post('/adjust', async (req, res) => {
    try {
      const tenantId = req.verifiedTenantId;
      const { employeeId, date, checkInTime, checkOutTime, reason, modifiedBy } = req.body;

      if (!employeeId || !date || !reason || !modifiedBy) {
        return res.status(400).json({ error: 'Faltan datos obligatorios (empleado, fecha, motivo o administrador).' });
      }

      await pool.query(
        "DELETE FROM attendance WHERE employee_id = ? AND DATE(timestamp) = ? AND type = 'Ausencia' AND tenant_id = ?",
        [String(employeeId), date, tenantId]
      );

      if (checkInTime) {
        const [existingIn] = await pool.query(
          "SELECT id FROM attendance WHERE employee_id = ? AND DATE(timestamp) = ? AND type = 'Check-In' AND tenant_id = ?",
          [String(employeeId), date, tenantId]
        );

        const timestampStr = `${date} ${checkInTime}:00`;

        let [employees] = await pool.query(
          'SELECT id, nombre, hora_entrada, dias_laborables, tolerancia_minutos FROM staff_records WHERE id::text = ? AND tenant_id = ?',
          [String(employeeId), tenantId]
        );
        if (employees.length === 0) {
          const [users] = await pool.query(
            'SELECT id, nombre, hora_entrada, dias_laborables, tolerancia_minutos FROM users WHERE id::text = ? AND tenant_id = ?',
            [String(employeeId), tenantId]
          );
          employees = users;
        }
        if (employees.length === 0) {
          return res.status(404).json({ error: 'Colaborador no encontrado para esta empresa.' });
        }
        const emp = employees[0];

        const [overrides] = await pool.query(
          "SELECT new_hora_entrada FROM schedule_overrides WHERE employee_id = ? AND date = ? AND status = 'Activo' AND tenant_id = ?",
          [String(employeeId), date, tenantId]
        );

        let expectedEntrada = emp ? emp.hora_entrada : '09:00:00';
        if (overrides.length > 0) {
          expectedEntrada = overrides[0].new_hora_entrada;
        }

        let status = 'Normal';
        let latenessMinutes = 0;
        if (expectedEntrada) {
          try {
            const [expH, expM] = expectedEntrada.split(':').map(Number);
            const [actH, actM] = checkInTime.split(':').map(Number);
            const diff = (actH * 60 + actM) - (expH * 60 + expM);
            const grace = emp && emp.tolerancia_minutos !== null && emp.tolerancia_minutos !== undefined ? emp.tolerancia_minutos : 15;
            if (diff > grace) {
              status = 'Tardanza';
              latenessMinutes = diff;
            }
          } catch (e) { }
        }

        if (existingIn.length > 0) {
          await pool.query(
            `UPDATE attendance 
             SET timestamp = ?, status = ?, lateness_minutes = ?, is_manual = 1, modified_by = ?, modified_at = NOW(), modification_reason = ? 
             WHERE id = ? AND tenant_id = ?`,
            [timestampStr, status, latenessMinutes, modifiedBy, reason, existingIn[0].id, tenantId]
          );
        } else {
          const punchId = `MANUAL-IN-${Date.now()}-${String(employeeId)}-${date}`;
          await pool.query(
            `INSERT INTO attendance (id, employee_id, type, photo, geolocation, device_info, timestamp, status, lateness_minutes, is_manual, modified_by, modified_at, modification_reason, tenant_id) 
             VALUES (?, ?, 'Check-In', NULL, NULL, 'Ajuste Manual por Administrador', ?, ?, ?, 1, ?, NOW(), ?, ?)`,
            [punchId, String(employeeId), timestampStr, status, latenessMinutes, modifiedBy, reason, tenantId]
          );
        }
      }

      if (checkOutTime) {
        const [existingOut] = await pool.query(
          "SELECT id FROM attendance WHERE employee_id = ? AND DATE(timestamp) = ? AND type = 'Check-Out' AND tenant_id = ?",
          [String(employeeId), date, tenantId]
        );

        const timestampStr = `${date} ${checkOutTime}:00`;

        let [employees] = await pool.query(
          'SELECT id, nombre, hora_salida, dias_laborables FROM staff_records WHERE id::text = ? AND tenant_id = ?',
          [String(employeeId), tenantId]
        );
        if (employees.length === 0) {
          const [users] = await pool.query(
            'SELECT id, nombre, hora_salida, dias_laborables FROM users WHERE id::text = ? AND tenant_id = ?',
            [String(employeeId), tenantId]
          );
          employees = users;
        }
        const emp = employees[0];

        const [overrides] = await pool.query(
          "SELECT new_hora_salida FROM schedule_overrides WHERE employee_id = ? AND date = ? AND status = 'Activo' AND tenant_id = ?",
          [String(employeeId), date, tenantId]
        );

        let expectedSalida = emp ? emp.hora_salida : '18:00:00';
        if (overrides.length > 0) {
          expectedSalida = overrides[0].new_hora_salida;
        }

        let extraMinutes = 0;
        let outStatus = 'Normal';
        if (expectedSalida) {
          try {
            const [expH, expM] = expectedSalida.split(':').map(Number);
            const [actH, actM] = checkOutTime.split(':').map(Number);
            const diff = (actH * 60 + actM) - (expH * 60 + expM);
            if (diff > 0) extraMinutes = diff;
            else if (diff < 0) outStatus = 'Salida Temprana';
          } catch (e) { }
        }

        if (existingOut.length > 0) {
          await pool.query(
            `UPDATE attendance 
             SET timestamp = ?, status = ?, extra_minutes = ?, is_manual = 1, modified_by = ?, modified_at = NOW(), modification_reason = ? 
             WHERE id = ? AND tenant_id = ?`,
            [timestampStr, outStatus, extraMinutes, modifiedBy, reason, existingOut[0].id, tenantId]
          );
        } else {
          const punchId = `MANUAL-OUT-${Date.now()}-${String(employeeId)}-${date}`;
          await pool.query(
            `INSERT INTO attendance (id, employee_id, type, photo, geolocation, device_info, timestamp, status, extra_minutes, is_manual, modified_by, modified_at, modification_reason, tenant_id) 
             VALUES (?, ?, 'Check-Out', NULL, NULL, 'Ajuste Manual por Administrador', ?, ?, ?, 1, ?, NOW(), ?, ?)`,
            [punchId, String(employeeId), timestampStr, outStatus, extraMinutes, modifiedBy, reason, tenantId]
          );
        }
      }

      res.json({ success: true, message: 'Registro de asistencia regularizado con éxito.' });
    } catch (err) {
      console.error('[ATTENDANCE ADJUST ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/attendance/notify-pending - Send feedback email to employee regarding missing punch (Scoped by tenant_id)
  router.post('/notify-pending', async (req, res) => {
    try {
      const tenantId = req.verifiedTenantId;
      const { employeeId, date, incidentType } = req.body;

      if (!employeeId || !date || !incidentType) {
        return res.status(400).json({ error: 'Faltan datos obligatorios (empleado, fecha o tipo de incidencia).' });
      }

      let [employees] = await pool.query(
        'SELECT id, nombre, email FROM staff_records WHERE id::text = ? AND tenant_id = ?',
        [String(employeeId), tenantId]
      );

      let empName = '';
      let empEmail = '';
      let empId = employeeId;

      if (employees.length > 0) {
        empName = employees[0].nombre;
        empEmail = employees[0].email;

        if (!empEmail) {
          const [userEmailRows] = await pool.query(
            'SELECT email FROM users WHERE nombre = ? AND tenant_id = ? AND email IS NOT NULL AND email != ""',
            [empName, tenantId]
          );
          if (userEmailRows.length > 0) {
            empEmail = userEmailRows[0].email;
          }
        }
      } else {
        const [users] = await pool.query(
          'SELECT id, nombre, email FROM users WHERE id::text = ? AND tenant_id = ?',
          [String(employeeId), tenantId]
        );
        if (users.length > 0) {
          empName = users[0].nombre;
          empEmail = users[0].email;
          empId = users[0].id;
        }
      }

      if (!empName) {
        return res.status(404).json({ error: 'Empleado no encontrado en esta empresa.' });
      }

      if (!empEmail) {
        return res.status(400).json({ error: 'El empleado no tiene un correo electrónico configurado.' });
      }

      const emp = { id: empId, nombre: empName, email: empEmail };
      const incidentLabel = incidentType === 'missing_checkin'
        ? 'Falta registro de Entrada (Check-In)'
        : incidentType === 'missing_checkout'
          ? 'Falta registro de Salida (Check-Out)'
          : 'Falta registro completo (Entrada y Salida)';

      const [smtpRows] = await pool.query('SELECT * FROM email_settings WHERE tenant_id = ? LIMIT 1', [tenantId]);
      const smtp = smtpRows[0] || {};
      const transporter = nodemailer.createTransport({
        host: smtp.smtp_host || process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(smtp.smtp_port || process.env.SMTP_PORT || '587'),
        secure: smtp.smtp_secure === 1,
        auth: {
          user: smtp.smtp_user || process.env.SMTP_USER,
          pass: smtp.smtp_pass || process.env.SMTP_PASS
        }
      });

      const smtpFrom = smtp.smtp_from || process.env.SMTP_FROM || 'notificaciones@salonpro.io';
      const smtpUser = smtp.smtp_user || process.env.SMTP_USER;

      await transporter.sendMail({
        from: `"${smtpFrom}" <${smtpUser}>`,
        to: emp.email,
        subject: `⚠️ Aviso de Registro de Asistencia Omitido - ${date}`,
        text: `Hola ${emp.nombre},\n\nSe ha detectado una omisión en tu registro de asistencia para el día ${date}.\nIncidencia: ${incidentLabel}.\n\nPor favor regulariza tu marca con administración.`,
        html: `<p>Hola <strong>${emp.nombre}</strong>,</p><p>Se ha detectado una omisión en tu asistencia del día <strong>${date}</strong>: <em>${incidentLabel}</em>.</p>`
      });

      await pool.query(
        `INSERT INTO email_logs (client_id, email_type, recipient_email, subject, sent_at, tenant_id) 
         VALUES (?, 'attendance_warning', ?, ?, NOW(), ?)`,
        [String(emp.id), emp.email, `Aviso de Registro de Asistencia Omitido - ${date}`, tenantId]
      );

      res.json({ success: true, message: `Correo de advertencia enviado a ${emp.email}.` });
    } catch (err) {
      console.error('[ATTENDANCE NOTIFY ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createAttendanceRouter };
