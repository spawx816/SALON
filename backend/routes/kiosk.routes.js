'use strict';

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { getEffectiveRole, isBranchAuthorized } = require('../middleware/rbac.middleware');
const { expandEffectivePermissions, permissionMapGrants } = require('../domain/rbac_catalog');
const { getPrivateStorageAdapter } = require('../services/private_storage_adapter');
const { resolveTransporterForTenant } = require('../services/platform_email.service');
const {
  KIOSK_DEVICE_COOKIE,
  KIOSK_SELF_SERVICE_COOKIE,
  DEVICE_TTL_MS,
  SELF_SERVICE_ABSOLUTE_TTL_MS,
  buildCookieOptions,
  checkPinRateLimit,
  recordPinFailure,
  clearPinFailures,
  bindKioskDevice,
  resolveKioskDevice,
  revokeKioskDevice,
  isEmployeeAuthorizedForBranch,
  createKioskEmployeeSession,
  validatePunchSession,
  consumePunchSession,
  resolveSelfServiceSession,
  invalidateSelfServiceSession,
} = require('../services/kiosk_device.service');

const otpAttemptsMap = new Map();

function getDatePartsInTimezone(timezone = 'America/Santo_Domingo') {
  const tz = timezone || 'America/Santo_Domingo';
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
  const localStr = now.toLocaleString('en-US', { timeZone: tz });
  const localDate = new Date(localStr);
  const tsStr = `${dateStr} ${String(localDate.getHours()).padStart(2, '0')}:${String(localDate.getMinutes()).padStart(2, '0')}:${String(localDate.getSeconds()).padStart(2, '0')}`;
  return { dateStr, localDate, tsStr };
}

function normalizeDayName(name) {
  if (!name) return '';
  return String(name).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function base64ToBuffer(base64Str) {
  if (!base64Str || typeof base64Str !== 'string') return null;
  const parts = base64Str.split(',');
  const rawBase64 = parts.length > 1 ? parts[1] : parts[0];
  try {
    return Buffer.from(rawBase64, 'base64');
  } catch {
    return null;
  }
}

async function verifyFacesWithCompreFaceStrict(webCamBuffer, refPhotoBuffer, threshold = 0.75) {
  const compreFaceUrl = process.env.COMPREFACE_URL;
  const apiKey = process.env.COMPREFACE_API_KEY;
  if (!compreFaceUrl || !apiKey) {
    const err = new Error('El proveedor de verificación facial (CompreFace) no está configurado en el servidor.');
    err.statusCode = 503;
    err.code = 'BIOMETRIC_PROVIDER_UNAVAILABLE';
    throw err;
  }

  try {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('source_image', refPhotoBuffer, { filename: 'ref.jpg', contentType: 'image/jpeg' });
    form.append('target_image', webCamBuffer, { filename: 'webcam.jpg', contentType: 'image/jpeg' });

    const response = await axios.post(`${compreFaceUrl.replace(/\/$/, '')}/api/v1/verification/verify`, form, {
      headers: {
        ...form.getHeaders(),
        'x-api-key': apiKey,
      },
      timeout: 8000,
    });

    const data = response.data;
    if (data && Array.isArray(data.result) && data.result.length > 0) {
      const firstResult = data.result[0];
      const similarity = Array.isArray(firstResult?.face_matches) && firstResult.face_matches.length > 0
        ? firstResult.face_matches.reduce((max, m) => Math.max(max, Number(m?.similarity || 0)), 0)
        : Number(firstResult?.similarity || 0);
      return {
        isIdentical: similarity >= threshold,
        confidence: similarity,
      };
    }
    return { isIdentical: false, confidence: 0 };
  } catch (e) {
    if (e.statusCode) throw e;
    const err = new Error('Servicio de reconocimiento facial no disponible o agotó el tiempo de espera.');
    err.statusCode = 503;
    err.code = 'BIOMETRIC_PROVIDER_UNAVAILABLE';
    throw err;
  }
}

function createKioskRouter(pool, { authenticate }) {
  const router = express.Router();

  const canManageKiosks = (req) => {
    const role = getEffectiveRole(req);
    if (role === 'propietario' || role === 'admin') return true;
    const perms = expandEffectivePermissions(req.user?.permissions || {});
    return permissionMapGrants(perms, 'manage_settings') || permissionMapGrants(perms, 'manage_staff');
  };

  // Middleware for device-authenticated kiosk routes
  const requireKioskDevice = async (req, res, next) => {
    try {
      const resolved = await resolveKioskDevice(pool, req);
      if (!resolved) {
        res.clearCookie(KIOSK_DEVICE_COOKIE, { path: '/' });
        res.clearCookie(KIOSK_SELF_SERVICE_COOKIE, { path: '/' });
        return res.status(401).json({
          error: 'Dispositivo kiosco no vinculado, revocado o expirado.',
          code: 'KIOSK_DEVICE_UNBOUND',
        });
      }
      if (resolved.replaced) {
        res.clearCookie(KIOSK_DEVICE_COOKIE, { path: '/' });
        res.clearCookie(KIOSK_SELF_SERVICE_COOKIE, { path: '/' });
        res.clearCookie('auth_token', { path: '/' });
        return res.status(401).json({
          valid: false,
          bound: false,
          replaced: true,
          reason: 'session_replaced',
          code: 'SESSION_REPLACED',
          error: 'Tu sesión se cerró porque se inició sesión con esta cuenta en otro dispositivo.',
        });
      }
      if (resolved.suspended) {
        return res.status(403).json({
          error: 'La empresa asociada a este kiosco se encuentra suspendida o pendiente de activación.',
          code: 'TENANT_INACTIVE',
        });
      }
      req.kiosk = resolved;
      return next();
    } catch (err) {
      return res.status(500).json({ error: 'Error validando dispositivo kiosco: ' + err.message });
    }
  };

  // ============================================================================
  // 1. GESTIÓN DE DISPOSITIVOS Y POLÍTICA BIOMÉTRICA (Requiere sesión admin/owner)
  // ============================================================================

  // POST /api/kiosk/bind
  router.post('/bind', authenticate, async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(403).json({ error: 'Contexto de empresa requerido.' });
      if (!canManageKiosks(req)) {
        return res.status(403).json({ error: 'No tienes permiso para vincular dispositivos de kiosco.' });
      }

      const { branch_id, device_name } = req.body || {};
      if (!branch_id) {
        return res.status(400).json({ error: 'La sucursal (branch_id) es obligatoria para vincular el kiosco.' });
      }

      const [bRows] = await pool.query(
        'SELECT id, name FROM branches WHERE id::text = ? AND tenant_id = ? LIMIT 1',
        [String(branch_id), tenantId]
      );
      if (!bRows || bRows.length === 0) {
        return res.status(404).json({ error: 'Sucursal no encontrada en esta empresa.' });
      }
      if (!isBranchAuthorized(req, String(bRows[0].id))) {
        return res.status(403).json({ error: 'No estás autorizado para vincular kioscos en esta sucursal.' });
      }

      const bound = await bindKioskDevice(pool, {
        tenantId,
        branchId: bRows[0].id,
        deviceName: device_name || `Kiosco ${bRows[0].name}`,
        actorUserId: req.auth?.id,
        actorName: req.auth?.name || req.auth?.email,
      });

      res.cookie(KIOSK_DEVICE_COOKIE, bound.rawToken, buildCookieOptions(req, DEVICE_TTL_MS));
      // Al activar el kiosco, destruir la sesión administrativa del navegador
      res.clearCookie('auth_token', { path: '/' });
      res.clearCookie(KIOSK_SELF_SERVICE_COOKIE, { path: '/' });

      res.status(201).json({
        success: true,
        device: {
          ...bound.device,
          branch_name: bRows[0].name,
        },
      });
    } catch (err) {
      res.status(500).json({ error: 'Error vinculando dispositivo kiosco: ' + err.message });
    }
  });

  // GET /api/kiosk/devices
  router.get('/devices', authenticate, async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(403).json({ error: 'Contexto de empresa requerido.' });
      if (!canManageKiosks(req)) {
        return res.status(403).json({ error: 'No tienes permiso para consultar los dispositivos de kiosco.' });
      }

      const [rows] = await pool.query(
        `SELECT d.id, d.tenant_id, d.branch_id, b.name AS branch_name, d.device_name, d.status,
                d.bound_by_user_id, d.bound_by_name, d.bound_at, d.last_seen_at, d.expires_at,
                d.revoked_at, d.revoked_reason
         FROM kiosk_devices d
         LEFT JOIN branches b ON b.id::text = d.branch_id AND b.tenant_id = d.tenant_id
         WHERE d.tenant_id = ?
         ORDER BY d.bound_at DESC`,
        [tenantId]
      );
      res.json({ devices: rows || [] });
    } catch (err) {
      res.status(500).json({ error: 'Error listando dispositivos kiosco: ' + err.message });
    }
  });

  // POST /api/kiosk/devices/:id/revoke
  router.post('/devices/:id/revoke', authenticate, async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(403).json({ error: 'Contexto de empresa requerido.' });
      if (!canManageKiosks(req)) {
        return res.status(403).json({ error: 'No tienes permiso para revocar dispositivos de kiosco.' });
      }

      const ok = await revokeKioskDevice(pool, {
        deviceId: req.params.id,
        tenantId,
        actorUserId: req.auth?.id,
        reason: req.body?.reason || 'Revocado desde configuración',
      });
      if (!ok) {
        return res.status(404).json({ error: 'Dispositivo activo no encontrado en esta empresa.' });
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Error revocando dispositivo: ' + err.message });
    }
  });

  // GET /api/kiosk/settings & PUT /api/kiosk/settings
  router.get('/settings', authenticate, async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(403).json({ error: 'Contexto de empresa requerido.' });
      if (!canManageKiosks(req)) {
        return res.status(403).json({ error: 'Sin permiso para consultar configuración del kiosco.' });
      }
      const [rows] = await pool.query(
        'SELECT kiosk_biometric_mode, kiosk_face_match_threshold FROM security_settings WHERE tenant_id = ? LIMIT 1',
        [tenantId]
      );
      const s = rows?.[0] || {};
      res.json({
        kiosk_biometric_mode: s.kiosk_biometric_mode === 'pin_face_verify' ? 'pin_face_verify' : 'pin_photo',
        kiosk_face_match_threshold: Number(s.kiosk_face_match_threshold || 0.75),
        compreface_configured: Boolean(process.env.COMPREFACE_URL && process.env.COMPREFACE_API_KEY),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/settings', authenticate, async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(403).json({ error: 'Contexto de empresa requerido.' });
      if (!canManageKiosks(req)) {
        return res.status(403).json({ error: 'Sin permiso para modificar configuración del kiosco.' });
      }
      const mode = req.body?.kiosk_biometric_mode === 'pin_face_verify' ? 'pin_face_verify' : 'pin_photo';
      const rawThresh = Number(req.body?.kiosk_face_match_threshold);
      const threshold = Number.isFinite(rawThresh) && rawThresh >= 0.4 && rawThresh <= 0.99 ? Number(rawThresh.toFixed(2)) : 0.75;

      await pool.query(
        `INSERT INTO security_settings (tenant_id, kiosk_biometric_mode, kiosk_face_match_threshold, updated_at)
         VALUES (?, ?, ?, NOW())
         ON CONFLICT (tenant_id) DO UPDATE SET
           kiosk_biometric_mode = EXCLUDED.kiosk_biometric_mode,
           kiosk_face_match_threshold = EXCLUDED.kiosk_face_match_threshold,
           updated_at = NOW()`,
        [tenantId, mode, threshold]
      );

      res.json({
        success: true,
        kiosk_biometric_mode: mode,
        kiosk_face_match_threshold: threshold,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================================================
  // 2. RUTAS OPERATIVAS DEL DISPOSITIVO KIOSCO (Credencial opaca HttpOnly)
  // ============================================================================

  // GET /api/kiosk/session
  router.get('/session', async (req, res) => {
    try {
      const resolved = await resolveKioskDevice(pool, req);
      if (!resolved) {
        return res.json({ bound: false });
      }
      if (resolved.replaced) {
        res.clearCookie(KIOSK_DEVICE_COOKIE, { path: '/' });
        res.clearCookie(KIOSK_SELF_SERVICE_COOKIE, { path: '/' });
        res.clearCookie('auth_token', { path: '/' });
        return res.json({
          bound: false,
          replaced: true,
          reason: 'session_replaced',
          code: 'SESSION_REPLACED',
          error: 'Tu sesión se cerró porque se inició sesión con esta cuenta en otro dispositivo.'
        });
      }
      if (resolved.suspended) {
        return res.json({ bound: false, suspended: true });
      }
      return res.json({
        bound: true,
        device: resolved.device,
        tenant: resolved.tenant,
        branch: resolved.branch,
        biometricPolicy: resolved.biometricPolicy,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/kiosk/deactivate (desvincular desde el propio kiosco con credenciales admin de la misma empresa)
  router.post('/deactivate', requireKioskDevice, async (req, res) => {
    try {
      const { device } = req.kiosk;
      const { email, password } = req.body || {};
      const cleanEmail = String(email || '').trim().toLowerCase();
      if (!cleanEmail || !password) {
        return res.status(400).json({ error: 'Correo y contraseña administrativos requeridos.' });
      }

      const [uRows] = await pool.query(
        `SELECT id, COALESCE(password_hash, password) AS password, role, permissions, authorized_branch_ids, all_branches_access
         FROM users
         WHERE LOWER(email) = ? AND tenant_id = ? AND (is_active IS NULL OR is_active = TRUE)
         LIMIT 1`,
        [cleanEmail, device.tenant_id]
      );
      if (!uRows || uRows.length === 0) {
        return res.status(401).json({ error: 'Credenciales administrativas inválidas para esta empresa.' });
      }

      const adminUser = uRows[0];
      const passOk = await bcrypt.compare(String(password), String(adminUser.password || '')).catch(() => false);
      if (!passOk) {
        return res.status(401).json({ error: 'Credenciales administrativas inválidas.' });
      }

      const role = String(adminUser.role || '').toLowerCase();
      const perms = expandEffectivePermissions(adminUser.permissions || {});
      const isAuthorizedRole = role === 'propietario' || role === 'admin' || permissionMapGrants(perms, 'manage_settings') || permissionMapGrants(perms, 'manage_staff');
      if (!isAuthorizedRole) {
        return res.status(403).json({ error: 'Tu usuario no tiene permisos para desvincular este kiosco.' });
      }

      await revokeKioskDevice(pool, {
        deviceId: device.id,
        tenantId: device.tenant_id,
        actorUserId: adminUser.id,
        reason: 'Desactivado localmente en dispositivo',
      });

      res.clearCookie(KIOSK_DEVICE_COOKIE, { path: '/' });
      res.clearCookie(KIOSK_SELF_SERVICE_COOKIE, { path: '/' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/kiosk/employees (solo colaboradores activos autorizados en esta sucursal)
  router.get('/employees', requireKioskDevice, async (req, res) => {
    try {
      const { device } = req.kiosk;
      const [staffRows] = await pool.query(
        `SELECT id, nombre, status, salon_id, email, profile_photo, profile_photo_file_id
         FROM staff_records
         WHERE tenant_id = ?
         ORDER BY nombre ASC`,
        [device.tenant_id]
      );

      const authorizedEmployees = [];
      for (const s of staffRows || []) {
        const authCheck = await isEmployeeAuthorizedForBranch(pool, device.tenant_id, s.id, device.branch_id);
        if (authCheck.authorized) {
          const hasPhoto = Boolean(s.profile_photo_file_id || s.profile_photo);
          const empEmail = String(s.email || '').trim();
          const hasEmail = Boolean(empEmail && empEmail.includes('@'));
          const maskedEmail = hasEmail
            ? empEmail.replace(/^(.{1,2}).*(@.+)$/, '$1***$2')
            : null;
          authorizedEmployees.push({
            id: s.id,
            nombre: s.nombre,
            rol: 'Colaborador',
            has_email: hasEmail,
            masked_email: maskedEmail,
            has_profile_photo: hasPhoto,
            profile_photo: hasPhoto
              ? `/api/kiosk/employees/${encodeURIComponent(s.id)}/photo?v=${encodeURIComponent(s.profile_photo_file_id || 'legacy')}`
              : null,
          });
        }
      }

      res.json({ employees: authorizedEmployees });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/kiosk/employees/:id/photo (foto de empleado autorizada solo para el dispositivo/sucursal vinculada)
  router.get('/employees/:id/photo', requireKioskDevice, async (req, res) => {
    try {
      const { device } = req.kiosk;
      const empId = String(req.params.id || '').trim();
      const authCheck = await isEmployeeAuthorizedForBranch(pool, device.tenant_id, empId, device.branch_id);
      if (!authCheck.authorized) {
        return res.status(403).end();
      }
      const [rows] = await pool.query(
        'SELECT profile_photo, profile_photo_file_id FROM staff_records WHERE id::text = ? AND tenant_id = ? LIMIT 1',
        [empId, device.tenant_id]
      );
      if (!rows || rows.length === 0) return res.status(404).end();
      const rec = rows[0];

      if (rec.profile_photo_file_id) {
        const storage = getPrivateStorageAdapter({ pool });
        const fileData = await storage.readFile({ tenantId: device.tenant_id, fileId: rec.profile_photo_file_id });
        res.setHeader('Content-Type', fileData.mimeType || 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=300');
        return res.send(fileData.buffer);
      }

      if (rec.profile_photo) {
        const match = String(rec.profile_photo).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
        if (match) {
          res.setHeader('Content-Type', match[1]);
          res.setHeader('Cache-Control', 'private, max-age=300');
          return res.send(Buffer.from(match[2], 'base64'));
        }
      }
      return res.status(404).end();
    } catch (err) {
      console.error('[KIOSK EMPLOYEE PHOTO ERROR]:', err.message);
      return res.status(404).end();
    }
  });

  // GET /api/kiosk/today
  router.get('/today', requireKioskDevice, async (req, res) => {
    try {
      const { device, branch } = req.kiosk;
      const { dateStr } = getDatePartsInTimezone(branch.timezone);
      const [rows] = await pool.query(
        `SELECT employee_id, type, timestamp, status, lateness_minutes, extra_minutes
         FROM attendance
         WHERE tenant_id = ? AND DATE(timestamp) = ? AND type != 'Ausencia'
         ORDER BY timestamp DESC`,
        [device.tenant_id, dateStr]
      );
      res.json({ punches: rows || [] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/kiosk/verify-employee
  router.post('/verify-employee', requireKioskDevice, async (req, res) => {
    try {
      const { device, biometricPolicy } = req.kiosk;
      const { employee_id, password } = req.body || {};
      if (!employee_id || !password) {
        return res.status(400).json({ error: 'Empleado y contraseña/PIN requeridos.' });
      }

      const rate = checkPinRateLimit(device.id, String(employee_id));
      if (!rate.allowed) {
        return res.status(429).json({
          error: `Demasiados intentos fallidos para este colaborador. Intenta nuevamente en ${rate.retryAfterSeconds}s.`,
          code: 'KIOSK_PIN_RATE_LIMITED',
          retryAfterSeconds: rate.retryAfterSeconds,
        });
      }

      const authCheck = await isEmployeeAuthorizedForBranch(pool, device.tenant_id, employee_id, device.branch_id);
      if (!authCheck.authorized) {
        return res.status(403).json({ error: authCheck.reason || 'Empleado no autorizado en esta sucursal.' });
      }

      const emp = authCheck.employee;
      let userPasswordHash = emp.password || null;
      if (!userPasswordHash) {
        const [uRows] = await pool.query(
          `SELECT COALESCE(password_hash, password) AS password FROM users
           WHERE tenant_id = ? AND (is_active IS NULL OR is_active = TRUE)
             AND (id::text = ? OR (email IS NOT NULL AND email != '' AND LOWER(email) = LOWER(?)))
           LIMIT 1`,
          [device.tenant_id, String(employee_id), String(emp.email || '')]
        );
        userPasswordHash = uRows?.[0]?.password || null;
      }

      const validPassword = userPasswordHash
        ? await bcrypt.compare(String(password), String(userPasswordHash)).catch(() => false)
        : false;

      if (!validPassword) {
        recordPinFailure(device.id, String(employee_id));
        return res.status(401).json({ error: 'Contraseña o PIN incorrecto.' });
      }

      clearPinFailures(device.id, String(employee_id));

      const hasProfilePhoto = Boolean(emp.profile_photo_file_id || emp.profile_photo);
      if (hasProfilePhoto && biometricPolicy.mode === 'pin_face_verify' && !biometricPolicy.providerConfigured) {
        return res.status(503).json({
          error: 'El modo biométrico facial está activo, pero el servicio de verificación facial no está disponible.',
          code: 'BIOMETRIC_PROVIDER_UNAVAILABLE',
        });
      }

      const session = await createKioskEmployeeSession(pool, {
        deviceId: device.id,
        tenantId: device.tenant_id,
        branchId: device.branch_id,
        employeeId: String(emp.id),
        purpose: 'punch',
      });

      res.json({
        success: true,
        punch_token: session.rawToken,
        employee_id: String(emp.id),
        has_profile_photo: hasProfilePhoto,
        biometric_mode: biometricPolicy.mode,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/kiosk/start-face-punch (inicio directo de ponche biométrico con CompreFace sin contraseña)
  router.post('/start-face-punch', requireKioskDevice, async (req, res) => {
    try {
      const { device, biometricPolicy } = req.kiosk;
      const { employee_id } = req.body || {};
      if (!employee_id) {
        return res.status(400).json({ error: 'Debes seleccionar un empleado.' });
      }

      const authCheck = await isEmployeeAuthorizedForBranch(pool, device.tenant_id, employee_id, device.branch_id);
      if (!authCheck.authorized) {
        return res.status(403).json({ error: authCheck.reason || 'Empleado no autorizado en esta sucursal.' });
      }

      const emp = authCheck.employee;
      const hasProfilePhoto = Boolean(emp.profile_photo_file_id || emp.profile_photo);
      if (!hasProfilePhoto) {
        return res.status(400).json({
          error: 'Este colaborador no tiene fotografía de referencia registrada. Sube una foto en el módulo de Personal para ponchar con reconocimiento facial.',
          code: 'BIOMETRIC_PHOTO_REQUIRED',
        });
      }

      if (!biometricPolicy.providerConfigured) {
        return res.status(503).json({
          error: 'El servicio de verificación facial (CompreFace) no está disponible en este momento.',
          code: 'BIOMETRIC_PROVIDER_UNAVAILABLE',
        });
      }

      const session = await createKioskEmployeeSession(pool, {
        deviceId: device.id,
        tenantId: device.tenant_id,
        branchId: device.branch_id,
        employeeId: String(emp.id),
        purpose: 'punch',
      });

      res.json({
        success: true,
        punch_token: session.rawToken,
        employee_id: String(emp.id),
        has_profile_photo: true,
        biometric_mode: 'face_verify',
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/kiosk/punch
  router.post('/punch', requireKioskDevice, async (req, res) => {
    try {
      const { device, branch, biometricPolicy } = req.kiosk;
      const { employeeId, type, photo, geolocation, deviceInfo, punch_token, idempotency_key } = req.body || {};

      if (!employeeId || !type || !photo) {
        return res.status(400).json({ error: 'Faltan datos obligatorios (empleado, tipo o fotografía).' });
      }
      if (!['Check-In', 'Check-Out'].includes(type)) {
        return res.status(400).json({ error: 'Tipo de ponche inválido.' });
      }

      const idemKey = String(idempotency_key || req.headers['x-idempotency-key'] || '').trim().slice(0, 120) || null;
      if (idemKey) {
        const [dupRows] = await pool.query(
          'SELECT id, status FROM attendance WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1',
          [device.tenant_id, idemKey]
        );
        if (dupRows && dupRows.length > 0) {
          return res.json({
            success: true,
            idempotent_replay: true,
            message: `Ponche de ${type === 'Check-In' ? 'Entrada' : 'Salida'} registrado como ${dupRows[0].status}.`,
          });
        }
      }

      // 1. Validar sesión breve vinculada a (device, tenant, employeeId) sin consumir aún (permite reintentar ante fallo biométrico)
      const punchCheck = await validatePunchSession(pool, {
        rawToken: punch_token,
        deviceId: device.id,
        tenantId: device.tenant_id,
        employeeId: String(employeeId),
      });
      if (!punchCheck.valid) {
        return res.status(403).json({
          error: punchCheck.reason,
          code: 'PUNCH_VERIFICATION_INVALID',
        });
      }

      // 2. Verificar autorización activa de empleado en esta sucursal
      const authCheck = await isEmployeeAuthorizedForBranch(pool, device.tenant_id, employeeId, device.branch_id);
      if (!authCheck.authorized) {
        return res.status(403).json({ error: authCheck.reason || 'Empleado no autorizado en esta sucursal.' });
      }
      const emp = authCheck.employee;

      const webCamBuffer = base64ToBuffer(photo);
      if (!webCamBuffer) {
        return res.status(400).json({ error: 'La captura de cámara enviada no es válida.' });
      }

      // 3. Verificación facial cuando el colaborador tiene foto de referencia (sin degradar a modo manual si falla CompreFace)
      const hasRefPhoto = Boolean(emp.profile_photo_file_id || emp.profile_photo);
      let faceVerified = false;
      let verificationMethod = 'pin_photo_sin_verificacion_facial';
      let faceConfidence = null;

      if (hasRefPhoto && (biometricPolicy.mode === 'pin_face_verify' || biometricPolicy.providerConfigured)) {
        let refPhotoBuffer = null;
        if (emp.profile_photo_file_id) {
          const storage = getPrivateStorageAdapter({ pool });
          const fileData = await storage.readFile({ tenantId: device.tenant_id, fileId: emp.profile_photo_file_id });
          if (fileData?.buffer) refPhotoBuffer = fileData.buffer;
        } else if (emp.profile_photo) {
          refPhotoBuffer = base64ToBuffer(emp.profile_photo);
        }

        if (!refPhotoBuffer) {
          return res.status(503).json({
            error: 'No se pudo cargar la fotografía de referencia biométrica del colaborador. Intenta nuevamente o contacta a administración.',
            code: 'BIOMETRIC_REFERENCE_UNREADABLE',
          });
        }

        const verifyResult = await verifyFacesWithCompreFaceStrict(
          webCamBuffer,
          refPhotoBuffer,
          biometricPolicy.faceMatchThreshold
        );
        if (!verifyResult.isIdentical) {
          return res.status(400).json({
            error: 'Verificación biométrica fallida. El rostro no coincide con el empleado seleccionado.',
            code: 'BIOMETRIC_MISMATCH',
          });
        }
        faceVerified = true;
        verificationMethod = 'compreface';
        faceConfidence = verifyResult.confidence;
      }

      // 4. Cálculo horario con zona horaria de la sucursal/empresa
      const { dateStr: todayDateStr, localDate: nowLocalDate, tsStr } = getDatePartsInTimezone(branch.timezone);
      const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
      const todayName = dayNames[nowLocalDate.getDay()];

      const [overrides] = await pool.query(
        "SELECT new_hora_entrada, new_hora_salida FROM schedule_overrides WHERE employee_id = ? AND date = ? AND status = 'Activo' AND tenant_id = ?",
        [String(employeeId), todayDateStr, device.tenant_id]
      );

      let baseHoraEntrada = emp.hora_entrada;
      let baseHoraSalida = emp.hora_salida;
      if (emp.dias_laborables && String(emp.dias_laborables).trim().startsWith('{')) {
        try {
          const parsedSchedule = JSON.parse(emp.dias_laborables);
          const normalizedToday = normalizeDayName(todayName);
          const matchingKey = Object.keys(parsedSchedule).find((k) => normalizeDayName(k) === normalizedToday);
          const daySched = matchingKey ? parsedSchedule[matchingKey] : null;
          baseHoraEntrada = daySched ? (daySched.entrada || null) : null;
          baseHoraSalida = daySched ? (daySched.salida || null) : null;
        } catch {}
      }

      const targetEntrada = overrides.length > 0 ? overrides[0].new_hora_entrada : baseHoraEntrada;
      const targetSalida = overrides.length > 0 ? overrides[0].new_hora_salida : baseHoraSalida;
      const currentMinutesFromMidnight = nowLocalDate.getHours() * 60 + nowLocalDate.getMinutes();

      let status = 'Normal';
      let latenessMinutes = 0;
      let extraMinutes = 0;

      if (type === 'Check-In' && targetEntrada) {
        const [schedH, schedM] = String(targetEntrada).split(':').map(Number);
        const diff = currentMinutesFromMidnight - (schedH * 60 + schedM);
        const tolerance = emp.tolerancia_minutos !== null && emp.tolerancia_minutos !== undefined ? Number(emp.tolerancia_minutos) : 15;
        if (diff > tolerance) {
          status = 'Tardanza';
          latenessMinutes = diff;
        }
      } else if (type === 'Check-Out' && targetSalida) {
        const [schedH, schedM] = String(targetSalida).split(':').map(Number);
        const diff = currentMinutesFromMidnight - (schedH * 60 + schedM);
        if (diff > 0) extraMinutes = diff;
        else if (diff < 0) status = 'Salida Temprana';
      }

      if (type === 'Check-In') {
        await pool.query(
          "DELETE FROM attendance WHERE employee_id = ? AND DATE(timestamp) = ? AND type = 'Ausencia' AND tenant_id = ?",
          [String(employeeId), todayDateStr, device.tenant_id]
        );
      }

      let punchPhotoFileId = null;
      try {
        const storage = getPrivateStorageAdapter({ pool });
        const savedFile = await storage.saveBase64({
          tenantId: device.tenant_id,
          category: 'attendance_photo',
          base64Data: photo,
          retentionDays: 90,
        });
        punchPhotoFileId = savedFile.id;
      } catch (storageErr) {
        console.warn('[KIOSK_STORAGE_WARN]', storageErr.message);
      }

      // 4b. Consumir atómicamente la sesión de ponche justo antes de insertar (bloquea doble clic / concurrencia)
      const punchConsume = await consumePunchSession(pool, {
        rawToken: punch_token,
        deviceId: device.id,
        tenantId: device.tenant_id,
        employeeId: String(employeeId),
      });
      if (!punchConsume.valid) {
        return res.status(403).json({
          error: punchConsume.reason,
          code: 'PUNCH_VERIFICATION_INVALID',
        });
      }

      const punchId = `ATT-${Date.now()}-${String(employeeId)}-${type.toUpperCase()}`;
      await pool.query(
        `INSERT INTO attendance (
           id, employee_id, type, photo, photo_file_id, geolocation, device_info,
           timestamp, status, lateness_minutes, extra_minutes, tenant_id, kiosk_device_id, idempotency_key
         ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          punchId,
          String(employeeId),
          type,
          punchPhotoFileId,
          geolocation ? String(geolocation).slice(0, 120) : null,
          deviceInfo ? String(deviceInfo).slice(0, 255) : null,
          tsStr,
          status,
          latenessMinutes,
          extraMinutes,
          device.tenant_id,
          device.id,
          idemKey,
        ]
      );

      const verificationLabel = faceVerified ? '' : ' (sin verificación facial)';
      res.json({
        success: true,
        id: punchId,
        status,
        face_verified: faceVerified,
        verification_method: verificationMethod,
        confidence: faceConfidence,
        message: `Ponche de ${type === 'Check-In' ? 'Entrada' : 'Salida'} registrado como ${status}${verificationLabel} correctamente.`,
        name: emp.nombre,
      });
    } catch (err) {
      const code = err.statusCode || 500;
      res.status(code).json({ error: err.message, code: err.code || undefined });
    }
  });

  // ============================================================================
  // 3. AUTOSERVICIO DE COMISIONES Y VOLANTES (Sesión breve por empleado)
  // ============================================================================

  // POST /api/kiosk/self-service/request-otp
  router.post('/self-service/request-otp', requireKioskDevice, async (req, res) => {
    try {
      const { device, tenant } = req.kiosk;
      const { employee_id } = req.body || {};
      if (!employee_id) return res.status(400).json({ error: 'Empleado requerido.' });

      const authCheck = await isEmployeeAuthorizedForBranch(pool, device.tenant_id, employee_id, device.branch_id);
      if (!authCheck.authorized) {
        return res.status(403).json({ error: authCheck.reason });
      }
      const emp = authCheck.employee;
      const empEmail = String(emp.email || '').trim();
      if (!empEmail) {
        return res.status(400).json({ error: 'Este colaborador no tiene correo electrónico configurado.' });
      }

      const code = String(crypto.randomInt(100000, 999999));
      const clientKey = `KIOSK-COMM-${emp.id}`;
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      // Invalidar códigos previos no usados para este empleado
      await pool.query(
        'UPDATE verification_codes SET is_used = 1 WHERE tenant_id = ? AND client_id = ? AND is_used = 0',
        [device.tenant_id, clientKey]
      );
      await pool.query(
        'INSERT INTO verification_codes (tenant_id, client_id, code, expires_at, is_used) VALUES (?, ?, ?, ?, 0)',
        [device.tenant_id, clientKey, code, expiresAt]
      );
      otpAttemptsMap.delete(`${device.id}:${emp.id}`);

      const { transporter, fromAddress } = await resolveTransporterForTenant(pool, device.tenant_id, tenant.name);
      if (!transporter) {
        return res.status(503).json({ error: 'El servidor de correo no está configurado.' });
      }

      await transporter.sendMail({
        from: fromAddress,
        to: empEmail,
        subject: `Código de acceso a comisiones y volantes — ${tenant.name}`,
        text: `Hola ${emp.nombre}, tu código temporal de un solo uso es: ${code}. Válido por 10 minutos.`,
        html: `<p>Hola <strong>${emp.nombre}</strong>,</p><p>Tu código de acceso temporal al kiosco es: <strong style="font-size:20px;letter-spacing:3px;">${code}</strong></p><p>Expira en 10 minutos y es de un solo uso.</p>`,
      });

      const masked = empEmail.replace(/^(.{2}).+(@.+)$/, '$1***$2');
      res.json({ success: true, masked_email: masked });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/kiosk/self-service/verify
  router.post('/self-service/verify', requireKioskDevice, async (req, res) => {
    try {
      const { device } = req.kiosk;
      const { employee_id, pin } = req.body || {};
      const cleanPin = String(pin || '').trim();
      if (!employee_id || !cleanPin) {
        return res.status(400).json({ error: 'Empleado y código/PIN requeridos.' });
      }

      const rate = checkPinRateLimit(device.id, `SS-${employee_id}`);
      if (!rate.allowed) {
        return res.status(429).json({
          error: `Demasiados intentos fallidos. Espera ${rate.retryAfterSeconds}s.`,
          retryAfterSeconds: rate.retryAfterSeconds,
        });
      }

      const authCheck = await isEmployeeAuthorizedForBranch(pool, device.tenant_id, employee_id, device.branch_id);
      if (!authCheck.authorized) {
        return res.status(403).json({ error: authCheck.reason });
      }
      const emp = authCheck.employee;
      const clientKey = `KIOSK-COMM-${emp.id}`;

      // 1. Intentar consumir OTP de correo de un solo uso de forma atómica
      const [otpRows] = await pool.query(
        `UPDATE verification_codes
         SET is_used = 1
         WHERE id = (
           SELECT id FROM verification_codes
           WHERE tenant_id = ? AND client_id = ? AND code = ? AND is_used = 0 AND expires_at > NOW()
           ORDER BY id DESC LIMIT 1
         )
         RETURNING id`,
        [device.tenant_id, clientKey, cleanPin]
      );

      let verified = Boolean(otpRows && otpRows.length > 0);

      // 2. Alternativamente validar contraseña del usuario del empleado
      if (!verified) {
        const [uRows] = await pool.query(
          `SELECT COALESCE(password_hash, password) AS password FROM users
           WHERE tenant_id = ? AND (is_active IS NULL OR is_active = TRUE)
             AND (id::text = ? OR (email IS NOT NULL AND email != '' AND LOWER(email) = LOWER(?)))
           LIMIT 1`,
          [device.tenant_id, String(emp.id), String(emp.email || '')]
        );
        if (uRows && uRows.length > 0 && uRows[0].password) {
          verified = await bcrypt.compare(cleanPin, String(uRows[0].password)).catch(() => false);
        }
      }

      if (!verified) {
        recordPinFailure(device.id, `SS-${employee_id}`);
        return res.status(401).json({ error: 'Código o PIN incorrecto o expirado.' });
      }

      clearPinFailures(device.id, `SS-${employee_id}`);

      const session = await createKioskEmployeeSession(pool, {
        deviceId: device.id,
        tenantId: device.tenant_id,
        branchId: device.branch_id,
        employeeId: String(emp.id),
        purpose: 'self_service',
      });

      res.cookie(KIOSK_SELF_SERVICE_COOKIE, session.rawToken, buildCookieOptions(req, SELF_SERVICE_ABSOLUTE_TTL_MS));
      res.json({
        success: true,
        employee_id: String(emp.id),
        expires_at: session.expiresAt.toISOString(),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/kiosk/self-service/commissions (ignora cualquier employee_id del cliente)
  router.get('/self-service/commissions', requireKioskDevice, async (req, res) => {
    try {
      const { device } = req.kiosk;
      const sess = await resolveSelfServiceSession(pool, req, device);
      if (!sess) {
        res.clearCookie(KIOSK_SELF_SERVICE_COOKIE, { path: '/' });
        return res.status(401).json({ error: 'Sesión de autoservicio expirada o no iniciada.', code: 'SELF_SERVICE_EXPIRED' });
      }

      const { start_date, end_date } = req.query || {};
      let sql = `
        SELECT *
        FROM employee_commissions_log
        WHERE tenant_id = ? AND employee_id::text = ?
      `;
      const params = [device.tenant_id, String(sess.employee_id)];
      if (start_date) {
        sql += ' AND DATE(created_at) >= ?';
        params.push(String(start_date));
      }
      if (end_date) {
        sql += ' AND DATE(created_at) <= ?';
        params.push(String(end_date));
      }
      sql += ' ORDER BY created_at DESC LIMIT 200';

      const [rows] = await pool.query(sql, params);
      res.json({ employee_id: sess.employee_id, commissions: rows || [] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/kiosk/self-service/payslip (ignora cualquier employee_id del cliente)
  router.get('/self-service/payslip', requireKioskDevice, async (req, res) => {
    try {
      const { device } = req.kiosk;
      const sess = await resolveSelfServiceSession(pool, req, device);
      if (!sess) {
        res.clearCookie(KIOSK_SELF_SERVICE_COOKIE, { path: '/' });
        return res.status(401).json({ error: 'Sesión de autoservicio expirada o no iniciada.', code: 'SELF_SERVICE_EXPIRED' });
      }

      const { start_date, end_date } = req.query || {};
      let sql = `
        SELECT pi.*,
               pp.period_name,
               DATE_FORMAT(pp.start_date, '%Y-%m-%d') AS period_start,
               DATE_FORMAT(pp.end_date, '%Y-%m-%d') AS period_end,
               pp.status AS period_status,
               pp.approved_at,
               pp.approved_by
        FROM payroll_items pi
        INNER JOIN payroll_periods pp ON pp.id = pi.payroll_id AND pp.tenant_id = pi.tenant_id
        WHERE pi.tenant_id = ?
          AND pi.employee_id::text = ?
          AND pp.status IN ('Aprobada', 'Pagada')
      `;
      const params = [device.tenant_id, String(sess.employee_id)];
      if (start_date) {
        sql += ' AND pp.start_date >= ?';
        params.push(String(start_date));
      }
      if (end_date) {
        sql += ' AND pp.end_date <= ?';
        params.push(String(end_date));
      }
      sql += ' ORDER BY pp.end_date DESC, pi.id DESC LIMIT 20';

      const [items] = await pool.query(sql, params);
      res.json({ employee_id: sess.employee_id, payslips: items || [] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/kiosk/self-service/logout
  router.post('/self-service/logout', async (req, res) => {
    await invalidateSelfServiceSession(pool, req);
    res.clearCookie(KIOSK_SELF_SERVICE_COOKIE, { path: '/' });
    res.json({ success: true });
  });

  return router;
}

module.exports = { createKioskRouter };
