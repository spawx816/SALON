/**
 * Canonical Sequential Migration Runner (Phase 1 Multi-Tenant)
 *
 * Requirements:
 * 1. Executes all active Phase 1 migrations in deterministic sequential order.
 * 2. Tracks execution state in schema_migrations (version, applied_at, actor, status).
 * 3. 100% idempotent: skips already applied migrations.
 * 4. Supports execution against any schema (public or isolated test schema).
 * 5. Fails closed (exit code 1) on any migration error.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pool: defaultPool } = require('../db');

const { runStructuralMigration } = require('./20261108_phase1_structural_multitenant.cjs');
const { runHistoricalReconciliation } = require('./20261108_phase1_historical_reconciliation.cjs');
const { up: upQuarantineTriggers } = require('./20261108_phase1_quarantine_triggers.cjs');
const { up: upVerificationCodes } = require('./20261108_phase1_verification_codes_hardening.cjs');
const { up: upPurgePlaintext } = require('./20261108_phase1_purge_plaintext_codes.cjs');
const { up: upEnforceNotNull } = require('./20261108_phase1_enforce_tenant_not_null.cjs');
const { up: upPhase2aSaas } = require('./20261109_phase2a_saas_commercial_and_entitlements.cjs');
const { up: upPhase2bInventory } = require('./20261109_phase2b_inventory_multitenant.cjs');
const { up: upPhase2dBilling } = require('./20261109_phase2d_saas_billing.cjs');
const { up: upCurrencyUnits } = require('./20261109_financial_minor_currency_units.cjs');
const { up: upSecurePin } = require('./20261109_secure_admin_pin_hash.cjs');
const { up: upUserTokenVersion } = require('./20261110_phase2h_user_token_version.cjs');
const { up: upJobNoncesAndStrictIdempotency } = require('./20261110_job_nonces_and_strict_idempotency.cjs');
const { up: upStorageAndPortability } = require('./20261110_phase3b_storage_and_portability.cjs');
const { up: upP2P3Extensions } = require('./20261110_phase3b_p2p3_extensions.cjs');
const { up: upClientsInBasePlan } = require('./20261111_phase3c_clients_in_base_plan.cjs');
const { up: upUnifyCatalogInventory } = require('./20261114_unify_catalog_inventory.cjs');
const { up: upCatalogCategoriesAndAlerts } = require('./20261114_catalog_categories_and_inventory_alerts.cjs');
const { up: upSaasFxRates } = require('./20261115_saas_fx_rates.cjs');
const { up: upTenantTermsAndWelcome } = require('./20261115_tenant_terms_and_welcome.cjs');
const { up: upRbacHardening } = require('./20261115_rbac_hardening.cjs');
const { up: upPlatformEmailSettings } = require('./20261116_platform_email_settings.cjs');
const { up: upPrintTemplatesAndTurnTickets } = require('./20261116_print_templates_and_turn_tickets.cjs');
const { up: upKioskDevicesHardening } = require('./20261117_kiosk_devices_hardening.cjs');
const { up: upScheduleOverridesUnique } = require('./20261120_schedule_overrides_unique_tenant_emp_date.cjs');
const { up: upReconcileSaasBillingDrift } = require('./20261121_reconcile_saas_billing_schema_drift.cjs');

const MIGRATION_SOURCE_FILES = Object.freeze({
  '20261100_canonical_baseline_schema': path.resolve(__dirname, '../backups/independent_schema.sql'),
  '20261108_phase1_structural_multitenant': path.resolve(__dirname, './20261108_phase1_structural_multitenant.cjs'),
  '20261108_phase1_historical_reconciliation': path.resolve(__dirname, './20261108_phase1_historical_reconciliation.cjs'),
  '20261108_phase1_quarantine_triggers': path.resolve(__dirname, './20261108_phase1_quarantine_triggers.cjs'),
  '20261108_phase1_verification_codes_hardening': path.resolve(__dirname, './20261108_phase1_verification_codes_hardening.cjs'),
  '20261108_phase1_purge_plaintext_codes': path.resolve(__dirname, './20261108_phase1_purge_plaintext_codes.cjs'),
  '20261108_phase1_enforce_tenant_not_null': path.resolve(__dirname, './20261108_phase1_enforce_tenant_not_null.cjs'),
  '20261109_phase2a_saas_commercial_and_entitlements': path.resolve(__dirname, './20261109_phase2a_saas_commercial_and_entitlements.cjs'),
  '20261109_phase2b_inventory_multitenant': path.resolve(__dirname, './20261109_phase2b_inventory_multitenant.cjs'),
  '20261109_phase2d_saas_billing': path.resolve(__dirname, './20261109_phase2d_saas_billing.cjs'),
  '20261109_financial_minor_currency_units': path.resolve(__dirname, './20261109_financial_minor_currency_units.cjs'),
  '20261109_secure_admin_pin_hash': path.resolve(__dirname, './20261109_secure_admin_pin_hash.cjs'),
  '20261110_create_tenant_branding': path.resolve(__dirname, './20261110_create_tenant_branding.sql'),
  '20261110_phase2h_user_token_version': path.resolve(__dirname, './20261110_phase2h_user_token_version.cjs'),
  '20261110_job_nonces_and_strict_idempotency': path.resolve(__dirname, './20261110_job_nonces_and_strict_idempotency.cjs'),
  '20261110_phase3b_storage_and_portability': path.resolve(__dirname, './20261110_phase3b_storage_and_portability.cjs'),
  '20261110_phase3b_p2p3_extensions': path.resolve(__dirname, './20261110_phase3b_p2p3_extensions.cjs'),
  '20261111_phase3c_clients_in_base_plan': path.resolve(__dirname, './20261111_phase3c_clients_in_base_plan.cjs'),
  '20261114_unify_catalog_inventory': path.resolve(__dirname, './20261114_unify_catalog_inventory.cjs'),
  '20261114_catalog_categories_and_inventory_alerts': path.resolve(__dirname, './20261114_catalog_categories_and_inventory_alerts.cjs'),
  '20261115_saas_fx_rates': path.resolve(__dirname, './20261115_saas_fx_rates.cjs'),
  '20261115_tenant_terms_and_welcome': path.resolve(__dirname, './20261115_tenant_terms_and_welcome.cjs'),
  '20261115_rbac_hardening': path.resolve(__dirname, './20261115_rbac_hardening.cjs'),
  '20261116_platform_email_settings': path.resolve(__dirname, './20261116_platform_email_settings.cjs'),
  '20261116_print_templates_and_turn_tickets': path.resolve(__dirname, './20261116_print_templates_and_turn_tickets.cjs'),
  '20261117_kiosk_devices_hardening': path.resolve(__dirname, './20261117_kiosk_devices_hardening.cjs'),
  '20261120_schedule_overrides_unique_tenant_emp_date': path.resolve(__dirname, './20261120_schedule_overrides_unique_tenant_emp_date.cjs'),
  '20261121_reconcile_saas_billing_schema_drift': path.resolve(__dirname, './20261121_reconcile_saas_billing_schema_drift.cjs')
});

function computeMigrationChecksum(version, customContent = null) {
  let content = customContent;
  if (content === null || content === undefined) {
    const filePath = MIGRATION_SOURCE_FILES[version];
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error(`No se encontró el archivo fuente para calcular checksum de la migración "${version}"`);
    }
    content = fs.readFileSync(filePath, 'utf8');
  }
  // Normalize CRLF -> LF so checksums are deterministic across Windows and Linux containers
  const normalized = String(content).replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function parseSqlStatements(sqlContent) {
  const statements = [];
  let current = '';
  let inDollarBlock = false;

  const lines = sqlContent.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('--')) continue;

    const dollarMatches = (line.match(/\$\$/g) || []).length;
    if (dollarMatches % 2 === 1) {
      inDollarBlock = !inDollarBlock;
    }

    current += line + '\n';

    if (!inDollarBlock && trimmed.endsWith(';')) {
      statements.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

const MIGRATIONS_REGISTRY = [
  {
    version: '20261100_canonical_baseline_schema',
    description: 'Asegurar tablas y claves primarias del catálogo canónico',
    execute: async (targetPool, targetSchema) => {
      const conn = await targetPool.getConnection();
      try {
        const schema = targetSchema || 'public';
        const ddlFile = path.resolve(__dirname, '../backups/independent_schema.sql');
        const rawDdl = fs.readFileSync(ddlFile, 'utf8');
        const schemaDdl = rawDdl.replace(/\{\{SCHEMA\}\}/g, schema);
        const stmts = parseSqlStatements(schemaDdl);
        for (const s of stmts) {
          await conn.query(s);
        }
      } finally {
        conn.release();
      }
    }
  },
  {
    version: '20261108_phase1_structural_multitenant',
    description: 'Estructura multi-tenant, columnas tenant_id, índices B-Tree y FKs estrictas',
    execute: async (targetPool, targetSchema) => {
      return runStructuralMigration(targetPool, targetSchema);
    }
  },
  {
    version: '20261108_phase1_historical_reconciliation',
    description: 'Aislamiento y registro auditado de filas ambiguas en pending_tenant_reconciliations',
    execute: async (targetPool, targetSchema) => {
      return runHistoricalReconciliation(targetPool, targetSchema);
    }
  },
  {
    version: '20261108_phase1_quarantine_triggers',
    description: 'Instalación de función de bloqueo y triggers de cuarentena en salons, cash_registers, visits, ticket_sequences',
    execute: async (targetPool, targetSchema) => {
      return upQuarantineTriggers(targetPool, targetSchema);
    }
  },
  {
    version: '20261108_phase1_verification_codes_hardening',
    description: 'Refuerzo criptográfico y control de intentos en verification_codes',
    execute: async (targetPool, targetSchema) => {
      return upVerificationCodes(targetPool, targetSchema);
    }
  },
  {
    version: '20261108_phase1_purge_plaintext_codes',
    description: 'Purga permanente de códigos en texto plano',
    execute: async (targetPool, targetSchema) => {
      return upPurgePlaintext(targetPool, targetSchema);
    }
  },
  {
    version: '20261108_phase1_enforce_tenant_not_null',
    description: 'Imposición estricta de NOT NULL en tenant_id sobre tablas canónicas (excluyendo 5 excepciones aprobadas)',
    execute: async (targetPool, targetSchema) => {
      return upEnforceNotNull(targetPool, targetSchema);
    }
  },
  {
    version: '20261109_phase2a_saas_commercial_and_entitlements',
    description: 'Catálogo de planes BASE/PRO, límites de entitlements y suscripciones tenant',
    execute: async (targetPool, targetSchema) => {
      return upPhase2aSaas(targetPool, targetSchema);
    }
  },
  {
    version: '20261109_phase2b_inventory_multitenant',
    description: 'Sistema de inventario multi-tenant (productos, stock, movimientos, órdenes de compra)',
    execute: async (targetPool, targetSchema) => {
      return upPhase2bInventory(targetPool, targetSchema);
    }
  },
  {
    version: '20261109_phase2d_saas_billing',
    description: 'Facturación SaaS recurrente, facturas simuladas, ciclos de vida y pagos',
    execute: async (targetPool, targetSchema) => {
      return upPhase2dBilling(targetPool, targetSchema);
    }
  },
  {
    version: '20261109_financial_minor_currency_units',
    description: 'Unidades monetarias menores en centavos (DOP/USD) y almacenamiento de idempotencia',
    execute: async (targetPool, targetSchema) => {
      return upCurrencyUnits(targetPool);
    }
  },
  {
    version: '20261109_secure_admin_pin_hash',
    description: 'Almacenamiento seguro de PIN de administración con hash bcrypt',
    execute: async (targetPool, targetSchema) => {
      return upSecurePin(targetPool);
    }
  },
  {
    version: '20261110_create_tenant_branding',
    description: 'Personalización de marca multi-tenant y configuración de tickets POS',
    execute: async (targetPool, targetSchema) => {
      const conn = await targetPool.getConnection();
      try {
        const schema = targetSchema || 'public';
        const ddlFile = path.resolve(__dirname, './20261110_create_tenant_branding.sql');
        const rawDdl = fs.readFileSync(ddlFile, 'utf8');
        const schemaDdl = rawDdl.replace(/\{\{SCHEMA\}\}/g, schema);
        const stmts = parseSqlStatements(schemaDdl);
        for (const s of stmts) {
          await conn.query(s);
        }
      } finally {
        conn.release();
      }
    }
  },
  {
    version: '20261110_phase2h_user_token_version',
    description: 'Control de revocación de sesiones e invalidación de JWT via token_version en usuarios',
    execute: async (targetPool, targetSchema) => {
      return upUserTokenVersion(targetPool, targetSchema);
    }
  },
  {
    version: '20261110_job_nonces_and_strict_idempotency',
    description: 'Tabla global job_request_nonces y conversión estricta de idempotency_keys a tenant_id UUID con FK hacia tenants(id)',
    execute: async (targetPool, targetSchema) => {
      return upJobNoncesAndStrictIdempotency(targetPool, targetSchema);
    }
  },
  {
    version: '20261110_phase3b_storage_and_portability',
    description: 'Tablas private_files y tenant_exports, referencias cifradas para asistencia y contratos (REM-P1-10, P1-11, P1-17)',
    execute: async (targetPool, targetSchema) => {
      return upStorageAndPortability(targetPool, targetSchema);
    }
  },
  {
    version: '20261110_phase3b_p2p3_extensions',
    description: 'Toma física de inventario (REM-P2-03), retención dry-run (REM-P2-09), arqueo de caja (REM-P2-02) e índices compuestos (REM-P2-08)',
    execute: async (targetPool, targetSchema) => {
      return upP2P3Extensions(targetPool, targetSchema);
    }
  },
  {
    version: '20261111_phase3c_clients_in_base_plan',
    description: 'Incluye Clientes/CRM (clients) en Plan BASE conservándolo en PRO; membresías, contratos y marketing siguen exclusivos de PRO',
    execute: async (targetPool, targetSchema) => {
      return upClientsInBasePlan(targetPool, targetSchema);
    }
  },
  {
    version: '20261114_unify_catalog_inventory',
    description: 'Unifica Catálogo (services) como fuente única de productos y servicios y reapunta FKs de inventario hacia services(id)',
    execute: async (targetPool, targetSchema) => {
      return upUnifyCatalogInventory(targetPool, targetSchema);
    }
  },
  {
    version: '20261114_catalog_categories_and_inventory_alerts',
    description: 'Vincula services.commission_category_id a commission_categories y agrega configuración/overrides/estado de alertas de inventario',
    execute: async (targetPool, targetSchema) => {
      return upCatalogCategoriesAndAlerts(targetPool, targetSchema);
    }
  },
  {
    version: '20261115_saas_fx_rates',
    description: 'Tablas globales saas_fx_rates y saas_fx_rate_history para tasa manual USD -> DOP',
    execute: async (targetPool, targetSchema) => {
      return upSaasFxRates(targetPool, targetSchema);
    }
  },
  {
    version: '20261115_tenant_terms_and_welcome',
    description: 'Tablas tenant_terms_acceptances y tenant_welcome_email_queue para términos versionados y correos de bienvenida',
    execute: async (targetPool, targetSchema) => {
      return upTenantTermsAndWelcome(targetPool, targetSchema);
    }
  },
  {
    version: '20261115_rbac_hardening',
    description: 'Columnas authorized_branch_ids, all_branches_access, allow_admin_role_delegation e índice único por tenant en roles',
    execute: async (targetPool, targetSchema) => {
      return upRbacHardening(targetPool, targetSchema);
    }
  },
  {
    version: '20261116_platform_email_settings',
    description: 'Tabla global platform_email_settings para configuración SMTP de plataforma (SuperAdmin)',
    execute: async (targetPool, targetSchema) => {
      return upPlatformEmailSettings(targetPool, targetSchema);
    }
  },
  {
    version: '20261116_print_templates_and_turn_tickets',
    description: 'Tablas print_templates, turn_ticket_counters y turn_tickets para diseñador de impresión y turnos Car Wash',
    execute: async (targetPool, targetSchema) => {
      return upPrintTemplatesAndTurnTickets(targetPool, targetSchema);
    }
  },
  {
    version: '20261117_kiosk_devices_hardening',
    description: 'Tablas kiosk_devices y kiosk_employee_sessions, modo biométrico por empresa e idempotencia de ponches',
    execute: async (targetPool, targetSchema) => {
      return upKioskDevicesHardening(targetPool, targetSchema);
    }
  },
  {
    version: '20261120_schedule_overrides_unique_tenant_emp_date',
    description: 'Archivo de duplicados schedule_overrides_dedup_archive e índice único (tenant_id, employee_id, date) en schedule_overrides',
    execute: async (targetPool, targetSchema) => {
      const c = await targetPool.getConnection();
      try {
        await c.query(`SET search_path TO "${targetSchema || 'public'}";`);
        return await upScheduleOverridesUnique(c);
      } finally {
        c.release();
      }
    }
  },
  {
    version: '20261121_reconcile_saas_billing_schema_drift',
    description: 'Reconciliación incremental de deriva de esquema SaaS billing, backfills seguros sin activar recurrencia, saas_renewal_runs, saas_checkout_orders y checksums',
    execute: async (targetPool, targetSchema) => {
      return upReconcileSaasBillingDrift(targetPool, targetSchema);
    }
  }
];

async function migrateAll(options = {}) {
  const targetPool = options.pool || defaultPool;
  const targetSchema = options.targetSchema || 'public';
  const quiet = Boolean(options.quiet);
  const checksumOverrides = options.checksumOverrides || null;

  if (!quiet) {
    console.log('========================================================================');
    console.log(`🚀 EJECUTANDO MIGRATION RUNNER CANÓNICO (ESQUEMA: "${targetSchema}")`);
    console.log('========================================================================\n');
  }

  const conn = await targetPool.getConnection();
  try {
    const schema = targetSchema || 'public';
    await conn.query(`SET search_path TO "${schema}";`);

    // Dedicated connection adapter ensuring any connection acquired by migrations explicitly applies target schema
    const dedicatedTargetPool = {
      async getConnection() {
        const c = await targetPool.getConnection();
        await c.query(`SET search_path TO "${schema}";`);
        const origRelease = c.release.bind(c);
        c.release = async (...args) => {
          try {
            await c.query('SET search_path TO public;');
          } catch (_) {}
          return origRelease(...args);
        };
        return c;
      },
      async query(sql, params) {
        await conn.query(`SET search_path TO "${schema}";`);
        return conn.query(sql, params);
      }
    };

    // 1. Asegurar tabla schema_migrations con soporte de checksum SHA-256
    await conn.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".schema_migrations (
        version VARCHAR(100) PRIMARY KEY,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        actor VARCHAR(100) NOT NULL,
        status VARCHAR(50) NOT NULL,
        checksum VARCHAR(64)
      );
    `);
    await conn.query(`
      ALTER TABLE "${schema}".schema_migrations
      ADD COLUMN IF NOT EXISTS checksum VARCHAR(64);
    `);

    // 2. Consultar migraciones ya aplicadas y sus checksums
    const [appliedRows] = await conn.query(
      `SELECT version, checksum FROM "${schema}".schema_migrations WHERE status IN ('APPLIED', 'applied', 'RE_VERIFIED');`
    );
    const appliedMap = new Map(appliedRows.map(r => [r.version, r.checksum || null]));

    let executedCount = 0;
    let adoptedChecksumsCount = 0;

    for (const mig of MIGRATIONS_REGISTRY) {
      const overrideContent = checksumOverrides && Object.prototype.hasOwnProperty.call(checksumOverrides, mig.version)
        ? checksumOverrides[mig.version]
        : null;
      const currentChecksum = computeMigrationChecksum(mig.version, overrideContent);

      if (appliedMap.has(mig.version)) {
        const recordedChecksum = appliedMap.get(mig.version);
        if (!recordedChecksum) {
          // Adopción explícita y auditable del historial existente previo a la columna checksum
          await conn.query(
            `UPDATE "${schema}".schema_migrations SET checksum = ? WHERE version = ?`,
            [currentChecksum, mig.version]
          );
          appliedMap.set(mig.version, currentChecksum);
          adoptedChecksumsCount++;
          if (!quiet) {
            console.log(`  🔐 [CHECKSUM ADOPTADO] "${mig.version}" -> ${currentChecksum.slice(0, 12)}...`);
          }
        } else if (recordedChecksum !== currentChecksum) {
          const err = new Error(
            `MIGRATION_CHECKSUM_MISMATCH: La migración aplicada "${mig.version}" fue modificada después de su aplicación ` +
            `(registrado=${recordedChecksum}, actual=${currentChecksum}). Cree una nueva migración incremental en lugar de editar el historial.`
          );
          err.code = 'MIGRATION_CHECKSUM_MISMATCH';
          err.migrationVersion = mig.version;
          err.recordedChecksum = recordedChecksum;
          err.actualChecksum = currentChecksum;
          throw err;
        } else if (!quiet) {
          console.log(`  ⏩ [OMITIDA / CHECKSUM OK] Migración "${mig.version}" ya aplicada.`);
        }
        continue;
      }

      if (!quiet) {
        console.log(`\n▶️ [APLICANDO] ${mig.version}: ${mig.description}...`);
      }

      await conn.query(`SET search_path TO "${schema}";`);
      await mig.execute(dedicatedTargetPool, schema);
      await conn.query(`SET search_path TO "${schema}";`);

      // Registrar versión aplicada con su checksum SHA-256
      await conn.query(`
        INSERT INTO "${schema}".schema_migrations (version, actor, status, checksum)
        VALUES (?, 'canonical_migrate_all_runner', 'applied', ?)
        ON CONFLICT (version) DO UPDATE
        SET applied_at = NOW(), status = 'applied', checksum = EXCLUDED.checksum;
      `, [mig.version, currentChecksum]);

      appliedMap.set(mig.version, currentChecksum);
      executedCount++;

      if (!quiet) {
        console.log(`  ✅ [OK] ${mig.version} completada y registrada en schema_migrations (sha256=${currentChecksum.slice(0, 12)}...).`);
      }
    }

    if (!quiet) {
      console.log(`\n🎉 PROCESO DE MIGRACIÓN COMPLETADO: ${executedCount} migraciones ejecutadas, ${adoptedChecksumsCount} checksums históricos adoptados (${appliedMap.size} registradas en total).\n`);
    }

    return {
      success: true,
      appliedCount: executedCount,
      adoptedChecksumsCount,
      totalRegistered: appliedMap.size
    };
  } catch (err) {
    console.error('\n❌ [FATAL MIGRATION RUNNER ERROR]: Fallo durante la ejecución de migraciones:', err.message);
    throw err;
  } finally {
    try {
      await conn.query('SET search_path TO public;');
    } catch (_) {}
    conn.release();
  }
}

if (require.main === module) {
  migrateAll()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = {
  migrateAll,
  MIGRATIONS_REGISTRY,
  MIGRATION_SOURCE_FILES,
  computeMigrationChecksum
};

