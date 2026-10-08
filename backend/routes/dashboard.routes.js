const express = require('express');

/**
 * Dashboard & Analytics Router
 * @param {import('mysql2/promise').Pool} pool
 */
function createDashboardRouter(pool) {
  const router = express.Router();

  // === DASHBOARD SUMMARY ===
  router.get('/summary', async (req, res) => {
    try {
      const [
        [todayVisits],
        [activeClients],
        [monthlyRevenue],
        [dailySalesPayments],
        [dailySalesVisits],
        [weeklyTraffic],
        [recentVisits],
        [salonsList],
        [todayVisitsRows],
        [activeMembersRows],
        [todayPaymentsRows],
        [todayVisitsSalesRows]
      ] = await Promise.all([
        // 1. Visitas de hoy
        pool.query('SELECT COUNT(*) as count FROM visits WHERE DATE(visited_at) = CURRENT_DATE()'),
        // 2. Clientes con contrato activo
        pool.query('SELECT COUNT(DISTINCT client_id) as count FROM contracts WHERE status IN ("Active", "Activo")'),
        // 3. Ingresos Mensuales Estimados (Suma de planes activos deduplicados por cliente)
        pool.query(`
          SELECT COALESCE(SUM(c.effective_price), 0) as total 
          FROM (
            SELECT c.client_id, MAX(COALESCE(c.contract_price, p.price)) as effective_price
            FROM contracts c 
            JOIN plans p ON c.plan_id = p.id 
            WHERE c.status IN ('Active', 'Activo')
            GROUP BY c.client_id
          ) c
        `),
        // 4. Ventas Diarias (Pagos de planes de hoy)
        pool.query(`
          SELECT SUM(amount) as total
          FROM payments
          WHERE DATE(created_at) = CURRENT_DATE() AND status = 'Aprobado'
        `),
        // 5. Ventas Diarias (Ventas POS facturadas hoy)
        pool.query(`
          SELECT SUM(total) as total
          FROM visits
          WHERE DATE(visited_at) = CURRENT_DATE() AND status = 'Facturado' AND total > 0
        `),
        // 6. Tráfico semanal (Últimos 7 días)
        pool.query(`
          SELECT DATE(visited_at) as date, COUNT(*) as count 
          FROM visits 
          WHERE visited_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
          GROUP BY DATE(visited_at)
          ORDER BY DATE(visited_at) ASC
        `),
        // 7. Últimas visitas exclusivas de Plan Beauty (excluyendo genéricas)
        pool.query(`
          SELECT v.*, s.name as salon_name 
          FROM visits v 
          LEFT JOIN salons s ON v.salon_id = s.id 
          LEFT JOIN contracts c ON (v.client_id = c.client_id AND c.status IN ('Active', 'Activo'))
          WHERE (
            (v.client_id IS NOT NULL AND v.client_id != '' AND v.client_id != 'INVITADO' AND v.client_id != 'generico')
            AND (
              LOWER(COALESCE(v.metodo_pago, '')) LIKE '%plan%' 
              OR LOWER(COALESCE(v.servicios, '')) LIKE '%plan%' 
              OR (c.id IS NOT NULL AND (v.total = 0 OR LOWER(COALESCE(v.metodo_pago, '')) LIKE '%plan%'))
            )
          )
          ORDER BY v.visited_at DESC 
          LIMIT 10
        `),
        // 8. Salons list
        pool.query('SELECT id, name FROM salons ORDER BY id ASC'),
        // 9. Breakdown: Visitas de Hoy
        pool.query(`
          SELECT v.id, COALESCE(v.salon_id, cl.salon_id, 1) as salon_id, v.total, v.metodo_pago, v.servicios
          FROM visits v
          LEFT JOIN clients cl ON (v.client_id = cl.id OR v.client_name = cl.nombre)
          WHERE DATE(v.visited_at) = CURRENT_DATE()
        `),
        // 10. Breakdown: Membresías Activas
        pool.query(`
          SELECT COALESCE(c.salon_id, cl.salon_id, 1) as salon_id, COUNT(DISTINCT c.client_id) as count
          FROM contracts c
          LEFT JOIN clients cl ON c.client_id = cl.id
          WHERE c.status IN ('Active', 'Activo')
          GROUP BY COALESCE(c.salon_id, cl.salon_id, 1)
        `),
        // 11. Breakdown: Pagos de Hoy
        pool.query(`
          SELECT p.id, 
                 COALESCE(p.salon_id, cl.salon_id, 1) as salon_id, 
                 p.amount, p.plan_id, p.method
          FROM payments p
          LEFT JOIN clients cl ON p.client_id = cl.id
          WHERE DATE(p.created_at) = CURRENT_DATE() AND p.status = 'Aprobado'
        `),
        // 12. Breakdown: Ventas POS de Hoy
        pool.query(`
          SELECT v.id, 
                 COALESCE(v.salon_id, cl.salon_id, 1) as salon_id, 
                 v.total as amount, 
                 v.metodo_pago as method
          FROM visits v
          LEFT JOIN clients cl ON (v.client_id = cl.id OR v.client_name = cl.nombre)
          WHERE DATE(v.visited_at) = CURRENT_DATE() AND v.status = 'Facturado' AND v.total > 0
        `)
      ]);

      const totalDailySales = (Number(dailySalesPayments[0]?.total) || 0) + (Number(dailySalesVisits[0]?.total) || 0);
      const salonsData = salonsList.length > 0 ? salonsList : [{ id: 1, name: 'Abatte San Vicente' }];

      const visitsBreakdownBySalon = {};
      salonsData.forEach(s => {
        visitsBreakdownBySalon[s.id] = { salon_id: s.id, salon_name: s.name, plan_beauty: 0, generica: 0, total: 0 };
      });
      todayVisitsRows.forEach(v => {
        const sId = visitsBreakdownBySalon[v.salon_id] ? v.salon_id : salonsData[0].id;
        const isPlan = (v.metodo_pago && v.metodo_pago.toLowerCase().includes('plan')) || 
                       (typeof v.servicios === 'string' && v.servicios.toLowerCase().includes('plan')) || 
                       Number(v.total) === 0;
        if (isPlan) {
          visitsBreakdownBySalon[sId].plan_beauty++;
        } else {
          visitsBreakdownBySalon[sId].generica++;
        }
        visitsBreakdownBySalon[sId].total++;
      });

      const membersBreakdownBySalon = {};
      salonsData.forEach(s => {
        membersBreakdownBySalon[s.id] = { salon_id: s.id, salon_name: s.name, count: 0 };
      });
      activeMembersRows.forEach(r => {
        const sId = membersBreakdownBySalon[r.salon_id] ? r.salon_id : salonsData[0].id;
        membersBreakdownBySalon[sId].count = Number(r.count) || 0;
      });

      const salesBreakdownBySalon = {};
      salonsData.forEach(s => {
        salesBreakdownBySalon[s.id] = { salon_id: s.id, salon_name: s.name, plan_beauty: 0, generica: 0, total: 0 };
      });

      todayPaymentsRows.forEach(p => {
        const sId = salesBreakdownBySalon[p.salon_id] ? p.salon_id : salonsData[0].id;
        const amt = Number(p.amount) || 0;
        salesBreakdownBySalon[sId].plan_beauty += amt;
        salesBreakdownBySalon[sId].total += amt;
      });

      todayVisitsSalesRows.forEach(v => {
        const sId = salesBreakdownBySalon[v.salon_id] ? v.salon_id : salonsData[0].id;
        const amt = Number(v.amount) || 0;
        salesBreakdownBySalon[sId].generica += amt;
        salesBreakdownBySalon[sId].total += amt;
      });

      res.json({
        metrics: {
          todayVisits: todayVisits[0]?.count || 0,
          activeClients: activeClients[0]?.count || 0,
          monthlyRevenue: monthlyRevenue[0]?.total || 0,
          dailySales: totalDailySales
        },
        breakdowns: {
          salons: salonsData,
          visits: Object.values(visitsBreakdownBySalon),
          memberships: Object.values(membersBreakdownBySalon),
          dailySales: Object.values(salesBreakdownBySalon)
        },
        weeklyTraffic,
        recentVisits: recentVisits.map(v => ({
          ...v,
          servicios: typeof v.servicios === 'string' ? (v.servicios.startsWith('[') ? JSON.parse(v.servicios) : [v.servicios]) : (v.servicios || [])
        }))
      });
    } catch (err) {
      console.error('Error in /api/dashboard/summary:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // === 8-BAR WEEKLY & MONTHLY COMPARISON ===
  router.get('/weekly-billing-comparison', async (req, res) => {
    try {
      const now = new Date();
      // Monday of current week
      const currentDay = now.getDay(); // 0 is Sun, 1 is Mon...
      const diffToMonday = (currentDay === 0 ? -6 : 1) - currentDay;
      const mondayCurrent = new Date(now);
      mondayCurrent.setDate(now.getDate() + diffToMonday);
      mondayCurrent.setHours(0, 0, 0, 0);

      // Monday of previous week
      const mondayPrevious = new Date(mondayCurrent);
      mondayPrevious.setDate(mondayCurrent.getDate() - 7);

      // Sunday of current week
      const sundayCurrent = new Date(mondayCurrent);
      sundayCurrent.setDate(mondayCurrent.getDate() + 6);
      sundayCurrent.setHours(23, 59, 59, 999);

      // Month dates
      const year = now.getFullYear();
      const month = now.getMonth();
      const currentDayNum = now.getDate();

      const startCurrentMonth = new Date(year, month, 1, 0, 0, 0);
      const endCurrentMonth = new Date(year, month + 1, 0, 23, 59, 59);

      // Previous month (same day comparison: 1 to currentDayNum)
      const prevMonthDate = new Date(year, month - 1, 1);
      const prevYear = prevMonthDate.getFullYear();
      const prevMonth = prevMonthDate.getMonth();
      const startPrevMonth = new Date(prevYear, prevMonth, 1, 0, 0, 0);
      const endPrevMonthToDate = new Date(prevYear, prevMonth, Math.min(currentDayNum, new Date(prevYear, prevMonth + 1, 0).getDate()), 23, 59, 59);

      const earliestDate = startPrevMonth.toISOString().slice(0, 10);
      const latestDate = sundayCurrent.toISOString().slice(0, 10);

      // Query sales grouped by day
      const [salesRows] = await pool.query(`
        SELECT date, SUM(total) as total FROM (
          SELECT DATE(p.created_at) as date, SUM(p.amount) as total
          FROM payments p
          WHERE p.created_at >= ? AND p.created_at <= ? AND p.status = 'Aprobado'
          GROUP BY DATE(p.created_at)

          UNION ALL

          SELECT DATE(v.visited_at) as date, SUM(v.total) as total
          FROM visits v
          WHERE v.visited_at >= ? AND v.visited_at <= ? AND v.status = 'Facturado' AND v.total > 0
          GROUP BY DATE(v.visited_at)
        ) combined
        GROUP BY date
      `, [
        earliestDate + ' 00:00:00',
        latestDate + ' 23:59:59',
        earliestDate + ' 00:00:00',
        latestDate + ' 23:59:59'
      ]);

      const salesMap = {};
      salesRows.forEach(r => {
        const dStr = typeof r.date === 'string' ? r.date.split('T')[0] : new Date(r.date).toISOString().split('T')[0];
        salesMap[dStr] = (salesMap[dStr] || 0) + Number(r.total || 0);
      });

      const dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
      const monthNamesShort = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
      const monthNamesLong = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

      const days = [];
      for (let i = 0; i < 7; i++) {
        const curDate = new Date(mondayCurrent);
        curDate.setDate(mondayCurrent.getDate() + i);
        const curKey = curDate.toISOString().split('T')[0];

        const prevDate = new Date(mondayPrevious);
        prevDate.setDate(mondayPrevious.getDate() + i);
        const prevKey = prevDate.toISOString().split('T')[0];

        const currentAmount = salesMap[curKey] || 0;
        const previousAmount = salesMap[prevKey] || 0;

        let variation = 0;
        if (previousAmount > 0) {
          variation = ((currentAmount - previousAmount) / previousAmount) * 100;
        } else if (currentAmount > 0) {
          variation = 100;
        }

        const dayLabel = `${curDate.getDate()} ${monthNamesShort[curDate.getMonth()]}`;

        days.push({
          dayName: dayNames[i],
          dayLabel: dayLabel,
          date: curKey,
          currentAmount: currentAmount,
          previousAmount: previousAmount,
          variationPercent: Number(variation.toFixed(1)),
          isFuture: curDate > now
        });
      }

      // Month Calculations
      let currentMonthTotal = 0;
      let currentMonthToDateTotal = 0;
      let previousMonthToDateTotal = 0;

      Object.keys(salesMap).forEach(k => {
        const parts = k.split('-');
        if (parts.length === 3) {
          const y = Number(parts[0]);
          const m = Number(parts[1]) - 1;
          const d = Number(parts[2]);
          if (y === year && m === month) {
            currentMonthTotal += salesMap[k];
            if (d <= currentDayNum) {
              currentMonthToDateTotal += salesMap[k];
            }
          }
          if (y === prevYear && m === prevMonth && d <= currentDayNum) {
            previousMonthToDateTotal += salesMap[k];
          }
        }
      });

      let monthVariation = 0;
      if (previousMonthToDateTotal > 0) {
        monthVariation = ((currentMonthToDateTotal - previousMonthToDateTotal) / previousMonthToDateTotal) * 100;
      } else if (currentMonthToDateTotal > 0) {
        monthVariation = 100;
      }

      const monthBar = {
        title: 'Mes',
        subtitle: `${monthNamesLong[month]} ${year}`,
        total: currentMonthTotal,
        to_date_total: currentMonthToDateTotal,
        prev_to_date_total: previousMonthToDateTotal,
        variationPercent: Number(monthVariation.toFixed(1))
      };

      res.json({
        days,
        month: monthBar
      });
    } catch (err) {
      console.error('Error in weekly-billing-comparison:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // === PLAN USAGES ===
  router.get('/plan-usage', async (req, res) => {
    try {
      const [rows] = await pool.query(`
        SELECT 
            p.id AS plan_id,
            p.title AS plan_name,
            p.services AS plan_services,
            COUNT(DISTINCT v.client_id) AS unique_clients_used,
            COUNT(v.id) AS total_visits
        FROM visits v
        JOIN contracts c ON v.client_id = c.client_id
        JOIN plans p ON c.plan_id = p.id
        WHERE MONTH(v.visited_at) = MONTH(CURRENT_DATE())
          AND YEAR(v.visited_at) = YEAR(CURRENT_DATE())
        GROUP BY p.id, p.title, p.services
      `);

      const parsedRows = rows.map(r => ({
        ...r,
        plan_services: typeof r.plan_services === 'string' ? JSON.parse(r.plan_services) : r.plan_services
      }));

      res.json(parsedRows);
    } catch (err) {
      console.error('Error in /api/dashboard/plan-usage:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // === BILLING STATS ===
  router.get('/billing-stats', async (req, res) => {
    try {
      const [incomeRow] = await pool.query(`
        SELECT SUM(p.price) as total_estimated
        FROM contracts c
        JOIN plans p ON c.plan_id = p.id
        WHERE c.auto_billing_enabled = 1
      `);

      const [subRow] = await pool.query("SELECT COUNT(*) as active_count FROM contracts WHERE auto_billing_enabled = 1 AND status = 'Active'");
      
      const [pendingRetryRow] = await pool.query(`
        SELECT COUNT(*) as count, COALESCE(SUM(p.price), 0) as amount 
        FROM contracts c 
        JOIN plans p ON c.plan_id = p.id 
        WHERE c.status = 'Pending_Retry'
      `);

      const [lastAutoRow] = await pool.query(`
        SELECT created_at 
        FROM payments 
        WHERE method = 'CardNet_Auto' 
        ORDER BY created_at DESC 
        LIMIT 1
      `);

      const [recentPayments] = await pool.query(`
        SELECT 
          p.*, 
          c.nombre as client_name,
          c.telefono as client_phone,
          c.email as client_email,
          c.cedula as client_cedula,
          c.cardnet_customer_id
        FROM payments p
        LEFT JOIN clients c ON (p.client_id = c.id OR p.client_id = c.cedula)
        ORDER BY p.created_at DESC
        LIMIT 300
      `);

      const [approvedRow] = await pool.query("SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM payments WHERE status = 'Aprobado'");
      const [failedRow] = await pool.query("SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM payments WHERE status LIKE 'Fallido%' OR status = 'Rechazado'");

      const totalApprovedCount = approvedRow[0].count || 0;
      const totalFailedCount = failedRow[0].count || 0;
      const totalAttempts = totalApprovedCount + totalFailedCount;
      const successRate = totalAttempts > 0 ? ((totalApprovedCount / totalAttempts) * 100).toFixed(1) : '100.0';

      res.json({
        totalEstimated: incomeRow[0].total_estimated || 0,
        totalApproved: approvedRow[0].total || 0,
        totalApprovedCount,
        totalFailedCount,
        totalFailedAmount: failedRow[0].total || 0,
        totalPendingRetryCount: pendingRetryRow[0].count || 0,
        totalPendingRetryAmount: pendingRetryRow[0].amount || 0,
        successRate,
        activeSubscriptions: subRow[0].active_count || 0,
        lastAutoBilling: lastAutoRow[0]?.created_at || null,
        recentPayments
      });
    } catch (err) {
      console.error('Billing stats error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createDashboardRouter };
