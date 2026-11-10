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

  const [testVisits] = await pool.query(
    "SELECT id, ticket_number, client_name, total, status, cash_register_id, salon_id FROM visits WHERE cash_register_id = 221 OR id LIKE 'TEST%' OR client_name LIKE '%Prueba%' OR client_name LIKE '%Test%'"
  );
  console.log('Visits found:', testVisits.length);
  console.table(testVisits);

  await pool.end();
})();

