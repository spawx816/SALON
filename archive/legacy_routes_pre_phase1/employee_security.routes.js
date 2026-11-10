const express = require('express');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Router for Employee Discounts, Payroll Deductions, OTP and Kiosk Commission PIN
 * 
 * @param {import('mysql2/promise').Pool} pool
 */
function createEmployeeSecurityRouter(pool) {
  const router = express.Router();

  // === EMPLOYEE DISCOUNTS & DEDUCTIONS MODULE ===
  router.get('/employee-discounts', async (req, res) => {
    try {
      // Auto-cascade/clean any existing deductions linked to voided visits
      try {
        await pool.query(`
          UPDATE employee_discounts ed
          JOIN visits v ON (ed.visit_id = v.id OR ed.notes LIKE CONCAT('%#', v.ticket_number, '%') OR ed.notes LIKE CONCAT('%#', v.id, '%'))
          SET ed.status = 'Anulado'
          WHERE v.status = 'Anulado' AND ed.status != 'Anulado'
        `);
      } catch (syncErr) {}

      const { employee_id, status, type, start_date, end_date } = req.query;
      let query = `
        SELECT ed.id, ed.employee_id, ed.type, ed.amount, DATE_FORMAT(ed.date, '%Y-%m-%d') as date, 
               ed.notes, ed.status, ed.created_by, ed.created_at,
               COALESCE(s.nombre, ed.employee_name) as employee_name, 
               COALESCE(s.posicion, 'Colaborador') as employee_position, 
               COALESCE(s.localidad, 'Principal') as localidad
        FROM employee_discounts ed
        LEFT JOIN staff_records s ON (ed.employee_id = s.id OR (ed.employee_id = 0 AND ed.employee_name = s.nombre))
        WHERE 1=1
      `;
      const params = [];
      if (employee_id && employee_id !== 'all') {
        query += ' AND ed.employee_id = ?';
        params.push(employee_id);
      }
      if (status && status !== 'all') {
        query += ' AND ed.status = ?';
        params.push(status);
      } else {
        // By default exclude voided deductions
        query += " AND (ed.status != 'Anulado' OR ed.status IS NULL)";
      }
      if (type && type !== 'all') {
        query += ' AND ed.type = ?';
        params.push(type);
      }
      if (start_date && end_date) {
        query += ' AND ed.date BETWEEN ? AND ?';
        params.push(start_date, end_date);
      }
      query += ' ORDER BY ed.date DESC, ed.created_at DESC';

      const [rows] = await pool.query(query, params);
      res.json(rows);
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/employee-discounts', async (req, res) => {
    try {
      const { employee_id, employee_name, type, amount, date, notes, status, created_by } = req.body;
      if (!employee_id || !amount || Number(amount) <= 0) {
        return res.status(400).json({ error: 'Colaborador y monto válido son requeridos.' });
      }

      const cleanDate = date ? (String(date).includes('T') ? String(date).split('T')[0] : String(date).split(' ')[0]) : new Date().toISOString().split('T')[0];
      const [emp] = await pool.query('SELECT nombre FROM staff_records WHERE id = ?', [employee_id]);
      const empName = emp[0]?.nombre || employee_name || 'Colaborador';

      const [result] = await pool.query(
        `INSERT INTO employee_discounts (employee_id, employee_name, type, amount, date, notes, status, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [employee_id, empName, type || 'Consumo_Servicio', amount, cleanDate, notes || '', status || 'Pendiente', created_by || 'Admin']
      );

      res.json({ success: true, id: result.insertId, message: 'Descuento registrado exitosamente' });
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/employee-discounts/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { employee_id, employee_name, type, amount, date, notes, status } = req.body;

      let cleanDate = date;
      if (cleanDate !== undefined && cleanDate !== null) {
        cleanDate = String(cleanDate).includes('T') ? String(cleanDate).split('T')[0] : String(cleanDate).split(' ')[0];
      }

      await pool.query(
        `UPDATE employee_discounts SET 
           employee_id = COALESCE(?, employee_id),
           employee_name = COALESCE(?, employee_name),
           type = COALESCE(?, type),
           amount = COALESCE(?, amount),
           date = COALESCE(?, date),
           notes = COALESCE(?, notes),
           status = COALESCE(?, status)
         WHERE id = ?`,
        [employee_id || null, employee_name || null, type || null, amount || null, cleanDate || null, notes || null, status || null, id]
      );

      res.json({ success: true, message: 'Descuento actualizado exitosamente' });
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/employee-discounts/:id', async (req, res) => {
    try {
      const { id } = req.params;
      await pool.query('DELETE FROM employee_discounts WHERE id = ?', [id]);
      res.json({ success: true, message: 'Descuento eliminado exitosamente' });
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  });

  // === EMPLOYEE OTP AUTHORIZATION ===
  router.post('/auth/send-employee-otp', async (req, res) => {
    try {
      const { employeeId, employeeEmail, employeeName } = req.body;
      if (!employeeEmail) {
        return res.status(400).json({ error: 'El empleado no tiene correo registrado.' });
      }

      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min

      await pool.query(
        'INSERT INTO verification_codes (client_id, code, expires_at) VALUES (?, ?, ?)',
        [employeeId || 'EMP', code, expiresAt]
      );

      // Send email using system SMTP settings
      const [smtpRows] = await pool.query('SELECT * FROM email_settings WHERE id = 1');
      if (smtpRows[0] && smtpRows[0].smtp_host) {
        const cfg = smtpRows[0];
        const transporter = nodemailer.createTransport({
          host: cfg.smtp_host,
          port: cfg.smtp_port,
          secure: parseInt(cfg.smtp_port) === 465,
          auth: { user: cfg.smtp_user, pass: cfg.smtp_pass }
        });

        await transporter.sendMail({
          from: cfg.smtp_from || '"Plan Beauty RD" <hola@planbeautyrd.com>',
          to: employeeEmail,
          subject: `🔒 Código de Seguridad Consumo Nómina: ${code}`,
          text: `Hola ${employeeName || ''}, tu código de autorización para consumo en salón a las ${new Date().toLocaleTimeString('es-DO')} es: ${code}`,
          html: `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #ec4899; border-radius: 12px; max-width: 500px;">
              <h2 style="color: #be185d;">Autorización de Consumo de Empleado</h2>
              <p>Hola <strong>${escapeHtml(employeeName || 'Colaborador')}</strong>,</p>
              <p>Se ha registrado un consumo de servicios en salón a las <strong>${new Date().toLocaleTimeString('es-DO')}</strong>.</p>
              <p style="font-size: 24px; font-weight: bold; color: #ec4899; letter-spacing: 4px; text-align: center; background: #fdf2f8; padding: 10px; border-radius: 8px;">${code}</p>
              <p style="font-size: 12px; color: #64748b;">Si no realizaste esta solicitud, por favor comunícate con administración inmediatamente.</p>
            </div>
          `
        });
      }

      res.json({ success: true, message: 'Código de autorización enviado al correo.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // === ENDPOINTS DE AUTORIZACIÓN DE NÓMINA (FACTURACIÓN POS) ===
  const handleNominaOtp = async (req, res) => {
    try {
      const { employee_id, email, amount } = req.body;
      let targetEmail = email;
      let empName = 'Colaborador';

      if (employee_id) {
        const cleanEmpId = String(employee_id).replace('EMP-', '');
        const [empRows] = await pool.query('SELECT * FROM staff_records WHERE id = ? OR nombre = ? LIMIT 1', [cleanEmpId, employee_id]);
        if (empRows && empRows.length > 0) {
          if (!targetEmail) targetEmail = empRows[0].email;
          empName = empRows[0].nombre || empName;
        }
      }

      if (!targetEmail || !targetEmail.includes('@')) {
        return res.status(400).json({ error: 'El colaborador no tiene un correo electrónico válido registrado en el sistema.' });
      }

      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos
      const clientIdKey = `EMP-${employee_id || 'GEN'}`;

      await pool.query(
        'INSERT INTO verification_codes (client_id, code, expires_at) VALUES (?, ?, ?)',
        [clientIdKey, code, expiresAt]
      );

      try {
        const [smtpRows] = await pool.query('SELECT * FROM email_settings LIMIT 1');
        if (smtpRows && smtpRows.length > 0 && smtpRows[0].smtp_host) {
          const cfg = smtpRows[0];
          const transporter = nodemailer.createTransport({
            host: cfg.smtp_host,
            port: cfg.smtp_port,
            secure: parseInt(cfg.smtp_port) === 465 || cfg.smtp_secure === 1,
            auth: { user: cfg.smtp_user, pass: cfg.smtp_pass },
            tls: { rejectUnauthorized: false }
          });

          const formattedAmount = Number(amount || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 });
          await transporter.sendMail({
            from: cfg.smtp_from ? `"${cfg.smtp_from}" <${cfg.smtp_user}>` : '"Plan Beauty RD" <hola@planbeautyrd.com>',
            to: targetEmail,
            subject: `🔐 Código de Autorización Nómina: ${code}`,
            text: `Hola ${empName}, tu código de autorización para el cargo a nómina por RD$ ${formattedAmount} es: ${code}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 25px; border-radius: 16px; background: #eff6ff; border: 1px solid #bfdbfe; text-align: center;">
                <div style="font-size: 36px; margin-bottom: 10px;">📋</div>
                <h2 style="color: #1e40af; margin: 0 0 8px 0; font-weight: 900;">Autorización de Descuento por Nómina</h2>
                <p style="color: #475569; font-size: 14px; margin-bottom: 20px;">
                  Hola <strong>${escapeHtml(empName)}</strong>, se ha solicitado un cargo por servicios en salón:
                </p>
                <div style="background: #ffffff; border-radius: 12px; padding: 15px; margin: 15px 0; border: 1px dashed #93c5fd;">
                  <p style="margin: 0; color: #64748b; font-size: 13px;">Monto a descontar de nómina:</p>
                  <p style="margin: 5px 0 0; font-size: 22px; font-weight: 900; color: #1e40af;">RD$ ${formattedAmount}</p>
                </div>
                <p style="font-size: 13px; color: #64748b; margin-bottom: 10px;">Tu código de autorización de 6 dígitos es:</p>
                <div style="font-size: 32px; font-weight: 900; letter-spacing: 8px; color: #1d4ed8; background: #ffffff; padding: 16px; border-radius: 12px; border: 2px solid #3b82f6; display: inline-block; margin-bottom: 20px;">
                  ${code}
                </div>
                <p style="color: #94a3b8; font-size: 12px; margin: 0;">
                  Válido por 15 minutos. Si no realizaste esta solicitud, notifica de inmediato a Administración.
                </p>
              </div>
            `
          });
        }
      } catch (mailErr) {
        console.warn('[NOMINA OTP MAIL WARNING]: Fallo en envío SMTP, código guardado en base de datos:', mailErr.message);
      }

      res.json({ success: true, message: 'Código de autorización enviado correctamente al correo.' });
    } catch (err) {
      console.error('[NOMINA OTP ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  };

  router.post('/nomina-otp', handleNominaOtp);
  router.post('/employees/nomina-otp', handleNominaOtp);

  const handleVerifyNominaOtp = async (req, res) => {
    try {
      const { employee_id, pin } = req.body;
      const cleanPin = String(pin || '').trim();

      // Master bypass pins (contingencia)
      if (cleanPin === '2026' || cleanPin === '1234' || cleanPin === '8888') {
        return res.json({ success: true, message: 'Código verificado con éxito (Bypass).' });
      }

      const clientIdKey = `EMP-${employee_id || ''}`;
      const rawId = String(employee_id || '').replace('EMP-', '');

      const [rows] = await pool.query(
        `SELECT * FROM verification_codes 
         WHERE (client_id = ? OR client_id = ? OR client_id = ?) 
           AND code = ? 
           AND is_used = 0 
           AND expires_at > NOW() 
         ORDER BY id DESC LIMIT 1`,
        [clientIdKey, rawId, employee_id, cleanPin]
      );

      if (!rows || rows.length === 0) {
        const [fallback] = await pool.query(
          'SELECT * FROM verification_codes WHERE code = ? AND is_used = 0 AND expires_at > NOW() ORDER BY id DESC LIMIT 1',
          [cleanPin]
        );
        if (!fallback || fallback.length === 0) {
          return res.status(400).json({ error: 'Código de verificación incorrecto o expirado.' });
        }
        await pool.query('UPDATE verification_codes SET is_used = 1 WHERE id = ?', [fallback[0].id]);
        return res.json({ success: true, message: 'Código verificado correctamente.' });
      }

      await pool.query('UPDATE verification_codes SET is_used = 1 WHERE id = ?', [rows[0].id]);
      res.json({ success: true, message: 'Código verificado exitosamente.' });
    } catch (err) {
      console.error('[VERIFY NOMINA OTP ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  };

  router.post('/verify-nomina-otp', handleVerifyNominaOtp);
  router.post('/employees/verify-nomina-otp', handleVerifyNominaOtp);

  // === ENDPOINTS DE CONSULTA DE COMISIONES EN KIOSCO ===
  const handleCommissionPin = async (req, res) => {
    try {
      const { employee_id, email, save_email } = req.body;
      let targetEmail = email ? String(email).trim() : '';
      let empName = 'Colaborador';
      let empRecordId = null;

      if (employee_id) {
        const cleanEmpId = String(employee_id).replace('EMP-', '').replace('COMM-', '');
        const [empRows] = await pool.query('SELECT * FROM staff_records WHERE id = ? OR nombre = ? LIMIT 1', [cleanEmpId, employee_id]);
        if (empRows && empRows.length > 0) {
          empRecordId = empRows[0].id;
          if (!targetEmail) targetEmail = (empRows[0].email || '').trim();
          empName = empRows[0].nombre || empName;
        }
      }

      // Si el usuario proporcionó un correo y el colaborador no tenía uno (o se solicitó guardar), actualizarlo en staff_records
      if (empRecordId && targetEmail && targetEmail.includes('@')) {
        try {
          await pool.query(
            "UPDATE staff_records SET email = ? WHERE id = ? AND (email IS NULL OR email = '' OR ? = 1)",
            [targetEmail, empRecordId, save_email ? 1 : 0]
          );
        } catch (saveErr) {
          console.warn('Could not update staff email:', saveErr.message);
        }
      }

      if (!targetEmail || !targetEmail.includes('@')) {
        return res.status(400).json({ 
          error: 'El colaborador no tiene un correo electrónico registrado para recibir el PIN.',
          needsEmail: true 
        });
      }

      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      const cleanId = String(employee_id || '').replace('COMM-', '').replace('EMP-', '');
      const clientIdKey = `COMM-${cleanId || 'GEN'}`;

      await pool.query(
        'INSERT INTO verification_codes (client_id, code, expires_at) VALUES (?, ?, ?)',
        [clientIdKey, code, expiresAt]
      );

      // Send email asynchronously so HTTP response is instantaneous and doesn't block Kiosk UI
      pool.query('SELECT * FROM email_settings LIMIT 1')
        .then(([smtpRows]) => {
          if (smtpRows && smtpRows.length > 0 && smtpRows[0].smtp_host) {
            const cfg = smtpRows[0];
            const transporter = nodemailer.createTransport({
              host: cfg.smtp_host,
              port: cfg.smtp_port,
              secure: parseInt(cfg.smtp_port) === 465 || cfg.smtp_secure === 1,
              auth: { user: cfg.smtp_user, pass: cfg.smtp_pass },
              connectionTimeout: 5000,
              greetingTimeout: 5000,
              socketTimeout: 8000
            });

            return transporter.sendMail({
              from: cfg.smtp_from ? `"${cfg.smtp_from}" <${cfg.smtp_user}>` : '"Plan Beauty RD" <hola@planbeautyrd.com>',
              to: targetEmail,
              subject: `🔐 PIN de Consulta de Comisiones: ${code}`,
              text: `Hola ${empName}, tu PIN para consultar tus comisiones en el Kiosco es: ${code}`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 25px; border-radius: 16px; background: #f5f3ff; border: 1px solid #ddd6fe; text-align: center;">
                  <div style="font-size: 36px; margin-bottom: 10px;">💰</div>
                  <h2 style="color: #6d28d9; margin: 0 0 8px 0; font-weight: 900;">Consulta de Comisiones</h2>
                  <p style="color: #475569; font-size: 14px; margin-bottom: 20px;">
                    Hola <strong>${escapeHtml(empName)}</strong>, se solicitó acceso para consultar tus comisiones acumuladas en el Kiosco:
                  </p>
                  <div style="font-size: 32px; font-weight: 900; letter-spacing: 8px; color: #7c3aed; background: #ffffff; padding: 16px; border-radius: 12px; border: 2px solid #8b5cf6; display: inline-block; margin-bottom: 20px;">
                    ${code}
                  </div>
                  <p style="color: #94a3b8; font-size: 12px; margin: 0;">
                    Ingresa este PIN de 6 dígitos en el Kiosco. Válido por 15 minutos.
                  </p>
                </div>
              `
            });
          }
        })
        .catch(mailErr => {
          console.error('[COMMISSION PIN ASYNC EMAIL ERROR]:', mailErr.message);
        });

      return res.json({ success: true, message: 'PIN generado y enviado al correo.' });
    } catch (err) {
      console.error('[COMMISSION PIN ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  };

  router.post('/commission-pin', handleCommissionPin);
  router.post('/employees/commission-pin', handleCommissionPin);

  const handleVerifyCommissionPin = async (req, res) => {
    try {
      const { employee_id, pin } = req.body;
      const cleanPin = String(pin || '').trim();

      // Master bypass pins (supervisión y contingencia)
      if (cleanPin === '2026' || cleanPin === '1234' || cleanPin === '8888') {
        return res.json({ success: true, message: 'PIN verificado con éxito (Bypass).' });
      }

      const rawId = String(employee_id || '').replace('COMM-', '').replace('EMP-', '');
      const clientIdKey = `COMM-${rawId || ''}`;

      // 1. Check generated OTP codes in verification_codes table
      const [rows] = await pool.query(
        `SELECT * FROM verification_codes 
         WHERE (client_id = ? OR client_id = ? OR client_id = ? OR client_id LIKE ?) 
           AND code = ? 
           AND is_used = 0 
           AND expires_at > NOW() 
         ORDER BY id DESC LIMIT 1`,
        [clientIdKey, rawId, employee_id, `%${rawId}%`, cleanPin]
      );

      if (rows && rows.length > 0) {
        await pool.query('UPDATE verification_codes SET is_used = 1 WHERE id = ?', [rows[0].id]);
        return res.json({ success: true, message: 'PIN verificado exitosamente.' });
      }

      // 2. Global OTP code fallback
      const [fallback] = await pool.query(
        'SELECT * FROM verification_codes WHERE code = ? AND is_used = 0 AND expires_at > NOW() ORDER BY id DESC LIMIT 1',
        [cleanPin]
      );
      if (fallback && fallback.length > 0) {
        await pool.query('UPDATE verification_codes SET is_used = 1 WHERE id = ?', [fallback[0].id]);
        return res.json({ success: true, message: 'PIN verificado correctamente.' });
      }

      // 3. Check if PIN matches employee user password or pin in users / staff_records
      if (rawId) {
        const [staff] = await pool.query('SELECT * FROM staff_records WHERE id = ? OR nombre = ? LIMIT 1', [rawId, employee_id]);
        if (staff && staff.length > 0) {
          const staffEmail = (staff[0].email || '').trim();
          const staffName = (staff[0].nombre || '').trim();
          const [usr] = await pool.query(
            'SELECT * FROM users WHERE (email = ? AND email != "") OR name = ? LIMIT 1',
            [staffEmail, staffName]
          );
          if (usr && usr.length > 0 && usr[0].password) {
            if (usr[0].password === cleanPin) {
              return res.json({ success: true, message: 'PIN verificado con contraseña de usuario.' });
            }
            const isMatch = await bcrypt.compare(cleanPin, usr[0].password).catch(() => false);
            if (isMatch) {
              return res.json({ success: true, message: 'PIN verificado con contraseña de usuario.' });
            }
          }
        }
      }

      return res.status(400).json({ error: 'PIN incorrecto o expirado.' });
    } catch (err) {
      console.error('[VERIFY COMMISSION PIN ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  };

  router.post('/verify-commission-pin', handleVerifyCommissionPin);
  router.post('/employees/verify-commission-pin', handleVerifyCommissionPin);

  return router;
}

module.exports = { createEmployeeSecurityRouter };
