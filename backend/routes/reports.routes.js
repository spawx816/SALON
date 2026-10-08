const express = require('express');

/**
 * Reports and Financial Analytics Router
 * 
 * @param {import('mysql2/promise').Pool} pool 
 */
function createReportsRouter(pool) {
  const router = express.Router();

  // GET /api/reports/analytics
  router.get('/analytics', async (req, res) => {
    try {
      const { salon_id = 'all', start_date, end_date } = req.query;

      const startDate = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const endDate = end_date || new Date().toISOString().split('T')[0];

      const salonFilterPay = salon_id !== 'all' ? 'AND COALESCE(p.salon_id, cl.salon_id, 1) = ?' : '';
      const salonFilterVis = salon_id !== 'all' ? 'AND v.salon_id = ?' : '';
      const payParams = salon_id !== 'all' ? [startDate, endDate + ' 23:59:59', salon_id] : [startDate, endDate + ' 23:59:59'];
      const visParams = salon_id !== 'all' ? [startDate, endDate + ' 23:59:59', salon_id] : [startDate, endDate + ' 23:59:59'];
      const dailySalesParams = salon_id !== 'all' 
        ? [startDate, endDate + ' 23:59:59', salon_id, startDate, endDate + ' 23:59:59', salon_id] 
        : [startDate, endDate + ' 23:59:59', startDate, endDate + ' 23:59:59'];
      const combinedParams = salon_id !== 'all' 
        ? [startDate, endDate + ' 23:59:59', startDate, endDate + ' 23:59:59', salon_id]
        : [startDate, endDate + ' 23:59:59', startDate, endDate + ' 23:59:59'];

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
            LEFT JOIN clients cl ON p.client_id = cl.id
            WHERE p.created_at >= ? AND p.created_at <= ? AND p.status = 'Aprobado' ${salonFilterPay}
            GROUP BY DATE(p.created_at)

            UNION ALL

            SELECT DATE(v.visited_at) as date, SUM(v.total) as total
            FROM visits v
            LEFT JOIN clients cl ON (v.client_id = cl.id OR v.client_name = cl.nombre)
            WHERE v.visited_at >= ? AND v.visited_at <= ? AND v.status = 'Facturado' AND v.total > 0 ${salon_id !== 'all' ? 'AND COALESCE(v.salon_id, cl.salon_id, 1) = ?' : ''}
            GROUP BY DATE(v.visited_at)
          ) combined_sales
          GROUP BY date
          ORDER BY date ASC
        `, dailySalesParams),

        // 2. Renewal Revenue
        pool.query(`
          SELECT SUM(p.amount) as total
          FROM payments p
          LEFT JOIN clients cl ON p.client_id = cl.id
          WHERE p.created_at >= ? AND p.created_at <= ? AND p.status = 'Aprobado' 
            AND (p.plan_id IS NOT NULL AND p.plan_id != '' AND p.plan_id != 'gift_card') ${salonFilterPay}
        `, payParams),

        // 3. Commissions
        pool.query(`
          SELECT v.id, v.visited_at, v.empleado_peluquera, v.empleado_manicurista, v.total, v.servicios
          FROM visits v
          WHERE v.visited_at >= ? AND v.visited_at <= ? ${salonFilterVis}
        `, visParams),

        // 4. Active summary
        pool.query("SELECT COUNT(DISTINCT client_id) as count FROM contracts WHERE status IN ('Active', 'Activo')"),

        // 5. Cancelled summary
        pool.query("SELECT COUNT(DISTINCT client_id) as count FROM contracts WHERE status IN ('Cancelled', 'Cancelado')"),

        // 6. Inactive clients (>15 days without visit)
        pool.query(`
          SELECT c.id, c.nombre, c.telefono, MAX(v.visited_at) as last_visit
          FROM clients c
          LEFT JOIN visits v ON c.id = v.client_id
          GROUP BY c.id, c.nombre, c.telefono
          HAVING last_visit IS NULL OR last_visit < DATE_SUB(NOW(), INTERVAL 15 DAY)
          ORDER BY last_visit ASC
          LIMIT 50
        `),

        // 7. Payment breakdown
        pool.query(`
          SELECT method, COUNT(*) as count, SUM(amount) as total FROM (
            SELECT p.method, p.amount
            FROM payments p
            LEFT JOIN clients cl ON p.client_id = cl.id
            WHERE p.created_at >= ? AND p.created_at <= ? AND p.status = 'Aprobado' ${salonFilterPay}

            UNION ALL

            SELECT COALESCE(v.metodo_pago, 'Efectivo') as method, v.total as amount
            FROM visits v
            LEFT JOIN clients cl ON (v.client_id = cl.id OR v.client_name = cl.nombre)
            WHERE v.visited_at >= ? AND v.visited_at <= ? AND v.status = 'Facturado' AND v.total > 0 ${salon_id !== 'all' ? 'AND COALESCE(v.salon_id, cl.salon_id, 1) = ?' : ''}
          ) combined_pay
          GROUP BY method
          ORDER BY total DESC
        `, dailySalesParams),

        // 8. Visit Frequency
        pool.query(`
          SELECT client_id, COUNT(*) as visit_count
          FROM visits v
          WHERE v.visited_at >= ? AND v.visited_at <= ? ${salonFilterVis}
          GROUP BY client_id
        `, visParams),

        // 9. Cash payments
        pool.query(`
          SELECT p.id, p.created_at, p.amount, p.method, cl.nombre as client_name, s.name as salon_name, 'Caja Principal' as applied_by
          FROM payments p
          LEFT JOIN clients cl ON p.client_id = cl.id
          LEFT JOIN salons s ON (COALESCE(p.salon_id, cl.salon_id, 1) = s.id)
          WHERE p.created_at >= ? AND p.created_at <= ? AND p.status = 'Aprobado' 
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
                   COALESCE(s.name, 'Abatte Peluquería San Vicente') as salon_name,
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
                   COALESCE(s.name, 'Abatte Peluquería San Vicente') as salon_name,
                   COALESCE(v.salon_id, cl.salon_id, 1) as salon_id
            FROM visits v
            LEFT JOIN clients cl ON (v.client_id = cl.id OR v.client_name = cl.nombre)
            LEFT JOIN salons s ON (COALESCE(v.salon_id, cl.salon_id, 1) = s.id)
            WHERE v.visited_at >= ? AND v.visited_at <= ? AND v.status = 'Facturado' AND v.total > 0
          ) combined
          WHERE 1=1 ${salon_id !== 'all' ? 'AND combined.salon_id = ?' : ''}
          ORDER BY combined.created_at DESC
          LIMIT 500
        `, combinedParams)
      ]);

      // Process commissions
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

      // Process visit frequency
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
