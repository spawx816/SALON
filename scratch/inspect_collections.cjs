const path = require('path');
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));
require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.join(__dirname, '../backend/.env') });

async function inspect() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'salon_pro'
  });

  const [tables] = await pool.query('SHOW TABLES');
  const tnames = tables.map(t => Object.values(t)[0]);
  console.log('Tables:', tnames.filter(t => /visit|pay|caja|mov|ingres/i.test(t)));

  const [vCols] = await pool.query('DESCRIBE visits');
  console.log('\nVisits cols:', vCols.map(c => c.Field).join(', '));

  const [pCols] = await pool.query('DESCRIBE payments');
  console.log('\nPayments cols:', pCols.map(c => c.Field).join(', '));

  // Check some recent rows in visits
  const [sampleVisits] = await pool.query('SELECT id, client_name, total, payment_method, status, visited_at FROM visits ORDER BY id DESC LIMIT 5');
  console.log('\nRecent visits:', sampleVisits);

  // Check some recent rows in payments
  const [samplePayments] = await pool.query('SELECT id, client_id, amount, method, status, created_at FROM payments ORDER BY id DESC LIMIT 5');
  console.log('\nRecent payments:', samplePayments);

  await pool.end();
}

inspect().catch(console.error);

