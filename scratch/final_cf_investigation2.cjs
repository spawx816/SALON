const path = require('path');
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));
require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.join(__dirname, '../backend/.env'), quiet: true });

(async () => {
  const pool = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD || process.env.DB_PASS, database: process.env.DB_NAME, timezone: '-04:00', dateStrings: true });
  const q = async (label, sql, p = []) => { const [r] = await pool.query(sql, p); console.log(`\n=== ${label} ===`); console.log(JSON.stringify(r, null, 1)); return r; };
  const S = '2026-10-01 00:00:00', E = '2026-10-31 23:59:59';

  await q('CRM Oct totals by type', `SELECT type, COUNT(*) cnt, SUM(amount) total FROM cash_register_movements WHERE created_at BETWEEN ? AND ? GROUP BY type`, [S, E]);
  await q('CRM Ingreso_Venta Oct excluding Nomina/Plan Beauty', `SELECT SUM(amount) total, COUNT(DISTINCT visit_id) visits FROM cash_register_movements WHERE type='Ingreso_Venta' AND created_at BETWEEN ? AND ? AND payment_method NOT IN ('Nomina','Plan Beauty')`, [S, E]);
  await q('CRM Anulacion_Venta Oct excluding Nomina/Plan Beauty', `SELECT SUM(amount) total, COUNT(*) cnt FROM cash_register_movements WHERE type='Anulacion_Venta' AND created_at BETWEEN ? AND ? AND payment_method NOT IN ('Nomina','Plan Beauty')`, [S, E]);
  await q('Visits Facturado Oct by bucket', `SELECT CASE WHEN metodo_pago='Nomina' THEN 'Nomina' WHEN metodo_pago='Plan Beauty' THEN 'PlanBeauty' ELSE 'Dinero' END b, COUNT(*) cnt, SUM(total) total FROM visits WHERE status='Facturado' AND visited_at BETWEEN ? AND ? GROUP BY b`, [S, E]);
  await q('Visits Anulado billed Oct by bucket', `SELECT CASE WHEN metodo_pago='Nomina' THEN 'Nomina' WHEN metodo_pago='Plan Beauty' THEN 'PlanBeauty' ELSE 'Dinero' END b, DATE_FORMAT(voided_at,'%Y-%m') vm, COUNT(*) cnt, SUM(total) total FROM visits WHERE status='Anulado' AND visited_at BETWEEN ? AND ? GROUP BY b, vm`, [S, E]);
  // per-visit diff between CRM net and visit total, for Oct-billed, money visits
  await q('Oct money visits: CRM net vs visit total mismatches', `
    SELECT v.id, v.status, v.metodo_pago, v.total, COALESCE(SUM(CASE WHEN m.type='Ingreso_Venta' THEN m.amount END),0) crm_in, COALESCE(SUM(CASE WHEN m.type='Anulacion_Venta' THEN m.amount END),0) crm_void
    FROM visits v LEFT JOIN cash_register_movements m ON m.visit_id = v.id
    WHERE v.visited_at BETWEEN ? AND ? AND v.metodo_pago NOT IN ('Nomina','Plan Beauty') AND v.status IN ('Facturado','Anulado')
    GROUP BY v.id HAVING ABS(crm_in - v.total) > 0.009 LIMIT 15`, [S, E]);
  await q('Count of Oct money visits w/o any CRM ingreso', `SELECT v.status, COUNT(*) cnt, SUM(v.total) total FROM visits v WHERE v.visited_at BETWEEN ? AND ? AND v.metodo_pago NOT IN ('Nomina','Plan Beauty') AND v.status IN ('Facturado','Anulado') AND NOT EXISTS (SELECT 1 FROM cash_register_movements m WHERE m.visit_id=v.id AND m.type='Ingreso_Venta') GROUP BY v.status`, [S, E]);
  await q('CRM Ingreso_Venta Oct w/o visit', `SELECT COUNT(*) cnt, SUM(amount) total FROM cash_register_movements m WHERE type='Ingreso_Venta' AND created_at BETWEEN ? AND ? AND (visit_id IS NULL OR NOT EXISTS (SELECT 1 FROM visits v WHERE v.id=m.visit_id))`, [S, E]);
  await q('CRM Anulacion_Venta Oct: date of original sale', `SELECT DATE_FORMAT(v.visited_at,'%Y-%m') sale_month, COUNT(*) cnt, SUM(m.amount) total FROM cash_register_movements m JOIN visits v ON v.id=m.visit_id WHERE m.type='Anulacion_Venta' AND m.created_at BETWEEN ? AND ? GROUP BY sale_month`, [S, E]);
  await q('Salons on CRM? cash_registers cols', `SHOW COLUMNS FROM cash_registers`);
  await q('606 row 1', `SELECT * FROM dgii_606_purchases WHERE id=1`);
  await q('Expense concepts', `SELECT * FROM expense_concepts`);
  await q('Expense loans', `SELECT * FROM expense_loans`);
  await q('All expenses', `SELECT id, concept_name, payment_date, amount, reference, status, created_by, created_at FROM expenses`);
  await q('Prestamo_Empleado / Retiro / Entrada Oct', `SELECT type, concept, amount, created_at FROM cash_register_movements WHERE type IN ('Prestamo_Empleado','Retiro_Efectivo','Entrada_Adicional') AND created_at BETWEEN ? AND ? ORDER BY type LIMIT 40`, [S, E]);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });

