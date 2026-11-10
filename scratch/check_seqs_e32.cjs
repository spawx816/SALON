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

  // Check dgii_ncf_sequences
  const [seqs] = await pool.query("SELECT * FROM dgii_ncf_sequences WHERE tipo_comprobante LIKE '%E32%'");
  console.log('dgii_ncf_sequences for E32:', seqs);

  // Check company_ncf_counters
  const [counters] = await pool.query("SELECT * FROM company_ncf_counters WHERE ncf_type LIKE '%E32%' OR ncf_type LIKE '%32%'");
  console.log('company_ncf_counters for E32:', counters);

  // Check ecf_sequences
  const [ecfSeqs] = await pool.query("SELECT * FROM ecf_sequences");
  console.log('ecf_sequences:', ecfSeqs);

  // Check all visits where ncf was E32...
  const [allE32Visits] = await pool.query("SELECT id, client_name, ticket_number, ncf, codigo_seguridad_ecf, total, visited_at, status FROM visits WHERE ncf LIKE 'E32%' ORDER BY visited_at DESC LIMIT 10");
  console.log('Latest E32 visits:', allE32Visits);

  await pool.end();
})();

