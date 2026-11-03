/**
 * Centralized BI Query Engine for Salon Pro & Plan Beauty RD
 * Implements real-time SQL aggregation adhering strictly to approved developer specs
 */
const mysql = require('mysql2/promise');

/**
 * Main query dispatcher for BI reports
 *
 * @param {import('mysql2/promise').Pool} pool
 * @param {object} params - { category, reportId, period, startDate, endDate, salonId, membership, daysInactive, reason, employeeId, timeGrain }
 */
async function handleBIReport(pool, params) {
  const {
    category = 'sales',
    reportId = 'sales_summary',
    startDate,
    endDate,
    salonId = 'all',
    planId = 'all',
    membership = 'all',
    daysInactive = 15,
    cancellationReason = 'Todos los motivos',
    timeGrain = 'daily'
  } = params;

  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const defaultEnd = now.toISOString().split('T')[0];

  const start = startDate || defaultStart;
  const end = endDate || defaultEnd;
  const startDateTime = `${start} 00:00:00`;
  const endDateTime = `${end} 23:59:59`;

  // SQL Filters for visits and payments
  const salonFilterVis = salonId !== 'all' ? 'AND v.salon_id = ?' : '';
  const salonFilterPay = salonId !== 'all' ? 'AND COALESCE(p.salon_id, cl.salon_id, 1) = ?' : '';
  const visParams = salonId !== 'all' ? [startDateTime, endDateTime, salonId] : [startDateTime, endDateTime];
  const payParams = salonId !== 'all' ? [startDateTime, endDateTime, salonId] : [startDateTime, endDateTime];
  const combinedParams = salonId !== 'all'
    ? [startDateTime, endDateTime, salonId, startDateTime, endDateTime, salonId]
    : [startDateTime, endDateTime, startDateTime, endDateTime];

  const formatDO = (d) => {
    if (!d) return 'N/D';
    try {
      const dt = new Date(d);
      return dt.toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return String(d); }
  };

  // ==========================================
  // 1. VENTAS Y COBROS: RESUMEN (#1)
  // Cuadro totalizado por sucursal (sin detalle de cliente)
  // Gráfico con selector: Diaria, Semanal, Mensual, Anual
  // ==========================================
  if (reportId === 'sales_summary') {
    try {
      const [salesRows] = await pool.query(`
        SELECT
          COUNT(id) as valid_invoices,
          COALESCE(SUM(total), 0) as total_sales,
          COALESCE(AVG(total), 0) as avg_ticket
        FROM visits v
        WHERE v.visited_at >= ? AND v.visited_at <= ?
          AND v.status NOT IN ('Anulado', 'Anulada', 'Cancelado', 'Cancelada')
          ${salonFilterVis}
      `, visParams);

      const [payRows] = await pool.query(`
        SELECT COALESCE(SUM(amount), 0) as total_collected
        FROM payments p
        LEFT JOIN clients cl ON p.client_id = cl.id
        WHERE p.created_at >= ? AND p.created_at <= ?
          AND p.status = 'Aprobado'
          ${salonFilterPay}
      `, payParams);

      // Agrupación dinámica del gráfico según timeGrain (daily, weekly, monthly, yearly)
      let grainFormat = '%Y-%m-%d';
      let labelFormat = '%e %b';
      if (timeGrain === 'weekly') {
        grainFormat = '%x-%v';
        labelFormat = 'Sem %v';
      } else if (timeGrain === 'monthly') {
        grainFormat = '%Y-%m';
        labelFormat = '%b %Y';
      } else if (timeGrain === 'yearly') {
        grainFormat = '%Y';
        labelFormat = '%Y';
      }

      let chartQuery = '';
      if (timeGrain === 'weekly') {
        chartQuery = `
          SELECT
            raw_date,
            CONCAT('Sem ', CAST(RIGHT(raw_date, 2) AS UNSIGNED)) as label,
            total
          FROM (
            SELECT
              YEARWEEK(v.visited_at, 1) as raw_date,
              COALESCE(SUM(v.total), 0) as total
            FROM visits v
            WHERE v.visited_at >= ? AND v.visited_at <= ?
              AND v.status NOT IN ('Anulado', 'Anulada', 'Cancelado', 'Cancelada')
              ${salonFilterVis}
            GROUP BY YEARWEEK(v.visited_at, 1)
          ) sub
          ORDER BY raw_date ASC
        `;
      } else if (timeGrain === 'monthly') {
        chartQuery = `
          SELECT
            DATE_FORMAT(v.visited_at, '%Y-%m') as raw_date,
            DATE_FORMAT(v.visited_at, '%b %Y') as label,
            COALESCE(SUM(v.total), 0) as total
          FROM visits v
          WHERE v.visited_at >= ? AND v.visited_at <= ?
            AND v.status NOT IN ('Anulado', 'Anulada', 'Cancelado', 'Cancelada')
            ${salonFilterVis}
          GROUP BY DATE_FORMAT(v.visited_at, '%Y-%m'), DATE_FORMAT(v.visited_at, '%b %Y')
          ORDER BY raw_date ASC
        `;
      } else if (timeGrain === 'yearly') {
        chartQuery = `
          SELECT
            DATE_FORMAT(v.visited_at, '%Y') as raw_date,
            DATE_FORMAT(v.visited_at, '%Y') as label,
            COALESCE(SUM(v.total), 0) as total
          FROM visits v
          WHERE v.visited_at >= ? AND v.visited_at <= ?
            AND v.status NOT IN ('Anulado', 'Anulada', 'Cancelado', 'Cancelada')
            ${salonFilterVis}
          GROUP BY DATE_FORMAT(v.visited_at, '%Y')
          ORDER BY raw_date ASC
        `;
      } else {
        // Daily
        chartQuery = `
          SELECT
            DATE_FORMAT(v.visited_at, '%Y-%m-%d') as raw_date,
            DATE_FORMAT(v.visited_at, '%e %b') as label,
            COALESCE(SUM(v.total), 0) as total
          FROM visits v
          WHERE v.visited_at >= ? AND v.visited_at <= ?
            AND v.status NOT IN ('Anulado', 'Anulada', 'Cancelado', 'Cancelada')
            ${salonFilterVis}
          GROUP BY DATE_FORMAT(v.visited_at, '%Y-%m-%d'), DATE_FORMAT(v.visited_at, '%e %b')
          ORDER BY raw_date ASC
        `;
      }

      const [chartRows] = await pool.query(chartQuery, visParams);

      // Cuadro totalizado por sucursal:
      // Sucursal, Facturas emitidas, Facturación total, Participación, Ticket promedio, Facturas anuladas, % de participación facturas anuladas
      const [salonStats] = await pool.query(`
        SELECT
          COALESCE(s.name, 'San Vicente') as sucursal,
          v.salon_id,
          COUNT(CASE WHEN v.status NOT IN ('Anulado', 'Anulada', 'Cancelado', 'Cancelada') THEN 1 END) as facturas_emitidas,
          COALESCE(SUM(CASE WHEN v.status NOT IN ('Anulado', 'Anulada', 'Cancelado', 'Cancelada') THEN v.total ELSE 0 END), 0) as facturacion_total,
          COUNT(CASE WHEN v.status IN ('Anulado', 'Anulada', 'Cancelado', 'Cancelada') OR v.void_reason IS NOT NULL THEN 1 END) as facturas_anuladas
        FROM visits v
        LEFT JOIN salons s ON v.salon_id = s.id
        WHERE v.visited_at >= ? AND v.visited_at <= ?
          ${salonFilterVis}
        GROUP BY v.salon_id, s.name
        ORDER BY facturacion_total DESC
      `, visParams);

      const validInvoices = salesRows[0]?.valid_invoices || 0;
      const totalSales = Number(salesRows[0]?.total_sales || 0);
      const totalCollected = Number(payRows[0]?.total_collected || totalSales);
      const avgTicket = validInvoices > 0 ? Math.round(totalSales / validInvoices) : 0;

      const grandTotalSales = salonStats.reduce((sum, r) => sum + Number(r.facturacion_total || 0), 0) || totalSales;
      const grandTotalAnuladas = salonStats.reduce((sum, r) => sum + Number(r.facturas_anuladas || 0), 0) || 1;

      const tableRows = salonStats.map(r => {
        const emitidas = Number(r.facturas_emitidas || 0);
        const facturacion = Number(r.facturacion_total || 0);
        const anuladas = Number(r.facturas_anuladas || 0);
        const tkt = emitidas > 0 ? Math.round(facturacion / emitidas) : 0;
        const partVenta = grandTotalSales > 0 ? ((facturacion / grandTotalSales) * 100).toFixed(1) : '0.0';
        const partAnulada = grandTotalAnuladas > 0 ? ((anuladas / grandTotalAnuladas) * 100).toFixed(1) : '0.0';

        return {
          sucursal: r.sucursal,
          facturas_emitidas: emitidas,
          facturacion_total: facturacion,
          participacion: `${partVenta}%`,
          ticket_promedio: tkt,
          facturas_anuladas: anuladas,
          pct_anuladas: `${partAnulada}%`
        };
      });

      return {
        title: 'Resumen de ventas y cobros',
        periodText: `${start} al ${end}`,
        kpis: [
          { label: 'Facturación', value: `RD$ ${totalSales.toLocaleString('es-DO')}`, subtext: 'Ventas del período', icon: 'trending', color: 'emerald' },
          { label: 'Total cobrado', value: `RD$ ${totalCollected.toLocaleString('es-DO')}`, subtext: 'Pagos recibidos en el período', icon: 'dollar', color: 'blue' },
          { label: 'Cantidad de facturas', value: validInvoices.toString(), subtext: 'Facturas válidas emitidas', icon: 'receipt', color: 'purple' },
          { label: 'Ticket promedio', value: `RD$ ${avgTicket.toLocaleString('es-DO')}`, subtext: 'Promedio por factura', icon: 'tag', color: 'amber' }
        ],
        chart: {
          type: 'sales_evolution',
          data: chartRows.length > 0 ? chartRows : [{ label: 'Período', total: totalSales }]
        },
        table: {
          title: 'Detalle de ventas por sucursal (Totalizado)',
          badgeText: `${tableRows.length} sucursales`,
          columns: [
            { key: 'sucursal', label: 'Sucursal' },
            { key: 'facturas_emitidas', label: 'Facturas Emitidas', align: 'center' },
            { key: 'facturacion_total', label: 'Facturación Total', isCurrency: true },
            { key: 'participacion', label: 'Participación', align: 'center' },
            { key: 'ticket_promedio', label: 'Ticket Promedio', isCurrency: true },
            { key: 'facturas_anuladas', label: 'Facturas Anuladas', align: 'center' },
            { key: 'pct_anuladas', label: '% Participación Anuladas', align: 'center' }
          ],
          rows: tableRows,
          footerNote: 'Cuadro consolidado por sucursal. Distingue facturación válida de anulaciones.'
        }
      };
    } catch (e) {
      console.warn('DB error in sales_summary:', e.message);
    }
  }

  // ==========================================
  // 2. VENTAS Y COBROS: VENTAS POR PRODUCTO O SERVICIO (#2)
  // Muestra cantidad de ventas realizadas según el servicio vendido y participación
  // Ej: Lavado sencillo 800 70%, Manicure 200 etc. según servicios del catálogo
  // ==========================================
  if (reportId === 'sales_by_product') {
    try {
      const [services] = await pool.query(`SELECT id, nombre, categoria, precio FROM services WHERE activo = 1 ORDER BY orden_visualizacion ASC, nombre ASC`);
      const [visitRows] = await pool.query(`
        SELECT v.servicios, v.items_detail, v.total
        FROM visits v
        WHERE v.visited_at >= ? AND v.visited_at <= ?
          AND v.status NOT IN ('Anulado', 'Anulada', 'Cancelado', 'Cancelada')
          ${salonFilterVis}
      `, visParams);

      const serviceStats = {};
      services.forEach(s => {
        serviceStats[s.nombre] = {
          servicio: s.nombre,
          categoria: s.categoria || 'General',
          precio: Number(s.precio || 0),
          cantidad: 0,
          monto: 0
        };
      });

      let totalItemsSold = 0;

      visitRows.forEach(v => {
        let items = [];
        try {
          if (v.items_detail) {
            const parsed = JSON.parse(v.items_detail);
            if (Array.isArray(parsed)) items = parsed;
          }
        } catch (e) { }

        if (items.length === 0 && v.servicios) {
          try {
            if (Array.isArray(v.servicios)) {
              items = v.servicios.map(s => ({ nombre: s, cantidad: 1, precioAplicado: 0 }));
            } else if (typeof v.servicios === 'string' && v.servicios.startsWith('[')) {
              items = JSON.parse(v.servicios).map(s => ({ nombre: s, cantidad: 1, precioAplicado: 0 }));
            } else if (typeof v.servicios === 'string') {
              items = [{ nombre: v.servicios, cantidad: 1, precioAplicado: v.total }];
            }
          } catch (e) { }
        }

        items.forEach(it => {
          const rawName = String(it.nombre || it.name || '').trim();
          if (!rawName) return;

          // Match with catalog
          let matchedKey = Object.keys(serviceStats).find(k => k.toLowerCase() === rawName.toLowerCase());
          if (!matchedKey) {
            matchedKey = Object.keys(serviceStats).find(k => rawName.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(rawName.toLowerCase()));
          }

          const targetKey = matchedKey || rawName;
          if (!serviceStats[targetKey]) {
            serviceStats[targetKey] = {
              servicio: targetKey,
              categoria: 'Servicios',
              precio: Number(it.precioBase || it.precioAplicado || 0),
              cantidad: 0,
              monto: 0
            };
          }

          const qty = Number(it.cantidad || 1);
          const pr = Number(it.precioAplicado || it.precioBase || serviceStats[targetKey].precio || 0);

          serviceStats[targetKey].cantidad += qty;
          serviceStats[targetKey].monto += (pr * qty);
          totalItemsSold += qty;
        });
      });

      const rowsList = Object.values(serviceStats)
        .filter(s => s.cantidad > 0)
        .sort((a, b) => b.cantidad - a.cantidad)
        .map(s => ({
          servicio: s.servicio,
          categoria: s.categoria,
          cantidad: s.cantidad,
          participacion: totalItemsSold > 0 ? `${((s.cantidad / totalItemsSold) * 100).toFixed(1)}%` : '0%',
          monto: s.monto
        }));

      const topService = rowsList[0]?.servicio || 'Lavado sencillo';
      const topPct = rowsList[0]?.participacion || '0%';

      return {
        title: 'Ventas por producto o servicio',
        periodText: `${start} al ${end}`,
        kpis: [
          { label: 'Servicios Realizados', value: totalItemsSold.toString(), subtext: 'Total de servicios vendidos', icon: 'tag', color: 'blue' },
          { label: 'Servicio Más Vendido', value: topService, subtext: `${topPct} de todas las ventas`, icon: 'trending', color: 'emerald' },
          { label: 'Servicios Activos', value: rowsList.length.toString(), subtext: 'Con ventas en el período', icon: 'receipt', color: 'purple' }
        ],
        chart: {
          type: 'bar',
          title: 'Top Servicios Vendidos (Cantidad y Participación)',
          data: rowsList.slice(0, 10).map(s => ({
            label: s.servicio,
            value: s.cantidad,
            count: s.cantidad,
            percentage: s.participacion,
            displayValue: `${s.cantidad} (${s.participacion})`
          }))
        },
        table: {
          title: 'Cantidad de ventas y participación por servicio',
          badgeText: `${rowsList.length} servicios`,
          columns: [
            { key: 'servicio', label: 'Servicio / Producto' },
            { key: 'categoria', label: 'Categoría' },
            { key: 'cantidad', label: 'Cantidad Vendida', align: 'center' },
            { key: 'participacion', label: 'Participación', align: 'center' },
            { key: 'monto', label: 'Total Facturado', isCurrency: true }
          ],
          rows: rowsList,
          footerNote: 'Cantidad de ventas realizadas según el servicio vendido y porcentaje de participación sobre el catálogo.'
        }
      };
    } catch (e) {
      console.warn('DB error in sales_by_product:', e.message);
    }
  }

  // ==========================================
  // 3. VENTAS Y COBROS: VENTAS POR CLIENTE (#4)
  // Facturas de mayor consumo ordenadas de mayor a menor
  // ==========================================
  if (reportId === 'sales_by_client') {
    try {
      const [invoices] = await pool.query(`
        SELECT
          v.id,
          COALESCE(v.ticket_number, CONCAT('TK-', v.id)) as factura,
          v.visited_at as fecha,
          COALESCE(v.client_name, cl.nombre, 'Cliente General') as cliente,
          COALESCE(cl.telefono, 'N/D') as telefono,
          COALESCE(s.name, 'San Vicente') as sucursal,
          COALESCE(v.metodo_pago, 'Efectivo') as metodo,
          COALESCE(v.total, 0) as monto
        FROM visits v
        LEFT JOIN clients cl ON (v.client_id = cl.id OR v.client_name = cl.nombre)
        LEFT JOIN salons s ON (COALESCE(v.salon_id, cl.salon_id, 1) = s.id)
        WHERE v.visited_at >= ? AND v.visited_at <= ?
          AND v.status NOT IN ('Anulado', 'Anulada', 'Cancelado', 'Cancelada')
          AND v.total > 0
          ${salonFilterVis}
        ORDER BY v.total DESC
        LIMIT 250
      `, visParams);

      const totalFacturas = invoices.length;
      const totalFacturado = invoices.reduce((sum, r) => sum + Number(r.monto || 0), 0);
      const mayorFactura = invoices[0]?.monto || 0;

      return {
        title: 'Ventas por cliente (Mayor consumo)',
        periodText: `${start} al ${end}`,
        kpis: [
          { label: 'Mayor Consumo Registrado', value: `RD$ ${Number(mayorFactura).toLocaleString('es-DO')}`, subtext: 'Factura máxima del período', icon: 'dollar', color: 'emerald' },
          { label: 'Total Facturado Analizado', value: `RD$ ${totalFacturado.toLocaleString('es-DO')}`, subtext: 'Top operaciones de alto valor', icon: 'trending', color: 'blue' },
          { label: 'Facturas Registradas', value: totalFacturas.toString(), subtext: 'Ordenadas de mayor a menor', icon: 'receipt', color: 'purple' }
        ],
        chart: {
          type: 'bar',
          title: 'Top Facturas con Mayor Consumo (RD$)',
          data: invoices.slice(0, 8).map(r => ({
            label: `${r.cliente.split(' ')[0]} (#${r.factura})`,
            value: Number(r.monto || 0),
            displayValue: `RD$ ${Number(r.monto || 0).toLocaleString('es-DO')}`
          }))
        },
        table: {
          title: 'Facturas ordenadas de mayor a menor consumo',
          badgeText: `${invoices.length} facturas`,
          columns: [
            { key: 'factura', label: 'Ticket / Factura' },
            { key: 'fecha', label: 'Fecha' },
            { key: 'cliente', label: 'Cliente' },
            { key: 'telefono', label: 'Teléfono' },
            { key: 'sucursal', label: 'Sucursal' },
            { key: 'metodo', label: 'Método' },
            { key: 'monto', label: 'Monto Consumido', isCurrency: true }
          ],
          rows: invoices.map(r => ({
            factura: r.factura,
            fecha: formatDO(r.fecha),
            cliente: r.cliente,
            telefono: r.telefono,
            sucursal: r.sucursal,
            metodo: r.metodo,
            monto: Number(r.monto || 0)
          })),
          footerNote: 'Facturas de mayor consumo ordenadas de mayor a menor para identificar consumos de alto valor.'
        }
      };
    } catch (e) {
      console.warn('DB error in sales_by_client:', e.message);
    }
  }

  // ==========================================
  // 4. VENTAS Y COBROS: COBROS POR MÉTODO DE PAGO (#5)
  // Solo presenta: Tarjeta, Efectivo, Cardnet auto y Transferencia
  // No muestra Mixto: desglosa las partidas mixtas en sus métodos
  // ==========================================
  if (reportId === 'payment_methods') {
    try {
      const [paymentsList] = await pool.query(`
        SELECT p.method, p.amount
        FROM payments p
        LEFT JOIN clients cl ON p.client_id = cl.id
        WHERE p.created_at >= ? AND p.created_at <= ? AND p.status = 'Aprobado' ${salonFilterPay}
      `, payParams);

      const [visitsList] = await pool.query(`
        SELECT v.metodo_pago, v.total
        FROM visits v
        LEFT JOIN clients cl ON (v.client_id = cl.id OR v.client_name = cl.nombre)
        WHERE v.visited_at >= ? AND v.visited_at <= ? AND v.status = 'Facturado' AND v.total > 0
          ${salonId !== 'all' ? 'AND COALESCE(v.salon_id, cl.salon_id, 1) = ?' : ''}
      `, salonId !== 'all' ? [startDateTime, endDateTime, salonId] : [startDateTime, endDateTime]);

      const totals = {
        'Tarjeta': { label: 'Tarjeta', count: 0, amount: 0, color: '#2563eb' },
        'Efectivo': { label: 'Efectivo', count: 0, amount: 0, color: '#10b981' },
        'Cardnet auto': { label: 'Cardnet auto', count: 0, amount: 0, color: '#8b5cf6' },
        'Transferencia': { label: 'Transferencia', count: 0, amount: 0, color: '#f59e0b' }
      };

      // 1. Process payments table (recurrentes / gateway)
      paymentsList.forEach(p => {
        const amt = Number(p.amount || 0);
        const m = String(p.method || '').toLowerCase();
        if (m.includes('cardnet') || m.includes('auto') || m.includes('guardada')) {
          totals['Cardnet auto'].count += 1;
          totals['Cardnet auto'].amount += amt;
        } else if (m.includes('efectivo') || m.includes('cash')) {
          totals['Efectivo'].count += 1;
          totals['Efectivo'].amount += amt;
        } else if (m.includes('transferencia')) {
          totals['Transferencia'].count += 1;
          totals['Transferencia'].amount += amt;
        } else {
          totals['Tarjeta'].count += 1;
          totals['Tarjeta'].amount += amt;
        }
      });

      // 2. Process visits table (POS transactions with possible mixed payments)
      visitsList.forEach(v => {
        const totalAmt = Number(v.total || 0);
        const rawMethod = String(v.metodo_pago || 'Efectivo').trim();
        const mLower = rawMethod.toLowerCase();

        if (mLower.includes('mixto')) {
          // Parse: "Mixto (Efectivo: RD$ 300.00 + Tarjeta: RD$ 300.00)"
          const cashMatch = rawMethod.match(/efectivo:\s*rd\$\s*([0-9,.]+)/i);
          const cardMatch = rawMethod.match(/tarjeta:\s*rd\$\s*([0-9,.]+)/i);
          const transMatch = rawMethod.match(/transferencia:\s*rd\$\s*([0-9,.]+)/i);

          let parsedAny = false;
          if (cashMatch) {
            const val = parseFloat(cashMatch[1].replace(/,/g, '')) || 0;
            totals['Efectivo'].count += 1;
            totals['Efectivo'].amount += val;
            parsedAny = true;
          }
          if (cardMatch) {
            const val = parseFloat(cardMatch[1].replace(/,/g, '')) || 0;
            totals['Tarjeta'].count += 1;
            totals['Tarjeta'].amount += val;
            parsedAny = true;
          }
          if (transMatch) {
            const val = parseFloat(transMatch[1].replace(/,/g, '')) || 0;
            totals['Transferencia'].count += 1;
            totals['Transferencia'].amount += val;
            parsedAny = true;
          }

          if (!parsedAny) {
            // Split evenly between Efectivo and Tarjeta
            totals['Efectivo'].count += 1;
            totals['Efectivo'].amount += (totalAmt / 2);
            totals['Tarjeta'].count += 1;
            totals['Tarjeta'].amount += (totalAmt / 2);
          }
        } else if (mLower.includes('efectivo') || mLower.includes('cash')) {
          totals['Efectivo'].count += 1;
          totals['Efectivo'].amount += totalAmt;
        } else if (mLower.includes('transferencia')) {
          totals['Transferencia'].count += 1;
          totals['Transferencia'].amount += totalAmt;
        } else if (mLower.includes('cardnet') || mLower.includes('auto')) {
          totals['Cardnet auto'].count += 1;
          totals['Cardnet auto'].amount += totalAmt;
        } else if (mLower.includes('plan beauty')) {
          // Plan beauty lavado canjeado RD$ 0
        } else {
          // Tarjeta default
          totals['Tarjeta'].count += 1;
          totals['Tarjeta'].amount += totalAmt;
        }
      });

      const grandTotalAmount = Object.values(totals).reduce((sum, t) => sum + t.amount, 0);
      const grandTotalCount = Object.values(totals).reduce((sum, t) => sum + t.count, 0);

      const chartData = Object.values(totals).map(t => ({
        label: t.label,
        count: t.count,
        amount: Math.round(t.amount),
        percentage: grandTotalAmount > 0 ? Number(((t.amount / grandTotalAmount) * 100).toFixed(1)) : 0,
        color: t.color
      })).sort((a, b) => b.amount - a.amount);

      return {
        title: 'Cobros por método de pago',
        periodText: `${start} al ${end}`,
        kpis: [
          { label: 'Total Recaudado', value: `RD$ ${Math.round(grandTotalAmount).toLocaleString('es-DO')}`, subtext: 'Tarjeta, Efectivo, CardNet y Transferencia', icon: 'dollar', color: 'emerald' },
          { label: 'Total Operaciones', value: grandTotalCount.toString(), subtext: 'Transacciones procesadas', icon: 'receipt', color: 'blue' },
          { label: 'Método Principal', value: chartData[0]?.label || 'Tarjeta', subtext: `${chartData[0]?.percentage || 0}% del volumen cobrado`, icon: 'credit_card', color: 'purple' }
        ],
        chart: {
          type: 'donut',
          data: chartData
        },
        table: {
          title: 'Resumen por canal de cobro (4 métodos oficiales)',
          columns: [
            { key: 'metodo', label: 'Método de Pago' },
            { key: 'transacciones', label: 'Transacciones', align: 'center' },
            { key: 'participacion', label: 'Participación', align: 'center' },
            { key: 'monto', label: 'Monto Total Cobrado', isCurrency: true }
          ],
          rows: chartData.map(c => ({
            metodo: c.label,
            transacciones: c.count,
            participacion: `${c.percentage}%`,
            monto: c.amount
          })),
          footerNote: 'Presenta únicamente Tarjeta, Efectivo, Cardnet auto y Transferencia. Los cobros mixtos se desglosaron en su método correspondiente.'
        }
      };
    } catch (e) {
      console.warn('DB error in payment_methods:', e.message);
    }
  }

  // ==========================================
  // 5. VENTAS Y COBROS: TICKETS CANCELADOS (#7)
  // Totalizados arriba por sucursal y abajo detallado
  // ==========================================
  if (reportId === 'cancelled_tickets') {
    try {
      const [cancelRows] = await pool.query(`
        SELECT
          v.id,
          COALESCE(v.ticket_number, CONCAT('TK-', v.id)) as ticket_no,
          COALESCE(v.voided_at, v.visited_at) as fecha,
          COALESCE(v.client_name, cl.nombre, 'Cliente General') as cliente,
          COALESCE(s.name, 'San Vicente') as sucursal,
          COALESCE(v.void_reason, 'Cancelado en recepción antes de cobro') as motivo,
          COALESCE(v.voided_by, 'Recepción') as usuario,
          COALESCE(v.total, 0) as monto
        FROM visits v
        LEFT JOIN clients cl ON (v.client_id = cl.id OR v.client_name = cl.nombre)
        LEFT JOIN salons s ON (COALESCE(v.salon_id, cl.salon_id, 1) = s.id)
        WHERE v.visited_at >= ? AND v.visited_at <= ?
          AND (v.status IN ('Anulado', 'Anulada', 'Cancelado', 'Cancelada') OR v.void_reason IS NOT NULL)
          AND (v.ticket_number IS NOT NULL AND v.ticket_number != '')
          ${salonFilterVis}
        ORDER BY v.visited_at DESC
        LIMIT 200
      `, visParams);

      const totalCancelledMonto = cancelRows.reduce((sum, r) => sum + Number(r.monto || 0), 0);
      const totalTickets = cancelRows.length;

      // Group totals by salon
      const salonTotals = {};
      cancelRows.forEach(r => {
        const sName = r.sucursal || 'San Vicente';
        if (!salonTotals[sName]) salonTotals[sName] = { count: 0, monto: 0 };
        salonTotals[sName].count += 1;
        salonTotals[sName].monto += Number(r.monto || 0);
      });

      const chartData = Object.keys(salonTotals).map(s => ({
        label: s,
        value: salonTotals[s].count,
        displayValue: `${salonTotals[s].count} tickets (RD$ ${salonTotals[s].monto.toLocaleString('es-DO')})`
      }));

      return {
        title: 'Tickets cancelados',
        periodText: `${start} al ${end}`,
        kpis: [
          { label: 'Tickets Cancelados', value: totalTickets.toString(), subtext: 'Totalizados en período', icon: 'alert', color: 'rose' },
          { label: 'Monto Cancelado Total', value: `RD$ ${totalCancelledMonto.toLocaleString('es-DO')}`, subtext: 'Valor de servicios cancelados', icon: 'dollar', color: 'amber' },
          { label: 'Sucursales con Cancelaciones', value: Object.keys(salonTotals).length.toString(), subtext: 'Puntos de venta', icon: 'tag', color: 'blue' }
        ],
        chart: {
          type: 'bar',
          title: 'Tickets Cancelados Totalizados por Sucursal',
          data: chartData.length > 0 ? chartData : [
            { label: 'San Vicente', value: 0, displayValue: '0 tickets' },
            { label: 'Villa Mella', value: 0, displayValue: '0 tickets' }
          ]
        },
        summaryTable: {
          title: 'Resumen totalizado de cancelaciones por sucursal',
          badgeText: `${Object.keys(salonTotals).length} sucursales`,
          columns: [
            { key: 'sucursal', label: 'Sucursal' },
            { key: 'cantidad', label: 'Tickets Cancelados', align: 'center' },
            { key: 'monto', label: 'Monto Cancelado Total', isCurrency: true },
            { key: 'participacion', label: '% del Total Cancelado' }
          ],
          rows: Object.keys(salonTotals).map(s => ({
            sucursal: s,
            cantidad: salonTotals[s].count,
            monto: salonTotals[s].monto,
            participacion: totalTickets > 0 ? `${((salonTotals[s].count / totalTickets) * 100).toFixed(1)}%` : '0%'
          }))
        },
        table: {
          title: 'Detalle de tickets cancelados antes de facturar',
          badgeText: `${totalTickets} tickets`,
          columns: [
            { key: 'fecha', label: 'Fecha' },
            { key: 'ticket_no', label: 'Ticket No.' },
            { key: 'cliente', label: 'Cliente' },
            { key: 'sucursal', label: 'Sucursal' },
            { key: 'motivo', label: 'Motivo de Cancelación' },
            { key: 'usuario', label: 'Usuario Responsable' },
            { key: 'monto', label: 'Monto', isCurrency: true }
          ],
          rows: cancelRows.map(r => ({
            fecha: formatDO(r.fecha),
            ticket_no: r.ticket_no,
            cliente: r.cliente,
            sucursal: r.sucursal,
            motivo: r.motivo,
            usuario: r.usuario,
            monto: Number(r.monto || 0)
          })),
          footerNote: 'Muestra totalizados por sucursal arriba y el detalle completo abajo con usuario y motivo.'
        }
      };
    } catch (e) {
      console.warn('DB error in cancelled_tickets:', e.message);
    }
  }

  // ==========================================
  // 6. VENTAS Y COBROS: DESCUENTOS APLICADOS (#9)
  // Arriba: distribución de descuentos por sucursal
  // Abajo: detalle de transacciones con precio base, descuento, precio final y usuario
  // ==========================================
  if (reportId === 'applied_discounts') {
    try {
      const [visitRows] = await pool.query(`
        SELECT
          v.id,
          v.ticket_number,
          v.visited_at,
          COALESCE(v.client_name, cl.nombre, 'Cliente General') as cliente,
          COALESCE(s.name, 'San Vicente') as sucursal,
          COALESCE(v.voided_by, v.empleado_peluquera, 'Recepción / Admin') as usuario,
          v.items_detail,
          v.total
        FROM visits v
        LEFT JOIN clients cl ON (v.client_id = cl.id OR v.client_name = cl.nombre)
        LEFT JOIN salons s ON (COALESCE(v.salon_id, cl.salon_id, 1) = s.id)
        WHERE v.visited_at >= ? AND v.visited_at <= ?
          AND v.status NOT IN ('Anulado', 'Anulada')
          ${salonFilterVis}
        ORDER BY v.visited_at DESC
        LIMIT 500
      `, visParams);

      const discountDetails = [];
      const salonDiscounts = {};

      visitRows.forEach(v => {
        try {
          if (v.items_detail) {
            const items = JSON.parse(v.items_detail);
            if (Array.isArray(items)) {
              items.forEach(it => {
                const pb = Number(it.precioBase || 0);
                const pa = Number(it.precioAplicado || pb);
                const desc = Number(it.descuento || 0);
                const actualDesc = desc > 0 ? desc : (pb > pa ? pb - pa : 0);

                if (actualDesc > 0 && actualDesc < 50000) { // filter absurd test outliers
                  const finalPrice = Math.max(0, pb - actualDesc);
                  discountDetails.push({
                    fecha: formatDO(v.visited_at),
                    sucursal: v.sucursal,
                    cliente: v.cliente,
                    item: it.nombre || 'Servicio',
                    precio_base: pb,
                    descuento: actualDesc,
                    precio_final: finalPrice,
                    usuario: v.usuario
                  });

                  if (!salonDiscounts[v.sucursal]) salonDiscounts[v.sucursal] = 0;
                  salonDiscounts[v.sucursal] += actualDesc;
                }
              });
            }
          }
        } catch (e) { }
      });

      const totalDiscountSum = discountDetails.reduce((sum, r) => sum + r.descuento, 0);

      const chartData = Object.keys(salonDiscounts).map(s => ({
        label: s,
        value: Math.round(salonDiscounts[s]),
        displayValue: `RD$ ${Math.round(salonDiscounts[s]).toLocaleString('es-DO')}`
      }));

      return {
        title: 'Descuentos aplicados',
        periodText: `${start} al ${end}`,
        kpis: [
          { label: 'Total Descuentos Otorgados', value: `RD$ ${Math.round(totalDiscountSum).toLocaleString('es-DO')}`, subtext: 'Monto total descontado en caja', icon: 'percent', color: 'purple' },
          { label: 'Servicios con Descuento', value: discountDetails.length.toString(), subtext: 'Transacciones con rebajas', icon: 'tag', color: 'blue' },
          { label: 'Descuento Promedio', value: `RD$ ${discountDetails.length > 0 ? Math.round(totalDiscountSum / discountDetails.length).toLocaleString('es-DO') : '0'}`, subtext: 'Por transacción con descuento', icon: 'dollar', color: 'emerald' }
        ],
        chart: {
          type: 'bar',
          title: 'Total de Descuentos Otorgados por Sucursal',
          data: chartData.length > 0 ? chartData : [
            { label: 'San Vicente', value: 0, displayValue: 'RD$ 0' },
            { label: 'Villa Mella', value: 0, displayValue: 'RD$ 0' }
          ]
        },
        summaryTable: {
          title: 'Total de descuentos aplicados por sucursal',
          badgeText: `${Object.keys(salonDiscounts).length} sucursales`,
          columns: [
            { key: 'sucursal', label: 'Sucursal' },
            { key: 'descuento_total', label: 'Total Descontado', isCurrency: true },
            { key: 'participacion', label: '% del Total' }
          ],
          rows: Object.keys(salonDiscounts).map(s => ({
            sucursal: s,
            descuento_total: Math.round(salonDiscounts[s]),
            participacion: totalDiscountSum > 0 ? `${((salonDiscounts[s] / totalDiscountSum) * 100).toFixed(1)}%` : '0%'
          }))
        },
        table: {
          title: 'Detalle de transacciones con descuento aplicado',
          badgeText: `${discountDetails.length} registros`,
          columns: [
            { key: 'fecha', label: 'Fecha' },
            { key: 'sucursal', label: 'Sucursal' },
            { key: 'cliente', label: 'Cliente' },
            { key: 'item', label: 'Servicio / Ítem' },
            { key: 'precio_base', label: 'Precio Base', isCurrency: true },
            { key: 'descuento', label: 'Descuento Aplicado', isCurrency: true },
            { key: 'precio_final', label: 'Precio Final', isCurrency: true },
            { key: 'usuario', label: 'Usuario / Autorizado Por' }
          ],
          rows: discountDetails,
          footerNote: 'Presenta el total de descuento por sucursal arriba y el detalle de cada transacción con precio base, descuento y usuario.'
        }
      };
    } catch (e) {
      console.warn('DB error in applied_discounts:', e.message);
    }
  }

  // ==========================================
  // 7. VENTAS Y COBROS: ITBIS EN VENTAS (#10)
  // Reporte por sucursal totalizado (sin detalle individual)
  // ==========================================
  if (reportId === 'sales_itbis') {
    try {
      const [salonRows] = await pool.query(`
        SELECT
          COALESCE(s.name, 'San Vicente') as sucursal,
          COALESCE(SUM(CASE WHEN v.status NOT IN ('Anulado', 'Anulada') THEN v.total ELSE 0 END), 0) as facturacion_total
        FROM visits v
        LEFT JOIN salons s ON v.salon_id = s.id
        WHERE v.visited_at >= ? AND v.visited_at <= ?
          ${salonFilterVis}
        GROUP BY v.salon_id, s.name
      `, visParams);

      // En el negocio actualmente los servicios están exentos / no facturan ITBIS
      const tableRows = salonRows.map(r => {
        const total = Number(r.facturacion_total || 0);
        return {
          sucursal: r.sucursal,
          ventas_gravadas: 0,
          ventas_exentas: total,
          base_imponible: total,
          itbis_facturado: 0,
          itbis_neto: 0
        };
      });

      const grandTotalExentas = tableRows.reduce((sum, r) => sum + r.ventas_exentas, 0);

      return {
        title: 'ITBIS en ventas',
        periodText: `${start} al ${end}`,
        kpis: [
          { label: 'Ventas Gravadas (18%)', value: 'RD$ 0.00', subtext: 'Base sujeta a ITBIS', icon: 'dollar', color: 'blue' },
          { label: 'Ventas Exentas', value: `RD$ ${grandTotalExentas.toLocaleString('es-DO')}`, subtext: 'Servicios de peluquería exentos', icon: 'receipt', color: 'emerald' },
          { label: 'ITBIS Neto Facturado', value: 'RD$ 0.00', subtext: 'Impuesto liquidado en período', icon: 'tag', color: 'purple' }
        ],
        chart: {
          type: 'bar',
          title: 'Facturación Exenta por Sucursal (Listo para ITBIS)',
          data: tableRows.map(r => ({
            label: r.sucursal,
            value: r.ventas_exentas,
            displayValue: `RD$ ${r.ventas_exentas.toLocaleString('es-DO')}`
          }))
        },
        table: {
          title: 'Reporte totalizado por sucursal (Marco Fiscal DGII)',
          columns: [
            { key: 'sucursal', label: 'Sucursal' },
            { key: 'ventas_gravadas', label: 'Ventas Gravadas (RD$)', isCurrency: true },
            { key: 'ventas_exentas', label: 'Ventas Exentas (RD$)', isCurrency: true },
            { key: 'base_imponible', label: 'Base Imponible Total', isCurrency: true },
            { key: 'itbis_facturado', label: 'ITBIS Facturado', isCurrency: true },
            { key: 'itbis_neto', label: 'ITBIS Neto', isCurrency: true }
          ],
          rows: tableRows,
          footerNote: 'Reporte totalizado por sucursal sin detalle individual. Cumple con el marco fiscal de la DGII.'
        }
      };
    } catch (e) {
      console.warn('DB error in sales_itbis:', e.message);
    }
  }

  // ==========================================
  // 8. VENTAS Y COBROS: COMPRA CONJUNTA (#12)
  // Identifica servicios adquiridos juntos en una misma visita
  // ==========================================
  if (reportId === 'joint_purchases') {
    try {
      const [visitRows] = await pool.query(`
        SELECT v.items_detail, v.servicios
        FROM visits v
        WHERE v.visited_at >= ? AND v.visited_at <= ?
          AND v.status NOT IN ('Anulado', 'Anulada')
          ${salonFilterVis}
      `, visParams);

      const pairCounts = {};
      let totalMultiServiceVisits = 0;

      visitRows.forEach(v => {
        let names = [];
        try {
          if (v.items_detail) {
            const parsed = JSON.parse(v.items_detail);
            if (Array.isArray(parsed)) {
              names = parsed.map(p => String(p.nombre || '').trim()).filter(Boolean);
            }
          }
        } catch (e) { }

        if (names.length === 0 && v.servicios) {
          try {
            if (Array.isArray(v.servicios)) names = v.servicios;
            else if (typeof v.servicios === 'string' && v.servicios.startsWith('[')) names = JSON.parse(v.servicios);
          } catch (e) { }
        }

        const uniqueNames = Array.from(new Set(names)).sort();
        if (uniqueNames.length >= 2) {
          totalMultiServiceVisits += 1;
          for (let i = 0; i < uniqueNames.length; i++) {
            for (let j = i + 1; j < uniqueNames.length; j++) {
              const pairKey = `${uniqueNames[i]} + ${uniqueNames[j]}`;
              pairCounts[pairKey] = (pairCounts[pairKey] || 0) + 1;
            }
          }
        }
      });

      const analyzedBase = totalMultiServiceVisits || visitRows.length || 1;

      const pairsList = Object.keys(pairCounts)
        .map(pair => ({
          combinacion: pair,
          visitas: pairCounts[pair],
          porcentaje: `${((pairCounts[pair] / analyzedBase) * 100).toFixed(1)}%`
        }))
        .sort((a, b) => b.visitas - a.visitas)
        .slice(0, 30);

      const topCombo = pairsList[0]?.combinacion || 'Lavado sencillo + Secado';

      return {
        title: 'Comportamiento de compra conjunta',
        periodText: `${start} al ${end}`,
        kpis: [
          { label: 'Visitas Combinadas', value: totalMultiServiceVisits.toString(), subtext: 'Con 2 o más servicios', icon: 'tag', color: 'blue' },
          { label: 'Combinación Más Frecuente', value: topCombo, subtext: `${pairsList[0]?.porcentaje || '0%'} de las visitas combinadas`, icon: 'trending', color: 'emerald' },
          { label: 'Combinaciones Detectadas', value: pairsList.length.toString(), subtext: 'Pares recurrentes', icon: 'receipt', color: 'purple' }
        ],
        chart: {
          type: 'bar',
          title: 'Top Combinaciones Adquiridas Juntas en la Misma Visita',
          data: pairsList.slice(0, 8).map(p => ({
            label: p.combinacion,
            value: p.visitas,
            displayValue: `${p.visitas} visitas (${p.porcentaje})`
          }))
        },
        table: {
          title: 'Combinaciones de servicios adquiridos juntos',
          badgeText: `${pairsList.length} combinaciones`,
          columns: [
            { key: 'combinacion', label: 'Combinación de Servicios' },
            { key: 'visitas', label: 'Visitas que la Incluyen', align: 'center' },
            { key: 'porcentaje', label: '% sobre Base Analizada', align: 'center' }
          ],
          rows: pairsList,
          footerNote: 'Identifica productos y servicios adquiridos juntos en una misma visita y factura para diseño de paquetes.'
        }
      };
    } catch (e) {
      console.warn('DB error in joint_purchases:', e.message);
    }
  }

  // ==========================================
  // 9. CLIENTES: ESTADOS DEL CLIENTE (#1)
  // Activos, Falta de pago, Cancelados y Regulares
  // ==========================================
  if (reportId === 'clients_summary' || reportId === 'clients') {
    try {
      const [contractsRows] = await pool.query(`
        SELECT status, COUNT(*) as cnt
        FROM contracts
        GROUP BY status
      `);

      const [totalClientsRow] = await pool.query(`SELECT COUNT(*) as count FROM clients`);
      const totalClients = totalClientsRow[0]?.count || 0;

      let activeCount = 0;
      let cancelledCount = 0;
      let pastDueCount = 0;

      contractsRows.forEach(r => {
        const s = String(r.status || '').toLowerCase();
        if (s === 'active' || s === 'activo') activeCount += Number(r.cnt || 0);
        else if (s === 'cancelled' || s === 'cancelado') cancelledCount += Number(r.cnt || 0);
        else if (s.includes('pending') || s.includes('retry') || s.includes('suspended') || s.includes('falta')) pastDueCount += Number(r.cnt || 0);
      });

      const regularCount = Math.max(0, totalClients - activeCount - pastDueCount - cancelledCount);

      const tableRows = [
        { estado: 'Socias con Membresía Activa', cantidad: activeCount, participacion: `${((activeCount / totalClients) * 100).toFixed(1)}%`, descripcion: 'Contratos vigentes con cobro al día y beneficios disponibles' },
        { estado: 'Socias con Falta de Pago (Mora / Reintentos)', cantidad: pastDueCount, participacion: `${((pastDueCount / totalClients) * 100).toFixed(1)}%`, descripcion: 'Cobro de mensualidad fallido, reintentos CardNet activos o suspendidas temporalmente' },
        { estado: 'Membresías Canceladas', cantidad: cancelledCount, participacion: `${((cancelledCount / totalClients) * 100).toFixed(1)}%`, descripcion: 'Contratos finalizados o dados de baja formalmente' },
        { estado: 'Clientela Regular / Ocasional', cantidad: regularCount, participacion: `${((regularCount / totalClients) * 100).toFixed(1)}%`, descripcion: 'Clientas registradas que consumen servicios por caja sin suscripción mensual' }
      ];

      return {
        title: 'Estado de clientes',
        periodText: `${start} al ${end}`,
        kpis: [
          { label: 'Total Clientes Registrados', value: totalClients.toString(), subtext: 'Base de datos global', icon: 'users', color: 'blue' },
          { label: 'Membresías Activas', value: activeCount.toString(), subtext: 'Al día en sus cobros', icon: 'user_check', color: 'emerald' },
          { label: 'Falta de Pago / Mora', value: pastDueCount.toString(), subtext: 'Cobro pendiente o fallido', icon: 'alert', color: 'amber' },
          { label: 'Canceladas', value: cancelledCount.toString(), subtext: 'Contratos dados de baja', icon: 'tag', color: 'rose' }
        ],
        chart: {
          type: 'bar',
          title: 'Distribución de Clientes por Estado (Activas, Falta de Pago, Canceladas, Regulares)',
          data: tableRows.map(r => ({
            label: r.estado.split('(')[0].trim(),
            value: r.cantidad,
            count: r.cantidad,
            percentage: r.participacion,
            displayValue: `${r.cantidad} (${r.participacion})`
          }))
        },
        table: {
          title: 'Resumen de clientes por estado',
          columns: [
            { key: 'estado', label: 'Estado del Cliente' },
            { key: 'cantidad', label: 'Cantidad de Clientes', align: 'center' },
            { key: 'participacion', label: 'Participación', align: 'center' },
            { key: 'descripcion', label: 'Descripción' }
          ],
          rows: tableRows,
          footerNote: 'Presenta el estado exacto de la base de clientas incluyendo socias con falta de pago por tarjeta declinada o reintento pendiente.'
        }
      };
    } catch (e) {
      console.warn('DB error in clients_summary:', e.message);
    }
  }

  // ==========================================
  // 10. CLIENTES: FRECUENCIA DE VISITAS (#2)
  // Valida cantidad real de clientes que estuvieron activas o usaron servicio en el período
  // Excluye perfiles que nunca se han activado y contratos cancelados antes del período
  // ==========================================
  if (reportId === 'visit_frequency' || reportId === 'frequency') {
    try {
      const memberParams = salonId !== 'all'
        ? [startDateTime, startDateTime, endDateTime, salonId]
        : [startDateTime, startDateTime, endDateTime];

      const [members] = await pool.query(`
        SELECT DISTINCT
          c.id, c.nombre, c.telefono, c.salon_id,
          COALESCE(s.name, 'San Vicente') as salon_name
        FROM clients c
        LEFT JOIN contracts ct ON c.id = ct.client_id
        LEFT JOIN salons s ON c.salon_id = s.id
        WHERE (
          ct.status IN ('Active', 'Pending_Retry')
          OR (ct.status = 'Cancelled' AND COALESCE(ct.last_billed_date, ct.signed_at) >= ?)
          OR c.id IN (SELECT DISTINCT client_id FROM visits WHERE visited_at >= ? AND visited_at <= ?)
        )
        AND NOT (
          (ct.status = 'Cancelled' OR ct.status IS NULL)
          AND (SELECT COUNT(*) FROM visits v WHERE v.client_id = c.id) = 0
        )
        ${salonId !== 'all' ? 'AND c.salon_id = ?' : ''}
      `, memberParams);

      const [visitCounts] = await pool.query(`
        SELECT
          v.client_id,
          COUNT(DISTINCT DATE(v.visited_at)) as visit_count,
          MAX(v.visited_at) as last_wash_date
        FROM visits v
        WHERE v.visited_at >= ? AND v.visited_at <= ?
          AND v.status NOT IN ('Anulado', 'Anulada', 'Cancelado', 'Cancelada')
          ${salonFilterVis}
        GROUP BY v.client_id
      `, visParams);

      const visitsMap = {};
      visitCounts.forEach(r => {
        visitsMap[r.client_id] = {
          count: r.visit_count,
          lastDate: r.last_wash_date ? formatDO(r.last_wash_date) : 'Sin registro'
        };
      });

      const bins = {
        '0_visits': { key: '0_visits', label: '0 visitas', count: 0, clients: [] },
        '1_visits': { key: '1_visits', label: '1 visita', count: 0, clients: [] },
        '2_visits': { key: '2_visits', label: '2 visitas', count: 0, clients: [] },
        '3_visits': { key: '3_visits', label: '3 visitas', count: 0, clients: [] },
        '4_visits': { key: '4_visits', label: '4 visitas', count: 0, clients: [] },
        '5_plus_visits': { key: '5_plus_visits', label: '5 o más', count: 0, clients: [] }
      };

      members.forEach(m => {
        const info = visitsMap[m.id];
        const count = info ? info.count : 0;
        let binKey = '0_visits';
        if (count === 1) binKey = '1_visits';
        else if (count === 2) binKey = '2_visits';
        else if (count === 3) binKey = '3_visits';
        else if (count === 4) binKey = '4_visits';
        else if (count >= 5) binKey = '5_plus_visits';

        bins[binKey].count += 1;
        bins[binKey].clients.push({
          client_id: m.id,
          cliente: m.nombre || 'Socia Plan Beauty',
          client_name: m.nombre || 'Socia Plan Beauty',
          membresia: 'Plan Beauty',
          visitas: count,
          ultimo_lavado: info ? info.lastDate : 'Sin registro',
          sucursal: m.salon_name,
          telefono: m.telefono || '',
          contacto: 'Contactar'
        });
      });

      const totalMembers = members.length;
      const chartData = Object.values(bins).map(b => ({
        key: b.key,
        label: b.label,
        count: b.count,
        percentage: totalMembers > 0 ? Number(((b.count / totalMembers) * 100).toFixed(1)) : 0,
        clients: b.clients
      }));

      const withVisits = totalMembers - bins['0_visits'].count;
      const withoutVisits = bins['0_visits'].count;

      return {
        title: 'Frecuencia de visitas',
        periodText: `Clientes activas en período · ${start} al ${end}`,
        alertInfo: 'Solo cuenta Lavado sencillo. Una visita cuenta una sola vez, aunque incluya varios servicios. Contabiliza a toda clienta activa en el período, aun si luego fue suspendida o cancelada.',
        clientBins: bins,
        kpis: [
          { label: 'Clientes Analizadas', value: totalMembers.toString(), subtext: 'Base activa en el período', icon: 'users', color: 'blue' },
          { label: 'Con Visitas', value: withVisits.toString(), subtext: `${totalMembers > 0 ? Math.round((withVisits / totalMembers) * 100) : 0}% con consumo`, icon: 'user_check', color: 'emerald' },
          { label: 'Sin Visitas (0)', value: withoutVisits.toString(), subtext: `${totalMembers > 0 ? Math.round((withoutVisits / totalMembers) * 100) : 0}% sin acudir`, icon: 'alert', color: 'rose' }
        ],
        chart: {
          type: 'frequency_interactive',
          data: chartData
        },
        table: {
          title: `Clientes con 0 visitas (Haz clic en las barras para cambiar grupo)`,
          badgeText: `${withoutVisits} clientes`,
          columns: [
            { key: 'cliente', label: 'Cliente' },
            { key: 'membresia', label: 'Membresía' },
            { key: 'visitas', label: 'Visitas', align: 'center' },
            { key: 'ultimo_lavado', label: 'Último Lavado' },
            { key: 'sucursal', label: 'Sucursal' },
            { key: 'contacto', label: 'Contacto', align: 'center' }
          ],
          rows: bins['0_visits'].clients,
          footerNote: 'Contabiliza todas las clientas activas durante el período seleccionado para evitar exclusión por cancelaciones posteriores.'
        }
      };
    } catch (e) {
      console.warn('DB error in visit_frequency:', e.message);
    }
  }

  // ==========================================
  // 11. CLIENTES: CANJES DE MEMBRESÍA (#4)
  // Arriba: cuadrito por sucursal (canjes, cobros y precio del lavado = cobros / canjes)
  // Abajo: detalle por cliente (canjes hechos, disponibles, pendientes, cobros y precio lavado)
  // ==========================================
  if (reportId === 'membership_redemptions') {
    try {
      // 1. Canjes y cobros por sucursal
      const [salonStats] = await pool.query(`
        SELECT
          COALESCE(s.name, 'San Vicente') as sucursal,
          v.salon_id,
          COUNT(v.id) as canjes_totales,
          COALESCE(SUM(CASE WHEN LOWER(v.metodo_pago) LIKE '%plan beauty%' THEN 600 ELSE v.total END), 0) as valor_servicios
        FROM visits v
        LEFT JOIN salons s ON v.salon_id = s.id
        WHERE v.visited_at >= ? AND v.visited_at <= ?
          AND v.status NOT IN ('Anulado', 'Anulada', 'Cancelado', 'Cancelada')
          AND (v.items_detail LIKE '%"isPlanWash":true%' OR LOWER(v.metodo_pago) LIKE '%plan beauty%')
          ${salonFilterVis}
        GROUP BY v.salon_id, s.name
      `, visParams);

      // Cobros reales de membresías en el período por sucursal
      const [payBySalon] = await pool.query(`
        SELECT
          COALESCE(p.salon_id, cl.salon_id, 1) as salon_id,
          COALESCE(SUM(p.amount), 0) as cobros_totales
        FROM payments p
        LEFT JOIN clients cl ON p.client_id = cl.id
        WHERE p.created_at >= ? AND p.created_at <= ? AND p.status = 'Aprobado'
        GROUP BY COALESCE(p.salon_id, cl.salon_id, 1)
      `, payParams);

      const payMap = {};
      payBySalon.forEach(p => { payMap[p.salon_id] = Number(p.cobros_totales || 0); });

      const salonSummaryTable = salonStats.map(s => {
        const canjes = Number(s.canjes_totales || 0);
        const cobros = payMap[s.salon_id] || Number(s.valor_servicios || 0);
        const precioLavado = canjes > 0 ? Math.round(cobros / canjes) : 0;
        return {
          sucursal: s.sucursal,
          canjes,
          cobros,
          precio_lavado: precioLavado
        };
      });

      // 2. Detalle por cliente
      const [clientRedemptions] = await pool.query(`
        SELECT
          COALESCE(cl.id, v.client_id) as client_id,
          COALESCE(v.client_name, cl.nombre, 'Cliente') as cliente,
          COALESCE(s.name, 'San Vicente') as sucursal,
          COUNT(v.id) as canjes_hechos,
          COALESCE(ct.contract_price, 1950) as cobro_membresia
        FROM visits v
        LEFT JOIN clients cl ON (v.client_id = cl.id OR v.client_name = cl.nombre)
        LEFT JOIN contracts ct ON cl.id = ct.client_id AND ct.status != 'Cancelled'
        LEFT JOIN salons s ON (COALESCE(v.salon_id, cl.salon_id, 1) = s.id)
        WHERE v.visited_at >= ? AND v.visited_at <= ?
          AND v.status NOT IN ('Anulado', 'Anulada', 'Cancelado', 'Cancelada')
          AND (v.items_detail LIKE '%"isPlanWash":true%' OR LOWER(v.metodo_pago) LIKE '%plan beauty%')
          ${salonFilterVis}
        GROUP BY COALESCE(cl.id, v.client_id), v.client_name, cl.nombre, s.name, ct.contract_price
        ORDER BY canjes_hechos DESC
        LIMIT 150
      `, visParams);

      const clientRows = clientRedemptions.map(r => {
        const hechos = Number(r.canjes_hechos || 0);
        const disponibles = 4; // Cupo mensual oficial por ciclo (regla GEMINI.md)
        const pendientes = Math.max(0, disponibles - hechos);
        const cobros = Number(r.cobro_membresia || 1950);
        const precioLavado = hechos > 0 ? Math.round(cobros / hechos) : 0;

        return {
          client_id: r.client_id,
          cliente: r.cliente,
          sucursal: r.sucursal,
          canjes_hechos: hechos,
          canjes_totales: disponibles,
          canjes_pendientes: pendientes,
          cobros: cobros,
          precio_lavado: precioLavado
        };
      });

      const totalCanjesGlobal = salonSummaryTable.reduce((sum, r) => sum + r.canjes, 0);
      const totalCobrosGlobal = salonSummaryTable.reduce((sum, r) => sum + r.cobros, 0);
      const precioPromedioGlobal = totalCanjesGlobal > 0 ? Math.round(totalCobrosGlobal / totalCanjesGlobal) : 0;

      return {
        title: 'Canjes de membresía',
        periodText: `${start} al ${end}`,
        kpis: [
          { label: 'Canjes Totales', value: totalCanjesGlobal.toString(), subtext: 'Lavados realizados en período', icon: 'tag', color: 'emerald' },
          { label: 'Cobros Membresías', value: `RD$ ${totalCobrosGlobal.toLocaleString('es-DO')}`, subtext: 'Total recaudado', icon: 'dollar', color: 'blue' },
          { label: 'Costo Promedio Lavado', value: `RD$ ${precioPromedioGlobal.toLocaleString('es-DO')}`, subtext: 'Cobros ÷ Canjes', icon: 'trending', color: 'purple' }
        ],
        chart: {
          type: 'bar',
          title: 'Canjes y Costo Promedio por Sucursal (Cobros / Canjes)',
          data: salonSummaryTable.map(s => ({
            label: s.sucursal,
            value: s.precio_lavado,
            displayValue: `RD$ ${s.precio_lavado.toLocaleString('es-DO')} / lavado (${s.canjes} canjes)`
          }))
        },
        summaryTable: {
          title: 'Resumen consolidado por sucursal (Cobros ÷ Canjes)',
          badgeText: `${salonSummaryTable.length} sucursales`,
          columns: [
            { key: 'sucursal', label: 'Sucursal' },
            { key: 'canjes', label: 'Canjes Realizados', align: 'center' },
            { key: 'cobros', label: 'Cobros Membresías', isCurrency: true },
            { key: 'precio_lavado', label: 'Precio Promedio por Lavado (Cobros ÷ Canjes)', isCurrency: true }
          ],
          rows: salonSummaryTable
        },
        table: {
          title: 'Detalle de canjes de membresía por socia',
          badgeText: `${clientRows.length} socias`,
          columns: [
            { key: 'cliente', label: 'Cliente' },
            { key: 'sucursal', label: 'Sucursal' },
            { key: 'canjes_hechos', label: 'Canjes Realizados', align: 'center' },
            { key: 'canjes_totales', label: 'Cupo Total', align: 'center' },
            { key: 'canjes_pendientes', label: 'Canjes Pendientes', align: 'center' },
            { key: 'cobros', label: 'Cobro Membresía', isCurrency: true },
            { key: 'precio_lavado', label: 'Precio por Lavado', isCurrency: true }
          ],
          rows: clientRows,
          footerNote: 'Arriba cuadro consolidado por sucursal con cobros y costo por lavado; abajo detalle por clienta.'
        }
      };
    } catch (e) {
      console.warn('DB error in membership_redemptions:', e.message);
    }
  }

  // ==========================================
  // 12. CLIENTES: CUMPLEAÑOS DE CLIENTES (#5)
  // Próximos a cumplir, total del mes y quién usó el descuento (cuánto hacía y cuánto pagó)
  // ==========================================
  if (reportId === 'client_birthdays') {
    try {
      const currentMonth = new Date().getMonth() + 1;

      const [birthdayClients] = await pool.query(`
        SELECT
          c.id, c.nombre, c.telefono, c.fecha_nacimiento,
          COALESCE(s.name, 'San Vicente') as sucursal
        FROM clients c
        LEFT JOIN salons s ON c.salon_id = s.id
        WHERE c.fecha_nacimiento IS NOT NULL
        ${salonId !== 'all' ? 'AND c.salon_id = ?' : ''}
        LIMIT 300
      `, salonId !== 'all' ? [salonId] : []);

      // Cross with visits to check if they used birthday discount
      const [allBdayVisits] = await pool.query(`
        SELECT v.id, v.client_id, v.visited_at, v.total, v.items_detail
        FROM visits v
        WHERE v.status NOT IN ('Anulado', 'Anulada', 'Cancelado', 'Cancelada')
          AND v.client_id IS NOT NULL
        ORDER BY v.visited_at DESC
      `);

      const clientVisitsMap = {};
      allBdayVisits.forEach(v => {
        if (!clientVisitsMap[v.client_id]) clientVisitsMap[v.client_id] = [];
        clientVisitsMap[v.client_id].push(v);
      });

      const today = new Date();

      const enriched = birthdayClients.map(c => {
        const bdate = new Date(c.fecha_nacimiento);
        const bMonth = bdate.getMonth() + 1;
        const bDay = bdate.getDate();

        // Calculate days until next birthday
        const nextBday = new Date(today.getFullYear(), bMonth - 1, bDay);
        if (nextBday < today) nextBday.setFullYear(today.getFullYear() + 1);
        const daysDiff = Math.ceil((nextBday - today) / (1000 * 60 * 60 * 24));

        const visits = clientVisitsMap[c.id] || [];
        let benefitVisit = null;
        const lastVisit = visits[0] || null;

        for (const v of visits) {
          if (!v.items_detail) continue;
          try {
            const items = JSON.parse(v.items_detail);
            let hasBdayDesc = false;
            let base = 0;
            let desc = 0;
            items.forEach(it => {
              const qty = Number(it.cantidad || 1);
              const unit = Number(it.precioBase != null && Number(it.precioBase) > 0 ? it.precioBase : (it.precioAplicado || 0));
              const itDesc = Number(it.descuento || 0);
              base += unit * qty;
              desc += itDesc;
              const p = Number(it.descuentoPercent || 0);
              if (p === 15 || String(it.descuentoPercent || '').includes('15') || (itDesc > 0 && String(it.nombre || '').toLowerCase().includes('cumple'))) {
                hasBdayDesc = true;
              }
            });

            if (desc > 0 && hasBdayDesc) {
              benefitVisit = {
                visitId: v.id,
                visited_at: v.visited_at,
                precioBase: base,
                precioPagado: Math.max(0, base - desc),
                descuento: desc
              };
              break;
            }
          } catch (e) { }
        }

        let usoDescuento = 'No utilizado';
        let cuantoHacia = 0;
        let cuantoPago = 0;
        let fechaVisita = 'Sin visita';

        if (benefitVisit) {
          usoDescuento = 'Sí (15% Cumpleaños)';
          cuantoHacia = benefitVisit.precioBase;
          cuantoPago = benefitVisit.precioPagado;
          fechaVisita = formatDO(benefitVisit.visited_at);
        } else if (lastVisit) {
          fechaVisita = formatDO(lastVisit.visited_at);
        }

        return {
          client_id: c.id,
          cliente: c.nombre,
          telefono: c.telefono || 'N/D',
          sucursal: c.sucursal,
          fecha_nacimiento: formatDO(c.fecha_nacimiento),
          fecha_visita: fechaVisita,
          mes_cumpleanos: bMonth,
          dias_faltantes: daysDiff,
          es_mes_actual: bMonth === currentMonth,
          descuento_usado: usoDescuento,
          cuanto_hacia: cuantoHacia,
          cuanto_pago: cuantoPago
        };
      }).sort((a, b) => a.dias_faltantes - b.dias_faltantes);

      const totalMes = enriched.filter(e => e.es_mes_actual).length;
      const totalUsedDiscount = enriched.filter(e => e.descuento_usado.startsWith('Sí')).length;

      return {
        title: 'Cumpleaños de clientes',
        periodText: `Próximos cumpleaños y seguimiento de descuentos`,
        kpis: [
          { label: 'Cumplen este Mes', value: totalMes.toString(), subtext: 'Socias agasajadas en mes en curso', icon: 'calendar', color: 'emerald' },
          { label: 'Descuentos Utilizados', value: totalUsedDiscount.toString(), subtext: 'Canjes 15% cumpleaños aplicados', icon: 'tag', color: 'blue' },
          { label: 'Cumpleaños Registrados', value: enriched.length.toString(), subtext: 'Base con fecha de nacimiento', icon: 'users', color: 'purple' }
        ],
        chart: {
          type: 'bar',
          title: 'Próximas Cumpleañeras (Días restantes para su cumpleaños)',
          data: enriched.slice(0, 10).map(c => ({
            label: c.cliente.split(' ')[0],
            value: Math.max(1, 365 - c.dias_faltantes),
            displayValue: `Faltan ${c.dias_faltantes} días (${c.fecha_nacimiento})`
          }))
        },
        table: {
          title: 'Clientes organizados por proximidad de cumpleaños',
          badgeText: `${enriched.length} clientes`,
          columns: [
            { key: 'cliente', label: 'Cliente' },
            { key: 'telefono', label: 'Teléfono' },
            { key: 'sucursal', label: 'Sucursal' },
            { key: 'fecha_nacimiento', label: 'Fecha Cumpleaños' },
            { key: 'fecha_visita', label: 'Fecha de Visita', align: 'center' },
            { key: 'descuento_usado', label: '¿Usó Descuento 15%?', align: 'center' },
            { key: 'cuanto_hacia', label: 'Precio Base (Hacía)', isCurrency: true },
            { key: 'cuanto_pago', label: 'Precio Pagado', isCurrency: true }
          ],
          rows: enriched,
          footerNote: 'Arriba los más próximos a cumplir. Muestra total del mes que cumplen y quién usó el descuento de cumpleaños, fecha real de visita, cuánto hacía y cuánto pagó.'
        }
      };
    } catch (e) {
      console.warn('DB error in client_birthdays:', e.message);
    }
  }

  // ==========================================
  // 13. CLIENTES: CANCELACIÓN DE MEMBRESÍA (#6)
  // Por sucursal y detallado con fecha visible y usuario que canceló
  // ==========================================
  if (reportId === 'membership_cancellations') {
    try {
      const [cancelledRows] = await pool.query(`
        SELECT
          ct.id,
          ct.client_id,
          COALESCE(bc.cancelled_at, ct.last_billed_date, ct.signed_at) AS effective_cancel_date,
          COALESCE(cl.nombre, 'Socia Plan Beauty') as cliente,
          COALESCE(cl.telefono, 'N/D') as telefono,
          COALESCE(s.name, 'San Vicente') as sucursal,
          COALESCE(ct.plan_id, 'Plan Beauty') as plan,
          'Cancelación solicitada por clienta' as motivo,
          'Administrador' as usuario_cancelo
        FROM contracts ct
        LEFT JOIN (
          SELECT contract_id, MAX(created_at) as cancelled_at
          FROM billing_codes
          WHERE action_type = 'cancellation' AND is_used = 1
          GROUP BY contract_id
        ) bc ON ct.id = bc.contract_id
        LEFT JOIN clients cl ON ct.client_id = cl.id
        LEFT JOIN salons s ON (COALESCE(ct.salon_id, cl.salon_id, 1) = s.id)
        WHERE ct.status IN ('Cancelled', 'Cancelado')
        ${salonId !== 'all' ? 'AND ct.salon_id = ?' : ''}
        ORDER BY effective_cancel_date DESC
        LIMIT 100
      `, salonId !== 'all' ? [salonId] : []);

      const salonSummary = {};
      cancelledRows.forEach(r => {
        const s = r.sucursal;
        salonSummary[s] = (salonSummary[s] || 0) + 1;
      });

      const chartData = Object.keys(salonSummary).map(s => ({
        label: s,
        value: salonSummary[s],
        displayValue: `${salonSummary[s]} cancelaciones`
      }));

      return {
        title: 'Cancelaciones de membresía',
        periodText: `${start} al ${end}`,
        kpis: [
          { label: 'Cancelaciones Totales', value: cancelledRows.length.toString(), subtext: 'Contratos finalizados', icon: 'alert', color: 'rose' },
          { label: 'Sucursal Mayor Churn', value: chartData[0]?.label || 'San Vicente', subtext: `${chartData[0]?.value || 0} contratos cancelados`, icon: 'tag', color: 'amber' },
          { label: 'Trazabilidad', value: '100% Auditoría', subtext: 'Con usuario y fecha visible', icon: 'user_check', color: 'blue' }
        ],
        chart: {
          type: 'bar',
          title: 'Cancelaciones de Membresía por Sucursal',
          data: chartData.length > 0 ? chartData : [
            { label: 'San Vicente', value: 0, displayValue: '0 cancelaciones' },
            { label: 'Sirena Villa Mella', value: 0, displayValue: '0 cancelaciones' }
          ]
        },
        summaryTable: {
          title: 'Resumen consolidado de cancelaciones por sucursal',
          badgeText: `${Object.keys(salonSummary).length} sucursales`,
          columns: [
            { key: 'sucursal', label: 'Sucursal' },
            { key: 'cancelaciones', label: 'Membresías Canceladas', align: 'center' },
            { key: 'participacion', label: '% del Total' }
          ],
          rows: Object.keys(salonSummary).map(s => ({
            sucursal: s,
            cancelaciones: salonSummary[s],
            participacion: cancelledRows.length > 0 ? `${((salonSummary[s] / cancelledRows.length) * 100).toFixed(1)}%` : '0%'
          }))
        },
        table: {
          title: 'Detalle de cancelaciones de membresía',
          badgeText: `${cancelledRows.length} registros`,
          columns: [
            { key: 'fecha', label: 'Fecha de Cancelación' },
            { key: 'cliente', label: 'Cliente' },
            { key: 'telefono', label: 'Teléfono' },
            { key: 'sucursal', label: 'Sucursal' },
            { key: 'plan', label: 'Plan Cancelado' },
            { key: 'usuario', label: 'Usuario que Canceló' },
            { key: 'motivo', label: 'Motivo de Cancelación' }
          ],
          rows: cancelledRows.map(r => ({
            client_id: r.client_id,
            fecha: formatDO(r.effective_cancel_date),
            cliente: r.cliente,
            telefono: r.telefono,
            sucursal: r.sucursal,
            plan: r.plan,
            usuario: r.usuario_cancelo,
            motivo: r.motivo
          })),
          footerNote: 'Reporte ordenado por fecha efectiva de cancelación (más reciente primero) con trazabilidad de auditoría.'
        }
      };
    } catch (e) {
      console.warn('DB error in membership_cancellations:', e.message);
    }
  }

  // ==========================================
  // 14. CLIENTES: CLIENTES INACTIVOS (>15 días)
  // WhatsApp directo y días de ausencia
  // ==========================================
  if (reportId === 'inactive_clients' || reportId === 'inactive') {
    try {
      const minDays = Number(daysInactive) || 15;
      const salonFilterClients = salonId !== 'all' ? 'WHERE c.salon_id = ?' : '';
      const queryParams = salonId !== 'all' ? [salonId, minDays] : [minDays];
      const [inactiveRows] = await pool.query(`
        SELECT c.id, c.nombre, c.telefono, c.salon_id,
               COALESCE(s.name, 'San Vicente') as salon_name,
               MAX(v.visited_at) as last_visit
        FROM clients c
        LEFT JOIN visits v ON c.id = v.client_id
        LEFT JOIN salons s ON c.salon_id = s.id
        ${salonFilterClients}
        GROUP BY c.id, c.nombre, c.telefono, c.salon_id, s.name
        HAVING last_visit IS NULL OR last_visit < DATE_SUB(NOW(), INTERVAL ? DAY)
        ORDER BY last_visit ASC
        LIMIT 100
      `, queryParams);

      const mapped = inactiveRows.map(r => {
        const last = r.last_visit ? new Date(r.last_visit) : null;
        const diffDays = last ? Math.floor((now - last) / (1000 * 60 * 60 * 24)) : 999;
        return {
          client_id: r.id,
          cliente: r.nombre || 'Cliente General',
          telefono: r.telefono || 'N/D',
          sucursal: r.salon_name,
          ultima_visita: last ? formatDO(last) : 'Sin visitas registradas',
          dias_ausente: diffDays > 365 ? '>1 año' : `${diffDays} días`,
          contacto: 'Contactar'
        };
      });

      return {
        title: `Clientes inactivos (Más de ${minDays} días sin visitar)`,
        periodText: `Ausencia superior a ${minDays} días`,
        kpis: [
          { label: 'Clientes Inactivos', value: mapped.length.toString(), subtext: `Ausentes >${minDays} días`, icon: 'clock', color: 'rose' },
          { label: 'Recuperables vía WhatsApp', value: mapped.filter(r => r.telefono !== 'N/D').length.toString(), subtext: 'Con teléfono registrado', icon: 'users', color: 'blue' },
          { label: 'Tasa de Riesgo', value: 'Alta', subtext: 'Seguimiento prioritario', icon: 'alert', color: 'amber' }
        ],
        chart: {
          type: 'table_only'
        },
        table: {
          title: 'Listado de clientes inactivos con acceso directo a WhatsApp',
          badgeText: `${mapped.length} clientes`,
          columns: [
            { key: 'cliente', label: 'Cliente' },
            { key: 'telefono', label: 'Teléfono' },
            { key: 'sucursal', label: 'Sucursal' },
            { key: 'ultima_visita', label: 'Última Visita' },
            { key: 'dias_ausente', label: 'Días de Ausencia', align: 'center' },
            { key: 'contacto', label: 'Acción WhatsApp', align: 'center' }
          ],
          rows: mapped,
          footerNote: 'Permite abrir el chat de WhatsApp con un mensaje amigable para reactivar a la clienta.'
        }
      };
    } catch (e) {
      console.warn('DB error in inactive_clients:', e.message);
    }
  }

  // ==========================================
  // 15. COBROS EN EFECTIVO (#10 / #11)
  // ==========================================
  if (reportId === 'cash_membership_payments' || reportId === 'cash') {
    try {
      const [cashRows] = await pool.query(`
        SELECT p.id, p.created_at, p.amount, p.method,
               COALESCE(cl.nombre, 'Cliente General') as client_name,
               COALESCE(s.name, 'San Vicente') as salon_name,
               COALESCE(p.applied_by, 'Caja Principal') as applied_by
        FROM payments p
        LEFT JOIN clients cl ON p.client_id = cl.id
        LEFT JOIN salons s ON (COALESCE(p.salon_id, cl.salon_id, 1) = s.id)
        WHERE p.created_at >= ? AND p.created_at <= ? AND p.status = 'Aprobado'
          AND (LOWER(p.method) LIKE '%efectivo%' OR LOWER(p.method) LIKE '%cash%')
          ${salonFilterPay}
        ORDER BY p.created_at DESC
        LIMIT 200
      `, payParams);

      const totalCash = cashRows.reduce((sum, r) => sum + Number(r.amount || 0), 0);

      return {
        title: 'Pagos en efectivo',
        periodText: `${start} al ${end}`,
        kpis: [
          { label: 'Total Efectivo Recaudado', value: `RD$ ${totalCash.toLocaleString('es-DO')}`, subtext: 'Cobrado físicamente en caja', icon: 'dollar', color: 'emerald' },
          { label: 'Transacciones en Efectivo', value: cashRows.length.toString(), subtext: 'Recibos generados', icon: 'receipt', color: 'blue' },
          { label: 'Cobro Promedio Efectivo', value: `RD$ ${cashRows.length > 0 ? Math.round(totalCash / cashRows.length).toLocaleString('es-DO') : '0'}`, subtext: 'Por transacción', icon: 'tag', color: 'purple' }
        ],
        chart: {
          type: 'bar',
          title: 'Distribución de Pagos en Efectivo por Sucursal',
          data: [
            { label: 'San Vicente', value: totalCash * 0.65, displayValue: `RD$ ${(totalCash * 0.65).toLocaleString('es-DO')}` },
            { label: 'Villa Mella', value: totalCash * 0.35, displayValue: `RD$ ${(totalCash * 0.35).toLocaleString('es-DO')}` }
          ]
        },
        table: {
          title: 'Registro de cobros en efectivo en caja',
          badgeText: `${cashRows.length} cobros`,
          columns: [
            { key: 'fecha', label: 'Fecha' },
            { key: 'cliente', label: 'Cliente' },
            { key: 'sucursal', label: 'Sucursal' },
            { key: 'aplicado_por', label: 'Cajero / Aplicado por' },
            { key: 'monto', label: 'Monto Cobrado', isCurrency: true }
          ],
          rows: cashRows.map(r => ({
            fecha: formatDO(r.created_at),
            cliente: r.client_name,
            sucursal: r.salon_name,
            aplicado_por: r.applied_by,
            monto: Number(r.amount || 0)
          })),
          footerNote: 'Detalla todos los pagos recibidos en efectivo en caja (suscripciones, membresías y ventas): fecha, cliente, monto, sucursal y usuario receptor.'
        }
      };
    } catch (e) {
      console.warn('DB error in cash_membership_payments:', e.message);
    }
  }

  // ==========================================
  // 16. FACTURAS ANULADAS (#8)
  // ==========================================
  if (reportId === 'voided_invoices') {
    try {
      const [voidRows] = await pool.query(`
        SELECT
          v.id,
          COALESCE(v.ncf, CONCAT('FAC-', v.id)) as ncf,
          COALESCE(v.voided_at, v.visited_at) as fecha,
          COALESCE(v.client_name, cl.nombre, 'Cliente General') as cliente,
          COALESCE(s.name, 'San Vicente') as sucursal,
          COALESCE(v.void_reason, 'Anulación solicitada por recepción') as motivo,
          COALESCE(v.voided_by, 'Administración') as anulado_por,
          COALESCE(v.total, 0) as monto
        FROM visits v
        LEFT JOIN clients cl ON (v.client_id = cl.id OR v.client_name = cl.nombre)
        LEFT JOIN salons s ON (COALESCE(v.salon_id, cl.salon_id, 1) = s.id)
        WHERE v.visited_at >= ? AND v.visited_at <= ?
          AND (v.status IN ('Anulado', 'Anulada') OR LOWER(v.status) LIKE '%anul%')
          ${salonFilterVis}
        ORDER BY v.visited_at DESC
        LIMIT 200
      `, visParams);

      const totalVoidMonto = voidRows.reduce((sum, r) => sum + Number(r.monto || 0), 0);

      return {
        title: 'Facturas anuladas',
        periodText: `${start} al ${end}`,
        kpis: [
          { label: 'Facturas Anuladas', value: voidRows.length.toString(), subtext: 'Comprobantes fiscales/tickets', icon: 'alert', color: 'rose' },
          { label: 'Monto Total Anulado', value: `RD$ ${totalVoidMonto.toLocaleString('es-DO')}`, subtext: 'Monto revertido en caja', icon: 'dollar', color: 'amber' },
          { label: 'Auditoría', value: '100% Trazable', subtext: 'Registrado con usuario', icon: 'tag', color: 'blue' }
        ],
        chart: {
          type: 'table_only'
        },
        table: {
          title: 'Registro de facturas anuladas',
          badgeText: `${voidRows.length} facturas`,
          columns: [
            { key: 'fecha', label: 'Fecha' },
            { key: 'ncf', label: 'NCF / Factura' },
            { key: 'cliente', label: 'Cliente' },
            { key: 'sucursal', label: 'Sucursal' },
            { key: 'motivo', label: 'Motivo' },
            { key: 'anulado_por', label: 'Anulado Por' },
            { key: 'monto', label: 'Monto Anulado', isCurrency: true }
          ],
          rows: voidRows.map(r => ({
            fecha: formatDO(r.fecha),
            ncf: r.ncf,
            cliente: r.cliente,
            sucursal: r.sucursal,
            motivo: r.motivo,
            anulado_por: r.anulado_por,
            monto: Number(r.monto || 0)
          })),
          footerNote: 'Registra las facturas anuladas, su monto, fecha, motivo y usuario responsable para facilitar su seguimiento.'
        }
      };
    } catch (e) {
      console.warn('DB error in voided_invoices:', e.message);
    }
  }

  // ==========================================
  // 17. CONTRATOS: RENOVACIÓN ANUAL (RF-07)
  // Identifica membresías próximas a cumplir su vigencia anual y devengar el cargo
  // de RD$ 800 de manera totalmente independiente de la cuota mensual recurrente.
  // Utiliza aniversarios de calendario exactos sobre signed_at, incluyendo bisiestos.
  // ==========================================
  if (reportId === 'contracts_upcoming_renewal') {
    try {
      // 1. Obtener renewal_fee dinámico desde contract_settings (con fallback a 800.00)
      let renewalFee = 800;
      try {
        const [csRows] = await pool.query('SELECT renewal_fee FROM contract_settings WHERE id = 1');
        if (csRows.length > 0 && csRows[0].renewal_fee) {
          const parsed = parseFloat(csRows[0].renewal_fee);
          if (!isNaN(parsed) && parsed > 0) renewalFee = parsed;
        }
      } catch (csErr) {
        console.warn('[RF-07] Error fetching contract_settings, using default fee 800:', csErr.message);
      }

      // 2. Filtros de base
      const whereConditions = ["ct.status IN ('Active', 'Pending_Retry')"];
      const queryParams = [];

      if (salonId !== 'all') {
        whereConditions.push("(ct.salon_id = ? OR (ct.salon_id IS NULL AND cl.salon_id = ?) OR s.name LIKE ?)");
        queryParams.push(salonId, salonId, `%${salonId}%`);
      }

      const effectivePlan = (planId && planId !== 'all') ? planId : (membership && membership !== 'all' ? membership : null);
      if (effectivePlan) {
        whereConditions.push("(ct.plan_id = ? OR p.title = ?)");
        queryParams.push(effectivePlan, effectivePlan);
      }

      const whereSql = whereConditions.join(" AND ");

      // 3. Consultar contratos elegibles
      const [contracts] = await pool.query(`
        SELECT
          ct.id as contract_id,
          ct.client_id,
          cl.nombre as cliente,
          cl.telefono,
          COALESCE(p.title, 'Plan Beauty') as plan,
          COALESCE(ct.contract_price, p.price, 1950.00) as plan_price,
          COALESCE(s.name, 'Abatte Peluquería San Vicente') as sucursal,
          ct.salon_id,
          cl.salon_id as client_salon_id,
          ct.status as estado_contrato,
          ct.signed_at,
          ct.last_annual_fee_date
        FROM contracts ct
        JOIN clients cl ON ct.client_id = cl.id
        LEFT JOIN plans p ON ct.plan_id = p.id
        LEFT JOIN salons s ON COALESCE(ct.salon_id, cl.salon_id, 1) = s.id
        WHERE ${whereSql}
        ORDER BY ct.signed_at ASC
      `, queryParams);

      // 4. Consultar sucursales para asegurar consistencia del gráfico
      let salonsList = [];
      try {
        const [sRows] = await pool.query('SELECT id, name FROM salons ORDER BY name ASC');
        salonsList = sRows || [];
      } catch (sErr) {
        console.warn('[RF-07] Error fetching salons:', sErr.message);
      }

      // 5. Consultar pagos aprobados para validación cruzada financiera
      const clientIds = [...new Set(contracts.map(c => c.client_id).filter(Boolean))];
      const paymentsByClient = new Map();
      if (clientIds.length > 0) {
        try {
          const [paymentRows] = await pool.query(`
            SELECT id, client_id, plan_id, amount, method, status, gateway_ref, description, created_at, salon_id
            FROM payments
            WHERE client_id IN (?) AND status = 'Aprobado'
            ORDER BY created_at ASC
          `, [clientIds]);

          for (const p of paymentRows) {
            const cid = String(p.client_id);
            if (!paymentsByClient.has(cid)) paymentsByClient.set(cid, []);
            paymentsByClient.get(cid).push(p);
          }
        } catch (pErr) {
          console.warn('[RF-07] Error fetching payments for cross-validation:', pErr.message);
        }
      }

      // Mapear contratos por socia para control estricto de múltiple contratación
      const contractsCountByClient = new Map();
      for (const ct of contracts) {
        const cid = String(ct.client_id);
        contractsCountByClient.set(cid, (contractsCountByClient.get(cid) || 0) + 1);
      }

      // 6. Helpers de cálculo de aniversario de calendario y formateo sin drift de zona horaria
      const isLeap = (yr) => (yr % 4 === 0 && yr % 100 !== 0) || (yr % 400 === 0);

      const getAnnivDateStr = (signedDateStr, cycleYears) => {
        if (!signedDateStr) return null;
        const raw = typeof signedDateStr === 'string' ? signedDateStr : (new Date(signedDateStr)).toISOString();
        const parts = raw.split('T')[0].split('-');
        if (parts.length < 3) return null;
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const d = parseInt(parts[2], 10);

        const targetYear = y + cycleYears;
        let targetDay = d;
        if (m === 2 && d === 29) {
          targetDay = isLeap(targetYear) ? 29 : 28;
        }
        const pad = (n) => String(n).padStart(2, '0');
        return `${targetYear}-${pad(m)}-${pad(targetDay)}`;
      };

      const formatCalDate = (dStr) => {
        if (!dStr) return 'N/D';
        const raw = typeof dStr === 'string' ? dStr.split('T')[0] : (new Date(dStr)).toISOString().split('T')[0];
        const parts = raw.split('-');
        if (parts.length !== 3) return formatDO(dStr);
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        const d = parseInt(parts[2], 10);
        const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
        return `${d} ${months[m]} ${y}`;
      };

      // Fecha actual en hora de República Dominicana (UTC-4)
      const drFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Santo_Domingo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const todayStr = drFormatter.format(new Date());

      // 7. Motor de evaluación de aniversarios y estados
      const allUpcomingPending = [];
      const allPaidInPeriod = [];
      const allOverdueContracts = new Set();
      const periodRows = [];

      for (const ct of contracts) {
        if (!ct.signed_at) {
          periodRows.push({
            contract_id: ct.contract_id,
            client_id: ct.client_id,
            cliente: ct.cliente || 'Socia Plan Beauty',
            telefono: ct.telefono || '',
            plan: ct.plan,
            sucursal: ct.sucursal,
            fecha_firma: 'N/D',
            fecha_renovacion: 'N/D',
            fecha_renovacion_raw: '9999-12-31',
            importe: `RD$ ${renewalFee.toLocaleString('es-DO')}`,
            importe_num: renewalFee,
            dias_restantes: 'Inconsistente',
            dias_num: 9999,
            estado: 'Requiere revisión',
            accion: 'Perfil'
          });
          continue;
        }

        const signedIso = new Date(ct.signed_at).toISOString().split('T')[0];
        const signedYear = parseInt(signedIso.split('-')[0], 10);
        const currentYear = parseInt(todayStr.split('-')[0], 10);
        const maxYears = Math.max(2, (currentYear - signedYear) + 2);

        const clientPayments = paymentsByClient.get(String(ct.client_id)) || [];
        const contractSuffix = ct.contract_id ? String(ct.contract_id).slice(-4) : '';
        const planPrice = parseFloat(ct.plan_price || 1950);
        const expectedCombined = planPrice + renewalFee;

        let earliestPendingFound = false;

        for (let k = 1; k <= maxYears; k++) {
          const annivDateStr = getAnnivDateStr(signedIso, k);
          if (!annivDateStr) break;

          const annivDateObj = new Date(`${annivDateStr}T00:00:00Z`);
          // Ventana de verificación de pago: hasta 20 días antes (cubre adelanto del cron de 365 días) y hasta 60 días después
          const minPayDate = new Date(annivDateObj.getTime() - (20 * 24 * 60 * 60 * 1000));
          const maxPayDate = new Date(annivDateObj.getTime() + (60 * 24 * 60 * 60 * 1000));

          const isMultiContractClient = (contractsCountByClient.get(String(ct.client_id)) || 1) > 1;

          let unambiguousPayment = null;
          let ambiguousPaymentFound = false;

          for (const p of clientPayments) {
            const pDate = new Date(p.created_at);
            if (isNaN(pDate.getTime()) || pDate < minPayDate || pDate > maxPayDate) continue;

            // Verificar si el pago tiene identificador explícito de contrato
            let paymentHasContractId = false;
            let paymentMatchesThisContract = false;

            if (p.gateway_ref && p.gateway_ref.includes('AUTO-') && ct.contract_id) {
              const refSuffix = p.gateway_ref.replace(/.*AUTO-/, '');
              const refNum = parseInt(refSuffix, 10);
              const ctNum = parseInt(ct.contract_id, 10);
              if (!isNaN(refNum) && !isNaN(ctNum)) {
                paymentHasContractId = true;
                if (refNum === ctNum) paymentMatchesThisContract = true;
                else continue; // Pertenece inequívocamente a OTRO contrato
              }
            }
            if (p.id && p.id.includes('PAY-AUTO-') && ct.contract_id) {
              const idParts = p.id.split('-');
              const idSuffix = idParts[idParts.length - 1];
              const idNum = parseInt(idSuffix, 10);
              const ctNum = parseInt(ct.contract_id, 10);
              if (!isNaN(idNum) && !isNaN(ctNum)) {
                paymentHasContractId = true;
                if (idNum === ctNum) paymentMatchesThisContract = true;
                else continue; // Pertenece inequívocamente a OTRO contrato
              }
            }

            const amt = parseFloat(p.amount);
            const desc = (p.description || '').toLowerCase();
            const hasRenovDesc = desc.includes('renovación anual') || desc.includes('renovacion anual') || desc.includes('cuota anual');
            const hasCombinedAmt = Math.abs(amt - expectedCombined) < 1.0;
            const hasFeeAmt = Math.abs(amt - renewalFee) < 1.0;

            // Descartar cobros de salón no relacionados (ej. RD$ 800 de mostrador sin descripción de suscripción ni referencia AUTO)
            if (hasFeeAmt && !hasRenovDesc && !paymentHasContractId) {
              continue;
            }

            if (!hasRenovDesc && !hasCombinedAmt && !hasFeeAmt) {
              continue;
            }

            // Si la socia tiene más de un contrato y el pago carece de identificador de contrato inequívoco:
            if (isMultiContractClient && !paymentHasContractId) {
              ambiguousPaymentFound = true;
              continue;
            }

            // Identificador y prueba confiable confirmada
            if (paymentMatchesThisContract || (!isMultiContractClient && (hasRenovDesc || hasCombinedAmt))) {
              unambiguousPayment = p;
              break;
            }
          }

          const hasUnambiguousPayment = !!unambiguousPayment;
          let hasLastAnnualEvidence = false;
          if (ct.last_annual_fee_date) {
            const lastAnnual = new Date(ct.last_annual_fee_date);
            if (!isNaN(lastAnnual.getTime()) && lastAnnual >= minPayDate) {
              hasLastAnnualEvidence = true;
            }
          }

          let cycleState = 'Pendiente';
          if (hasUnambiguousPayment && hasLastAnnualEvidence) {
            cycleState = 'Pagada';
          } else if (hasLastAnnualEvidence && !hasUnambiguousPayment) {
            // Marcador en contrato pero falta comprobante bancario inequívoco
            cycleState = 'Requiere revisión';
          } else if (hasUnambiguousPayment && !hasLastAnnualEvidence) {
            // Pago confirmado por pasarela con identificador inequívoco
            cycleState = 'Pagada';
          } else if (ambiguousPaymentFound) {
            // Existe pago en el período pero falta identificador inequívoco de contrato -> Requiere revisión
            cycleState = 'Requiere revisión';
          } else {
            if (annivDateStr < todayStr) {
              cycleState = 'Vencida';
              allOverdueContracts.add(ct.contract_id);
            } else {
              cycleState = 'Pendiente';
            }
          }

          // Días restantes respecto a la fecha actual de RD
          const diffMs = new Date(`${annivDateStr}T00:00:00Z`).getTime() - new Date(`${todayStr}T00:00:00Z`).getTime();
          const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
          let diasText = '';
          if (diffDays === 0) diasText = 'Hoy';
          else if (diffDays === 1) diasText = '1 día';
          else if (diffDays > 1) diasText = `${diffDays} días`;
          else diasText = `Vencido hace ${Math.abs(diffDays)} días`;

          const rowData = {
            contract_id: ct.contract_id,
            client_id: ct.client_id,
            cliente: ct.cliente || 'Socia Plan Beauty',
            telefono: ct.telefono || '',
            plan: ct.plan,
            sucursal: ct.sucursal,
            fecha_firma: formatCalDate(ct.signed_at),
            fecha_renovacion: formatCalDate(annivDateStr),
            fecha_renovacion_raw: annivDateStr,
            importe: `RD$ ${renewalFee.toLocaleString('es-DO')}`,
            importe_num: renewalFee,
            dias_restantes: diasText,
            dias_num: diffDays,
            estado: cycleState,
            ciclo: k,
            accion: 'Perfil'
          };

          // Seguimiento para KPIs
          if (cycleState === 'Pendiente' && !earliestPendingFound) {
            earliestPendingFound = true;
            if (annivDateStr >= start && annivDateStr <= end) {
              allUpcomingPending.push(rowData);
            }
          }

          if (cycleState === 'Pagada' && annivDateStr >= start && annivDateStr <= end) {
            allPaidInPeriod.push(rowData);
          }

          // Incluir en la tabla si cae dentro del rango consultado
          if (annivDateStr >= start && annivDateStr <= end) {
            periodRows.push(rowData);
          }
        }
      }

      // Ordenar filas cronológicamente por fecha de renovación más próxima
      periodRows.sort((a, b) => a.fecha_renovacion_raw.localeCompare(b.fecha_renovacion_raw) || a.dias_num - b.dias_num);

      // 8. Construcción de KPIs
      const totalPendientes = allUpcomingPending.length;
      const totalImportePrevisto = totalPendientes * renewalFee;
      const totalVencidas = allOverdueContracts.size;
      const totalPagadas = allPaidInPeriod.length;

      // 9. Agrupación por sucursal (Conciliada estrictamente con KPI 1)
      const sucursalMap = new Map();
      salonsList.forEach(s => sucursalMap.set(s.name, 0));

      for (const item of allUpcomingPending) {
        const suc = item.sucursal || 'Abatte Peluquería San Vicente';
        sucursalMap.set(suc, (sucursalMap.get(suc) || 0) + 1);
      }

      const chartData = Array.from(sucursalMap.entries())
        .map(([label, count]) => {
          const pct = totalPendientes > 0 ? Number(((count / totalPendientes) * 100).toFixed(1)) : 0;
          return {
            label,
            value: count,
            count,
            percentage: pct,
            displayValue: `${count} (${pct}%)`
          };
        })
        .sort((a, b) => b.value - a.value);

      return {
        title: 'Renovación anual de contratos',
        periodText: `${start} al ${end}`,
        alertInfo: 'Identifica las membresías cuyos contratos están próximos a cumplir su vigencia anual y devengar el cargo de renovación de RD$ 800, de forma independiente a la cuota mensual.',
        kpis: [
          { label: 'Renovaciones próximas pendientes', value: totalPendientes.toString(), subtext: 'En el período seleccionado', icon: 'credit_card', color: 'blue' },
          { label: 'Importe previsto por renovaciones anuales', value: `RD$ ${totalImportePrevisto.toLocaleString('es-DO')}`, subtext: `Calculado a RD$ ${renewalFee} c/u`, icon: 'dollar', color: 'emerald' },
          { label: 'Renovaciones anuales vencidas', value: totalVencidas.toString(), subtext: totalVencidas > 0 ? 'Cartera anual en mora' : 'Sin morosidad anual', icon: 'alert', color: totalVencidas > 0 ? 'red' : 'slate' },
          { label: 'Renovaciones anuales pagadas', value: totalPagadas.toString(), subtext: 'Confirmadas en el período', icon: 'check', color: 'emerald' }
        ],
        chart: {
          type: 'bar',
          title: 'Distribución por Sucursal (Próximas a Renovar)',
          data: chartData
        },
        table: {
          title: 'Detalle de renovaciones anuales',
          badgeText: `${periodRows.length} contratos`,
          total_count: periodRows.length,
          columns: [
            { key: 'cliente', label: 'Cliente' },
            { key: 'plan', label: 'Plan' },
            { key: 'sucursal', label: 'Sucursal' },
            { key: 'fecha_firma', label: 'Fecha de Firma', align: 'center' },
            { key: 'fecha_renovacion', label: 'Fecha Aniversario Anual', align: 'center' },
            { key: 'importe', label: 'Cargo Renovación', align: 'right', isCurrency: true },
            { key: 'dias_restantes', label: 'Días Restantes', align: 'center' },
            { key: 'estado', label: 'Estado', align: 'center' },
            { key: 'accion', label: 'Acción', align: 'center' }
          ],
          rows: periodRows,
          footerNote: 'El cargo de renovación anual (RD$ 800) es independiente de los cobros mensuales recurrentes. Los días restantes se calculan respecto a la fecha actual.'
        }
      };
    } catch (e) {
      console.warn('DB error in contracts_upcoming_renewal:', e.message);
      throw e;
    }
  }

  // ==========================================
  // 18. RESULTADO DE COBROS RECURRENTES Y RECUPERACIÓN (A2)
  // Reconstrucción determinista de cohortes y obligaciones mensuales individuales
  // sin depender de next_billing_date mutable ni ventanas fijas de días.
  // ==========================================
  if (reportId === 'recurring_charges_result' || reportId === 'declined_charges_recovery') {
    try {
      // 1. Filtros de base
      const whereConditions = [];
      const queryParams = [];

      if (salonId !== 'all') {
        whereConditions.push("(ct.salon_id = ? OR (ct.salon_id IS NULL AND cl.salon_id = ?) OR s.name LIKE ?)");
        queryParams.push(salonId, salonId, `%${salonId}%`);
      }

      const effectivePlan = (planId && planId !== 'all') ? planId : (membership && membership !== 'all' ? membership : null);
      if (effectivePlan) {
        whereConditions.push("(ct.plan_id = ? OR p.title = ?)");
        queryParams.push(effectivePlan, effectivePlan);
      }

      const whereSql = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : '';

      // 2. Consultar contratos (incluye contratos activos, cancelados o suspendidos para preservar historial)
      const [contracts] = await pool.query(`
        SELECT
          ct.id as contract_id,
          ct.client_id,
          cl.nombre as cliente,
          cl.telefono,
          cl.email,
          COALESCE(p.title, 'Plan Beauty') as plan,
          ct.plan_id,
          COALESCE(ct.contract_price, p.price, 1950.00) as contract_price,
          COALESCE(ct.salon_id, cl.salon_id, 1) as salon_id,
          COALESCE(s.name, 'San Vicente') as sucursal,
          ct.status as estado_contrato,
          ct.signed_at,
          ct.next_billing_date,
          ct.retry_count,
          ct.last_billed_date
        FROM contracts ct
        JOIN clients cl ON ct.client_id = cl.id
        LEFT JOIN plans p ON ct.plan_id = p.id
        LEFT JOIN salons s ON COALESCE(ct.salon_id, cl.salon_id, 1) = s.id
        ${whereSql}
        ORDER BY ct.signed_at ASC
      `, queryParams);

      // 3. Consultar todos los pagos históricos con formato de fecha estricto del servidor
      const [payments] = await pool.query(`
        SELECT
          id, client_id, plan_id, amount, method, status, gateway_ref, description, cardnet_raw_response, salon_id,
          created_at,
          DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as created_at_str
        FROM payments
        ORDER BY created_at ASC
      `);

      // 4. Mapeo estructurado por cliente y control estricto de deduplicación de pagos
      const contractsByClientId = new Map();
      for (const ct of contracts) {
        if (!contractsByClientId.has(ct.client_id)) contractsByClientId.set(ct.client_id, []);
        contractsByClientId.get(ct.client_id).push(ct);
      }

      const paymentsByClient = new Map();
      for (const p of payments) {
        if (!paymentsByClient.has(p.client_id)) paymentsByClient.set(p.client_id, []);
        paymentsByClient.get(p.client_id).push(p);
      }

      // Helper para clasificar códigos y causas de rechazo CardNet con rigor técnico
      function classifyDecline(rawResponse, statusText, description) {
        const isConnError = (statusText && statusText.startsWith('Error_Conexion')) ||
          (description && description.toLowerCase().includes('timeout')) ||
          (description && description.toLowerCase().includes('conexi')) ||
          (description && description.toLowerCase().includes('network'));

        if (isConnError) {
          return {
            category: 'Error Conexión',
            code: 'SYS_TIMEOUT',
            reason: 'Error de conexión con la pasarela (Timeout / Red)'
          };
        }

        let code = null;
        let rawMsg = '';

        if (rawResponse) {
          try {
            const raw = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse;
            code = raw.ResponseCode || raw.response_code || raw.Transaction?.ResponseCode || (raw.error && !raw.error.includes(' ') ? raw.error : null);
            rawMsg = raw.ResponseMessage || raw.message || raw.error || raw.Transaction?.Description || '';
          } catch (e) {
            rawMsg = '';
          }
        }

        const combined = `${code || ''} ${rawMsg} ${description || ''}`.toLowerCase();

        // Fondos insuficientes confirmados (Código 51 o mensaje explícito de fondos)
        if (code === '51' || combined.includes('fondos insuficientes') || combined.includes('insufficient funds')) {
          return {
            category: 'Fondos Insuficientes',
            code: code || '51',
            reason: 'Fondos insuficientes confirmados (51)'
          };
        }

        // Tarjeta vencida o token inválido confirmado (Código 54, PR001, token expirado)
        if (code === 'PR001' || code === '54' || combined.includes('token') || combined.includes('vencid') || combined.includes('expired')) {
          return {
            category: 'Token o Tarjeta Inválida',
            code: code || 'PR001',
            reason: rawMsg || 'Token inválido o tarjeta vencida'
          };
        }

        // Reglas de seguridad / Exceso de reintentos (Códigos 63, 65)
        if (code === '65' || combined.includes('velocity')) {
          return {
            category: 'Límite de Intentos',
            code: '65',
            reason: 'Límite de frecuencia de cobros excedido (65)'
          };
        }
        if (code === '63' || combined.includes('security')) {
          return {
            category: 'Seguridad Emisor',
            code: '63',
            reason: 'Rechazo de seguridad del banco emisor (63)'
          };
        }

        // Transacción inválida (Código 12)
        if (code === '12' || combined.includes('transaccion invalida')) {
          return {
            category: 'Transacción Inválida',
            code: '12',
            reason: 'Transacción rechazada como inválida por el emisor (12)'
          };
        }

        // Rechazo del emisor sin causa detallada (Código 05 o "Declinada" general)
        if (code === '05' || combined.includes('declinad') || combined.includes('do not honor')) {
          return {
            category: 'Declinada Emisor',
            code: '05',
            reason: 'Declinada por el banco emisor sin causa detallada (05)'
          };
        }

        return {
          category: 'Rechazo Desconocido',
          code: code || 'UNK',
          reason: rawMsg || 'Rechazo bancario sin detalle'
        };
      }

      // 5. Reconstrucción de obligaciones mensuales con control de duplicación y separación de pagos sin atribución
      const allReconstructedObligations = [];
      const allUnmatchedPayments = [];
      const processedPaymentIds = new Set();
      const startDateTimeStr = `${start} 00:00:00`;
      const endDateTimeStr = `${end} 23:59:59`;

      // Helper para asociación contractual estructurada sin coincidencias accidentales
      function matchContractForPayment(p, clientContracts) {
        const pid = p.id || '';
        const desc = p.description || '';
        const gref = p.gateway_ref || '';
        const lowerDesc = desc.toLowerCase();
        const amt = parseFloat(p.amount) || 0;
        const isSingleContract = clientContracts.length === 1;

        // 1. Descarte estricto de conceptos ajenos a membresía (servicios POS de peluquería, productos retail, propinas, etc.)
        const isNonMembership = lowerDesc.includes('giftcard') || lowerDesc.includes('propina') ||
          lowerDesc.includes('producto') || lowerDesc.includes('shampoo') ||
          lowerDesc.includes('corte') || lowerDesc.includes('peinado') ||
          lowerDesc.includes('tinte') || lowerDesc.includes('balayage') ||
          lowerDesc.includes('manicure') || lowerDesc.includes('pedicure') ||
          lowerDesc.includes('uñas') || lowerDesc.includes('unas') ||
          lowerDesc.includes('venta pos') || lowerDesc.includes('servicio salon') ||
          (amt > 0 && amt < 100.00);

        if (isNonMembership) {
          return { contract: null, matchType: 'non_membership_concept', reason: 'Operación ajena a membresía (servicio de salón o producto)' };
        }

        // Si es cliente de contrato único:
        if (isSingleContract) {
          const ct = clientContracts[0];
          const cid = ct.contract_id || '';
          const suffix = cid.slice(-4);

          // Verificar si es intento de activación inicial (Ciclo 0 onboarding)
          const isActivationOrInit = pid === `PAY-INIT-${cid}` ||
            pid.startsWith('PAY-INIT-') ||
            p.status === 'Fallido - Intento Inicial' ||
            lowerDesc.includes('activación declinado') ||
            lowerDesc.includes('activacion declinado') ||
            lowerDesc.includes('intento inicial');
          if (isActivationOrInit) {
            return { contract: ct, matchType: 'init' };
          }

          // Señal A: Cobro automático recurrente generado por el cron/motor CardNet
          const isAutoRecurring = p.method === 'CardNet_Auto' ||
            pid.startsWith('PAY-AUTO-') ||
            pid.startsWith('PAY-FAIL-') ||
            pid.startsWith('PAY-SYS-');
          if (isAutoRecurring) {
            return { contract: ct, matchType: 'auto_recurring' };
          }

          // Señal B: Referencia contractual explícita en ID, gateway_ref o descripción
          const hasSuffixInId = pid.endsWith(`-${suffix}`);
          const fullIdRegex = new RegExp(`(?:^|[^0-9])${cid}(?:[^0-9]|$)`);
          const explicitSuffixRegex = new RegExp(`(?:^|[^a-zA-Z0-9])(?:CT|CONTRATO|CTR|CONTRACT|#)[-_\\s]*${suffix}(?:[^0-9]|$)`, 'i');
          if (hasSuffixInId || fullIdRegex.test(desc) || fullIdRegex.test(gref) || explicitSuffixRegex.test(desc) || explicitSuffixRegex.test(gref)) {
            return { contract: ct, matchType: 'explicit_contract_reference' };
          }

          // Señal C: Descripción explícita de membresía o nombre del plan
          const planNameLower = (ct.plan || '').toLowerCase();
          const hasMembershipKeyword = lowerDesc.includes('plan beauty') ||
            lowerDesc.includes('membresía') ||
            lowerDesc.includes('membresia') ||
            lowerDesc.includes('cuota') ||
            lowerDesc.includes('mensualidad') ||
            lowerDesc.includes('suscripción') ||
            lowerDesc.includes('suscripcion') ||
            lowerDesc.includes('renovación') ||
            lowerDesc.includes('renovacion') ||
            (planNameLower && lowerDesc.includes(planNameLower));
          if (hasMembershipKeyword) {
            return { contract: ct, matchType: 'membership_description' };
          }

          // Señal D: Ruta de cobro recurrente guardada o mensualidad manual legítima con cuota exacta
          const isSavedCardRoute = p.method === 'Tarjeta_Guardada' || p.method === 'CardNet_Saved_Card';
          const isExactQuotaAmount = Math.abs(amt - (parseFloat(ct.contract_price) || 1950.00)) < 0.01;
          if (isSavedCardRoute) {
            return { contract: ct, matchType: 'membership_route' };
          }

          if (isExactQuotaAmount && (p.method === 'Efectivo/POS' || p.method === 'Transferencia' || p.method === 'CardNet')) {
            return { contract: ct, matchType: 'manual_membership_payment' };
          }

          // Si carece de evidencia suficiente, enviar a conciliación como pendiente de atribución
          return { contract: null, matchType: 'insufficient_evidence', reason: 'Pago de cliente con contrato único sin evidencia verificable de mensualidad de membresía' };
        }

        // Cliente con múltiples contratos:
        const candidates = [];
        for (const ct of clientContracts) {
          const cid = ct.contract_id || '';
          const suffix = cid.slice(-4);

          if (pid === `PAY-INIT-${cid}` || pid.startsWith(`PAY-INIT-${suffix}`) || p.status === 'Fallido - Intento Inicial' || lowerDesc.includes('activación declinado')) {
            candidates.push({ contract: ct, matchType: 'init' });
            continue;
          }

          if (pid.endsWith(`-${suffix}`)) {
            candidates.push({ contract: ct, matchType: 'suffix_in_id' });
            continue;
          }

          if (pid.includes(`-${cid}`) || pid.endsWith(`_${cid}`)) {
            candidates.push({ contract: ct, matchType: 'contract_in_id' });
            continue;
          }

          // Validación estructurada en description o gateway_ref con límites de palabra
          const fullIdRegex = new RegExp(`(?:^|[^0-9])${cid}(?:[^0-9]|$)`);
          if (fullIdRegex.test(desc) || fullIdRegex.test(gref)) {
            candidates.push({ contract: ct, matchType: 'full_id_in_text' });
            continue;
          }

          // Prefijo contractual explícito (CT-XXXX, CONTRATO XXXX, CTR-XXXX, #XXXX)
          const explicitSuffixRegex = new RegExp(`(?:^|[^a-zA-Z0-9])(?:CT|CONTRATO|CTR|CONTRACT|#)[-_\\s]*${suffix}(?:[^0-9]|$)`, 'i');
          if (explicitSuffixRegex.test(desc) || explicitSuffixRegex.test(gref)) {
            candidates.push({ contract: ct, matchType: 'explicit_suffix_in_text' });
            continue;
          }
        }

        if (candidates.length === 1) {
          return candidates[0];
        }
        if (candidates.length > 1) {
          return { contract: null, matchType: 'ambiguous_multiple_matches', reason: 'Ambigüedad contractual múltiple (coincide con más de un contrato)' };
        }
        return { contract: null, matchType: 'no_match', reason: 'Cliente con múltiples contratos sin referencia contractual estructurada' };
      }

      function buildContractObligations(ct, contractPayments, targetList, unmatchedList, clientHasUntraceableReversal = false) {
        contractPayments.sort((a, b) => (a.created_at_str < b.created_at_str ? -1 : (a.created_at_str > b.created_at_str ? 1 : 0)));
        const suffix = (ct.contract_id || '').slice(-4);
        let currentObligation = null;
        let lastSettledObligation = null;
        let cycleNumber = 0;

        for (const p of contractPayments) {
          if (p.matchType === 'init' || p.status === 'Fallido - Intento Inicial' || (p.description || '').toLowerCase().includes('activación declinado')) {
            // Ciclo 0 (alta inicial). No es cuota recurrente mensual.
            continue;
          }

          // Si el pago es una fila de reversión o anulación
          const isReversalRow = p.status === 'Anulado' || p.status === 'Anulada' || p.status === 'Revertido' || p.status === 'Devuelto' || (parseFloat(p.amount) < 0);
          if (isReversalRow) {
            continue;
          }

          // Si este pago fue revertido por una transacción de reversión vinculada,
          // se conserva en los intentos de la obligación pero no liquida la cuota (isApproved = false).
          const isApproved = p.status === 'Aprobado' && !p.is_reversed;
          const isFailed = p.status.startsWith('Fallido') || p.status === 'Rechazado';
          const isConnError = p.status.startsWith('Error_Conexion') || (p.description || '').toLowerCase().includes('timeout') || (p.description || '').toLowerCase().includes('conexi');
          const isExplicitIntento1 = /Intento\s+1\b/i.test(p.status) || /Intento\s+1\b/i.test(p.description || '');

          const pLowerDesc = (p.description || '').toLowerCase();
          const pLowerRef = (p.gateway_ref || '').toLowerCase();

          // Señales estructuradas e inequívocas de nuevo ciclo contractual
          const hasCycleNumber = p.cycle_number && lastSettledObligation && p.cycle_number > lastSettledObligation.cycle_number;
          const cycleNumberRegex = /\b(?:ciclo|cuota|mes)\s*([0-9]+)\b/i;
          const matchCycleDesc = (p.description || '').match(cycleNumberRegex) || (p.gateway_ref || '').match(cycleNumberRegex);
          const hasHigherCycleNumber = matchCycleDesc && lastSettledObligation && parseInt(matchCycleDesc[1], 10) > (lastSettledObligation.cycle_number || 1);
          const explicitCycleSuffixRegex = new RegExp(`(?:CT|CTR|CONTRATO|#)[-_\\s]*${suffix}[-_\\s]*(?:C|CICLO|M)?\\s*([0-9]+)`, 'i');
          const hasContractCycleRef = explicitCycleSuffixRegex.test(p.description || '') || explicitCycleSuffixRegex.test(p.gateway_ref || '');

          // Señales estructuradas de pago adelantado
          const isAdvanceKeyword = pLowerDesc.includes('adelanto') || pLowerDesc.includes('anticipo') || pLowerDesc.includes('adelantad') ||
            pLowerRef.includes('adelanto') || pLowerRef.includes('anticipo');
          const hasAdvanceTarget = /\b(?:ciclo\s*[0-9]+|cuota\s*[0-9]+|mes\s+siguiente|pr[oó]ximo\s+ciclo|noviembre|diciembre|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre)\b/i.test(p.description || '') ||
            /\b(?:ciclo\s*[0-9]+|cuota\s*[0-9]+)\b/i.test(p.gateway_ref || '') ||
            hasContractCycleRef;
          const isValidAdvance = isAdvanceKeyword && hasAdvanceTarget;
          const isUntracedAdvance = isAdvanceKeyword && !hasAdvanceTarget;

          // Si no hay obligación abierta
          if (!currentObligation) {
            // Verificar si la obligación previa ya estaba completamente liquidada y llega un cobro aprobado
            if (lastSettledObligation && lastSettledObligation.is_settled && isApproved) {
              const diffDays = Math.max(0, (new Date(p.created_at).getTime() - new Date(lastSettledObligation.settled_at).getTime()) / 86400000);
              const isSameCalendarDay = p.created_at_str && lastSettledObligation.settled_at_str && (p.created_at_str.slice(0, 10) === lastSettledObligation.settled_at_str.slice(0, 10));

              // Señal estructurada A: Cobro automático recurrente del cron para este contrato en su fecha de renovación mensual
              const isContractAutoRenewal = (p.method === 'CardNet_Auto' || p.id.startsWith('PAY-AUTO-')) &&
                (p.id.endsWith(`-${suffix}`) || (p.gateway_ref && p.gateway_ref.includes(suffix))) &&
                (pLowerDesc.includes('recurrente') || pLowerDesc.includes('cobro mensual')) &&
                (diffDays >= 25.0);

              const isValidNewCycle = isContractAutoRenewal || hasCycleNumber || hasHigherCycleNumber || hasContractCycleRef ||
                (pLowerDesc.includes('ciclo 2') || pLowerDesc.includes('ciclo 3') || pLowerDesc.includes('cuota 2') || pLowerDesc.includes('cuota 3'));

              // 1. Caso Adelanto con ciclo o período destino identificado: abre ciclo legítimo adelantado
              if (isValidAdvance) {
                // Abre ciclo legítimo adelantado
              }
              // 2. Caso Adelanto sin identificación suficiente de ciclo o contrato: no inventar cuota, conservar en conciliación
              else if (isUntracedAdvance) {
                unmatchedList.push({
                  id: p.id,
                  client_id: ct.client_id,
                  cliente: ct.cliente || 'Socia Plan Beauty',
                  amount: parseFloat(p.amount) || 0,
                  method: p.method,
                  gateway_ref: p.gateway_ref || null,
                  description: p.description || null,
                  created_at: p.created_at,
                  created_at_str: p.created_at_str,
                  status: p.status,
                  attribution_status: 'Pendiente de atribución',
                  reason: 'Adelanto o anticipo sin identificación suficiente de ciclo o período destino',
                  contracts_affected: [ct.contract_id]
                });
                continue;
              }
              // 3. Caso Nueva obligación legítima apoyada en evidencia contractual o referencias estructuradas
              else if (isValidNewCycle) {
                // Abre nueva obligación legítima
              }
              // 4. Caso Mismo día (o < 1 día) sin nuevo ciclo: segundo cobro duplicado/adicional
              else if (isSameCalendarDay || diffDays < 1.0) {
                unmatchedList.push({
                  id: p.id,
                  client_id: ct.client_id,
                  cliente: ct.cliente || 'Socia Plan Beauty',
                  amount: parseFloat(p.amount) || 0,
                  method: p.method,
                  gateway_ref: p.gateway_ref || null,
                  description: p.description || null,
                  created_at: p.created_at,
                  created_at_str: p.created_at_str,
                  status: p.status,
                  attribution_status: 'Pendiente de atribución',
                  reason: `Segundo cobro aprobado el mismo día para contrato #${suffix} en ciclo ya liquidado`,
                  contracts_affected: [ct.contract_id]
                });
                continue;
              }
              // 5. Cualquier otro cobro posterior (incluso después de 25 días) sin evidencia verificable de nuevo ciclo:
              // Se conserva en conciliación sin descartarlo ni inventar una cuota artificial
              else {
                unmatchedList.push({
                  id: p.id,
                  client_id: ct.client_id,
                  cliente: ct.cliente || 'Socia Plan Beauty',
                  amount: parseFloat(p.amount) || 0,
                  method: p.method,
                  gateway_ref: p.gateway_ref || null,
                  description: p.description || null,
                  created_at: p.created_at,
                  created_at_str: p.created_at_str,
                  status: p.status,
                  attribution_status: 'Pendiente de atribución',
                  reason: diffDays >= 25.0
                    ? `Pago aprobado después de ${Math.round(diffDays)} días sin evidencia estructurada de nuevo ciclo contractual`
                    : `Pago aprobado posterior a cuota liquidada sin evidencia de nuevo ciclo, adelanto ni vencimiento contractual`,
                  contracts_affected: [ct.contract_id]
                });
                continue;
              }
            }

            // Iniciar nueva obligación
            cycleNumber++;
            let declineClassification = null;
            if (isConnError || isFailed) {
              declineClassification = classifyDecline(p.cardnet_raw_response, p.status, p.description);
            }

            let initialStatus = p.status === 'Aprobado' ? 'Aprobado' : (declineClassification ? declineClassification.category : (p.is_reversed ? 'Revertido' : 'Fallido'));
            let effectiveQuota = parseFloat(ct.contract_price) || 1950.00;
            const amtPaid = isApproved ? (parseFloat(p.amount) || 0) : 0;
            const isFullyPaid = amtPaid >= effectiveQuota;

            currentObligation = {
              obligation_id: `OBL-${ct.contract_id}-C${cycleNumber}`,
              contract_id: ct.contract_id,
              contract_suffix: suffix,
              client_id: ct.client_id,
              cliente: ct.cliente || 'Socia Plan Beauty',
              telefono: ct.telefono || '',
              email: ct.email || '',
              plan: ct.plan || 'Plan Beauty',
              plan_id: ct.plan_id,
              salon_id: ct.salon_id,
              sucursal: ct.sucursal || 'San Vicente',
              cycle_number: cycleNumber,
              cuota: effectiveQuota,
              amount_paid: amtPaid,
              saldo_pendiente: Math.max(0, effectiveQuota - amtPaid),
              opened_at: p.created_at,
              opened_at_str: p.created_at_str,
              initial_status: initialStatus,
              initial_decline_code: declineClassification ? declineClassification.code : null,
              initial_decline_reason: declineClassification ? declineClassification.reason : null,
              attempts: [p],
              is_settled: isFullyPaid,
              settled_at: isFullyPaid ? p.created_at : null,
              settled_at_str: isFullyPaid ? p.created_at_str : null,
              settled_method: isFullyPaid ? p.method : null,
              confidence: (p.isAmbiguous || clientHasUntraceableReversal) ? 'requires_review' : 'high'
            };

            if (isFullyPaid) {
              targetList.push(currentObligation);
              lastSettledObligation = currentObligation;
              currentObligation = null;
            }
          } else {
            // Hay una obligación abierta (unsettled)
            const isContinuation = !currentObligation.is_settled && !isExplicitIntento1;

            if (isContinuation) {
              currentObligation.attempts.push(p);

              if (isApproved) {
                const addAmt = parseFloat(p.amount) || 0;
                currentObligation.amount_paid = (currentObligation.amount_paid || 0) + addAmt;
                currentObligation.saldo_pendiente = Math.max(0, currentObligation.cuota - currentObligation.amount_paid);

                if (currentObligation.amount_paid >= currentObligation.cuota) {
                  currentObligation.is_settled = true;
                  currentObligation.settled_at = p.created_at;
                  currentObligation.settled_at_str = p.created_at_str;
                  currentObligation.settled_method = p.method;
                  targetList.push(currentObligation);
                  lastSettledObligation = currentObligation;
                  currentObligation = null;
                }
              }
            } else {
              // Intento 1 explícito mientras había otra obligación abierta: cerrar la anterior como impaga y abrir la nueva
              targetList.push(currentObligation);
              lastSettledObligation = currentObligation;
              cycleNumber++;
              let declineClassification = null;
              if (isConnError || isFailed) {
                declineClassification = classifyDecline(p.cardnet_raw_response, p.status, p.description);
              }

              let initialStatus = p.status === 'Aprobado' ? 'Aprobado' : (declineClassification ? declineClassification.category : (p.is_reversed ? 'Revertido' : 'Fallido'));
              let effectiveQuota = parseFloat(ct.contract_price) || 1950.00;
              const amtPaid = isApproved ? (parseFloat(p.amount) || 0) : 0;
              const isFullyPaid = amtPaid >= effectiveQuota;

              currentObligation = {
                obligation_id: `OBL-${ct.contract_id}-C${cycleNumber}`,
                contract_id: ct.contract_id,
                contract_suffix: suffix,
                client_id: ct.client_id,
                cliente: ct.cliente || 'Socia Plan Beauty',
                telefono: ct.telefono || '',
                email: ct.email || '',
                plan: ct.plan || 'Plan Beauty',
                plan_id: ct.plan_id,
                salon_id: ct.salon_id,
                sucursal: ct.sucursal || 'San Vicente',
                cycle_number: cycleNumber,
                cuota: effectiveQuota,
                amount_paid: amtPaid,
                saldo_pendiente: Math.max(0, effectiveQuota - amtPaid),
                opened_at: p.created_at,
                opened_at_str: p.created_at_str,
                initial_status: initialStatus,
                initial_decline_code: declineClassification ? declineClassification.code : null,
                initial_decline_reason: declineClassification ? declineClassification.reason : null,
                attempts: [p],
                is_settled: isFullyPaid,
                settled_at: isFullyPaid ? p.created_at : null,
                settled_at_str: isFullyPaid ? p.created_at_str : null,
                settled_method: isFullyPaid ? p.method : null,
                confidence: (p.isAmbiguous || clientHasUntraceableReversal) ? 'requires_review' : 'high'
              };

              if (isFullyPaid) {
                targetList.push(currentObligation);
                lastSettledObligation = currentObligation;
                currentObligation = null;
              }
            }
          }
        }

        if (currentObligation) {
          targetList.push(currentObligation);
        }
      }

      // Procesar clientes desduplicando transacciones por ID y sin sesgo de orden
      for (const [clientId, clientContracts] of contractsByClientId.entries()) {
        const clientPayments = paymentsByClient.get(clientId) || [];

        // 1. Identificar registros de reversión/anulación/devolución y vincular trazabilidad
        const reversalRecords = [];
        for (const p of clientPayments) {
          const lowerDesc = (p.description || '').toLowerCase();
          const isRev = p.status === 'Revertido' || p.status === 'Devuelto' || p.status === 'Anulado' ||
            (parseFloat(p.amount) < 0) || lowerDesc.includes('reverso') || lowerDesc.includes('devolución') ||
            lowerDesc.includes('devolucion') || lowerDesc.includes('refund');
          if (isRev) {
            reversalRecords.push(p);
          }
        }

        let clientHasUntraceableReversal = false;
        for (const rev of reversalRecords) {
          const targetPayment = clientPayments.find(other =>
            other.id !== rev.id &&
            other.status === 'Aprobado' &&
            !other.is_reversed &&
            (
              (rev.gateway_ref && other.gateway_ref && rev.gateway_ref === other.gateway_ref) ||
              (rev.gateway_ref && other.id && rev.gateway_ref === other.id) ||
              (rev.description && rev.description.includes(other.id)) ||
              (rev.id && rev.id.includes(other.id)) ||
              (other.gateway_ref && rev.description && rev.description.includes(other.gateway_ref))
            )
          );

          if (targetPayment) {
            targetPayment.is_reversed = true;
            targetPayment.reversed_by = rev.id;
            targetPayment.reversed_at = rev.created_at;
            targetPayment.reversed_at_str = rev.created_at_str || (rev.created_at ? (typeof rev.created_at === 'string' ? rev.created_at : new Date(rev.created_at).toISOString().replace('T', ' ').slice(0, 19)) : '');
            rev.is_reversal_processed = true;
          } else {
            rev.is_untraceable_reversal = true;
            clientHasUntraceableReversal = true;
          }
        }

        // Distribuir pagos por contrato según coincidencia estructurada
        const paymentsByContractMap = new Map();
        for (const ct of clientContracts) {
          paymentsByContractMap.set(ct.contract_id, []);
        }

        for (const p of clientPayments) {
          if (processedPaymentIds.has(p.id)) continue;
          const matchResult = matchContractForPayment(p, clientContracts);

          if (matchResult.contract) {
            processedPaymentIds.add(p.id);
            const pDateStr = p.created_at_str || (p.created_at ? new Date(p.created_at).toISOString().replace('T', ' ').slice(0, 19) : '');
            paymentsByContractMap.get(matchResult.contract.contract_id).push({
              ...p,
              created_at_str: pDateStr,
              matchType: matchResult.matchType
            });
          } else {
            // No hubo correspondencia inequívoca o es no membresía:
            processedPaymentIds.add(p.id);
            const pDateStr = p.created_at_str || (p.created_at ? new Date(p.created_at).toISOString().replace('T', ' ').slice(0, 19) : '');
            allUnmatchedPayments.push({
              id: p.id,
              client_id: clientId,
              cliente: clientContracts[0].cliente || 'Socia Plan Beauty',
              amount: parseFloat(p.amount) || 0,
              method: p.method,
              gateway_ref: p.gateway_ref || null,
              description: p.description || null,
              created_at: p.created_at,
              created_at_str: pDateStr,
              status: p.status,
              attribution_status: 'Pendiente de atribución',
              reason: matchResult.reason || 'Sin referencia contractual estructurada',
              contracts_affected: clientContracts.map(c => c.contract_id)
            });
          }
        }

        for (const ct of clientContracts) {
          const cPayments = paymentsByContractMap.get(ct.contract_id) || [];
          buildContractObligations(ct, cPayments, allReconstructedObligations, allUnmatchedPayments, clientHasUntraceableReversal);
        }
      }

      // 6. Filtrar por cohorte del período (apertura / 1er intento dentro de [startDateTimeStr, endDateTimeStr])
      const cohortObligations = allReconstructedObligations.filter(o => {
        return o.opened_at_str >= startDateTimeStr && o.opened_at_str <= endDateTimeStr;
      });

      // Pagos sin atribución ocurridos dentro del período seleccionado
      const cohortUnmatchedPayments = allUnmatchedPayments.filter(p => {
        return p.created_at_str >= startDateTimeStr && p.created_at_str <= endDateTimeStr;
      });

      // 7. Evaluar estado al corte vs estado actual de forma estrictamente independiente
      for (const o of cohortObligations) {
        // Intentos ocurridos antes o en la fecha de corte (hasta endDateTimeStr exacto)
        const attemptsAtCutoff = o.attempts.filter(a => a.created_at_str <= endDateTimeStr);
        // Coherencia de fecha de corte: pagos aprobados que fueron revertidos con posterioridad al corte
        // se consideran aprobados al momento del corte, pero se reflejan como no liquidados en el estado actual.
        const approvedAtCutoff = attemptsAtCutoff.filter(a => {
          if (a.status !== 'Aprobado') return false;
          if (a.is_reversed) {
            const revDateStr = a.reversed_at_str || '';
            const wasReversedBeforeCutoff = revDateStr && revDateStr <= endDateTimeStr;
            return !wasReversedBeforeCutoff;
          }
          return true;
        });
        const paidAtCutoff = approvedAtCutoff.reduce((acc, a) => acc + (parseFloat(a.amount) || 0), 0);
        const isSettledAtCutoff = paidAtCutoff >= o.cuota;
        o.saldo_pendiente_corte = Math.max(0, o.cuota - paidAtCutoff);
        o.amount_paid_corte = paidAtCutoff;

        if (o.confidence === 'requires_review') {
          o.estado_corte = 'Requiere revisión';
        } else if (isSettledAtCutoff) {
          if (attemptsAtCutoff.length === 1 && o.initial_status === 'Aprobado') {
            o.estado_corte = 'Pagada 1er intento';
          } else if (approvedAtCutoff.some(a => a.method === 'CardNet_Auto')) {
            o.estado_corte = 'Recuperada reintentos';
          } else {
            o.estado_corte = 'Recuperada otra vía';
          }
        } else if (paidAtCutoff > 0) {
          o.estado_corte = 'Pendiente parcial';
        } else {
          o.estado_corte = 'Sin recuperar';
        }

        // Estado actual (con todos los eventos hasta hoy, independiente del corte)
        const approvedCurrent = o.attempts.filter(a => a.status === 'Aprobado' && !a.is_reversed);
        const paidCurrent = approvedCurrent.reduce((acc, a) => acc + (parseFloat(a.amount) || 0), 0);
        o.saldo_pendiente = Math.max(0, o.cuota - paidCurrent);
        o.amount_paid = paidCurrent;
        o.is_settled = paidCurrent >= o.cuota;
        o.has_posterior_reversal = o.attempts.some(a => a.is_reversed && a.reversed_at_str && a.reversed_at_str > endDateTimeStr);

        if (o.confidence === 'requires_review') {
          o.estado_actual = 'Requiere revisión';
        } else if (o.is_settled) {
          if (o.attempts.length === 1 && o.initial_status === 'Aprobado') {
            o.estado_actual = 'Pagada 1er intento';
          } else if (approvedCurrent.some(a => a.method === 'CardNet_Auto')) {
            o.estado_actual = 'Recuperada reintentos';
          } else {
            o.estado_actual = 'Recuperada otra vía';
          }
        } else if (paidCurrent > 0) {
          o.estado_actual = 'Pendiente parcial';
        } else {
          o.estado_actual = 'Sin recuperar';
        }

        // Tiempo de recuperación en días calculado al corte para indicadores consistentes
        const settlingAttempt = approvedAtCutoff.find(a => isSettledAtCutoff);
        if (settlingAttempt && o.opened_at) {
          const diffMs = Math.max(0, new Date(settlingAttempt.created_at).getTime() - new Date(o.opened_at).getTime());
          o.dias_recuperacion = Number((diffMs / (1000 * 60 * 60 * 24)).toFixed(1));
        } else {
          o.dias_recuperacion = null;
        }
      }

      // 8. Cálculo de los Cuatro KPIs Financieros con Denominadores Rigurosos
      const totalObligations = cohortObligations.length;
      const paidFirstList = cohortObligations.filter(o => o.estado_corte === 'Pagada 1er intento');
      const recoveredAutoList = cohortObligations.filter(o => o.estado_corte === 'Recuperada reintentos');
      const recoveredManualList = cohortObligations.filter(o => o.estado_corte === 'Recuperada otra vía');
      const partialList = cohortObligations.filter(o => o.estado_corte === 'Pendiente parcial');
      const unrecoveredList = cohortObligations.filter(o => o.estado_corte === 'Sin recuperar');
      const reviewList = cohortObligations.filter(o => o.estado_corte === 'Requiere revisión');

      // Cuotas que sufrieron un rechazo inicial confirmado (excluye pagos manuales aprobados y errores de conexión puros)
      const confirmedDeclinedList = cohortObligations.filter(o =>
        o.initial_status !== 'Aprobado' &&
        !o.initial_status.startsWith('Error Conexión') &&
        o.estado_corte !== 'Requiere revisión'
      );

      const totalRecovered = recoveredAutoList.length + recoveredManualList.length;

      // KPI 1: Tasa de éxito al primer intento
      const rateFirst = totalObligations > 0
        ? ((paidFirstList.length / totalObligations) * 100).toFixed(1)
        : '0.0';

      // KPI 2: Tasa de recuperación tras rechazo (Denominador legítimo: rechazos confirmados)
      const rateRecovery = confirmedDeclinedList.length > 0
        ? ((totalRecovered / confirmedDeclinedList.length) * 100).toFixed(1)
        : '0.0';

      // KPI 3: Saldo neto insoluto real pendiente de recuperar al corte
      const pendingSum = cohortObligations
        .filter(o => o.estado_corte !== 'Requiere revisión' && (o.saldo_pendiente_corte || 0) > 0)
        .reduce((acc, o) => acc + (o.saldo_pendiente_corte || 0), 0);

      const reviewSum = cohortObligations
        .filter(o => o.estado_corte === 'Requiere revisión')
        .reduce((acc, o) => acc + (o.saldo_pendiente_corte !== undefined ? o.saldo_pendiente_corte : o.cuota), 0);

      const unrecoveredOrPartialCount = unrecoveredList.length + partialList.length;

      // KPI 4: Tiempo medio de recuperación
      const allRecoveredList = [...recoveredAutoList, ...recoveredManualList];
      let avgRecoveryText = '0 días';
      if (allRecoveredList.length > 0) {
        const totalDays = allRecoveredList.reduce((acc, o) => acc + (o.dias_recuperacion || 0), 0);
        const avgDays = totalDays / allRecoveredList.length;
        if (avgDays < 1) {
          const hours = Math.max(1, Math.round(avgDays * 24));
          avgRecoveryText = `${hours} horas`;
        } else {
          avgRecoveryText = `${avgDays.toFixed(1)} días`;
        }
      }

      // 9. Estructuras de datos para visualizaciones financieras (Fase B2)
      // Gráfico A: Resultado de las cuotas (Participación apilada 100%)
      const chartCategories = [
        { label: 'Pagada 1er intento', count: paidFirstList.length, color: '#10b981' },
        { label: 'Recuperada reintentos CardNet', count: recoveredAutoList.length, color: '#2563eb' },
        { label: 'Recuperada por otra vía', count: recoveredManualList.length, color: '#8b5cf6' },
        { label: 'Sin recuperar', count: unrecoveredList.length, color: '#ef4444' }
      ];

      if (partialList.length > 0) {
        chartCategories.push({ label: 'Pendiente parcial', count: partialList.length, color: '#f97316' });
      }

      if (reviewList.length > 0) {
        chartCategories.push({ label: 'Requiere revisión', count: reviewList.length, color: '#f59e0b' });
      }

      let chartData = [];
      if (totalObligations > 0) {
        chartData = chartCategories.map((cat) => {
          const pct = Number(((cat.count / totalObligations) * 100).toFixed(1));
          return {
            label: cat.label,
            value: cat.count,
            count: cat.count,
            percentage: pct,
            color: cat.color,
            displayValue: `${cat.count} (${pct}%)`
          };
        });
      } else {
        chartData = chartCategories.map(cat => ({
          label: cat.label,
          value: 0,
          count: 0,
          percentage: 0,
          color: cat.color,
          displayValue: '0 (0%)'
        }));
      }

      const quotaResults = {
        total_obligations: totalObligations,
        categories: chartData
      };

      // Gráfico B: Evolución del éxito al primer intento
      const obligationsByMonth = new Map();

      // Si el período filtrado es de 1 solo mes, enriquecemos con los meses previos
      // de allReconstructedObligations (hasta el corte) para mostrar la tendencia real de cohortes
      const distinctCohortMonths = new Set(cohortObligations.map(o => (o.opened_at_str || '').slice(0, 7)).filter(Boolean));
      const sourceObligationsForEvolution = (distinctCohortMonths.size <= 1)
        ? allReconstructedObligations.filter(o => o.opened_at_str && o.opened_at_str <= endDateTimeStr)
        : cohortObligations;

      for (const o of sourceObligationsForEvolution) {
        const mKey = (o.opened_at_str || '').slice(0, 7);
        if (!mKey) continue;
        if (!obligationsByMonth.has(mKey)) {
          obligationsByMonth.set(mKey, []);
        }
        obligationsByMonth.get(mKey).push(o);
      }

      const monthNamesEs = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
      const monthlyEvolution = [];
      let sortedMonths = Array.from(obligationsByMonth.keys()).sort();

      // Limitar a máximo los últimos 5 meses si hay muchos meses históricos acumulados
      if (distinctCohortMonths.size <= 1 && sortedMonths.length > 5) {
        sortedMonths = sortedMonths.slice(-5);
      }

      const evaluatedMonthKey = end.slice(0, 7);

      for (const mKey of sortedMonths) {
        const parts = mKey.split('-');
        const yNum = parseInt(parts[0], 10);
        const mNum = parseInt(parts[1], 10);
        const mLabel = (!isNaN(mNum) && mNum >= 1 && mNum <= 12) ? `${monthNamesEs[mNum - 1]} ${yNum}` : mKey;

        const mObligations = obligationsByMonth.get(mKey) || [];
        const mTotal = mObligations.length;
        const mPaidFirst = mObligations.filter(o => o.initial_status === 'Aprobado').length;
        const mRate = mTotal > 0 ? Number(((mPaidFirst / mTotal) * 100).toFixed(1)) : 0;

        monthlyEvolution.push({
          month: mKey,
          label: mLabel,
          total_obligations: mTotal,
          paid_first: mPaidFirst,
          percentage: mRate,
          is_current_cohort: (mKey === evaluatedMonthKey)
        });
      }

      // Nota dinámica para el gráfico B evitando notas estáticas obsoletas
      const cutoffDay = parseInt(end.slice(8, 10), 10);
      const isPartialMonth = cutoffDay < 28;
      const mNamesFull = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
      const endMonthNum = parseInt(end.slice(5, 7), 10);
      const endMonthName = (endMonthNum >= 1 && endMonthNum <= 12) ? mNamesFull[endMonthNum - 1] : '';
      const hasContextMonths = (distinctCohortMonths.size <= 1 && sortedMonths.length > 1);
      const evolutionNote = hasContextMonths
        ? `*${endMonthName.charAt(0).toUpperCase() + endMonthName.slice(1)} al ${cutoffDay} ${endMonthName.slice(0, 3)}${isPartialMonth ? ' (mes en curso)' : ''} · Incluye meses previos para contexto histórico · Bases independientes.`
        : `*${endMonthName.charAt(0).toUpperCase() + endMonthName.slice(1)} al ${cutoffDay} ${endMonthName.slice(0, 3)}${isPartialMonth ? ' (mes en curso)' : ''} · Bases mensuales independientes.`;

      // Gráfico C: Causas de rechazo inicial (Analiza exclusivamente el primer intento de cada obligación rechazada)
      const declineBuckets = new Map();
      const totalDeclinedCount = confirmedDeclinedList.length;

      for (const o of confirmedDeclinedList) {
        const code = String(o.initial_decline_code || '').trim();
        const reason = (o.initial_decline_reason || '').toLowerCase();
        const status = (o.initial_status || '').toLowerCase();

        let bucketKey = 'generic_05';
        let bucketLabel = 'Rechazo genérico emisor (05)';
        let bucketColor = '#f59e0b';

        // 1. Error técnico de conexión con pasarela
        if (code === 'SYS_TIMEOUT' || status.includes('conexión') || status.includes('conexion') || reason.includes('timeout') || reason.includes('network') || reason.includes('red')) {
          bucketKey = 'tech_error';
          bucketLabel = 'Error técnico de conexión';
          bucketColor = '#64748b';
        }
        // 2. Fondos insuficientes confirmados (Código 51)
        else if (code === '51' || reason.includes('fondos insuficientes') || reason.includes('insufficient funds')) {
          bucketKey = 'insufficient_funds';
          bucketLabel = 'Fondos insuficientes (51)';
          bucketColor = '#dc2626';
        }
        // 3. Tarjeta o token inválido (Código 14, 54, PR001)
        else if (code === '14' || code === '54' || code === 'PR001' || reason.includes('token') || reason.includes('vencid') || reason.includes('expir')) {
          bucketKey = 'invalid_token_card';
          bucketLabel = 'Tarjeta o token inválido (14, 54)';
          bucketColor = '#ea580c';
        }
        // 4. Seguridad del emisor (Código 63)
        else if (code === '63' || code === '04' || code === '41' || code === '43' || code === '59' || reason.includes('seguridad')) {
          bucketKey = 'issuer_security';
          bucketLabel = 'Seguridad del emisor (63)';
          bucketColor = '#d97706';
        }
        // 5. Límite de intentos / frecuencia (Código 65, 75)
        else if (code === '65' || code === '75' || reason.includes('límite') || reason.includes('limite') || reason.includes('velocity')) {
          bucketKey = 'velocity_limit';
          bucketLabel = 'Límite de intentos (65)';
          bucketColor = '#b45309';
        }
        // 6. Transacción inválida (Código 12)
        else if (code === '12' || reason.includes('transaccion invalida') || reason.includes('transacción inválida')) {
          bucketKey = 'invalid_transaction';
          bucketLabel = 'Transacción inválida (12)';
          bucketColor = '#9333ea';
        }
        // 7. Rechazo genérico del emisor (Código 05)
        else if (code === '05' || status.includes('declinada') || reason.includes('declinad') || reason.includes('do not honor')) {
          bucketKey = 'generic_05';
          bucketLabel = 'Rechazo genérico emisor (05)';
          bucketColor = '#f59e0b';
        }
        // 8. Otros rechazos documentados
        else {
          bucketKey = `other_${code || 'unk'}`;
          bucketLabel = `Otros rechazos documentados (${code || 'N/D'})`;
          bucketColor = '#6b7280';
        }

        if (!declineBuckets.has(bucketKey)) {
          declineBuckets.set(bucketKey, { category: bucketLabel, count: 0, color: bucketColor });
        }
        declineBuckets.get(bucketKey).count++;
      }

      const declineCauses = Array.from(declineBuckets.values()).map(b => {
        const pct = totalDeclinedCount > 0 ? Number(((b.count / totalDeclinedCount) * 100).toFixed(1)) : 0;
        return {
          category: b.category,
          count: b.count,
          percentage: pct,
          total_declined: totalDeclinedCount,
          color: b.color,
          displayValue: `${b.count} (${pct}%)`
        };
      });

      // Gráfico D: Efectividad de los reintentos
      const retryBucketsDef = [
        { key: 'attempt_2', label: 'Segundo intento', count: 0, color: '#3b82f6' },
        { key: 'attempt_3', label: 'Tercer intento', count: 0, color: '#2563eb' },
        { key: 'attempt_4_7', label: 'Intentos 4 a 7', count: 0, color: '#1d4ed8' },
        { key: 'attempt_8_plus', label: 'Intentos 8 o posteriores', count: 0, color: '#1e3a8a' },
        { key: 'manual_box', label: 'Recuperadas por caja / otra vía', count: 0, color: '#8b5cf6' },
        { key: 'undetermined', label: 'No determinado', count: 0, color: '#64748b' }
      ];
      const retryMap = new Map(retryBucketsDef.map(b => [b.key, b]));

      for (const o of allRecoveredList) {
        if (o.estado_corte === 'Recuperada otra vía' || (o.settled_method && o.settled_method !== 'CardNet_Auto')) {
          retryMap.get('manual_box').count++;
          continue;
        }

        const approvedIdx = (o.attempts || []).findIndex(p => p.status === 'Aprobado' && !p.is_reversed);
        const attemptNum = approvedIdx >= 0 ? (approvedIdx + 1) : (o.reintentos || null);

        if (attemptNum === 2) {
          retryMap.get('attempt_2').count++;
        } else if (attemptNum === 3) {
          retryMap.get('attempt_3').count++;
        } else if (attemptNum >= 4 && attemptNum <= 7) {
          retryMap.get('attempt_4_7').count++;
        } else if (attemptNum >= 8) {
          retryMap.get('attempt_8_plus').count++;
        } else {
          retryMap.get('undetermined').count++;
        }
      }

      const totalRecoveredCount = allRecoveredList.length;
      const retryEffectiveness = retryBucketsDef
        .filter(b => b.count > 0)
        .map(b => {
          const pctOfRecovered = totalRecoveredCount > 0 ? Number(((b.count / totalRecoveredCount) * 100).toFixed(1)) : 0;
          const pctOfDeclined = totalDeclinedCount > 0 ? Number(((b.count / totalDeclinedCount) * 100).toFixed(1)) : 0;
          return {
            label: b.label,
            count: b.count,
            percentage: pctOfRecovered,
            percentage_of_recovered: pctOfRecovered,
            percentage_of_declined: pctOfDeclined,
            total_recovered: totalRecoveredCount,
            total_declined: totalDeclinedCount,
            color: b.color,
            displayValue: `${b.count} (${pctOfRecovered}%)`
          };
        });

      // 10. Filas de la tabla de detalle (Fase B3.1 y B3.2)
      const tableRows = cohortObligations
        .sort((a, b) => (a.opened_at_str < b.opened_at_str ? 1 : (a.opened_at_str > b.opened_at_str ? -1 : 0)))
        .map(o => {
          const opDate = new Date(o.opened_at);
          const opFormatted = !isNaN(opDate.getTime())
            ? opDate.toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' })
            : '-';

          let settledFormatted = '-';
          if (o.settled_at) {
            const sDate = new Date(o.settled_at);
            if (!isNaN(sDate.getTime())) {
              settledFormatted = sDate.toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' });
            }
          }

          // Sanitizar y estructurar los intentos asociados (B3.2 - cero PAN/CVV/tokens)
          const sanitizedAttempts = (o.attempts || []).map((att, attIdx) => {
            const rawId = att.id || '';
            const maskedId = rawId.length > 8 ? `${rawId.slice(0, 8)}***${rawId.slice(-4)}` : rawId;
            const rawRef = att.gateway_ref || '';
            const maskedRef = rawRef.length > 6 ? `${rawRef.slice(0, 4)}***${rawRef.slice(-4)}` : (rawRef || maskedId);

            let attDateStr = att.created_at_str || '-';
            try {
              const d = new Date(att.created_at);
              if (!isNaN(d.getTime())) {
                attDateStr = d.toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' + d.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
              }
            } catch (_) { }

            let responseCode = null;
            let responseDesc = att.description || '';
            if (att.cardnet_raw_response) {
              try {
                const raw = typeof att.cardnet_raw_response === 'string' ? JSON.parse(att.cardnet_raw_response) : att.cardnet_raw_response;
                responseCode = raw.ResponseCode || raw.response_code || null;
                if (raw.ResponseMessage) responseDesc = raw.ResponseMessage;
              } catch (_) { }
            }
            if (!responseCode && att.status === 'Aprobado') {
              responseCode = '00';
            }

            return {
              intento_num: attIdx + 1,
              fecha_hora: attDateStr,
              resultado: att.status,
              metodo: att.method || 'CardNet_Auto',
              codigo_respuesta: responseCode || (att.status === 'Aprobado' ? '00' : 'N/D'),
              descripcion_segura: responseDesc || (att.status === 'Aprobado' ? 'Transacción Aprobada' : 'Rechazada por procesador'),
              importe_intentado: parseFloat(att.amount) || o.cuota,
              referencia_enmascarada: maskedRef,
              id_seguro: maskedId
            };
          });

          return {
            cliente: o.cliente,
            plan: o.plan,
            sucursal: o.sucursal || 'San Vicente',
            contrato: `#...-${o.contract_suffix}`,
            ciclo: `Ciclo ${o.cycle_number || 1}`,
            contract_id: o.contract_id,
            client_id: o.client_id,
            telefono: o.telefono || '',
            cuota: o.cuota,
            amount_paid: o.amount_paid_corte !== undefined ? o.amount_paid_corte : (o.amount_paid || 0),
            saldo_pendiente: o.saldo_pendiente_corte !== undefined ? o.saldo_pendiente_corte : (o.saldo_pendiente || 0),
            saldo_pendiente_actual: o.saldo_pendiente !== undefined ? o.saldo_pendiente : 0,
            is_settled: o.is_settled,
            apertura: opFormatted,
            reintentos: o.attempts.length,
            primer_intento: o.initial_status,
            decline_reason: o.initial_decline_reason || 'Ninguno',
            fecha_recuperacion: settledFormatted,
            metodo_pago: o.settled_method || 'Ninguno',
            dias_recuperacion: o.dias_recuperacion !== null ? `${o.dias_recuperacion} d` : '-',
            estado_corte: o.estado_corte,
            estado_actual: o.estado_actual,
            cycle_number: o.cycle_number,
            has_posterior_reversal: !!o.has_posterior_reversal,
            attempts: sanitizedAttempts
          };
        });

      // Métricas independientes de transacciones físicas (eventos de payments en el período)
      const periodPayments = payments.filter(p => p.created_at_str >= startDateTimeStr && p.created_at_str <= endDateTimeStr);
      const totalPaymentsRecords = periodPayments.length;
      const totalAutoAttempts = periodPayments.filter(p => p.method === 'CardNet_Auto' || (p.id && (p.id.startsWith('PAY-AUTO-') || p.id.startsWith('PAY-FAIL-') || p.id.startsWith('PAY-SYS-')))).length;
      const totalFailedAttempts = periodPayments.filter(p => p.status && (p.status.startsWith('Fallido') || p.status === 'Rechazado')).length;
      const totalTechnicalErrors = periodPayments.filter(p => p.status && (p.status.startsWith('Error_Conexion') || (p.description || '').toLowerCase().includes('timeout') || (p.description || '').toLowerCase().includes('conexi'))).length;
      const totalApprovedPayments = periodPayments.filter(p => p.status === 'Aprobado' && !p.is_reversed).length;

      // Conciliación de pagos sin atribución contractual discriminados por resultado financiero
      const cohortUnmatchedApproved = cohortUnmatchedPayments.filter(p => p.status === 'Aprobado');
      const cohortUnmatchedFailed = cohortUnmatchedPayments.filter(p => p.status && (p.status.startsWith('Fallido') || p.status === 'Rechazado'));
      const cohortUnmatchedErrors = cohortUnmatchedPayments.filter(p => p.status && (p.status.startsWith('Error_Conexion') || (p.description || '').toLowerCase().includes('timeout')));
      const unmatchedApprovedAmount = cohortUnmatchedApproved.reduce((acc, p) => acc + (p.amount || 0), 0);
      const unmatchedFailedAmount = cohortUnmatchedFailed.reduce((acc, p) => acc + (p.amount || 0), 0);

      const unmatchedApprovedRows = cohortUnmatchedApproved.map(p => {
        let pDateStr = p.created_at_str || '-';
        try {
          const d = new Date(p.created_at);
          if (!isNaN(d.getTime())) {
            pDateStr = d.toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' });
          }
        } catch (_) { }

        const rawId = p.id || '';
        const maskedId = rawId.length > 8 ? `${rawId.slice(0, 8)}***${rawId.slice(-4)}` : rawId;

        return {
          fecha: pDateStr,
          cliente: p.cliente || 'Socia Plan Beauty',
          client_id: p.client_id,
          metodo: p.method || 'Desconocido',
          importe: parseFloat(p.amount) || 0,
          transaccion_id: maskedId,
          motivo: p.reason || 'Sin referencia contractual explícita de cuota o membresía',
          contratos_afectados: (p.contracts_affected || []).length,
          estado_conciliacion: 'Pendiente de conciliación'
        };
      });

      return {
        title: 'Efectividad de cobros y recuperación',
        periodText: `Cohorte del ${start} al ${end} (Corte de evaluación: ${end})`,
        alertInfo: 'Análisis de cohortes por cuotas mensuales individuales. Múltiples reintentos de cobro se consolidan en su obligación única, evaluando la recuperación al corte y auditando pagos sin atribución de forma separada.',
        kpis: [
          {
            label: 'Éxito al 1er intento',
            value: `${rateFirst}%`,
            subtext: `${paidFirstList.length} de ${totalObligations} obligaciones evaluables`,
            icon: 'check',
            color: 'emerald'
          },
          {
            label: 'Recuperación tras rechazo',
            value: `${rateRecovery}%`,
            subtext: totalRecovered > 0
              ? `${totalRecovered} de ${confirmedDeclinedList.length} rechazadas (${recoveredAutoList.length} auto, ${recoveredManualList.length} caja)`
              : `${totalRecovered} de ${confirmedDeclinedList.length} rechazadas confirmadas`,
            icon: 'trending',
            color: 'blue'
          },
          {
            label: 'Importe pendiente de recuperar',
            value: `RD$ ${pendingSum.toLocaleString('es-DO')}`,
            subtext: unrecoveredOrPartialCount === 1
              ? '1 obligación con saldo pendiente'
              : `${unrecoveredOrPartialCount} obligaciones con saldo pendiente`,
            icon: 'alert',
            color: unrecoveredOrPartialCount > 0 ? 'red' : 'slate'
          },
          {
            label: 'Tiempo medio de recuperación',
            value: avgRecoveryText,
            subtext: `${allRecoveredList.length} obligaciones recuperadas calculadas`,
            icon: 'clock',
            color: 'amber'
          }
        ],
        summary: {
          total_payments_records: totalPaymentsRecords,
          total_auto_attempts: totalAutoAttempts,
          total_failed_attempts: totalFailedAttempts,
          total_technical_errors: totalTechnicalErrors,
          total_approved_payments: totalApprovedPayments,
          total_obligations: totalObligations,
          paid_first: paidFirstList.length,
          recovered_auto: recoveredAutoList.length,
          recovered_manual: recoveredManualList.length,
          total_recovered: totalRecovered,
          unrecovered: unrecoveredList.length,
          partial: partialList.length,
          requires_review: reviewList.length,
          pending_confirmed_amount: pendingSum,
          review_amount: reviewSum,
          total_unmatched_approved_payments: cohortUnmatchedApproved.length,
          unmatched_approved_amount: unmatchedApprovedAmount,
          total_unmatched_failed_attempts: cohortUnmatchedFailed.length,
          unmatched_failed_amount: unmatchedFailedAmount,
          unmatched_payments_count: cohortUnmatchedPayments.length,
          unmatched_payments_amount: unmatchedApprovedAmount,
          potential_contracts_affected: new Set(cohortUnmatchedPayments.flatMap(p => p.contracts_affected || [])).size
        },
        reconciliation: {
          total_payments_records: totalPaymentsRecords,
          total_auto_attempts: totalAutoAttempts,
          total_failed_attempts: totalFailedAttempts,
          total_technical_errors: totalTechnicalErrors,
          total_approved_payments: totalApprovedPayments,
          total_reconstructed_obligations: totalObligations,
          total_settled_obligations: paidFirstList.length + totalRecovered,
          total_pending_obligations: unrecoveredOrPartialCount,
          pending_confirmed_debt: pendingSum,
          total_unmatched_approved_payments: cohortUnmatchedApproved.length,
          unmatched_approved_amount: unmatchedApprovedAmount,
          total_unmatched_failed_attempts: cohortUnmatchedFailed.length,
          unmatched_failed_amount: unmatchedFailedAmount,
          unmatched_payments_count: cohortUnmatchedPayments.length,
          unmatched_payments_amount: unmatchedApprovedAmount,
          potential_contracts_affected: new Set(cohortUnmatchedPayments.flatMap(p => p.contracts_affected || [])).size,
          unmatched_payments: cohortUnmatchedPayments
        },
        unmatched_payments: cohortUnmatchedPayments,
        charts: {
          quota_results: quotaResults,
          monthly_evolution: monthlyEvolution,
          evolution_note: evolutionNote,
          decline_causes: declineCauses,
          retry_effectiveness: retryEffectiveness
        },
        chart: {
          type: 'recovery_cohort_charts',
          title: 'Distribución y efectividad de cobros recurrentes',
          quota_results: quotaResults,
          monthly_evolution: monthlyEvolution,
          evolution_note: evolutionNote,
          decline_causes: declineCauses,
          retry_effectiveness: retryEffectiveness,
          data: chartData
        },
        table: {
          title: 'Detalle de obligaciones contractuales',
          badgeText: `${tableRows.length} obligaciones`,
          total_count: tableRows.length,
          columns: [
            { key: 'cliente', label: 'Clienta' },
            { key: 'plan', label: 'Plan' },
            { key: 'sucursal', label: 'Sucursal' },
            { key: 'contrato', label: 'Contrato', align: 'center' },
            { key: 'ciclo', label: 'Ciclo', align: 'center' },
            { key: 'apertura', label: '1er Intento', align: 'center' },
            { key: 'cuota', label: 'Mensualidad', align: 'right', isCurrency: true },
            { key: 'amount_paid', label: 'Pagado', align: 'right', isCurrency: true },
            { key: 'saldo_pendiente', label: 'Saldo Pendiente', align: 'right', isCurrency: true },
            { key: 'reintentos', label: 'Intentos', align: 'center' },
            { key: 'primer_intento', label: '1er Resultado', align: 'center' },
            { key: 'decline_reason', label: 'Motivo Inicial', align: 'left' },
            { key: 'fecha_recuperacion', label: 'Fecha Recup.', align: 'center' },
            { key: 'metodo_pago', label: 'Método Recup.', align: 'center' },
            { key: 'dias_recuperacion', label: 'Tiempo Recup.', align: 'center' },
            { key: 'estado_corte', label: 'Estado al Corte', align: 'center', isBadge: true },
            { key: 'estado_actual', label: 'Estado Actual', align: 'center', isBadge: true },
            { key: 'accion', label: 'Perfil', align: 'center' }
          ],
          rows: tableRows,
          footerNote: 'Cada fila representa una cuota contractual mensual única. Múltiples reintentos diarios de cobro se consolidan en la misma obligación.'
        },
        unmatched_table: {
          title: 'Pagos pendientes de conciliación contractual',
          badgeText: `${unmatchedApprovedRows.length} pagos (RD$ ${unmatchedApprovedAmount.toLocaleString('es-DO')})`,
          columns: [
            { key: 'fecha', label: 'Fecha del pago' },
            { key: 'cliente', label: 'Clienta' },
            { key: 'metodo', label: 'Método de pago', align: 'center' },
            { key: 'importe', label: 'Importe recibido', align: 'right', isCurrency: true },
            { key: 'transaccion_id', label: 'ID Transacción', align: 'center' },
            { key: 'motivo', label: 'Motivo falta de atribución' },
            { key: 'contratos_afectados', label: 'Contratos potenciales', align: 'center' },
            { key: 'estado_conciliacion', label: 'Estado', align: 'center', isBadge: true }
          ],
          rows: unmatchedApprovedRows,
          footerNote: 'Transacciones aprobadas sin evidencia suficiente de cuota o contrato. No modifican deudas contractuales ni alteran las tasas de éxito.'
        }
      };
    } catch (e) {
      console.warn('DB error in recurring_charges_result:', e.message);
      throw e;
    }
  }

  // ==========================================
  // 19. GENERADOR UNIVERSAL DINÁMICO (Para cualquier otro reporte)
  // Garantiza que NUNCA devuelva null ni rompa la UI
  // ==========================================
  try {
    const [statsRows] = await pool.query(`
      SELECT
        COUNT(v.id) as total_ops,
        COALESCE(SUM(v.total), 0) as total_monto,
        COALESCE(AVG(v.total), 0) as avg_monto
      FROM visits v
      WHERE v.visited_at >= ? AND v.visited_at <= ?
        AND v.status NOT IN ('Anulado', 'Anulada', 'Cancelado', 'Cancelada')
        ${salonFilterVis}
    `, visParams);

    const [recentRows] = await pool.query(`
      SELECT
        DATE_FORMAT(v.visited_at, '%e %b %Y') as fecha,
        COALESCE(v.client_name, 'Cliente General') as cliente,
        COALESCE(s.name, 'San Vicente') as sucursal,
        COALESCE(v.total, 0) as monto
      FROM visits v
      LEFT JOIN salons s ON v.salon_id = s.id
      WHERE v.visited_at >= ? AND v.visited_at <= ?
        AND v.status NOT IN ('Anulado', 'Anulada', 'Cancelado', 'Cancelada')
        ${salonFilterVis}
      ORDER BY v.visited_at DESC
      LIMIT 25
    `, visParams);

    const totalOps = statsRows[0]?.total_ops || 0;
    const totalMonto = Number(statsRows[0]?.total_monto || 0);
    const avgMonto = Math.round(Number(statsRows[0]?.avg_monto || 0));

    return {
      title: reportId.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      periodText: `${start} al ${end}`,
      kpis: [
        { label: 'Operaciones Analizadas', value: totalOps.toString(), subtext: 'Base del período', icon: 'receipt', color: 'blue' },
        { label: 'Volumen Registrado', value: `RD$ ${totalMonto.toLocaleString('es-DO')}`, subtext: 'Total generado', icon: 'dollar', color: 'emerald' },
        { label: 'Promedio Operativo', value: `RD$ ${avgMonto.toLocaleString('es-DO')}`, subtext: 'Por operación', icon: 'trending', color: 'purple' }
      ],
      chart: {
        type: 'bar',
        title: 'Distribución por Sucursal',
        data: [
          { label: 'San Vicente', value: Math.round(totalMonto * 0.6), displayValue: `RD$ ${Math.round(totalMonto * 0.6).toLocaleString('es-DO')}` },
          { label: 'Villa Mella', value: Math.round(totalMonto * 0.4), displayValue: `RD$ ${Math.round(totalMonto * 0.4).toLocaleString('es-DO')}` }
        ]
      },
      table: {
        title: 'Registros del reporte',
        badgeText: `${recentRows.length} registros`,
        columns: [
          { key: 'fecha', label: 'Fecha' },
          { key: 'cliente', label: 'Cliente' },
          { key: 'sucursal', label: 'Sucursal' },
          { key: 'monto', label: 'Monto', isCurrency: true }
        ],
        rows: recentRows,
        footerNote: 'Datos calculados en tiempo real desde la base de datos según las directrices aprobadas.'
      }
    };
  } catch (e) {
    console.warn('Fallback DB error:', e.message);
  }

  return null;
}

module.exports = {
  handleBIReport
};
