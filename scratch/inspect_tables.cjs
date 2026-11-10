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
  const tableNames = tables.map(t => Object.values(t)[0]);
  console.log('Relevant tables:', tableNames.filter(n => /exp|pay|dgii|gas|nom|sal/i.test(n)));

  for (const tbl of ['expenses', 'dgii_606_purchases', 'payroll_items', 'payroll_periods']) {
    if (tableNames.includes(tbl)) {
      const [cols] = await pool.query(`DESCRIBE ${tbl}`);
      console.log(`\nTable ${tbl} columns:`, cols.map(c => c.Field).join(', '));
    }
  }

  await pool.end();
}

inspect().catch(console.error);
