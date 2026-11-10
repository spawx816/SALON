const path = require('path');
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));
require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.join(__dirname, '../backend/.env') });

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    database: process.env.DB_NAME,
    timezone: '-04:00'
  });

  const [statuses] = await pool.query('SELECT status, COUNT(*) as cnt FROM payroll_periods GROUP BY status');
  console.log('Payroll period statuses:', statuses);

  const [allPeriods] = await pool.query('SELECT id, period_name, status, approved_at FROM payroll_periods');
  console.log('All periods:', allPeriods);

  await pool.end();
}

main().catch(console.error);

