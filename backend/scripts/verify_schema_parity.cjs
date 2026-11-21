'use strict';

/**
 * Schema Parity Gate & Fresh-vs-Upgrade Reconciliation Verifier (Bloque 1)
 * (backend/scripts/verify_schema_parity.cjs)
 *
 * Verifica:
 * 1. Reconciliación del esquema objetivo (`public` o `TARGET_SCHEMA`) mediante `migrateAll`
 *    con adopción explícita de checksums SHA-256 en `schema_migrations`.
 * 2. Detección fail-closed (`MIGRATION_CHECKSUM_MISMATCH`) si una migración aplicada es alterada.
 * 3. Comparación estructural exacta entre:
 *    - Instalación limpia desde cero (`fresh_install_<ts>`)
 *    - Actualización incremental desde un esquema representativo del staging pre-remediación
 *      (`staging_upgrade_<ts>`, donde faltaban las 14 columnas de billing y `saas_renewal_runs`
 *      y existían suscripciones sin consentimiento recurrente)
 *    - Esquema activo (`public`)
 * 4. Verificación de backfills seguros en la actualización:
 *    - `auto_renew = FALSE` en suscripciones existentes sin consentimiento recurrente
 *    - `recurring_consent_at IS NULL`, `recurring_consent_version IS NULL`, `billing_anchor_day IS NULL`
 *    - `periodicity_mode = 'fixed_30_days'` preservado sin inventar contrataciones.
 */

const assert = require('assert');
const crypto = require('crypto');
const { validateTestEnvironment, createIsolatedTestPool } = require('../utils/test_env_guard.cjs');
const { migrateAll, MIGRATIONS_REGISTRY, computeMigrationChecksum } = require('../migrations/migrate_all.cjs');
const { up: upReconcileSaasBillingDrift } = require('../migrations/20261121_reconcile_saas_billing_schema_drift.cjs');
const {
  CANONICAL_MIGRATIONS,
  CANONICAL_101_TABLES,
  TENANT_OWNED_TABLES,
  APPROVED_NULLABLE_EXEMPTIONS
} = require('./canonical_schema_contract.cjs');

function normalizeDefault(def, schemaName) {
  if (def === null || def === undefined) return '';
  return String(def)
    .replace(new RegExp(`"?${schemaName}"?\\.`, 'g'), '')
    .replace(/::character varying/g, '')
    .replace(/::bpchar/g, '')
    .replace(/::text/g, '')
    .trim();
}

async function getSchemaSnapshot(conn, schemaName) {
  const [cols] = await conn.query(
    `SELECT table_name, column_name, data_type, udt_name,
            COALESCE(character_maximum_length::text, '') AS char_len,
            is_nullable, COALESCE(column_default, '') AS column_default
     FROM information_schema.columns
     WHERE table_schema = ?
     ORDER BY table_name, column_name`,
    [schemaName]
  );

  const [fks] = await conn.query(
    `SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = ?
     ORDER BY tc.table_name, kcu.column_name, ccu.table_name`,
    [schemaName]
  );

  return {
    columns: cols.map(c =>
      `${c.table_name}|${c.column_name}|${c.data_type}|${c.udt_name}|${c.char_len}|${c.is_nullable}|${normalizeDefault(c.column_default, schemaName)}`
    ),
    foreignKeys: fks.map(f =>
      `${f.table_name}.${f.column_name}->${f.foreign_table_name}.${f.foreign_column_name}`
    )
  };
}

function diffLists(listA, listB, labelA, labelB) {
  const setA = new Set(listA);
  const setB = new Set(listB);
  const onlyInA = listA.filter(x => !setB.has(x)).map(x => `[-${labelA}] ${x}`);
  const onlyInB = listB.filter(x => !setA.has(x)).map(x => `[+${labelB}] ${x}`);
  return [...onlyInA, ...onlyInB];
}

async function runVerifySchemaParity() {
  console.log('========================================================================');
  console.log('🛡️ GATE DE PARIDAD DE ESQUEMA, BACKFILLS SEGUROS Y CHECKSUMS (BLOQUE 1)');
  console.log('========================================================================\n');

  const testConfig = validateTestEnvironment({ allowDisposableSchema: true });
  const pool = createIsolatedTestPool(testConfig);
  const conn = await pool.getConnection();

  const ts = Date.now() + '_' + crypto.randomBytes(2).toString('hex');
  const freshSchema = `parity_fresh_${ts}`;
  const upgradeSchema = `parity_upgrade_${ts}`;

  try {
    // 1. Reconciliar esquema public con migrateAll y verificar adopción de checksums
    console.log('[1/5] Ejecutando migrateAll sobre esquema "public" y verificando checksums SHA-256...');
    const pubMig = await migrateAll({ pool, targetSchema: 'public', quiet: true });
    assert.strictEqual(pubMig.success, true);
    assert.strictEqual(pubMig.totalRegistered, CANONICAL_MIGRATIONS.length);

    const [migRows] = await conn.query(
      `SELECT version, checksum FROM public.schema_migrations WHERE status IN ('APPLIED', 'applied', 'RE_VERIFIED')`
    );
    assert.strictEqual(migRows.length, CANONICAL_MIGRATIONS.length, `Esperadas ${CANONICAL_MIGRATIONS.length} migraciones en public.schema_migrations`);
    for (const row of migRows) {
      assert.ok(row.checksum && row.checksum.length === 64, `Checksum SHA-256 ausente para ${row.version}`);
      assert.strictEqual(row.checksum, computeMigrationChecksum(row.version), `Checksum no coincide para ${row.version}`);
    }
    console.log(`  ✅ [PASS] ${migRows.length}/${CANONICAL_MIGRATIONS.length} migraciones con checksum SHA-256 válido en "public".`);

    // 2. Construir instalación limpia desde cero en freshSchema
    console.log(`\n[2/5] Construyendo instalación desde cero en "${freshSchema}"...`);
    await conn.query(`CREATE SCHEMA "${freshSchema}";`);
    await migrateAll({ pool, targetSchema: freshSchema, quiet: true });

    // 3. Prueba negativa de modificación de migración aplicada (Tamper Detection via Checksum)
    console.log('\n[3/5] Verificando bloqueo fail-closed ante alteración de migración aplicada...');
    let checksumMismatchCaught = false;
    try {
      await migrateAll({
        pool,
        targetSchema: freshSchema,
        quiet: true,
        checksumOverrides: {
          '20261109_phase2d_saas_billing': '// TAMPERED HISTORICAL MIGRATION CONTENT'
        }
      });
    } catch (err) {
      if (err.code === 'MIGRATION_CHECKSUM_MISMATCH') {
        checksumMismatchCaught = true;
      }
    }
    assert.strictEqual(checksumMismatchCaught, true, 'El runner debe abortar con MIGRATION_CHECKSUM_MISMATCH si se edita una migración aplicada');
    console.log('  ✅ [PASS] Detección de alteración de migración histórica verificada (MIGRATION_CHECKSUM_MISMATCH).');

    // 4. Construir esquema representativo del staging pre-remediación en upgradeSchema y actualizarlo
    console.log(`\n[4/5] Simulando esquema representativo de staging pre-remediación en "${upgradeSchema}" y aplicando reconciliación incremental...`);
    await conn.query(`CREATE SCHEMA "${upgradeSchema}";`);
    await migrateAll({ pool, targetSchema: upgradeSchema, quiet: true });

    // Reproducir exactamente la deriva que tenía salon_saas_staging antes de 20261121:
    // - Sin tabla saas_renewal_runs
    // - Sin las 7 columnas en tenant_subscriptions, 4 en saas_invoices, 3 en saas_payments
    // - Con filas existentes en tenant_subscriptions (active y pending_payment) creadas antes de que existiera consentimiento recurrente
    await conn.query(`DROP TABLE "${upgradeSchema}".saas_renewal_runs CASCADE;`);
    await conn.query(`
      ALTER TABLE "${upgradeSchema}".tenant_subscriptions
        DROP COLUMN periodicity_mode,
        DROP COLUMN billing_anchor_day,
        DROP COLUMN auto_renew,
        DROP COLUMN recurring_consent_at,
        DROP COLUMN recurring_consent_version,
        DROP COLUMN extra_users_count,
        DROP COLUMN addon_branches_count;
    `);
    await conn.query(`
      ALTER TABLE "${upgradeSchema}".saas_invoices
        DROP COLUMN idempotency_key,
        DROP COLUMN fx_rate_scaled,
        DROP COLUMN fx_rate_formatted,
        DROP COLUMN metadata;
    `);
    await conn.query(`
      ALTER TABLE "${upgradeSchema}".saas_payments
        DROP COLUMN attempt_number,
        DROP COLUMN is_retriable,
        DROP COLUMN requires_reconciliation;
    `);

    const synthTenantActive = crypto.randomUUID();
    const synthTenantPending = crypto.randomUUID();
    await conn.query(
      `INSERT INTO "${upgradeSchema}".tenants (id, business_name, slug, email, status)
       VALUES (?, 'Staging Active Salon', 'stg-act', 'act@stg.local', 'active'),
              (?, 'Staging Pending Salon', 'stg-pnd', 'pnd@stg.local', 'pending')`,
      [synthTenantActive, synthTenantPending]
    );
    await conn.query(
      `INSERT INTO "${upgradeSchema}".tenant_subscriptions (id, tenant_id, plan_code, status, billing_cycle, currency, current_period_start, current_period_end)
       VALUES (?, ?, 'PRINCIPAL', 'active', 'monthly', 'DOP', NOW(), NOW() + INTERVAL '30 days'),
              (?, ?, 'PRINCIPAL', 'pending_payment', 'monthly', 'DOP', NOW(), NOW() + INTERVAL '30 days')`,
      [crypto.randomUUID(), synthTenantActive, crypto.randomUUID(), synthTenantPending]
    );

    // Ejecutar la migración incremental 20261121 sobre el esquema representativo de staging
    await upReconcileSaasBillingDrift(pool, upgradeSchema);

    // Verificar invariantes de backfill seguro sobre las filas preexistentes
    const [upgradedSubs] = await conn.query(
      `SELECT tenant_id, status, periodicity_mode, billing_anchor_day, auto_renew,
              recurring_consent_at, recurring_consent_version, extra_users_count, addon_branches_count
       FROM "${upgradeSchema}".tenant_subscriptions
       WHERE tenant_id IN (?, ?)`,
      [synthTenantActive, synthTenantPending]
    );
    assert.strictEqual(upgradedSubs.length, 2, 'Ambas suscripciones preexistentes deben conservarse');
    for (const sub of upgradedSubs) {
      assert.strictEqual(sub.auto_renew, false, 'Backfill seguro NO debe activar auto_renew sin consentimiento');
      assert.strictEqual(sub.recurring_consent_at, null, 'Backfill seguro NO debe inventar fecha de consentimiento');
      assert.strictEqual(sub.recurring_consent_version, null, 'Backfill seguro NO debe inventar versión de consentimiento');
      assert.strictEqual(sub.billing_anchor_day, null, 'Backfill seguro NO debe inventar día ancla');
      assert.strictEqual(sub.periodicity_mode, 'fixed_30_days', 'Backfill seguro debe preservar fixed_30_days en suscripciones previas');
      assert.strictEqual(Number(sub.extra_users_count), 0);
      assert.strictEqual(Number(sub.addon_branches_count), 0);
    }
    console.log('  ✅ [PASS] Backfills seguros verificados: auto_renew=FALSE, consentimientos=NULL, periodicity_mode=fixed_30_days.');

    // 5. Comparar paridad estructural exacta entre freshSchema, upgradeSchema y public
    console.log('\n[5/5] Comparando paridad de columnas, tipos, nulabilidad, defaults y FKs entre instalación limpia, upgrade y public...');
    const snapFresh = await getSchemaSnapshot(conn, freshSchema);
    const snapUpgrade = await getSchemaSnapshot(conn, upgradeSchema);
    const snapPublic = await getSchemaSnapshot(conn, 'public');

    const colDiffFreshVsUpgrade = diffLists(snapFresh.columns, snapUpgrade.columns, 'fresh', 'upgrade');
    const fkDiffFreshVsUpgrade = diffLists(snapFresh.foreignKeys, snapUpgrade.foreignKeys, 'fresh', 'upgrade');
    assert.strictEqual(
      colDiffFreshVsUpgrade.length,
      0,
      `Diferencias de columnas entre fresh y upgrade:\n${colDiffFreshVsUpgrade.join('\n')}`
    );
    assert.strictEqual(
      fkDiffFreshVsUpgrade.length,
      0,
      `Diferencias de FKs entre fresh y upgrade:\n${fkDiffFreshVsUpgrade.join('\n')}`
    );

    const colDiffFreshVsPublic = diffLists(snapFresh.columns, snapPublic.columns, 'fresh', 'public');
    const fkDiffFreshVsPublic = diffLists(snapFresh.foreignKeys, snapPublic.foreignKeys, 'fresh', 'public');
    assert.strictEqual(
      colDiffFreshVsPublic.length,
      0,
      `Diferencias de columnas entre fresh y public:\n${colDiffFreshVsPublic.join('\n')}`
    );
    assert.strictEqual(
      fkDiffFreshVsPublic.length,
      0,
      `Diferencias de FKs entre fresh y public:\n${fkDiffFreshVsPublic.join('\n')}`
    );

    console.log(`  ✅ [PASS] Paridad 100% exacta verificada (${CANONICAL_101_TABLES.length} tablas, ${snapPublic.columns.length} columnas, ${snapPublic.foreignKeys.length} FKs).`);
    console.log('\n========================================================================');
    console.log('🎉 GATE DE PARIDAD DE ESQUEMA APROBADO (0 DERIVA ENTRE FRESH, UPGRADE Y PUBLIC)');
    console.log('========================================================================\n');
  } finally {
    await conn.query(`DROP SCHEMA IF EXISTS "${freshSchema}" CASCADE;`).catch(() => {});
    await conn.query(`DROP SCHEMA IF EXISTS "${upgradeSchema}" CASCADE;`).catch(() => {});
    conn.release();
    await pool.end();
  }
}

if (require.main === module) {
  runVerifySchemaParity()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ FALLO EN GATE DE PARIDAD DE ESQUEMA:', err);
      process.exit(1);
    });
}

module.exports = { runVerifySchemaParity };
