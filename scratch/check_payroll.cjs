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

  const [cols] = await pool.query('DESCRIBE payroll_periods');
  console.log('payroll_periods cols:', cols.map(c => c.Field));

  const [periods] = await pool.query('SELECT * FROM payroll_periods');
  console.log('All payroll periods in DB:', periods);

  await pool.end();
}

main().catch(console.error);

