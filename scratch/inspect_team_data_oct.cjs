const path = require('path');
const dotenv = require(path.join(__dirname, '../backend/node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));

async function checkBranches() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  const [salons] = await pool.query('SELECT * FROM salons');
  console.log('Salons:', salons);

  const [staffLocs] = await pool.query('SELECT DISTINCT salon_id, localidad FROM staff_records');
  console.log('Staff locs:', staffLocs);

  const [commLocs] = await pool.query('SELECT DISTINCT localidad FROM employee_commissions_log');
  console.log('Comm locs:', commLocs);

  const [payLocs] = await pool.query('SELECT DISTINCT sucursal FROM payroll_items');
  console.log('Payroll item sucursales:', payLocs);

  await pool.end();
}
checkBranches().catch(console.error);
