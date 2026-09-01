import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function checkClient() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'salon_db',
    port: process.env.DB_PORT || 3306
  });

  console.log('=== CLIENT SEARCH: Elizabeth Hidalgo ===');
  const [clients] = await connection.query("SELECT * FROM clients WHERE nombre LIKE '%Elizabeth%' OR nombre LIKE '%Hidalgo%'");
  console.log(`Clients found: ${clients.length}`);

  for (const client of clients) {
    console.log(`\n==================================================`);
    console.log(`CLIENT: ${client.nombre} (ID: ${client.id}, Email: ${client.email}, Phone: ${client.telefono}, Plan ID: ${client.plan_id})`);
    
    console.log(`\n--- CONTRACTS ---`);
    const [contracts] = await connection.query("SELECT * FROM contracts WHERE client_id = ?", [client.id]);
    console.log(JSON.stringify(contracts, null, 2));

    console.log(`\n--- VISITS / TICKETS ---`);
    const [visits] = await connection.query("SELECT * FROM visits WHERE client_id = ? ORDER BY created_at DESC LIMIT 10", [client.id]);
    console.log(JSON.stringify(visits, null, 2));

    console.log(`\n--- PAYMENTS ---`);
    const [payments] = await connection.query("SELECT * FROM payments WHERE client_id = ? ORDER BY created_at DESC LIMIT 10", [client.id]);
    console.log(JSON.stringify(payments, null, 2));
  }

  await connection.end();
}

checkClient().catch(err => console.error(err));
