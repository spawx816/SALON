const path = require('path');
require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));

async function checkIncidents() {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  const [audits] = await c.query("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 20");
  console.log('Recent audit logs:');
  console.dir(audits, { depth: null });

  const [e31Visits] = await c.query("SELECT * FROM visits WHERE ncf_type = 'E31' OR ncf LIKE 'E31%' ORDER BY id DESC LIMIT 10");
  console.log('\nVisits with E31:');
  console.dir(e31Visits, { depth: null });

  await c.end();
}

checkIncidents().catch(console.error);

