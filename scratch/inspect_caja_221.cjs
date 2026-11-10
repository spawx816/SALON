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

  const [cr] = await pool.query("SELECT * FROM cash_registers WHERE id = 221 OR register_number = 'CAJA-SD-20261103-3005'");
  console.log('Cash register 221:', cr[0]);

  const [moves] = await pool.query(
    'SELECT id, type, payment_method, amount, concept, visit_id, created_at FROM cash_register_movements WHERE cash_register_id = ? ORDER BY id ASC',
    [cr[0].id]
  );
  console.log('Total movements in Caja 221:', moves.length);
  console.table(moves);

  await pool.end();
})();

