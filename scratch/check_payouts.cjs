const path = require('path');
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));
require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.join(__dirname, '../backend/.env') });

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    database: process.env.DB_NAME,
    timezone: '-04:00'
  });

  const [cols] = await pool.query('DESCRIBE commission_payouts');
  console.log('commission_payouts cols:', cols.map(c => c.Field));

  const [payouts] = await pool.query('SELECT * FROM commission_payouts LIMIT 5');
  console.log('commission_payouts count:', payouts.length);
  console.log(payouts);

  await pool.end();
}

main().catch(console.error);

