const path = require('path');
const dotenv = require(path.join(__dirname, '../backend/node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));
const { createVisitsRouter } = require('../backend/routes/visits.routes');

async function testAssignDryRun() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5
  });

  const mockDeps = {
    transmitInvoiceDirectlyToDgii: async () => true,
    generateAndTransmitNotaCredito: async () => 'E340000000099',
    sendSurveyEmail: async () => true
  };

  const visitsRouterObj = createVisitsRouter(pool, mockDeps);

  // Let's create an isolated synthetic visit with status 'Pendiente'
  const testVisitId = `DRY_TEST_${Date.now()}`;
  await pool.query(
    "INSERT INTO visits (id, ticket_number, client_id, client_name, total, status, visited_at) VALUES (?, 'TK-DRY-TEST', 'INVITADO', 'TEST CLIENT', 500, 'Pendiente', NOW())",
    [testVisitId]
  );

  console.log('Testing assignDgiiSequenceToVisit on visit', testVisitId);
  try {
    // We will call assignDgiiSequenceToVisit for E31
    // BUT we wrap in a connection or let it run, and then inspect what happened:
    const res = await visitsRouterObj.assignDgiiSequenceToVisit(
      testVisitId,
      'E31',
      '131917038',
      'EMPRESA PRUEBA SRL',
      500,
      'Efectivo'
    );
    console.log('assignDgiiSequenceToVisit RESULT:', res);
  } catch (e) {
    console.log('assignDgiiSequenceToVisit EXCEPTION:', e);
  } finally {
    await pool.query('DELETE FROM visits WHERE id = ?', [testVisitId]);
    await pool.end();
  }
}

testAssignDryRun().catch(console.error);

