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

  const [colsInv] = await pool.query("DESCRIBE ecf_invoices");
  console.log('ecf_invoices columns:', colsInv.map(c => c.Field));

  const [colsLogs] = await pool.query("DESCRIBE ecf_logs");
  console.log('ecf_logs columns:', colsLogs.map(c => c.Field));

  const [recentInv] = await pool.query("SELECT * FROM ecf_invoices ORDER BY id DESC LIMIT 5");
  console.log('recent ecf_invoices:', recentInv);

  await pool.end();
})();

