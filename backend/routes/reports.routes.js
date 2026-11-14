const express = require('express');

/**
 * Reports and Financial Analytics Router (Scoped strictly by tenant_id)
 */
function createReportsRouter(pool) {
  const router = express.Router();

  // GET /api/reports/bi - Reporte operativo BI real por tenant
  router.get('/bi', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const {
        reportId = 'sales_summary',
        startDate,
        endDate,
        salonId = 'all'
      } = req.query;

      const start = startDate && /^\d{4}-\d{2}-\d{2}$/.test(String(startDate))
        ? String(startDate)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const end = endDate && /^\d{4}-\d{2}-\d{2}$/.test(String(endDate))
        ? String(endDate)
        : new Date().toISOString().split('T')[0];

      const salonFilterV = salonId && salonId !== 'all' ? ' AND v.salon_id::text = ?' : '';
      const vParams = salonId && salonId !== 'all'
        ? [tenantId, start, end + ' 23:59:59', String(salonId)]
        : [tenantId, start, end + ' 23:59:59'];

      const [visitAggRows] = await pool.query(`
        SELECT DATE(v.visited_at) as fecha,
               COALESCE(b.name, 'Principal') as sucursal,
               COUNT(*) as facturas,
               COALESCE(SUM(v.total), 0) as facturacion
        FROM visits v
        LEFT JOIN branches b ON v.salon_id::text = b.id::text AND b.tenant_id = v.tenant_id
        WHERE v.tenant_id = ? AND v.visited_at >= ? AND v.visited_at <= ? AND v.status = 'Facturado' ${salonFilterV}
        GROUP BY DATE(v.visited_at), COALESCE(b.name, 'Principal')
        ORDER BY DATE(v.visited_at) DESC
      `, vParams);

      const totalFacturacion = (visitAggRows || []).reduce((acc, r) => acc + Number(r.facturacion || 0), 0);
      const totalFacturas = (visitAggRows || []).reduce((acc, r) => acc + Number(r.facturas || 0), 0);
      const ticketPromedio = totalFacturas > 0 ? Math.round(totalFacturacion / totalFacturas) : 0;

      const chartMap = new Map();
      for (const r of (visitAggRows || [])) {
        const key = r.fecha ? String(r.fecha).slice(0, 10) : '';
        chartMap.set(key, (chartMap.get(key) || 0) + Number(r.facturacion || 0));
      }
      const chartData = Array.from(chartMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([label, total]) => ({ label, total }));

      const fmt = (n) => `RD$ ${Math.round(Number(n || 0)).toLocaleString('en-US')}`;

      if (reportId === 'cash_flow') {
        const expParams = salonId && salonId !== 'all'
          ? [tenantId, start, end, String(salonId), String(salonId)]
          : [tenantId, start, end];
        const salonFilterE = salonId && salonId !== 'all' ? ' AND (branch_id::text = ? OR salon_id::text = ?)' : '';
        const [expRows] = await pool.query(
          `SELECT COALESCE(SUM(amount), 0) as total_egresos FROM expenses WHERE tenant_id = ? AND COALESCE(date, expense_date) BETWEEN ? AND ? ${salonFilterE}`,
          expParams
        );
        const totalEgresos = Number(expRows[0]?.total_egresos || 0);
        const neto = totalFacturacion - totalEgresos;
        return res.json({
          success: true,
          reportId,
          title: 'Flujo de caja operativo',
          periodText: `${start} al ${end}`,
          kpis: [
            { label: 'Ingresos facturados', value: fmt(totalFacturacion), subtext: `${totalFacturas} facturas`, icon: 'trending', color: 'emerald' },
            { label: 'Egresos registrados', value: fmt(totalEgresos), subtext: 'Período seleccionado', icon: 'dollar', color: 'rose' },
            { label: 'Flujo neto', value: fmt(neto), subtext: 'Ingresos - Egresos', icon: 'receipt', color: neto >= 0 ? 'blue' : 'amber' }
          ],
          chart: { type: 'sales_evolution', data: chartData },
          table: {
            title: 'Detalle de ingresos por fecha',
            badgeText: `${(visitAggRows || []).length} registros`,
            columns: [
              { key: 'fecha', label: 'Fecha' },
              { key: 'sucursal', label: 'Sucursal' },
              { key: 'facturas', label: 'Facturas', align: 'center' },
              { key: 'facturacion', label: 'Ingresos', isCurrency: true }
            ],
            rows: (visitAggRows || []).map((r) => ({
              fecha: r.fecha ? String(r.fecha).slice(0, 10) : '',
              sucursal: r.sucursal,
              facturas: Number(r.facturas || 0),
              facturacion: Number(r.facturacion || 0)
            }))
          }
        });
      }

      return res.json({
        success: true,
        reportId,
        title: 'Resumen de ventas y cobros',
        periodText: `${start} al ${end}`,
        kpis: [
          { label: 'Facturación', value: fmt(totalFacturacion), subtext: 'Ventas del período', icon: 'trending', color: 'emerald' },
          { label: 'Total cobrado', value: fmt(totalFacturacion), subtext: 'Facturado en el período', icon: 'dollar', color: 'blue' },
          { label: 'Cantidad de facturas', value: String(totalFacturas), subtext: 'Facturas válidas', icon: 'receipt', color: 'purple' },
          { label: 'Ticket promedio', value: fmt(ticketPromedio), subtext: 'Por factura', icon: 'tag', color: 'amber' }
        ],
        chart: { type: 'sales_evolution', data: chartData },
        table: {
          title: 'Detalle de ventas',
          badgeText: `${(visitAggRows || []).length} registros`,
          columns: [
            { key: 'fecha', label: 'Fecha' },
            { key: 'sucursal', label: 'Sucursal' },
            { key: 'facturas', label: 'Facturas', align: 'center' },
            { key: 'facturacion', label: 'Facturación', isCurrency: true },
            { key: 'cobrado', label: 'Total cobrado', isCurrency: true }
          ],
          rows: (visitAggRows || []).map((r) => ({
            fecha: r.fecha ? String(r.fecha).slice(0, 10) : '',
            sucursal: r.sucursal,
            facturas: Number(r.facturas || 0),
            facturacion: Number(r.facturacion || 0),
            cobrado: Number(r.facturacion || 0)
          }))
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
