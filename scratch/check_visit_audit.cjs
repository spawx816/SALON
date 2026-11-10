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

  const [rows] = await pool.query("SELECT id, ticket_number, total, ncf, codigo_seguridad_ecf, qr_code_url, visited_at FROM visits WHERE id = '1793749809812'");
  console.log('Visit 1793749809812:', rows[0]);

  // Check audit logs
  const [audit] = await pool.query("SELECT * FROM audit_logs WHERE entity_id = '1793749809812' OR metadata LIKE '%1793749809812%' OR metadata LIKE '%0571%'");
  console.log('Audit logs:', audit);

  await pool.end();
})();
