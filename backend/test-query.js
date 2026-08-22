const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function check() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'salon_pro',
  });

  try {
    const salon_id = '1';
    const start_date = '2026-08-01';
    const end_date = '2026-08-19';

    const hasSalon = salon_id && salon_id !== 'all';
    const salonVal = hasSalon ? parseInt(salon_id) : null;
    const hasDate = Boolean(start_date && end_date);

    const whereDatePayments = hasDate ? `AND p.created_at BETWEEN '${start_date} 00:00:00' AND '${end_date} 23:59:59'` : '';
    const whereSalonPayments = hasSalon ? `AND COALESCE(p.salon_id, c.salon_id) = ${salonVal}` : '';

    // 1. Daily Sales
    const [sales] = await pool.query(`
      SELECT DATE(p.created_at) as date, SUM(p.amount) as total 
      FROM payments p
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE p.status = 'Aprobado' ${whereSalonPayments} ${whereDatePayments}
      GROUP BY DATE(p.created_at) 
      ORDER BY date DESC ${hasDate ? '' : 'LIMIT 30'}
    `);
    console.log('1. Daily sales rows:', sales.length);

    // 2. Client Status Summary
    const [activeClients] = await pool.query(`
      SELECT COUNT(*) as count 
      FROM contracts ct
      LEFT JOIN clients c ON ct.client_id = c.id
      WHERE ct.status = 'Active' ${hasSalon ? `AND COALESCE(ct.salon_id, c.salon_id) = ${salonVal}` : ''}
    `);
    const [cancelledClients] = await pool.query(`
      SELECT COUNT(*) as count 
      FROM contracts ct
      LEFT JOIN clients c ON ct.client_id = c.id
      WHERE ct.status = 'Cancelled' ${hasSalon ? `AND COALESCE(ct.salon_id, c.salon_id) = ${salonVal}` : ''}
    `);
    console.log('2. Clients summary:', { active: activeClients[0].count, cancelled: cancelledClients[0].count });

    // 3. Inactive Clients
    const [inactive] = await pool.query(`
      SELECT cl.id, cl.nombre, cl.telefono, MAX(v.visited_at) as last_visit
      FROM clients cl
      JOIN contracts c ON cl.id = c.client_id
      LEFT JOIN visits v ON cl.id = v.client_id
      WHERE c.status = 'Active' ${hasSalon ? `AND COALESCE(c.salon_id, cl.salon_id) = ${salonVal}` : ''}
      GROUP BY cl.id, cl.nombre, cl.telefono
      HAVING last_visit < DATE_SUB(NOW(), INTERVAL 15 DAY) OR last_visit IS NULL
      ORDER BY last_visit ASC
    `);
    console.log('3. Inactive clients rows:', inactive.length);

    // 4. Payment Breakdown
    const [payments] = await pool.query(`
      SELECT p.method, SUM(p.amount) as total, COUNT(*) as count
      FROM payments p
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE p.status = 'Aprobado' ${whereSalonPayments} ${whereDatePayments}
      GROUP BY p.method
    `);
    console.log('4. Payment breakdown:', payments);

    // 5. Visit Frequency
    const [frequency] = await pool.query(`
      SELECT visit_count, COUNT(*) as client_count FROM (
        SELECT v.client_id, COUNT(*) as visit_count 
        FROM visits v
        LEFT JOIN clients c ON v.client_id = c.id
        WHERE 1=1
          ${hasSalon ? `AND COALESCE(v.salon_id, c.salon_id) = ${salonVal}` : ''}
          ${hasDate ? `AND v.visited_at BETWEEN '${start_date} 00:00:00' AND '${end_date} 23:59:59'` : ''}
        GROUP BY v.client_id
      ) as t
      GROUP BY visit_count
      ORDER BY visit_count ASC
    `);
    console.log('5. Visit frequency:', frequency);

    // 6. Renewal Revenue
    const [renewalRevenue] = await pool.query(`
      SELECT SUM(p.amount) as total
      FROM payments p
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE p.status = 'Aprobado' 
        AND p.plan_id IS NOT NULL 
        AND p.plan_id != 'gift_card'
        ${whereSalonPayments}
        ${whereDatePayments}
    `);
    console.log('6. Renewal revenue:', renewalRevenue[0].total);

    // 7. Cash Payments
    const [cashPayments] = await pool.query(`
      SELECT p.id, p.amount, p.created_at, p.applied_by, p.method,
             c.nombre as client_name, s.name as salon_name
      FROM payments p
      LEFT JOIN clients c ON p.client_id = c.id
      LEFT JOIN salons s ON COALESCE(p.salon_id, c.salon_id) = s.id
      WHERE p.status = 'Aprobado' AND (p.method = 'Efectivo/POS' OR p.method = 'Efectivo')
        ${whereSalonPayments}
        ${whereDatePayments}
      ORDER BY p.created_at DESC
      LIMIT 100
    `);
    console.log('7. Cash payments rows:', cashPayments.length);

    console.log('\n--- ALL ANALYTICS QUERIES PASSED PERFECTLY! ---');
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await pool.end();
  }
}
check();
