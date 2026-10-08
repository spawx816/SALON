const express = require('express');
const axios = require('axios');
const nodemailer = require('nodemailer');

/**
 * Attendance and Facial Recognition Module for Salon Pro & Plan Beauty RD
 * 
 * @param {import('mysql2/promise').Pool} pool
 */
function createAttendanceRouter(pool) {
  const router = express.Router();

// === ATTENDANCE / PONCHEO ===

// PUT /api/users/:id/profile-photo - Save profile photo (base64) for facial recognition
router.put('/users/:id/profile-photo', async (req, res) => {
  try {
    const { id } = req.params;
    const { profile_photo } = req.body; // base64 string
    
    if (!profile_photo) {
      return res.status(400).json({ error: 'La foto de perfil es requerida.' });
    }
    
    await pool.query('UPDATE users SET profile_photo = ? WHERE id = ?', [profile_photo, id]);
    res.json({ success: true, message: 'Foto de perfil de asistencia actualizada exitosamente.' });
  } catch (err) {
    console.error('[ATTENDANCE ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users/:id/profile-photo - Retrieve profile photo for an employee
router.get('/users/:id/profile-photo', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT profile_photo FROM users WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Empleado no encontrado.' });
    }
    res.json({ profile_photo: rows[0].profile_photo });
  } catch (err) {
    console.error('[ATTENDANCE ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/attendance/today/:employeeId - Get today's attendance logs for an employee
router.get('/today/:employeeId', async (req, res) => {
  try {
    const { employeeId } = req.params;
    const [rows] = await pool.query(
      `SELECT id, type, timestamp FROM attendance 
       WHERE employee_id = ? AND DATE(timestamp) = DATE(NOW())
       ORDER BY timestamp DESC`,
      [employeeId]
    );
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
    let query = `SELECT o.*, COALESCE(s.nombre, u.nombre) as employeeName, COALESCE(s.salon_id, u.salon_id) as salon_id
       FROM schedule_overrides o
       LEFT JOIN staff_records s ON o.employee_id = s.id
       LEFT JOIN users u ON o.employee_id = u.id`;
    const params = [];
    if (salonId) {
      query += ` WHERE COALESCE(s.salon_id, u.salon_id) = ?`;
      params.push(salonId);
    }
    query += ` ORDER BY o.date DESC, o.created_at DESC`;
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('[ATTENDANCE ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/attendance/schedule-swap - Swap shifts/schedules between two employees
router.post('/schedule-swap', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { employeeId1, employeeId2, date, reason, createdBy } = req.body;
    if (!employeeId1 || !employeeId2 || !date || !createdBy) {
      return res.status(400).json({ error: 'Faltan parámetros obligatorios para el intercambio.' });
    }

    await connection.beginTransaction();

    // Helper function to get effective schedule (looks in overrides first, then standard profiles)
    const getSchedule = async (empId) => {
      // Check overrides first
      const [over] = await connection.query(
        "SELECT new_hora_entrada, new_hora_salida FROM schedule_overrides WHERE employee_id = ? AND date = ? AND status = 'Activo'",
        [empId, date]
      );
      if (over.length > 0) {
        return { entrada: over[0].new_hora_entrada, salida: over[0].new_hora_salida };
      }

      // Check standard profile
      let [empData] = await connection.query(
        'SELECT nombre, hora_entrada, hora_salida FROM staff_records WHERE id = ?',
        [empId]
      );
      if (empData.length === 0) {
        const [usrData] = await connection.query(
          'SELECT nombre, hora_entrada, hora_salida FROM users WHERE id = ?',
          [empId]
        );
        empData = usrData;
      }
      return {
        nombre: empData.length > 0 ? empData[0].nombre : `Empleado #${empId}`,
        entrada: (empData.length > 0 && empData[0].hora_entrada) ? empData[0].hora_entrada : '09:00:00',
        salida: (empData.length > 0 && empData[0].hora_salida) ? empData[0].hora_salida : '18:00:00'
      };
    };

    const sched1 = await getSchedule(employeeId1);
    const sched2 = await getSchedule(employeeId2);

    const reason1 = `Intercambio de turno con ${sched2.nombre} - ${reason || 'Permiso especial'}`;
    const reason2 = `Intercambio de turno con ${sched1.nombre} - ${reason || 'Permiso especial'}`;

    // Apply cross-overrides
    // Employee 1 gets Employee 2's schedule
    await connection.query(
      `INSERT INTO schedule_overrides 
       (employee_id, date, original_hora_entrada, original_hora_salida, new_hora_entrada, new_hora_salida, reason, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
       original_hora_entrada = VALUES(original_hora_entrada),
       original_hora_salida = VALUES(original_hora_salida),
       new_hora_entrada = VALUES(new_hora_entrada),
       new_hora_salida = VALUES(new_hora_salida),
       reason = VALUES(reason),
       created_by = VALUES(created_by),
       status = 'Activo'`,
      [employeeId1, date, sched1.entrada, sched1.salida, sched2.entrada, sched2.salida, reason1, createdBy]
    );

    // Employee 2 gets Employee 1's schedule
    await connection.query(
      `INSERT INTO schedule_overrides 
       (employee_id, date, original_hora_entrada, original_hora_salida, new_hora_entrada, new_hora_salida, reason, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
       original_hora_entrada = VALUES(original_hora_entrada),
       original_hora_salida = VALUES(original_hora_salida),
       new_hora_entrada = VALUES(new_hora_entrada),
       new_hora_salida = VALUES(new_hora_salida),
       reason = VALUES(reason),
       created_by = VALUES(created_by),
       status = 'Activo'`,
      [employeeId2, date, sched2.entrada, sched2.salida, sched1.entrada, sched1.salida, reason2, createdBy]
    );

    await connection.commit();
    res.json({ success: true, message: 'Intercambio de turnos registrado con éxito.' });
  } catch (err) {
    await connection.rollback();
    console.error('[ATTENDANCE ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// POST /api/attendance/schedule-override - Create or update a schedule override
router.post('/schedule-override', async (req, res) => {
  try {
    const { employeeId, date, newHoraEntrada, newHoraSalida, reason, createdBy } = req.body;
    
    if (!employeeId || !date || !newHoraEntrada || !newHoraSalida || !reason || !createdBy) {
      return res.status(400).json({ error: 'Faltan parámetros obligatorios.' });
    }

    // 1. Fetch current employee scheduling as default template
    let [employees] = await pool.query(
      'SELECT hora_entrada, hora_salida FROM staff_records WHERE id = ?', 
      [employeeId]
    );
    if (employees.length === 0) {
      const [systemUsers] = await pool.query(
        'SELECT hora_entrada, hora_salida FROM users WHERE id = ?',
        [employeeId]
      );
      if (systemUsers.length > 0) {
        employees = systemUsers;
      }
    }
    
    const origEntrada = employees.length > 0 ? employees[0].hora_entrada : null;
    const origSalida = employees.length > 0 ? employees[0].hora_salida : null;

    // 2. Insert or replace schedule override
    await pool.query(
      `INSERT INTO schedule_overrides 
       (employee_id, date, original_hora_entrada, original_hora_salida, new_hora_entrada, new_hora_salida, reason, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
       original_hora_entrada = VALUES(original_hora_entrada),
       original_hora_salida = VALUES(original_hora_salida),
       new_hora_entrada = VALUES(new_hora_entrada),
       new_hora_salida = VALUES(new_hora_salida),
       reason = VALUES(reason),
       created_by = VALUES(created_by),
       status = 'Activo'`,
      [employeeId, date, origEntrada, origSalida, newHoraEntrada, newHoraSalida, reason, createdBy]
    );

    res.json({ success: true, message: 'Cambio de horario temporal registrado con éxito.' });
  } catch (err) {
    console.error('[ATTENDANCE ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/attendance/schedule-override/:id - Delete (annul) a schedule override
router.delete('/schedule-override/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("UPDATE schedule_overrides SET status = 'Anulado' WHERE id = ?", [id]);
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

function getDRTimestampString() {
  const d = new Date();
  const options = {
    timeZone: 'America/Santo_Domingo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  };
  const formatter = new Intl.DateTimeFormat('en-US', options);
  const parts = formatter.formatToParts(d);
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  const hour = parts.find(p => p.type === 'hour').value;
  const minute = parts.find(p => p.type === 'minute').value;
  const second = parts.find(p => p.type === 'second').value;
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function isDRTimePastLimit(hourString, graceMinutes = 15) {
  if (!hourString) return false;
  const [h, m, s] = hourString.split(':').map(Number);
  
  // Obtener la hora actual en República Dominicana
  const nowDRString = new Date().toLocaleString('en-US', { timeZone: 'America/Santo_Domingo' });
  const nowDR = new Date(nowDRString);
  
  // Construir el límite del turno en República Dominicana
  const limitDR = new Date(nowDRString);
  limitDR.setHours(h, m, s || 0, 0);
  
  const limitTime = limitDR.getTime() + (graceMinutes * 60 * 1000);
  return nowDR.getTime() > limitTime;
}

function normalizeDayName(str) {
  if (!str) return '';
  return str.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];


// Helper function for CompreFace face verification
async function verifyFacesWithCompreFace(webcamBuffer, referenceBuffer) {
  const endpoint = (process.env.COMPREFACE_ENDPOINT || 'http://localhost:8000').replace(/\/$/, '');
  const apiKey = process.env.COMPREFACE_API_KEY;
  if (!apiKey || apiKey === 'YOUR_COMPREFACE_API_KEY') {
    throw new Error('La API Key de CompreFace no está configurada o es inválida.');
  }

  const url = `${endpoint}/api/v1/verification/verify`;

  // Utilizar native FormData y Blob de Node.js v20 (no requiere dependencias externas)
  const formData = new FormData();
  formData.append('source_image', new Blob([webcamBuffer], { type: 'image/jpeg' }), 'webcam.jpg');
  formData.append('target_image', new Blob([referenceBuffer], { type: 'image/jpeg' }), 'reference.jpg');

  try {
    const res = await axios.post(url, formData, {
      headers: {
        'x-api-key': apiKey
      }
    });

    // CompreFace devuelve un arreglo de resultados con la similitud
    const match = res.data.result?.[0]?.face_matches?.[0];
    const similarity = match ? match.similarity : 0;

    return {
      isIdentical: similarity >= 0.90, // Umbral estricto para evitar falsos positivos
      confidence: similarity
    };
  } catch (err) {
    console.error('[COMPREFACE ERROR]:', err.response ? err.response.data : err.message);
    if (err.response && err.response.data && err.response.data.message) {
      const msg = err.response.data.message;
      if (msg.includes('No face found') || msg.includes('no face')) {
        throw new Error('No se detectó un rostro claro en la captura de la cámara o en la foto de perfil. Asegúrese de estar bajo buena luz.');
      }
      throw new Error(err.response.data.message);
    }
    throw new Error('Error al conectar con el servidor de biometría CompreFace.');
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
    const { employeeId, type, photo, geolocation, deviceInfo } = req.body;
    
    if (!employeeId || !type || !photo) {
      return res.status(400).json({ error: 'Faltan datos obligatorios (empleado, tipo o foto).' });
    }
    
    // Validate employee exists and load schedule configurations from staff_records or users
    let [employees] = await pool.query(
      'SELECT id, nombre, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos, profile_photo FROM staff_records WHERE id = ?', 
      [employeeId]
    );
    if (employees.length === 0) {
      // Look in users table instead
      const [systemUsers] = await pool.query(
        'SELECT id, nombre, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos, profile_photo FROM users WHERE id = ?',
        [employeeId]
      );
      if (systemUsers.length === 0) {
        return res.status(404).json({ error: 'Empleado no encontrado.' });
      }
      employees = systemUsers;
    }
    
    const emp = employees[0];

    // --- BIOMETRICS VERIFICATION (COMPREFACE) ---
    if (emp.profile_photo) {
      try {
        const webCamBuffer = base64ToBuffer(photo);
        const refPhotoBuffer = base64ToBuffer(emp.profile_photo);

        if (!webCamBuffer) {
          return res.status(400).json({ error: 'La captura de cámara enviada no es válida.' });
        }
        if (!refPhotoBuffer) {
          return res.status(400).json({ error: 'La foto de perfil del empleado no contiene datos de imagen válidos.' });
        }

        console.log(`[COMPREFACE] Iniciando validación facial para ${emp.nombre}...`);
        const verifyResult = await verifyFacesWithCompreFace(webCamBuffer, refPhotoBuffer);
        console.log(`[COMPREFACE] Similitud: ${verifyResult.confidence}, Coincide: ${verifyResult.isIdentical}`);

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

    // Check if there is a temporary schedule override for this employee today
    const todayDateStr = getDRDateString();
    const [overrides] = await pool.query(
      "SELECT new_hora_entrada, new_hora_salida FROM schedule_overrides WHERE employee_id = ? AND date = ? AND status = 'Activo'",
      [employeeId, todayDateStr]
    );

    // Resolve base schedule for today (Tuesday, Lunes, etc.) using America/Santo_Domingo timezone
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
        console.error("Error parsing employee daily schedule JSON in punch API:", e.message);
      }
    } else if (emp.dias_laborables) {
      const workingDays = emp.dias_laborables.split(',');
      const normalizedToday = normalizeDayName(todayName);
      const isWorkingDay = workingDays.some(d => normalizeDayName(d) === normalizedToday);
      if (!isWorkingDay) {
        baseHoraEntrada = null;
        baseHoraSalida = null;
      }
    }

    const effectiveHoraEntrada = overrides.length > 0 ? overrides[0].new_hora_entrada : baseHoraEntrada;
    const effectiveHoraSalida = overrides.length > 0 ? overrides[0].new_hora_salida : baseHoraSalida;
    
    if (type === 'Check-In' && effectiveHoraEntrada) {
      const now = new Date(nowDRString);
      const [expH, expM, expS] = effectiveHoraEntrada.split(':').map(Number);
      const expDate = new Date(nowDRString);
      expDate.setHours(expH, expM, expS || 0, 0);
      
      const graceMinutes = emp.tolerancia_minutos !== null ? emp.tolerancia_minutos : 15;
      const limitDate = new Date(expDate.getTime() + graceMinutes * 60 * 1000);
      
      if (now > limitDate) {
        status = 'Tardanza';
        const diffMs = now - expDate;
        latenessMinutes = Math.max(0, Math.floor(diffMs / (1000 * 60)));
      }
    } else if (type === 'Check-Out' && effectiveHoraSalida) {
      const now = new Date(nowDRString);
      const [expH, expM, expS] = effectiveHoraSalida.split(':').map(Number);
      const expDate = new Date(nowDRString);
      expDate.setHours(expH, expM, expS || 0, 0);

      const isScheduledUntil9PM = (expH === 21 && expM === 0);

      // Fetch today's check-in punch for this employee to check for tardiness/delays
      const [checkins] = await pool.query(
        `SELECT timestamp, lateness_minutes 
         FROM attendance 
         WHERE employee_id = ? 
           AND type = 'Check-In' 
           AND DATE(timestamp) = ? 
         ORDER BY timestamp DESC 
         LIMIT 1`,
        [employeeId, todayDateStr]
      );

      let actualCheckinDate = null;
      if (checkins.length > 0) {
        const checkinDRString = new Date(checkins[0].timestamp).toLocaleString('en-US', { timeZone: 'America/Santo_Domingo' });
        actualCheckinDate = new Date(checkinDRString);
      } else if (effectiveHoraEntrada) {
        const [entH, entM, entS] = effectiveHoraEntrada.split(':').map(Number);
        actualCheckinDate = new Date(nowDRString);
        actualCheckinDate.setHours(entH, entM, entS || 0, 0);
      }

      // Early check-in rule: if actual check-in is earlier than scheduled entry, treat as scheduled entry only if within 15 minutes
      if (effectiveHoraEntrada && actualCheckinDate) {
        const [entH, entM, entS] = effectiveHoraEntrada.split(':').map(Number);
        const scheduledEntryDate = new Date(nowDRString);
        scheduledEntryDate.setHours(entH, entM, entS || 0, 0);
        
        const diffMs = scheduledEntryDate - actualCheckinDate;
        const earlyMinutes = diffMs / (1000 * 60);

        if (earlyMinutes > 0 && earlyMinutes <= 15) {
          actualCheckinDate = scheduledEntryDate;
        }
      }

      let scheduledDurationMinutes = 0;
      if (effectiveHoraEntrada) {
        const [entH, entM, entS] = effectiveHoraEntrada.split(':').map(Number);
        scheduledDurationMinutes = (expH * 60 + expM) - (entH * 60 + entM);
        if (scheduledDurationMinutes < 0) {
          scheduledDurationMinutes += 24 * 60; // Handle wrap around midnight
        }
      }

      if (isScheduledUntil9PM) {
        // Special logic for 9:00 PM closing shift
        const eightPM = new Date(nowDRString);
        eightPM.setHours(20, 0, 0, 0); // 8:00 PM

        if (now >= eightPM && now < expDate) {
          // Checked out between 8:00 PM and 9:00 PM: normal status, no overtime
          status = 'Normal';
          extraMinutes = 0;
        } else if (now < eightPM) {
          // Checked out before 8:00 PM: early checkout
          status = 'Salida Temprana';
          extraMinutes = 0;
        } else {
          // Checked out after 9:00 PM: overtime starts after completing scheduled hours
          status = 'Normal';
          if (actualCheckinDate && scheduledDurationMinutes > 0) {
            const workedDurationMinutes = Math.max(0, Math.floor((now - actualCheckinDate) / (1000 * 60)));
            extraMinutes = Math.max(0, workedDurationMinutes - scheduledDurationMinutes);
          } else {
            const diffMs = now - expDate;
            extraMinutes = Math.max(0, Math.floor(diffMs / (1000 * 60)));
          }
        }
      } else {
        // Standard shift logic
        if (now < expDate) {
          status = 'Salida Temprana';
          extraMinutes = 0;
        } else {
          status = 'Normal';
          if (actualCheckinDate && scheduledDurationMinutes > 0) {
            const workedDurationMinutes = Math.max(0, Math.floor((now - actualCheckinDate) / (1000 * 60)));
            extraMinutes = Math.max(0, workedDurationMinutes - scheduledDurationMinutes);
          } else {
            const diffMs = now - expDate;
            extraMinutes = Math.max(0, Math.floor(diffMs / (1000 * 60)));
          }
        }
      }
    }
    
    const punchId = `PUNCH-${Date.now()}-${employeeId}`;
    
    // Si es Check-In, eliminar cualquier registro previo de 'Ausencia' autogenerado hoy para este empleado
    if (type === 'Check-In') {
      await pool.query(
        "DELETE FROM attendance WHERE employee_id = ? AND DATE(timestamp) = ? AND type = 'Ausencia'",
        [employeeId, todayDateStr]
      );
    }

    await pool.query(
      `INSERT INTO attendance (id, employee_id, type, photo, geolocation, device_info, timestamp, status, lateness_minutes, extra_minutes) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [punchId, employeeId, type, photo || null, geolocation || null, deviceInfo || null, getDRTimestampString(), status, latenessMinutes, extraMinutes]
    );
    
    console.log(`[ATTENDANCE] Ponche registrado: ${type} (${status}) para ${emp.nombre} (${employeeId})`);
    res.json({ success: true, message: `Ponche de ${type === 'Check-In' ? 'Entrada' : 'Salida'} registrado como ${status} correctamente.`, name: emp.nombre });
  } catch (err) {
    console.error('[ATTENDANCE ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/attendance/today - Lightweight: only real punches for today (no absent generation)
// Used by the kiosk to auto-detect whether to show Check-In or Check-Out
router.get('/today', async (req, res) => {
  try {
    const { salonId } = req.query;
    const todayStr = getDRDateString();
    let query = `SELECT a.id, a.employee_id, a.type, a.status, a.timestamp, a.lateness_minutes, a.extra_minutes
       FROM attendance a
       LEFT JOIN staff_records s ON a.employee_id = s.id
       LEFT JOIN users u ON a.employee_id = u.id
       WHERE DATE(a.timestamp) = ? AND a.type IN ('Check-In', 'Check-Out')`;
    const params = [todayStr];
    if (salonId) {
      query += ` AND COALESCE(s.salon_id, u.salon_id) = ?`;
      params.push(salonId);
    }
    query += ` ORDER BY a.timestamp ASC`;
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('[ATTENDANCE TODAY ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/attendance/history - Fetch historical attendance logs for admin panel
router.get('/history', async (req, res) => {
  try {
    const { startDate, endDate, employeeId, status, type, salonId } = req.query;
    
    const start = startDate || getDRDateString(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
    const end = endDate || getDRDateString();

    // 1. Fetch active staff and system users (excluding admins/clients) to know who should work
    const [staff] = await pool.query(
      "SELECT id, nombre, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos, salon_id, fecha_entrada FROM staff_records WHERE status = 'Activo' OR status = 'Active'"
    );
    const [users] = await pool.query(
      "SELECT u.id, u.nombre, u.hora_entrada, u.hora_salida, u.dias_laborables, u.tolerancia_minutos, u.salon_id, r.nombre as role_name, u.created_at as fecha_entrada FROM users u LEFT JOIN roles r ON u.role_id = r.id"
    );
    const systemStaff = users.filter(u => {
      const role = (u.role_name || '').toLowerCase();
      return !role.includes('admin') && !role.includes('client');
    });

    let allEmployees = [...staff];
    systemStaff.forEach(sysUser => {
      if (!allEmployees.some(c => c.nombre.toLowerCase().trim() === sysUser.nombre.toLowerCase().trim())) {
        allEmployees.push(sysUser);
      }
    });

    if (salonId) {
      allEmployees = allEmployees.filter(emp => String(emp.salon_id) === String(salonId));
    }

    // 2. Fetch all schedule overrides within this date range
    const [rangeOverrides] = await pool.query(
      "SELECT employee_id, DATE_FORMAT(date, '%Y-%m-%d') as dateStr, new_hora_entrada, new_hora_salida FROM schedule_overrides WHERE date >= ? AND date <= ? AND status = 'Activo'",
      [start, end]
    );
    const overrideMap = new Map();
    rangeOverrides.forEach(o => {
      overrideMap.set(`${o.employee_id}:${o.dateStr}`, o);
    });

    // 3. Fetch all existing attendance records in this range
    const [existingPunches] = await pool.query(
      "SELECT employee_id, DATE_FORMAT(timestamp, '%Y-%m-%d') as dateStr, type FROM attendance WHERE timestamp >= ? AND timestamp <= ?",
      [`${start} 00:00:00`, `${end} 23:59:59`]
    );

    const punchSet = new Set(existingPunches.map(p => `${p.employee_id}:${p.dateStr}`));
    const absentSet = new Set(existingPunches.filter(p => p.type === 'Ausencia').map(p => `${p.employee_id}:${p.dateStr}`));
    // Track employees who actually checked in — never generate Ausencia for these
    const checkinSet = new Set(existingPunches.filter(p => p.type === 'Check-In').map(p => `${p.employee_id}:${p.dateStr}`));

    // 4. Generate missing Ausente records for scheduled work days in range (excluding future days)
    const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const curDate = new Date(start + 'T12:00:00');
    const endDateObj = new Date(end + 'T12:00:00');
    const todayStr = getDRDateString();

    while (curDate <= endDateObj) {
      const dateStr = getDRDateString(curDate);
      const dayName = dayNames[curDate.getDay()];

      for (const emp of allEmployees) {
        let isWorkingDay = false;
        let empDailyHoraEntrada = emp.hora_entrada;
        let empDailyHoraSalida = emp.hora_salida;

        if (emp.dias_laborables && emp.dias_laborables.trim().startsWith('{')) {
          try {
            const parsedSchedule = JSON.parse(emp.dias_laborables);
            const normalizedDay = normalizeDayName(dayName);
            const matchingKey = Object.keys(parsedSchedule).find(k => normalizeDayName(k) === normalizedDay);
            const daySched = matchingKey ? parsedSchedule[matchingKey] : null;
            if (daySched && daySched.entrada && daySched.salida) {
              isWorkingDay = true;
              empDailyHoraEntrada = daySched.entrada;
              empDailyHoraSalida = daySched.salida;
            }
          } catch (e) {
            console.error("Error parsing daily schedule JSON for employee", emp.id, e.message);
          }
        } else {
          const workingDays = (emp.dias_laborables || '').split(',');
          const normalizedDay = normalizeDayName(dayName);
          isWorkingDay = emp.dias_laborables && workingDays.some(d => normalizeDayName(d) === normalizedDay);
        }

        if (isWorkingDay) {
          // No generar ausencias para fechas anteriores a la contratación del empleado
          if (emp.fecha_entrada) {
            try {
              const d = new Date(emp.fecha_entrada);
              if (!isNaN(d.getTime())) {
                const empHireDateStr = getDRDateString(d);
                if (dateStr < empHireDateStr) {
                  continue;
                }
              }
            } catch (e) {}
          }

          const lookupKey = `${emp.id}:${dateStr}`;
          
          if (!punchSet.has(lookupKey)) {
            let shouldMarkAbsent = true;
            const override = overrideMap.get(lookupKey);
            const effectiveHoraEntrada = override ? override.new_hora_entrada : empDailyHoraEntrada;

            if (dateStr > todayStr) {
              shouldMarkAbsent = false;
            } else if (dateStr <= '2026-07-12') {
              shouldMarkAbsent = false;
            } else if (dateStr === todayStr) {
              if (effectiveHoraEntrada) {
                const grace = emp.tolerancia_minutos !== null && emp.tolerancia_minutos !== undefined ? emp.tolerancia_minutos : 15;
                const isPast = isDRTimePastLimit(effectiveHoraEntrada, grace);
                if (!isPast) {
                  shouldMarkAbsent = false;
                }
              } else {
                shouldMarkAbsent = false;
              }
            }

            if (shouldMarkAbsent && !absentSet.has(lookupKey) && !checkinSet.has(lookupKey)) {
              const punchId = `ABSENT-${Date.now()}-${emp.id}-${dateStr}`;
              const entryTime = effectiveHoraEntrada || '09:00:00';
              await pool.query(
                `INSERT INTO attendance (id, employee_id, type, photo, geolocation, device_info, timestamp, status, lateness_minutes, extra_minutes) 
                 VALUES (?, ?, 'Ausencia', NULL, NULL, 'Autogenerado por Sistema', ?, 'Ausente', 0, 0)`,
                [punchId, emp.id, `${dateStr} ${entryTime}`]
              );
              punchSet.add(lookupKey);
              absentSet.add(lookupKey);
            }
          }
        }
      }
      curDate.setDate(curDate.getDate() + 1);
    }

    // 4. Query combined history
    let sql = `
      SELECT a.id, a.employee_id, a.timestamp, a.type, a.photo, a.geolocation, a.device_info, a.status, a.lateness_minutes, a.extra_minutes,
             COALESCE(s.nombre, u.nombre) as employeeName,
             sal.name as salonName,
             COALESCE(s.dias_laborables, u.dias_laborables) as dias_laborables,
             o.new_hora_entrada as override_hora_entrada,
             o.new_hora_salida as override_hora_salida,
             COALESCE(s.hora_entrada, u.hora_entrada) as base_hora_entrada,
             COALESCE(s.hora_salida, u.hora_salida) as base_hora_salida,
             COALESCE(s.tolerancia_minutos, u.tolerancia_minutos) as tolerancia_minutos
      FROM attendance a
      LEFT JOIN staff_records s ON a.employee_id = s.id
      LEFT JOIN users u ON a.employee_id = u.id
      LEFT JOIN salons sal ON COALESCE(s.salon_id, u.salon_id) = sal.id
      LEFT JOIN schedule_overrides o ON a.employee_id = o.employee_id AND DATE(a.timestamp) = o.date AND o.status = 'Activo'
    `;
    const params = [];
    const conditions = [];
    
    if (startDate) {
      conditions.push(`a.timestamp >= ?`);
      params.push(`${startDate} 00:00:00`);
    }
    if (endDate) {
      conditions.push(`a.timestamp <= ?`);
      params.push(`${endDate} 23:59:59`);
    }
    if (employeeId) {
      conditions.push(`a.employee_id = ?`);
      params.push(employeeId);
    }
    if (salonId) {
      conditions.push(`COALESCE(s.salon_id, u.salon_id) = ?`);
      params.push(salonId);
    }
    if (status) {
      conditions.push(`a.status = ?`);
      params.push(status);
    }
    if (type) {
      conditions.push(`a.type = ?`);
      params.push(type);
    }
    
    if (conditions.length > 0) {
      sql += ` WHERE ` + conditions.join(' AND ');
    }
    
    sql += ` ORDER BY a.timestamp DESC`;
    
    const [rows] = await pool.query(sql, params);
    const formattedRows = rows.map(row => {
      let finalEntrada = row.base_hora_entrada;
      let finalSalida = row.base_hora_salida;

      if (row.dias_laborables && row.dias_laborables.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(row.dias_laborables);
          const dateObj = new Date(row.timestamp);
          const dayName = dayNames[dateObj.getDay()];
          const normalizedTarget = normalizeDayName(dayName);
          const matchingKey = Object.keys(parsed).find(k => normalizeDayName(k) === normalizedTarget);
          const daySched = matchingKey ? parsed[matchingKey] : null;
          if (daySched && daySched.entrada && daySched.salida) {
            finalEntrada = daySched.entrada;
            finalSalida = daySched.salida;
          }
        } catch (e) {}
      }

      if (row.override_hora_entrada) {
        finalEntrada = row.override_hora_entrada;
      }
      if (row.override_hora_salida) {
        finalSalida = row.override_hora_salida;
      }

      return {
        id: row.id,
        employee_id: row.employee_id,
        timestamp: row.timestamp,
        type: row.type,
        photo: row.photo,
        geolocation: row.geolocation,
        device_info: row.device_info,
        status: row.status,
        lateness_minutes: row.lateness_minutes,
        extra_minutes: row.extra_minutes,
        employeeName: row.employeeName,
        salonName: row.salonName,
        hora_entrada: finalEntrada,
        hora_salida: finalSalida,
        tolerancia_minutos: row.tolerancia_minutos
      };
    });

    res.json(formattedRows);
  } catch (err) {
    console.error('[ATTENDANCE ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/attendance/pending - Fetch all pending attendance records (missing check-in/out)
router.get('/pending', async (req, res) => {
  try {
    const { startDate, endDate, employeeId, salonId } = req.query;
    
    // Default to last 7 days (excluding future days)
    const start = startDate || getDRDateString(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
    const end = endDate || getDRDateString();

    // 1. Fetch active staff and system users
    const [staff] = await pool.query(
      "SELECT id, nombre, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos, salon_id FROM staff_records WHERE status = 'Activo' OR status = 'Active'"
    );
    const [users] = await pool.query(
      "SELECT u.id, u.nombre, u.hora_entrada, u.hora_salida, u.dias_laborables, u.tolerancia_minutos, u.salon_id, r.nombre as role_name FROM users u LEFT JOIN roles r ON u.role_id = r.id"
    );
    const systemStaff = users.filter(u => {
      const role = (u.role_name || '').toLowerCase();
      return !role.includes('admin') && !role.includes('client');
    });

    const allEmployees = [...staff];
    systemStaff.forEach(sysUser => {
      if (!allEmployees.some(c => c.nombre.toLowerCase().trim() === sysUser.nombre.toLowerCase().trim())) {
        allEmployees.push(sysUser);
      }
    });

    // Apply employeeId and salonId filters
    let filteredEmployees = allEmployees;
    if (employeeId) {
      filteredEmployees = filteredEmployees.filter(e => String(e.id) === String(employeeId));
    }
    if (salonId) {
      filteredEmployees = filteredEmployees.filter(e => String(e.salon_id) === String(salonId));
    }

    // 2. Fetch all schedule overrides in the range
    const [rangeOverrides] = await pool.query(
      "SELECT employee_id, DATE_FORMAT(date, '%Y-%m-%d') as dateStr, new_hora_entrada, new_hora_salida FROM schedule_overrides WHERE date >= ? AND date <= ? AND status = 'Activo'",
      [start, end]
    );
    const overrideMap = new Map();
    rangeOverrides.forEach(o => {
      overrideMap.set(`${o.employee_id}:${o.dateStr}`, o);
    });

    // 3. Fetch all attendance logs in the range
    const [punches] = await pool.query(
      "SELECT id, employee_id, type, DATE_FORMAT(timestamp, '%Y-%m-%d') as dateStr, DATE_FORMAT(timestamp, '%H:%i:%s') as timeStr, timestamp, status, is_manual, modified_by, modified_at, modification_reason FROM attendance WHERE timestamp >= ? AND timestamp <= ?",
      [`${start} 00:00:00`, `${end} 23:59:59`]
    );

    // Group punches by employeeId and dateStr
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
    
    // Generate dates range
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

        // Determine if it was scheduled to be a working day
        if (emp.dias_laborables && emp.dias_laborables.trim().startsWith('{')) {
          try {
            const parsedSchedule = JSON.parse(emp.dias_laborables);
            const normalizedDay = normalizeDayName(dayName);
            const matchingKey = Object.keys(parsedSchedule).find(k => normalizeDayName(k) === normalizedDay);
            const daySched = matchingKey ? parsedSchedule[matchingKey] : null;
            if (daySched && daySched.entrada && daySched.salida) {
              isWorkingDay = true;
              empDailyHoraEntrada = daySched.entrada;
              empDailyHoraSalida = daySched.salida;
            }
          } catch (e) {}
        } else {
          const workingDays = (emp.dias_laborables || '').split(',');
          const normalizedDay = normalizeDayName(dayName);
          isWorkingDay = emp.dias_laborables && workingDays.some(d => normalizeDayName(d) === normalizedDay);
        }

        // Apply override if active
        const lookupKey = `${emp.id}:${dateStr}`;
        const override = overrideMap.get(lookupKey);
        if (override) {
          isWorkingDay = true;
          empDailyHoraEntrada = override.new_hora_entrada;
          empDailyHoraSalida = override.new_hora_salida;
        }

        if (isWorkingDay) {
          const dayPunches = punchMap.get(lookupKey) || [];
          const dayCheckIns = dayPunches.filter(p => p.type === 'Check-In').sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
          const dayCheckOuts = dayPunches.filter(p => p.type === 'Check-Out').sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
          const checkIn = dayCheckIns[0] || null;
          const checkOut = dayCheckOuts[0] || null;
          const absence = dayPunches.find(p => p.type === 'Ausencia');

          let hasIncident = false;
          let incidentType = '';

          // Priority: Real Check-In always overrides Ausencia records (Ausencia can be stale/auto-generated)
          // 1. Has both Check-In and Check-Out → complete, no incident
          // 2. Has Check-In but no Check-Out → missing_checkout (regardless of Ausencia)
          // 3. Has Check-Out but no Check-In → missing_checkin
          // 4. No real punches at all:
          //    - If Ausencia record exists → legitimately absent (skip, not a pending issue)
          //    - If no records at all → missing_all (only for past days)

          if (checkIn && checkOut) {
            // Complete - no incident
          } else if (checkIn && !checkOut) {
            // Employee showed up but never checked out
            if (dateStr < todayStr) {
              hasIncident = true;
              incidentType = 'missing_checkout';
            } else if (dateStr === todayStr) {
              if (empDailyHoraSalida && isDRTimePastLimit(empDailyHoraSalida, 60)) {
                hasIncident = true;
                incidentType = 'missing_checkout';
              }
            }
          } else if (!checkIn && checkOut) {
            // Has checkout but no check-in (unusual scenario)
            hasIncident = true;
            incidentType = 'missing_checkin';
          } else if (!checkIn && !checkOut) {
            // No real punches - only flag if not legitimately absent
            if (!absence) {
              // No records at all - missing attendance
              if (dateStr < todayStr) {
                hasIncident = true;
                incidentType = 'missing_all';
              } else if (dateStr === todayStr) {
                if (empDailyHoraEntrada) {
                  const grace = emp.tolerancia_minutos !== null && emp.tolerancia_minutos !== undefined ? emp.tolerancia_minutos : 15;
                  if (isDRTimePastLimit(empDailyHoraEntrada, grace)) {
                    hasIncident = true;
                    incidentType = 'missing_all';
                  }
                }
              }
            }
            // If absence exists and no real Check-In → legitimately marked absent, skip
          }

          if (hasIncident && incidentType !== 'missing_all') {
            pendingIncidents.push({
              employeeId: emp.id,
              employeeName: emp.nombre,
              date: dateStr,
              scheduledIn: empDailyHoraEntrada,
              scheduledOut: empDailyHoraSalida,
              checkIn: checkIn ? { id: checkIn.id, time: checkIn.timeStr, timestamp: checkIn.timestamp, isManual: checkIn.is_manual, modifiedBy: checkIn.modified_by, modifiedAt: checkIn.modified_at, reason: checkIn.modification_reason } : null,
              checkOut: checkOut ? { id: checkOut.id, time: checkOut.timeStr, timestamp: checkOut.timestamp, isManual: checkOut.is_manual, modifiedBy: checkOut.modified_by, modifiedAt: checkOut.modified_at, reason: checkOut.modification_reason } : null,
              absence: absence ? { id: absence.id, timestamp: absence.timestamp } : null,
              incidentType
            });
          }
        }
      }
      curDate.setDate(curDate.getDate() + 1);
    }

    pendingIncidents.sort((a, b) => b.date.localeCompare(a.date));
    res.json(pendingIncidents);
  } catch (err) {
    console.error('[ATTENDANCE PENDING ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/attendance/adjust - Manually adjust missing check-in/out with audit log
router.post('/adjust', async (req, res) => {
  try {
    const { employeeId, date, checkInTime, checkOutTime, reason, modifiedBy } = req.body;

    if (!employeeId || !date || !reason || !modifiedBy) {
      return res.status(400).json({ error: 'Faltan datos obligatorios (empleado, fecha, motivo o administrador).' });
    }

    // 1. Delete any existing 'Ausencia' records for this employee on this date
    await pool.query(
      "DELETE FROM attendance WHERE employee_id = ? AND DATE(timestamp) = ? AND type = 'Ausencia'",
      [employeeId, date]
    );

    // 2. Adjust Check-In
    if (checkInTime) {
      const [existingIn] = await pool.query(
        "SELECT id FROM attendance WHERE employee_id = ? AND DATE(timestamp) = ? AND type = 'Check-In'",
        [employeeId, date]
      );

      const timestampStr = `${date} ${checkInTime}:00`;
      
      let [employees] = await pool.query(
        'SELECT id, nombre, hora_entrada, dias_laborables, tolerancia_minutos FROM staff_records WHERE id = ?', 
        [employeeId]
      );
      if (employees.length === 0) {
        const [users] = await pool.query(
          'SELECT id, nombre, hora_entrada, dias_laborables, tolerancia_minutos FROM users WHERE id = ?',
          [employeeId]
        );
        employees = users;
      }
      const emp = employees[0];
      
      const [overrides] = await pool.query(
        "SELECT new_hora_entrada FROM schedule_overrides WHERE employee_id = ? AND date = ? AND status = 'Activo'",
        [employeeId, date]
      );
      
      let expectedEntrada = emp ? emp.hora_entrada : '09:00:00';
      if (overrides.length > 0) {
        expectedEntrada = overrides[0].new_hora_entrada;
      } else if (emp && emp.dias_laborables && emp.dias_laborables.trim().startsWith('{')) {
        try {
          const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
          const dateObj = new Date(`${date}T12:00:00`);
          const dayName = dayNames[dateObj.getDay()];
          const parsed = JSON.parse(emp.dias_laborables);
          const normalizedTarget = normalizeDayName(dayName);
          const matchingKey = Object.keys(parsed).find(k => normalizeDayName(k) === normalizedTarget);
          const daySched = matchingKey ? parsed[matchingKey] : null;
          if (daySched && daySched.entrada) {
            expectedEntrada = daySched.entrada;
          }
        } catch(e) {}
      }
      
      let status = 'Normal';
      let latenessMinutes = 0;
      if (expectedEntrada) {
        try {
          const [expH, expM] = expectedEntrada.split(':').map(Number);
          const [actH, actM] = checkInTime.split(':').map(Number);
          
          const scheduledMinutes = expH * 60 + expM;
          const actualMinutes = actH * 60 + actM;
          const diff = actualMinutes - scheduledMinutes;
          const grace = emp && emp.tolerancia_minutos !== null && emp.tolerancia_minutos !== undefined ? emp.tolerancia_minutos : 15;
          
          if (diff > grace) {
            status = 'Tardanza';
            latenessMinutes = diff;
          }
        } catch(e) {}
      }

      if (existingIn.length > 0) {
        await pool.query(
          `UPDATE attendance 
           SET timestamp = ?, status = ?, lateness_minutes = ?, is_manual = 1, modified_by = ?, modified_at = NOW(), modification_reason = ? 
           WHERE id = ?`,
          [timestampStr, status, latenessMinutes, modifiedBy, reason, existingIn[0].id]
        );
      } else {
        const punchId = `MANUAL-IN-${Date.now()}-${employeeId}-${date}`;
        await pool.query(
          `INSERT INTO attendance (id, employee_id, type, photo, geolocation, device_info, timestamp, status, lateness_minutes, is_manual, modified_by, modified_at, modification_reason) 
           VALUES (?, ?, 'Check-In', NULL, NULL, 'Ajuste Manual por Administrador', ?, ?, ?, 1, ?, NOW(), ?)`,
          [punchId, employeeId, timestampStr, status, latenessMinutes, modifiedBy, reason]
        );
      }
    }

    // 3. Adjust Check-Out
    if (checkOutTime) {
      const [existingOut] = await pool.query(
        "SELECT id FROM attendance WHERE employee_id = ? AND DATE(timestamp) = ? AND type = 'Check-Out'",
        [employeeId, date]
      );

      const timestampStr = `${date} ${checkOutTime}:00`;
      
      let [employees] = await pool.query(
        'SELECT id, nombre, hora_salida, dias_laborables FROM staff_records WHERE id = ?', 
        [employeeId]
      );
      if (employees.length === 0) {
        const [users] = await pool.query(
          'SELECT id, nombre, hora_salida, dias_laborables FROM users WHERE id = ?',
          [employeeId]
        );
        employees = users;
      }
      const emp = employees[0];
      
      const [overrides] = await pool.query(
        "SELECT new_hora_salida FROM schedule_overrides WHERE employee_id = ? AND date = ? AND status = 'Activo'",
        [employeeId, date]
      );
      
      let expectedSalida = emp ? emp.hora_salida : '18:00:00';
      if (overrides.length > 0) {
        expectedSalida = overrides[0].new_hora_salida;
      } else if (emp && emp.dias_laborables && emp.dias_laborables.trim().startsWith('{')) {
        try {
          const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
          const dateObj = new Date(`${date}T12:00:00`);
          const dayName = dayNames[dateObj.getDay()];
          const parsed = JSON.parse(emp.dias_laborables);
          const normalizedTarget = normalizeDayName(dayName);
          const matchingKey = Object.keys(parsed).find(k => normalizeDayName(k) === normalizedTarget);
          const daySched = matchingKey ? parsed[matchingKey] : null;
          if (daySched && daySched.salida) {
            expectedSalida = daySched.salida;
          }
        } catch(e) {}
      }
      
      let extraMinutes = 0;
      let outStatus = 'Normal';
      if (expectedSalida) {
        try {
          const [expH, expM] = expectedSalida.split(':').map(Number);
          const [actH, actM] = checkOutTime.split(':').map(Number);
          
          const scheduledMinutes = expH * 60 + expM;
          const actualMinutes = actH * 60 + actM;
          const diff = actualMinutes - scheduledMinutes;
          
          if (diff > 0) {
            extraMinutes = diff;
          } else if (diff < 0) {
            outStatus = 'Salida Temprana';
          }
        } catch(e) {}
      }

      if (existingOut.length > 0) {
        await pool.query(
          `UPDATE attendance 
           SET timestamp = ?, status = ?, extra_minutes = ?, is_manual = 1, modified_by = ?, modified_at = NOW(), modification_reason = ? 
           WHERE id = ?`,
          [timestampStr, outStatus, extraMinutes, modifiedBy, reason, existingOut[0].id]
        );
      } else {
        const punchId = `MANUAL-OUT-${Date.now()}-${employeeId}-${date}`;
        await pool.query(
          `INSERT INTO attendance (id, employee_id, type, photo, geolocation, device_info, timestamp, status, extra_minutes, is_manual, modified_by, modified_at, modification_reason) 
           VALUES (?, ?, 'Check-Out', NULL, NULL, 'Ajuste Manual por Administrador', ?, ?, ?, 1, ?, NOW(), ?)`,
          [punchId, employeeId, timestampStr, outStatus, extraMinutes, modifiedBy, reason]
        );
      }
    }

    res.json({ success: true, message: 'Registro de asistencia regularizado con éxito.' });
  } catch (err) {
    console.error('[ATTENDANCE ADJUST ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/attendance/notify-pending - Send feedback email to employee regarding missing punch
router.post('/notify-pending', async (req, res) => {
  try {
    const { employeeId, date, incidentType } = req.body;

    if (!employeeId || !date || !incidentType) {
      return res.status(400).json({ error: 'Faltan datos obligatorios (empleado, fecha o tipo de incidencia).' });
    }

    // 1. Find employee name and email
    let [employees] = await pool.query(
      'SELECT id, nombre, email FROM staff_records WHERE id = ?', 
      [employeeId]
    );
    
    let empName = '';
    let empEmail = '';
    let empId = employeeId;
    
    if (employees.length > 0) {
      empName = employees[0].nombre;
      empEmail = employees[0].email;
      
      // If staff record has no email, check users table by name
      if (!empEmail) {
        const [userEmailRows] = await pool.query(
          'SELECT email FROM users WHERE nombre = ? AND email IS NOT NULL AND email != ""',
          [empName]
        );
        if (userEmailRows.length > 0) {
          empEmail = userEmailRows[0].email;
        }
      }
    } else {
      // If not in staff_records, check users table directly by ID
      const [users] = await pool.query(
        'SELECT id, nombre, email FROM users WHERE id = ?',
        [employeeId]
      );
      if (users.length > 0) {
        empName = users[0].nombre;
        empEmail = users[0].email;
        empId = users[0].id;
      }
    }

    if (!empName) {
      return res.status(404).json({ error: 'Empleado no encontrado.' });
    }

    // Fallback email if still no email configured
    if (!empEmail) {
      const firstName = empName.trim().split(/\s+/)[0].toLowerCase();
      empEmail = `${firstName}@abatte.com`;
    }

    const emp = { id: empId, nombre: empName, email: empEmail };
    const incidentLabel = incidentType === 'missing_checkin' 
      ? 'Falta registro de Entrada (Check-In)' 
      : incidentType === 'missing_checkout' 
      ? 'Falta registro de Salida (Check-Out)' 
      : 'Falta registro completo (Entrada y Salida)';

    // 2. Load SMTP config
    const [smtpRows] = await pool.query('SELECT * FROM email_settings WHERE id = 1');
    const smtp = smtpRows[0] || {};
    const transporter = nodemailer.createTransport({
      host: smtp.smtp_host || process.env.SMTP_HOST,
      port: parseInt(smtp.smtp_port || process.env.SMTP_PORT || '587'),
      secure: smtp.smtp_secure === 1,
      auth: {
        user: smtp.smtp_user || process.env.SMTP_USER,
        pass: smtp.smtp_pass || process.env.SMTP_PASS
      }
    });

    const smtpFrom = smtp.smtp_from || process.env.SMTP_FROM || 'hola@planbeautyrd.com';
    const smtpUser = smtp.smtp_user || process.env.SMTP_USER;

    // 3. Send email
    await transporter.sendMail({
      from: `"${smtpFrom}" <${smtpUser}>`,
      to: emp.email,
      subject: `⚠️ Aviso de Registro de Asistencia Omitido - ${date}`,
      text: `Hola ${emp.nombre},\n\nSe ha detectado una omisión en tu registro de asistencia para el día ${date}.\nIncidencia detectada: ${incidentLabel}.\n\nPor favor, recuerda registrar tus ponches correctamente. Las regularizaciones manuales generan una carga administrativa adicional e innecesaria para el equipo de supervisión.\n\nAgradecemos tu colaboración para mantener un registro puntual.\n\nAtentamente,\nGestión de Asistencia - Etereas SRL`,
      html: `
        <div style="font-family: 'Plus Jakarta Sans', sans-serif; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
          <h2 style="color: #dc2626; margin-top: 0;">⚠️ Registro de Asistencia Omitido</h2>
          <p>Hola <strong>${emp.nombre}</strong>,</p>
          <p>Se ha detectado que omitiste registrar tu ponche de asistencia del día <strong>${date}</strong>.</p>
          
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0; font-size: 0.9rem;"><strong>Incidencia:</strong> ${incidentLabel}</p>
          </div>

          <p style="color: #475569; line-height: 1.5;">
            Por favor, recuerda registrar tus marcas de entrada y salida a tiempo. Las regularizaciones manuales posteriores requieren la intervención de las encargadas y generan una carga administrativa adicional en el sistema.
          </p>

          <p style="font-weight: bold; color: #0f172a;">Agradecemos tu disciplina y colaboración para evitar futuras omisiones.</p>
          
          <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
          <p style="font-size: 0.8rem; color: #94a3b8; margin: 0;">Este es un mensaje automático de control interno de Etereas SRL.</p>
        </div>
      `
    });

    // Log the email event
    await pool.query(
      `INSERT INTO email_logs (client_id, email_type, recipient_email, subject, sent_at) 
       VALUES (?, 'attendance_warning', ?, ?, NOW())`,
      [emp.id, emp.email, `Aviso de Registro de Asistencia Omitido - ${date}`]
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
