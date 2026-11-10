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

  console.log('--- RECENT VISITS (LAST 15) ---');
  const [visits] = await pool.query(`
    SELECT id, ticket_number, client_id, client_name, total, metodo_pago, status, 
           ncf, ncf_type, rnc_cliente, rzn_soc_cliente, visited_at, salon_id, cash_register_id
    FROM visits 
    ORDER BY id DESC 
    LIMIT 15
  `);
  console.log(JSON.stringify(visits, null, 2));

  console.log('\n--- ACTIVE CASH REGISTERS ---');
  const [registers] = await pool.query('SELECT * FROM cash_registers ORDER BY id DESC LIMIT 5');
  console.log(JSON.stringify(registers, null, 2));

  await pool.end();
})();

