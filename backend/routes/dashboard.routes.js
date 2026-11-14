const express = require('express');

const MONTH_NAMES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const SHORT_MONTHS_ES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

const DAY_NAMES_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const LOCATION_COLORS = ['#0066ff', '#3b82f6', '#60a5fa', '#93c5fd', '#1d4ed8', '#0284c7'];

function toIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getMondayOfWeek(refDate) {
  const d = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

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
        [branchesRows],
        [salonsRows],
        [plans],
        [staffCount],
        [todayVisitsBreakdown],
        [membershipsBreakdown],
      ] = await Promise.all([
        pool.query('SELECT COUNT(*) as total FROM clients WHERE tenant_id = ?', [tenantId]),
        pool.query("SELECT COUNT(*) as total FROM contracts WHERE tenant_id = ? AND status IN ('Active', 'Activo')", [tenantId]),
        pool.query("SELECT COUNT(*) as total FROM contracts WHERE tenant_id = ? AND status IN ('Cancelled', 'Cancelado')", [tenantId]),
        pool.query(
          "SELECT COUNT(*) as total, COALESCE(SUM(total), 0) as revenue FROM visits WHERE tenant_id = ? AND visited_at >= CURRENT_DATE AND visited_at < CURRENT_DATE + INTERVAL '1 day' AND COALESCE(status, '') NOT IN ('Anulado', 'Cancelado')",
          [tenantId]
        ),
        pool.query(
          "SELECT COUNT(*) as total FROM visits WHERE tenant_id = ? AND visited_at >= DATE_TRUNC('month', CURRENT_DATE) AND visited_at < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' AND COALESCE(status, '') NOT IN ('Anulado', 'Cancelado')",
          [tenantId]
        ),
        pool.query(
          "SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE tenant_id = ? AND created_at >= DATE_TRUNC('month', CURRENT_DATE) AND created_at < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' AND status = 'Aprobado'",
          [tenantId]
        ),
        pool.query(
          "SELECT COALESCE(SUM(total), 0) as total FROM visits WHERE tenant_id = ? AND visited_at >= DATE_TRUNC('month', CURRENT_DATE) AND visited_at < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' AND COALESCE(status, '') IN ('Facturado', 'Completado', 'Completada', 'Pagado')",
          [tenantId]
        ),
        pool.query(
          `SELECT v.*, COALESCE(v.client_name, c.nombre, 'Cliente General') as client_name, COALESCE(b.name, s.name, 'Principal') as salon_name
           FROM visits v
           LEFT JOIN clients c ON v.client_id::text = c.id::text AND c.tenant_id = v.tenant_id
           LEFT JOIN branches b ON v.salon_id::text = b.id::text AND b.tenant_id = v.tenant_id
           LEFT JOIN salons s ON v.salon_id::text = s.id::text AND s.tenant_id = v.tenant_id
           WHERE v.tenant_id = ?
             AND COALESCE(v.status, '') NOT IN ('Anulado', 'Cancelado')
           ORDER BY v.visited_at DESC LIMIT 15`,
          [tenantId]
        ),
        pool.query(
          `SELECT p.*, COALESCE(c.nombre, p.client_id::text, 'Cliente General') as client_name
           FROM payments p
           LEFT JOIN clients c ON p.client_id::text = c.id::text AND c.tenant_id = p.tenant_id
           WHERE p.tenant_id = ?
           ORDER BY p.created_at DESC LIMIT 15`,
          [tenantId]
        ),
        pool.query('SELECT id, name FROM branches WHERE tenant_id = ? ORDER BY name ASC', [tenantId]),
        pool.query('SELECT id, name FROM salons WHERE tenant_id = ? ORDER BY name ASC', [tenantId]),
        pool.query('SELECT * FROM plans WHERE tenant_id = ?', [tenantId]),
        pool.query("SELECT COUNT(*) as total FROM staff_records WHERE tenant_id = ? AND status IN ('Activo', 'Active')", [tenantId]),
        pool.query(
          `SELECT salon_id,
                  COUNT(*) as total,
                  COALESCE(SUM(total), 0) as revenue
           FROM visits
           WHERE tenant_id = ?
             AND visited_at >= CURRENT_DATE
             AND visited_at < CURRENT_DATE + INTERVAL '1 day'
             AND COALESCE(status, '') NOT IN ('Anulado', 'Cancelado')
           GROUP BY salon_id`,
          [tenantId]
        ),
        pool.query(
          `SELECT COALESCE(salon_id, '') as salon_id, COUNT(*) as total
           FROM contracts
           WHERE tenant_id = ? AND status IN ('Active', 'Activo')
           GROUP BY COALESCE(salon_id, '')`,
          [tenantId]
        ),
      ]);

      const mrr = Number(revenueMonth[0]?.total || 0);
      const posRevenue = Number(posSalesMonth[0]?.total || 0);
      const totalRevenueMonth = mrr + posRevenue;
      const visitsTodayNum = Number(visitsToday[0]?.total || 0);
      const revenueTodayNum = Number(visitsToday[0]?.revenue || 0);
      const activeSubsNum = Number(activeContracts[0]?.total || 0);
      const salonsList = branchesRows.length > 0 ? branchesRows : salonsRows;

      res.json({
        totalClients: Number(clientsCount[0]?.total || 0),
        activeSubscriptions: activeSubsNum,
        cancelledSubscriptions: Number(cancelledContracts[0]?.total || 0),
        visitsToday: visitsTodayNum,
        revenueToday: revenueTodayNum,
        visitsMonth: Number(visitsMonth[0]?.total || 0),
        subscriptionRevenueMonth: mrr,
        posRevenueMonth: posRevenue,
        totalRevenueMonth,
        activeStaff: Number(staffCount[0]?.total || 0),
        metrics: {
          todayVisits: visitsTodayNum,
          activeClients: activeSubsNum,
          monthlyRevenue: totalRevenueMonth,
          dailySales: revenueTodayNum,
        },
        breakdowns: {
          salons: salonsList,
          visits: todayVisitsBreakdown.map((r) => ({
            salon_id: r.salon_id,
            plan_beauty: 0,
            generica: Number(r.total || 0),
            total: Number(r.total || 0),
          })),
          memberships: membershipsBreakdown.map((r) => ({
            salon_id: r.salon_id,
            total: Number(r.total || 0),
          })),
          dailySales: todayVisitsBreakdown.map((r) => ({
            salon_id: r.salon_id,
            total: Number(r.revenue || 0),
          })),
        },
        recentVisits,
        recentPayments,
        salons: salonsList,
        plans,
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
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de salón requerido.' });
      }

      const now = new Date();
      const todayIso = toIsoDate(now);
      const curWeekStart = getMondayOfWeek(now);
      const curWeekEnd = new Date(curWeekStart);
      curWeekEnd.setDate(curWeekStart.getDate() + 7);

      const prevWeekStart = new Date(curWeekStart);
      prevWeekStart.setDate(curWeekStart.getDate() - 7);

      const curMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevMonthSameDay = new Date(
        now.getFullYear(),
        now.getMonth() - 1,
        Math.min(now.getDate() + 1, new Date(now.getFullYear(), now.getMonth(), 0).getDate() + 1)
      );

      const [
        [weekRows],
        [curMonthRows],
        [prevMonthRows],
      ] = await Promise.all([
        pool.query(
          `SELECT TO_CHAR(visited_at::date, 'YYYY-MM-DD') as date,
                  COALESCE(SUM(total), 0) as total,
                  COUNT(*) as count
           FROM visits
           WHERE tenant_id = ?
             AND visited_at >= ?::date
             AND visited_at < ?::date
             AND COALESCE(status, '') IN ('Facturado', 'Completado', 'Completada', 'Pagado')
           GROUP BY visited_at::date
           ORDER BY date ASC`,
          [tenantId, toIsoDate(prevWeekStart), toIsoDate(curWeekEnd)]
        ),
        pool.query(
          `SELECT COALESCE(SUM(total), 0) as total
           FROM visits
           WHERE tenant_id = ?
             AND visited_at >= ?::date
             AND visited_at < ?::date
             AND COALESCE(status, '') IN ('Facturado', 'Completado', 'Completada', 'Pagado')`,
          [tenantId, toIsoDate(curMonthStart), toIsoDate(nextMonthStart)]
        ),
        pool.query(
          `SELECT COALESCE(SUM(total), 0) as total
           FROM visits
           WHERE tenant_id = ?
             AND visited_at >= ?::date
             AND visited_at < ?::date
             AND COALESCE(status, '') IN ('Facturado', 'Completado', 'Completada', 'Pagado')`,
          [tenantId, toIsoDate(prevMonthStart), toIsoDate(prevMonthSameDay)]
        ),
      ]);

      const totalsByDate = new Map(
        weekRows.map((r) => [String(r.date).slice(0, 10), Number(r.total || 0)])
      );

      const days = [];
      const currentWeek = [];
      const previousWeek = [];

      for (let i = 0; i < 7; i++) {
        const curDay = new Date(curWeekStart);
        curDay.setDate(curWeekStart.getDate() + i);
        const curIso = toIsoDate(curDay);

        const prevDay = new Date(prevWeekStart);
        prevDay.setDate(prevWeekStart.getDate() + i);
        const prevIso = toIsoDate(prevDay);

        const curAmt = totalsByDate.get(curIso) || 0;
        const prevAmt = totalsByDate.get(prevIso) || 0;
        const isFuture = curIso > todayIso;
        const variationPercent =
          prevAmt > 0 && !isFuture
            ? Number((((curAmt - prevAmt) / prevAmt) * 100).toFixed(1))
            : null;

        days.push({
          dayName: DAY_NAMES_ES[curDay.getDay()],
          dayLabel: `${curDay.getDate()} ${SHORT_MONTHS_ES[curDay.getMonth()]}`,
          date: curIso,
          currentAmount: curAmt,
          previousAmount: prevAmt,
          variationPercent,
          isFuture,
        });

        currentWeek.push({ date: curIso, total: curAmt });
        previousWeek.push({ date: prevIso, total: prevAmt });
      }

      const curTotal = days.reduce((acc, d) => acc + d.currentAmount, 0);
      const prevTotal = days.reduce((acc, d) => acc + d.previousAmount, 0);
      const growthPercent =
        prevTotal > 0 ? Number((((curTotal - prevTotal) / prevTotal) * 100).toFixed(1)) : null;

      const monthTotal = Number(curMonthRows[0]?.total || 0);
      const prevMonthTotal = Number(prevMonthRows[0]?.total || 0);
      const monthVariation =
        prevMonthTotal > 0
          ? Number((((monthTotal - prevMonthTotal) / prevMonthTotal) * 100).toFixed(1))
          : null;

      const curWeekEndInclusive = new Date(curWeekEnd);
      curWeekEndInclusive.setDate(curWeekEndInclusive.getDate() - 1);

      res.json({
        days,
        month: {
          title: 'Mes',
          subtitle: `${MONTH_NAMES_ES[now.getMonth()]} ${now.getFullYear()}`,
          total: monthTotal,
          prev_to_date_total: prevMonthTotal,
          variationPercent: monthVariation,
        },
        period: {
          weekStart: toIsoDate(curWeekStart),
          weekEnd: toIsoDate(curWeekEndInclusive),
          label: `${curWeekStart.getDate()} ${SHORT_MONTHS_ES[curWeekStart.getMonth()]} – ${curWeekEndInclusive.getDate()} ${SHORT_MONTHS_ES[curWeekEndInclusive.getMonth()]} ${curWeekEndInclusive.getFullYear()}`,
        },
        hasActivity: curTotal > 0 || prevTotal > 0 || monthTotal > 0,
        currentWeek,
        previousWeek,
        currentTotal: curTotal,
        previousTotal: prevTotal,
        growthPercent,
      });
    } catch (err) {
      console.error('[DASHBOARD WEEKLY BILLING ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 3. GET /api/dashboard/visits-by-location
  router.get('/visits-by-location', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de salón requerido.' });
      }

      const now = new Date();
      const reqMonth = Number(req.query.month);
      const reqYear = Number(req.query.year);
      const month = reqMonth >= 1 && reqMonth <= 12 ? reqMonth : now.getMonth() + 1;
      const year = reqYear >= 2020 && reqYear <= 2100 ? reqYear : now.getFullYear();

      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 1);
      const monthLabel = `${MONTH_NAMES_ES[month - 1]} ${year}`;

      const [rows] = await pool.query(
        `SELECT COALESCE(b.name, s.name, 'Sucursal Principal') as salon_name,
                v.salon_id,
                COUNT(v.id) as visits_count,
                COALESCE(SUM(v.total), 0) as total_revenue
         FROM visits v
         LEFT JOIN branches b ON v.salon_id::text = b.id::text AND b.tenant_id = v.tenant_id
         LEFT JOIN salons s ON v.salon_id::text = s.id::text AND s.tenant_id = v.tenant_id
         WHERE v.tenant_id = ?
           AND v.visited_at >= ?::date
           AND v.visited_at < ?::date
           AND COALESCE(v.status, '') NOT IN ('Anulado', 'Cancelado')
         GROUP BY v.salon_id, b.name, s.name
         ORDER BY visits_count DESC`,
        [tenantId, toIsoDate(startDate), toIsoDate(endDate)]
      );

      const totalVisits = rows.reduce((acc, r) => acc + Number(r.visits_count || 0), 0);
      const locations =
        totalVisits > 0
          ? rows.map((r, idx) => {
              const visits = Number(r.visits_count || 0);
              return {
                rank: String(idx + 1).padStart(2, '0'),
                salon_id: r.salon_id,
                salon_name: r.salon_name,
                visits,
                percentage: Math.round((visits / totalVisits) * 100),
                revenue: Number(r.total_revenue || 0),
                color: LOCATION_COLORS[idx % LOCATION_COLORS.length],
              };
            })
          : [];

      res.json({
        locations,
        totalVisits,
        monthLabel,
        period: {
          month,
          year,
          startDate: toIsoDate(startDate),
          endDate: toIsoDate(new Date(year, month, 0)),
        },
      });
    } catch (err) {
      console.error('[DASHBOARD VISITS BY LOCATION ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 4. GET /api/dashboard/plan-usage
  router.get('/plan-usage', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de salón requerido.' });
      }
      const [rows] = await pool.query(
        `SELECT p.id, p.name, p.price,
                COUNT(c.id) as active_subscribers,
                COALESCE(SUM(c.washes_used), 0) as total_washes_used,
                COALESCE(SUM(c.wash_quota), 0) as total_washes_quota
         FROM plans p
         LEFT JOIN contracts c ON p.id::text = c.plan_id::text AND c.tenant_id = p.tenant_id AND c.status IN ('Active', 'Activo')
         WHERE p.tenant_id = ?
         GROUP BY p.tenant_id, p.id, p.name, p.price
         ORDER BY p.price ASC`,
        [tenantId]
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 5. GET /api/dashboard/billing-stats
  router.get('/billing-stats', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de salón requerido.' });
      }
      const [paymentStats] = await pool.query(
        `SELECT status, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
         FROM payments
         WHERE tenant_id = ?
           AND created_at >= DATE_TRUNC('month', CURRENT_DATE)
           AND created_at < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
         GROUP BY status`,
        [tenantId]
      );

      const [upcomingRenewals] = await pool.query(
        `SELECT c.id, c.client_id, cl.nombre as client_name, cl.telefono, c.plan_name, c.precio_mensual, c.next_billing_date
         FROM contracts c
         LEFT JOIN clients cl ON c.client_id::text = cl.id::text AND cl.tenant_id = c.tenant_id
         WHERE c.tenant_id = ?
           AND c.status IN ('Active', 'Activo')
           AND c.next_billing_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
         ORDER BY c.next_billing_date ASC
         LIMIT 25`,
        [tenantId]
      );

      res.json({
        paymentStats,
        upcomingRenewals,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createDashboardRouter };
