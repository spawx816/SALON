const mysql = require('mysql2/promise');
require('dotenv').config({ path: '../backend/.env' });

async function checkClient() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'salon_db',
    port: process.env.DB_PORT || 3306
  });

  console.log('=== CLIENT SEARCH: Elizabeth Hidalgo ===');
  const [clients] = await connection.query("SELECT * FROM clients WHERE nombre LIKE '%Elizabeth Hidalgo%'");
  console.log('Clients found:', clients);

  if (clients.length === 0) {
    const [allClients] = await connection.query("SELECT id, nombre, email, telefono FROM clients WHERE nombre LIKE '%Elizabeth%' OR nombre LIKE '%Hidalgo%'");
    console.log('Similar clients:', allClients);
    await connection.end();
    return;
  }

  for (const client of clients) {
    console.log(`\n--- CONTRACTS for ${client.nombre} (ID: ${client.id}) ---`);
    const [contracts] = await connection.query("SELECT * FROM contracts WHERE client_id = ?", [client.id]);
    console.log(contracts);

    console.log(`\n--- VISITS / TICKETS for ${client.nombre} (ID: ${client.id}) ---`);
    const [visits] = await connection.query("SELECT * FROM visits WHERE client_id = ? ORDER BY created_at DESC LIMIT 10", [client.id]);
    console.log(visits);

    console.log(`\n--- PAYMENTS for ${client.nombre} (ID: ${client.id}) ---`);
    const [payments] = await connection.query("SELECT * FROM payments WHERE client_id = ? ORDER BY created_at DESC LIMIT 10", [client.id]);
    console.log(payments);
  }

  await connection.end();
}

checkClient().catch(err => console.error(err));
