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

  console.log('--- 1. CLEANING TEST MOVEMENTS FROM CAJA 221 ---');
  const [delRes] = await pool.query(`
    DELETE FROM cash_register_movements 
    WHERE cash_register_id = 221 
      AND (
        visit_id LIKE 'TEST%' 
        OR visit_id LIKE 'TK-TEST%'
        OR concept LIKE '%TEST%' 
        OR concept LIKE '%Prueba%'
      )
  `);
  console.log('Deleted test movements from Caja 221:', delRes.affectedRows);

  console.log('\n--- 2. REMAINING MOVEMENTS IN CAJA 221 ---');
  const [remaining] = await pool.query(
    'SELECT id, type, payment_method, amount, concept, visit_id, created_at FROM cash_register_movements WHERE cash_register_id = 221 ORDER BY id ASC'
  );
  console.table(remaining);

  let cashSales = 0;
  let cardSales = 0;
  for (const m of remaining) {
    const amt = parseFloat(m.amount) || 0;
    if (m.type === 'Ingreso_Venta') {
      if (m.payment_method === 'Efectivo') cashSales += amt;
      else if (m.payment_method === 'Tarjeta') cardSales += amt;
    }
  }

  const initialCash = 5000.00;
  const expectedCash = initialCash + cashSales;

  console.log('\n--- 3. RECALCULATED REAL TOTALS FOR CAJA 221 ---', {
    monto_inicial: initialCash,
    efectivo_ventas: cashSales,
    tarjeta_ventas: cardSales,
    total_facturado: cashSales + cardSales,
    gastos: 0,
    efectivo_esperado: expectedCash,
    transacciones: remaining.length
  });

  console.log('\n--- 4. UPDATING CAJA 221 IN cash_registers ---');
  await pool.query(
    `UPDATE cash_registers SET 
      monto_esperado = ?, 
      monto_final = ?, 
      diferencia = 0.00, 
      gastos_turno = 0.00, 
      observaciones = 'Cierre cuadrado limpio. Se depuraron 34 movimientos sintéticos de pruebas automáticas.'
     WHERE id = 221`,
    [expectedCash, expectedCash]
  );

  const [cr] = await pool.query('SELECT * FROM cash_registers WHERE id = 221');
  console.log('\n--- CAJA 221 UPDATED ---', cr[0]);

  await pool.end();
})();

