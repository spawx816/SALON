const path = require('path');
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));
require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.join(__dirname, '../backend/.env') });

async function checkStatuses() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'salon_pro'
  });

  const [visitStatuses] = await pool.query('SELECT status, COUNT(*) as count FROM visits GROUP BY status');
  console.log('Visit statuses:', visitStatuses);

  const [paymentStatuses] = await pool.query('SELECT status, COUNT(*) as count FROM payments GROUP BY status');
  console.log('\nPayment statuses:', paymentStatuses);

  const [expenseStatuses] = await pool.query('SELECT status, COUNT(*) as count FROM expenses GROUP BY status');
  console.log('\nExpense statuses:', expenseStatuses);

  const [dgii606Statuses] = await pool.query('SELECT estado, COUNT(*) as count FROM dgii_606_purchases GROUP BY estado');
  console.log('\nDGII 606 statuses:', dgii606Statuses);

  await pool.end();
}

checkStatuses().catch(console.error);

