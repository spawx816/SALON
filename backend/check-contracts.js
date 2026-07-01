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
    const [contracts] = await pool.query(`
      SELECT c.*, p.title as plan_name 
      FROM contracts c
      LEFT JOIN plans p ON c.plan_id = p.id
      WHERE c.client_id IN ('1780020977344', '1782654772948')
    `);
    console.log(JSON.stringify(contracts, null, 2));
  } catch (err) {
    console.error("Error executing query:", err);
  } finally {
    pool.end();
  }
}
run();
