const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

async function checkRecentEmailLogs() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  const [logs] = await conn.query(`
    SELECT id, client_id, email_type, recipient_email, subject, sent_at 
    FROM email_logs 
    ORDER BY id DESC 
    LIMIT 120
  `);
  console.log(`Total logs recientes: ${logs.length}`);
  console.table(logs.slice(0, 20));

  // Count by subject & date
  const [grouped] = await conn.query(`
    SELECT subject, email_type, DATE(sent_at) as date, COUNT(*) as sent_count 
    FROM email_logs 
    GROUP BY subject, email_type, DATE(sent_at)
    ORDER BY date DESC
  `);
  console.log('\n--- Envíos agrupados ---');
  console.table(grouped);

  await conn.end();
}

checkRecentEmailLogs();
