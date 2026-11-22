const express = require('express');
const { getBranchScope } = require('../middleware/rbac.middleware');
const { buildCanonicalAppliedPayments } = require('../services/cash_register_aggregation.service');

/**
 * Reports and Financial Analytics Router (Scoped strictly by tenant_id + branch scope)
 */
function createReportsRouter(pool) {
  const router = express.Router();

  const fmtCurrency = (n) => {
    const val = Number(n || 0);
    const hasDecimals = Math.abs(val % 1) > 0.001;
    return `RD$ ${val.toLocaleString('en-US', {
      minimumFractionDigits: hasDecimals ? 2 : 0,
      maximumFractionDigits: 2,
    })}`;
  };

  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  const parseVisitItems = (visit) => {
    let items = [];
    if (visit.items_detail) {
      try {
        items = typeof visit.items_detail === 'string' ? JSON.parse(visit.items_detail) : visit.items_detail;
      } catch (_) {
        items = [];
      }
    }
    if ((!Array.isArray(items) || items.length === 0) && visit.servicios) {
      try {
        const srvs = typeof visit.servicios === 'string' && visit.servicios.trim().startsWith('[')
          ? JSON.parse(visit.servicios)
          : (Array.isArray(visit.servicios) ? visit.servicios : [visit.servicios]);
        items = srvs.filter(Boolean).map((s) => {
          if (typeof s === 'object' && s !== null) return s;
          return { nombre: String(s), precio: Number(visit.total || 0) / Math.max(srvs.length, 1), cantidad: 1, tipo_item: 'Servicio' };
        });
      } catch (_) {
        items = [];
      }
    }
    return Array.isArray(items) ? items : [];
  };

  // GET /api/reports/bi - Reporte operativo BI real por tenant y alcance de sucursal
  router.get('/bi', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const {
        reportId = 'sales_summary',
        startDate,
        endDate,
        salonId = 'all'
      } = req.query;

      const scope = getBranchScope(req);
      let effectiveBranchIds = null; // null => all branches in tenant
      if (!scope.allBranches) {
        if (!scope.branchIds || scope.branchIds.length === 0) {
          return res.status(403).json({
            error: 'No tienes sucursales autorizadas para consultar reportes.',
            code: 'FORBIDDEN_BRANCH_SCOPE',
          });
        }
        if (salonId && salonId !== 'all') {
          if (!scope.branchIds.includes(String(salonId))) {
            return res.status(403).json({
              error: 'Acceso denegado: no tienes autorización para consultar reportes de esta sucursal.',
              code: 'FORBIDDEN_BRANCH_SCOPE',
            });
          }
          effectiveBranchIds = [String(salonId)];
        } else {
          effectiveBranchIds = scope.branchIds;
        }
      } else if (salonId && salonId !== 'all') {
        effectiveBranchIds = [String(salonId)];
      }

      const start = startDate && /^\d{4}-\d{2}-\d{2}$/.test(String(startDate))
        ? String(startDate)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const end = endDate && /^\d{4}-\d{2}-\d{2}$/.test(String(endDate))
        ? String(endDate)
        : new Date().toISOString().split('T')[0];

      const salonFilterV = effectiveBranchIds
        ? ` AND v.salon_id::text IN (${effectiveBranchIds.map(() => '?').join(', ')})`
        : '';
      const vParams = effectiveBranchIds
        ? [tenantId, start, end + ' 23:59:59', ...effectiveBranchIds]
        : [tenantId, start, end + ' 23:59:59'];

      // Fetch all visits in period for this tenant & branch scope (single canonical dataset)
      const [allVisits] = await pool.query(`
        SELECT v.*,
               COALESCE(b.name, s.name, 'Principal') as sucursal_nombre,
               COALESCE(v.client_name, c.nombre, 'Cliente General') as cliente_resuelto
        FROM visits v
        LEFT JOIN branches b ON v.salon_id::text = b.id::text AND b.tenant_id = v.tenant_id
        LEFT JOIN salons s ON v.salon_id::text = s.id::text AND s.tenant_id = v.tenant_id
        LEFT JOIN clients c ON v.client_id::text = c.id::text AND c.tenant_id = v.tenant_id
        WHERE v.tenant_id = ? AND v.visited_at >= ? AND v.visited_at <= ? ${salonFilterV}
        ORDER BY v.visited_at DESC
      `, vParams);

      const invoicedVisits = [];
      const voidedInvoices = [];
      const cancelledTickets = [];
      const receivableVisits = [];

      for (const v of (allVisits || [])) {
        const st = String(v.status || '').trim();
        const stLower = st.toLowerCase();
        const methodLower = String(v.metodo_pago || '').toLowerCase();
        const isCreditMethod =
          methodLower.includes('por cobrar') ||
          methodLower.includes('pendiente') ||
          ((methodLower.includes('credito') || methodLower.includes('crédito')) && !methodLower.includes('tarjeta'));

        if (st === 'Facturado') {
          const rawPay = buildCanonicalAppliedPayments({
            applied_payments: isCreditMethod && !methodLower.includes('mixto') ? null : v.applied_payments,
            metodo_pago: isCreditMethod && !methodLower.includes('mixto') ? 'Cuenta por cobrar' : v.metodo_pago,
            total_cents: v.total_cents,
            total: v.total,
          });
          const parsedPay = isCreditMethod && !methodLower.includes('mixto')
            ? {
                ...rawPay,
                efectivo_cents: 0,
                tarjeta_cents: 0,
                transferencia_cents: 0,
                gift_card_cents: 0,
                otros_cents: 0,
              }
            : rawPay;
          const monetaryCents = isCreditMethod && !methodLower.includes('mixto')
            ? 0
            : (parsedPay.efectivo_cents + parsedPay.tarjeta_cents + parsedPay.transferencia_cents + parsedPay.gift_card_cents);
          const totalCents = Number.isFinite(Number(v.total_cents)) && Number(v.total_cents) > 0
            ? Math.round(Number(v.total_cents))
            : Math.round(Number(v.total || 0) * 100);

          const enriched = {
            ...v,
            _total: round2(totalCents / 100),
            _totalCents: totalCents,
            _collected: round2(Math.min(monetaryCents, totalCents) / 100),
            _collectedCents: Math.min(monetaryCents, totalCents),
            _pendingCents: Math.max(0, totalCents - monetaryCents),
            _parsedPay: parsedPay,
          };
          invoicedVisits.push(enriched);
          if (isCreditMethod || enriched._pendingCents > 0) {
            receivableVisits.push(enriched);
          }
        } else if (['crédito', 'credito', 'cuenta por cobrar', 'pendiente de pago'].includes(stLower)) {
          const totalCents = Math.round(Number(v.total || 0) * 100);
          receivableVisits.push({
            ...v,
            _total: round2(totalCents / 100),
            _totalCents: totalCents,
            _collected: 0,
            _collectedCents: 0,
            _pendingCents: totalCents,
          });
        } else if (st === 'Cancelado' || st === 'Cancelada') {
          cancelledTickets.push(v);
        } else if (st === 'Anulado' || st === 'Anulada') {
          const wasInvoiced = Boolean(v.ncf || v.cash_register_id || (v.applied_payments && JSON.stringify(v.applied_payments) !== '{}' && JSON.stringify(v.applied_payments) !== '[]'));
          if (wasInvoiced) {
            voidedInvoices.push(v);
          } else {
            cancelledTickets.push(v);
            voidedInvoices.push(v);
          }
        }
      }

      const totalFacturacion = round2(invoicedVisits.reduce((acc, v) => acc + v._total, 0));
      const totalCobrado = round2(invoicedVisits.reduce((acc, v) => acc + v._collected, 0));
      const totalFacturas = invoicedVisits.length;
      const ticketPromedio = totalFacturas > 0 ? round2(totalFacturacion / totalFacturas) : 0;

      // 0. Flujo de caja operativo (cash_flow)
      if (reportId === 'cash_flow') {
        const expPlaceholders = effectiveBranchIds ? effectiveBranchIds.map(() => '?').join(', ') : '';
        const salonFilterE = effectiveBranchIds
          ? ` AND (branch_id::text IN (${expPlaceholders}) OR salon_id::text IN (${expPlaceholders}))`
          : '';
        const expParams = effectiveBranchIds
          ? [tenantId, start, end, ...effectiveBranchIds, ...effectiveBranchIds]
          : [tenantId, start, end];
        const [expRows] = await pool.query(
          `SELECT COALESCE(SUM(amount), 0) as total_egresos FROM expenses WHERE tenant_id = ? AND COALESCE(date, expense_date) BETWEEN ? AND ? ${salonFilterE}`,
          expParams
        );
        const totalEgresos = round2(expRows[0]?.total_egresos || 0);
        const neto = round2(totalCobrado - totalEgresos);
        const pct = totalCobrado > 0 ? round2((neto / totalCobrado) * 100) : 0;
        return res.json({
          success: true,
          reportId,
          title: 'Flujo de efectivo',
          periodText: `${start} al ${end}`,
          total_cobrado: totalCobrado,
          total_pagado: totalEgresos,
          excedente_periodo: neto,
          excedente_pct: pct,
          kpis: [
            { label: 'Total cobrado', value: fmtCurrency(totalCobrado), subtext: `${totalFacturas} facturas`, icon: 'credit_card', color: 'blue' },
            { label: 'Total pagado', value: fmtCurrency(totalEgresos), subtext: 'Período seleccionado', icon: 'wallet', color: 'purple' },
            { label: 'Excedente del período', value: fmtCurrency(neto), subtext: 'Cobros - Pagos', icon: 'trending', color: neto >= 0 ? 'indigo' : 'amber' },
            { label: 'Excedente sobre lo cobrado', value: `${pct}%`, subtext: 'Margen operativo', icon: 'percent', color: 'emerald' }
          ],
          concepts_breakdown: [],
          table: {
            title: 'Detalle de ingresos cobrados',
            badgeText: `${invoicedVisits.length} registros`,
            columns: [
              { key: 'fecha', label: 'Fecha' },
              { key: 'sucursal', label: 'Sucursal' },
              { key: 'facturacion', label: 'Facturado', isCurrency: true },
              { key: 'cobrado', label: 'Cobrado', isCurrency: true }
            ],
            rows: invoicedVisits.map((v) => ({
              fecha: v.visited_at ? new Date(v.visited_at).toISOString().slice(0, 10) : '',
              sucursal: v.sucursal_nombre,
              facturacion: v._total,
              cobrado: v._collected,
            }))
          }
        });
      }

      // 1. Ventas por producto o servicio (sales_by_product)
      if (reportId === 'sales_by_product') {
        const itemMap = new Map();
        for (const v of invoicedVisits) {
          const items = parseVisitItems(v);
          const rawSum = items.reduce((s, it) => s + (Number(it.precioAplicado ?? it.precio ?? 0) * (Number(it.cantidad || it.qty || 1))), 0);
          for (const it of items) {
            const name = String(it.nombre || it.service_name || it.name || 'Servicio General').trim();
            const isProd = String(it.tipo_item || it.item_type || '').toUpperCase() === 'PRODUCTO' || Boolean(it.is_product) || Boolean(it.product_id);
            const tipo = isProd ? 'Producto' : 'Servicio';
            const qty = Math.max(1, Number(it.cantidad || it.qty || 1));
            const unitPrice = Number(it.precioAplicado ?? it.precio ?? 0);
            const lineAmt = rawSum > 0 ? round2(unitPrice * qty) : round2(v._total / Math.max(items.length, 1));
            const key = `${name.toLowerCase()}__${tipo}`;
            const cur = itemMap.get(key) || { producto_servicio: name, tipo, cantidad: 0, facturacion: 0 };
            cur.cantidad += qty;
            cur.facturacion = round2(cur.facturacion + lineAmt);
            itemMap.set(key, cur);
          }
        }
        const totalItemRev = Array.from(itemMap.values()).reduce((s, r) => s + r.facturacion, 0);
        const totalUnits = Array.from(itemMap.values()).reduce((s, r) => s + r.cantidad, 0);
        const rows = Array.from(itemMap.values())
          .sort((a, b) => b.facturacion - a.facturacion || b.cantidad - a.cantidad)
          .map((r) => {
            const pct = totalItemRev > 0 ? round2((r.facturacion / totalItemRev) * 100) : 0;
            return {
              ...r,
              participacion_pct: pct,
              participacion: `${pct}%`,
            };
          });

        return res.json({
          success: true,
          reportId,
          title: 'Ventas por producto o servicio',
          periodText: `${start} al ${end}`,
          kpis: [
            { label: 'Facturación por ítems', value: fmtCurrency(totalItemRev), subtext: 'Total catálogo vendido', icon: 'trending', color: 'emerald' },
            { label: 'Unidades vendidas', value: String(totalUnits), subtext: 'Servicios y productos', icon: 'receipt', color: 'blue' },
            { label: 'Ítems activos vendidos', value: String(rows.length), subtext: 'Con ventas en el período', icon: 'tag', color: 'purple' },
            { label: 'Mayor venta', value: rows[0]?.producto_servicio || 'Sin ventas', subtext: rows[0] ? fmtCurrency(rows[0].facturacion) : 'RD$ 0', icon: 'dollar', color: 'amber' }
          ],
          chart: {
            type: 'bar',
            title: 'Participación por producto o servicio',
            data: rows.map((r) => ({
              label: `${r.producto_servicio} (${r.tipo})`,
              value: r.facturacion,
              count: r.cantidad,
              percentage: r.participacion_pct,
              isCurrency: true,
            })),
          },
          table: {
            title: 'Detalle por producto o servicio',
            badgeText: `${rows.length} ítems`,
            columns: [
              { key: 'producto_servicio', label: 'Producto / Servicio' },
              { key: 'tipo', label: 'Tipo' },
              { key: 'cantidad', label: 'Cantidad', align: 'center' },
              { key: 'facturacion', label: 'Facturación', isCurrency: true },
              { key: 'participacion', label: 'Participación', align: 'center' }
            ],
            rows,
          }
        });
      }

      // 2. Ventas por cliente (sales_by_client)
      if (reportId === 'sales_by_client') {
        const clientMap = new Map();
        for (const v of invoicedVisits) {
          const clientName = String(v.cliente_resuelto || 'Cliente General').trim();
          const key = `${String(v.client_id || clientName).toLowerCase()}__${v.sucursal_nombre}`;
          const cur = clientMap.get(key) || {
            cliente: clientName,
            sucursal: v.sucursal_nombre,
            facturas: 0,
            consumo_total: 0,
          };
          cur.facturas += 1;
          cur.consumo_total = round2(cur.consumo_total + v._total);
          clientMap.set(key, cur);
        }
        const rows = Array.from(clientMap.values())
          .sort((a, b) => b.consumo_total - a.consumo_total)
          .map((r) => ({
            ...r,
            ticket_promedio: r.facturas > 0 ? round2(r.consumo_total / r.facturas) : 0,
          }));
        const avgPerClient = rows.length > 0 ? round2(totalFacturacion / rows.length) : 0;

        return res.json({
          success: true,
          reportId,
          title: 'Ventas por cliente (Mayor consumo)',
          periodText: `${start} al ${end}`,
          kpis: [
            { label: 'Facturación válida', value: fmtCurrency(totalFacturacion), subtext: 'Excluye facturas anuladas', icon: 'trending', color: 'emerald' },
            { label: 'Clientes atendidos', value: String(rows.length), subtext: 'En el período', icon: 'users', color: 'blue' },
            { label: 'Consumo promedio', value: fmtCurrency(avgPerClient), subtext: 'Por cliente', icon: 'tag', color: 'purple' },
            { label: 'Cliente de mayor consumo', value: rows[0]?.cliente || 'Sin registros', subtext: rows[0] ? fmtCurrency(rows[0].consumo_total) : 'RD$ 0', icon: 'dollar', color: 'amber' }
          ],
          chart: {
            type: 'bar',
            title: 'Clientes con mayor consumo (RD$)',
            data: rows.slice(0, 10).map((r) => ({
              label: r.cliente,
              value: r.consumo_total,
              displayValue: fmtCurrency(r.consumo_total),
              isCurrency: true,
            })),
          },
          table: {
            title: 'Desglose de consumo por cliente',
            badgeText: `${rows.length} clientes`,
            columns: [
              { key: 'cliente', label: 'Cliente' },
              { key: 'sucursal', label: 'Sucursal' },
              { key: 'facturas', label: 'Facturas', align: 'center' },
              { key: 'consumo_total', label: 'Consumo total', isCurrency: true },
              { key: 'ticket_promedio', label: 'Ticket promedio', isCurrency: true }
            ],
            rows,
          }
        });
      }

      // 3. Cobros por método de pago (payment_methods)
      if (reportId === 'payment_methods') {
        const totalsByBucket = {
          efectivo: { label: 'Efectivo', count: 0, cents: 0, color: '#10b981' },
          tarjeta: { label: 'Tarjeta', count: 0, cents: 0, color: '#2563eb' },
          transferencia: { label: 'Transferencia', count: 0, cents: 0, color: '#8b5cf6' },
          gift_card: { label: 'Gift Card', count: 0, cents: 0, color: '#f59e0b' },
          otros: { label: 'Otros', count: 0, cents: 0, color: '#64748b' },
        };
        const detailRows = [];

        for (const v of invoicedVisits) {
          const p = v._parsedPay;
          const parts = [
            ['efectivo', 'Efectivo', p.efectivo_cents],
            ['tarjeta', 'Tarjeta', p.tarjeta_cents],
            ['transferencia', 'Transferencia', p.transferencia_cents],
            ['gift_card', 'Gift Card', p.gift_card_cents],
            ['otros', 'Otros', p.otros_cents],
          ];
          for (const [key, label, cents] of parts) {
            if (cents > 0) {
              totalsByBucket[key].count += 1;
              totalsByBucket[key].cents += cents;
              detailRows.push({
                fecha: v.visited_at ? new Date(v.visited_at).toISOString().slice(0, 10) : '',
                ticket: v.ticket_number || v.id,
                ncf: v.ncf || '—',
                cliente: v.cliente_resuelto,
                sucursal: v.sucursal_nombre,
                metodo: label,
                monto: round2(cents / 100),
              });
            }
          }
        }

        const totalAllCents = Object.values(totalsByBucket).reduce((s, b) => s + b.cents, 0);
        const totalAll = round2(totalAllCents / 100);
        const chartData = Object.values(totalsByBucket)
          .filter((b) => b.cents > 0)
          .map((b) => ({
            label: b.label,
            count: b.count,
            amount: round2(b.cents / 100),
            percentage: totalAllCents > 0 ? round2((b.cents / totalAllCents) * 100) : 0,
            color: b.color,
          }));

        return res.json({
          success: true,
          reportId,
          title: 'Cobros por método de pago',
          periodText: `${start} al ${end}`,
          kpis: [
            { label: 'Total cobrado', value: fmtCurrency(totalAll), subtext: 'Pagos monetarios recibidos', icon: 'dollar', color: 'emerald' },
            { label: 'Efectivo', value: fmtCurrency(totalsByBucket.efectivo.cents / 100), subtext: `${totalsByBucket.efectivo.count} cobros`, icon: 'dollar', color: 'blue' },
            { label: 'Tarjeta', value: fmtCurrency(totalsByBucket.tarjeta.cents / 100), subtext: `${totalsByBucket.tarjeta.count} cobros`, icon: 'credit_card', color: 'purple' },
            { label: 'Transferencia', value: fmtCurrency(totalsByBucket.transferencia.cents / 100), subtext: `${totalsByBucket.transferencia.count} cobros`, icon: 'receipt', color: 'amber' }
          ],
          chart: {
            type: 'donut',
            data: chartData,
          },
          table: {
            title: 'Detalle de cobros por método (pagos mixtos distribuidos)',
            badgeText: `${detailRows.length} registros`,
            columns: [
              { key: 'fecha', label: 'Fecha' },
              { key: 'ticket', label: 'Ticket' },
              { key: 'ncf', label: 'NCF' },
              { key: 'cliente', label: 'Cliente' },
              { key: 'sucursal', label: 'Sucursal' },
              { key: 'metodo', label: 'Método' },
              { key: 'monto', label: 'Monto cobrado', isCurrency: true }
            ],
            rows: detailRows,
          }
        });
      }

      // 4. Cuentas por cobrar (accounts_receivable)
      if (reportId === 'accounts_receivable') {
        const rows = receivableVisits.map((v) => ({
          fecha: v.visited_at ? new Date(v.visited_at).toISOString().slice(0, 10) : '',
          documento: v.ncf || v.ticket_number || v.id,
          cliente: v.cliente_resuelto,
          sucursal: v.sucursal_nombre,
          monto_facturado: v._total,
          monto_pagado: v._collected,
          saldo_pendiente: round2(v._pendingCents / 100),
          estado: v._collected > 0 ? 'Pendiente parcial' : 'Pendiente',
        }));
        const totalReceivable = round2(rows.reduce((s, r) => s + r.saldo_pendiente, 0));
        const distinctClients = new Set(rows.map((r) => r.cliente)).size;

        return res.json({
          success: true,
          reportId,
          title: 'Cuentas por cobrar',
          periodText: `${start} al ${end}`,
          kpis: [
            { label: 'Saldo por cobrar', value: fmtCurrency(totalReceivable), subtext: 'Pendiente de cobro', icon: 'dollar', color: 'rose' },
            { label: 'Documentos pendientes', value: String(rows.length), subtext: 'Con saldo abierto', icon: 'receipt', color: 'amber' },
            { label: 'Clientes con saldo', value: String(distinctClients), subtext: 'En el período', icon: 'users', color: 'blue' }
          ],
          chart: {
            type: 'bar',
            title: 'Saldo pendiente por cliente',
            data: rows.map((r) => ({
              label: `${r.cliente} (${r.documento})`,
              value: r.saldo_pendiente,
              displayValue: fmtCurrency(r.saldo_pendiente),
              isCurrency: true,
            })),
          },
          table: {
            title: 'Detalle de cuentas por cobrar',
            badgeText: `${rows.length} documentos`,
            columns: [
              { key: 'fecha', label: 'Fecha' },
              { key: 'documento', label: 'Documento' },
              { key: 'cliente', label: 'Cliente' },
              { key: 'sucursal', label: 'Sucursal' },
              { key: 'monto_facturado', label: 'Facturado', isCurrency: true },
              { key: 'monto_pagado', label: 'Cobrado', isCurrency: true },
              { key: 'saldo_pendiente', label: 'Saldo pendiente', isCurrency: true },
              { key: 'estado', label: 'Estado', align: 'center' }
            ],
            rows,
          }
        });
      }

      // 5. Tickets cancelados (cancelled_tickets)
      if (reportId === 'cancelled_tickets') {
        const rows = cancelledTickets.map((v) => ({
          fecha: v.visited_at ? new Date(v.visited_at).toISOString().slice(0, 10) : '',
          ticket: v.ticket_number || v.id,
          cliente: v.cliente_resuelto,
          sucursal: v.sucursal_nombre,
          motivo: v.void_reason || v.nota || 'Cancelado en recepción',
          usuario: v.voided_by || 'Recepción',
          monto: round2(Number(v.total || 0)),
        }));
        const totalAmt = round2(rows.reduce((s, r) => s + r.monto, 0));
        const byBranchMap = new Map();
        for (const r of rows) {
          const k = `${r.sucursal}__${r.motivo}`;
          const cur = byBranchMap.get(k) || { sucursal: r.sucursal, motivo: r.motivo, cantidad: 0, monto: 0 };
          cur.cantidad += 1;
          cur.monto = round2(cur.monto + r.monto);
          byBranchMap.set(k, cur);
        }
        const summaryRows = Array.from(byBranchMap.values());

        return res.json({
          success: true,
          reportId,
          title: 'Tickets cancelados',
          periodText: `${start} al ${end}`,
          kpis: [
            { label: 'Tickets cancelados', value: String(rows.length), subtext: 'Antes de facturar', icon: 'receipt', color: 'rose' },
            { label: 'Monto estimado', value: fmtCurrency(totalAmt), subtext: 'No facturado', icon: 'dollar', color: 'amber' },
            { label: 'Sucursales', value: String(new Set(rows.map((r) => r.sucursal)).size), subtext: 'Con cancelaciones', icon: 'tag', color: 'blue' }
          ],
          chart: { type: 'table_only' },
          summaryTable: {
            title: 'Totalizado por sucursal y motivo',
            badgeText: `${summaryRows.length} grupos`,
            columns: [
              { key: 'sucursal', label: 'Sucursal' },
              { key: 'motivo', label: 'Motivo' },
              { key: 'cantidad', label: 'Tickets', align: 'center' },
              { key: 'monto', label: 'Monto estimado', isCurrency: true }
            ],
            rows: summaryRows,
          },
          table: {
            title: 'Detalle de tickets cancelados',
            badgeText: `${rows.length} tickets`,
            columns: [
              { key: 'fecha', label: 'Fecha' },
              { key: 'ticket', label: 'Ticket' },
              { key: 'cliente', label: 'Cliente' },
              { key: 'sucursal', label: 'Sucursal' },
              { key: 'motivo', label: 'Motivo' },
              { key: 'usuario', label: 'Usuario' },
              { key: 'monto', label: 'Monto', isCurrency: true }
            ],
            rows,
          }
        });
      }

      // 6. Facturas anuladas (voided_invoices)
      if (reportId === 'voided_invoices') {
        const rows = voidedInvoices.map((v) => ({
          fecha: (v.voided_at || v.visited_at) ? new Date(v.voided_at || v.visited_at).toISOString().slice(0, 10) : '',
          ticket: v.ticket_number || v.id,
          ncf: v.ncf || 'Sin NCF',
          cliente: v.cliente_resuelto,
          sucursal: v.sucursal_nombre,
          motivo: v.void_reason || 'Anulación de factura',
          usuario: v.voided_by || 'Supervisor',
          monto: round2(Number(v.total || 0)),
        }));
        const totalVoided = round2(rows.reduce((s, r) => s + r.monto, 0));
        const withNcf = rows.filter((r) => r.ncf && r.ncf !== 'Sin NCF').length;

        return res.json({
          success: true,
          reportId,
          title: 'Facturas anuladas',
          periodText: `${start} al ${end}`,
          kpis: [
            { label: 'Facturas anuladas', value: String(rows.length), subtext: 'En el período', icon: 'receipt', color: 'rose' },
            { label: 'Monto total anulado', value: fmtCurrency(totalVoided), subtext: 'Excluido de ventas netas', icon: 'dollar', color: 'amber' },
            { label: 'Con comprobante NCF', value: String(withNcf), subtext: 'Comprobantes anulados', icon: 'tag', color: 'purple' }
          ],
          chart: { type: 'table_only' },
          table: {
            title: 'Registro de facturas anuladas',
            badgeText: `${rows.length} facturas`,
            columns: [
              { key: 'fecha', label: 'Fecha' },
              { key: 'ticket', label: 'Ticket' },
              { key: 'ncf', label: 'NCF' },
              { key: 'cliente', label: 'Cliente' },
              { key: 'sucursal', label: 'Sucursal' },
              { key: 'motivo', label: 'Motivo' },
              { key: 'usuario', label: 'Responsable' },
              { key: 'monto', label: 'Monto anulado', isCurrency: true }
            ],
            rows,
          }
        });
      }

      // 7. Descuentos aplicados (applied_discounts)
      if (reportId === 'applied_discounts') {
        const rows = [];
        const byBranch = new Map();

        for (const v of invoicedVisits) {
          const disc = round2(Number(v.descuento || (v.discount_cents ? v.discount_cents / 100 : 0) || 0));
          if (disc <= 0) continue;
          const base = round2(Number(v.subtotal || 0) > 0 ? Number(v.subtotal) : (v._total + disc));
          rows.push({
            fecha: v.visited_at ? new Date(v.visited_at).toISOString().slice(0, 10) : '',
            ticket: v.ticket_number || v.id,
            cliente: v.cliente_resuelto,
            sucursal: v.sucursal_nombre,
            precio_base: base,
            descuento: disc,
            precio_final: v._total,
            usuario: v.recepcionista || 'Caja POS',
          });
          const bCur = byBranch.get(v.sucursal_nombre) || { sucursal: v.sucursal_nombre, cantidad: 0, descuento_total: 0 };
          bCur.cantidad += 1;
          bCur.descuento_total = round2(bCur.descuento_total + disc);
          byBranch.set(v.sucursal_nombre, bCur);
        }

        const totalDisc = round2(rows.reduce((s, r) => s + r.descuento, 0));
        const avgDisc = rows.length > 0 ? round2(totalDisc / rows.length) : 0;
        const branchList = Array.from(byBranch.values());

        return res.json({
          success: true,
          reportId,
          title: 'Descuentos aplicados',
          periodText: `${start} al ${end}`,
          kpis: [
            { label: 'Total descontado', value: fmtCurrency(totalDisc), subtext: 'En facturas válidas', icon: 'dollar', color: 'amber' },
            { label: 'Facturas con descuento', value: String(rows.length), subtext: 'Transacciones auditadas', icon: 'receipt', color: 'blue' },
            { label: 'Descuento promedio', value: fmtCurrency(avgDisc), subtext: 'Por factura con descuento', icon: 'percent', color: 'purple' }
          ],
          chart: {
            type: 'bar',
            title: 'Descuentos por sucursal',
            data: branchList.map((b) => ({
              label: b.sucursal,
              value: b.descuento_total,
              displayValue: fmtCurrency(b.descuento_total),
              isCurrency: true,
            })),
          },
          table: {
            title: 'Detalle de descuentos aplicados',
            badgeText: `${rows.length} transacciones`,
            columns: [
              { key: 'fecha', label: 'Fecha' },
              { key: 'ticket', label: 'Ticket' },
              { key: 'cliente', label: 'Cliente' },
              { key: 'sucursal', label: 'Sucursal' },
              { key: 'precio_base', label: 'Precio base', isCurrency: true },
              { key: 'descuento', label: 'Descuento', isCurrency: true },
              { key: 'precio_final', label: 'Precio final', isCurrency: true },
              { key: 'usuario', label: 'Usuario' }
            ],
            rows,
          }
        });
      }

      // 8. Pagos en efectivo (cash_membership_payments)
      if (reportId === 'cash_membership_payments') {
        const rows = [];
        for (const v of invoicedVisits) {
          const cashCents = v._parsedPay.efectivo_cents;
          if (cashCents > 0) {
            rows.push({
              fecha: v.visited_at ? new Date(v.visited_at).toISOString().slice(0, 10) : '',
              referencia: v.ticket_number || v.id,
              cliente: v.cliente_resuelto,
              concepto: v.ncf ? `Venta POS (${v.ncf})` : 'Venta POS',
              sucursal: v.sucursal_nombre,
              usuario: v.recepcionista || 'Caja POS',
              monto: round2(cashCents / 100),
            });
          }
        }
        const totalCash = round2(rows.reduce((s, r) => s + r.monto, 0));
        const avgCash = rows.length > 0 ? round2(totalCash / rows.length) : 0;

        return res.json({
          success: true,
          reportId,
          title: 'Pagos en efectivo',
          periodText: `${start} al ${end}`,
          kpis: [
            { label: 'Total en efectivo', value: fmtCurrency(totalCash), subtext: 'Recibido en caja', icon: 'dollar', color: 'emerald' },
            { label: 'Cobros en efectivo', value: String(rows.length), subtext: 'Incluye porción en pagos mixtos', icon: 'receipt', color: 'blue' },
            { label: 'Promedio por cobro', value: fmtCurrency(avgCash), subtext: 'Efectivo por transacción', icon: 'tag', color: 'purple' }
          ],
          chart: { type: 'table_only' },
          table: {
            title: 'Detalle de pagos recibidos en efectivo',
            badgeText: `${rows.length} pagos`,
            columns: [
              { key: 'fecha', label: 'Fecha' },
              { key: 'referencia', label: 'Ticket / Ref.' },
              { key: 'cliente', label: 'Cliente' },
              { key: 'concepto', label: 'Concepto' },
              { key: 'sucursal', label: 'Sucursal' },
              { key: 'usuario', label: 'Receptor' },
              { key: 'monto', label: 'Monto en efectivo', isCurrency: true }
            ],
            rows,
          }
        });
      }

      // 9. ITBIS en ventas (sales_itbis)
      if (reportId === 'sales_itbis') {
        const rows = [];
        const byBranch = new Map();

        for (const v of invoicedVisits) {
          const items = parseVisitItems(v);
          let itbisFactura = 0;
          let baseGravada = 0;
          let montoExento = 0;

          let hasExplicitItemTax = false;
          for (const it of items) {
            const lineTotal = round2(Number(it.precioAplicado ?? it.precio ?? 0) * Math.max(1, Number(it.cantidad || it.qty || 1)));
            const itemTax = round2(Number(it.itbis ?? it.tax_amount ?? it.impuesto ?? 0));
            const itemRate = Number(it.itbis_rate ?? it.tax_rate ?? 0);
            if (itemTax > 0) {
              hasExplicitItemTax = true;
              itbisFactura = round2(itbisFactura + itemTax);
              baseGravada = round2(baseGravada + Math.max(0, lineTotal - itemTax));
            } else if (itemRate > 0 || it.gravado === true) {
              hasExplicitItemTax = true;
              const rate = itemRate > 0 ? itemRate / 100 : 0.18;
              const base = round2(lineTotal / (1 + rate));
              const tax = round2(lineTotal - base);
              baseGravada = round2(baseGravada + base);
              itbisFactura = round2(itbisFactura + tax);
            } else {
              montoExento = round2(montoExento + lineTotal);
            }
          }

          if (!hasExplicitItemTax) {
            baseGravada = 0;
            itbisFactura = 0;
            montoExento = v._total;
          }

          rows.push({
            fecha: v.visited_at ? new Date(v.visited_at).toISOString().slice(0, 10) : '',
            ticket: v.ticket_number || v.id,
            ncf: v.ncf || 'Sin NCF',
            cliente: v.cliente_resuelto,
            sucursal: v.sucursal_nombre,
            base_gravada: baseGravada,
            monto_exento: montoExento,
            itbis: itbisFactura,
            total: v._total,
          });

          const bCur = byBranch.get(v.sucursal_nombre) || {
            sucursal: v.sucursal_nombre,
            facturas: 0,
            ventas_gravadas: 0,
            ventas_exentas: 0,
            itbis_facturado: 0,
            total_facturado: 0,
          };
          bCur.facturas += 1;
          bCur.ventas_gravadas = round2(bCur.ventas_gravadas + baseGravada);
          bCur.ventas_exentas = round2(bCur.ventas_exentas + montoExento);
          bCur.itbis_facturado = round2(bCur.itbis_facturado + itbisFactura);
          bCur.total_facturado = round2(bCur.total_facturado + v._total);
          byBranch.set(v.sucursal_nombre, bCur);
        }

        const totalGravado = round2(rows.reduce((s, r) => s + r.base_gravada, 0));
        const totalExento = round2(rows.reduce((s, r) => s + r.monto_exento, 0));
        const totalItbis = round2(rows.reduce((s, r) => s + r.itbis, 0));
        const branchRows = Array.from(byBranch.values());

        return res.json({
          success: true,
          reportId,
          title: 'ITBIS en ventas',
          periodText: `${start} al ${end}`,
          kpis: [
            { label: 'Total facturado', value: fmtCurrency(totalFacturacion), subtext: `${totalFacturas} facturas válidas`, icon: 'trending', color: 'emerald' },
            { label: 'Base gravada', value: fmtCurrency(totalGravado), subtext: 'Sujeta a ITBIS', icon: 'dollar', color: 'blue' },
            { label: 'Ventas exentas', value: fmtCurrency(totalExento), subtext: 'Tasa 0% / Exento', icon: 'receipt', color: 'purple' },
            { label: 'ITBIS facturado neto', value: fmtCurrency(totalItbis), subtext: 'Excluye anuladas', icon: 'percent', color: 'amber' }
          ],
          chart: {
            type: 'bar',
            title: 'ITBIS y ventas por sucursal',
            data: branchRows.map((b) => ({
              label: b.sucursal,
              value: b.total_facturado,
              displayValue: fmtCurrency(b.total_facturado),
              isCurrency: true,
            })),
          },
          summaryTable: {
            title: 'Consolidado de ITBIS por sucursal',
            badgeText: `${branchRows.length} sucursales`,
            columns: [
              { key: 'sucursal', label: 'Sucursal' },
              { key: 'facturas', label: 'Facturas', align: 'center' },
              { key: 'ventas_gravadas', label: 'Base gravada', isCurrency: true },
              { key: 'ventas_exentas', label: 'Ventas exentas', isCurrency: true },
              { key: 'itbis_facturado', label: 'ITBIS facturado', isCurrency: true },
              { key: 'total_facturado', label: 'Total facturado', isCurrency: true }
            ],
            rows: branchRows,
          },
          table: {
            title: 'Detalle de ITBIS por factura',
            badgeText: `${rows.length} facturas`,
            columns: [
              { key: 'fecha', label: 'Fecha' },
              { key: 'ticket', label: 'Ticket' },
              { key: 'ncf', label: 'NCF' },
              { key: 'cliente', label: 'Cliente' },
              { key: 'sucursal', label: 'Sucursal' },
              { key: 'base_gravada', label: 'Base gravada', isCurrency: true },
              { key: 'monto_exento', label: 'Exento', isCurrency: true },
              { key: 'itbis', label: 'ITBIS', isCurrency: true },
              { key: 'total', label: 'Total', isCurrency: true }
            ],
            rows,
          }
        });
      }

      // 10. Comportamiento de compra conjunta (joint_purchases)
      if (reportId === 'joint_purchases') {
        const pairMap = new Map();
        let multiItemVisitsCount = 0;

        for (const v of invoicedVisits) {
          const items = parseVisitItems(v);
          const uniqueNames = Array.from(
            new Set(
              items
                .map((it) => String(it.nombre || it.service_name || it.name || '').trim())
                .filter(Boolean)
            )
          ).sort((a, b) => a.localeCompare(b, 'es'));

          if (uniqueNames.length >= 2) {
            multiItemVisitsCount += 1;
            for (let i = 0; i < uniqueNames.length; i++) {
              for (let j = i + 1; j < uniqueNames.length; j++) {
                const combo = `${uniqueNames[i]} + ${uniqueNames[j]}`;
                const cur = pairMap.get(combo) || { combinacion: combo, visitas: 0, monto_facturas: 0 };
                cur.visitas += 1;
                cur.monto_facturas = round2(cur.monto_facturas + v._total);
                pairMap.set(combo, cur);
              }
            }
          }
        }

        const rows = Array.from(pairMap.values())
          .sort((a, b) => b.visitas - a.visitas || b.monto_facturas - a.monto_facturas)
          .map((r) => {
            const pct = totalFacturas > 0 ? round2((r.visitas / totalFacturas) * 100) : 0;
            return {
              ...r,
              porcentaje_pct: pct,
              porcentaje_facturas: `${pct}%`,
            };
          });

        const jointPct = totalFacturas > 0 ? round2((multiItemVisitsCount / totalFacturas) * 100) : 0;

        return res.json({
          success: true,
          reportId,
          title: 'Comportamiento de compra conjunta',
          periodText: `${start} al ${end}`,
          kpis: [
            { label: 'Visitas con compra conjunta', value: String(multiItemVisitsCount), subtext: `De ${totalFacturas} facturas válidas`, icon: 'receipt', color: 'emerald' },
            { label: '% sobre facturas válidas', value: `${jointPct}%`, subtext: '2 o más ítems distintos', icon: 'percent', color: 'blue' },
            { label: 'Combinaciones detectadas', value: String(rows.length), subtext: 'Pares de productos/servicios', icon: 'tag', color: 'purple' },
            { label: 'Combinación principal', value: rows[0]?.combinacion || 'Sin combinaciones', subtext: rows[0] ? `${rows[0].visitas} visitas` : '0 visitas', icon: 'trending', color: 'amber' }
          ],
          chart: {
            type: 'bar',
            title: 'Combinaciones adquiridas en la misma visita',
            data: rows.slice(0, 10).map((r) => ({
              label: r.combinacion,
              value: r.visitas,
              count: r.visitas,
              percentage: r.porcentaje_pct,
            })),
          },
          table: {
            title: 'Detalle de combinaciones de compra conjunta',
            badgeText: `${rows.length} combinaciones`,
            columns: [
              { key: 'combinacion', label: 'Combinación (Producto / Servicio)' },
              { key: 'visitas', label: 'Visitas conjuntas', align: 'center' },
              { key: 'porcentaje_facturas', label: '% sobre facturas', align: 'center' },
              { key: 'monto_facturas', label: 'Facturación asociada', isCurrency: true }
            ],
            rows,
          }
        });
      }

      // Default / 11. Resumen de ventas y cobros (sales_summary)
      const byDayBranchMap = new Map();
      const byBranchSummaryMap = new Map();
      const chartMap = new Map();

      for (const v of invoicedVisits) {
        const fechaKey = v.visited_at ? new Date(v.visited_at).toISOString().slice(0, 10) : '';
        const dbKey = `${fechaKey}__${v.sucursal_nombre}`;
        const curDay = byDayBranchMap.get(dbKey) || {
          fecha: fechaKey,
          sucursal: v.sucursal_nombre,
          facturas: 0,
          facturacion: 0,
          cobrado: 0,
        };
        curDay.facturas += 1;
        curDay.facturacion = round2(curDay.facturacion + v._total);
        curDay.cobrado = round2(curDay.cobrado + v._collected);
        byDayBranchMap.set(dbKey, curDay);

        chartMap.set(fechaKey, round2((chartMap.get(fechaKey) || 0) + v._total));

        const curBranch = byBranchSummaryMap.get(v.sucursal_nombre) || {
          sucursal: v.sucursal_nombre,
          facturas: 0,
          facturacion: 0,
          cobrado: 0,
          anuladas: 0,
        };
        curBranch.facturas += 1;
        curBranch.facturacion = round2(curBranch.facturacion + v._total);
        curBranch.cobrado = round2(curBranch.cobrado + v._collected);
        byBranchSummaryMap.set(v.sucursal_nombre, curBranch);
      }

      for (const v of voidedInvoices) {
        const curBranch = byBranchSummaryMap.get(v.sucursal_nombre) || {
          sucursal: v.sucursal_nombre,
          facturas: 0,
          facturacion: 0,
          cobrado: 0,
          anuladas: 0,
        };
        curBranch.anuladas += 1;
        byBranchSummaryMap.set(v.sucursal_nombre, curBranch);
      }

      const chartData = Array.from(chartMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([label, total]) => ({ label, total }));

      const summaryRows = Array.from(byBranchSummaryMap.values()).map((b) => ({
        ...b,
        participacion: totalFacturacion > 0 ? `${round2((b.facturacion / totalFacturacion) * 100)}%` : '0%',
        ticket_promedio: b.facturas > 0 ? round2(b.facturacion / b.facturas) : 0,
      }));

      const detailRows = Array.from(byDayBranchMap.values()).sort((a, b) => b.fecha.localeCompare(a.fecha));

      return res.json({
        success: true,
        reportId,
        title: 'Resumen de ventas y cobros',
        periodText: `${start} al ${end}`,
        kpis: [
          { label: 'Facturación', value: fmtCurrency(totalFacturacion), subtext: 'Ventas del período', icon: 'trending', color: 'emerald' },
          { label: 'Total cobrado', value: fmtCurrency(totalCobrado), subtext: 'Pagos recibidos en el período', icon: 'dollar', color: 'blue' },
          { label: 'Cantidad de facturas', value: String(totalFacturas), subtext: 'Facturas válidas', icon: 'receipt', color: 'purple' },
          { label: 'Ticket promedio', value: fmtCurrency(ticketPromedio), subtext: 'Por factura', icon: 'tag', color: 'amber' }
        ],
        chart: { type: 'sales_evolution', data: chartData },
        summaryTable: {
          title: 'Consolidado por sucursal',
          badgeText: `${summaryRows.length} sucursales`,
          columns: [
            { key: 'sucursal', label: 'Sucursal' },
            { key: 'facturas', label: 'Facturas', align: 'center' },
            { key: 'facturacion', label: 'Facturación', isCurrency: true },
            { key: 'cobrado', label: 'Total cobrado', isCurrency: true },
            { key: 'participacion', label: 'Participación', align: 'center' },
            { key: 'ticket_promedio', label: 'Ticket promedio', isCurrency: true },
            { key: 'anuladas', label: 'Anuladas', align: 'center' }
          ],
          rows: summaryRows,
        },
        table: {
          title: 'Detalle de ventas',
          badgeText: `${detailRows.length} registros`,
          columns: [
            { key: 'fecha', label: 'Fecha' },
            { key: 'sucursal', label: 'Sucursal' },
            { key: 'facturas', label: 'Facturas', align: 'center' },
            { key: 'facturacion', label: 'Facturación', isCurrency: true },
            { key: 'cobrado', label: 'Total cobrado', isCurrency: true }
          ],
          rows: detailRows,
          footerNote: 'Facturación y cobros corresponden a conceptos distintos. Excluye facturas anuladas.'
        }
      });
    } catch (err) {
      console.error('Error in GET /api/reports/bi:', err);
      res.status(500).json({ error: 'Error consultando reporte BI' });
    }
  });

  // GET /api/reports/analytics
  router.get('/analytics', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { salon_id = 'all', start_date, end_date } = req.query;

      const startDate = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const endDate = end_date || new Date().toISOString().split('T')[0];

      const salonFilterPay = salon_id !== 'all' ? 'AND COALESCE(p.salon_id, cl.salon_id, 1)::text = ?' : '';
      const salonFilterVis = salon_id !== 'all' ? 'AND v.salon_id::text = ?' : '';
      const payParams = salon_id !== 'all' ? [tenantId, startDate, endDate + ' 23:59:59', String(salon_id)] : [tenantId, startDate, endDate + ' 23:59:59'];
      const visParams = salon_id !== 'all' ? [tenantId, startDate, endDate + ' 23:59:59', String(salon_id)] : [tenantId, startDate, endDate + ' 23:59:59'];
      const dailySalesParams = salon_id !== 'all'
        ? [tenantId, startDate, endDate + ' 23:59:59', String(salon_id), tenantId, startDate, endDate + ' 23:59:59', String(salon_id)]
        : [tenantId, startDate, endDate + ' 23:59:59', tenantId, startDate, endDate + ' 23:59:59'];
      const combinedParams = salon_id !== 'all'
        ? [tenantId, startDate, endDate + ' 23:59:59', tenantId, startDate, endDate + ' 23:59:59', String(salon_id)]
        : [tenantId, startDate, endDate + ' 23:59:59', tenantId, startDate, endDate + ' 23:59:59'];

      const [
        [dailySales],
        [renewalRow],
        [visitRows],
        [activeRow],
        [cancelledRow],
        [inactiveRows],
        [paymentBreakdown],
        [clientVisitCounts],
        [cashPayments],
        [detailedPayments]
      ] = await Promise.all([
        // 1. Daily Sales
        pool.query(`
          SELECT date, SUM(total) as total FROM (
            SELECT DATE(p.created_at) as date, SUM(p.amount) as total
            FROM payments p
            LEFT JOIN clients cl ON p.client_id = cl.id AND cl.tenant_id = p.tenant_id
            WHERE p.tenant_id = ? AND p.created_at >= ? AND p.created_at <= ? AND p.status = 'Aprobado' ${salonFilterPay}
            GROUP BY DATE(p.created_at)

            UNION ALL

            SELECT DATE(v.visited_at) as date, SUM(v.total) as total
            FROM visits v
            LEFT JOIN clients cl ON (v.client_id = cl.id OR v.client_name = cl.nombre) AND cl.tenant_id = v.tenant_id
            WHERE v.tenant_id = ? AND v.visited_at >= ? AND v.visited_at <= ? AND v.status = 'Facturado' AND v.total > 0 ${salon_id !== 'all' ? 'AND COALESCE(v.salon_id, cl.salon_id, 1)::text = ?' : ''}
            GROUP BY DATE(v.visited_at)
          ) combined_sales
          GROUP BY date
          ORDER BY date ASC
        `, dailySalesParams),

        // 2. Renewal Revenue
        pool.query(`
          SELECT SUM(p.amount) as total
          FROM payments p
          LEFT JOIN clients cl ON p.client_id = cl.id AND cl.tenant_id = p.tenant_id
          WHERE p.tenant_id = ? AND p.created_at >= ? AND p.created_at <= ? AND p.status = 'Aprobado' 
            AND (p.plan_id IS NOT NULL AND p.plan_id != '' AND p.plan_id != 'gift_card') ${salonFilterPay}
        `, payParams),

        // 3. Commissions
        pool.query(`
          SELECT v.id, v.visited_at, v.empleado_peluquera, v.empleado_manicurista, v.total, v.servicios
          FROM visits v
          WHERE v.tenant_id = ? AND v.visited_at >= ? AND v.visited_at <= ? ${salonFilterVis}
        `, visParams),

        // 4. Active summary
        pool.query("SELECT COUNT(DISTINCT client_id) as count FROM contracts WHERE tenant_id = ? AND status IN ('Active', 'Activo')", [tenantId]),

        // 5. Cancelled summary
        pool.query("SELECT COUNT(DISTINCT client_id) as count FROM contracts WHERE tenant_id = ? AND status IN ('Cancelled', 'Cancelado')", [tenantId]),

        // 6. Inactive clients (>15 days without visit)
        pool.query(`
          SELECT c.id, c.nombre, c.telefono, MAX(v.visited_at) as last_visit
          FROM clients c
          LEFT JOIN visits v ON c.id = v.client_id AND v.tenant_id = c.tenant_id
          WHERE c.tenant_id = ?
          GROUP BY c.id, c.nombre, c.telefono
          HAVING MAX(v.visited_at) IS NULL OR MAX(v.visited_at) < DATE_SUB(NOW(), INTERVAL 15 DAY)
          ORDER BY last_visit ASC
          LIMIT 50
        `, [tenantId]),

        // 7. Payment breakdown
        pool.query(`
          SELECT method, COUNT(*) as count, SUM(amount) as total FROM (
            SELECT p.method, p.amount
            FROM payments p
            LEFT JOIN clients cl ON p.client_id = cl.id AND cl.tenant_id = p.tenant_id
            WHERE p.tenant_id = ? AND p.created_at >= ? AND p.created_at <= ? AND p.status = 'Aprobado' ${salonFilterPay}

            UNION ALL

            SELECT COALESCE(v.metodo_pago, 'Efectivo') as method, v.total as amount
            FROM visits v
            LEFT JOIN clients cl ON (v.client_id = cl.id OR v.client_name = cl.nombre) AND cl.tenant_id = v.tenant_id
            WHERE v.tenant_id = ? AND v.visited_at >= ? AND v.visited_at <= ? AND v.status = 'Facturado' AND v.total > 0 ${salon_id !== 'all' ? 'AND COALESCE(v.salon_id, cl.salon_id, 1)::text = ?' : ''}
          ) combined_pay
          GROUP BY method
          ORDER BY total DESC
        `, dailySalesParams),

        // 8. Visit Frequency
        pool.query(`
          SELECT client_id, COUNT(*) as visit_count
          FROM visits v
          WHERE v.tenant_id = ? AND v.visited_at >= ? AND v.visited_at <= ? ${salonFilterVis}
          GROUP BY client_id
        `, visParams),

        // 9. Cash payments
        pool.query(`
          SELECT p.id, p.created_at, p.amount, p.method, cl.nombre as client_name, s.name as salon_name, 'Caja Principal' as applied_by
          FROM payments p
          LEFT JOIN clients cl ON p.client_id = cl.id AND cl.tenant_id = p.tenant_id
          LEFT JOIN salons s ON (COALESCE(p.salon_id, cl.salon_id, 1)::text = s.id::text AND s.tenant_id = p.tenant_id)
          WHERE p.tenant_id = ? AND p.created_at >= ? AND p.created_at <= ? AND p.status = 'Aprobado' 
            AND (LOWER(p.method) LIKE '%efectivo%' OR LOWER(p.method) LIKE '%cash%') ${salonFilterPay}
          ORDER BY p.created_at DESC
          LIMIT 100
        `, payParams),

        // 10. Detailed Payments
        pool.query(`
          SELECT * FROM (
            SELECT p.id, 
                   p.created_at, 
                   p.amount, 
                   p.method, 
                   p.status,
                   COALESCE(p.description, 
                     CASE 
                       WHEN p.plan_id IS NOT NULL AND p.plan_id != '' THEN CONCAT('Plan: ', p.plan_id)
                       ELSE 'Cobro de Plan / Suscripción'
                     END
                   ) as description,
                   p.gateway_ref,
                   p.applied_by,
                   COALESCE(cl.nombre, p.client_id, 'Cliente General') as client_name,
                   COALESCE(cl.telefono, 'N/D') as client_phone,
                   COALESCE(s.name, 'Principal') as salon_name,
                   COALESCE(p.salon_id, cl.salon_id, 1)::text as salon_id
            FROM payments p
            LEFT JOIN clients cl ON p.client_id = cl.id AND cl.tenant_id = p.tenant_id
            LEFT JOIN salons s ON (COALESCE(p.salon_id, cl.salon_id, 1)::text = s.id::text AND s.tenant_id = p.tenant_id)
            WHERE p.tenant_id = ? AND p.created_at >= ? AND p.created_at <= ? AND p.status = 'Aprobado'

            UNION ALL

            SELECT v.id,
                   v.visited_at as created_at,
                   v.total as amount,
                   COALESCE(v.metodo_pago, 'Efectivo') as method,
                   'Aprobado' as status,
                   CONCAT('Venta POS / Servicio: Ticket #', COALESCE(v.ticket_number, v.id)) as description,
                   v.ticket_number as gateway_ref,
                   'Caja POS' as applied_by,
                   COALESCE(v.client_name, cl.nombre, 'Cliente General') as client_name,
                   COALESCE(cl.telefono, 'N/D') as client_phone,
                   COALESCE(s.name, 'Principal') as salon_name,
                   COALESCE(v.salon_id, cl.salon_id, 1)::text as salon_id
            FROM visits v
            LEFT JOIN clients cl ON (v.client_id = cl.id OR v.client_name = cl.nombre) AND cl.tenant_id = v.tenant_id
            LEFT JOIN salons s ON (COALESCE(v.salon_id, cl.salon_id, 1)::text = s.id::text AND s.tenant_id = v.tenant_id)
            WHERE v.tenant_id = ? AND v.visited_at >= ? AND v.visited_at <= ? AND v.status = 'Facturado' AND v.total > 0
          ) combined
          WHERE 1=1 ${salon_id !== 'all' ? 'AND combined.salon_id = ?' : ''}
          ORDER BY combined.created_at DESC
          LIMIT 500
        `, combinedParams)
      ]);

      const empMap = {};
      visitRows.forEach(v => {
        let svcCount = 1;
        try {
          if (Array.isArray(v.servicios)) svcCount = v.servicios.length;
          else if (typeof v.servicios === 'string' && v.servicios.startsWith('[')) svcCount = JSON.parse(v.servicios).length;
        } catch (e) {}

        if (v.empleado_peluquera && v.empleado_peluquera !== 'No asignada') {
          const name = v.empleado_peluquera.trim();
          if (!empMap[name]) empMap[name] = { nombre: name, posicion: 'Estilista / Peluquera', servicios: 0, comision: 0 };
          empMap[name].servicios += svcCount;
          empMap[name].comision += Number(v.total || 0) * 0.15;
        }
        if (v.empleado_manicurista && v.empleado_manicurista !== 'No asignada') {
          const name = v.empleado_manicurista.trim();
          if (!empMap[name]) empMap[name] = { nombre: name, posicion: 'Técnica / Manicurista', servicios: 0, comision: 0 };
          empMap[name].servicios += svcCount;
          empMap[name].comision += Number(v.total || 0) * 0.10;
        }
      });
      const commissions = Object.values(empMap);

      const freqMap = {};
      clientVisitCounts.forEach(r => {
        const cnt = r.visit_count;
        freqMap[cnt] = (freqMap[cnt] || 0) + 1;
      });
      const visitFrequency = Object.keys(freqMap)
        .map(k => ({ visit_count: parseInt(k, 10), client_count: freqMap[k] }))
        .sort((a, b) => a.visit_count - b.visit_count);

      res.json({
        dailySales,
        renewalRevenue: renewalRow[0]?.total || 0,
        commissions,
        clientSummary: {
          active: activeRow[0]?.count || 0,
          cancelled: cancelledRow[0]?.count || 0
        },
        inactiveClients: inactiveRows,
        paymentBreakdown,
        visitFrequency,
        cashPayments,
        detailedPayments
      });
    } catch (err) {
      console.error('Error in /api/reports/analytics:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = {
  createReportsRouter
};
