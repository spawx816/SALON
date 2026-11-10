const path = require('path');
require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));

async function check() {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  const [logs] = await c.query("SELECT * FROM audit_logs WHERE entity_type LIKE '%sequence%' OR entity_type LIKE '%ncf%' OR entity_type LIKE '%dgii%' ORDER BY id DESC LIMIT 10");
  console.log('Sequence audit logs:', logs);

  await c.end();
}

check().catch(console.error);
