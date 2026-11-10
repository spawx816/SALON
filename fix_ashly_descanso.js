const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

async function fix() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    timezone: '-04:00'
  });

  const [rows] = await pool.query("SELECT * FROM schedule_overrides WHERE employee_id IN (8, '8')");
  console.log('ASHLY OVERRIDES BEFORE:', rows);

  await pool.query("DELETE FROM schedule_overrides WHERE employee_id IN (8, '8') AND date = '2026-10-20'");
  
  const [rowsAfter] = await pool.query("SELECT * FROM schedule_overrides WHERE employee_id IN (8, '8')");
  console.log('ASHLY OVERRIDES AFTER:', rowsAfter);

  await pool.end();
}

fix().catch(console.error);
