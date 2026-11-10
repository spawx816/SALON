const path = require('path');
const dotenv = require(path.join(__dirname, '../backend/node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));

async function setRatio() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });
  await conn.query('UPDATE company_ncf_counters SET cash_ratio = 5 WHERE id = 1');
  const [rows] = await conn.query('SELECT * FROM company_ncf_counters WHERE id = 1');
  console.log('company_ncf_counters:', rows[0]);
  await conn.end();
}
setRatio().catch(console.error);

