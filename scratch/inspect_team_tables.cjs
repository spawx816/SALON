const path = require('path');
const dotenv = require(path.join(__dirname, '../backend/node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));

async function inspect() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  for (const tName of ['attendance', 'employee_commissions_log', 'commission_payouts']) {
    try {
      const [cols] = await pool.query(`DESCRIBE ${tName}`);
      console.log(`\n=== ${tName} ===`);
      console.log(cols.map(c => `${c.Field} (${c.Type})`).join(', '));
      const [sample] = await pool.query(`SELECT * FROM ${tName} ORDER BY 1 DESC LIMIT 2`);
      console.log('Sample:', JSON.stringify(sample, null, 2));
    } catch (e) {
      console.log(tName, e.message);
    }
  }

  await pool.end();
}
inspect().catch(console.error);
