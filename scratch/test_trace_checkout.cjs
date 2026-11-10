const path = require('path');
const dotenv = require(path.join(__dirname, '../backend/node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));
const { createVisitsRouter } = require('../backend/routes/visits.routes');

async function testTraceCheckout() {
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

  // Case A: What if the cashier selects E31, but RNC is empty or invalid?
  // Case B: What if cashier enters RNC 131917038 and Razon Social "Bravo SA"?
  // Case C: What if cashier enters RNC 131917038 and Razon Social is empty?
  // Case D: What if cashier enters Cedula receptor?

  console.log('--- Testing Case A: isCreditoFiscal without RNC ---');
  // In frontend: line 3144: if (isCreditoFiscal && !clientRncInput.trim()) alerts and returns.

  // Case B: cashier sends ncf_type: 'E31', rnc_cliente: '131917038', rzn_soc_cliente: 'SUPERMERCADOS BRAVO SA'
  const testId = `TRACE_${Date.now()}`;
  await pool.query(
    "INSERT INTO visits (id, ticket_number, client_id, client_name, total, status, visited_at) VALUES (?, 'TK-TRACE', 'INVITADO', 'BRAVO SA', 1000, 'Pendiente', NOW())",
    [testId]
  );

  let resCode = null;
  let resData = null;
  const res = {
    status(c) { resCode = c; return this; },
    json(d) { resData = d; return this; }
  };

  const req = {
    params: { id: testId },
    body: {
      total: 1000,
      metodo_pago: 'Efectivo',
      items_detail: [{ nombre: 'Corte', precioAplicado: 1000, cantidad: 1 }],
      ncf_type: 'E31',
      rnc_cliente: '131917038',
      rzn_soc_cliente: 'SUPERMERCADOS BRAVO SA',
      client_name: 'BRAVO SA'
    }
  };

  // We want to test without actually committing a permanent change to prod sequences if possible,
  // or see what happens.
  console.log('Testing handleCheckoutVisit...');
  await visitsRouterObj.handleCheckoutVisit(req, res);
  console.log('Response Code:', resCode);
  console.log('Response Data:', resData);

  // Clean up test visit
  await pool.query('DELETE FROM visits WHERE id = ?', [testId]);

  await pool.end();
}

testTraceCheckout().catch(console.error);

