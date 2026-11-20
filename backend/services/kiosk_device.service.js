'use strict';

const crypto = require('crypto');

const KIOSK_DEVICE_COOKIE = 'kiosk_device_token';
const KIOSK_SELF_SERVICE_COOKIE = 'kiosk_emp_session';
const DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días
const PUNCH_SESSION_TTL_MS = 2 * 60 * 1000; // 2 minutos
const SELF_SERVICE_ABSOLUTE_TTL_MS = 10 * 60 * 1000; // 10 minutos máximo absoluto
const SELF_SERVICE_IDLE_TTL_MS = 3 * 60 * 1000; // 3 minutos de inactividad

// Rate limiter aislado por (deviceId, employeeId) — nunca bloquea a toda la empresa
const pinAttemptsMap = new Map();
const PIN_MAX_ATTEMPTS = 5;
const PIN_WINDOW_MS = 5 * 60 * 1000;

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken || '')).digest('hex');
}

function generateOpaqueToken() {
  return crypto.randomBytes(32).toString('hex');
}

function parseCookieValue(req, cookieName) {
  if (req.cookies && req.cookies[cookieName]) {
    return String(req.cookies[cookieName]).trim();
  }
  const raw = req.headers?.cookie;
  if (!raw) return null;
  const escaped = cookieName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = raw.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`));
  return match ? decodeURIComponent(match[1].trim()) : null;
}

function buildCookieOptions(req, maxAgeMs) {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: Boolean(isHttps),
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
  };
}

function checkPinRateLimit(deviceId, employeeId) {
  const key = `${deviceId}:${employeeId}`;
  const now = Date.now();
  const entry = pinAttemptsMap.get(key);
  if (!entry || now - entry.windowStart > PIN_WINDOW_MS) {
    return { allowed: true, remaining: PIN_MAX_ATTEMPTS };
  }
  if (entry.count >= PIN_MAX_ATTEMPTS) {
    const retryAfterSeconds = Math.ceil((PIN_WINDOW_MS - (now - entry.windowStart)) / 1000);
    return { allowed: false, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
  }
  return { allowed: true, remaining: PIN_MAX_ATTEMPTS - entry.count };
}

function recordPinFailure(deviceId, employeeId) {
  const key = `${deviceId}:${employeeId}`;
  const now = Date.now();
  const entry = pinAttemptsMap.get(key);
  if (!entry || now - entry.windowStart > PIN_WINDOW_MS) {
    pinAttemptsMap.set(key, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
    pinAttemptsMap.set(key, entry);
  }
}

function clearPinFailures(deviceId, employeeId) {
  pinAttemptsMap.delete(`${deviceId}:${employeeId}`);
}

async function bindKioskDevice(pool, { tenantId, branchId, deviceName, actorUserId, actorName }) {
  const cleanName = String(deviceName || 'Kiosco Recepción').trim().slice(0, 120) || 'Kiosco Recepción';
  const rawToken = generateOpaqueToken();
  const tokenHash = hashToken(rawToken);
  const deviceId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + DEVICE_TTL_MS);

  await pool.query(
    `INSERT INTO kiosk_devices (
       id, tenant_id, branch_id, device_name, token_hash, status,
       bound_by_user_id, bound_by_name, bound_at, last_seen_at, expires_at
     ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, NOW(), NOW(), ?)`,
    [deviceId, tenantId, String(branchId), cleanName, tokenHash, actorUserId ? String(actorUserId) : null, actorName ? String(actorName).slice(0, 120) : null, expiresAt]
  );

  return {
    device: {
      id: deviceId,
      tenant_id: tenantId,
      branch_id: String(branchId),
      device_name: cleanName,
      status: 'active',
      expires_at: expiresAt.toISOString(),
    },
    rawToken,
    expiresAt,
  };
}

async function resolveKioskDevice(pool, req) {
  const rawToken = parseCookieValue(req, KIOSK_DEVICE_COOKIE);
  if (!rawToken) return null;

  const tokenHash = hashToken(rawToken);
  const [rows] = await pool.query(
    `SELECT d.*, t.business_name, t.status AS tenant_status
     FROM kiosk_devices d
     JOIN tenants t ON t.id = d.tenant_id
     WHERE d.token_hash = ? AND d.status = 'active' AND d.expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );
  if (!rows || rows.length === 0) return null;

  const device = rows[0];
  if (String(device.tenant_status || '').toLowerCase() === 'pending' || String(device.tenant_status || '').toLowerCase() === 'suspended') {
    return { device, suspended: true };
  }

  // Si el dispositivo está vinculado a una cuenta dedicada 'kiosco_asistencia',
  // verificar que la cuenta siga activa, mantenga el rol kiosco y pertenezca a la misma sucursal.
  if (device.bound_by_user_id) {
    try {
      const [uRows] = await pool.query(
        `SELECT id, role, is_active, estado, branch_id
         FROM users
         WHERE id::text = ? AND tenant_id = ?
         LIMIT 1`,
        [String(device.bound_by_user_id), device.tenant_id]
      );
      if (uRows && uRows.length > 0) {
        const boundUser = uRows[0];
        if (String(boundUser.role || '').trim().toLowerCase() === 'kiosco_asistencia') {
          const active = boundUser.is_active !== false && String(boundUser.estado || 'Activo').toLowerCase() !== 'inactivo';
          const sameBranch = !boundUser.branch_id || String(boundUser.branch_id) === String(device.branch_id);
          if (!active || !sameBranch) {
            return null;
          }
        }
      }
    } catch { /* ignore if users lookup unavailable */ }
  }

  // Rolling renewal if < 7 days left
  const msLeft = new Date(device.expires_at).getTime() - Date.now();
  const newExpires = msLeft < 7 * 24 * 60 * 60 * 1000 ? new Date(Date.now() + DEVICE_TTL_MS) : null;
  await pool.query(
    newExpires
      ? 'UPDATE kiosk_devices SET last_seen_at = NOW(), expires_at = ? WHERE id = ?'
      : 'UPDATE kiosk_devices SET last_seen_at = NOW() WHERE id = ?',
    newExpires ? [newExpires, device.id] : [device.id]
  ).catch(() => {});

  // Load branch info
  const [branchRows] = await pool.query(
    'SELECT id, name FROM branches WHERE id::text = ? AND tenant_id = ? LIMIT 1',
    [String(device.branch_id), device.tenant_id]
  ).catch(() => [[]]);
  const branch = branchRows?.[0] || { id: device.branch_id, name: 'Sucursal Principal' };
  const branchTimezone = 'America/Santo_Domingo';

  // Load explicit biometric policy for tenant
  const [secRows] = await pool.query(
    'SELECT kiosk_biometric_mode, kiosk_face_match_threshold FROM security_settings WHERE tenant_id = ? LIMIT 1',
    [device.tenant_id]
  ).catch(() => [[]]);
  const sec = secRows?.[0] || {};
  const biometricMode = sec.kiosk_biometric_mode === 'pin_face_verify' ? 'pin_face_verify' : 'pin_photo';
  const rawThreshold = Number(sec.kiosk_face_match_threshold);
  const faceMatchThreshold = Number.isFinite(rawThreshold) && rawThreshold >= 0.4 && rawThreshold <= 0.99 ? rawThreshold : 0.75;

  // Load branding
  const [brandRows] = await pool.query(
    'SELECT business_name, logo_url FROM tenant_branding_settings WHERE tenant_id = ? LIMIT 1',
    [device.tenant_id]
  ).catch(() => [[]]);
  const branding = brandRows?.[0] || {};

  return {
    device: {
      id: device.id,
      tenant_id: String(device.tenant_id),
      branch_id: String(device.branch_id),
      device_name: device.device_name,
      status: device.status,
      bound_at: device.bound_at,
      last_seen_at: device.last_seen_at,
      expires_at: newExpires ? newExpires.toISOString() : device.expires_at,
    },
    tenant: {
      id: String(device.tenant_id),
      name: branding.business_name || device.business_name || 'Etereas',
      logo_url: branding.logo_url || null,
    },
    branch: {
      id: String(branch.id),
      name: branch.name || 'Sucursal',
      timezone: branchTimezone,
    },
    biometricPolicy: {
      mode: biometricMode,
      faceMatchThreshold,
      providerConfigured: Boolean(process.env.COMPREFACE_URL && process.env.COMPREFACE_API_KEY),
    },
  };
}

async function revokeKioskDevice(pool, { deviceId, tenantId, actorUserId = null, reason = 'Revocado manualmente' }) {
  const [updated] = await pool.query(
    `UPDATE kiosk_devices
     SET status = 'revoked', revoked_at = NOW(), revoked_by_user_id = ?, revoked_reason = ?
     WHERE id::text = ? AND tenant_id = ? AND status = 'active'
     RETURNING id`,
    [actorUserId ? String(actorUserId) : null, String(reason).slice(0, 255), String(deviceId), tenantId]
  );

  // Invalidar inmediatamente cualquier sesión de empleado abierta en ese dispositivo
  await pool.query(
    'UPDATE kiosk_employee_sessions SET is_active = FALSE WHERE device_id::text = ? AND tenant_id = ?',
    [String(deviceId), tenantId]
  ).catch(() => {});

  return Boolean(updated && updated.length > 0);
}

async function revokeDevicesByKioskUser(pool, { tenantId, userId, reason = 'Cuenta kiosco desactivada o sesión cerrada' }) {
  if (!tenantId || !userId) return 0;
  const [updated] = await pool.query(
    `UPDATE kiosk_devices
     SET status = 'revoked', revoked_at = NOW(), revoked_reason = ?
     WHERE tenant_id = ? AND bound_by_user_id = ? AND status = 'active'
     RETURNING id`,
    [String(reason).slice(0, 255), tenantId, String(userId)]
  ).catch(() => [[]]);

  for (const row of updated || []) {
    await pool.query(
      'UPDATE kiosk_employee_sessions SET is_active = FALSE WHERE device_id = ? AND tenant_id = ?',
      [row.id, tenantId]
    ).catch(() => {});
  }
  return (updated || []).length;
}

async function isEmployeeAuthorizedForBranch(pool, tenantId, employeeId, branchId) {
  let emp = null;
  let source = null;

  const [staffRows] = await pool.query(
    `SELECT id, nombre, email, status, salon_id, profile_photo, profile_photo_file_id,
            hora_entrada, hora_salida, dias_laborables, tolerancia_minutos
     FROM staff_records
     WHERE id::text = ? AND tenant_id = ?
     LIMIT 1`,
    [String(employeeId), tenantId]
  );
  if (staffRows && staffRows.length > 0) {
    emp = staffRows[0];
    source = 'staff_records';
  } else {
    const [userRows] = await pool.query(
      `SELECT id, nombre, name, email, role, is_active, estado, branch_id, authorized_branch_ids, all_branches_access,
              profile_photo, profile_photo_file_id, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos
       FROM users
       WHERE id::text = ? AND tenant_id = ? AND role NOT IN ('superadmin', 'cliente_b2c')
       LIMIT 1`,
      [String(employeeId), tenantId]
    );
    if (userRows && userRows.length > 0) {
      emp = userRows[0];
      source = 'users';
    }
  }

  if (!emp) return { authorized: false, reason: 'Empleado no encontrado en esta empresa.' };
  if (emp.is_active === false || emp.is_active === 0 || String(emp.estado || emp.status || '').toLowerCase() === 'inactivo') {
    return { authorized: false, reason: 'El empleado no está activo.' };
  }

  // Check branch authorization (supports multi-branch employees)
  const targetBranch = String(branchId || '').trim();
  if (source === 'staff_records') {
    const empBranch = emp.branch_id || emp.salon_id;
    // If staff_records has a matching user row with authorized_branch_ids, check it too
    let linkedUser = null;
    if (emp.email) {
      const [uRows] = await pool.query(
        'SELECT branch_id, authorized_branch_ids, all_branches_access FROM users WHERE tenant_id = ? AND LOWER(email) = LOWER(?) LIMIT 1',
        [tenantId, String(emp.email).trim()]
      ).catch(() => [[]]);
      linkedUser = uRows?.[0] || null;
    }
    if (linkedUser) {
      if (linkedUser.all_branches_access === true) {
        return { authorized: true, employee: emp, source };
      }
      const allowed = Array.isArray(linkedUser.authorized_branch_ids)
        ? linkedUser.authorized_branch_ids.map(String)
        : [];
      if (linkedUser.branch_id) allowed.push(String(linkedUser.branch_id));
      if (empBranch) allowed.push(String(empBranch));
      if (allowed.length > 0 && targetBranch && !allowed.includes(targetBranch)) {
        return { authorized: false, reason: 'Empleado no autorizado para marcar en esta sucursal.' };
      }
    } else if (empBranch && targetBranch && String(empBranch) !== targetBranch) {
      return { authorized: false, reason: 'Empleado no autorizado para marcar en esta sucursal.' };
    }
  } else {
    if (emp.all_branches_access !== true) {
      const allowed = Array.isArray(emp.authorized_branch_ids)
        ? emp.authorized_branch_ids.map(String)
        : [];
      if (emp.branch_id) allowed.push(String(emp.branch_id));
      if (allowed.length > 0 && targetBranch && !allowed.includes(targetBranch)) {
        return { authorized: false, reason: 'Empleado no autorizado para marcar en esta sucursal.' };
      }
    }
  }

  return { authorized: true, employee: emp, source };
}

async function createKioskEmployeeSession(pool, { deviceId, tenantId, branchId, employeeId, purpose }) {
  // Invalidar sesiones previas del mismo propósito en este dispositivo (cambio de empleado o reintento)
  await pool.query(
    'UPDATE kiosk_employee_sessions SET is_active = FALSE WHERE device_id = ? AND tenant_id = ? AND purpose = ? AND is_active = TRUE',
    [deviceId, tenantId, purpose]
  );

  const rawToken = generateOpaqueToken();
  const tokenHash = hashToken(rawToken);
  const sessionId = crypto.randomUUID();
  const ttlMs = purpose === 'punch' ? PUNCH_SESSION_TTL_MS : SELF_SERVICE_ABSOLUTE_TTL_MS;
  const expiresAt = new Date(Date.now() + ttlMs);

  await pool.query(
    `INSERT INTO kiosk_employee_sessions (
       id, device_id, tenant_id, branch_id, employee_id, purpose, token_hash, is_active, expires_at, last_activity_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, ?, NOW())`,
    [sessionId, deviceId, tenantId, String(branchId), String(employeeId), purpose, tokenHash, expiresAt]
  );

  return { sessionId, rawToken, expiresAt };
}

async function validatePunchSession(pool, { rawToken, deviceId, tenantId, employeeId }) {
  if (!rawToken) return { valid: false, reason: 'Verificación de empleado requerida.' };
  const tokenHash = hashToken(rawToken);

  const [rows] = await pool.query(
    `SELECT id FROM kiosk_employee_sessions
     WHERE token_hash = ?
       AND device_id = ?
       AND tenant_id = ?
       AND employee_id = ?
       AND purpose = 'punch'
       AND is_active = TRUE
       AND consumed_at IS NULL
       AND expires_at > NOW()
     LIMIT 1`,
    [tokenHash, deviceId, tenantId, String(employeeId)]
  );

  if (!rows || rows.length === 0) {
    return { valid: false, reason: 'La verificación del empleado expiró, ya fue utilizada o corresponde a otro colaborador.' };
  }
  return { valid: true, sessionId: rows[0].id };
}

async function consumePunchSession(pool, { rawToken, deviceId, tenantId, employeeId }) {
  if (!rawToken) return { valid: false, reason: 'Verificación de empleado requerida.' };
  const tokenHash = hashToken(rawToken);

  const [rows] = await pool.query(
    `UPDATE kiosk_employee_sessions
     SET consumed_at = NOW(), is_active = FALSE
     WHERE token_hash = ?
       AND device_id = ?
       AND tenant_id = ?
       AND employee_id = ?
       AND purpose = 'punch'
       AND is_active = TRUE
       AND consumed_at IS NULL
       AND expires_at > NOW()
     RETURNING id`,
    [tokenHash, deviceId, tenantId, String(employeeId)]
  );

  if (!rows || rows.length === 0) {
    return { valid: false, reason: 'La verificación del empleado expiró, ya fue utilizada o corresponde a otro colaborador.' };
  }
  return { valid: true, sessionId: rows[0].id };
}

async function resolveSelfServiceSession(pool, req, device) {
  const rawToken = parseCookieValue(req, KIOSK_SELF_SERVICE_COOKIE);
  if (!rawToken || !device) return null;

  const tokenHash = hashToken(rawToken);
  const [rows] = await pool.query(
    `SELECT * FROM kiosk_employee_sessions
     WHERE token_hash = ?
       AND device_id = ?
       AND tenant_id = ?
       AND purpose = 'self_service'
       AND is_active = TRUE
       AND expires_at > NOW()
     LIMIT 1`,
    [tokenHash, device.id, device.tenant_id]
  );
  if (!rows || rows.length === 0) return null;

  const sess = rows[0];
  const lastAct = new Date(sess.last_activity_at).getTime();
  if (Date.now() - lastAct > SELF_SERVICE_IDLE_TTL_MS) {
    await pool.query('UPDATE kiosk_employee_sessions SET is_active = FALSE WHERE id = ?', [sess.id]).catch(() => {});
    return null;
  }

  await pool.query('UPDATE kiosk_employee_sessions SET last_activity_at = NOW() WHERE id = ?', [sess.id]).catch(() => {});
  return sess;
}

async function invalidateSelfServiceSession(pool, req) {
  const rawToken = parseCookieValue(req, KIOSK_SELF_SERVICE_COOKIE);
  if (!rawToken) return;
  await pool.query('UPDATE kiosk_employee_sessions SET is_active = FALSE WHERE token_hash = ?', [hashToken(rawToken)]).catch(() => {});
}

module.exports = {
  KIOSK_DEVICE_COOKIE,
  KIOSK_SELF_SERVICE_COOKIE,
  DEVICE_TTL_MS,
  SELF_SERVICE_ABSOLUTE_TTL_MS,
  parseCookieValue,
  buildCookieOptions,
  checkPinRateLimit,
  recordPinFailure,
  clearPinFailures,
  bindKioskDevice,
  resolveKioskDevice,
  revokeKioskDevice,
  revokeDevicesByKioskUser,
  isEmployeeAuthorizedForBranch,
  createKioskEmployeeSession,
  validatePunchSession,
  consumePunchSession,
  resolveSelfServiceSession,
  invalidateSelfServiceSession,
};
