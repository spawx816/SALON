const { pool } = require('./db');

async function testQuery7() {
  const sql = `
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
    LEFT JOIN clients cl ON (v.client_id = cl.id::text OR v.client_name = cl.nombre) 
    LEFT JOIN contracts c ON (v.client_id = c.client_id AND c.status IN ('Active', 'Activo')) 
    WHERE ( 
      DATE(v.visited_at) = CURRENT_DATE 
      OR DATE(CONVERT_TZ(v.visited_at, '+00:00', '-04:00')) = DATE(CONVERT_TZ(NOW(), '+00:00', '-04:00')) 
    )
  `;
  try {
    const [r] = await pool.query(sql);
    console.log('✅ Query 7 with cl.id::text SUCCEEDED:', r.length);
  } catch (err) {
    console.error('❌ Query 7 error:', err);
  } finally {
    process.exit(0);
  }
}

testQuery7();
