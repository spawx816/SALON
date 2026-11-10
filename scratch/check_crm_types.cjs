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

  const [types] = await pool.query('SELECT type, COUNT(*) as cnt, SUM(amount) as total FROM cash_register_movements GROUP BY type');
  console.log('CRM Types:', types);

  // Check if there are refunds / devoluciones
  const [refunds] = await pool.query('SELECT * FROM cash_register_movements WHERE type LIKE "%devolu%" OR type LIKE "%egreso%" OR type LIKE "%reembolso%" LIMIT 5');
  console.log('Sample refunds/egresos in CRM:', refunds);

  // Check if visits has payments linked to payments table!
  const [linkedPayments] = await pool.query('SELECT * FROM payments WHERE gateway_ref IN (SELECT id FROM visits LIMIT 100) OR description LIKE "%visita%" OR description LIKE "%Factura%" LIMIT 5');
  console.log('Linked payments in payments table:', linkedPayments);

  // Check what payments table contains
  const [samplePayments] = await pool.query('SELECT id, client_id, plan_id, amount, method, status, created_at, gateway_ref, description FROM payments LIMIT 5');
  console.log('Sample payments in payments table:', samplePayments);

  await pool.end();
}

main().catch(console.error);

