const path = require('path');
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));
require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.join(__dirname, '../backend/.env') });

async function check() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'salon_pro'
  });
  const [cols] = await pool.query("SHOW COLUMNS FROM payments WHERE Field = 'id'");
  console.log(cols[0]);
  const [row] = await pool.query("SELECT id FROM payments LIMIT 1");
  console.log('Sample payment id:', row[0]);
  await pool.end();
}
check();

