const path = require('path');
const mysql = require(path.join(__dirname, '..', 'backend', 'node_modules', 'mysql2', 'promise'));
const fs = require('fs');

const envPath = path.join(__dirname, '..', 'backend', '.env');
const env = fs.readFileSync(envPath, 'utf8').split('\n').reduce((acc, line) => {
  const [k, ...v] = line.trim().split('=');
  if (k && v.length) acc[k] = v.join('=');
  return acc;
}, {});

(async () => {
  const pool = mysql.createPool({
    host: env.DB_HOST,
    user: env.DB_USER,
    password: env.DB_PASSWORD || env.DB_PASS,
    database: env.DB_NAME,
    timezone: '-04:00'
  });

  const [expCols] = await pool.query('DESCRIBE expenses');
  console.log('expenses columns:', expCols.map(c => c.Field));

  const [sampleExp] = await pool.query('SELECT * FROM expenses ORDER BY id DESC LIMIT 5');
  console.log('sample expenses:', sampleExp);

  const [payrollCols] = await pool.query('DESCRIBE payroll_items');
  console.log('payroll_items columns:', payrollCols.map(c => c.Field));

  const [dgii606Cols] = await pool.query('DESCRIBE dgii_606_purchases');
  console.log('dgii_606_purchases columns:', dgii606Cols.map(c => c.Field));

  const [concepts] = await pool.query('SELECT DISTINCT concepto, categoria FROM expenses LIMIT 20');
  console.log('expenses concepts/categories:', concepts);

  await pool.end();
})();

