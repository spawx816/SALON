const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });

  try {
    const [rows] = await pool.query(`
      SELECT 
        c.id as contract_id,
        cl.nombre as client_name,
        p.title as plan_name,
        p.price as plan_price,
        c.next_billing_date,
        c.status,
        c.auto_billing_enabled
      FROM contracts c
      LEFT JOIN clients cl ON c.client_id = cl.id
      LEFT JOIN plans p ON c.plan_id = p.id
      WHERE c.status IN ('Active', 'Activo')
      ORDER BY c.next_billing_date ASC
      LIMIT 50
    `);

    console.log(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error("Error executing query:", err);
  } finally {
    pool.end();
  }
}
run();
