const path = require('path');
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));
require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.join(__dirname, '../backend/.env'), quiet: true });
(async () => {
  const pool = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD || process.env.DB_PASS, database: process.env.DB_NAME, timezone: '-04:00', dateStrings: true });
  const [g] = await pool.query(`SELECT m.id, m.cash_register_id, cr.salon_id, m.amount, m.concept, m.created_at FROM cash_register_movements m LEFT JOIN cash_registers cr ON cr.id=m.cash_register_id WHERE m.type='Gasto_Imprevisto' AND m.created_at BETWEEN '2026-10-01 00:00:00' AND '2026-10-31 23:59:59' ORDER BY m.created_at`);
  g.forEach(r => console.log(`${r.id}|caja ${r.cash_register_id}|salon ${r.salon_id}|${r.amount}|${r.created_at}|${r.concept}`));
  const [p] = await pool.query(`SELECT id, rnc_cedula, tipo_id, proveedor, ncf, fecha_factura, fecha_pago, forma_pago, total_facturado, itbis_facturado, isc, otros_impuestos, propina_legal, itbis_retenido, isr_retenido, estado, notas, created_at, updated_at FROM dgii_606_purchases`);
  console.log(JSON.stringify(p, null, 1));
  const [ec] = await pool.query(`SELECT id, name FROM expense_concepts`);
  console.log(JSON.stringify(ec));
  await pool.end();
})();

