import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function checkCycleVisits() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'salon_db',
    port: process.env.DB_PORT || 3306
  });

  const clientId = '1782654772948';
  const [contract] = await connection.query("SELECT * FROM contracts WHERE client_id = ?", [clientId]);
  console.log('--- CONTRACT DETAILS ---');
  console.log(contract[0]);

  const [allVisits] = await connection.query("SELECT * FROM visits WHERE client_id = ? ORDER BY visited_at ASC", [clientId]);
  console.log(`\n--- ALL VISITS FOR ELIZABETH HIDALGO (${allVisits.length} total) ---`);
  allVisits.forEach((v, index) => {
    console.log(`${index + 1}. Date: ${v.visited_at.toISOString()} | Ticket: ${v.ticket_number || 'N/A'} | Servicios: ${JSON.stringify(v.servicios)} | Total: RD$${v.total}`);
  });

  await connection.end();
}

checkCycleVisits().catch(console.error);
