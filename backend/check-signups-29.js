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
    // Buscar clientes creados el día 29 de cualquier mes
    const [clients] = await pool.query(`
      SELECT id, nombre, email, created_at 
      FROM clients 
      WHERE DAY(created_at) = 29
    `);

    // Buscar contratos firmados o con fecha de cobro el día 29 de cualquier mes
    const [contracts] = await pool.query(`
      SELECT 
        c.id as contract_id,
        cl.nombre as client_name,
        p.title as plan_name,
        c.signed_at,
        c.next_billing_date,
        c.status
      FROM contracts c
      LEFT JOIN clients cl ON c.client_id = cl.id
      LEFT JOIN plans p ON c.plan_id = p.id
      WHERE DAY(c.signed_at) = 29 OR DAY(c.next_billing_date) = 29
    `);

    console.log(JSON.stringify({ clients, contracts }, null, 2));
  } catch (err) {
    console.error("Error executing query:", err);
  } finally {
    pool.end();
  }
}
run();
