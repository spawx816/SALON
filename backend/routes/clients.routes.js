const express = require('express');
const bcrypt = require('bcryptjs');
const { decodeCursor, computeFilterHash, buildPaginatedResponse } = require('../utils/cursor_pagination');
const { getEffectiveRole, requirePermission } = require('../middleware/rbac.middleware');

const MEMBERSHIP_RESPONSE_FIELDS = Object.freeze([
  'contract_id', 'plan_id', 'plan_name', 'contract_status', 'wash_Quota', 'washes_used',
  'current_period_start', 'current_period_end', 'next_billing_date', 'auto_billing_enabled',
  'signed_at', 'precio_mensual'
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildAddressFallback(body = {}) {
  if (body.direccion !== undefined && body.direccion !== null && String(body.direccion).trim() !== '') {
    return String(body.direccion).trim();
  }
  const parts = [body.calle, body.numero ? `#${String(body.numero).trim()}` : '', body.sector, body.ciudad]
    .map((v) => (v !== undefined && v !== null ? String(v).trim() : ''))
    .filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : '';
}

function createClientsRouter(pool, options = {}) {
  const router = express.Router();
  const { entitlementsService } = options;

  // Guard RBAC y aislamiento B2C para /api/clients:
  // - Clientes B2C solo pueden consultar su propio perfil (GET /:id cuando id === req.auth.id)
  // - Personal requiere permisos granulares (clients.view / clients.create / clients.edit)
  router.use((req, res, next) => {
    const role = getEffectiveRole(req);
    const method = String(req.method || '').toUpperCase();
    const cleanPath = String(req.path || '/');

    if (role === 'cliente_b2c' || req.auth?.isClient) {
      const idMatch = cleanPath.match(/^\/([^/]+)$/);
      if (method === 'GET' && idMatch && idMatch[1] !== 'search' && String(idMatch[1]) === String(req.auth?.id || '')) {
        return next();
      }
      return res.status(403).json({
        error: 'Acceso denegado: los clientes solo pueden consultar su propio perfil.',
        code: 'CLIENT_FORBIDDEN_STAFF_ACTION',
      });
    }

    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return requirePermission('clients.view', 'clients.create', 'clients.edit', 'pos.visits.view', 'pos.visits.create')(req, res, next);
    }
    if (method === 'POST') {
      return requirePermission('clients.create', 'clients.edit')(req, res, next);
    }
    return requirePermission('clients.edit')(req, res, next);
  });

  /**
   * Clientes/CRM está incluido en BASE y PRO, pero las capacidades de membresía (contratos, planes, cupos)
   * siguen siendo exclusivas de PRO. El tenant se resuelve SOLO desde req.tenantId (sesión autenticada).
   * FAIL CLOSED: sin servicio de entitlements o ante error se asume que NO hay membresías.
   */
  async function tenantHasMemberships(req) {
    if (!entitlementsService || !req.tenantId) return false;
    try {
      const targetBranchId = req.body?.branch_id || req.body?.branchId || req.query?.branch_id || req.query?.branchId || req.headers?.['x-branch-id'] || req.auth?.branchId || req.user?.branch_id || null;
      const check = await entitlementsService.hasFeature(req.tenantId, 'memberships', {
        branchId: targetBranchId ? String(targetBranchId) : null
      });
      return Boolean(check && check.allowed);
    } catch {
      return false;
    }
  }

  // Campos que NUNCA salen en respuestas de clientes (hash de contraseña del portal de clientas).
  const SENSITIVE_FIELDS = ['password', 'password_hash'];

  function stripMembershipFields(row) {
    if (!row || typeof row !== 'object') return row;
    const clean = sanitizeClient(row);
    for (const f of MEMBERSHIP_RESPONSE_FIELDS) delete clean[f];
    return clean;
  }

  function sanitizeClient(row) {
    if (!row || typeof row !== 'object') return row;
    const clean = { ...row };
    for (const f of SENSITIVE_FIELDS) delete clean[f];
    return clean;
  }

  async function presentClients(req, rows) {
    const withMemberships = await tenantHasMemberships(req);
    return rows.map(r => (withMemberships ? sanitizeClient(r) : stripMembershipFields(r)));
  }

  function rejectMembershipFeature(res) {
    return res.status(403).json({
      error: 'Las membresías y contratos no están incluidos en el plan actual. Cambia a Plan PRO para habilitarlos.',
      code: 'FEATURE_NOT_INCLUDED',
      feature: 'memberships'
    });
  }

  const isSet = (v) => v !== undefined && v !== null && v !== '';
  const hasMembershipPayload = (body = {}) => (
    isSet(body.plan_id) ||
    isSet(body.plan_name) ||
    isSet(body.contract_status) ||
    isSet(body.washes_used) ||
    isSet(body.wash_Quota)
  );

  // GET /api/clients/search - Isolated tenant client search/autocomplete (REM-P2-01)
  router.get('/search', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de empresa requerido.' });
      }

      const q = String(req.query.q || '').trim();
      if (q.length < 2) {
        return res.status(400).json({ error: 'El término de búsqueda debe tener al menos 2 caracteres.' });
      }

      const rawLimit = parseInt(req.query.limit || '20', 10);
      const limit = Math.min(Math.max(rawLimit, 1), 50);

      const filterHash = computeFilterHash({ q });
      let cursorData = null;
      if (req.query.cursor) {
        cursorData = decodeCursor(req.query.cursor, tenantId, filterHash);
      }

      const searchPattern = `%${q}%`;
      const params = [tenantId, searchPattern, searchPattern, searchPattern, searchPattern];
      let cursorClause = '';

      if (cursorData) {
        cursorClause = ' AND (c.created_at < ? OR (c.created_at = ? AND c.id < ?::uuid))';
        params.push(cursorData.last_created_at, cursorData.last_created_at, cursorData.last_id);
      }

      params.push(limit + 1);

      const [rows] = await pool.query(`
        SELECT c.id, c.tenant_id, c.nombre, c.name, c.telefono, c.phone, c.cedula, c.email, c.created_at
        FROM clients c
        WHERE c.tenant_id = ?
          AND (c.nombre ILIKE ? OR c.name ILIKE ? OR c.telefono ILIKE ? OR c.cedula ILIKE ?)
          ${cursorClause}
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT ?
      `, params);

      const paginated = buildPaginatedResponse({
        items: rows,
        limit,
        tenant_id: tenantId,
        filters_hash: filterHash
      });

      res.json(paginated);
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ error: err.message, code: err.code });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/clients - List clients for the authenticated tenant with cursor pagination (REM-P2-05)
  router.get('/', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de empresa requerido.' });
      }

      const rawLimit = parseInt(req.query.limit || '50', 10);
      const limit = Math.min(Math.max(rawLimit, 1), 100);
      const isPaginatedRequested = req.query.paginated === 'true' || Boolean(req.query.cursor);

      let cursorData = null;
      if (req.query.cursor) {
        cursorData = decodeCursor(req.query.cursor, tenantId);
      }

      const params = [tenantId, tenantId, tenantId];
      let cursorClause = '';
      if (cursorData) {
        cursorClause = ' AND (c.created_at < ? OR (c.created_at = ? AND c.id < ?::uuid))';
        params.push(cursorData.last_created_at, cursorData.last_created_at, cursorData.last_id);
      }
      params.push(limit + 1);

      const [rows] = await pool.query(`
        SELECT c.*,
               cn.id as contract_id,
               cn.plan_id,
               cn.plan_name,
               cn.status as contract_status,
               cn.wash_Quota,
               cn.washes_used,
               cn.current_period_start,
               cn.current_period_end,
               cn.next_billing_date,
               cn.auto_billing_enabled,
               cn.signed_at,
               cn.precio_mensual,
               COALESCE(b.name, s.name, 'Sucursal Principal') as salon_name
        FROM clients c
        LEFT JOIN (
          SELECT c1.*
          FROM contracts c1
          INNER JOIN (
            SELECT client_id, MAX(signed_at) as max_signed
            FROM contracts
            WHERE tenant_id = ?
            GROUP BY client_id
          ) c2 ON c1.client_id = c2.client_id AND c1.signed_at = c2.max_signed
          WHERE c1.tenant_id = ?
        ) cn ON c.id::text = cn.client_id::text
        LEFT JOIN branches b ON c.salon_id::text = b.id::text AND b.tenant_id = c.tenant_id
        LEFT JOIN salons s ON c.salon_id::text = s.id::text AND s.tenant_id = c.tenant_id
        WHERE c.tenant_id = ?
        ${cursorClause}
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT ?
      `, params);

      const paginated = buildPaginatedResponse({
        items: await presentClients(req, rows),
        limit,
        tenant_id: tenantId
      });

      if (isPaginatedRequested) {
        return res.json(paginated);
      }

      if (paginated.pagination.next_cursor) {
        res.setHeader('X-Cursor-Next', paginated.pagination.next_cursor);
        res.setHeader('X-Has-More', 'true');
      }
      res.json(paginated.data);
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ error: err.message, code: err.code });
      }
      console.error('[CLIENTS GET ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/clients/cedula/:cedula - Find client by cedula within the authenticated tenant
  router.get('/cedula/:cedula', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { cedula } = req.params;
      const cleanCedula = String(cedula || '').replace(/\D/g, '');
      if (!cleanCedula) {
        return res.status(400).json({ error: 'Cédula inválida' });
      }

      const [rows] = await pool.query(`
        SELECT c.*,
               cn.id as contract_id,
               cn.plan_id,
               cn.plan_name,
               cn.status as contract_status,
               cn.wash_Quota,
               cn.washes_used,
               cn.current_period_start,
               cn.current_period_end,
               cn.next_billing_date
        FROM clients c
        LEFT JOIN contracts cn ON c.id::text = cn.client_id::text AND cn.tenant_id = c.tenant_id AND cn.status IN ('Active', 'Activo')
        WHERE c.tenant_id = ?
          AND (c.cedula = ? OR REPLACE(c.cedula, '-', '') = ?)
        LIMIT 1
      `, [tenantId, cedula, cleanCedula]);

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Cliente no encontrado' });
      }

      res.json((await presentClients(req, [rows[0]]))[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/clients/:id - Get single client by ID or Cedula within the authenticated tenant
  router.get('/:id', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const cleanCedula = String(id).replace(/\D/g, '');

      const [rows] = await pool.query(`
        SELECT c.*,
               cn.id as contract_id,
               cn.plan_id,
               cn.plan_name,
               cn.status as contract_status,
               cn.wash_Quota,
               cn.washes_used,
               cn.current_period_start,
               cn.current_period_end,
               cn.next_billing_date,
               cn.auto_billing_enabled,
               cn.precio_mensual,
               COALESCE(b.name, s.name, 'Sucursal Principal') as salon_name
        FROM clients c
        LEFT JOIN contracts cn ON c.id::text = cn.client_id::text AND cn.tenant_id = c.tenant_id
        LEFT JOIN branches b ON c.salon_id::text = b.id::text AND b.tenant_id = c.tenant_id
        LEFT JOIN salons s ON c.salon_id::text = s.id::text AND s.tenant_id = c.tenant_id
        WHERE c.tenant_id = ?
          AND (c.id::text = ? OR c.cedula = ? OR (LENGTH(?) >= 8 AND REPLACE(c.cedula, '-', '') = ?))
        ORDER BY cn.signed_at DESC
        LIMIT 1
      `, [tenantId, id, id, cleanCedula, cleanCedula]);

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Cliente no encontrado' });
      }

      res.json((await presentClients(req, [rows[0]]))[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/clients - Create new client within the authenticated tenant
  router.post('/', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'No se pudo determinar la empresa (Tenant) para registrar el cliente.' });
      }

      const {
        id,
        nombre,
        cedula,
        telefono,
        email,
        direccion,
        fecha_nacimiento,
        fechaNacimiento,
        salon_id,
        password,
        status,
        plan_id,
        plan_name
      } = req.body;

      const cleanNombre = nombre ? String(nombre).trim() : '';
      if (!cleanNombre) {
        return res.status(400).json({ error: 'El nombre del cliente es obligatorio.' });
      }

      // BASE puede registrar clientes, pero NO suscribirlos a membresías (crear contratos).
      if (hasMembershipPayload(req.body) && !(await tenantHasMemberships(req))) {
        return rejectMembershipFeature(res);
      }

      const cleanCedula = cedula ? String(cedula).trim() : null;
      if (cleanCedula) {
        const digitsOnly = cleanCedula.replace(/\D/g, '');
        const [existing] = await pool.query(
          `SELECT id, nombre FROM clients 
           WHERE tenant_id = ? AND (cedula = ? OR (LENGTH(?) >= 8 AND REPLACE(cedula, '-', '') = ?)) LIMIT 1`,
          [tenantId, cleanCedula, digitsOnly, digitsOnly]
        );
        if (existing.length > 0) {
          return res.status(400).json({
            error: `Ya existe un cliente registrado con la cédula ${cleanCedula} (${existing[0].nombre}).`
          });
        }
      }

      const clientId = (id && UUID_RE.test(String(id))) ? id : require('crypto').randomUUID();
      const rawBirth = fecha_nacimiento !== undefined ? fecha_nacimiento : fechaNacimiento;
      const cleanBirthDate = rawBirth && String(rawBirth).trim() !== '' ? String(rawBirth).split('T')[0] : null;
      const resolvedDireccion = buildAddressFallback({ ...req.body, direccion });

      let hashedPass = null;
      if (password && String(password).trim() !== '') {
        hashedPass = (String(password).startsWith('$2a$') || String(password).startsWith('$2b$'))
          ? password
          : await bcrypt.hash(String(password), 10);
      }

      let validatedSalonId = null;
      if (salon_id !== undefined && salon_id !== null && String(salon_id).trim() !== '') {
        const [validBranch] = await pool.query(
          'SELECT id::text AS id FROM branches WHERE id::text = ? AND tenant_id = ? UNION SELECT id::text AS id FROM salons WHERE id::text = ? AND tenant_id = ? LIMIT 1',
          [String(salon_id), tenantId, String(salon_id), tenantId]
        );
        if (validBranch.length === 0) {
          return res.status(400).json({ error: 'La sucursal especificada no pertenece a esta empresa.' });
        }
        validatedSalonId = String(validBranch[0].id);
      } else {
        const [defaultBranch] = await pool.query(
          'SELECT id FROM branches WHERE tenant_id = ? ORDER BY is_main DESC, created_at ASC LIMIT 1',
          [tenantId]
        );
        validatedSalonId = defaultBranch[0]?.id ? String(defaultBranch[0].id) : null;
      }

      await pool.query(
        `INSERT INTO clients (
           id, tenant_id, nombre, name, cedula, cedula_rnc, telefono, phone, email, direccion, address, fecha_nacimiento,
           salon_id, password, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          clientId,
          tenantId,
          cleanNombre,
          cleanNombre,
          cleanCedula,
          cleanCedula,
          telefono || '',
          telefono || '',
          email || '',
          resolvedDireccion,
          resolvedDireccion,
          cleanBirthDate,
          validatedSalonId,
          hashedPass,
          status || 'Active'
        ]
      );

      if (plan_id) {
        const contractId = `CON-${Date.now()}`;
        const [planRows] = await pool.query('SELECT * FROM plans WHERE id = ? AND tenant_id = ? LIMIT 1', [plan_id, tenantId]);
        const pName = plan_name || planRows[0]?.name || 'Plan Beauty';
        const pPrice = planRows[0]?.price || 1950;

        await pool.query(
          `INSERT INTO contracts (
             id, tenant_id, client_id, plan_id, plan_name, status, wash_Quota, washes_used,
             precio_mensual, current_period_start, current_period_end, next_billing_date, signed_at
           ) VALUES (?, ?, ?, ?, ?, 'Active', 4, 0, ?, NOW(), DATE_ADD(NOW(), INTERVAL 30 DAY), DATE_ADD(NOW(), INTERVAL 30 DAY), NOW())`,
          [contractId, tenantId, clientId, plan_id, pName, pPrice]
        );
      }

      res.json({ id: clientId, tenant_id: tenantId, success: true });
    } catch (err) {
      const errorId = require('crypto').randomUUID();
      console.error(`[CLIENTS POST ERROR ${errorId}] tenant=${req.tenantId} code=${err.code || 'ERR'}:`, err.message);
      res.status(500).json({ error: 'No se pudo registrar el cliente. Intenta nuevamente.', error_id: errorId });
    }
  });

  // PUT /api/clients/:id - Update client details within the authenticated tenant
  router.put('/:id', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      if (!UUID_RE.test(String(id || ''))) {
        return res.status(404).json({ error: 'Cliente no encontrado en esta empresa.' });
      }
      const {
        nombre,
        cedula,
        telefono,
        email,
        direccion,
        fecha_nacimiento,
        fechaNacimiento,
        salon_id,
        status,
        password,
        plan_id,
        contract_status,
        washes_used,
        wash_Quota
      } = req.body;

      const [existingRows] = await pool.query('SELECT id FROM clients WHERE id = ? AND tenant_id = ? LIMIT 1', [id, tenantId]);
      if (existingRows.length === 0) {
        return res.status(404).json({ error: 'Cliente no encontrado en esta empresa.' });
      }

      // BASE puede editar clientes, pero NO crear ni modificar contratos/membresías.
      if (hasMembershipPayload(req.body) && !(await tenantHasMemberships(req))) {
        return rejectMembershipFeature(res);
      }

      const cleanNombre = nombre !== undefined ? String(nombre).trim() : undefined;
      if (cleanNombre !== undefined && !cleanNombre) {
        return res.status(400).json({ error: 'El nombre del cliente no puede estar vacío.' });
      }

      const cleanCedula = cedula !== undefined ? (cedula ? String(cedula).trim() : null) : undefined;
      if (cleanCedula) {
        const digitsOnly = cleanCedula.replace(/\D/g, '');
        const [dupRows] = await pool.query(
          `SELECT id, nombre FROM clients
           WHERE tenant_id = ? AND id <> ? AND (cedula = ? OR (LENGTH(?) >= 8 AND REPLACE(cedula, '-', '') = ?)) LIMIT 1`,
          [tenantId, id, cleanCedula, digitsOnly, digitsOnly]
        );
        if (dupRows.length > 0) {
          return res.status(400).json({
            error: `Ya existe otro cliente registrado con la cédula ${cleanCedula} (${dupRows[0].nombre}).`
          });
        }
      }

      const rawBirth = fecha_nacimiento !== undefined ? fecha_nacimiento : fechaNacimiento;
      const cleanBirthDate = rawBirth !== undefined
        ? (rawBirth && String(rawBirth).trim() !== '' ? String(rawBirth).split('T')[0] : null)
        : undefined;

      const hasAddressFields = direccion !== undefined || req.body.calle !== undefined || req.body.sector !== undefined || req.body.ciudad !== undefined;
      const resolvedDireccion = hasAddressFields ? buildAddressFallback({ ...req.body, direccion }) : undefined;

      let validatedSalonId = undefined;
      if (salon_id !== undefined) {
        if (salon_id === null || String(salon_id).trim() === '') {
          validatedSalonId = null;
        } else {
          const [validBranch] = await pool.query(
            'SELECT id::text AS id FROM branches WHERE id::text = ? AND tenant_id = ? UNION SELECT id::text AS id FROM salons WHERE id::text = ? AND tenant_id = ? LIMIT 1',
            [String(salon_id), tenantId, String(salon_id), tenantId]
          );
          if (validBranch.length === 0) {
            return res.status(400).json({ error: 'La sucursal especificada no pertenece a esta empresa.' });
          }
          validatedSalonId = String(validBranch[0].id);
        }
      }

      let query = `
        UPDATE clients SET
          nombre = COALESCE(?, nombre),
          name = COALESCE(?, name),
          cedula = COALESCE(?, cedula),
          cedula_rnc = COALESCE(?, cedula_rnc),
          telefono = COALESCE(?, telefono),
          phone = COALESCE(?, phone),
          email = COALESCE(?, email),
          direccion = COALESCE(?, direccion),
          address = COALESCE(?, address),
          salon_id = COALESCE(?, salon_id),
          status = COALESCE(?, status)
      `;
      const params = [
        cleanNombre !== undefined ? cleanNombre : null,
        cleanNombre !== undefined ? cleanNombre : null,
        cleanCedula !== undefined ? cleanCedula : null,
        cleanCedula !== undefined ? cleanCedula : null,
        telefono !== undefined ? telefono : null,
        telefono !== undefined ? telefono : null,
        email !== undefined ? email : null,
        resolvedDireccion !== undefined ? resolvedDireccion : null,
        resolvedDireccion !== undefined ? resolvedDireccion : null,
        validatedSalonId !== undefined ? validatedSalonId : null,
        status !== undefined ? status : null
      ];

      if (cleanBirthDate !== undefined) {
        query += `, fecha_nacimiento = ?`;
        params.push(cleanBirthDate);
      }

      if (password && String(password).trim() !== '') {
        const hashed = (String(password).startsWith('$2a$') || String(password).startsWith('$2b$'))
          ? password
          : await bcrypt.hash(String(password), 10);
        query += `, password = ?`;
        params.push(hashed);
      }

      query += ` WHERE id = ? AND tenant_id = ?`;
      params.push(id, tenantId);

      await pool.query(query, params);

      if (plan_id !== undefined || contract_status !== undefined || washes_used !== undefined || wash_Quota !== undefined) {
        const [contracts] = await pool.query(
          'SELECT id FROM contracts WHERE client_id = ? AND tenant_id = ? ORDER BY signed_at DESC LIMIT 1',
          [id, tenantId]
        );
        if (contracts.length > 0) {
          await pool.query(
            `UPDATE contracts SET
               plan_id = COALESCE(?, plan_id),
               status = COALESCE(?, status),
               washes_used = COALESCE(?, washes_used),
               wash_Quota = COALESCE(?, wash_Quota)
             WHERE id = ? AND tenant_id = ?`,
            [
              plan_id !== undefined ? plan_id : null,
              contract_status !== undefined ? contract_status : null,
              washes_used !== undefined ? washes_used : null,
              wash_Quota !== undefined ? wash_Quota : null,
              contracts[0].id,
              tenantId
            ]
          );
        } else if (plan_id) {
          const contractId = `CON-${Date.now()}`;
          const [planRows] = await pool.query('SELECT * FROM plans WHERE id = ? AND tenant_id = ? LIMIT 1', [plan_id, tenantId]);
          const pName = planRows[0]?.name || 'Plan Beauty';
          const pPrice = planRows[0]?.price || 1950;
          await pool.query(
            `INSERT INTO contracts (
               id, tenant_id, client_id, plan_id, plan_name, status, wash_Quota, washes_used,
               precio_mensual, current_period_start, current_period_end, next_billing_date, signed_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 30 DAY), DATE_ADD(NOW(), INTERVAL 30 DAY), NOW())`,
            [
              contractId,
              tenantId,
              id,
              plan_id,
              pName,
              contract_status || 'Active',
              wash_Quota !== undefined ? wash_Quota : 4,
              washes_used !== undefined ? washes_used : 0,
              pPrice
            ]
          );
        }
      }

      res.json({ success: true });
    } catch (err) {
      console.error('[CLIENTS PUT ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/clients/:id - Delete client within the authenticated tenant
  router.delete('/:id', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      if (!UUID_RE.test(String(id || ''))) {
        return res.status(404).json({ error: 'Cliente no encontrado' });
      }

      // 404 explícito para clientes inexistentes o de otro tenant (antes devolvía 200 sin borrar nada).
      const [ownedRows] = await pool.query('SELECT id FROM clients WHERE id = ? AND tenant_id = ? LIMIT 1', [id, tenantId]);
      if (!ownedRows || ownedRows.length === 0) {
        return res.status(404).json({ error: 'Cliente no encontrado' });
      }

      // Los contratos PRO conservados tras un downgrade nunca se destruyen desde BASE (solo PRO puede eliminarlos).
      if (!(await tenantHasMemberships(req))) {
        const [existingContracts] = await pool.query(
          'SELECT id FROM contracts WHERE client_id = ? AND tenant_id = ? LIMIT 1',
          [id, tenantId]
        );
        if (existingContracts.length > 0) {
          return res.status(409).json({
            error: 'El cliente tiene contratos de membresía conservados. Reactiva el Plan PRO para administrarlos antes de eliminarlo.',
            code: 'CLIENT_HAS_MEMBERSHIP_DATA'
          });
        }
      }

      // Preservar historial contable/comercial: si el cliente tiene visitas registradas, archivar en lugar de borrar físicamente.
      const [visitRefs] = await pool.query(
        'SELECT 1 FROM visits WHERE tenant_id = ? AND client_id::text = ? LIMIT 1',
        [tenantId, String(id)]
      );
      if (visitRefs && visitRefs.length > 0) {
        await pool.query(
          "UPDATE clients SET status = 'Inactive' WHERE id = ? AND tenant_id = ?",
          [id, tenantId]
        );
        return res.json({
          success: true,
          archived: true,
          message: 'El cliente posee historial de visitas y fue archivado (Inactivo) para preservar la integridad histórica.'
        });
      }

      await pool.query('DELETE FROM contracts WHERE client_id = ? AND tenant_id = ?', [id, tenantId]);
      await pool.query('DELETE FROM clients WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      res.json({ success: true, archived: false });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createClientsRouter };
