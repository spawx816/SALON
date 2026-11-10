const path = require('path');
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));
require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.join(__dirname, '../backend/.env') });

async function checkRows() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'salon_pro'
  });

  const [exp] = await pool.query('SELECT * FROM expenses');
  console.log('Expenses rows:', exp);

  const [pur] = await pool.query('SELECT * FROM dgii_606_purchases');
  console.log('\nDGII 606 purchases rows:', pur);

  await pool.end();
}

checkRows().catch(console.error);

