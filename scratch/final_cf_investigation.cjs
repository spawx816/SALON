const path = require('path');
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));
require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.join(__dirname, '../backend/.env'), quiet: true });

(async () => {
  const pool = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD || process.env.DB_PASS, database: process.env.DB_NAME, timezone: '-04:00' });
  const q = async (label, sql, p = []) => { const [r] = await pool.query(sql, p); console.log(`\n=== ${label} ===`); console.table(r); return r; };
  const S = '2026-10-01 00:00:00', E = '2026-10-31 23:59:59';

  await q('Visit statuses (all time)', `SELECT status, COUNT(*) cnt, SUM(total) total FROM visits GROUP BY status`);
  await q('Oct visits with Nomina in metodo_pago', `SELECT metodo_pago, status, COUNT(*) cnt, SUM(total) total FROM visits WHERE visited_at BETWEEN ? AND ? AND metodo_pago LIKE '%omina%' GROUP BY metodo_pago, status`, [S, E]);
  await q('Oct Nomina visits sample', `SELECT id, client_id, client_name, total, monto_recibido, cash_register_id, ncf FROM visits WHERE visited_at BETWEEN ? AND ? AND metodo_pago='Nomina' LIMIT 5`, [S, E]);
  await q('Oct facturado visits: monto_recibido < total (non-card)', `SELECT metodo_pago, COUNT(*) cnt, SUM(total) total, SUM(monto_recibido) recibido FROM visits WHERE visited_at BETWEEN ? AND ? AND status='Facturado' AND monto_recibido < total AND metodo_pago NOT IN ('Plan Beauty') GROUP BY metodo_pago ORDER BY cnt DESC LIMIT 10`, [S, E]);
  await q('CRM Oct by type/method', `SELECT type, payment_method, COUNT(*) cnt, SUM(amount) total FROM cash_register_movements WHERE created_at BETWEEN ? AND ? GROUP BY type, payment_method ORDER BY type`, [S, E]);
  await q('Oct anulados: voided_at month & CRM link', `SELECT DATE_FORMAT(voided_at,'%Y-%m') void_month, metodo_pago, COUNT(*) cnt, SUM(total) total FROM visits WHERE visited_at BETWEEN ? AND ? AND status='Anulado' GROUP BY void_month, metodo_pago`, [S, E]);
  await q('Visits voided in Oct but billed earlier', `SELECT COUNT(*) cnt, SUM(total) total FROM visits WHERE status='Anulado' AND voided_at BETWEEN ? AND ? AND visited_at < ?`, [S, E, S]);
  await q('Visits billed Oct, voided later', `SELECT COUNT(*) cnt, SUM(total) total FROM visits WHERE status='Anulado' AND visited_at BETWEEN ? AND ? AND voided_at > ?`, [S, E, E]);
  await q('606 row 1 full', `SELECT * FROM dgii_606_purchases WHERE id=1`);
  await q('Expense concepts', `SELECT * FROM expense_concepts`);
  await q('Expense loans', `SELECT * FROM expense_loans`);
  await q('Oct payroll items TSS / neto by period', `SELECT pp.id, pp.period_name, pp.status, pp.approved_at, SUM(pi.neto_pagar) neto, SUM(pi.tss) tss_emp, SUM(pi.servicios) servicios_desc FROM payroll_periods pp JOIN payroll_items pi ON pi.payroll_id=pp.id WHERE pp.start_date <= '2026-10-31' AND pp.end_date >= '2026-10-01' GROUP BY pp.id`);
  await q('Gasto_Imprevisto Oct sample', `SELECT id, cash_register_id, amount, concept, created_at FROM cash_register_movements WHERE type='Gasto_Imprevisto' AND created_at BETWEEN ? AND ? LIMIT 10`, [S, E]);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });

