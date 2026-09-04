const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

async function check() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  const [contracts] = await conn.query('SELECT id, client_id, plan_id, status, signed_at FROM contracts');
  console.log('--- CONTRATOS REGISTRADOS ---');
  console.table(contracts);

  const [clients] = await conn.query('SELECT id, nombre, email, status, plan_id FROM clients WHERE email IS NOT NULL AND email != ""');
  console.log(`Total clients con email: ${clients.length}`);

  // Test the current SQL filter for no_plan:
  // " AND c.id NOT IN (SELECT DISTINCT client_id FROM contracts WHERE status IN ('Active', 'Activo'))"
  const [testNoPlan] = await conn.query(`
    SELECT c.id, c.nombre, c.email, c.status, c.plan_id 
    FROM clients c 
    WHERE c.email IS NOT NULL AND c.email != '' 
      AND c.id NOT IN (SELECT DISTINCT client_id FROM contracts WHERE status IN ('Active', 'Activo'))
  `);
  console.log(`\nClientes devueltos con query 'no_plan' actual: ${testNoPlan.length} de ${clients.length}`);

  // Check what client_ids are in contracts WHERE status in ('Active', 'Activo')
  const [activeContractIds] = await conn.query(`SELECT DISTINCT client_id, status FROM contracts`);
  console.log('\nTodos los client_id y status en contracts:', activeContractIds);

  // Check how clients table records plans
  const [clientsWithPlanCol] = await conn.query(`SELECT id, nombre, email, status, plan_id FROM clients WHERE plan_id IS NOT NULL OR status = 'Activo'`);
  console.log('\nClientes con plan_id o status="Activo" en tabla clients:', clientsWithPlanCol);

  await conn.end();
}

check();
