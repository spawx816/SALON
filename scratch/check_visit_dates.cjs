const path = require('path');
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));
const dotenv = require(path.join(__dirname, '../backend/node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '../backend/.env') });

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    database: process.env.DB_NAME,
    timezone: '-04:00'
  });

  const [rows] = await pool.query(`
    SELECT id, visited_at, total, metodo_pago, status, draft_data, items_detail
    FROM visits
    WHERE visited_at >= '2026-10-01 00:00:00' AND visited_at <= '2026-10-02 23:59:59'
    LIMIT 3
  `);
  console.log('Sample visits:');
  rows.forEach(r => {
    console.log({
      id: r.id,
      visited_at: r.visited_at,
      total: r.total,
      metodo_pago: r.metodo_pago,
      status: r.status,
      items_detail: r.items_detail ? r.items_detail.substring(0, 100) : null
    });
  });

  // Check if there are other date fields in visits
  const [cols] = await pool.query('DESCRIBE visits');
  const dateCols = cols.filter(c => c.Type.includes('date') || c.Type.includes('time'));
  console.log('Date/time cols in visits:', dateCols);

  // Check payments table date cols
  const [payCols] = await pool.query('DESCRIBE payments');
  const payDateCols = payCols.filter(c => c.Type.includes('date') || c.Type.includes('time'));
  console.log('Date/time cols in payments:', payDateCols);

  // Check cash_register_movements
  const [crmCols] = await pool.query('DESCRIBE cash_register_movements');
  console.log('cash_register_movements cols:', crmCols.map(c => c.Field));

  await pool.end();
}

main().catch(console.error);

