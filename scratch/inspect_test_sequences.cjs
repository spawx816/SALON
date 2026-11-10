const path = require('path');
const dotenv = require(path.join(__dirname, '../backend/node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));

async function inspectSequences() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  try {
    const [seqs] = await pool.query('SELECT * FROM dgii_ncf_sequences');
    console.log('=== DGII NCF SEQUENCES ===');
    console.table(seqs);

    const [visitsWithSeq] = await pool.query(`
      SELECT id, client_name, total, metodo_pago, ncf, ncf_type, ncf_nota_credito, status, visited_at 
      FROM visits 
      WHERE (ncf >= 'E320000000215' AND ncf <= 'E320000000230')
         OR ncf_nota_credito LIKE 'E34%'
         OR id LIKE 'TEST-%'
    `);
    console.log('\n=== VISITS WITH TEST SEQUENCES / E34 ===');
    console.table(visitsWithSeq);

    // Check audit logs for any DGII transmission or actions
    const [auditLogs] = await pool.query(`
      SELECT * FROM audit_logs 
      WHERE entity_id LIKE 'TEST-%' 
         OR reason LIKE '%DGII%' 
         OR action LIKE '%DGII%'
         OR created_at >= NOW() - INTERVAL 2 HOUR
      ORDER BY id DESC LIMIT 20
    `);
    console.log('\n=== AUDIT LOGS RECENT ===');
    console.table(auditLogs);

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

inspectSequences();

