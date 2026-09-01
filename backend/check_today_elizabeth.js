import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function checkTodayVisit() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'salon_db',
    port: process.env.DB_PORT || 3306
  });

  const clientId = '1782654772948';
  console.log('=== CHECKING TODAY VISITS (2026-08-30) FOR ELIZABETH HIDALGO ===');

  const [todayVisits] = await connection.query(
    "SELECT * FROM visits WHERE (client_id = ? OR client_name LIKE '%Elizabeth Hidalgo%') AND visited_at >= '2026-08-30 00:00:00'",
    [clientId]
  );

  console.log('Visits today (2026-08-30):', todayVisits);

  const [latestVisits] = await connection.query(
    "SELECT * FROM visits WHERE client_id = ? OR client_name LIKE '%Elizabeth Hidalgo%' ORDER BY visited_at DESC LIMIT 5",
    [clientId]
  );

  console.log('\nLatest 5 visits recorded for Elizabeth Hidalgo:');
  latestVisits.forEach(v => {
    console.log(`ID: ${v.id} | Ticket: ${v.ticket_number} | VisitedAt: ${v.visited_at} | Status: ${v.status} | Total: RD$${v.total} | Servicios: ${v.servicios}`);
  });

  await connection.end();
}

checkTodayVisit().catch(console.error);
