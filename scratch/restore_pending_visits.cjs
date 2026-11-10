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

  const [res] = await pool.query(
    "UPDATE visits SET status = 'Pendiente' WHERE status = 'Procesando' AND ncf IS NULL"
  );
  console.log('Restored stuck visits to Pendiente, affected rows:', res.affectedRows);

  const [pending] = await pool.query("SELECT id, ticket_number, client_name, total, status, salon_id FROM visits WHERE status = 'Pendiente' ORDER BY id DESC LIMIT 10");
  console.log('Current pending visits:', pending);

  await pool.end();
})();

