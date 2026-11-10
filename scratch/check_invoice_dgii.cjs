const path = require('path');
require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));

async function inspect() {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  const [rows] = await c.query(
    "SELECT id, ticket_number, ncf, salon_id, status, total, metodo_pago, visited_at FROM visits WHERE ncf = 'E320000000571' OR ncf LIKE '%571%' OR ticket_number LIKE '%571%'"
  );
  console.log('Found visits:', JSON.stringify(rows, null, 2));
  const [v3] = await c.query("SELECT * FROM visits WHERE id = '1793749809812'");
  console.log('Visit 3 complete:', JSON.stringify(v3[0], null, 2));

  // Also check dgii_transmissions or audit_logs or dgii logs
  const [tables] = await c.query("SHOW TABLES LIKE '%dgii%'");
  console.log('DGII tables:', tables);

  const [audit] = await c.query("SELECT * FROM audit_logs WHERE metadata LIKE '%571%' OR reason LIKE '%571%' OR entity_id LIKE '%571%'");
  console.log('Audit logs with 571:', audit);

  await c.end();
}

inspect().catch(console.error);
