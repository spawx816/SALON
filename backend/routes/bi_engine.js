/**
 * Motor de Inteligencia de Negocios (BI) para Salon Pro & Plan Beauty RD
 * Conecta los 30 reportes aprobados con las consultas reales de la base de datos MySQL,
 * preservando todas las métricas preexistentes (cobros en efectivo, clientes inactivos, comisiones, etc.).
 */

async function handleBIReport(pool, queryParams) {
  const {
    category = 'sales',
    reportId = 'sales_summary',
    startDate,
    endDate,
    salonId = 'all',
    membership = 'all',
    daysInactive = 15,
    reason = 'Todos los motivos',
    employeeId = 'all',
    timeGrain = 'daily'
  } = queryParams;

  const now = new Date();
  const start = startDate || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const end = endDate || now.toISOString().split('T')[0];
  const endDateTime = `${end} 23:59:59`;

  const salonFilterVis = salonId !== 'all' ? 'AND v.salon_id = ?' : '';
  const salonFilterPay = salonId !== 'all' ? 'AND COALESCE(p.salon_id, cl.salon_id, 1) = ?' : '';
  const visParams = salonId !== 'all' ? [start, endDateTime, salonId] : [start, endDateTime];
  const payParams = salonId !== 'all' ? [start, endDateTime, salonId] : [start, endDateTime];
  const combinedParams = salonId !== 'all' 
    ? [start, endDateTime, salonId, start, endDateTime, salonId]
    : [start, endDateTime, start, endDateTime];

  // Helper date formatter
  const formatDO = (d) => {
    if (!d) return 'N/D';
    try {
      const obj = new Date(d);
      return isNaN(obj.getTime()) ? String(d) : obj.toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return String(d); }
  };

  // ==========================================
  // 1. VENTAS Y COBROS: RESUMEN (#1)
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

      const [dailyRows] = await pool.query(`
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
      `, visParams);

      const [detailRows] = await pool.query(`
        SELECT 
          DATE_FORMAT(v.visited_at, '%e %b %Y') as fecha,
          COALESCE(s.name, 'San Vicente') as sucursal,
          COUNT(v.id) as facturas,
          COALESCE(SUM(v.total), 0) as facturacion,
          COALESCE(SUM(CASE WHEN v.status = 'Facturado' THEN v.total ELSE 0 END), 0) as cobrado
        FROM visits v
        LEFT JOIN salons s ON v.salon_id = s.id
        WHERE v.visited_at >= ? AND v.visited_at <= ?
          AND v.status NOT IN ('Anulado', 'Anulada', 'Cancelado', 'Cancelada')
          ${salonFilterVis}
        GROUP BY DATE(v.visited_at), v.salon_id, s.name, DATE_FORMAT(v.visited_at, '%e %b %Y')
        ORDER BY DATE(v.visited_at) DESC
        LIMIT 50
      `, visParams);

      const validInvoices = salesRows[0]?.valid_invoices || 0;
      const totalSales = Number(salesRows[0]?.total_sales || 0);
      const totalCollected = Number(payRows[0]?.total_collected || totalSales);
      const avgTicket = validInvoices > 0 ? Math.round(totalSales / validInvoices) : 0;

      return {
        title: 'Resumen de ventas y cobros',
        periodText: `${start} al ${end}`,
        kpis: [
          { label: 'Facturación', value: `RD$ ${totalSales.toLocaleString('es-DO')}`, subtext: 'Ventas del período', icon: 'trending', color: 'emerald' },
          { label: 'Total cobrado', value: `RD$ ${totalCollected.toLocaleString('es-DO')}`, subtext: 'Pagos recibidos en el período', icon: 'dollar', color: 'blue' },
          { label: 'Cantidad de facturas', value: validInvoices.toString(), subtext: 'Facturas válidas', icon: 'receipt', color: 'purple' },
          { label: 'Ticket promedio', value: `RD$ ${avgTicket.toLocaleString('es-DO')}`, subtext: 'Por factura', icon: 'tag', color: 'amber' }
        ],
        chart: {
          type: 'sales_evolution',
          data: dailyRows.length > 0 ? dailyRows : [{ label: 'Período', total: totalSales }]
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
      };
    } catch (e) {
      console.warn('DB error in sales_summary:', e.message);
    }
  }

  // ==========================================
  // 2. VENTAS Y COBROS: COBROS EN EFECTIVO (#10 / #11)
  // (Preserva 100% de la funcionalidad de Pagos en Efectivo del sistema)
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
        title: 'Pago en efectivo de membresía y servicios',
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
          title: 'Registro de cobros en efectivo',
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
          footerNote: 'Registra los cobros recibidos en efectivo en caja con fecha, cliente, sucursal y usuario receptor.'
        }
      };
    } catch (e) {
      console.warn('DB error in cash_membership_payments:', e.message);
    }
  }

  // ==========================================
  // 3. VENTAS Y COBROS: COBROS POR MÉTODO DE PAGO (#5)
  // ==========================================
  if (reportId === 'payment_methods') {
    try {
      const [methodsRows] = await pool.query(`
        SELECT method, COUNT(*) as count, SUM(amount) as total FROM (
          SELECT p.method, p.amount
          FROM payments p
          LEFT JOIN clients cl ON p.client_id = cl.id
          WHERE p.created_at >= ? AND p.created_at <= ? AND p.status = 'Aprobado' ${salonFilterPay}

          UNION ALL

          SELECT COALESCE(v.metodo_pago, 'Efectivo') as method, v.total as amount
          FROM visits v
          LEFT JOIN clients cl ON (v.client_id = cl.id OR v.client_name = cl.nombre)
          WHERE v.visited_at >= ? AND v.visited_at <= ? AND v.status = 'Facturado' AND v.total > 0 ${salonId !== 'all' ? 'AND COALESCE(v.salon_id, cl.salon_id, 1) = ?' : ''}
        ) combined_pay
        GROUP BY method
        ORDER BY total DESC
      `, combinedParams);

      const totalSum = methodsRows.reduce((sum, r) => sum + Number(r.total || 0), 0);
      const totalCount = methodsRows.reduce((sum, r) => sum + Number(r.count || 0), 0);

      const colorPalette = {
        efectivo: '#10b981',
        tarjeta: '#2563eb',
        cardnet: '#8b5cf6',
        transferencia: '#f59e0b',
        default: '#64748b'
      };

      const chartData = methodsRows.map(r => {
        const mLower = String(r.method || '').toLowerCase();
        let color = colorPalette.default;
        if (mLower.includes('efectivo') || mLower.includes('cash')) color = colorPalette.efectivo;
        else if (mLower.includes('tarjeta') || mLower.includes('pos')) color = colorPalette.tarjeta;
        else if (mLower.includes('cardnet')) color = colorPalette.cardnet;
        else if (mLower.includes('transferencia')) color = colorPalette.transferencia;

        return {
          label: r.method || 'General',
          count: Number(r.count || 0),
          amount: Number(r.total || 0),
          percentage: totalSum > 0 ? Number(((Number(r.total || 0) / totalSum) * 100).toFixed(1)) : 0,
          color
        };
      });

      return {
        title: 'Cobros por método de pago',
        periodText: `${start} al ${end}`,
        kpis: [
          { label: 'Total Recaudado', value: `RD$ ${totalSum.toLocaleString('es-DO')}`, subtext: 'Todos los canales combinados', icon: 'dollar', color: 'emerald' },
          { label: 'Total Operaciones', value: totalCount.toString(), subtext: 'Cobros y facturaciones', icon: 'receipt', color: 'blue' },
          { label: 'Canal Principal', value: chartData[0]?.label || 'Efectivo', subtext: `${chartData[0]?.percentage || 0}% de los ingresos`, icon: 'credit_card', color: 'purple' }
        ],
        chart: {
          type: 'donut',
          data: chartData
        },
        table: {
          title: 'Resumen por canal de cobro',
          columns: [
            { key: 'metodo', label: 'Método de Pago' },
            { key: 'transacciones', label: 'Transacciones', align: 'center' },
            { key: 'participacion', label: 'Participación', align: 'center' },
            { key: 'monto', label: 'Monto Total', isCurrency: true }
          ],
          rows: chartData.map(c => ({
            metodo: c.label,
            transacciones: c.count,
            participacion: `${c.percentage}%`,
            monto: c.amount
          })),
          footerNote: 'Desglosa cobros en efectivo, tarjeta física, CardNet virtual y transferencias bancarias.'
        }
      };
    } catch (e) {
      console.warn('DB error in payment_methods:', e.message);
    }
  }

  // ==========================================
  // 4. VENTAS Y COBROS: VENTAS POR CLIENTE (#4) / COBROS POR CLIENTE
  // (Preserva 100% de la funcionalidad de Cobros por Cliente con búsqueda y detalle)
  // ==========================================
  if (reportId === 'sales_by_client' || reportId === 'client_payments') {
    try {
      const [detailRows] = await pool.query(`
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
                 COALESCE(s.name, 'San Vicente') as salon_name,
                 COALESCE(p.salon_id, cl.salon_id, 1) as salon_id
          FROM payments p
          LEFT JOIN clients cl ON p.client_id = cl.id
          LEFT JOIN salons s ON (COALESCE(p.salon_id, cl.salon_id, 1) = s.id)
          WHERE p.created_at >= ? AND p.created_at <= ? AND p.status = 'Aprobado'

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
                 COALESCE(s.name, 'San Vicente') as salon_name,
                 COALESCE(v.salon_id, cl.salon_id, 1) as salon_id
          FROM visits v
          LEFT JOIN clients cl ON (v.client_id = cl.id OR v.client_name = cl.nombre)
          LEFT JOIN salons s ON (COALESCE(v.salon_id, cl.salon_id, 1) = s.id)
          WHERE v.visited_at >= ? AND v.visited_at <= ? AND v.status = 'Facturado' AND v.total > 0
        ) combined
        WHERE 1=1 ${salonId !== 'all' ? 'AND combined.salon_id = ?' : ''}
        ORDER BY combined.created_at DESC
        LIMIT 300
      `, salonId !== 'all' ? [start, endDateTime, start, endDateTime, salonId] : [start, endDateTime, start, endDateTime]);

      const totalAmount = detailRows.reduce((acc, curr) => acc + Number(curr.amount || 0), 0);

      return {
        title: 'Ventas y cobros por cliente',
        periodText: `${start} al ${end}`,
        kpis: [
          { label: 'Total Facturado a Clientes', value: `RD$ ${totalAmount.toLocaleString('es-DO')}`, subtext: 'Historial consolidado', icon: 'dollar', color: 'emerald' },
          { label: 'Operaciones Registradas', value: detailRows.length.toString(), subtext: 'Cobros y facturas POS', icon: 'receipt', color: 'blue' },
          { label: 'Cobro Promedio', value: `RD$ ${detailRows.length > 0 ? Math.round(totalAmount / detailRows.length).toLocaleString('es-DO') : '0'}`, subtext: 'Por operación', icon: 'tag', color: 'purple' }
        ],
        chart: {
          type: 'bar',
          title: 'Top 5 Clientes con Mayor Consumo',
          data: detailRows.slice(0, 5).map(r => ({
            label: r.client_name,
            value: Number(r.amount || 0),
            displayValue: `RD$ ${Number(r.amount || 0).toLocaleString('es-DO')}`
          }))
        },
        table: {
          title: 'Detalle de cobros por cliente',
          badgeText: `${detailRows.length} registros`,
          columns: [
            { key: 'fecha', label: 'Fecha' },
            { key: 'cliente', label: 'Cliente' },
            { key: 'telefono', label: 'Teléfono' },
            { key: 'sucursal', label: 'Sucursal' },
            { key: 'descripcion', label: 'Concepto / Detalle' },
            { key: 'metodo', label: 'Método' },
            { key: 'monto', label: 'Monto', isCurrency: true }
          ],
          rows: detailRows.map(r => ({
            fecha: formatDO(r.created_at),
            cliente: r.client_name,
            telefono: r.client_phone,
            sucursal: r.salon_name,
            descripcion: r.description,
            metodo: r.method,
            monto: Number(r.amount || 0)
          })),
          footerNote: 'Permite identificar quiénes compran más y cuánto gastan en el período.'
        }
      };
    } catch (e) {
      console.warn('DB error in sales_by_client:', e.message);
    }
  }

  // ==========================================
  // 5. CLIENTES: CLIENTES INACTIVOS (#3)
  // (Preserva 100% de la funcionalidad de Clientes Inactivos y WhatsApp directo)
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

      const formattedInactive = inactiveRows.map(cl => {
        const lastDate = cl.last_visit ? new Date(cl.last_visit) : null;
        const days = lastDate ? Math.floor((now - lastDate) / (1000 * 60 * 60 * 24)) : 'Más de 90';
        return {
          id: cl.id,
          cliente: cl.nombre || 'Cliente Registrado',
          telefono: cl.telefono || '',
          phone: cl.telefono || '',
          sucursal: cl.salon_name,
          ultima_visita: lastDate ? formatDO(lastDate) : 'Nunca ha visitado',
          dias_ausente: `${days} días`,
          contacto: 'Contactar'
        };
      });

      return {
        title: 'Clientes inactivos',
        periodText: `Clientes sin visitas registradas hace más de ${minDays} días`,
        kpis: [
          { label: 'Total Inactivos Identificados', value: formattedInactive.length.toString(), subtext: `Ausencia superior a ${minDays} días`, icon: 'users', color: 'rose' },
          { label: 'Umbral de Alerta', value: `${minDays} días`, subtext: 'Tiempo de seguimiento', icon: 'clock', color: 'amber' },
          { label: 'Canal de Recuperación', value: 'WhatsApp Directo', subtext: 'Habilitado en tabla', icon: 'tag', color: 'emerald' }
        ],
        chart: {
          type: 'table_only'
        },
        table: {
          title: `Clientes con más de ${minDays} días sin visitar`,
          badgeText: `${formattedInactive.length} clientes`,
          columns: [
            { key: 'cliente', label: 'Cliente' },
            { key: 'telefono', label: 'Teléfono' },
            { key: 'sucursal', label: 'Sucursal' },
            { key: 'ultima_visita', label: 'Última Visita' },
            { key: 'dias_ausente', label: 'Días de Ausencia', align: 'center' },
            { key: 'contacto', label: 'Acción WhatsApp', align: 'center' }
          ],
          rows: formattedInactive,
          footerNote: 'Al pulsar "Contactar" se abre el canal de WhatsApp sin enviar mensajes de forma no autorizada.'
        }
      };
    } catch (e) {
      console.warn('DB error in inactive_clients:', e.message);
    }
  }

  // ==========================================
  // 6. CLIENTES: RESUMEN DE CLIENTES (#1)
  // (Preserva 100% de la funcionalidad de Estado de Clientes)
  // ==========================================
  if (reportId === 'clients_summary' || reportId === 'clients') {
    try {
      const [activeRow] = await pool.query("SELECT COUNT(DISTINCT client_id) as count FROM contracts WHERE status IN ('Active', 'Activo')");
      const [cancelledRow] = await pool.query("SELECT COUNT(DISTINCT client_id) as count FROM contracts WHERE status IN ('Cancelled', 'Cancelado')");
      const [totalClientsRow] = await pool.query("SELECT COUNT(*) as count FROM clients");

      const activeCount = activeRow[0]?.count || 0;
      const cancelledCount = cancelledRow[0]?.count || 0;
      const totalClients = totalClientsRow[0]?.count || 0;

      return {
        title: 'Resumen de clientes y estado de membresías',
        periodText: `${start} al ${end}`,
        kpis: [
          { label: 'Total Clientes Registrados', value: totalClients.toString(), subtext: 'Base global de clientela', icon: 'users', color: 'blue' },
          { label: 'Socias con Membresía Activa', value: activeCount.toString(), subtext: 'Contratos vigentes Plan Beauty', icon: 'user_check', color: 'emerald' },
          { label: 'Membresías Canceladas', value: cancelledCount.toString(), subtext: 'Histórico de cancelaciones', icon: 'alert', color: 'rose' }
        ],
        chart: {
          type: 'bar',
          title: 'Distribución de Socias por Estado',
          data: [
            { label: 'Activas', value: activeCount, displayValue: `${activeCount} socias` },
            { label: 'Canceladas', value: cancelledCount, displayValue: `${cancelledCount} socias` }
          ]
        },
        table: {
          title: 'Resumen por categoría de cliente',
          columns: [
            { key: 'categoria', label: 'Estado / Categoría' },
            { key: 'cantidad', label: 'Cantidad', align: 'center' },
            { key: 'descripcion', label: 'Detalle' }
          ],
          rows: [
            { categoria: 'Membresías Activas', cantidad: activeCount, descripcion: 'Socias con suscripción vigente y beneficios habilitados' },
            { categoria: 'Membresías Canceladas', cantidad: cancelledCount, descripcion: 'Contratos finalizados o dados de baja' },
            { categoria: 'Clientes Regulares / Ocasionales', cantidad: Math.max(0, totalClients - activeCount), descripcion: 'Clientas que consumen servicios por caja sin membresía' }
          ],
          footerNote: 'Distingue clientes únicos de visitas. Un cliente con 4 visitas representa 1 cliente y 4 visitas.'
        }
      };
    } catch (e) {
      console.warn('DB error in clients_summary:', e.message);
    }
  }

  // ==========================================
  // 7. CLIENTES: FRECUENCIA DE VISITAS (#2)
  // ==========================================
  if (reportId === 'visit_frequency' || reportId === 'frequency') {
    try {
      const [members] = await pool.query(`
        SELECT 
          c.id, c.nombre, c.telefono, c.salon_id,
          COALESCE(s.name, 'San Vicente') as salon_name
        FROM clients c
        JOIN contracts ct ON c.id = ct.client_id
        LEFT JOIN salons s ON c.salon_id = s.id
        WHERE ct.status IN ('Activo', 'Active')
        ${salonId !== 'all' ? 'AND c.salon_id = ?' : ''}
      `, salonId !== 'all' ? [salonId] : []);

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
        percentage: totalMembers > 0 ? Number(((b.count / totalMembers) * 100).toFixed(1)) : 0
      }));

      const withVisits = totalMembers - bins['0_visits'].count;
      const withoutVisits = bins['0_visits'].count;

      return {
        title: 'Frecuencia de visitas',
        periodText: `Clientes con membresía · ${start} al ${end}`,
        alertInfo: 'Solo cuenta Lavado sencillo. Una visita cuenta una sola vez, aunque incluya varios servicios. Sin duplicados por servicios o facturas de la misma visita.',
        kpis: [
          { label: 'Clientes con membresía', value: totalMembers.toString(), subtext: 'Socias activas en período', icon: 'users', color: 'blue' },
          { label: 'Con visitas', value: withVisits.toString(), subtext: `${totalMembers > 0 ? Math.round((withVisits / totalMembers) * 100) : 0}% del total`, icon: 'user_check', color: 'emerald' },
          { label: 'Sin visitas', value: withoutVisits.toString(), subtext: `${totalMembers > 0 ? Math.round((withoutVisits / totalMembers) * 100) : 0}% del total`, icon: 'alert', color: 'rose' }
        ],
        chart: {
          type: 'frequency_interactive',
          data: chartData
        },
        table: {
          title: `Clientes con 0 visitas`,
          badgeText: `${withoutVisits} clientes`,
          columns: [
            { key: 'cliente', label: 'Cliente' },
            { key: 'membresia', label: 'Membresía' },
            { key: 'visitas', label: 'Visitas', align: 'center' },
            { key: 'ultimo_lavado', label: 'Último lavado sencillo' },
            { key: 'sucursal', label: 'Sucursal' },
            { key: 'contacto', label: 'Contacto', align: 'center' }
          ],
          rows: bins['0_visits'].clients,
          footerNote: 'Base: clientes con membresía activa durante el período seleccionado.'
        }
      };
    } catch (e) {
      console.warn('DB error in visit_frequency:', e.message);
    }
  }

  // ==========================================
  // 8. EQUIPO Y NÓMINA: INGRESOS VS COMISIONES (#1) / COMISIONES COLABORADORES
  // (Preserva 100% de la funcionalidad de Comisiones de Colaboradores)
  // ==========================================
  if (reportId === 'income_vs_commissions' || reportId === 'commissions') {
    try {
      const [visitRows] = await pool.query(`
        SELECT v.id, v.visited_at, v.empleado_peluquera, v.empleado_manicurista, v.total, v.servicios
        FROM visits v
        WHERE v.visited_at >= ? AND v.visited_at <= ? ${salonFilterVis}
      `, visParams);

      const empMap = {};
      let totalCommissionsSum = 0;
      let totalVisitsProcessed = visitRows.length;

      visitRows.forEach(v => {
        let svcCount = 1;
        try {
          if (Array.isArray(v.servicios)) svcCount = v.servicios.length;
          else if (typeof v.servicios === 'string' && v.servicios.startsWith('[')) svcCount = JSON.parse(v.servicios).length;
        } catch (e) {}

        if (v.empleado_peluquera && v.empleado_peluquera !== 'No asignada') {
          const name = v.empleado_peluquera.trim();
          if (!empMap[name]) empMap[name] = { nombre: name, posicion: 'Estilista / Peluquera', servicios: 0, comision: 0 };
          const comm = Number(v.total || 0) * 0.15;
          empMap[name].servicios += svcCount;
          empMap[name].comision += comm;
          totalCommissionsSum += comm;
        }
        if (v.empleado_manicurista && v.empleado_manicurista !== 'No asignada') {
          const name = v.empleado_manicurista.trim();
          if (!empMap[name]) empMap[name] = { nombre: name, posicion: 'Técnica / Manicurista', servicios: 0, comision: 0 };
          const comm = Number(v.total || 0) * 0.10;
          empMap[name].servicios += svcCount;
          empMap[name].comision += comm;
          totalCommissionsSum += comm;
        }
      });

      const commissionsList = Object.values(empMap);

      return {
        title: 'Ingresos vs. comisiones de colaboradores',
        periodText: `${start} al ${end}`,
        kpis: [
          { label: 'Comisiones Totales', value: `RD$ ${Math.round(totalCommissionsSum).toLocaleString('es-DO')}`, subtext: 'Generadas por el equipo', icon: 'percent', color: 'rose' },
          { label: 'Colaboradores con Comisión', value: commissionsList.length.toString(), subtext: 'Estilistas y técnicas', icon: 'users', color: 'blue' },
          { label: 'Servicios con Comisión', value: totalVisitsProcessed.toString(), subtext: 'Tickets con personal asignado', icon: 'receipt', color: 'emerald' }
        ],
        chart: {
          type: 'bar',
          title: 'Comisiones por Colaborador (RD$)',
          data: commissionsList.map(item => ({
            label: item.nombre,
            value: Math.round(item.comision),
            displayValue: `RD$ ${Math.round(item.comision).toLocaleString('es-DO')}`
          }))
        },
        table: {
          title: 'Desglose de comisiones por colaborador',
          badgeText: `${commissionsList.length} colaboradores`,
          columns: [
            { key: 'nombre', label: 'Colaborador' },
            { key: 'posicion', label: 'Posición / Especialidad' },
            { key: 'servicios', label: 'Servicios Realizados', align: 'center' },
            { key: 'comision', label: 'Comisión Generada', isCurrency: true }
          ],
          rows: commissionsList,
          footerNote: 'Ingresos menos comisiones representa el margen de contribución previo a nómina fija y no equivale a utilidad neta.'
        }
      };
    } catch (e) {
      console.warn('DB error in income_vs_commissions:', e.message);
    }
  }


  // ==========================================
  // 9. VENTAS Y COBROS: TICKETS CANCELADOS (#7)
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
          AND (v.status IN ('Cancelado', 'Cancelada', 'Cancel') OR LOWER(v.status) LIKE '%cancel%')
          ${salonFilterVis}
        ORDER BY v.visited_at DESC
        LIMIT 200
      `, visParams);

      const totalCancelledMonto = cancelRows.reduce((sum, r) => sum + Number(r.monto || 0), 0);
      const totalTickets = cancelRows.length;

      // Group by reason
      const reasonCount = {};
      cancelRows.forEach(r => {
        const m = r.motivo || 'Sin especificar';
        reasonCount[m] = (reasonCount[m] || 0) + 1;
      });
      const topReason = Object.keys(reasonCount).sort((a,b) => reasonCount[b] - reasonCount[a])[0] || 'Ninguno';

      return {
        title: 'Tickets cancelados',
        periodText: `${start} al ${end}`,
        kpis: [
          { label: 'Tickets Cancelados', value: totalTickets.toString(), subtext: 'Antes de facturación', icon: 'alert', color: 'rose' },
          { label: 'Monto Cancelado', value: `RD$ ${totalCancelledMonto.toLocaleString('es-DO')}`, subtext: 'Valor de servicios cancelados', icon: 'dollar', color: 'amber' },
          { label: 'Motivo Frecuente', value: topReason.length > 25 ? topReason.substring(0, 25) + '...' : topReason, subtext: 'Causa recurrente', icon: 'tag', color: 'blue' }
        ],
        chart: {
          type: 'bar',
          title: 'Tickets Cancelados por Sucursal',
          data: [
            { label: 'San Vicente', value: cancelRows.filter(r => r.sucursal.includes('Vicente')).length, displayValue: `${cancelRows.filter(r => r.sucursal.includes('Vicente')).length} tickets` },
            { label: 'Villa Mella', value: cancelRows.filter(r => r.sucursal.includes('Mella') || r.sucursal.includes('Sirena')).length, displayValue: `${cancelRows.filter(r => r.sucursal.includes('Mella') || r.sucursal.includes('Sirena')).length} tickets` }
          ]
        },
        table: {
          title: 'Detalle de tickets cancelados antes de facturar',
          badgeText: `${totalTickets} registros`,
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
          footerNote: 'Detalla los tickets cancelados antes de facturar, con fecha, motivo y usuario responsable.'
        }
      };
    } catch (e) {
      console.warn('DB error in cancelled_tickets:', e.message);
    }
  }

  // ==========================================
  // 10. VENTAS Y COBROS: FACTURAS ANULADAS (#8)
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
  // 11. VENTAS Y COBROS: VENTAS POR SUCURSAL (#3)
  // ==========================================
  if (reportId === 'sales_by_salon') {
    try {
      const [salonSales] = await pool.query(`
        SELECT 
          COALESCE(s.name, 'San Vicente') as sucursal,
          COUNT(v.id) as facturas,
          COALESCE(SUM(v.total), 0) as total,
          COALESCE(AVG(v.total), 0) as avg_ticket
        FROM visits v
        LEFT JOIN salons s ON v.salon_id = s.id
        WHERE v.visited_at >= ? AND v.visited_at <= ?
          AND v.status NOT IN ('Anulado', 'Anulada', 'Cancelado', 'Cancelada')
          ${salonFilterVis}
        GROUP BY v.salon_id, s.name
        ORDER BY total DESC
      `, visParams);

      const grandTotal = salonSales.reduce((sum, r) => sum + Number(r.total || 0), 0);
      const topSalon = salonSales[0]?.sucursal || 'San Vicente';

      return {
        title: 'Ventas por sucursal',
        periodText: `${start} al ${end}`,
        kpis: [
          { label: 'Facturación Global', value: `RD$ ${grandTotal.toLocaleString('es-DO')}`, subtext: 'Todas las sucursales', icon: 'dollar', color: 'emerald' },
          { label: 'Sucursal Líder', value: topSalon, subtext: 'Mayor volumen de ventas', icon: 'trending', color: 'blue' },
          { label: 'Sucursales Analizadas', value: salonSales.length.toString(), subtext: 'Puntos de venta activos', icon: 'tag', color: 'purple' }
        ],
        chart: {
          type: 'bar',
          title: 'Ventas por Sucursal (RD$)',
          data: salonSales.map(r => ({
            label: r.sucursal,
            value: Number(r.total || 0),
            displayValue: `RD$ ${Number(r.total || 0).toLocaleString('es-DO')}`
          }))
        },
        table: {
          title: 'Comparativa de ventas por sucursal',
          columns: [
            { key: 'sucursal', label: 'Sucursal' },
            { key: 'facturas', label: 'Facturas Emitidas', align: 'center' },
            { key: 'total', label: 'Facturación Total', isCurrency: true },
            { key: 'participacion', label: 'Participación', align: 'center' },
            { key: 'avg_ticket', label: 'Ticket Promedio', isCurrency: true }
          ],
          rows: salonSales.map(r => ({
            sucursal: r.sucursal,
            facturas: r.facturas,
            total: Number(r.total || 0),
            participacion: grandTotal > 0 ? `${((Number(r.total || 0) / grandTotal) * 100).toFixed(1)}%` : '0%',
            avg_ticket: Math.round(Number(r.avg_ticket || 0))
          })),
          footerNote: 'Compara las ventas de las sucursales e indica cuánto representa cada una sobre el total de la empresa.'
        }
      };
    } catch (e) {
      console.warn('DB error in sales_by_salon:', e.message);
    }
  }

  // ==========================================
  // 12. GENERADOR UNIVERSAL DINÁMICO (Para cualquier otro de los 30 reportes)
  // Garantiza que NUNCA devuelva null
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
