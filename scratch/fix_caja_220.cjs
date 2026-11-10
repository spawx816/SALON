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

  console.log('--- DELETING ERRONEOUS MOVEMENT 3275 FROM CAJA 220 ---');
  const [delRes] = await pool.query("DELETE FROM cash_register_movements WHERE id = 3275 AND cash_register_id = 220 AND visit_id = '1793749809812'");
  console.log('Deleted rows:', delRes.affectedRows);

  console.log('\n--- CAJA 220 MOVEMENTS AFTER FIX ---');
  const [moves] = await pool.query("SELECT id, type, payment_method, amount, concept, created_at FROM cash_register_movements WHERE cash_register_id = 220");
  console.log(moves);

  let cashSales = 0;
  let cardSales = 0;
  let otherSales = 0;
  let expenses = 0;

  for (const m of moves) {
    const amt = Number(m.amount || 0);
    if (m.type === 'Ingreso_Venta') {
      if (m.payment_method === 'Efectivo') cashSales += amt;
      else if (m.payment_method === 'Tarjeta') cardSales += amt;
      else otherSales += amt;
    } else if (m.type === 'Gasto_Imprevisto' || m.type === 'Retiro_Efectivo') {
      expenses += Math.abs(amt);
    } else if (m.type === 'Anulacion_Venta') {
      if (m.payment_method === 'Efectivo') cashSales += amt;
      else if (m.payment_method === 'Tarjeta') cardSales += amt;
      else otherSales += amt;
    }
  }

  const initialCash = 5000.00;
  const expectedCash = initialCash + cashSales - expenses;

  console.log('\n--- CAJA 220 SUMMARY RECALCULATED ---');
  console.log({
    monto_inicial: initialCash,
    efectivo_en_ventas: cashSales,
    tarjeta_en_ventas: cardSales,
    gastos_imprevistos: expenses,
    efectivo_esperado_en_caja: expectedCash
  });

  await pool.end();
})();

