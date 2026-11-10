const path = require('path');
const mysql = require(path.join(__dirname, '..', 'backend', 'node_modules', 'mysql2', 'promise'));
const fs = require('fs');

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

  const [moves] = await pool.query(
    'SELECT * FROM cash_register_movements WHERE cash_register_id = 221 ORDER BY id ASC'
  );

  console.log('Total movements:', moves.length);

  const realMoves = [];
  const testMoves = [];

  for (const m of moves) {
    const isTest = (
      (m.visit_id && String(m.visit_id).includes('TEST')) ||
      (m.concept && String(m.concept).includes('TEST')) ||
      (m.concept && String(m.concept).includes('Prueba'))
    );
    if (isTest) {
      testMoves.push(m);
    } else {
      realMoves.push(m);
    }
  }

  console.log('\n--- REAL MOVEMENTS (' + realMoves.length + ') ---');
  console.table(realMoves.map(m => ({
    id: m.id,
    type: m.type,
    method: m.payment_method,
    amount: m.amount,
    concept: m.concept,
    visit_id: m.visit_id
  })));

  console.log('\n--- TEST MOVEMENTS (' + testMoves.length + ') ---');
  console.table(testMoves.map(m => ({
    id: m.id,
    type: m.type,
    method: m.payment_method,
    amount: m.amount,
    concept: m.concept,
    visit_id: m.visit_id
  })));

  // Calculate REAL totals
  let realEfectivo = 0;
  let realTarjeta = 0;
  let realTransferencia = 0;
  let realGastos = 0;

  for (const m of realMoves) {
    const amt = parseFloat(m.amount) || 0;
    if (m.type === 'Ingreso_Venta') {
      if (m.payment_method === 'Efectivo') realEfectivo += amt;
      else if (m.payment_method === 'Tarjeta') realTarjeta += amt;
      else if (m.payment_method === 'Transferencia') realTransferencia += amt;
    } else if (m.type === 'Anulacion_Venta') {
      if (m.payment_method === 'Efectivo') realEfectivo += amt; // amt is negative
      else if (m.payment_method === 'Tarjeta') realTarjeta += amt;
      else if (m.payment_method === 'Transferencia') realTransferencia += amt;
    } else if (m.type === 'Gasto_Imprevisto' || m.type === 'Retiro_Efectivo') {
      realGastos += Math.abs(amt);
    }
  }

  const initialAmt = 5000.00;
  const realExpectedCash = initialAmt + realEfectivo - realGastos;

  console.log('\n--- REAL TOTALS FOR LORALY GALVAN (CAJA 221) ---', {
    monto_inicial: initialAmt,
    real_efectivo_ventas: realEfectivo,
    real_tarjeta_ventas: realTarjeta,
    total_real_facturado: realEfectivo + realTarjeta + realTransferencia,
    real_gastos: realGastos,
    real_efectivo_esperado: realExpectedCash,
    real_transacciones: realMoves.filter(m => m.type === 'Ingreso_Venta').length
  });

  await pool.end();
})();

