const express = require('express');
const { createQuarantineGuard } = require('../middleware/quarantine.middleware.cjs');
const { createIdempotencyMiddleware } = require('../middleware/idempotency.middleware.cjs');
const { getBranchScope, isBranchAuthorized } = require('../middleware/rbac.middleware');
const { permissionMapGrants } = require('../domain/rbac_catalog');
const { buildCanonicalAppliedPayments } = require('../services/cash_register_aggregation.service');

function createVisitsRouter(pool, helpers = {}) {
  const router = express.Router();
  const { sendSurveyEmail, inventoryService } = helpers;

  // Fail-Closed Quarantine Protection Guard on Visits
  router.use('/:id', createQuarantineGuard(pool, 'visits', 'id'));

  // Multi-Tenant Financial Idempotency Guard (charges, checkouts, voids)
  router.use(createIdempotencyMiddleware());

  // Helper: Generate sequential ticket number per branch within the tenant (atomic on last_sequence)
  const getNextTicketNumber = async (salonId = 1, tenantId = null) => {
    const cleanSalonId = String(salonId || '1');
    const prefix = (cleanSalonId === '2' || cleanSalonId === '4') ? 'VM' : 'SD';
    try {
      const [rows] = await pool.query(
        `INSERT INTO ticket_sequences (tenant_id, salon_id, prefix, last_sequence)
         VALUES (?, ?, ?, 1)
         ON CONFLICT (tenant_id, salon_id)
         DO UPDATE SET last_sequence = COALESCE(ticket_sequences.last_sequence, 0) + 1
         RETURNING last_sequence`,
        [tenantId, cleanSalonId, prefix]
      );
      const nextNum = parseInt(rows?.[0]?.last_sequence, 10) || 1;
      return `${prefix}-${String(nextNum).padStart(5, '0')}`;
    } catch (e) {
      // Fallback en caso de índice único legacy solo sobre salon_id
      try {
        const [upd] = await pool.query(
          `UPDATE ticket_sequences
           SET last_sequence = COALESCE(last_sequence, 0) + 1
           WHERE tenant_id = ? AND salon_id = ?
           RETURNING last_sequence`,
          [tenantId, cleanSalonId]
        );
        if (upd && upd.length > 0) {
          const nextNum = parseInt(upd[0].last_sequence, 10) || 1;
          return `${prefix}-${String(nextNum).padStart(5, '0')}`;
        }
      } catch (_) { }
      return `${prefix}-${Date.now().toString().slice(-5)}`;
    }
  };

  // Helper: Batch calculate and persist employee commissions for visits (O(1) database queries, no N+1)
  const processBatchVisitCommissions = async (visits, tenantId, dbConn = null) => {
    const db = dbConn || pool;
    try {
      if (!Array.isArray(visits) || visits.length === 0 || !tenantId) return { processed: 0, items: 0 };
      const resolvedTenantId = tenantId;

      const preparedItems = [];
      const visitIds = [];
      const distinctEmpIds = new Set();
      const distinctEmpNames = new Set();
      const distinctServiceNames = new Set();

      for (const v of visits) {
        if (!v || !v.id) continue;
        visitIds.push(String(v.id));

        let items = [];
        try {
          items = typeof v.items_detail === 'string' ? JSON.parse(v.items_detail) : (v.items_detail || []);
        } catch (_) {
          continue;
        }
        if (!Array.isArray(items) || items.length === 0) continue;

        for (const item of items) {
          const empIdRaw = item.colaboradorId || item.employee_id || item.stylist_id;
          const empNameRaw = item.colaboradorNombre || item.colaborador || item.employee_name;
          if (!empIdRaw && !empNameRaw) continue;
          if (empNameRaw === 'No asignada' || empNameRaw === 'Sin asignar') continue;

          if (empIdRaw) {
            distinctEmpIds.add(String(empIdRaw).replace('EMP-', '').trim());
          }
          if (empNameRaw) {
            distinctEmpNames.add(String(empNameRaw).trim().toLowerCase());
          }

          const serviceName = item.nombre || item.service_name || 'Servicio';
          distinctServiceNames.add(serviceName.trim().toLowerCase());

          preparedItems.push({
            visitId: String(v.id),
            ticketNumber: v.ticket_number || String(v.id),
            visitedAt: v.visited_at || new Date(),
            empIdRaw: empIdRaw ? String(empIdRaw).replace('EMP-', '').trim() : null,
            empNameRaw: empNameRaw ? String(empNameRaw).trim() : null,
            serviceName,
            isProductItem: String(item.tipo_item || item.item_type || '').toUpperCase() === 'PRODUCTO' || Boolean(item.is_product) || Boolean(item.product_id),
            precioBase: Number(item.precioAplicado ?? item.precio ?? 0) * (Number(item.cantidad) || 1),
            cantidad: Number(item.cantidad) || 1
          });
        }
      }

      if (visitIds.length === 0 || preparedItems.length === 0) {
        return { processed: visits.length, items: 0 };
      }

      // Query 1: Batch delete pending commissions for these visits in one query
      const placeholders = visitIds.map(() => '?').join(', ');
      await db.query(
        `DELETE FROM employee_commissions_log WHERE tenant_id = ? AND status = 'Pendiente' AND visit_id IN (${placeholders})`,
        [resolvedTenantId, ...visitIds]
      );

      // Query 2: Preload all matching staff records in ONE query
      const staffMapById = new Map();
      const staffMapByName = new Map();

      const empIdArr = Array.from(distinctEmpIds);
      const empNameArr = Array.from(distinctEmpNames);
      if (empIdArr.length > 0 || empNameArr.length > 0) {
        const conds = [];
        const params = [resolvedTenantId];
        if (empIdArr.length > 0) {
          const ph = empIdArr.map(() => '?').join(', ');
          conds.push(`id::text IN (${ph})`);
          params.push(...empIdArr);
        }
        if (empNameArr.length > 0) {
          const ph = empNameArr.map(() => '?').join(', ');
          conds.push(`LOWER(nombre) IN (${ph})`);
          params.push(...empNameArr);
        }

        const [staffRows] = await db.query(
          `SELECT id, nombre, localidad, tenant_id FROM staff_records WHERE tenant_id = ? AND (${conds.join(' OR ')})`,
          params
        );

        for (const s of (staffRows || [])) {
          staffMapById.set(String(s.id), s);
          if (s.nombre) {
            staffMapByName.set(s.nombre.trim().toLowerCase(), s);
          }
        }
      }

      // Query 3: Preload all matching services rules in ONE query
      const serviceMap = new Map();
      const srvNameArr = Array.from(distinctServiceNames);
      if (srvNameArr.length > 0) {
        const ph = srvNameArr.map(() => '?').join(', ');
        const [serviceRows] = await db.query(
          `SELECT id, COALESCE(nombre, name) as service_name, item_type, comision_valor, tipo_comision, tenant_id 
           FROM services 
           WHERE tenant_id = ? AND LOWER(COALESCE(nombre, name)) IN (${ph})`,
          [resolvedTenantId, ...srvNameArr]
        );

        for (const srv of (serviceRows || [])) {
          if (srv.service_name) {
            serviceMap.set(srv.service_name.trim().toLowerCase(), srv);
          }
        }
      }

      // In-memory calculation with zero SQL queries per item
      const insertRows = [];
      for (const item of preparedItems) {
        if (item.precioBase <= 0) continue;

        let emp = null;
        if (item.empIdRaw && staffMapById.has(item.empIdRaw)) {
          emp = staffMapById.get(item.empIdRaw);
        } else if (item.empNameRaw && staffMapByName.has(item.empNameRaw.toLowerCase())) {
          emp = staffMapByName.get(item.empNameRaw.toLowerCase());
        }

        if (!emp) continue;

        const srvKey = item.serviceName.trim().toLowerCase();
        const srv = serviceMap.has(srvKey) ? serviceMap.get(srvKey) : null;
        const isProduct = item.isProductItem || (srv && String(srv.item_type || '').toUpperCase() === 'PRODUCTO');

        let pct = isProduct ? 0 : 15;
        let montoComision = isProduct ? 0 : Math.round(item.precioBase * (pct / 100) * 100) / 100;

        if (srv && srv.comision_valor !== undefined && srv.comision_valor !== null && Number(srv.comision_valor) > 0) {
          if (srv.tipo_comision === 'Monto Fijo') {
            montoComision = Math.round(Number(srv.comision_valor) * item.cantidad * 100) / 100;
            pct = 0;
          } else {
            pct = Number(srv.comision_valor);
            montoComision = Math.round(item.precioBase * (pct / 100) * 100) / 100;
          }
        }

        // Productos sin regla de comisión no generan registro de comisión
        if (montoComision <= 0) continue;

        const commissionCents = Math.round(montoComision * 100);

        insertRows.push([
          resolvedTenantId,
          item.visitId,
          item.ticketNumber,
          Number(emp.id) || null,
          emp.nombre,
          item.serviceName,
          item.precioBase,
          pct,
          montoComision,
          montoComision,
          commissionCents,
          'DOP',
          'Pendiente',
          emp.localidad || 'Principal',
          item.visitedAt
        ]);
      }

      // Query 4: Multi-row chunked INSERT (up to 250 rows per statement)
      const chunkSize = 250;
      for (let i = 0; i < insertRows.length; i += chunkSize) {
        const chunk = insertRows.slice(i, i + chunkSize);
        const rowPlaceholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        const flatParams = chunk.flat();

        await db.query(
          `INSERT INTO employee_commissions_log (
             tenant_id, visit_id, ticket_number, employee_id, employee_name, service_name,
             precio_servicio, commission_rate, monto_comision, commission_amount, commission_cents, currency, status, localidad, created_at
           ) VALUES ${rowPlaceholders}`,
          flatParams
        );
      }

      return { processed: visits.length, items: insertRows.length };
    } catch (err) {
      if (dbConn) throw err;
      console.warn('[PROCESS BATCH COMMISSIONS WARN]:', err.message);
      return { error: err.message };
    }
  };

  // Single-visit helper delegates to the batch processor
  const processVisitCommissions = async (visitId, itemsDetailRaw, ticketNumber, visitedAt, tenantId, dbConn = null) => {
    return processBatchVisitCommissions([{
      id: visitId,
      items_detail: itemsDetailRaw,
      ticket_number: ticketNumber,
      visited_at: visitedAt
    }], tenantId, dbConn);
  };

  // 1. GET /api/visits - List all visits for the authenticated tenant
  router.get('/', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { salon_id, status } = req.query;
      let query = `
        SELECT v.*,
               COALESCE(v.client_name, c.nombre, 'Cliente General') as resolved_client_name,
               COALESCE(c.cedula, v.rnc_cliente) as client_cedula,
               COALESCE(b.name, s.name, 'Sucursal Principal') as salon_name
        FROM visits v
        LEFT JOIN clients c ON v.client_id = c.id AND c.tenant_id = v.tenant_id
        LEFT JOIN branches b ON v.salon_id::text = b.id::text AND b.tenant_id = v.tenant_id
        LEFT JOIN salons s ON v.salon_id::text = s.id::text AND s.tenant_id = v.tenant_id
        WHERE v.tenant_id = ?
      `;
      const params = [tenantId];

      const scope = getBranchScope(req);
      if (!scope.allBranches) {
        if (salon_id && salon_id !== 'all') {
          if (!isBranchAuthorized(req, salon_id)) {
            return res.status(403).json({ error: 'No tienes acceso autorizado a la sucursal solicitada.', code: 'BRANCH_ACCESS_DENIED' });
          }
          query += ' AND v.salon_id::text = ?';
          params.push(String(salon_id));
        } else {
          if (scope.branchIds.length === 0) return res.json([]);
          const placeholders = scope.branchIds.map(() => '?').join(', ');
          query += ` AND v.salon_id::text IN (${placeholders})`;
          params.push(...scope.branchIds);
        }
      } else if (salon_id && salon_id !== 'all') {
        query += ' AND v.salon_id::text = ?';
        params.push(String(salon_id));
      }
      if (status) {
        query += ' AND v.status = ?';
        params.push(status);
      }

      query += ' ORDER BY v.visited_at DESC LIMIT 500';
      const [rows] = await pool.query(query, params);
      res.json(rows);
    } catch (err) {
      console.error('[VISITS GET ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 2. GET /api/visits/pending - Active open tickets in reception/POS for the authenticated tenant
  router.get('/pending', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { salon_id } = req.query;
      const scope = getBranchScope(req);

      if (salon_id && salon_id !== 'all' && !isBranchAuthorized(req, salon_id)) {
        return res.status(403).json({
          error: 'No tienes autorización para consultar tickets pendientes de esta sucursal.',
          code: 'BRANCH_ACCESS_DENIED'
        });
      }

      let query = `
        SELECT v.*,
               COALESCE(v.client_name, c.nombre, 'Cliente General') as client_name,
               c.cedula as client_cedula,
               c.telefono as client_phone
        FROM visits v
        LEFT JOIN clients c ON v.client_id::text = c.id::text AND c.tenant_id = v.tenant_id
        WHERE v.tenant_id = ? AND v.status IN ('Pendiente', 'Abierto', 'En Proceso', 'Pre-cuenta')
      `;
      const params = [tenantId];

      if (salon_id && salon_id !== 'all') {
        query += ' AND v.salon_id::text = ?';
        params.push(String(salon_id));
      } else if (!scope.allBranches && Array.isArray(scope.branchIds) && scope.branchIds.length > 0) {
        const ph = scope.branchIds.map(() => '?').join(', ');
        query += ` AND v.salon_id::text IN (${ph})`;
        params.push(...scope.branchIds.map(String));
      }

      query += ' ORDER BY v.visited_at DESC';
      const [rows] = await pool.query(query, params);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 3. GET /api/visits/client/:clientId - Visits for a specific client within the authenticated tenant
  router.get('/client/:clientId', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { clientId } = req.params;
      const cleanCedula = String(clientId).replace(/\D/g, '');
      const [rows] = await pool.query(`
        SELECT v.*, COALESCE(b.name, s.name, 'Sucursal Principal') as salon_name
        FROM visits v
        LEFT JOIN clients c ON v.client_id = c.id AND c.tenant_id = v.tenant_id
        LEFT JOIN branches b ON v.salon_id::text = b.id::text AND b.tenant_id = v.tenant_id
        LEFT JOIN salons s ON v.salon_id::text = s.id::text AND s.tenant_id = v.tenant_id
        WHERE v.tenant_id = ?
          AND (v.client_id = ?
           OR v.client_name = ?
           OR c.cedula = ?
           OR (LENGTH(?) >= 8 AND REPLACE(c.cedula, '-', '') = ?))
        ORDER BY v.visited_at DESC
      `, [tenantId, clientId, clientId, clientId, cleanCedula, cleanCedula]);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 4. POST /api/visits/ticket - Open a new pending ticket in reception within the authenticated tenant
  const isSpecialGuestOrEmpClientId = (cid) => {
    if (!cid) return true;
    const s = String(cid).trim().toUpperCase();
    return s === '' || s === 'INVITADO' || s === 'EMPLEADO' || s.startsWith('INVITADO') || s.startsWith('EMP-');
  };

  router.post('/ticket', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const {
        client_id,
        clientId,
        client_name,
        clientName,
        salon_id,
        salonId,
        servicios = [],
        items_detail = [],
        draft_data = {},
        total = 0,
        recepcionista,
        empleado_peluquera,
        empleadoPeluquera,
        empleado_lava_pelo = 'No asignada',
        empleado_manicurista = 'No asignada',
        notes,
        nota,
        client_request_id
      } = req.body || {};

      const targetSalon = String(salon_id || salonId || req.auth?.branchId || '1');
      if (!isBranchAuthorized(req, targetSalon)) {
        return res.status(403).json({
          error: 'No tienes autorización para crear tickets en esta sucursal.',
          code: 'BRANCH_ACCESS_DENIED'
        });
      }

      const targetClient = client_id || clientId || null;
      if (!isSpecialGuestOrEmpClientId(targetClient)) {
        const [clientRows] = await pool.query(
          'SELECT id FROM clients WHERE id::text = ? AND tenant_id = ? LIMIT 1',
          [String(targetClient), tenantId]
        );
        if (!clientRows || clientRows.length === 0) {
          return res.status(404).json({
            error: 'El cliente especificado no pertenece a esta empresa.',
            code: 'CLIENT_NOT_FOUND'
          });
        }
      }

      const reqIdemKey = String(req.headers['idempotency-key'] || client_request_id || '').trim();
      if (reqIdemKey) {
        const [existingDup] = await pool.query(
          `SELECT * FROM visits
           WHERE tenant_id = ? AND status IN ('Pendiente', 'Abierto', 'En Proceso', 'Pre-cuenta')
             AND draft_data->>'client_request_id' = ?
           ORDER BY visited_at DESC LIMIT 1`,
          [tenantId, reqIdemKey]
        );
        if (existingDup && existingDup.length > 0) {
          const row = existingDup[0];
          return res.status(200).json({
            success: true,
            id: row.id,
            ticket_number: row.ticket_number,
            ticketNumber: row.ticket_number,
            salon_id: row.salon_id,
            status: row.status,
            idempotent: true
          });
        }
      }

      const targetClientName = String(client_name || clientName || 'Cliente General').trim() || 'Cliente General';
      const actorName = String(req.auth?.name || req.auth?.email || recepcionista || 'Recepción').trim();
      const actorId = req.auth?.userId || req.user?.id || null;
      const targetPeluquera = empleado_peluquera || empleadoPeluquera || 'No asignada';
      const targetNota = nota !== undefined ? String(nota) : (notes !== undefined ? String(notes) : '');
      const numTotal = Number(total) || 0;
      const totalCents = Math.round(numTotal * 100);

      const safeDraftObj = (draft_data && typeof draft_data === 'object' && !Array.isArray(draft_data))
        ? { ...draft_data }
        : {};
      safeDraftObj.recepcionista = actorName;
      if (actorId) safeDraftObj.actor_id = String(actorId);
      if (reqIdemKey) safeDraftObj.client_request_id = reqIdemKey;

      const visitId = `VIS-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
      const ticketNumber = await getNextTicketNumber(targetSalon, tenantId);

      await pool.query(
        `INSERT INTO visits (
           id, tenant_id, ticket_number, client_id, client_name, salon_id,
           servicios, items_detail, draft_data, total, total_cents, currency, status,
           empleado_peluquera, empleado_lava_pelo, empleado_manicurista, nota, visited_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?, ?, 'DOP', 'Pendiente', ?, ?, ?, ?, NOW())`,
        [
          visitId,
          tenantId,
          ticketNumber,
          targetClient,
          targetClientName,
          targetSalon,
          JSON.stringify(Array.isArray(servicios) ? servicios : []),
          JSON.stringify(Array.isArray(items_detail) ? items_detail : []),
          JSON.stringify(safeDraftObj),
          numTotal,
          totalCents,
          targetPeluquera,
          empleado_lava_pelo,
          empleado_manicurista,
          targetNota
        ]
      );

      res.status(201).json({
        success: true,
        id: visitId,
        ticket_number: ticketNumber,
        ticketNumber: ticketNumber,
        salon_id: targetSalon,
        status: 'Pendiente'
      });
    } catch (err) {
      console.error('[CREATE PENDING TICKET ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 5. PUT /api/visits/:id/draft - Update draft / pending ticket items and staff before checkout
  router.put('/:id/draft', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const {
        client_id,
        client_name,
        servicios,
        items_detail,
        draft_data,
        total,
        empleado_peluquera,
        empleado_lava_pelo,
        empleado_manicurista,
        notes,
        nota
      } = req.body || {};

      const [existingRows] = await pool.query(
        'SELECT id, status, salon_id, draft_data FROM visits WHERE id = ? AND tenant_id = ? LIMIT 1',
        [id, tenantId]
      );
      if (!existingRows || existingRows.length === 0) {
        return res.status(404).json({ error: 'Ticket no encontrado en esta empresa.', code: 'TICKET_NOT_FOUND' });
      }
      const existing = existingRows[0];
      if (existing.salon_id && !isBranchAuthorized(req, existing.salon_id)) {
        return res.status(403).json({ error: 'No tienes autorización para editar tickets de esta sucursal.', code: 'BRANCH_ACCESS_DENIED' });
      }
      const editableStatuses = new Set(['Pendiente', 'Abierto', 'En Proceso', 'Pre-cuenta']);
      if (!editableStatuses.has(String(existing.status || '').trim())) {
        return res.status(409).json({
          error: `Este ticket ya está en estado "${existing.status}" y no puede modificarse como borrador.`,
          code: 'TICKET_NOT_EDITABLE'
        });
      }

      let mergedDraftJson = null;
      if (draft_data !== undefined) {
        const prevDraft = (existing.draft_data && typeof existing.draft_data === 'object') ? existing.draft_data : {};
        const nextDraft = (typeof draft_data === 'string') ? JSON.parse(draft_data || '{}') : (draft_data || {});
        mergedDraftJson = JSON.stringify({ ...prevDraft, ...nextDraft });
      }

      const targetNota = nota !== undefined ? String(nota) : (notes !== undefined ? String(notes) : null);
      const numTotal = total !== undefined ? Number(total) : null;
      const totalCents = numTotal !== null && Number.isFinite(numTotal) ? Math.round(numTotal * 100) : null;

      await pool.query(
        `UPDATE visits SET
           client_id = COALESCE(?, client_id),
           client_name = COALESCE(?, client_name),
           servicios = COALESCE(?::jsonb, servicios),
           items_detail = COALESCE(?::jsonb, items_detail),
           draft_data = COALESCE(?::jsonb, draft_data),
           total = COALESCE(?, total),
           total_cents = COALESCE(?, total_cents),
           empleado_peluquera = COALESCE(?, empleado_peluquera),
           empleado_lava_pelo = COALESCE(?, empleado_lava_pelo),
           empleado_manicurista = COALESCE(?, empleado_manicurista),
           nota = COALESCE(?, nota)
         WHERE id = ? AND tenant_id = ? AND status IN ('Pendiente', 'Abierto', 'En Proceso', 'Pre-cuenta')`,
        [
          client_id !== undefined ? client_id : null,
          client_name !== undefined ? client_name : null,
          servicios !== undefined ? (typeof servicios === 'string' ? servicios : JSON.stringify(servicios)) : null,
          items_detail !== undefined ? (typeof items_detail === 'string' ? items_detail : JSON.stringify(items_detail)) : null,
          mergedDraftJson,
          numTotal,
          totalCents,
          empleado_peluquera !== undefined ? empleado_peluquera : null,
          empleado_lava_pelo !== undefined ? empleado_lava_pelo : null,
          empleado_manicurista !== undefined ? empleado_manicurista : null,
          targetNota,
          id,
          tenantId
        ]
      );

      res.json({ success: true, id, status: existing.status });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 6. POST /api/visits/precuenta - Save pre-bill thermal ticket state
  router.post('/precuenta', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id, ticket_id, servicios, items_detail, total } = req.body;
      const targetId = id || ticket_id;
      if (targetId) {
        await pool.query(
          `UPDATE visits SET
             servicios = COALESCE(?, servicios),
             items_detail = COALESCE(?, items_detail),
             total = COALESCE(?, total)
           WHERE id = ? AND tenant_id = ?`,
          [
            servicios ? JSON.stringify(servicios) : null,
            items_detail ? JSON.stringify(items_detail) : null,
            total !== undefined ? Number(total) : null,
            targetId,
            tenantId
          ]
        );
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 7. POST /api/visits/:id/checkout - Complete POS Checkout, NCF assignment, Plan Beauty wash deduction & Commissions
  router.post('/:id/checkout', async (req, res) => {
    let txConn = null;
    let resolvedLocationId = null;
    const postCommitAlerts = [];
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const {
        client_id,
        client_name,
        salon_id = 1,
        servicios = [],
        items_detail = [],
        subtotal = 0,
        descuento = 0,
        total = 0,
        metodo_pago = 'Efectivo',
        pago_efectivo = 0,
        pago_tarjeta = 0,
        pago_transferencia = 0,
        ncf_type,
        rnc_cliente,
        rzn_soc_cliente,
        empleado_peluquera,
        empleado_lava_pelo,
        empleado_manicurista,
        recepcionista = 'Recepción',
        consume_wash = false,
        wash_count_to_consume = 0,
        cash_register_id = null,
        location_id = null
      } = req.body;

      // 1. Verificar autorización de sucursal
      if (!isBranchAuthorized(req, salon_id)) {
        return res.status(403).json({
          error: 'No tienes autorización para facturar en esta sucursal.',
          code: 'BRANCH_ACCESS_DENIED'
        });
      }

      // 2. Idempotencia natural y protección de tickets anulados
      const [existingRows] = await pool.query('SELECT * FROM visits WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      if (existingRows.length > 0 && String(existingRows[0].status || '').trim() === 'Anulado') {
        return res.status(409).json({
          error: 'No se puede facturar un ticket que fue anulado.',
          code: 'TICKET_VOIDED'
        });
      }
      if (existingRows.length > 0 && String(existingRows[0].status || '').trim() === 'Facturado') {
        return res.json({
          success: true,
          id,
          ticket_number: existingRows[0].ticket_number,
          ncf: existingRows[0].ncf || null,
          ncf_name: existingRows[0].ncf_name || null,
          status: 'Facturado',
          idempotent: true
        });
      }

      // 3. Validar integridad multi-tenant de client_id si es un cliente real (excluir invitados/empleados)
      if (!isSpecialGuestOrEmpClientId(client_id)) {
        const [clientRows] = await pool.query(
          'SELECT id FROM clients WHERE id::text = ? AND tenant_id = ? LIMIT 1',
          [String(client_id), tenantId]
        );
        if (!clientRows || clientRows.length === 0) {
          return res.status(404).json({
            error: 'El cliente especificado no pertenece a esta empresa.',
            code: 'CLIENT_NOT_FOUND'
          });
        }
      }

      // 4. Validar autorización de descuento manual (> 0) para actores no privilegiados
      const parsedDescuento = Number(descuento) || 0;
      if (parsedDescuento > 0) {
        const actorRole = String(req.auth?.role || req.user?.role || '').toLowerCase();
        const canApplyDiscount = actorRole === 'propietario' || actorRole === 'owner' || actorRole === 'admin' || Boolean(req.auth?.isSuperAdmin) || permissionMapGrants(req.auth?.permissions, 'pos.discounts.apply');
        if (!canApplyDiscount) {
          const providedPin = req.body?.admin_pin || req.body?.supervisor_pin || req.body?.pin || req.headers['x-admin-pin'];
          if (!providedPin) {
            return res.status(403).json({
              error: 'Se requiere autorización de administrador (PIN) para aplicar descuentos manuales.',
              code: 'DISCOUNT_PIN_REQUIRED'
            });
          }
          const [secRows] = await pool.query(
            'SELECT admin_pin, admin_pin_hash, active_otp_pin, otp_expires_at FROM security_settings WHERE tenant_id = ? LIMIT 1',
            [tenantId]
          );
          const sec = secRows && secRows[0] ? secRows[0] : null;
          const isOtpValid = Boolean(sec && sec.active_otp_pin && String(providedPin) === String(sec.active_otp_pin) && sec.otp_expires_at && new Date(sec.otp_expires_at) > new Date());
          let isMasterValid = false;
          const storedMaster = sec?.admin_pin_hash || sec?.admin_pin;
          if (storedMaster) {
            const { verifyPin } = require('../services/pin_security.service');
            const verifyRes = await verifyPin(String(providedPin), storedMaster);
            isMasterValid = verifyRes.matched;
          }
          if (!isMasterValid && !isOtpValid) {
            return res.status(401).json({
              error: 'PIN de administrador incorrecto para aplicar descuento.',
              code: 'INVALID_ADMIN_PIN'
            });
          }
        }
      }

      // 5. Validar que los colaboradores asignados en items_detail pertenezcan a la empresa
      const rawItemsForValidation = Array.isArray(items_detail) && items_detail.length > 0
        ? items_detail
        : (Array.isArray(servicios) ? servicios : []);
      for (const it of rawItemsForValidation) {
        const empIdRaw = it.colaboradorId || it.employee_id || it.stylist_id;
        if (empIdRaw) {
          const cleanEmpId = String(empIdRaw).replace('EMP-', '').trim();
          const [empCheck] = await pool.query(
            'SELECT id FROM staff_records WHERE id::text = ? AND tenant_id = ? LIMIT 1',
            [cleanEmpId, tenantId]
          );
          if (!empCheck || empCheck.length === 0) {
            return res.status(404).json({
              error: 'El colaborador asignado no pertenece a esta empresa.',
              code: 'EMPLOYEE_NOT_FOUND'
            });
          }
        }
      }

      // 6. Validar caja abierta obligatoria dentro del tenant y sucursal (rechazar cerradas o inexistentes)
      let activeRegisterId = cash_register_id;
      if (activeRegisterId) {
        const [regCheck] = await pool.query(
          'SELECT id, status, branch_id, salon_id FROM cash_registers WHERE id::text = ? AND tenant_id = ? LIMIT 1',
          [String(activeRegisterId), tenantId]
        );
        if (!regCheck || regCheck.length === 0) {
          return res.status(404).json({
            error: 'La caja especificada no existe en esta empresa.',
            code: 'CASH_REGISTER_NOT_FOUND'
          });
        }
        const reg = regCheck[0];
        if (!isBranchAuthorized(req, reg.branch_id ?? reg.salon_id)) {
          return res.status(403).json({
            error: 'No tienes autorización para facturar en esta caja.',
            code: 'BRANCH_ACCESS_DENIED'
          });
        }
        if (String(reg.status || '').toLowerCase() !== 'abierta') {
          return res.status(409).json({
            error: 'No se pueden registrar ventas en una caja cerrada.',
            code: 'CASH_REGISTER_CLOSED'
          });
        }
      } else {
        const sid = String(salon_id || '1');
        const [regRows] = sid.length > 10
          ? await pool.query(
            "SELECT id FROM cash_registers WHERE tenant_id = ? AND status = 'Abierta' AND (branch_id::text = ? OR salon_id::text = ?) ORDER BY opened_at DESC LIMIT 1",
            [tenantId, sid, sid]
          )
          : await pool.query(
            "SELECT id FROM cash_registers WHERE tenant_id = ? AND status = 'Abierta' AND (salon_id::text = ? OR salon_id IS NULL) ORDER BY opened_at DESC LIMIT 1",
            [tenantId, sid]
          );
        if (regRows.length > 0) {
          activeRegisterId = regRows[0].id;
        } else if (process.env.NODE_ENV !== 'test' || req.body?.require_open_register !== false) {
          const [anyReg] = await pool.query(
            'SELECT id FROM cash_registers WHERE tenant_id = ? LIMIT 1',
            [tenantId]
          );
          if (anyReg.length > 0 || req.body?.require_open_register === true) {
            return res.status(400).json({
              error: 'Debe abrir una caja en esta sucursal antes de facturar.',
              code: 'CASH_REGISTER_REQUIRED'
            });
          }
        }
      }

      // Resolver ubicación de inventario de la sucursal ANTES de abrir la transacción (sin fallback a otra sucursal)
      const productLines = [];
      if (inventoryService) {
        const rawItems = Array.isArray(items_detail) && items_detail.length > 0
          ? items_detail
          : (Array.isArray(servicios) ? servicios : []);

        for (const [idx, it] of rawItems.entries()) {
          const isProduct = String(it.tipo_item || it.item_type || '').toUpperCase() === 'PRODUCTO' || it.is_product || Boolean(it.product_id);
          if (isProduct) {
            const pId = it.product_id || it.id;
            const q = Number(it.cantidad || it.qty || it.quantity || 1);
            if (pId && q > 0) {
              productLines.push({ productId: pId, quantity: q, lineId: idx });
            }
          }
        }

        if (productLines.length > 0) {
          if (location_id) {
            resolvedLocationId = location_id;
          } else {
            try {
              const branchLoc = await inventoryService.getDefaultLocation(tenantId, salon_id);
              resolvedLocationId = branchLoc?.id || null;
            } catch (locErr) {
              if (locErr.code === 'BRANCH_LOCATION_NOT_FOUND') {
                return res.status(404).json({ error: locErr.message, code: 'BRANCH_LOCATION_NOT_FOUND' });
              }
              throw locErr;
            }
          }
        }
      }

      let ticketNumber = existingRows[0]?.ticket_number;
      if (!ticketNumber) {
        ticketNumber = await getNextTicketNumber(salon_id, tenantId);
      }

      const serializedServices = typeof servicios === 'string' ? servicios : JSON.stringify(servicios);
      const serializedItems = typeof items_detail === 'string' ? items_detail : JSON.stringify(items_detail);

      // === TRANSACCIÓN ÚNICA ATÓMICA (STOCK + NCF + VENTA + MEMBRESÍA + COMISIONES) ===
      // Si el proceso cae (SIGKILL/corte) antes del COMMIT, PostgreSQL revierte todo automáticamente.
      if (typeof pool.getConnection === 'function') {
        txConn = await pool.getConnection();
        await txConn.query('BEGIN');
        await txConn.query("SET LOCAL lock_timeout = '5s'");
      }
      const db = txConn || pool;

      // Re-verificar idempotencia y anulación bajo bloqueo dentro de la transacción
      const [txExisting] = await db.query(
        'SELECT id, status, ticket_number, ncf, ncf_name FROM visits WHERE id = ? AND tenant_id = ? FOR UPDATE',
        [id, tenantId]
      );
      if (txExisting.length > 0 && String(txExisting[0].status || '').trim() === 'Anulado') {
        if (txConn) await txConn.query('ROLLBACK');
        return res.status(409).json({
          error: 'No se puede facturar un ticket que fue anulado.',
          code: 'TICKET_VOIDED'
        });
      }
      if (txExisting.length > 0 && String(txExisting[0].status || '').trim() === 'Facturado') {
        if (txConn) await txConn.query('COMMIT');
        return res.json({
          success: true,
          id,
          ticket_number: txExisting[0].ticket_number,
          ncf: txExisting[0].ncf || null,
          ncf_name: txExisting[0].ncf_name || null,
          status: 'Facturado',
          idempotent: true
        });
      }

      // 7. Descuento atómico de inventario dentro de la MISMA transacción
      if (inventoryService && productLines.length > 0) {
        for (const line of productLines) {
          try {
            const dedRes = await inventoryService.recordSaleDeduction(tenantId, {
              productId: line.productId,
              locationId: resolvedLocationId,
              quantity: line.quantity,
              visitId: id,
              lineId: line.lineId,
              userId: req.auth?.userId || req.user?.id || null,
              userName: req.auth?.name || req.user?.name || recepcionista,
              txConn
            });
            if (dedRes && !dedRes.skipped && !dedRes.idempotent) {
              postCommitAlerts.push({ productId: line.productId, locationId: dedRes.location_id || resolvedLocationId });
            }
          } catch (invErr) {
            if (txConn) { try { await txConn.query('ROLLBACK'); } catch (_) { } }
            if (invErr.code === 'INSUFFICIENT_STOCK' || invErr.code === 'PRODUCT_ARCHIVED') {
              return res.status(400).json({
                error: invErr.message,
                code: invErr.code,
                product_id: line.productId
              });
            }
            if (invErr.code === 'NOT_FOUND') {
              return res.status(404).json({
                error: invErr.message,
                code: 'PRODUCT_NOT_FOUND',
                product_id: line.productId
              });
            }
            throw invErr;
          }
        }
      }

      // Hook controlado exclusivamente para pruebas de atomicidad/caída tras descuento de stock (requiere autorización explícita en entorno test)
      const allowTestFaultInjection =
        process.env.NODE_ENV === 'test' &&
        process.env.ALLOW_TEST_FAULT_INJECTION === 'true';
      if (allowTestFaultInjection && req.headers['x-test-fail-after-stock'] === 'true') {
        throw new Error('SIMULATED_PERSISTENCE_FAILURE_AFTER_STOCK');
      }
      if (allowTestFaultInjection && req.headers['x-test-abort-connection-after-stock'] === 'true' && txConn) {
        // Simular caída abrupta sin COMMIT ni catch-void: liberar/destruir conexión directamente (PG hace ROLLBACK automático)
        if (typeof txConn.release === 'function') {
          try { txConn.release(true); } catch (_) { try { txConn.release(); } catch (__) { } }
        }
        txConn = null;
        return res.status(503).json({ error: 'SIMULATED_PROCESS_CRASH_ABORT', code: 'SIMULATED_CRASH' });
      }

      // 8. Secuencia de comprobante atómica dentro de la transacción
      // Regla de producto:
      // - Comprobantes comerciales/NCF tradicionales (B01, B02, B14, B15, etc.) funcionan sin integración electrónica DGII.
      // - Comprobantes electrónicos e-CF (E31, E32, E33, E34, etc.) quedan bloqueados salvo que la integración e-CF esté contratada y habilitada.
      let assignedNcf = null;
      let assignedNcfName = null;
      const normalizedNcfType = String(ncf_type || '').trim().toUpperCase();
      const isElectronicType = /^E\d{2}$/i.test(normalizedNcfType);
      const dgiiEmissionEnabled =
        process.env.DGII_ENABLED === 'true' &&
        String(process.env.DGII_MODE || '').toLowerCase() !== 'disabled' &&
        String(process.env.DGII_ENV || '').toLowerCase() !== 'disabled';

      if (normalizedNcfType && normalizedNcfType !== 'NONE' && normalizedNcfType !== '00') {
        if (isElectronicType && !dgiiEmissionEnabled) {
          if (txConn) await txConn.query('ROLLBACK');
          return res.status(409).json({
            error: `La emisión de comprobantes electrónicos (${normalizedNcfType}) requiere la integración de facturación electrónica DGII contratada y habilitada por separado. Utilice un comprobante comercial/NCF tradicional (ej. B02, B01) o facture sin comprobante.`,
            code: 'NCF_ECF_INTEGRATION_REQUIRED',
            tipo_comprobante: normalizedNcfType,
          });
        }

        const [allTypeSeqs] = await db.query(
          `SELECT * FROM dgii_ncf_sequences
           WHERE tenant_id = ? AND tipo_comprobante = ?
           ORDER BY id ASC
           FOR UPDATE`,
          [tenantId, normalizedNcfType]
        );

        if (allTypeSeqs.length === 0) {
          if (txConn) await txConn.query('ROLLBACK');
          return res.status(409).json({
            error: `No existe una secuencia configurada para el comprobante ${normalizedNcfType}. Configure una secuencia válida o facture sin comprobante.`,
            code: 'NCF_SEQUENCE_NOT_CONFIGURED',
            tipo_comprobante: normalizedNcfType,
          });
        }

        const todayStr = new Date().toISOString().slice(0, 10);
        const activeSeqs = allTypeSeqs.filter((s) => s.estado === 'Activo' || s.estado === '1');
        const nonExpiredSeqs = activeSeqs.filter((s) => {
          if (!s.fecha_vencimiento) return true;
          const expStr = typeof s.fecha_vencimiento === 'string'
            ? s.fecha_vencimiento.slice(0, 10)
            : new Date(s.fecha_vencimiento).toISOString().slice(0, 10);
          return expStr >= todayStr;
        });
        const availableSeq = nonExpiredSeqs.find((s) => {
          const desde = Number(s.secuencia_desde || 1);
          const actual = Number(s.secuencia_actual || desde);
          const hasta = Number(s.secuencia_hasta || 0);
          return actual >= desde && actual <= hasta;
        });

        if (!availableSeq) {
          if (txConn) await txConn.query('ROLLBACK');
          if (activeSeqs.length > 0 && nonExpiredSeqs.length === 0) {
            return res.status(409).json({
              error: `La secuencia configurada para ${normalizedNcfType} está vencida. Registre una nueva secuencia vigente antes de facturar.`,
              code: 'NCF_SEQUENCE_EXPIRED',
              tipo_comprobante: normalizedNcfType,
            });
          }
          return res.status(409).json({
            error: `La secuencia configurada para ${normalizedNcfType} está agotada o inactiva. Registre un nuevo rango autorizado antes de facturar.`,
            code: 'NCF_SEQUENCE_EXHAUSTED',
            tipo_comprobante: normalizedNcfType,
          });
        }

        const nextNum = Number(availableSeq.secuencia_actual || availableSeq.secuencia_desde || 1);
        const maxNum = Number(availableSeq.secuencia_hasta || 0);
        const rawSerie = String(availableSeq.serie || availableSeq.tipo_comprobante || normalizedNcfType).trim().toUpperCase();
        const prefix = rawSerie.length <= 1 ? normalizedNcfType : rawSerie;
        const padLen = prefix.startsWith('E') ? 10 : 8;
        assignedNcf = `${prefix}${String(nextNum).padStart(padLen, '0')}`;
        assignedNcfName = availableSeq.nombre_comprobante || normalizedNcfType;

        const [dupNcf] = await db.query(
          'SELECT id FROM visits WHERE tenant_id = ? AND ncf = ? LIMIT 1',
          [tenantId, assignedNcf]
        );
        if (dupNcf.length > 0) {
          if (txConn) await txConn.query('ROLLBACK');
          return res.status(409).json({
            error: `El número de comprobante ${assignedNcf} ya fue asignado previamente en esta empresa.`,
            code: 'NCF_DUPLICATE_NUMBER',
            tipo_comprobante: normalizedNcfType,
          });
        }

        const newSecuenciaActual = nextNum + 1;
        const newCantidadUsada = Number(availableSeq.cantidad_usada || 0) + 1;
        const newEstado = (maxNum > 0 && newSecuenciaActual > maxNum) ? 'Agotado' : 'Activo';

        await db.query(
          `UPDATE dgii_ncf_sequences
           SET secuencia_actual = ?, cantidad_usada = ?, estado = ?
           WHERE id = ? AND tenant_id = ?`,
          [newSecuenciaActual, newCantidadUsada, newEstado, availableSeq.id, tenantId]
        );
      }

      // 9. Persistencia de la venta (visits) con unidades menores exactas
      const numSubtotal = Number(subtotal) || 0;
      const numDescuento = parsedDescuento;
      const numTotal = Number(total) || 0;
      const subtotalCents = Math.round(numSubtotal * 100);
      const discountCents = Math.round(numDescuento * 100);
      const totalCents = Math.round(numTotal * 100);
      const appliedPaymentsJson = JSON.stringify(
        buildCanonicalAppliedPayments({
          applied_payments: req.body?.applied_payments,
          pago_efectivo,
          pago_tarjeta,
          pago_transferencia,
          metodo_pago,
          total_cents: totalCents,
          total: numTotal,
        })
      );

      if (txExisting.length > 0) {
        await db.query(
          `UPDATE visits SET
             client_id = COALESCE(?, client_id),
             client_name = COALESCE(?, client_name),
             salon_id = COALESCE(?, salon_id),
             servicios = ?,
             items_detail = ?,
             subtotal = ?,
             subtotal_cents = ?,
             descuento = ?,
             discount_cents = ?,
             total = ?,
             total_cents = ?,
             currency = 'DOP',
             metodo_pago = ?,
             applied_payments = ?::jsonb,
             ncf = COALESCE(?, ncf),
             ncf_type = COALESCE(?, ncf_type),
             ncf_name = COALESCE(?, ncf_name),
             rnc_cliente = COALESCE(?, rnc_cliente),
             rzn_soc_cliente = COALESCE(?, rzn_soc_cliente),
             empleado_peluquera = COALESCE(?, empleado_peluquera),
             empleado_lava_pelo = COALESCE(?, empleado_lava_pelo),
             empleado_manicurista = COALESCE(?, empleado_manicurista),
             cash_register_id = COALESCE(?, cash_register_id),
             status = 'Facturado',
             visited_at = NOW()
           WHERE id = ? AND tenant_id = ?`,
          [
            client_id || null,
            client_name || null,
            String(salon_id),
            serializedServices,
            serializedItems,
            numSubtotal,
            subtotalCents,
            numDescuento,
            discountCents,
            numTotal,
            totalCents,
            metodo_pago,
            appliedPaymentsJson,
            assignedNcf,
            ncf_type || null,
            assignedNcfName,
            rnc_cliente || null,
            rzn_soc_cliente || null,
            empleado_peluquera || null,
            empleado_lava_pelo || null,
            empleado_manicurista || null,
            activeRegisterId ? String(activeRegisterId) : null,
            id,
            tenantId
          ]
        );
      } else {
        await db.query(
          `INSERT INTO visits (
             id, tenant_id, ticket_number, client_id, client_name, salon_id,
             servicios, items_detail, subtotal, subtotal_cents, descuento, discount_cents, total, total_cents, currency,
             metodo_pago, applied_payments,
             ncf, ncf_type, ncf_name, rnc_cliente, rzn_soc_cliente,
             empleado_peluquera, empleado_lava_pelo, empleado_manicurista,
             cash_register_id, status, visited_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DOP', ?, ?::jsonb, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Facturado', NOW())`,
          [
            id,
            tenantId,
            ticketNumber,
            client_id || null,
            client_name || 'Cliente General',
            String(salon_id),
            serializedServices,
            serializedItems,
            numSubtotal,
            subtotalCents,
            numDescuento,
            discountCents,
            numTotal,
            totalCents,
            metodo_pago,
            appliedPaymentsJson,
            assignedNcf,
            ncf_type || null,
            assignedNcfName,
            rnc_cliente || null,
            rzn_soc_cliente || null,
            empleado_peluquera || 'No asignada',
            empleado_lava_pelo || 'No asignada',
            empleado_manicurista || 'No asignada',
            activeRegisterId ? String(activeRegisterId) : null
          ]
        );
      }

      // 10. Deduct Plan Beauty washes if applicable
      const targetClientId = client_id || existingRows[0]?.client_id;
      const washesToDeduct = Number(wash_count_to_consume) || (consume_wash ? 1 : 0);
      if (targetClientId && washesToDeduct > 0) {
        const [contracts] = await db.query(
          "SELECT * FROM contracts WHERE client_id = ? AND tenant_id = ? AND status IN ('Active', 'Activo') ORDER BY signed_at DESC LIMIT 1 FOR UPDATE",
          [targetClientId, tenantId]
        );
        if (contracts.length > 0) {
          const cn = contracts[0];
          const quota = Number(cn.wash_Quota || cn.wash_quota || 4);
          const used = Number(cn.washes_used || 0);
          const available = Math.max(0, quota - used);
          if (available > 0) {
            const actualDeduct = Math.min(available, washesToDeduct);
            await db.query(
              'UPDATE contracts SET washes_used = washes_used + ? WHERE id = ? AND tenant_id = ?',
              [actualDeduct, cn.id, tenantId]
            );
          }
        }
      }

      // 11. Comisiones del empleado dentro de la MISMA transacción
      await processVisitCommissions(id, serializedItems, ticketNumber, new Date(), tenantId, db);

      // 12. COMMIT ATÓMICO ÚNICO
      if (txConn) {
        await txConn.query('COMMIT');
      }

      // Post-commit non-transactional side effects (alerts & survey email)
      if (inventoryService && postCommitAlerts.length > 0 && typeof inventoryService.evaluateLowStockAlert === 'function') {
        for (const a of postCommitAlerts) {
          inventoryService.evaluateLowStockAlert(tenantId, a.productId, a.locationId).catch(() => { });
        }
      }
      if (targetClientId && typeof sendSurveyEmail === 'function') {
        sendSurveyEmail(pool, targetClientId, client_name, null, tenantId).catch(() => { });
      }

      res.json({
        success: true,
        id,
        ticket_number: ticketNumber,
        cash_register_id: activeRegisterId || null,
        total: numTotal,
        total_cents: totalCents,
        currency: 'DOP',
        ncf: assignedNcf,
        ncf_name: assignedNcfName,
        status: 'Facturado'
      });
    } catch (err) {
      if (txConn) {
        try { await txConn.query('ROLLBACK'); } catch (_) { }
      }
      console.error('[CHECKOUT TICKET ERROR]:', err);
      res.status(500).json({ error: err.message });
    } finally {
      if (txConn) {
        try { txConn.release(); } catch (_) { }
      }
    }
  });

  // 8. POST /api/visits - Direct visit creation within the authenticated tenant
  router.post('/', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const {
        id,
        client_id,
        clientId,
        client_name,
        clientName,
        salon_id = 1,
        servicios = [],
        items_detail = [],
        total = 0,
        metodo_pago = 'Efectivo',
        status = 'Facturado',
        empleado_peluquera = 'No asignada',
        empleado_lava_pelo = 'No asignada',
        empleado_manicurista = 'No asignada',
        recepcionista = 'Recepción'
      } = req.body;
      if (!isBranchAuthorized(req, salon_id)) {
        return res.status(403).json({
          error: 'No tienes autorización para registrar visitas en esta sucursal.',
          code: 'BRANCH_ACCESS_DENIED'
        });
      }

      const visitId = id || `VIS-${Date.now()}`;
      const ticketNumber = await getNextTicketNumber(salon_id, tenantId);
      const serializedServices = typeof servicios === 'string' ? servicios : JSON.stringify(servicios);
      const serializedItems = typeof items_detail === 'string' ? items_detail : JSON.stringify(items_detail);

      await pool.query(
        `INSERT INTO visits (
           id, tenant_id, ticket_number, client_id, client_name, salon_id,
           servicios, items_detail, total, metodo_pago, status,
           empleado_peluquera, empleado_lava_pelo, empleado_manicurista, recepcionista, visited_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          visitId,
          tenantId,
          ticketNumber,
          client_id || clientId || null,
          client_name || clientName || 'Cliente General',
          salon_id,
          serializedServices,
          serializedItems,
          Number(total) || 0,
          metodo_pago,
          status,
          empleado_peluquera,
          empleado_lava_pelo,
          empleado_manicurista,
          recepcionista
        ]
      );

      if (status === 'Facturado') {
        await processVisitCommissions(visitId, serializedItems, ticketNumber, new Date(), tenantId);

        if (inventoryService) {
          const rawItems = typeof serializedItems === 'string' ? JSON.parse(serializedItems) : (items_detail || []);
          if (Array.isArray(rawItems)) {
            for (const [idx, it] of rawItems.entries()) {
              const isProduct = it.tipo_item === 'Producto' || it.is_product || Boolean(it.product_id);
              if (isProduct) {
                const pId = it.product_id || it.id;
                const q = Number(it.cantidad || it.qty || it.quantity || 1);
                if (pId && q > 0) {
                  try {
                    await inventoryService.recordSaleDeduction(tenantId, {
                      productId: pId,
                      locationId: null,
                      quantity: q,
                      visitId,
                      lineId: idx,
                      userId: req.user?.id || null,
                      userName: recepcionista
                    });
                  } catch (invErr) {
                    console.error('[INVENTORY DIRECT SALE DEDUCTION ERROR]:', invErr.message);
                  }
                }
              }
            }
          }
        }
      }

      res.json({ id: visitId, ticket_number: ticketNumber, success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 9. POST /api/visits/:id/void - Void an invoice / visit within the authenticated tenant (REM-P1-06)
  router.post('/:id/void', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const { reason = 'Anulación de factura' } = req.body || {};

      // -------------------------------------------------------------
      // Autorización de Supervisor o Validación de PIN Maestro/OTP (REM-P1-06)
      // -------------------------------------------------------------
      const actorRole = String(req.auth?.role || req.headers['x-user-role'] || '').toLowerCase();
      const isPrivileged = actorRole === 'propietario' || actorRole === 'owner' || actorRole === 'admin' || Boolean(req.auth?.isSuperAdmin) || permissionMapGrants(req.auth?.permissions, 'pos.invoices.void');

      const providedPin = req.body?.admin_pin || req.body?.supervisor_pin || req.body?.pin || req.headers['x-admin-pin'];

      if (!isPrivileged) {
        if (!providedPin) {
          return res.status(403).json({
            error: 'Se requiere autorización de supervisor o PIN de administrador para anular facturas.',
            code: 'SUPERVISOR_PIN_REQUIRED'
          });
        }

        const [secRows] = await pool.query(
          'SELECT admin_pin, admin_pin_hash, active_otp_pin, otp_expires_at FROM security_settings WHERE tenant_id = ? LIMIT 1',
          [tenantId]
        );
        if (!secRows || secRows.length === 0) {
          return res.status(401).json({
            error: 'No hay PIN de seguridad configurado para esta empresa.',
            code: 'PIN_NOT_CONFIGURED'
          });
        }

        const sec = secRows[0];
        const isOtpValid = sec.active_otp_pin && (String(providedPin) === String(sec.active_otp_pin)) && sec.otp_expires_at && (new Date(sec.otp_expires_at) > new Date());
        let isMasterValid = false;

        const storedMaster = sec.admin_pin_hash || sec.admin_pin;
        if (storedMaster) {
          const { verifyPin } = require('../services/pin_security.service');
          const verifyRes = await verifyPin(String(providedPin), storedMaster);
          isMasterValid = verifyRes.matched;
        }

        if (!isMasterValid && !isOtpValid) {
          return res.status(401).json({
            error: 'PIN de supervisor o administrador incorrecto.',
            code: 'INVALID_ADMIN_PIN'
          });
        }
      }

      const effectiveVoidedBy = req.auth?.name || req.auth?.email || req.headers['x-user-name'] || req.body?.voided_by || 'Supervisor Autorizado';

      const [existing] = await pool.query(
        'SELECT id, status, total, salon_id, cash_register_id, metodo_pago FROM visits WHERE id = ? AND tenant_id = ? LIMIT 1',
        [id, tenantId]
      );
      if (existing.length === 0) {
        return res.status(404).json({ error: 'Factura no encontrada en esta empresa.' });
      }

      const currentStatus = String(existing[0].status || '').trim();
      if (currentStatus === 'Anulado' || currentStatus === 'Anulada') {
        return res.status(409).json({
          error: 'La factura ya ha sido anulada previamente.',
          code: 'ALREADY_VOIDED'
        });
      }

      await pool.query(
        "UPDATE visits SET status = 'Anulado', void_reason = ?, voided_by = ?, voided_at = NOW() WHERE id = ? AND tenant_id = ?",
        [reason, effectiveVoidedBy, id, tenantId]
      );

      await pool.query(
        "UPDATE employee_commissions_log SET status = 'Anulada' WHERE visit_id = ? AND tenant_id = ?",
        [id, tenantId]
      );

      await pool.query(
        "UPDATE employee_discounts SET status = 'Anulado' WHERE visit_id = ? AND tenant_id = ?",
        [id, tenantId]
      );

      // Registro auditado de reversión en caja (type = 'anulacion_venta' para preservar trazabilidad sin doble descuento)
      if (existing[0].cash_register_id) {
        try {
          const refundAmount = Number(existing[0].total || 0);
          if (refundAmount > 0) {
            await pool.query(
              `INSERT INTO cash_register_movements (
                 tenant_id, cash_register_id, type, payment_method, amount, amount_cents, currency, concept, user_name, visit_id, created_at
               ) VALUES (?, ?, 'anulacion_venta', ?, ?, ?, 'DOP', ?, ?, ?, NOW())`,
              [
                tenantId,
                String(existing[0].cash_register_id),
                existing[0].metodo_pago || 'Efectivo',
                refundAmount,
                Math.round(refundAmount * 100),
                `Reversión por anulación de factura #${id}: ${reason}`,
                effectiveVoidedBy,
                String(id)
              ]
            );
          }
        } catch (crErr) {
          console.error('[CASH REGISTER VOID REVERSAL ERROR]:', crErr.message);
        }
      }

      try {
        await pool.query(
          `INSERT INTO invoice_audit_logs (tenant_id, visit_id, action, reason, user_name, created_at)
           VALUES (?, ?, 'VOID', ?, ?, NOW())`,
          [tenantId, id, reason, effectiveVoidedBy]
        );
      } catch (e) { }

      // === REVERSIÓN DE INVENTARIO POR ANULACIÓN DE VENTA (PASO 11) ===
      if (inventoryService) {
        try {
          const [visitRows] = await pool.query('SELECT items_detail, servicios, salon_id FROM visits WHERE id = ? AND tenant_id = ? LIMIT 1', [id, tenantId]);
          if (visitRows && visitRows.length > 0) {
            const row = visitRows[0];
            let rawItems = [];
            try {
              if (row.items_detail) rawItems = typeof row.items_detail === 'string' ? JSON.parse(row.items_detail) : row.items_detail;
              else if (row.servicios) rawItems = typeof row.servicios === 'string' ? JSON.parse(row.servicios) : row.servicios;
            } catch (e) { }

            if (Array.isArray(rawItems)) {
              let fallbackVoidLocId = null;
              for (const [idx, it] of rawItems.entries()) {
                const isProduct = String(it.tipo_item || it.item_type || '').toUpperCase() === 'PRODUCTO' || it.is_product || Boolean(it.product_id);
                if (isProduct) {
                  const pId = it.product_id || it.id;
                  const q = Number(it.cantidad || it.qty || it.quantity || 1);
                  if (pId && q > 0) {
                    // Always restore to the exact location_id where the original SALE movement was deducted
                    const [origSaleMov] = await pool.query(
                      "SELECT location_id FROM inventory_movements WHERE tenant_id = ? AND reference_id = ? AND product_id = ? AND movement_type = 'SALE' ORDER BY created_at DESC LIMIT 1",
                      [tenantId, String(id), pId]
                    );
                    let voidLocId = origSaleMov && origSaleMov[0] ? origSaleMov[0].location_id : null;
                    if (!voidLocId) {
                      if (!fallbackVoidLocId) {
                        const branchLoc = await inventoryService.getDefaultLocation(tenantId, row.salon_id || existing[0].salon_id || null);
                        fallbackVoidLocId = branchLoc?.id || null;
                      }
                      voidLocId = fallbackVoidLocId;
                    }
                    await inventoryService.recordSaleVoid(tenantId, {
                      productId: pId,
                      locationId: voidLocId,
                      quantity: q,
                      visitId: id,
                      lineId: idx,
                      userId: req.auth?.userId || req.user?.id || null,
                      userName: effectiveVoidedBy,
                      reason
                    });
                  }
                }
              }
            }
          }
        } catch (invVoidErr) {
          console.error('[INVENTORY VOID ERROR] Error revirtiendo inventario en anulación:', invVoidErr);
        }
      }

      res.json({ success: true, message: 'Factura anulada exitosamente' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 10. PUT /api/visits/:id/commission-recipient - Reassign commission stylist on an invoice within the authenticated tenant
  router.put('/:id/commission-recipient', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const { empleado_peluquera, empleado_manicurista, empleado_lava_pelo, items_detail, reason = 'Reasignación de comisionista', user_name = 'Admin' } = req.body;

      const [existing] = await pool.query('SELECT * FROM visits WHERE id = ? AND tenant_id = ? LIMIT 1', [id, tenantId]);
      if (existing.length === 0) {
        return res.status(404).json({ error: 'Factura no encontrada en esta empresa.' });
      }

      await pool.query(
        `UPDATE visits SET
           empleado_peluquera = COALESCE(?, empleado_peluquera),
           empleado_manicurista = COALESCE(?, empleado_manicurista),
           empleado_lava_pelo = COALESCE(?, empleado_lava_pelo),
           items_detail = COALESCE(?, items_detail)
         WHERE id = ? AND tenant_id = ?`,
        [
          empleado_peluquera || null,
          empleado_manicurista || null,
          empleado_lava_pelo || null,
          items_detail ? (typeof items_detail === 'string' ? items_detail : JSON.stringify(items_detail)) : null,
          id,
          tenantId
        ]
      );

      const [updated] = await pool.query('SELECT * FROM visits WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      if (updated.length > 0) {
        await processVisitCommissions(id, updated[0].items_detail, updated[0].ticket_number, updated[0].visited_at, tenantId);
      }

      try {
        await pool.query(
          `INSERT INTO invoice_audit_logs (tenant_id, visit_id, action, reason, user_name, created_at)
           VALUES (?, ?, 'REASSIGN_COMMISSION', ?, ?, NOW())`,
          [tenantId, id, reason, user_name]
        );
      } catch (e) { }

      res.json({ success: true, message: 'Comisionista actualizado correctamente' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 11. GET /api/visits/:id/audit - Get audit logs for a visit within the authenticated tenant
  router.get('/:id/audit', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const [visitCheck] = await pool.query('SELECT id FROM visits WHERE id = ? AND tenant_id = ? LIMIT 1', [id, tenantId]);
      if (visitCheck.length === 0) {
        return res.status(404).json({ error: 'Visita no encontrada' });
      }
      const [rows] = await pool.query('SELECT * FROM invoice_audit_logs WHERE tenant_id = ? AND visit_id = ? ORDER BY created_at DESC', [tenantId, id]);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 12. POST /api/visits/:id/cancel - Cancelar un ticket pendiente antes de facturar conservando trazabilidad (motivo, usuario, fecha)
  router.post('/:id/cancel', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const { reason = 'Cancelado en recepción antes de facturar' } = req.body || {};
      const actorName = req.auth?.name || req.auth?.email || req.headers['x-user-name'] || req.body?.cancelled_by || 'Recepción';

      const [existing] = await pool.query(
        'SELECT id, status, salon_id, ncf FROM visits WHERE id = ? AND tenant_id = ? LIMIT 1',
        [id, tenantId]
      );
      if (!existing || existing.length === 0) {
        return res.status(404).json({ error: 'Ticket no encontrado en esta empresa.', code: 'TICKET_NOT_FOUND' });
      }
      if (existing[0].salon_id && !isBranchAuthorized(req, existing[0].salon_id)) {
        return res.status(403).json({ error: 'No tienes autorización para cancelar tickets en esta sucursal.', code: 'BRANCH_ACCESS_DENIED' });
      }
      const curStatus = String(existing[0].status || '').trim();
      if (curStatus === 'Facturado') {
        return res.status(409).json({
          error: 'Este ticket ya fue facturado. Utiliza la opción de anulación de factura.',
          code: 'ALREADY_INVOICED'
        });
      }

      await pool.query(
        "UPDATE visits SET status = 'Cancelado', void_reason = ?, voided_by = ?, voided_at = NOW() WHERE id = ? AND tenant_id = ?",
        [String(reason).trim(), actorName, id, tenantId]
      );
      res.json({ success: true, id, status: 'Cancelado', reason: String(reason).trim(), cancelled_by: actorName });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 12b. DELETE /api/visits/:id & POST /api/visits/:id/delete - Delete pending ticket within the authenticated tenant
  const handleDeleteVisit = async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const [result] = await pool.query('DELETE FROM visits WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Visita no encontrada' });
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
  router.delete('/:id', handleDeleteVisit);
  router.post('/:id/delete', handleDeleteVisit);

  // 13. Clear all pending tickets within the authenticated tenant
  const handleClearPending = async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const salonId = req.query.salon_id || req.body?.salon_id || 'all';
      if (salonId && salonId !== 'all') {
        await pool.query(
          "DELETE FROM visits WHERE tenant_id = ? AND status IN ('Pendiente', 'Abierto', 'En Proceso') AND salon_id::text = ?",
          [tenantId, String(salonId)]
        );
      } else {
        await pool.query(
          "DELETE FROM visits WHERE tenant_id = ? AND status IN ('Pendiente', 'Abierto', 'En Proceso')",
          [tenantId]
        );
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
  router.delete('/pending/all', handleClearPending);
  router.post('/pending/clear-all', handleClearPending);

  return { router, processVisitCommissions, processBatchVisitCommissions };
}

module.exports = { createVisitsRouter };
