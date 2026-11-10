/**
 * Strict Multi-Tenant Catalog Verification Suite (Phase 1)
 *
 * Requirements:
 * 1. Uses validateTestEnvironment() and createIsolatedTestPool().
 * 2. Enforces col.data_type === 'uuid' (fails on character varying or other types).
 * 3. Enforces strict nullability: any nullable tenant_id without an explicit entry
 *    in APPROVED_NULLABLE_EXCEPTIONS fails immediately.
 * 4. Enforces table-by-table expected ON DELETE rules dictionary (EXPECTED_DELETE_RULES).
 * 5. Verifies B-Tree index (amname = 'btree') with tenant_id as position 1 leading column.
 * 6. Verifies FK on tenant_id specifically references tenants(id).
 * 7. Verifies exact quarantine triggers, tables, and function (fn_enforce_quarantine_block).
 * 8. Verifies exact canonical set of sequences.
 * 9. Verifies complete set of expected versions in schema_migrations (all with valid 'applied' status).
 * 10. Does NOT log premature verification messages before assertions finish.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { validateTestEnvironment, createIsolatedTestPool } = require('../utils/test_env_guard.cjs');
const { migrateAll } = require('../migrations/migrate_all.cjs');

const CANONICAL_61_TABLES = [
  'users',
  'branches',
  'salons',
  'user_sessions',
  'services',
  'service_categories',
  'clients',
  'cash_registers',
  'cash_shifts',
  'cash_register_movements',
  'visits',
  'plans',
  'appointments',
  'expenses',
  'payroll_periods',
  'payroll_records',
  'payroll_items',
  'payroll_calculation_settings',
  'payroll_concepts',
  'payroll_audit_logs',
  'attendance',
  'attendance_logs',
  'schedule_overrides',
  'staff_records',
  'staff_positions',
  'employees',
  'invoices',
  'invoice_items',
  'payments',
  'contracts',
  'contract_settings',
  'membership_plans',
  'membership_contracts',
  'ticket_sequences',
  'dgii_ncf_sequences',
  'dgii_606_purchases',
  'company_ncf_counters',
  'commission_schemes',
  'commission_categories',
  'commission_scheme_rules',
  'employee_commissions_log',
  'employee_commission_rules',
  'commission_payouts',
  'employee_consumptions',
  'employee_discounts',
  'gift_cards',
  'gift_card_logs',
  'pending_surveys',
  'surveys',
  'holidays',
  'security_settings',
  'security_requests',
  'security_audit_logs',
  'verification_codes',
  'marketing_settings',
  'email_settings',
  'email_logs',
  'tenant_settings',
  'tenant_subscriptions',
  'roles',
  'audit_logs'
];

// Documented business exceptions for nullable tenant_id
const APPROVED_NULLABLE_EXCEPTIONS = {
  'users': 'SuperAdmin global platform administrators do not belong to any tenant',
  'user_sessions': 'Active sessions for SuperAdmin platform administrators have no tenant_id',
  'audit_logs': 'System-wide bootstrap and schema migration audit records have no tenant context',
  'security_audit_logs': 'Global security events (e.g. invalid host brute force) have no tenant_id',
  'verification_codes': 'Password recovery codes for SuperAdmin accounts have no tenant_id'
};

// Table-by-table expected ON DELETE rules dictionary
const EXPECTED_DELETE_RULES = {};
for (const table of CANONICAL_61_TABLES) {
  EXPECTED_DELETE_RULES[table] = 'CASCADE';
}

const EXPECTED_QUARANTINE_TRIGGERS = [
  { triggerName: 'trg_quarantine_salons', tableName: 'salons', functionName: 'fn_enforce_quarantine_block' },
  { triggerName: 'trg_quarantine_cash_registers', tableName: 'cash_registers', functionName: 'fn_enforce_quarantine_block' },
  { triggerName: 'trg_quarantine_visits', tableName: 'visits', functionName: 'fn_enforce_quarantine_block' },
  { triggerName: 'trg_quarantine_ticket_sequences', tableName: 'ticket_sequences', functionName: 'fn_enforce_quarantine_block' }
];

const EXPECTED_MIGRATION_VERSIONS = [
  '20261100_canonical_baseline_schema',
  '20261108_phase1_structural_multitenant',
  '20261108_phase1_historical_reconciliation',
  '20261108_phase1_quarantine_triggers',
  '20261108_phase1_verification_codes_hardening',
  '20261108_phase1_purge_plaintext_codes',
  '20261108_phase1_enforce_tenant_not_null'
];

const EXPECTED_CANONICAL_SEQUENCES = [
  'appointments_id_seq',
  'attendance_id_seq',
  'attendance_logs_id_seq',
  'audit_logs_id_seq',
  'branches_id_seq',
  'cash_register_movements_id_seq',
  'cash_registers_id_seq',
  'cash_shifts_id_seq',
  'clients_id_seq',
  'commission_categories_id_seq',
  'commission_payouts_id_seq',
  'commission_scheme_rules_id_seq',
  'commission_schemes_id_seq',
  'company_ncf_counters_id_seq',
  'contract_settings_id_seq',
  'contracts_id_seq',
  'dgii_606_purchases_id_seq',
  'dgii_ncf_sequences_id_seq',
  'email_logs_id_seq',
  'email_settings_id_seq',
  'employee_commission_rules_id_seq',
  'employee_commissions_log_id_seq',
  'employee_consumptions_id_seq',
  'employee_discounts_id_seq',
  'employees_id_seq',
  'expenses_id_seq',
  'gift_card_logs_id_seq',
  'gift_cards_id_seq',
  'holidays_id_seq',
  'invoice_items_id_seq',
  'invoices_id_seq',
  'marketing_settings_id_seq',
  'membership_contracts_id_seq',
  'membership_plans_id_seq',
  'payments_id_seq',
  'payroll_audit_logs_id_seq',
  'payroll_calculation_settings_id_seq',
  'payroll_concepts_id_seq',
  'payroll_items_id_seq',
  'payroll_periods_id_seq',
  'payroll_records_id_seq',
  'pending_surveys_id_seq',
  'plans_id_seq',
  'roles_id_seq',
  'salons_id_seq',
  'schedule_overrides_id_seq',
  'security_audit_logs_id_seq',
  'security_requests_id_seq',
  'security_settings_id_seq',
  'service_categories_id_seq',
  'services_id_seq',
  'staff_positions_id_seq',
  'staff_records_id_seq',
  'surveys_id_seq',
  'tenant_settings_id_seq',
  'tenant_subscriptions_id_seq',
  'ticket_sequences_id_seq',
  'user_sessions_id_seq',
  'users_id_seq',
  'verification_codes_id_seq',
  'visits_id_seq'
];

async function verifyStrictMatrix(customPool = null) {
  console.log('=== VERIFICANDO MATRIZ ESTRICTA DE 61 TABLAS MULTI-TENANT EN CATÁLOGO ===\n');

  let pool = customPool;
  let shouldClosePool = false;

  if (!pool) {
    const testDbConfig = validateTestEnvironment({ allowDisposableSchema: true });
    pool = createIsolatedTestPool(testDbConfig);
    shouldClosePool = true;
  }

  const conn = await pool.getConnection();

  try {
    const violations = [];
    const resultsMatrix = [];

    // 1. Query table columns in public schema
    const [columns] = await conn.query(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'tenant_id';
    `);

    // 2. Query foreign keys pointing strictly to tenants(id)
    const [foreignKeys] = await conn.query(`
      SELECT 
        tc.table_name,
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.referential_constraints rc
        ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON rc.unique_constraint_name = ccu.constraint_name AND rc.unique_constraint_schema = ccu.constraint_schema
      WHERE tc.table_schema = 'public'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'tenant_id';
    `);

    // 3. Query B-Tree indexes with tenant_id as leading column (position 1)
    const [indexes] = await conn.query(`
      SELECT 
        t.relname AS table_name,
        i.relname AS index_name,
        am.amname AS access_method,
        a.attname AS leading_column
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_am am ON i.relam = am.oid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ix.indkey[0]
      WHERE n.nspname = 'public' AND a.attname = 'tenant_id' AND am.amname = 'btree';
    `);

    const colMap = new Map();
    columns.forEach(c => colMap.set(c.table_name, c));

    const fkMap = new Map();
    foreignKeys.forEach(fk => fkMap.set(fk.table_name, fk));

    const indexMap = new Map();
    indexes.forEach(idx => indexMap.set(idx.table_name, idx));

    // Audit each canonical table
    for (const table of CANONICAL_61_TABLES) {
      const entry = {
        table_name: table,
        has_tenant_col: false,
        col_type: null,
        is_nullable: null,
        nullability_policy: null,
        has_fk: false,
        fk_name: null,
        fk_target_table: null,
        fk_target_col: null,
        on_delete: null,
        has_index: false,
        index_name: null,
        index_am: null,
        is_leading_col: false,
        status: 'OK'
      };

      const col = colMap.get(table);
      if (!col) {
        violations.push({ table, error: 'MISSING_COLUMN: tenant_id does not exist' });
        entry.status = 'MISSING_TENANT_COL';
        resultsMatrix.push(entry);
        continue;
      }

      entry.has_tenant_col = true;
      entry.col_type = col.data_type;
      entry.is_nullable = col.is_nullable;

      // Rule: Data type must be strictly uuid
      if (col.data_type !== 'uuid') {
        violations.push({ table, error: `INVALID_TYPE: ${col.data_type} (strictly expected uuid)` });
      }

      // Rule: Strict nullability validation
      if (col.is_nullable === 'YES') {
        if (APPROVED_NULLABLE_EXCEPTIONS[table]) {
          entry.nullability_policy = `EXEMPTION_DOCUMENTED: ${APPROVED_NULLABLE_EXCEPTIONS[table]}`;
        } else {
          violations.push({ table, error: 'UNAPPROVED_NULLABLE_TENANT_ID: Column is nullable without approved exception entry' });
          entry.nullability_policy = 'VIOLATION_UNAPPROVED_NULLABLE';
        }
      } else {
        entry.nullability_policy = 'ENFORCED_NOT_NULL';
      }

      // Rule: B-Tree Index with leading tenant_id (amname = 'btree' and position 1)
      const validIndex = indexMap.get(table);
      if (validIndex && validIndex.access_method === 'btree' && validIndex.leading_column === 'tenant_id') {
        entry.has_index = true;
        entry.index_name = validIndex.index_name;
        entry.index_am = validIndex.access_method;
        entry.is_leading_col = true;
      } else {
        violations.push({ table, error: 'MISSING_OR_INVALID_BTREE_LEADING_INDEX: Must have btree index with tenant_id in position 1' });
      }

      // Rule: Foreign Key specifically pointing to tenants(id) and matching expected ON DELETE rule
      const fk = fkMap.get(table);
      if (fk) {
        entry.has_fk = true;
        entry.fk_name = fk.constraint_name;
        entry.fk_target_table = fk.foreign_table_name;
        entry.fk_target_col = fk.foreign_column_name;
        entry.on_delete = fk.delete_rule;

        if (fk.foreign_table_name !== 'tenants' || fk.foreign_column_name !== 'id') {
          violations.push({ table, error: `FK_TARGET_MISMATCH: FK points to ${fk.foreign_table_name}(${fk.foreign_column_name}) instead of tenants(id)` });
        }

        const expectedRule = EXPECTED_DELETE_RULES[table];
        if (fk.delete_rule !== expectedRule) {
          violations.push({ table, error: `DELETE_RULE_MISMATCH: Expected ${expectedRule}, found ${fk.delete_rule}` });
        }
      } else {
        violations.push({ table, error: 'MISSING_FOREIGN_KEY_TO_TENANTS' });
      }

      if (violations.some(v => v.table === table)) {
        entry.status = 'VIOLATION';
      }

      resultsMatrix.push(entry);
    }

    console.table(resultsMatrix.map(r => ({
      table: r.table_name,
      col: r.has_tenant_col ? r.col_type : 'MISSING',
      nullable: r.is_nullable,
      index: r.has_index ? `${r.index_am}(pos1)` : 'FAIL',
      fk: r.has_fk ? `${r.fk_target_table}.${r.fk_target_col} [${r.on_delete}]` : 'MISSING',
      status: r.status
    })));

    // Migration Chain Check in Disposable Schema
    const emptySchemaName = 'disposable_matrix_test_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');

    try {
      await conn.query(`CREATE SCHEMA ${emptySchemaName};`);
      await conn.query(`SET search_path TO ${emptySchemaName};`);

      // Run canonical migrate_all
      const migrationResult = await migrateAll({ pool, targetSchema: emptySchemaName, quiet: true });
      assert(migrationResult.success, 'migrateAll execution failed in disposable sandbox');

      // Check canonical 61 tables exist
      const [emptySchemaTables] = await conn.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = ? AND table_type = 'BASE TABLE';
      `, [emptySchemaName]);

      const createdSet = new Set(emptySchemaTables.map(t => t.table_name));
      const missingInEmpty = CANONICAL_61_TABLES.filter(t => !createdSet.has(t));
      if (missingInEmpty.length > 0) {
        violations.push({ table: 'MIGRATION_CHAIN', error: `Empty schema missing canonical tables: ${missingInEmpty.join(', ')}` });
      }

      // Check UUID and NOT NULL in migrated schema
      const [colsInMigrated] = await conn.query(`
        SELECT table_name, column_name, data_type, is_nullable
        FROM information_schema.columns 
        WHERE table_schema = ? AND column_name = 'tenant_id';
      `, [emptySchemaName]);

      for (const t of CANONICAL_61_TABLES) {
        const c = colsInMigrated.find(col => col.table_name === t);
        if (!c) {
          violations.push({ table: t, error: `Columna tenant_id ausente tras migrate_all en ${emptySchemaName}` });
        } else {
          if (c.data_type !== 'uuid') {
            violations.push({ table: t, error: `tenant_id tipo "${c.data_type}" inválido (debe ser uuid) tras migrate_all` });
          }
          const isExempt = Boolean(APPROVED_NULLABLE_EXCEPTIONS[t]);
          if (!isExempt && c.is_nullable !== 'NO') {
            violations.push({ table: t, error: `tenant_id es nullable en tabla no exenta tras migrate_all` });
          }
        }
      }

      // Check B-Tree Indexes with leading tenant_id (amname = 'btree' and position 1)
      const [indexesInMigrated] = await conn.query(`
        SELECT 
          t.relname AS table_name,
          i.relname AS index_name,
          am.amname AS access_method,
          a.attname AS leading_column
        FROM pg_class t
        JOIN pg_index ix ON t.oid = ix.indrelid
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_am am ON i.relam = am.oid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ix.indkey[0]
        WHERE n.nspname = ? AND a.attname = 'tenant_id' AND am.amname = 'btree';
      `, [emptySchemaName]);

      const indexedTablesSet = new Set(indexesInMigrated.map(idx => idx.table_name));
      for (const t of CANONICAL_61_TABLES) {
        if (!indexedTablesSet.has(t)) {
          violations.push({ table: t, error: `Índice B-Tree (pos1) en tenant_id ausente tras migrate_all en ${emptySchemaName}` });
        }
      }

      // Check FKs specifically pointing to tenants(id) with expected ON DELETE rule
      const [fksInMigrated] = await conn.query(`
        SELECT 
          tc.table_name,
          tc.constraint_name,
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name,
          rc.delete_rule
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.referential_constraints rc
          ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
        JOIN information_schema.constraint_column_usage ccu
          ON rc.unique_constraint_name = ccu.constraint_name AND rc.unique_constraint_schema = ccu.constraint_schema
        WHERE tc.table_schema = ?
          AND tc.constraint_type = 'FOREIGN KEY'
          AND kcu.column_name = 'tenant_id';
      `, [emptySchemaName]);

      const fkMigratedMap = new Map();
      fksInMigrated.forEach(fk => fkMigratedMap.set(fk.table_name, fk));

      for (const t of CANONICAL_61_TABLES) {
        const fk = fkMigratedMap.get(t);
        if (!fk) {
          violations.push({ table: t, error: `FK hacia tenants ausente tras migrate_all en ${emptySchemaName}` });
        } else {
          if (fk.foreign_table_name !== 'tenants' || fk.foreign_column_name !== 'id') {
            violations.push({ table: t, error: `FK en ${t} apunta a ${fk.foreign_table_name}(${fk.foreign_column_name}) en vez de tenants(id)` });
          }
          if (fk.delete_rule !== 'CASCADE') {
            violations.push({ table: t, error: `Regla ON DELETE "${fk.delete_rule}" inválida (esperado CASCADE) en ${emptySchemaName}` });
          }
        }
      }

      // Check Quarantine Triggers (exact names, tables, and function)
      const [triggersInMigrated] = await conn.query(`
        SELECT 
          t.tgname AS trigger_name,
          c.relname AS table_name,
          p.proname AS function_name
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE n.nspname = ? AND NOT t.tgisinternal;
      `, [emptySchemaName]);

      for (const expectedTrg of EXPECTED_QUARANTINE_TRIGGERS) {
        const matched = triggersInMigrated.find(trg =>
          trg.trigger_name === expectedTrg.triggerName &&
          trg.table_name === expectedTrg.tableName &&
          trg.function_name === expectedTrg.functionName
        );
        if (!matched) {
          violations.push({
            table: expectedTrg.tableName,
            error: `Trigger de cuarentena ausente o inválido: esperado ${expectedTrg.triggerName} ON ${expectedTrg.tableName} USING ${expectedTrg.functionName}`
          });
        }
      }

      // Check Canonical Sequences (exact expected set)
      const [sequencesInMigrated] = await conn.query(`
        SELECT sequence_name 
        FROM information_schema.sequences 
        WHERE sequence_schema = ?;
      `, [emptySchemaName]);

      const migratedSeqSet = new Set(sequencesInMigrated.map(s => s.sequence_name));
      for (const expSeq of EXPECTED_CANONICAL_SEQUENCES) {
        if (!migratedSeqSet.has(expSeq)) {
          violations.push({ table: 'SEQUENCES', error: `Secuencia esperada ausente: ${expSeq}` });
        }
      }

      // Check schema_migrations (complete set of expected versions, all with status='applied')
      const [migrationRows] = await conn.query(`
        SELECT version, status FROM ${emptySchemaName}.schema_migrations;
      `);

      const migrationStatusMap = new Map();
      migrationRows.forEach(r => migrationStatusMap.set(r.version, r.status));

      for (const expVer of EXPECTED_MIGRATION_VERSIONS) {
        const status = migrationStatusMap.get(expVer);
        if (!status) {
          violations.push({ table: 'SCHEMA_MIGRATIONS', error: `Versión de migración ausente en schema_migrations: ${expVer}` });
        } else if (status !== 'applied') {
          violations.push({ table: 'SCHEMA_MIGRATIONS', error: `Estado inválido para versión ${expVer}: "${status}" (esperado: applied)` });
        }
      }

    } finally {
      await conn.query(`DROP SCHEMA IF EXISTS ${emptySchemaName} CASCADE;`);
    }

    // Save JSON matrix artifact
    const matrixOutPath = path.resolve(__dirname, 'multitenant_strict_verification.json');
    fs.writeFileSync(matrixOutPath, JSON.stringify(resultsMatrix, null, 2), 'utf8');

    if (violations.length > 0) {
      console.error(`\n🚨 FALLO EN MATRIZ ESTRICTA: ${violations.length} violación(es) detectada(s):`);
      violations.forEach(v => console.error(`   - ${v.table}: ${v.error}`));
      return { success: false, violations };
    }

    // Only log verified messages AFTER all assertions pass
    console.log(`\n✅ [VERIFICADO] Las 61 tablas canónicas generadas y auditadas.`);
    console.log(`✅ [VERIFICADO] Tipos UUID y restricciones NOT NULL verificadas.`);
    console.log(`✅ [VERIFICADO] Índices B-Tree en tenant_id en posición 1 verificados.`);
    console.log(`✅ [VERIFICADO] FKs apuntando específicamente a tenants(id) con ON DELETE CASCADE verificadas.`);
    console.log(`✅ [VERIFICADO] Los 4 triggers exactos de cuarentena y función fn_enforce_quarantine_block verificados.`);
    console.log(`✅ [VERIFICADO] Las ${EXPECTED_CANONICAL_SEQUENCES.length} secuencias canónicas verificadas.`);
    console.log(`✅ [VERIFICADO] Las ${EXPECTED_MIGRATION_VERSIONS.length} versiones registradas con estado 'applied' en schema_migrations.`);
    console.log(`\n💾 Matriz de verificación estricta guardada en: ${matrixOutPath}`);
    return { success: true, verifiedCount: CANONICAL_61_TABLES.length };

  } finally {
    conn.release();
    if (shouldClosePool) {
      await pool.end();
    }
  }
}

if (require.main === module) {
  verifyStrictMatrix()
    .then(res => process.exit(res.success ? 0 : 1))
    .catch(err => {
      console.error('[FATAL MATRIX ERROR]:', err);
      process.exit(1);
    });
}

module.exports = {
  verifyStrictMatrix,
  CANONICAL_61_TABLES,
  APPROVED_NULLABLE_EXCEPTIONS,
  EXPECTED_DELETE_RULES,
  EXPECTED_QUARANTINE_TRIGGERS,
  EXPECTED_MIGRATION_VERSIONS,
  EXPECTED_CANONICAL_SEQUENCES
};
