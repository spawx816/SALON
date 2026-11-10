const express = require('express');
const { createQuarantineGuard } = require('../middleware/quarantine.middleware.cjs');
const { createIdempotencyMiddleware } = require('../middleware/idempotency.middleware.cjs');

function createVisitsRouter(pool, helpers = {}) {
  const router = express.Router();
  const { sendSurveyEmail, inventoryService } = helpers;

  // Fail-Closed Quarantine Protection Guard on Visits
  router.use('/:id', createQuarantineGuard(pool, 'visits', 'id'));

  // Multi-Tenant Financial Idempotency Guard (charges, checkouts, voids)
  router.use(createIdempotencyMiddleware());

  // Helper: Generate sequential ticket number per branch within the tenant
  const getNextTicketNumber = async (salonId = 1, tenantId = null) => {
    const cleanSalonId = String(salonId || '1');
    const prefix = (cleanSalonId === '2' || cleanSalonId === '4') ? 'VM' : 'SD';
    try {
      const [rows] = await pool.query(
        'SELECT last_number FROM ticket_sequences WHERE tenant_id = ? AND salon_id = ? LIMIT 1',
        [tenantId, cleanSalonId]
      );
      let nextNum = 1;
      if (rows.length > 0) {
        nextNum = (parseInt(rows[0].last_number) || 0) + 1;
        await pool.query(
          'UPDATE ticket_sequences SET last_number = ? WHERE tenant_id = ? AND salon_id = ?',
          [nextNum, tenantId, cleanSalonId]
        );
      } else {
        const [maxRows] = await pool.query(
          'SELECT COUNT(*) as cnt FROM visits WHERE tenant_id = ? AND salon_id::text = ?',
          [tenantId, cleanSalonId]
        );
        nextNum = (parseInt(maxRows[0]?.cnt) || 0) + 1;
        await pool.query(
          'INSERT INTO ticket_sequences (tenant_id, salon_id, prefix, last_number) VALUES (?, ?, ?, ?) ON CONFLICT (tenant_id, salon_id) DO UPDATE SET last_number = EXCLUDED.last_number',
          [tenantId, cleanSalonId, prefix, nextNum]
        );
      }
      return `${prefix}-${String(nextNum).padStart(5, '0')}`;
    } catch (e) {
      return `${prefix}-${Date.now().toString().slice(-5)}`;
    }
  };

  // Helper: Batch calculate and persist employee commissions for visits (O(1) database queries, no N+1)
  const processBatchVisitCommissions = async (visits, tenantId) => {
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
      await pool.query(
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

        const [staffRows] = await pool.query(
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
        const [serviceRows] = await pool.query(
          `SELECT id, COALESCE(nombre, name) as service_name, comision_valor, tipo_comision, tenant_id 
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

        let pct = 15;
        let montoComision = Math.round(item.precioBase * (pct / 100) * 100) / 100;

        const srvKey = item.serviceName.trim().toLowerCase();
        if (serviceMap.has(srvKey)) {
          const srv = serviceMap.get(srvKey);
          if (srv.comision_valor && Number(srv.comision_valor) > 0) {
            if (srv.tipo_comision === 'Monto Fijo') {
              montoComision = Math.round(Number(srv.comision_valor) * item.cantidad * 100) / 100;
              pct = 0;
            } else {
              pct = Number(srv.comision_valor);
              montoComision = Math.round(item.precioBase * (pct / 100) * 100) / 100;
            }
          }
        }

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
          'Pendiente',
          emp.localidad || 'Principal',
          item.visitedAt
        ]);
      }

      // Query 4: Multi-row chunked INSERT (up to 250 rows per statement)
      const chunkSize = 250;
      for (let i = 0; i < insertRows.length; i += chunkSize) {
        const chunk = insertRows.slice(i, i + chunkSize);
        const rowPlaceholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        const flatParams = chunk.flat();

        await pool.query(
          `INSERT INTO employee_commissions_log (
             tenant_id, visit_id, ticket_number, employee_id, employee_name, service_name,
             precio_servicio, commission_rate, monto_comision, status, localidad, created_at
           ) VALUES ${rowPlaceholders}`,
          flatParams
        );
      }

      return { processed: visits.length, items: insertRows.length };
    } catch (err) {
      console.warn('[PROCESS BATCH COMMISSIONS WARN]:', err.message);
      return { error: err.message };
    }
  };

  // Single-visit helper delegates to the batch processor
  const processVisitCommissions = async (visitId, itemsDetailRaw, ticketNumber, visitedAt, tenantId) => {
    return processBatchVisitCommissions([{
      id: visitId,
      items_detail: itemsDetailRaw,
      ticket_number: ticketNumber,
      visited_at: visitedAt
    }], tenantId);
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

      if (salon_id && salon_id !== 'all') {
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
      let query = `
        SELECT v.*,
               COALESCE(v.client_name, c.nombre, 'Cliente General') as client_name,
               c.cedula as client_cedula,
               c.telefono as client_phone
        FROM visits v
        LEFT JOIN clients c ON v.client_id = c.id AND c.tenant_id = v.tenant_id
        WHERE v.tenant_id = ? AND v.status IN ('Pendiente', 'Abierto', 'En Proceso', 'Pre-cuenta')
      `;
      const params = [tenantId];

      if (salon_id && salon_id !== 'all') {
        query += ' AND (v.salon_id::text = ? OR v.salon_id IS NULL)';
        params.push(String(salon_id));
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
  router.post('/ticket', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const {
        client_id,
        clientId,
        client_name,
        clientName,
        salon_id = 1,
        salonId,
        servicios = [],
        items_detail = [],
        total = 0,
        recepcionista = 'Recepción',
        empleado_peluquera = 'No asignada',
        empleado_lava_pelo = 'No asignada',
        empleado_manicurista = 'No asignada',
        notes = ''
      } = req.body;

      const targetSalon = salon_id || salonId || 1;
      const targetClient = client_id || clientId || null;
      const targetClientName = client_name || clientName || 'Cliente General';
      const visitId = `VIS-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
      const ticketNumber = await getNextTicketNumber(targetSalon, tenantId);

      await pool.query(
        `INSERT INTO visits (
           id, tenant_id, ticket_number, client_id, client_name, salon_id,
           servicios, items_detail, total, status, recepcionista,
           empleado_peluquera, empleado_lava_pelo, empleado_manicurista, notes, visited_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pendiente', ?, ?, ?, ?, ?, NOW())`,
        [
          visitId,
          tenantId,
          ticketNumber,
          targetClient,
          targetClientName,
          targetSalon,
          JSON.stringify(Array.isArray(servicios) ? servicios : []),
          JSON.stringify(Array.isArray(items_detail) ? items_detail : []),
          Number(total) || 0,
          recepcionista,
          empleado_peluquera,
          empleado_lava_pelo,
          empleado_manicurista,
          notes
        ]
      );

      res.json({
        success: true,
        id: visitId,
        ticket_number: ticketNumber,
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
        total,
        empleado_peluquera,
        empleado_lava_pelo,
        empleado_manicurista,
        recepcionista,
        notes
      } = req.body;

      await pool.query(
        `UPDATE visits SET
           client_id = COALESCE(?, client_id),
           client_name = COALESCE(?, client_name),
           servicios = COALESCE(?, servicios),
           items_detail = COALESCE(?, items_detail),
           total = COALESCE(?, total),
           empleado_peluquera = COALESCE(?, empleado_peluquera),
           empleado_lava_pelo = COALESCE(?, empleado_lava_pelo),
           empleado_manicurista = COALESCE(?, empleado_manicurista),
           recepcionista = COALESCE(?, recepcionista),
           notes = COALESCE(?, notes)
         WHERE id = ? AND tenant_id = ?`,
        [
          client_id !== undefined ? client_id : null,
          client_name !== undefined ? client_name : null,
          servicios !== undefined ? (typeof servicios === 'string' ? servicios : JSON.stringify(servicios)) : null,
          items_detail !== undefined ? (typeof items_detail === 'string' ? items_detail : JSON.stringify(items_detail)) : null,
          total !== undefined ? Number(total) : null,
          empleado_peluquera !== undefined ? empleado_peluquera : null,
          empleado_lava_pelo !== undefined ? empleado_lava_pelo : null,
          empleado_manicurista !== undefined ? empleado_manicurista : null,
          recepcionista !== undefined ? recepcionista : null,
          notes !== undefined ? notes : null,
          id,
          tenantId
        ]
      );

      res.json({ success: true, id });
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
        cash_register_id = null
      } = req.body;

      // Resolve active cash register within this tenant if not passed explicitly
      let activeRegisterId = cash_register_id;
      if (!activeRegisterId) {
        const [regRows] = await pool.query(
          "SELECT id FROM cash_registers WHERE tenant_id = ? AND status = 'Abierta' ORDER BY opened_at DESC LIMIT 1",
          [tenantId]
        );
        if (regRows.length > 0) activeRegisterId = regRows[0].id;
      }

      // Generate NCF if requested within this tenant
      let assignedNcf = null;
      let assignedNcfName = null;
      if (ncf_type && ncf_type !== 'none' && ncf_type !== '00') {
        const [seqRows] = await pool.query(
          'SELECT * FROM dgii_ncf_sequences WHERE tenant_id = ? AND type_code = ? AND is_active = 1 LIMIT 1',
          [tenantId, ncf_type]
        );
        if (seqRows.length > 0) {
          const seq = seqRows[0];
          const nextNum = Number(seq.current_number || 1);
          const padLen = String(seq.prefix || '').startsWith('E') ? 10 : 8;
          assignedNcf = `${seq.prefix}${String(nextNum).padStart(padLen, '0')}`;
          assignedNcfName = seq.name;

          await pool.query(
            'UPDATE dgii_ncf_sequences SET current_number = current_number + 1 WHERE id = ? AND tenant_id = ?',
            [seq.id, tenantId]
          );
        }
      }

      const [existingRows] = await pool.query('SELECT * FROM visits WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      let ticketNumber = existingRows[0]?.ticket_number;
      if (!ticketNumber) {
        ticketNumber = await getNextTicketNumber(salon_id, tenantId);
      }

      const serializedServices = typeof servicios === 'string' ? servicios : JSON.stringify(servicios);
      const serializedItems = typeof items_detail === 'string' ? items_detail : JSON.stringify(items_detail);

      // === INTEGRACIÓN DE INVENTARIO MULTI-TENANT REAL (PASO 11) ===
      if (inventoryService) {
        const rawItems = Array.isArray(items_detail) && items_detail.length > 0
          ? items_detail
          : (Array.isArray(servicios) ? servicios : []);

        const productLines = [];
        for (const [idx, it] of rawItems.entries()) {
          const isProduct = it.tipo_item === 'Producto' || it.is_product || Boolean(it.product_id);
          if (isProduct) {
            const pId = it.product_id || it.id;
            const q = Number(it.cantidad || it.qty || it.quantity || 1);
            if (pId && q > 0) {
              productLines.push({ productId: pId, quantity: q, lineId: idx });
            }
          }
        }

        // Si hay líneas de productos físicos con stock, descontar antes de confirmar la venta
        for (const line of productLines) {
          try {
            await inventoryService.recordSaleDeduction(tenantId, {
              productId: line.productId,
              locationId: null,
              quantity: line.quantity,
              visitId: id,
              lineId: line.lineId,
              userId: req.user?.id || null,
              userName: req.user?.name || recepcionista
            });
          } catch (invErr) {
            if (invErr.code === 'INSUFFICIENT_STOCK') {
              return res.status(400).json({
                error: invErr.message,
                code: 'INSUFFICIENT_STOCK',
                product_id: line.productId
              });
            }
            throw invErr;
          }
        }
      }

      if (existingRows.length > 0) {
        await pool.query(
          `UPDATE visits SET
             client_id = COALESCE(?, client_id),
             client_name = COALESCE(?, client_name),
             salon_id = COALESCE(?, salon_id),
             servicios = ?,
             items_detail = ?,
             subtotal = ?,
             descuento = ?,
             total = ?,
             metodo_pago = ?,
             pago_efectivo = ?,
             pago_tarjeta = ?,
             pago_transferencia = ?,
             ncf = COALESCE(?, ncf),
             ncf_type = COALESCE(?, ncf_type),
             ncf_name = COALESCE(?, ncf_name),
             rnc_cliente = COALESCE(?, rnc_cliente),
             rzn_soc_cliente = COALESCE(?, rzn_soc_cliente),
             empleado_peluquera = COALESCE(?, empleado_peluquera),
             empleado_lava_pelo = COALESCE(?, empleado_lava_pelo),
             empleado_manicurista = COALESCE(?, empleado_manicurista),
             recepcionista = COALESCE(?, recepcionista),
             cash_register_id = COALESCE(?, cash_register_id),
             status = 'Facturado',
             visited_at = NOW()
           WHERE id = ? AND tenant_id = ?`,
          [
            client_id || null,
            client_name || null,
            salon_id,
            serializedServices,
            serializedItems,
            Number(subtotal) || 0,
            Number(descuento) || 0,
            Number(total) || 0,
            metodo_pago,
            Number(pago_efectivo) || 0,
            Number(pago_tarjeta) || 0,
            Number(pago_transferencia) || 0,
            assignedNcf,
            ncf_type || null,
            assignedNcfName,
            rnc_cliente || null,
            rzn_soc_cliente || null,
            empleado_peluquera || null,
            empleado_lava_pelo || null,
            empleado_manicurista || null,
            recepcionista,
            activeRegisterId,
            id,
            tenantId
          ]
        );
      } else {
        await pool.query(
          `INSERT INTO visits (
             id, tenant_id, ticket_number, client_id, client_name, salon_id,
             servicios, items_detail, subtotal, descuento, total,
             metodo_pago, pago_efectivo, pago_tarjeta, pago_transferencia,
             ncf, ncf_type, ncf_name, rnc_cliente, rzn_soc_cliente,
             empleado_peluquera, empleado_lava_pelo, empleado_manicurista, recepcionista,
             cash_register_id, status, visited_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Facturado', NOW())`,
          [
            id,
            tenantId,
            ticketNumber,
            client_id || null,
            client_name || 'Cliente General',
            salon_id,
            serializedServices,
            serializedItems,
            Number(subtotal) || 0,
            Number(descuento) || 0,
            Number(total) || 0,
            metodo_pago,
            Number(pago_efectivo) || 0,
            Number(pago_tarjeta) || 0,
            Number(pago_transferencia) || 0,
            assignedNcf,
            ncf_type || null,
            assignedNcfName,
            rnc_cliente || null,
            rzn_soc_cliente || null,
            empleado_peluquera || 'No asignada',
            empleado_lava_pelo || 'No asignada',
            empleado_manicurista || 'No asignada',
            recepcionista,
            activeRegisterId
          ]
        );
      }

      // Deduct Plan Beauty washes if applicable (strictly respecting the 4-wash rule and 0-benefit validation)
      const targetClientId = client_id || existingRows[0]?.client_id;
      const washesToDeduct = Number(wash_count_to_consume) || (consume_wash ? 1 : 0);
      if (targetClientId && washesToDeduct > 0) {
        const [contracts] = await pool.query(
          "SELECT * FROM contracts WHERE client_id = ? AND tenant_id = ? AND status IN ('Active', 'Activo') ORDER BY signed_at DESC LIMIT 1",
          [targetClientId, tenantId]
        );
        if (contracts.length > 0) {
          const cn = contracts[0];
          const quota = Number(cn.wash_Quota || cn.wash_quota || 4);
          const used = Number(cn.washes_used || 0);
          const available = Math.max(0, quota - used);
          if (available > 0) {
            const actualDeduct = Math.min(available, washesToDeduct);
            await pool.query(
              'UPDATE contracts SET washes_used = washes_used + ? WHERE id = ? AND tenant_id = ?',
              [actualDeduct, cn.id, tenantId]
            );
          }
        }
      }

      // Process employee commissions scoped to tenant
      await processVisitCommissions(id, serializedItems, ticketNumber, new Date(), tenantId);

      // Trigger satisfaction survey email asynchronously if client exists
      if (targetClientId && typeof sendSurveyEmail === 'function') {
        sendSurveyEmail(pool, targetClientId, client_name, null, tenantId).catch(() => {});
      }

      res.json({
        success: true,
        id,
        ticket_number: ticketNumber,
        ncf: assignedNcf,
        ncf_name: assignedNcfName,
        status: 'Facturado'
      });
    } catch (err) {
      console.error('[CHECKOUT TICKET ERROR]:', err);
      res.status(500).json({ error: err.message });
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
      const isPrivileged = actorRole === 'propietario' || actorRole === 'owner' || actorRole === 'admin' || Boolean(req.auth?.isSuperAdmin);

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
            error: 'No hay PIN de seguridad configurado para este salón.',
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
        'SELECT id, status, total, amount, cash_register_id, payment_method FROM visits WHERE id = ? AND tenant_id = ? LIMIT 1',
        [id, tenantId]
      );
      if (existing.length === 0) {
        return res.status(404).json({ error: 'Factura no encontrada en este salón.' });
      }

      const currentStatus = String(existing[0].status || '').trim();
      if (currentStatus === 'Anulado' || currentStatus === 'Anulada') {
        return res.status(409).json({
          error: 'La factura ya ha sido anulada previamente.',
          code: 'ALREADY_VOIDED'
        });
      }

      await pool.query(
        "UPDATE visits SET status = 'Anulado', notes = CONCAT(COALESCE(notes, ''), ' | Anulado: ', ?) WHERE id = ? AND tenant_id = ?",
        [reason, id, tenantId]
      );

      await pool.query(
        "UPDATE employee_commissions_log SET status = 'Anulada' WHERE visit_id = ? AND tenant_id = ?",
        [id, tenantId]
      );

      await pool.query(
        "UPDATE employee_discounts SET status = 'Anulado' WHERE visit_id = ? AND tenant_id = ?",
        [id, tenantId]
      );

      // Reversión atómica de caja (egreso compensatorio de caja exactamente una vez)
      if (existing[0].cash_register_id) {
        try {
          const refundAmount = Number(existing[0].total || existing[0].amount || 0);
          if (refundAmount > 0) {
            await pool.query(
              `INSERT INTO cash_register_movements (tenant_id, cash_register_id, type, amount, description, created_at)
               VALUES (?, ?, 'egreso', ?, ?, NOW())`,
              [tenantId, existing[0].cash_register_id, refundAmount, `Reversión por anulación de factura #${id}: ${reason}`]
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
      } catch (e) {}

      // === REVERSIÓN DE INVENTARIO POR ANULACIÓN DE VENTA (PASO 11) ===
      if (inventoryService) {
        try {
          const [visitRows] = await pool.query('SELECT items_detail, servicios FROM visits WHERE id = ? AND tenant_id = ? LIMIT 1', [id, tenantId]);
          if (visitRows && visitRows.length > 0) {
            const row = visitRows[0];
            let rawItems = [];
            try {
              if (row.items_detail) rawItems = typeof row.items_detail === 'string' ? JSON.parse(row.items_detail) : row.items_detail;
              else if (row.servicios) rawItems = typeof row.servicios === 'string' ? JSON.parse(row.servicios) : row.servicios;
            } catch (e) {}

            if (Array.isArray(rawItems)) {
              for (const [idx, it] of rawItems.entries()) {
                const isProduct = it.tipo_item === 'Producto' || it.is_product || Boolean(it.product_id);
                if (isProduct) {
                  const pId = it.product_id || it.id;
                  const q = Number(it.cantidad || it.qty || it.quantity || 1);
                  if (pId && q > 0) {
                    await inventoryService.recordSaleVoid(tenantId, {
                      productId: pId,
                      quantity: q,
                      visitId: id,
                      lineId: idx,
                      userId: req.user?.id || null,
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
        return res.status(404).json({ error: 'Factura no encontrada en este salón.' });
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
      } catch (e) {}

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

  // 12. DELETE /api/visits/:id & POST /api/visits/:id/delete - Delete pending ticket within the authenticated tenant
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
