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

  const [session] = await pool.query("SELECT * FROM cash_registers WHERE id = 219");
  console.log('Cash register 219:', session);

  const [moves] = await pool.query("SELECT * FROM cash_register_movements WHERE cash_register_id = 219");
  console.log('Movements in 219:', moves);

  const [visits] = await pool.query("SELECT id, client_name, ticket_number, total, metodo_pago, status, void_reason, cash_register_id, ncf FROM visits WHERE cash_register_id = 219");
  console.log('Visits in 219:', visits);

  await pool.end();
})();

