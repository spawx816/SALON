const express = require('express');

/**
 * Dashboard KPIs, Charts & Real-time Analytics Router (Scoped strictly by tenant_id)
 */
function createDashboardRouter(pool) {
  const router = express.Router();

  // 1. GET /api/dashboard/summary - Consolidated summary for main dashboard
  router.get('/summary', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de salón requerido.' });
      }

      const [
        [clientsCount],
        [activeContracts],
        [cancelledContracts],
        [visitsToday],
        [visitsMonth],
        [revenueMonth],
        [posSalesMonth],
        [recentVisits],
        [recentPayments],
        [salons],
        [plans],
        [staffCount]
      ] = await Promise.all([
        pool.query('SELECT COUNT(*) as total FROM clients WHERE tenant_id = ?', [tenantId]),
        pool.query("SELECT COUNT(*) as total FROM contracts WHERE tenant_id = ? AND status IN ('Active', 'Activo')", [tenantId]),
        pool.query("SELECT COUNT(*) as total FROM contracts WHERE tenant_id = ? AND status IN ('Cancelled', 'Cancelado')", [tenantId]),
        pool.query("SELECT COUNT(*) as total, COALESCE(SUM(total), 0) as revenue FROM visits WHERE tenant_id = ? AND DATE(visited_at) = CURRENT_DATE AND status = 'Facturado'", [tenantId]),
        pool.query("SELECT COUNT(*) as total FROM visits WHERE tenant_id = ? AND MONTH(visited_at) = MONTH(NOW()) AND YEAR(visited_at) = YEAR(NOW()) AND status = 'Facturado'", [tenantId]),
        pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE tenant_id = ? AND MONTH(created_at) = MONTH(NOW()) AND YEAR(created_at) = YEAR(NOW()) AND status = 'Aprobado'", [tenantId]),
        pool.query("SELECT COALESCE(SUM(total), 0) as total FROM visits WHERE tenant_id = ? AND MONTH(visited_at) = MONTH(NOW()) AND YEAR(visited_at) = YEAR(NOW()) AND status = 'Facturado'", [tenantId]),
        pool.query(`
          SELECT v.*, COALESCE(v.client_name, c.nombre, 'Cliente General') as client_name, COALESCE(b.name, s.name, 'Principal') as salon_name
          FROM visits v
          LEFT JOIN clients c ON v.client_id = c.id AND c.tenant_id = v.tenant_id
          LEFT JOIN branches b ON v.salon_id::text = b.id::text AND b.tenant_id = v.tenant_id
          LEFT JOIN salons s ON v.salon_id::text = s.id::text AND s.tenant_id = v.tenant_id
          WHERE v.tenant_id = ?
          ORDER BY v.visited_at DESC LIMIT 15
        `, [tenantId]),
        pool.query(`
          SELECT p.*, COALESCE(c.nombre, p.client_id, 'Cliente General') as client_name
          FROM payments p
          LEFT JOIN clients c ON p.client_id = c.id AND c.tenant_id = p.tenant_id
          WHERE p.tenant_id = ?
          ORDER BY p.created_at DESC LIMIT 15
        `, [tenantId]),
        pool.query('SELECT * FROM salons WHERE tenant_id = ?', [tenantId]),
        pool.query('SELECT * FROM plans WHERE tenant_id = ?', [tenantId]),
        pool.query("SELECT COUNT(*) as total FROM staff_records WHERE tenant_id = ? AND status IN ('Activo', 'Active')", [tenantId])
      ]);

      const mrr = Number(revenueMonth[0]?.total || 0);
      const posRevenue = Number(posSalesMonth[0]?.total || 0);

      res.json({
        totalClients: Number(clientsCount[0]?.total || 0),
        activeSubscriptions: Number(activeContracts[0]?.total || 0),
        cancelledSubscriptions: Number(cancelledContracts[0]?.total || 0),
        visitsToday: Number(visitsToday[0]?.total || 0),
        revenueToday: Number(visitsToday[0]?.revenue || 0),
        visitsMonth: Number(visitsMonth[0]?.total || 0),
        subscriptionRevenueMonth: mrr,
        posRevenueMonth: posRevenue,
        totalRevenueMonth: mrr + posRevenue,
        activeStaff: Number(staffCount[0]?.total || 0),
        recentVisits,
        recentPayments,
        salons,
        plans
      });
    } catch (err) {
      console.error('[DASHBOARD SUMMARY ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 2. GET /api/dashboard/weekly-billing-comparison
  router.get('/weekly-billing-comparison', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const [currentWeek] = await pool.query(`
        SELECT DATE(visited_at) as date, COALESCE(SUM(total), 0) as total, COUNT(*) as count
        FROM visits
        WHERE tenant_id = ?
          AND visited_at >= DATE_SUB(CURRENT_DATE, INTERVAL 7 DAY)
          AND status = 'Facturado'
        GROUP BY DATE(visited_at)
        ORDER BY date ASC
      `, [tenantId]);

      const [previousWeek] = await pool.query(`
        SELECT DATE(visited_at) as date, COALESCE(SUM(total), 0) as total, COUNT(*) as count
        FROM visits
        WHERE tenant_id = ?
          AND visited_at >= DATE_SUB(CURRENT_DATE, INTERVAL 14 DAY)
          AND visited_at < DATE_SUB(CURRENT_DATE, INTERVAL 7 DAY)
          AND status = 'Facturado'
        GROUP BY DATE(visited_at)
        ORDER BY date ASC
      `, [tenantId]);

      const curTotal = currentWeek.reduce((acc, r) => acc + Number(r.total || 0), 0);
      const prevTotal = previousWeek.reduce((acc, r) => acc + Number(r.total || 0), 0);
      const growthPercent = prevTotal > 0 ? Number((((curTotal - prevTotal) / prevTotal) * 100).toFixed(1)) : 0;

      res.json({
        currentWeek,
        previousWeek,
        currentTotal: curTotal,
        previousTotal: prevTotal,
        growthPercent
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 3. GET /api/dashboard/visits-by-location
  router.get('/visits-by-location', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const [rows] = await pool.query(`
        SELECT COALESCE(b.name, s.name, 'Sucursal Principal') as location_name,
               v.salon_id,
               COUNT(v.id) as visits_count,
               COALESCE(SUM(v.total), 0) as total_revenue
        FROM visits v
        LEFT JOIN branches b ON v.salon_id::text = b.id::text AND b.tenant_id = v.tenant_id
        LEFT JOIN salons s ON v.salon_id::text = s.id::text AND s.tenant_id = v.tenant_id
        WHERE v.tenant_id = ? AND v.status = 'Facturado'
        GROUP BY v.salon_id, b.name, s.name
        ORDER BY visits_count DESC
      `, [tenantId]);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 4. GET /api/dashboard/plan-usage
  router.get('/plan-usage', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const [rows] = await pool.query(`
        SELECT p.id, p.name, p.price,
               COUNT(c.id) as active_subscribers,
               COALESCE(SUM(c.washes_used), 0) as total_washes_used,
               COALESCE(SUM(c.wash_Quota), 0) as total_washes_quota
        FROM plans p
        LEFT JOIN contracts c ON p.id = c.plan_id AND c.tenant_id = p.tenant_id AND c.status IN ('Active', 'Activo')
        WHERE p.tenant_id = ?
        GROUP BY p.tenant_id, p.id, p.name, p.price
        ORDER BY p.price ASC
      `, [tenantId]);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 5. GET /api/dashboard/billing-stats
  router.get('/billing-stats', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const [paymentStats] = await pool.query(`
        SELECT status, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
        FROM payments
        WHERE tenant_id = ? AND MONTH(created_at) = MONTH(NOW()) AND YEAR(created_at) = YEAR(NOW())
        GROUP BY status
      `, [tenantId]);

      const [upcomingRenewals] = await pool.query(`
        SELECT c.id, c.client_id, cl.nombre as client_name, cl.telefono, c.plan_name, c.precio_mensual, c.next_billing_date
        FROM contracts c
        LEFT JOIN clients cl ON c.client_id = cl.id AND cl.tenant_id = c.tenant_id
        WHERE c.tenant_id = ?
          AND c.status IN ('Active', 'Activo')
          AND c.next_billing_date BETWEEN CURRENT_DATE AND DATE_ADD(CURRENT_DATE, INTERVAL 7 DAY)
        ORDER BY c.next_billing_date ASC
        LIMIT 25
      `, [tenantId]);

      res.json({
        paymentStats,
        upcomingRenewals
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createDashboardRouter };
