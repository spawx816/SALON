const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  try {
    await pool.query("UPDATE payments p JOIN clients c ON p.client_id = c.id SET p.salon_id = c.salon_id WHERE p.salon_id IS NULL AND (p.method = 'Efectivo/POS' OR p.method = 'Efectivo')");
    await pool.query("UPDATE payments SET applied_by = 'Sistema' WHERE applied_by IS NULL AND (method = 'Efectivo/POS' OR method = 'Efectivo')");
    console.log('Update done');
  } catch (e) {
    console.error(e);
  }
  process.exit(0);
}
run();
