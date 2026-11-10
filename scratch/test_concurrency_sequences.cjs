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

async function testConcurrency() {
  const pool = mysql.createPool({
    host: env.DB_HOST,
    user: env.DB_USER,
    password: env.DB_PASSWORD || env.DB_PASS,
    database: env.DB_NAME,
    connectionLimit: 10,
    timezone: '-04:00'
  });

  const visitsRouterObj = createVisitsRouter(pool, {});
  const assignDgiiSequenceToVisit = visitsRouterObj.assignDgiiSequenceToVisit;

  const testType = 'TEST_CONC';
  await pool.query("DELETE FROM dgii_ncf_sequences WHERE tipo_comprobante = ?", [testType]);
  await pool.query("DELETE FROM visits WHERE id LIKE 'CONC_VIS_%'");

  // Create a batch with 5 numbers
  await pool.query(
    `INSERT INTO dgii_ncf_sequences (tipo_comprobante, nombre_comprobante, numero_desde, numero_hasta, secuencia_actual, cantidad_aprobada, cantidad_usada, fecha_vencimiento, estado)
     VALUES (?, 'Concurrency Batch', 'TEST_CONC0000001', 'TEST_CONC0000005', 0, 5, 0, '2028-12-31', 'Activo')`,
    [testType]
  );

  console.log('Testing 5 concurrent allocations simultaneously...');

  // Launch 5 simultaneous checkout sequence allocations
  const promises = [1, 2, 3, 4, 5].map(async (num) => {
    const visitId = `CONC_VIS_00${num}`;
    await pool.query(
      "INSERT INTO visits (id, ticket_number, client_id, client_name, total, metodo_pago, status, visited_at) VALUES (?, ?, 'INVITADO', 'Empresa Test SRL', 500.00, 'Efectivo', 'Pendiente', NOW())",
      [visitId, `TKT-CONC-${num}`]
    );

    return assignDgiiSequenceToVisit(visitId, testType, '131917038', 'Empresa Test SRL', 500, 'Efectivo');
  });

  const results = await Promise.all(promises);
  const assignedNcfs = results.map(r => r.ncf).filter(Boolean);
  console.log('Assigned NCFs:', assignedNcfs);

  const uniqueNcfs = new Set(assignedNcfs);
  const isAllUnique = uniqueNcfs.size === 5;
  console.log('All 5 unique?', isAllUnique, `(${uniqueNcfs.size} / 5)`);

  if (!isAllUnique) {
    console.error('FAIL: Duplicate NCF assigned under concurrency!');
    process.exit(1);
  }

  // Verify 6th concurrent allocation is rejected as LOTE_AGOTADO
  const visitId6 = 'CONC_VIS_006';
  await pool.query(
    "INSERT INTO visits (id, ticket_number, client_id, client_name, total, metodo_pago, status, visited_at) VALUES (?, 'TKT-CONC-6', 'INVITADO', 'Empresa Test SRL', 500.00, 'Efectivo', 'Pendiente', NOW())",
    [visitId6]
  );
  const res6 = await assignDgiiSequenceToVisit(visitId6, testType, '131917038', 'Empresa Test SRL', 500, 'Efectivo');
  console.log('6th allocation result:', res6.code);

  const isSixthBlocked = (res6.ncf === null && res6.code === 'LOTE_AGOTADO');
  console.log('6th properly blocked with LOTE_AGOTADO?', isSixthBlocked);

  // Clean up
  await pool.query("DELETE FROM dgii_ncf_sequences WHERE tipo_comprobante = ?", [testType]);
  await pool.query("DELETE FROM visits WHERE id LIKE 'CONC_VIS_%'");
  await pool.query("DELETE FROM audit_logs WHERE reason LIKE '%TEST_CONC%'");

  await pool.end();

  if (isAllUnique && isSixthBlocked) {
    console.log('CONCURRENCY TEST PASSED 100%!');
  } else {
    process.exit(1);
  }
}

testConcurrency();

