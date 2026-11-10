const path = require('path');
const mysql = require(path.join(__dirname, '..', 'backend', 'node_modules', 'mysql2', 'promise'));
const fs = require('fs');

const envPath = path.join(__dirname, '..', 'backend', '.env');
const env = fs.readFileSync(envPath, 'utf8').split('\n').reduce((acc, line) => {
  const [k, ...v] = line.trim().split('=');
  if (k && v.length) acc[k] = v.join('=');
  return acc;
}, {});

const { createVisitsRouter } = require('../backend/routes/visits.routes');

(async () => {
  const pool = mysql.createPool({
    host: env.DB_HOST,
    user: env.DB_USER,
    password: env.DB_PASSWORD || env.DB_PASS,
    database: env.DB_NAME,
    timezone: '-04:00'
  });

  const visitsRouterObj = createVisitsRouter(pool, {});

  const reqMock = {
    params: { id: 'SYNTH_TEST_500' },
    body: {
      id: 'SYNTH_TEST_500',
      total: 700,
      metodo_pago: 'Efectivo',
      ncf_type: 'TEST_E31',
      rnc_cliente: '131917038',
      rzn_soc_cliente: 'Empresa Test SRL'
    }
  };

  const resMock = {
    status: (code) => {
      console.log('Status set to:', code);
      return {
        json: (data) => { console.log('JSON response:', data); }
      };
    }
  };

  await pool.query(
    "INSERT INTO visits (id, ticket_number, client_id, client_name, total, metodo_pago, status, visited_at) VALUES ('SYNTH_TEST_500', 'TKT-TEST-500', 'INVITADO', 'Empresa Test SRL', 700, 'Efectivo', 'Pendiente', NOW())"
  );

  try {
    await visitsRouterObj.handleCheckoutVisit(reqMock, resMock);
  } catch (err) {
    console.error('Thrown error:', err);
  } finally {
    await pool.query("DELETE FROM visits WHERE id = 'SYNTH_TEST_500'");
    await pool.end();
  }
})();

