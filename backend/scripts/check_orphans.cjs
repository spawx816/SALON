const { pool } = require('../db');

async function main() {
  const tables = [
    'attendance',
    'audit_logs',
    'cash_register_movements',
    'commission_categories',
    'commission_payouts',
    'commission_scheme_rules',
    'commission_schemes',
    'company_ncf_counters',
    'contracts',
    'dgii_606_purchases',
    'email_logs',
    'email_settings',
    'employee_commission_rules',
    'employee_commissions_log',
    'employee_consumptions',
    'employee_discounts',
    'gift_card_logs',
    'gift_cards',
    'holidays',
    'marketing_settings',
    'payments',
    'payroll_audit_logs',
    'payroll_calculation_settings',
    'payroll_concepts',
    'payroll_items',
    'payroll_records',
    'pending_surveys',
    'roles',
    'schedule_overrides',
    'security_audit_logs',
    'security_requests',
    'security_settings',
    'staff_positions',
    'staff_records',
    'surveys',
    'ticket_sequences',
    'verification_codes'
  ];

  console.log('Checking orphan tenant_id records in all tables...');
  let totalOrphans = 0;
  for (const t of tables) {
    const [res] = await pool.query(`
      SELECT COUNT(*) as count 
      FROM ${t} 
      WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT id FROM tenants)
    `);
    const count = parseInt(res[0].count, 10);
    const [nullRes] = await pool.query(`
      SELECT COUNT(*) as count FROM ${t} WHERE tenant_id IS NULL
    `);
    const nullCount = parseInt(nullRes[0].count, 10);
    const [totalRes] = await pool.query(`
      SELECT COUNT(*) as count FROM ${t}
    `);
    const total = parseInt(totalRes[0].count, 10);

    if (count > 0 || nullCount > 0) {
      console.log(`⚠️ ${t}: total=${total}, orphans=${count}, nulls=${nullCount}`);
      totalOrphans += count;
    } else {
      console.log(`✅ ${t}: total=${total}, orphans=0, nulls=0`);
    }
  }
  console.log('\nTotal orphans across tables:', totalOrphans);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

