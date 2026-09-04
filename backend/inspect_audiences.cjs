const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

async function inspectMarketingAudiences() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  console.log('--- 1. Contratos existentes en DB ---');
  const [contracts] = await pool.query('SELECT * FROM contracts');
  console.log(`Total contratos: ${contracts.length}`);
  console.table(contracts);

  console.log('\n--- 2. Estructura de clients ---');
  const [clientCols] = await pool.query('DESCRIBE clients');
  console.log(clientCols.map(c => `${c.Field} (${c.Type})`));

  console.log('\n--- 3. Muestra de clientes ---');
  const [clients] = await pool.query('SELECT id, nombre, email, status, plan_id FROM clients LIMIT 25');
  console.table(clients);

  console.log('\n--- 4. Muestra de status en clients ---');
  const [statusCounts] = await pool.query('SELECT status, COUNT(*) as cnt FROM clients GROUP BY status');
  console.table(statusCounts);

  console.log('\n--- 5. Cruce de Contratos y Clientes ---');
  const [crossCheck] = await pool.query(`
    SELECT ct.id as contract_id, ct.client_id, ct.status as contract_status, ct.plan_id,
           c.id as found_client_id, c.nombre as client_name, c.email as client_email, c.status as client_status
    FROM contracts ct
    LEFT JOIN clients c ON ct.client_id = c.id
  `);
  console.table(crossCheck);

  console.log('\n--- 6. ¿Cómo determina el sistema general si un cliente tiene plan activo? ---');
  const [activeContracts] = await pool.query(`SELECT DISTINCT client_id FROM contracts WHERE status IN ('Active', 'Activo')`);
  console.log('client_id con contratos Active/Activo:', activeContracts.map(c => c.client_id));

  // Let's check how many clients match no_plan vs active_plan
  const [allCount] = await pool.query('SELECT COUNT(*) as c FROM clients WHERE email IS NOT NULL AND email != ""');
  const [noPlanCount] = await pool.query(`SELECT COUNT(*) as c FROM clients WHERE email IS NOT NULL AND email != "" AND id NOT IN (SELECT DISTINCT client_id FROM contracts WHERE status IN ('Active', 'Activo'))`);
  const [activePlanCount] = await pool.query(`SELECT COUNT(*) as c FROM clients WHERE email IS NOT NULL AND email != "" AND id IN (SELECT DISTINCT client_id FROM contracts WHERE status IN ('Active', 'Activo'))`);
  console.log({
    totalWithEmail: allCount[0].c,
    noPlanCount: noPlanCount[0].c,
    activePlanCount: activePlanCount[0].c
  });

  await pool.end();
}

inspectMarketingAudiences();
