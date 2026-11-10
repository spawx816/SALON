const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const db = require('../db.js');
const pool = db.pool || db;

async function checkOrphans() {
  const tables = [
    'contracts', 'staff_records', 'ticket_sequences', 'payments', 
    'attendance', 'holidays', 'payroll_records', 'payroll_items', 
    'payroll_periods', 'marketing_settings', 'gift_cards', 
    'schedule_overrides', 'employee_discounts', 'dgii_606_purchases',
    'surveys', 'pending_surveys', 'cash_register_movements',
    'commission_categories', 'commission_payouts', 'commission_scheme_rules',
    'commission_schemes', 'company_ncf_counters', 'employee_commission_rules',
    'employee_commissions_log', 'employee_consumptions', 'payroll_concepts'
  ];

  for (const t of tables) {
    try {
      const [rows] = await pool.query(`
        SELECT COUNT(*) as count 
        FROM ${t} 
        WHERE tenant_id IS NOT NULL 
          AND tenant_id NOT IN (SELECT id FROM tenants)
      `);
      const [nulls] = await pool.query(`
        SELECT COUNT(*) as count 
        FROM ${t} 
        WHERE tenant_id IS NULL
      `);
      console.log(`Table ${t}: orphans=${rows[0].count}, nulls=${nulls[0].count}`);
    } catch (e) {
      console.log(`Table ${t}: error: ${e.message}`);
    }
  }
  process.exit(0);
}

checkOrphans().catch(err => {
  console.error(err);
  process.exit(1);
});

