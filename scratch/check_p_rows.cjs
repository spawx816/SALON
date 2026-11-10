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

  const [pRows] = await pool.query('SELECT id, client_id, plan_id, amount, method, status, created_at, description FROM payments LIMIT 5');
  console.log('Payments rows:', pRows);

  // Check if any payment is linked to a visit
  const [pVisits] = await pool.query('SELECT COUNT(*) as cnt FROM payments WHERE description LIKE "%visit%" OR description LIKE "%Factura%"');
  console.log('Payments mentioning visit or Factura:', pVisits[0].cnt);

  // Check if any visit has payment_method = 'Membresía' or 'Plan Beauty'
  const [pbVisits] = await pool.query('SELECT metodo_pago, COUNT(*) as cnt, SUM(total) as total FROM visits GROUP BY metodo_pago');
  console.log('Visits by metodo_pago:', pbVisits);

  await pool.end();
}

main().catch(console.error);

