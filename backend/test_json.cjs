const { pool } = require('./db');

async function testJsonServicios() {
  const sql = `
    SELECT v.*, s.name as salon_name 
    FROM visits v 
    LEFT JOIN salons s ON v.salon_id = s.id 
    LEFT JOIN contracts c ON (v.client_id = c.client_id AND c.status IN ('Active', 'Activo'))
    WHERE (
      (v.client_id IS NOT NULL AND v.client_id != '' AND v.client_id != 'INVITADO' AND v.client_id != 'generico')
      AND (
        LOWER(COALESCE(v.metodo_pago, '')) LIKE '%plan%' 
        OR LOWER(COALESCE(v.servicios::text, '')) LIKE '%plan%' 
        OR (c.id IS NOT NULL AND (v.total = 0 OR LOWER(COALESCE(v.metodo_pago, '')) LIKE '%plan%'))
      )
    )
    ORDER BY v.visited_at DESC 
    LIMIT 10
  `;
  try {
    const [res] = await pool.query(sql);
    console.log('✅ Query with v.servicios::text SUCCEEDED:', res.length);
  } catch (err) {
    console.error('❌ Query error:', err.message);
  } finally {
    process.exit(0);
  }
}

testJsonServicios();
