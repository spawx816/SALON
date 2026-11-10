const { pool } = require('./db');

async function testDashboardQueries() {
  console.log('🧪 Probando queries de dashboard.routes.js...');
  
  // Test query 1
  try {
    const [r1] = await pool.query('SELECT COUNT(*) as count FROM visits WHERE DATE(visited_at) = CURRENT_DATE()');
    console.log('✅ Query 1 (Visitas de hoy):', r1);
  } catch (err) {
    console.error('❌ Query 1 error:', err.message);
  }

  // Test query 2
  try {
    const [r2] = await pool.query('SELECT COUNT(DISTINCT client_id) as count FROM contracts WHERE status IN ("Active", "Activo")');
    console.log('✅ Query 2 (Clientes activos contratos):', r2);
  } catch (err) {
    console.error('❌ Query 2 error:', err.message);
  }

  // Test query 3
  try {
    const [r3] = await pool.query(`
      SELECT COALESCE(SUM(c.effective_price), 0) as total 
      FROM (
        SELECT c.client_id, MAX(COALESCE(c.contract_price, p.price)) as effective_price
        FROM contracts c 
        JOIN plans p ON c.plan_id = p.id 
        WHERE c.status IN ('Active', 'Activo')
        GROUP BY c.client_id
      ) c
    `);
    console.log('✅ Query 3 (Ingresos mensuales):', r3);
  } catch (err) {
    console.error('❌ Query 3 error:', err.message);
  }

  // Test query 4
  try {
    const [r4] = await pool.query(`
      SELECT SUM(amount) as total
      FROM payments
      WHERE DATE(created_at) = CURRENT_DATE() AND status = 'Aprobado'
    `);
    console.log('✅ Query 4 (Pagos hoy):', r4);
  } catch (err) {
    console.error('❌ Query 4 error:', err.message);
  }

  // Test query 5
  try {
    const [r5] = await pool.query(`
      SELECT SUM(total) as total
      FROM visits
      WHERE DATE(visited_at) = CURRENT_DATE() AND status = 'Facturado' AND total > 0
    `);
    console.log('✅ Query 5 (Ventas POS hoy):', r5);
  } catch (err) {
    console.error('❌ Query 5 error:', err.message);
  }

  // Test query 6
  try {
    const [r6] = await pool.query(`
      SELECT DATE(visited_at) as date, COUNT(*) as count 
      FROM visits 
      WHERE visited_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
      GROUP BY DATE(visited_at)
      ORDER BY DATE(visited_at) ASC
    `);
    console.log('✅ Query 6 (Tráfico semanal):', r6);
  } catch (err) {
    console.error('❌ Query 6 error:', err.message);
  }

  // Test query 7
  try {
    const [r7] = await pool.query(`
      SELECT 
        v.id, 
        COALESCE(v.salon_id, cl.salon_id, 1) as salon_id, 
        v.total, 
        v.metodo_pago, 
        v.servicios, 
        v.client_id, 
        c.id as contract_id, 
        c.status as contract_status, 
        c.plan_id as contract_plan_id 
      FROM visits v 
      LEFT JOIN clients cl ON (v.client_id = cl.id OR v.client_name = cl.nombre) 
      LEFT JOIN contracts c ON (v.client_id = c.client_id AND c.status IN ('Active', 'Activo')) 
      WHERE ( 
        DATE(v.visited_at) = CURRENT_DATE() 
        OR DATE(CONVERT_TZ(v.visited_at, '+00:00', '-04:00')) = DATE(CONVERT_TZ(NOW(), '+00:00', '-04:00')) 
      )
    `);
    console.log('✅ Query 7 (Visitas hoy breakdown):', r7.length);
  } catch (err) {
    console.error('❌ Query 7 error:', err.message);
  }

  process.exit(0);
}

testDashboardQueries();
