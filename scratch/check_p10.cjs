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

  const [p10] = await pool.query('SELECT id, period_name, start_date, end_date, status, total_neto, approved_at FROM payroll_periods WHERE id = 10');
  console.log('Period 10:', p10);

  await pool.end();
}

main().catch(console.error);

