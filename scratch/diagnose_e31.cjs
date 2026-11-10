const path = require('path');
require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));

async function checkAll() {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  const [rows] = await c.query("SELECT * FROM dgii_ncf_sequences");
  console.log('ALL ROWS IN dgii_ncf_sequences:');
  console.dir(rows, { depth: null });

  await c.end();
}

checkAll().catch(console.error);
