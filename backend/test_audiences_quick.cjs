const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

async function test() {
  let conn;
  try {
    conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      connectTimeout: 5000
    });
    console.log('Connected to MySQL!');

    const [contracts] = await conn.query('SELECT id, client_id, plan_id, status, signed_at, created_at FROM contracts');
    console.log(`Total contracts in DB: ${contracts.length}`);
    console.table(contracts);

    const [clients] = await conn.query('SELECT id, nombre, email, status, plan_id FROM clients');
    console.log(`Total clients in DB: ${clients.length}`);

    // Group clients by status and plan_id
    const statusMap = {};
    clients.forEach(c => {
      const key = `status: ${c.status} | plan_id: ${c.plan_id}`;
      statusMap[key] = (statusMap[key] || 0) + 1;
    });
    console.log('Distribución de clientes:');
    console.table(statusMap);

    const withEmail = clients.filter(c => c.email && c.email.trim() !== '');
    console.log(`Clientes con email: ${withEmail.length}`);

    // Check active contracts
    const activeContractClientIds = new Set(
      contracts
        .filter(c => ['Active', 'Activo', 'active'].includes(c.status))
        .map(c => String(c.client_id))
    );
    console.log('Client IDs con contrato activo:', Array.from(activeContractClientIds));

    // Clients with active plan vs no plan
    const clientsWithActivePlan = withEmail.filter(c => activeContractClientIds.has(String(c.id)) || (c.status === 'Activo' && c.plan_id));
    const clientsWithoutPlan = withEmail.filter(c => !activeContractClientIds.has(String(c.id)) && (!c.plan_id || c.status !== 'Activo'));

    console.log({
      totalWithEmail: withEmail.length,
      clientsWithActivePlanCount: clientsWithActivePlan.length,
      clientsWithoutPlanCount: clientsWithoutPlan.length
    });

  } catch (err) {
    console.error('Error:', err);
  } finally {
    if (conn) await conn.end();
  }
}

test();
