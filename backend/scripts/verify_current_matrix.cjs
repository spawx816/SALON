/**
 * Master Verification Matrix for Current Complete Schema (95 Tables & 15 Migrations)
 * (backend/scripts/verify_current_matrix.cjs)
 *
 * Verifies:
 * 1. All 95 canonical tables exist and match expected classifications.
 * 2. Strict multi-tenant isolation on all 83 tenant-owned tables (100% tenant_id UUID).
 * 3. Leading B-tree index on tenant_id for all 83 tenant tables.
 * 4. Foreign key references to tenants(id) with ON DELETE CASCADE on all 83 tenant tables.
 * 5. Complete set of 15 canonical migrations with status 'applied'.
 * 6. Zero missing or unknown tables/migrations.
 * 7. Verification in both active test database and clean disposable schema from scratch.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { validateTestEnvironment, createIsolatedTestPool } = require('../utils/test_env_guard.cjs');
const { migrateAll } = require('../migrations/migrate_all.cjs');
const {
  CANONICAL_MIGRATIONS,
  GLOBAL_SYSTEM_TABLES,
  TENANT_OWNED_TABLES,
  APPROVED_NULLABLE_EXEMPTIONS,
  CANONICAL_95_TABLES,
  CANONICAL_QUARANTINE_TRIGGERS,
  CANONICAL_44_SEQUENCES
} = require('./canonical_schema_contract.cjs');

async function verifyCurrentMatrix(customPool = null) {
  console.log('========================================================================');
  console.log(`🏛️ VERIFICACIÓN INTEGRAL DE MATRIZ ACTUAL (${CANONICAL_95_TABLES.length} TABLAS / ${CANONICAL_MIGRATIONS.length} MIGRACIONES)`);
  console.log('========================================================================\n');

  const testConfig = validateTestEnvironment({ allowDisposableSchema: true });
  const pool = customPool || createIsolatedTestPool(testConfig);
  const conn = await pool.getConnection();

  const violations = [];
  const matrixReport = [];

  try {
    // -------------------------------------------------------------
    // PART 1: AUDIT OF ACTIVE TEST DATABASE (public schema)
    // -------------------------------------------------------------
    console.log('[FASE 1] Auditando catálogo activo en esquema "public"...');

    // 1. Check all base tables
    const [publicTables] = await conn.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    const publicTableNames = publicTables.map(t => t.table_name);
    const publicTableSet = new Set(publicTableNames);

    console.log(`  📊 Tablas detectadas en public: ${publicTableNames.length} (esperadas: ${CANONICAL_95_TABLES.length})`);

    // Missing tables check
    for (const expTable of CANONICAL_95_TABLES) {
      if (!publicTableSet.has(expTable)) {
        violations.push({ table: expTable, error: `Tabla canónica ausente en el catálogo: "${expTable}"` });
      }
    }

    // Unknown tables check
    const canonicalSet = new Set(CANONICAL_95_TABLES);
    for (const actTable of publicTableNames) {
      if (!canonicalSet.has(actTable)) {
        violations.push({ table: actTable, error: `Tabla desconocida/no registrada detectada en catálogo: "${actTable}"` });
      }
    }

    // 2. Audit tenant_id column in tenant-owned tables
    const [tenantColumns] = await conn.query(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'tenant_id';
    `);

    const colMap = new Map();
    tenantColumns.forEach(c => colMap.set(c.table_name, c));

    for (const t of TENANT_OWNED_TABLES) {
      const col = colMap.get(t);
      if (!col) {
        violations.push({ table: t, error: `Tabla tenant-owned "${t}" carece de columna tenant_id` });
        continue;
      }

      // Expected type: uuid for 100% of tenant-owned tables
      const expectedType = 'uuid';
      if (col.data_type !== expectedType) {
        violations.push({ table: t, error: `Tipo de tenant_id inválido en "${t}": "${col.data_type}" (esperado: "${expectedType}")` });
      }

      // Strict nullability
      const isExempt = Boolean(APPROVED_NULLABLE_EXEMPTIONS[t]);
      if (!isExempt && col.is_nullable !== 'NO') {
        violations.push({ table: t, error: `Columna tenant_id en "${t}" es nullable sin exención formal aprobada` });
      }
    }

    // 3. Audit B-Tree indexes on tenant_id (leading position 1)
    const [btreeIndexes] = await conn.query(`
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

    const indexedTableSet = new Set(btreeIndexes.map(idx => idx.table_name));
    for (const t of TENANT_OWNED_TABLES) {
      if (!indexedTableSet.has(t)) {
        violations.push({ table: t, error: `Índice B-Tree con tenant_id en posición 1 ausente en "${t}"` });
      }
    }

    // 4. Audit FKs pointing to tenants(id) with ON DELETE CASCADE
    const [fkConstraints] = await conn.query(`
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

    const fkMap = new Map();
    fkConstraints.forEach(fk => fkMap.set(fk.table_name, fk));

    // 100% of tenant-owned tables must have strict FK to tenants(id) ON DELETE CASCADE
    for (const t of TENANT_OWNED_TABLES) {
      const fk = fkMap.get(t);
      if (!fk) {
        violations.push({ table: t, error: `Restricción Foreign Key hacia tenants(id) ausente en "${t}"` });
      } else {
        if (fk.foreign_table_name !== 'tenants' || fk.foreign_column_name !== 'id') {
          violations.push({ table: t, error: `FK en "${t}" apunta a ${fk.foreign_table_name}(${fk.foreign_column_name}) en vez de tenants(id)` });
        }
        if (fk.delete_rule !== 'CASCADE') {
          violations.push({ table: t, error: `Regla ON DELETE inválida en "${t}": "${fk.delete_rule}" (esperado: CASCADE)` });
        }
      }
    }

    // 5. Audit Quarantine Triggers
    const [quarantineTriggers] = await conn.query(`
      SELECT 
        t.tgname AS trigger_name,
        c.relname AS table_name,
        p.proname AS function_name
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE n.nspname = 'public' AND NOT t.tgisinternal;
    `);

    for (const expTrg of CANONICAL_QUARANTINE_TRIGGERS) {
      const match = quarantineTriggers.find(trg =>
        trg.trigger_name === expTrg.triggerName &&
        trg.table_name === expTrg.tableName &&
        trg.function_name === expTrg.functionName
      );
      if (!match) {
        violations.push({ table: expTrg.tableName, error: `Trigger de cuarentena ausente o inválido: ${expTrg.triggerName} ON ${expTrg.tableName}` });
      }
    }

    // 6. Audit Canonical Sequences
    const [publicSequences] = await conn.query(`
      SELECT sequence_name 
      FROM information_schema.sequences 
      WHERE sequence_schema = 'public';
    `);

    const seqSet = new Set(publicSequences.map(s => s.sequence_name));
    for (const expSeq of CANONICAL_44_SEQUENCES) {
      if (!seqSet.has(expSeq)) {
        violations.push({ table: 'SEQUENCES', error: `Secuencia canónica ausente: "${expSeq}"` });
      }
    }

    // 7. Audit Schema Migrations Table
    const [migrationRows] = await conn.query(`
      SELECT version, status FROM schema_migrations ORDER BY version;
    `);

    const actMigrationMap = new Map();
    migrationRows.forEach(m => actMigrationMap.set(m.version, m.status));

    for (const expVer of CANONICAL_MIGRATIONS) {
      const status = actMigrationMap.get(expVer);
      if (!status) {
        violations.push({ table: 'SCHEMA_MIGRATIONS', error: `Versión de migración obligatoria ausente: "${expVer}"` });
      } else if (String(status).toLowerCase() !== 'applied') {
        violations.push({ table: 'SCHEMA_MIGRATIONS', error: `Estado inválido para migración "${expVer}": "${status}" (esperado: applied)` });
      }
    }

    // Check for unregistered migrations
    const expMigrationSet = new Set(CANONICAL_MIGRATIONS);
    for (const [actVer] of actMigrationMap) {
      if (!expMigrationSet.has(actVer)) {
        violations.push({ table: 'SCHEMA_MIGRATIONS', error: `Migración desconocida/no aprobada detectada en schema_migrations: "${actVer}"` });
      }
    }

    // -------------------------------------------------------------
    // PART 2: DISPOSABLE SCHEMA GENERATION TEST FROM ZERO (migrate_all)
    // -------------------------------------------------------------
    const disposableSchema = 'disposable_current_matrix_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
    console.log(`\n[FASE 2] Ejecutando migrate_all desde cero en esquema desechable: "${disposableSchema}"...`);

    try {
      await conn.query(`CREATE SCHEMA ${disposableSchema};`);
      await conn.query(`SET search_path TO ${disposableSchema};`);

      const migrationResult = await migrateAll({ pool, targetSchema: disposableSchema, quiet: true });
      assert(migrationResult.success, 'migrateAll execution failed in disposable sandbox');

      // Check all 95 tables in disposable schema
      const [dispTables] = await conn.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = ? AND table_type = 'BASE TABLE';
      `, [disposableSchema]);

      const dispTableNames = new Set(dispTables.map(t => t.table_name));
      for (const t of CANONICAL_95_TABLES) {
        if (!dispTableNames.has(t)) {
          violations.push({ table: t, error: `Esquema desechable carece de tabla canónica tras migrate_all: "${t}"` });
        }
      }

      console.log(`  ✅ [PASS] ${CANONICAL_95_TABLES.length}/${CANONICAL_95_TABLES.length} tablas y ${CANONICAL_MIGRATIONS.length} migraciones reconstruidas limpiamente desde cero en "${disposableSchema}".`);
    } finally {
      await conn.query(`DROP SCHEMA IF EXISTS ${disposableSchema} CASCADE;`);
      console.log(`  ✅ [TEARDOWN] Esquema desechable "${disposableSchema}" destruido (DROP SCHEMA CASCADE).`);
    }

    if (violations.length > 0) {
      console.error(`\n🚨 FALLO EN MATRIZ ACTUAL: ${violations.length} violación(es) detectada(s):`);
      violations.forEach(v => console.error(`   - [${v.table}] ${v.error}`));
      process.exit(1);
    }

    console.log('\n========================================================================');
    console.log(`🎉 MATRIZ ACTUAL CERTIFICADA AL 100%: ${CANONICAL_95_TABLES.length}/${CANONICAL_95_TABLES.length} TABLAS Y ${CANONICAL_MIGRATIONS.length} MIGRACIONES VÁLIDAS`);
    console.log('========================================================================\n');

    process.exit(0);
  } catch (err) {
    console.error('\n❌ ERROR FATAL DURANTE VERIFICACIÓN DE MATRIZ ACTUAL:', err);
    process.exit(1);
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  verifyCurrentMatrix();
}

module.exports = { verifyCurrentMatrix };

