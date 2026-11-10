const path = require('path');
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));
require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.join(__dirname, '../backend/.env') });

async function inspectConcepts() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'salon_pro'
  });

  const [concepts] = await pool.query('SELECT * FROM expense_concepts');
  console.log('Expense concepts:', concepts);

  const [recentExp] = await pool.query('SELECT id, concept_name, amount, payment_date, status FROM expenses ORDER BY id DESC LIMIT 10');
  console.log('Recent expenses:', recentExp);

  await pool.end();
}

inspectConcepts().catch(console.error);

