const path = require('path');
const dotenv = require(path.join(__dirname, '../backend/node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));
const { createVisitsRouter } = require('../backend/routes/visits.routes');

async function testE31Checkout() {
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
  const testVisitId = `TEST_E31_${Date.now()}`;
  await pool.query(
    "INSERT INTO visits (id, ticket_number, client_id, client_name, total, status, visited_at) VALUES (?, 'TK-TEST-E31', 'INVITADO', 'EMPRESA TEST', 1500, 'Pendiente', NOW())",
    [testVisitId]
  );

  // Now let's simulate what POS sends:
  // Option 1: clientTaxId / rnc_cliente provided or not?
  // Let's test with RNC: 131917038, razon social: 'EMPRESA TEST SRL', ncf_type: 'E31'
  const reqBody = {
    id: testVisitId,
    total: 1500,
    monto_recibido: 1500,
    devuelta: 0,
    metodo_pago: 'Efectivo',
    items_detail: [{ nombre: 'Corte', precioAplicado: 1500, cantidad: 1 }],
    applied_payments: [{ method: 'Efectivo', amount: 1500 }],
    client_id: 'INVITADO',
    client_name: 'EMPRESA TEST',
    salon_id: 1,
    ncf_type: 'E31',
    rnc_cliente: '131917038',
    rzn_soc_cliente: 'EMPRESA TEST SRL'
  };

  const fakeReq = {
    params: { id: testVisitId },
    body: reqBody
  };

  let resCode = 200;
  let resJson = null;
  const fakeRes = {
    status(c) {
      resCode = c;
      return this;
    },
    json(j) {
      resJson = j;
      return this;
    }
  };

  console.log('--- CALLING handleCheckoutVisit with E31 ---');
  await visitsRouterObj.handleCheckoutVisit(fakeReq, fakeRes);
  console.log('Result Status Code:', resCode);
  console.log('Result JSON:', resJson);

  // Check the visit in DB
  const [vRows] = await pool.query('SELECT * FROM visits WHERE id = ?', [testVisitId]);
  console.log('Visit state in DB:', vRows[0]);

  // Clean up
  await pool.query('DELETE FROM visits WHERE id = ?', [testVisitId]);
  // Also if a sequence was consumed, we need to inspect it
  const [seqRows] = await pool.query("SELECT * FROM dgii_ncf_sequences WHERE tipo_comprobante = 'E31'");
  console.log('E31 sequence in DB now:', seqRows[0]);

  await pool.end();
}

testE31Checkout().catch(console.error);

