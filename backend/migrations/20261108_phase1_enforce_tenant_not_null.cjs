/**
 * Migration: 20261108_phase1_enforce_tenant_not_null
 *
 * Enforces NOT NULL constraint on tenant_id for all tenant-owned tables in CANONICAL_61_TABLES,
 * strictly excluding the 5 documented business exceptions:
 * - users (SuperAdmin platform owners)
 * - user_sessions (SuperAdmin sessions)
 * - audit_logs (System-level bootstrap events)
 * - security_audit_logs (Global brute-force events)
 * - verification_codes (SuperAdmin password recovery)
 */

const { pool } = require('../db');

const APPROVED_NULLABLE_EXCEPTIONS = new Set([
  'users',
  'user_sessions',
  'audit_logs',
  'security_audit_logs',
  'verification_codes'
]);

const CANONICAL_61_TABLES = [
  'users', 'branches', 'salons', 'user_sessions', 'services', 'service_categories',
  'clients', 'cash_registers', 'cash_shifts', 'cash_register_movements', 'visits',
  'plans', 'appointments', 'expenses', 'payroll_periods', 'payroll_records',
  'payroll_items', 'payroll_calculation_settings', 'payroll_concepts', 'payroll_audit_logs',
  'attendance', 'attendance_logs', 'schedule_overrides', 'staff_records',
  'staff_positions', 'employees', 'invoices', 'invoice_items', 'payments',
  'contracts', 'contract_settings', 'membership_plans', 'membership_contracts',
  'ticket_sequences', 'dgii_ncf_sequences', 'dgii_606_purchases', 'company_ncf_counters',
  'commission_schemes', 'commission_categories', 'commission_scheme_rules',
  'employee_commissions_log', 'employee_commission_rules', 'commission_payouts',
  'employee_consumptions', 'employee_discounts', 'gift_cards', 'gift_card_logs',
  'pending_surveys', 'surveys', 'holidays', 'security_settings', 'security_requests',
  'security_audit_logs', 'verification_codes', 'marketing_settings', 'email_settings',
  'email_logs', 'tenant_settings', 'tenant_subscriptions', 'roles', 'audit_logs'
];

async function up(targetPool = pool, targetSchema = null) {
  console.log('🔒 [MIGRATION 20261108] Enforcing NOT NULL on tenant_id across canonical tables...');
  const conn = await targetPool.getConnection();

  try {
    await conn.beginTransaction();

    const schema = targetSchema || 'public';
    if (targetSchema) {
      await conn.query(`SET search_path TO ${targetSchema}, public;`);
    }

    let alteredCount = 0;
    for (const table of CANONICAL_61_TABLES) {
      if (APPROVED_NULLABLE_EXCEPTIONS.has(table)) {
        continue;
      }

      // Check if table exists
      const [tableExists] = await conn.query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = ?",
        [schema, table]
      );
      if (tableExists.length === 0) continue;

      // Check current nullability
      const [colInfo] = await conn.query(
        "SELECT is_nullable FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = 'tenant_id'",
        [schema, table]
      );
      if (colInfo.length > 0 && colInfo[0].is_nullable === 'YES') {
        // Assert no nulls exist
        const [nullRows] = await conn.query(`SELECT COUNT(*) as cnt FROM "${table}" WHERE tenant_id IS NULL`);
        const nullCount = parseInt(nullRows[0].cnt, 10);
        if (nullCount > 0) {
          throw new Error(`Cannot set NOT NULL on ${table}: found ${nullCount} rows with NULL tenant_id`);
        }

        await conn.query(`ALTER TABLE "${table}" ALTER COLUMN tenant_id SET NOT NULL;`);
        alteredCount++;
      }
    }

    await conn.commit();
    console.log(`✅ [MIGRATION 20261108] NOT NULL constraint enforced on ${alteredCount} tables.`);
  } catch (err) {
    await conn.rollback();
    console.error('❌ [MIGRATION 20261108 ERROR]:', err.message);
    throw err;
  } finally {
    conn.release();
  }
}

async function down(targetPool = pool) {
  const conn = await targetPool.getConnection();
  try {
    await conn.beginTransaction();
    for (const table of CANONICAL_61_TABLES) {
      if (!APPROVED_NULLABLE_EXCEPTIONS.has(table)) {
        await conn.query(`ALTER TABLE "${table}" ALTER COLUMN tenant_id DROP NOT NULL;`);
      }
    }
    await conn.commit();
    console.log('✅ [MIGRATION 20261108 ROLLBACK] NOT NULL removed.');
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  up()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { up, down };

