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
 * Router for Employee Discounts, Payroll Deductions, OTP and Kiosk Commission PIN (Strictly Scoped by tenant_id)
 * 
 * @param {import('mysql2/promise').Pool} pool
 */
function createEmployeeSecurityRouter(pool) {
  const router = express.Router();

  // === EMPLOYEE DISCOUNTS & DEDUCTIONS MODULE ===
  router.get('/employee-discounts', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de empresa requerido.' });
      }

      // Auto-cascade/clean any existing deductions linked to voided visits within the tenant
      try {
        await pool.query(`
          UPDATE employee_discounts ed
          SET status = 'Anulado'
          FROM visits v
          WHERE ed.tenant_id = $1
            AND v.tenant_id = $1
            AND (ed.visit_id = v.id OR ed.notes LIKE ('%#' || v.ticket_number || '%') OR ed.notes LIKE ('%#' || v.id::text || '%'))
            AND v.status = 'Anulado'
            AND ed.status != 'Anulado'
        `, [tenantId]);
      } catch (syncErr) {}

      const { employee_id, status, type, start_date, end_date } = req.query;
      let query = `
        SELECT ed.id, ed.employee_id, ed.type, ed.amount, TO_CHAR(ed.date, 'YYYY-MM-DD') as date, 
               ed.notes, ed.status, ed.created_by, ed.created_at,
               COALESCE(s.nombre, ed.employee_name) as employee_name, 
               COALESCE(s.posicion, 'Colaborador') as employee_position, 
               COALESCE(s.localidad, 'Principal') as localidad
        FROM employee_discounts ed
        LEFT JOIN staff_records s ON (ed.employee_id = s.id OR (ed.employee_id = 0 AND ed.employee_name = s.nombre)) AND s.tenant_id = ed.tenant_id
        WHERE ed.tenant_id = ?
      `;
      const params = [tenantId];
      if (employee_id && employee_id !== 'all') {
        query += ' AND ed.employee_id = ?';
        params.push(employee_id);
      }
      if (status && status !== 'all') {
        query += ' AND ed.status = ?';
        params.push(status);
      } else {
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

  const ALLOWED_DISCOUNT_STATUSES = new Set(['Pendiente', 'Aplicado', 'Anulado']);
  const isPositiveIntId = (v) => /^\d+$/.test(String(v || '').trim()) && Number(v) > 0;

  router.post('/employee-discounts', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de empresa requerido.' });
      }

      const { employee_id, employee_name, type, amount, date, notes, status, created_by } = req.body;
      const numAmount = Number(amount);
      if (!employee_id || !Number.isFinite(numAmount) || numAmount <= 0) {
        return res.status(400).json({ error: 'Colaborador y monto válido mayor a 0 son requeridos.', code: 'INVALID_DISCOUNT_INPUT' });
      }
      if (!isPositiveIntId(employee_id)) {
        return res.status(404).json({ error: 'Colaborador no encontrado en esta empresa.', code: 'EMPLOYEE_NOT_FOUND' });
      }
      const targetStatus = status ? String(status).trim() : 'Pendiente';
      if (!ALLOWED_DISCOUNT_STATUSES.has(targetStatus)) {
        return res.status(400).json({ error: `Estatus inválido ('${targetStatus}').`, code: 'INVALID_DISCOUNT_STATUS' });
      }

      const cleanDate = date ? (String(date).includes('T') ? String(date).split('T')[0] : String(date).split(' ')[0]) : new Date().toISOString().split('T')[0];
      const [emp] = await pool.query('SELECT id, nombre FROM staff_records WHERE id = ? AND tenant_id = ? LIMIT 1', [employee_id, tenantId]);
      if (!emp || emp.length === 0) {
        return res.status(404).json({ error: 'Colaborador no encontrado en esta empresa.', code: 'EMPLOYEE_NOT_FOUND' });
      }
      const empName = emp[0].nombre || employee_name || 'Colaborador';
      const actorName = req.auth?.name || req.auth?.email || created_by || 'Admin';

      const [result] = await pool.query(
        `INSERT INTO employee_discounts (tenant_id, employee_id, employee_name, type, amount, date, notes, status, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         RETURNING id`,
        [tenantId, employee_id, empName, type || 'Consumo_Servicio', numAmount, cleanDate, notes || '', targetStatus, actorName]
      );

      res.json({ success: true, id: result.insertId || result[0]?.id, message: 'Descuento registrado exitosamente' });
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/employee-discounts/:id', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      if (!isPositiveIntId(id)) {
        return res.status(404).json({ error: 'Descuento no encontrado en esta empresa.' });
      }
      const { employee_id, employee_name, type, amount, date, notes, status } = req.body;

      const [check] = await pool.query('SELECT id, status FROM employee_discounts WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      if (check.length === 0) {
        return res.status(404).json({ error: 'Descuento no encontrado en esta empresa.' });
      }
      const curStatus = String(check[0].status || '').toLowerCase();
      if (curStatus === 'saldado') {
        return res.status(409).json({ error: 'No se puede modificar un descuento ya saldado en nómina.', code: 'DISCOUNT_ALREADY_SETTLED' });
      }
      if (curStatus === 'anulado') {
        return res.status(409).json({ error: 'No se puede modificar un descuento anulado.', code: 'DISCOUNT_VOIDED' });
      }

      let numAmount = null;
      if (amount !== undefined && amount !== null && amount !== '') {
        numAmount = Number(amount);
        if (!Number.isFinite(numAmount) || numAmount <= 0) {
          return res.status(400).json({ error: 'El monto del descuento debe ser mayor a 0.', code: 'INVALID_DISCOUNT_AMOUNT' });
        }
      }
      let nextStatus = null;
      if (status !== undefined && status !== null && String(status).trim() !== '') {
        nextStatus = String(status).trim();
        if (!ALLOWED_DISCOUNT_STATUSES.has(nextStatus)) {
          return res.status(400).json({ error: `Estatus inválido ('${nextStatus}').`, code: 'INVALID_DISCOUNT_STATUS' });
        }
      }
      let resolvedEmpName = employee_name || null;
      if (employee_id !== undefined && employee_id !== null && String(employee_id).trim() !== '') {
        if (!isPositiveIntId(employee_id)) {
          return res.status(404).json({ error: 'Colaborador no encontrado en esta empresa.', code: 'EMPLOYEE_NOT_FOUND' });
        }
        const [emp] = await pool.query('SELECT id, nombre FROM staff_records WHERE id = ? AND tenant_id = ? LIMIT 1', [employee_id, tenantId]);
        if (!emp || emp.length === 0) {
          return res.status(404).json({ error: 'Colaborador no encontrado en esta empresa.', code: 'EMPLOYEE_NOT_FOUND' });
        }
        resolvedEmpName = emp[0].nombre || resolvedEmpName;
      }

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
         WHERE id = ? AND tenant_id = ?`,
        [employee_id || null, resolvedEmpName, type || null, numAmount, cleanDate || null, notes !== undefined ? notes : null, nextStatus, id, tenantId]
      );

      res.json({ success: true, message: 'Descuento actualizado exitosamente' });
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/employee-discounts/:id', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      if (!isPositiveIntId(id)) {
        return res.status(404).json({ error: 'Descuento no encontrado en esta empresa.' });
      }
      const [check] = await pool.query('SELECT id, status FROM employee_discounts WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      if (check.length === 0) {
        return res.status(404).json({ error: 'Descuento no encontrado en esta empresa.' });
      }
      const curStatus = String(check[0].status || '').toLowerCase();
      if (curStatus === 'saldado') {
        return res.status(409).json({ error: 'No se puede eliminar un descuento ya saldado en nómina.', code: 'DISCOUNT_ALREADY_SETTLED' });
      }
      if (curStatus === 'anulado') {
        return res.status(409).json({ error: 'No se puede eliminar un descuento anulado para preservar trazabilidad.', code: 'DISCOUNT_VOIDED' });
      }

      await pool.query('DELETE FROM employee_discounts WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      res.json({ success: true, message: 'Descuento eliminado exitosamente' });
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  });

  // === EMPLOYEE OTP AUTHORIZATION ===
  const { resolveTransporterForTenant } = require('../services/platform_email.service');
  const { verifyPin } = require('../services/pin_security.service');

  const getTenantBrandName = async (tenantId) => {
    try {
      const [rows] = await pool.query('SELECT business_name FROM tenants WHERE id = ? LIMIT 1', [tenantId]);
      return rows?.[0]?.business_name || 'Etereas';
    } catch {
      return 'Etereas';
    }
  };

  router.post('/auth/send-employee-otp', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { employeeId, employeeEmail, employeeName } = req.body || {};
      let targetEmail = String(employeeEmail || '').trim();
      let resolvedName = String(employeeName || '').trim() || 'Colaborador';

      if (!targetEmail && employeeId) {
        const cleanId = String(employeeId).replace('EMP-', '').trim();
        const [empRows] = await pool.query(
          'SELECT nombre, email FROM staff_records WHERE (id::text = ? OR LOWER(nombre) = LOWER(?)) AND tenant_id = ? LIMIT 1',
          [cleanId, cleanId, tenantId]
        );
        if (empRows?.[0]?.email) {
          targetEmail = String(empRows[0].email).trim();
          resolvedName = empRows[0].nombre || resolvedName;
        } else {
          const [uRows] = await pool.query(
            'SELECT COALESCE(nombre, name) AS nombre, email FROM users WHERE (id::text = ? OR LOWER(COALESCE(nombre, name, \'\')) = LOWER(?)) AND tenant_id = ? LIMIT 1',
            [cleanId, empRows?.[0]?.nombre || cleanId, tenantId]
          );
          if (uRows?.[0]?.email) {
            targetEmail = String(uRows[0].email).trim();
            resolvedName = uRows[0].nombre || resolvedName;
          }
        }
      }

      if (!targetEmail || !targetEmail.includes('@')) {
        return res.status(400).json({ error: 'El colaborador no tiene correo electrónico registrado.' });
      }

      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      const brandName = await getTenantBrandName(tenantId);

      await pool.query(
        'INSERT INTO verification_codes (tenant_id, client_id, code, expires_at) VALUES (?, ?, ?, ?)',
        [tenantId, employeeId || 'EMP', code, expiresAt]
      );

      const { transporter, fromAddress } = await resolveTransporterForTenant(pool, tenantId, brandName);
      if (!transporter || !fromAddress) {
        return res.status(503).json({ error: 'No hay servidor SMTP configurado para enviar el código.' });
      }

      await transporter.sendMail({
        from: fromAddress,
        to: targetEmail,
        subject: `🔒 Código de Seguridad Consumo Nómina (${code}) — ${brandName}`,
        text: `Hola ${resolvedName}, tu código de autorización para consumo en ${brandName} a las ${new Date().toLocaleTimeString('es-DO')} es: ${code}`,
        html: `
          <div style="font-family: sans-serif; padding: 22px; border: 1px solid #e2e8f0; border-radius: 14px; max-width: 500px; margin: 0 auto; background: #ffffff;">
            <h2 style="color: #be185d; margin-top: 0;">Autorización de Consumo de Colaborador</h2>
            <p>Hola <strong>${escapeHtml(resolvedName)}</strong>,</p>
            <p>Se ha solicitado un consumo de servicios en <strong>${escapeHtml(brandName)}</strong> a las <strong>${new Date().toLocaleTimeString('es-DO')}</strong>.</p>
            <p style="font-size: 28px; font-weight: bold; color: #be185d; letter-spacing: 6px; text-align: center; background: #fdf2f8; padding: 12px; border-radius: 10px; border: 1px solid #fbcfe8;">${code}</p>
            <p style="font-size: 12px; color: #64748b; margin-bottom: 0;">Si no realizaste esta solicitud, comunícate con administración inmediatamente.</p>
          </div>
        `
      });

      res.json({ success: true, emailSent: true, message: 'Código de autorización enviado al correo del colaborador.' });
    } catch (err) {
      console.error('[SEND EMPLOYEE OTP ERROR]:', err);
      res.status(500).json({ error: err.message || 'No se pudo enviar el código OTP.' });
    }
  });

  // === ENDPOINTS DE AUTORIZACIÓN DE NÓMINA (FACTURACIÓN POS) ===
  const handleNominaOtp = async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { employee_id, email, amount } = req.body || {};
      let targetEmail = email ? String(email).trim() : '';
      let empName = 'Colaborador';
      const cleanEmpId = String(employee_id || '').replace('EMP-', '').trim();

      if (cleanEmpId) {
        const [empRows] = await pool.query(
          'SELECT * FROM staff_records WHERE (id::text = ? OR LOWER(nombre) = LOWER(?)) AND tenant_id = ? LIMIT 1',
          [cleanEmpId, cleanEmpId, tenantId]
        );
        if (empRows && empRows.length > 0) {
          if (!targetEmail) targetEmail = String(empRows[0].email || '').trim();
          empName = empRows[0].nombre || empName;
        }
        if (!targetEmail) {
          const [uRows] = await pool.query(
            'SELECT COALESCE(nombre, name) AS nombre, email FROM users WHERE (id::text = ? OR LOWER(COALESCE(nombre, name, \'\')) = LOWER(?)) AND tenant_id = ? LIMIT 1',
            [cleanEmpId, empName !== 'Colaborador' ? empName : cleanEmpId, tenantId]
          );
          if (uRows && uRows.length > 0) {
            targetEmail = String(uRows[0].email || '').trim();
            empName = uRows[0].nombre || empName;
          }
        }
      }

      if (!targetEmail || !targetEmail.includes('@')) {
        return res.status(400).json({
          error: `El colaborador (${empName}) no tiene correo electrónico registrado en Personal/Usuarios. Regístralo para poder enviarle el código OTP.`,
          code: 'EMPLOYEE_EMAIL_MISSING',
        });
      }

      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      const clientIdKey = `EMP-${cleanEmpId || 'GEN'}`;
      const brandName = await getTenantBrandName(tenantId);

      await pool.query(
        'INSERT INTO verification_codes (tenant_id, client_id, code, expires_at) VALUES (?, ?, ?, ?)',
        [tenantId, clientIdKey, code, expiresAt]
      );

      const { transporter, fromAddress } = await resolveTransporterForTenant(pool, tenantId, brandName);
      if (!transporter || !fromAddress) {
        return res.status(503).json({
          error: 'No hay servidor SMTP configurado para enviar el código OTP por correo.',
          code: 'SMTP_NOT_CONFIGURED',
        });
      }

      const formattedAmount = Number(amount || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 });
      await transporter.sendMail({
        from: fromAddress,
        to: targetEmail,
        subject: `🔐 Código de Autorización Nómina (${code}) — ${brandName}`,
        text: `Hola ${empName}, tu código de autorización para el cargo a nómina por RD$ ${formattedAmount} en ${brandName} es: ${code}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 25px; border-radius: 16px; background: #eff6ff; border: 1px solid #bfdbfe; text-align: center;">
            <div style="font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #1d4ed8; margin-bottom: 8px;">${escapeHtml(brandName)}</div>
            <h2 style="color: #1e40af; margin: 0 0 8px 0; font-weight: 900;">Autorización de Descuento por Nómina</h2>
            <p style="color: #475569; font-size: 14px; margin-bottom: 20px;">
              Hola <strong>${escapeHtml(empName)}</strong>, se ha solicitado un cargo por consumo en recepción:
            </p>
            <div style="background: #ffffff; border-radius: 12px; padding: 15px; margin: 15px 0; border: 1px dashed #93c5fd;">
              <p style="margin: 0; color: #64748b; font-size: 13px;">Monto a descontar de nómina:</p>
              <p style="margin: 5px 0 0; font-size: 22px; font-weight: 900; color: #1e40af;">RD$ ${formattedAmount}</p>
            </div>
            <p style="font-size: 13px; color: #64748b; margin-bottom: 10px;">Tu código de autorización de 6 dígitos es:</p>
            <div style="font-size: 32px; font-weight: 900; letter-spacing: 8px; color: #1d4ed8; background: #ffffff; padding: 16px; border-radius: 12px; border: 2px solid #3b82f6; display: inline-block; margin-bottom: 12px;">
              ${code}
            </div>
            <p style="font-size: 12px; color: #64748b; margin: 0;">Válido por 15 minutos.</p>
          </div>
        `
      });

      res.json({
        success: true,
        emailSent: true,
        message: `Código de autorización enviado a ${targetEmail}.`
      });
    } catch (err) {
      console.error('[NOMINA OTP ERROR]:', err);
      res.status(500).json({ error: 'No se pudo enviar el código de autorización al correo del colaborador.' });
    }
  };

  router.post('/nomina-otp', handleNominaOtp);
  router.post('/employees/nomina-otp', handleNominaOtp);

  const handleVerifyNominaOtp = async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { employee_id, pin } = req.body;
      const cleanPin = String(pin || '').trim();

      if (!cleanPin) {
        return res.status(400).json({ error: 'PIN requerido.' });
      }

      const rawId = String(employee_id || '').replace('EMP-', '').trim();
      const clientIdKey = `EMP-${rawId || 'GEN'}`;

      const [rows] = await pool.query(
        `SELECT * FROM verification_codes 
         WHERE tenant_id = ?
           AND (client_id = ? OR client_id = ? OR client_id = ? OR client_id = 'EMP-GEN') 
           AND code = ? 
           AND is_used = 0 
           AND expires_at > NOW() 
         ORDER BY id DESC LIMIT 1`,
        [tenantId, clientIdKey, rawId, String(employee_id || ''), cleanPin]
      );

      if (rows && rows.length > 0) {
        await pool.query('UPDATE verification_codes SET is_used = 1 WHERE id = ? AND tenant_id = ?', [rows[0].id, tenantId]);
        return res.json({ success: true, message: 'Código verificado exitosamente.' });
      }

      // Permitir PIN maestro gerencial o PIN OTP dinámico de security_settings de la empresa
      const [secRows] = await pool.query(
        'SELECT admin_pin, admin_pin_hash, active_otp_pin, otp_expires_at FROM security_settings WHERE tenant_id = ? LIMIT 1',
        [tenantId]
      ).catch(() => [[]]);
      const sec = secRows?.[0] || null;
      if (sec) {
        if (sec.active_otp_pin && cleanPin === String(sec.active_otp_pin).trim() && (!sec.otp_expires_at || new Date(sec.otp_expires_at) > new Date())) {
          return res.json({ success: true, message: 'Autorizado mediante PIN OTP administrativo.' });
        }
        const storedMaster = sec.admin_pin_hash || sec.admin_pin;
        if (storedMaster) {
          const verifyRes = await verifyPin(cleanPin, storedMaster);
          if (verifyRes.matched && !verifyRes.isLegacy) {
            return res.json({ success: true, message: 'Autorizado mediante PIN Maestro administrativo.' });
          }
        }
      }

      return res.status(400).json({ error: 'Código de verificación incorrecto o expirado.' });
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
      const tenantId = req.tenantId;
      const { employee_id, email, save_email } = req.body;
      let targetEmail = email ? String(email).trim() : '';
      let empName = 'Colaborador';
      let empRecordId = null;

      if (employee_id) {
        const cleanEmpId = String(employee_id).replace('EMP-', '').replace('COMM-', '');
        const [empRows] = await pool.query('SELECT * FROM staff_records WHERE (id = ? OR nombre = ?) AND tenant_id = ? LIMIT 1', [cleanEmpId, employee_id, tenantId]);
        if (empRows && empRows.length > 0) {
          empRecordId = empRows[0].id;
          if (!targetEmail) targetEmail = (empRows[0].email || '').trim();
          empName = empRows[0].nombre || empName;
        }
      }

      if (empRecordId && targetEmail && targetEmail.includes('@')) {
        try {
          await pool.query(
            "UPDATE staff_records SET email = ? WHERE id = ? AND tenant_id = ? AND (email IS NULL OR email = '' OR ? = 1)",
            [targetEmail, empRecordId, tenantId, save_email ? 1 : 0]
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
        'INSERT INTO verification_codes (tenant_id, client_id, code, expires_at) VALUES (?, ?, ?, ?)',
        [tenantId, clientIdKey, code, expiresAt]
      );

      const brandName = await getTenantBrandName(tenantId);
      const { transporter, fromAddress } = await resolveTransporterForTenant(pool, tenantId, brandName);
      if (transporter && fromAddress) {
        await transporter.sendMail({
          from: fromAddress,
          to: targetEmail,
          subject: `🔐 PIN de Consulta de Comisiones (${code}) — ${brandName}`,
          text: `Hola ${empName}, tu PIN para consultar tus comisiones en el Kiosco es: ${code}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 25px; border-radius: 16px; background: #f5f3ff; border: 1px solid #ddd6fe; text-align: center;">
              <div style="font-size: 36px; margin-bottom: 10px;">💰</div>
              <h2 style="color: #6d28d9; margin: 0 0 8px 0; font-weight: 900;">Consulta de Comisiones</h2>
              <p style="color: #475569; font-size: 14px; margin-bottom: 20px;">
                Hola <strong>${escapeHtml(empName)}</strong>, se solicitó acceso para consultar tus comisiones acumuladas:
              </p>
              <div style="font-size: 32px; font-weight: 900; letter-spacing: 8px; color: #7c3aed; background: #ffffff; padding: 16px; border-radius: 12px; border: 2px solid #8b5cf6; display: inline-block; margin-bottom: 20px;">
                ${code}
              </div>
            </div>
          `
        });
      }

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
      const tenantId = req.tenantId;
      const { employee_id, pin } = req.body;
      const cleanPin = String(pin || '').trim();

      if (!cleanPin) {
        return res.status(400).json({ error: 'PIN requerido.' });
      }

      const rawId = String(employee_id || '').replace('COMM-', '').replace('EMP-', '');
      const clientIdKey = `COMM-${rawId || ''}`;

      const [rows] = await pool.query(
        `SELECT * FROM verification_codes 
         WHERE tenant_id = ?
           AND (client_id = ? OR client_id = ? OR client_id = ? OR client_id LIKE ?) 
           AND code = ? 
           AND is_used = 0 
           AND expires_at > NOW() 
         ORDER BY id DESC LIMIT 1`,
        [tenantId, clientIdKey, rawId, employee_id, `%${rawId}%`, cleanPin]
      );

      if (rows && rows.length > 0) {
        await pool.query('UPDATE verification_codes SET is_used = 1 WHERE id = ? AND tenant_id = ?', [rows[0].id, tenantId]);
        return res.json({ success: true, message: 'PIN verificado exitosamente.' });
      }

      // Check if PIN matches employee user password or pin in users / staff_records
      if (rawId) {
        const [staff] = await pool.query('SELECT * FROM staff_records WHERE (id = ? OR nombre = ?) AND tenant_id = ? LIMIT 1', [rawId, employee_id, tenantId]);
        if (staff && staff.length > 0) {
          const staffEmail = (staff[0].email || '').trim();
          const staffName = (staff[0].nombre || '').trim();
          const [usr] = await pool.query(
            'SELECT * FROM users WHERE tenant_id = ? AND ((email = ? AND email != "") OR name = ?) LIMIT 1',
            [tenantId, staffEmail, staffName]
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
