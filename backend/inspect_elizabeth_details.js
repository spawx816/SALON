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

  console.log('=== DETAILED CLIENT SEARCH: Elizabeth Hidalgo ===');
  const [clients] = await connection.query("SELECT id, nombre, email, telefono, created_at FROM clients WHERE nombre LIKE '%Elizabeth%' OR nombre LIKE '%Hidalgo%'");
  console.log(`Clients found: ${clients.length}`);

  for (const client of clients) {
    console.log(`\n==================================================`);
    console.log(`CLIENT: ${client.nombre} (ID: ${client.id}, Email: ${client.email}, Phone: ${client.telefono}, Created: ${client.created_at})`);
    
    console.log(`\n--- CONTRACTS ---`);
    const [contracts] = await connection.query("SELECT id, client_id, plan_id, status, last_billed_date, next_billing_date, contract_price, contract_services, contract_promo_services FROM contracts WHERE client_id = ?", [client.id]);
    console.log(contracts);

    console.log(`\n--- VISITS / TICKETS ---`);
    const [visits] = await connection.query("SELECT * FROM visits WHERE client_id = ? ORDER BY created_at DESC LIMIT 20", [client.id]);
    visits.forEach(v => {
      console.log(`Visit ID: ${v.id} | Ticket: ${v.ticket_number} | Total: RD$${v.total} | Status: ${v.status} | CreatedAt: ${v.created_at}`);
      console.log(`  Servicios: ${v.servicios}`);
      console.log(`  Items detail: ${v.items_detail}`);
    });

    console.log(`\n--- PAYMENTS ---`);
    const [payments] = await connection.query("SELECT * FROM payments WHERE client_id = ? ORDER BY created_at DESC LIMIT 20", [client.id]);
    console.log(payments);
  }

  await connection.end();
}

checkClient().catch(err => console.error(err));
