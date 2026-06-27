const mysql = require('mysql2/promise');
require('dotenv').config();

async function check() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'salon_pro',
  });

  try {
    const [clients] = await pool.query("SELECT id, nombre, email, cardnet_customer_id FROM clients ORDER BY created_at DESC LIMIT 3");
    console.log("=== ULTIMOS CLIENTES ===");
    console.log(JSON.stringify(clients, null, 2));

    const [contracts] = await pool.query("SELECT id, client_id, plan_id, status, payment_profile_id, card_token, created_at FROM contracts ORDER BY created_at DESC LIMIT 3");
    console.log("\n=== ULTIMOS CONTRATOS ===");
    console.log(JSON.stringify(contracts, null, 2));
    
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
check();
