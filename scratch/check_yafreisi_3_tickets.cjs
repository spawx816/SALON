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

  const [rows] = await pool.query(`
    SELECT id, ticket_number, client_name, total, metodo_pago, status, ncf, ncf_type, visited_at, items_detail
    FROM visits 
    WHERE ticket_number IN ('VM-1414', 'VM-1413', 'VM-1412', 'VM-1408', 'VM-1407')
    ORDER BY id DESC
  `);
  console.log(rows);

  await pool.end();
})();

