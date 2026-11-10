const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../db');

async function inspectAmbiguities() {
  console.log('=== INSPECCIÓN TÉCNICA DE LAS 7 FILAS AMBIGUAS ===\n');

  // 1. salons ID 1
  const [s1] = await pool.query('SELECT * FROM salons WHERE id = \'1\'');
  console.log('--- 1. salons id = "1" ---');
  console.log(JSON.stringify(s1[0], null, 2));

  // 2. salons UUID 7f546f61-6410-4002-8198-bce72379d9f9
  const [s2] = await pool.query('SELECT * FROM salons WHERE id = \'7f546f61-6410-4002-8198-bce72379d9f9\'');
  console.log('\n--- 2. salons id = "7f546f61-6410-4002-8198-bce72379d9f9" ---');
  console.log(JSON.stringify(s2[0], null, 2));

  // Ver sucursal correspondiente
  const [b2] = await pool.query('SELECT * FROM branches WHERE id::text = \'7f546f61-6410-4002-8198-bce72379d9f9\'');
  console.log('Branch matching s2:', JSON.stringify(b2[0], null, 2));

  // 3. cash_registers d39c296c-9a2d-43ac-9204-c56ee1a0c33e
  const [cr] = await pool.query('SELECT * FROM cash_registers WHERE id::text = \'d39c296c-9a2d-43ac-9204-c56ee1a0c33e\'');
  console.log('\n--- 3. cash_registers id = "d39c296c-9a2d-43ac-9204-c56ee1a0c33e" ---');
  console.log(JSON.stringify(cr[0], null, 2));

  // 4. visits 1791819025880
  const [v] = await pool.query('SELECT * FROM visits WHERE id::text = \'1791819025880\'');
  console.log('\n--- 4. visits id = "1791819025880" ---');
  console.log(JSON.stringify(v[0], null, 2));

  // 5, 6, 7. ticket_sequences 1, 3, 4
  const [ts] = await pool.query('SELECT * FROM ticket_sequences WHERE salon_id::text IN (\'1\', \'3\', \'4\')');
  console.log('\n--- 5, 6, 7. ticket_sequences id IN (1, 3, 4) ---');
  console.log(JSON.stringify(ts, null, 2));

  // List existing tenants
  const [tenants] = await pool.query('SELECT id, business_name, slug FROM tenants');
  console.log('\n--- Tenants existentes ---');
  console.log(JSON.stringify(tenants, null, 2));

  process.exit(0);
}

inspectAmbiguities().catch(err => {
  console.error(err);
  process.exit(1);
});

