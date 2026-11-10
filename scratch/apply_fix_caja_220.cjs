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

  console.log('--- 1. DELETING MOVEMENT 3275 FROM CAJA 220 ---');
  const [delRes] = await pool.query(
    "DELETE FROM cash_register_movements WHERE id = 3275 AND cash_register_id = 220 AND visit_id = '1793749809812'"
  );
  console.log('Deleted rows:', delRes.affectedRows);

  console.log('\n--- 2. FETCHING REMAINING MOVEMENTS FOR CAJA 220 ---');
  const [moves] = await pool.query(
    "SELECT * FROM cash_register_movements WHERE cash_register_id = 220 ORDER BY id ASC"
  );
  console.log(`Found ${moves.length} movements in Caja 220`);

  let efectivoTotal = 0;
  let tarjetaTotal = 0;
  let transferenciaTotal = 0;
  let gastosTotal = 0;
  let countVentas = 0;

  for (const m of moves) {
    const rawAmt = Math.abs(Number(m.amount) || 0);
    const isSale = m.type === 'Ingreso_Venta';
    const isVoid = m.type === 'Anulacion_Venta';

    if (isSale || isVoid) {
      const sign = isVoid ? -1 : 1;
      const signedAmt = sign * rawAmt;
      if (isSale) countVentas++;
      if (isVoid) countVentas = Math.max(0, countVentas - 1);

      const method = (m.payment_method || '').toLowerCase();
      if (method.includes('efectivo')) {
        efectivoTotal += signedAmt;
      } else if (method.includes('tarjeta')) {
        tarjetaTotal += signedAmt;
      } else if (method.includes('transferencia')) {
        transferenciaTotal += signedAmt;
      }
    } else if (m.type === 'Gasto_Imprevisto' || m.type === 'Retiro_Efectivo') {
      gastosTotal += rawAmt;
    }
  }

  const initialAmt = 5000.00;
  const montoEsperado = initialAmt + efectivoTotal - gastosTotal;
  const totalFacturado = efectivoTotal + tarjetaTotal + transferenciaTotal;

  console.log('\n--- 3. RECALCULATED TOTALS ---', {
    monto_inicial: initialAmt,
    efectivo_ventas: efectivoTotal,
    tarjeta_ventas: tarjetaTotal,
    total_facturado: totalFacturado,
    gastos_imprevistos: gastosTotal,
    monto_esperado_en_caja: montoEsperado,
    count_ventas: countVentas
  });

  console.log('\n--- 4. UPDATING CAJA 220 IN cash_registers ---');
  await pool.query(
    `UPDATE cash_registers SET 
      monto_esperado = ?, 
      monto_final = ?, 
      gastos_turno = ?, 
      diferencia = 0.00, 
      observaciones = 'Cierre cuadrado. Corrección de anulación ajena D(-0571.'
     WHERE id = 220`,
    [montoEsperado, montoEsperado, gastosTotal]
  );

  const [updatedReg] = await pool.query('SELECT * FROM cash_registers WHERE id = 220');
  console.log('\n--- CAJA 220 AFTER UPDATE ---', updatedReg[0]);

  // Ensure visit 1793749809812 has cash_register_id = null
  await pool.query("UPDATE visits SET cash_register_id = NULL WHERE id = '1793749809812'");

  await pool.end();
})();

