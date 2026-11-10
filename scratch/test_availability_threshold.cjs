const path = require('path');
const mysql = require(path.join(__dirname, '..', 'backend', 'node_modules', 'mysql2', 'promise'));
const fs = require('fs');
const { createDgiiRouter } = require('../backend/routes/dgii.routes');

const envPath = path.join(__dirname, '..', 'backend', '.env');
const env = fs.readFileSync(envPath, 'utf8').split('\n').reduce((acc, line) => {
  const [k, ...v] = line.trim().split('=');
  if (k && v.length) acc[k] = v.join('=');
  return acc;
}, {});

(async () => {
  const pool = mysql.createPool({
    host: env.DB_HOST,
    user: env.DB_USER,
    password: env.DB_PASSWORD || env.DB_PASS,
    database: env.DB_NAME,
    timezone: '-04:00'
  });

  const dgiiModule = createDgiiRouter(pool);
  const getAvailability = dgiiModule.getSequenceAvailability;

  let result = null;
  const mockReq = {};
  const mockRes = {
    json: (data) => { result = data; }
  };

  await getAvailability(mockReq, mockRes);
  console.log('--- AVAILABILITY RESULT ---');
  console.log('hasAlerts:', result.hasAlerts);
  console.log('alerts count:', result.alerts.length);
  console.log('alerts:', result.alerts);
  console.log('E31 disponibles:', result.E31.disponibles, 'alertLevel:', result.E31.alertLevel);
  console.log('E32 disponibles:', result.E32.disponibles, 'alertLevel:', result.E32.alertLevel);
  console.log('E34 disponibles:', result.E34.disponibles, 'alertLevel:', result.E34.alertLevel);

  await pool.end();
})();

