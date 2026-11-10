const path = require('path');
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));
require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.join(__dirname, '../backend/.env') });

async function inspectVisits() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'salon_pro'
  });

  const [cols] = await pool.query('DESCRIBE visits');
  console.log('Visits columns:\n', cols.map(c => `${c.Field} (${c.Type})`).join('\n'));

  const [sample] = await pool.query('SELECT * FROM visits ORDER BY id DESC LIMIT 2');
  console.log('\nSample visit:', JSON.stringify(sample[0], null, 2));

  await pool.end();
}

inspectVisits().catch(console.error);

