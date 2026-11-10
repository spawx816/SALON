const path = require('path');
const dotenv = require(path.join(__dirname, '../backend/node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));

async function inspectCountersTable() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });
  try {
    const [cols] = await conn.query('DESCRIBE company_ncf_counters');
    console.log('company_ncf_counters columns:', cols);

    const [rows] = await conn.query('SELECT * FROM company_ncf_counters');
    console.log('company_ncf_counters rows:', rows);

    // Let's count total visits in efectivo in the database (Facturado vs Anulado)
    const [cashVisitsStats] = await conn.query(`
      SELECT 
        status,
        COUNT(*) as total,
        SUM(CASE WHEN ncf IS NOT NULL AND ncf != 'NONE' THEN 1 ELSE 0 END) as con_ncf,
        SUM(CASE WHEN ncf IS NULL OR ncf = 'NONE' THEN 1 ELSE 0 END) as sin_ncf
      FROM visits
      WHERE (metodo_pago LIKE '%Efectivo%' OR metodo_pago LIKE '%Cash%')
      GROUP BY status
    `);
    console.log('Cash visits statistics by status:');
    console.table(cashVisitsStats);

    // Look at the last 8 cash visits that were Facturado
    const [lastCash] = await conn.query(`
      SELECT id, client_name, total, metodo_pago, ncf, ncf_type, ncf_name, status, visited_at
      FROM visits
      WHERE (metodo_pago = 'Efectivo' OR metodo_pago = 'CASH' OR metodo_pago = 'efectivo')
      ORDER BY visited_at DESC, id DESC
      LIMIT 8
    `);
    console.log('Last 8 pure cash visits:');
    console.table(lastCash);

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await conn.end();
  }
}
inspectCountersTable();
