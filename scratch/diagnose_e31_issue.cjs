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

  console.log('--- VISITS WITH 571 OR BRAVO ---');
  const [bravoVisits] = await pool.query("SELECT id, ticket_number, status, total, metodo_pago, ncf, ncf_type, rnc_cliente, rzn_soc_cliente, visited_at FROM visits WHERE ticket_number LIKE '%571%' OR client_name LIKE '%BRAVO%' OR rzn_soc_cliente LIKE '%BRAVO%' ORDER BY id DESC LIMIT 5");
  console.log(bravoVisits);

  console.log('--- RECENT AUDIT LOGS ---');
  const [auditLogs] = await pool.query("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 10");
  console.log(auditLogs);

  await pool.end();
})();
