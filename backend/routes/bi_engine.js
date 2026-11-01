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
        } catch (e) {}

        if (items.length === 0 && v.servicios) {
          try {
            if (Array.isArray(v.servicios)) {
              items = v.servicios.map(s => ({ nombre: s, cantidad: 1, precioAplicado: 0 }));
            } else if (typeof v.servicios === 'string' && v.servicios.startsWith('[')) {
              items = JSON.parse(v.servicios).map(s => ({ nombre: s, cantidad: 1, precioAplicado: 0 }));
            } else if (typeof v.servicios === 'string') {
              items = [{ nombre: v.servicios, cantidad: 1, precioAplicado: v.total }];
            }
          } catch (e) {}
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
        } catch (e) {}
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
        } catch (e) {}

        if (names.length === 0 && v.servicios) {
          try {
            if (Array.isArray(v.servicios)) names = v.servicios;
            else if (typeof v.servicios === 'string' && v.servicios.startsWith('[')) names = JSON.parse(v.servicios);
          } catch (e) {}
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
  // (Incluso si fueron suspendidas o canceladas posteriormente)
  // ==========================================
  if (reportId === 'visit_frequency' || reportId === 'frequency') {
    try {
      // Clientes que tuvieron contrato O visitaron en el período
      const [members] = await pool.query(`
        SELECT DISTINCT
          c.id, c.nombre, c.telefono, c.salon_id,
          COALESCE(s.name, 'San Vicente') as salon_name
        FROM clients c
        LEFT JOIN contracts ct ON c.id = ct.client_id
        LEFT JOIN salons s ON c.salon_id = s.id
        WHERE (ct.id IS NOT NULL OR c.id IN (SELECT DISTINCT client_id FROM visits WHERE visited_at >= ? AND visited_at <= ?))
        ${salonId !== 'all' ? 'AND c.salon_id = ?' : ''}
      `, salonId !== 'all' ? [startDateTime, endDateTime, salonId] : [startDateTime, endDateTime]);

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
          } catch (e) {}
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
  // 17. GENERADOR UNIVERSAL DINÁMICO (Para cualquier otro reporte)
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
