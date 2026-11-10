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

  const [ecfInv] = await pool.query("SELECT * FROM ecf_invoices WHERE ncf = 'E320000000571' OR visit_id = '1793749809812'");
  console.log('ecf_invoices:', ecfInv);

  const [ecfLogs] = await pool.query("SELECT * FROM ecf_logs WHERE ncf = 'E320000000571' OR visit_id = '1793749809812' ORDER BY id DESC LIMIT 10");
  console.log('ecf_logs:', ecfLogs);

  const [audit] = await pool.query("SELECT * FROM audit_logs WHERE record_id = '1793749809812' OR details LIKE '%571%' ORDER BY id DESC LIMIT 10");
  console.log('audit_logs:', audit);

  await pool.end();
})();

