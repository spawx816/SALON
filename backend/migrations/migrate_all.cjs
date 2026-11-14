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
  }
];

async function migrateAll(options = {}) {
  const targetPool = options.pool || defaultPool;
  const targetSchema = options.targetSchema || 'public';
  const quiet = Boolean(options.quiet);

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
        return c;
      },
      async query(sql, params) {
        return conn.query(sql, params);
      }
    };

    // 1. Asegurar tabla schema_migrations
    await conn.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".schema_migrations (
        version VARCHAR(100) PRIMARY KEY,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        actor VARCHAR(100) NOT NULL,
        status VARCHAR(50) NOT NULL
      );
    `);

    // 2. Consultar migraciones ya aplicadas
    const [appliedRows] = await conn.query(`SELECT version FROM "${schema}".schema_migrations WHERE status IN ('APPLIED', 'applied', 'RE_VERIFIED');`);
    const appliedSet = new Set(appliedRows.map(r => r.version));

    let executedCount = 0;

    for (const mig of MIGRATIONS_REGISTRY) {
      if (appliedSet.has(mig.version)) {
        if (!quiet) {
          console.log(`  ⏩ [OMITIDA] Migración "${mig.version}" ya aplicada.`);
        }
        continue;
      }

      if (!quiet) {
        console.log(`\n▶️ [APLICANDO] ${mig.version}: ${mig.description}...`);
      }

      await mig.execute(dedicatedTargetPool, schema);

      // Registrar versión aplicada
      await conn.query(`
        INSERT INTO "${schema}".schema_migrations (version, actor, status)
        VALUES (?, 'canonical_migrate_all_runner', 'applied')
        ON CONFLICT (version) DO UPDATE
        SET applied_at = NOW(), status = 'applied';
      `, [mig.version]);

      appliedSet.add(mig.version);
      executedCount++;

      if (!quiet) {
        console.log(`  ✅ [OK] ${mig.version} completada y registrada en schema_migrations.`);
      }
    }

    if (!quiet) {
      console.log(`\n🎉 PROCESO DE MIGRACIÓN COMPLETADO: ${executedCount} migraciones ejecutadas (${appliedSet.size} registradas en total).\n`);
    }

    return {
      success: true,
      appliedCount: executedCount,
      totalRegistered: appliedSet.size
    };
  } catch (err) {
    console.error('\n❌ [FATAL MIGRATION RUNNER ERROR]: Fallo durante la ejecución de migraciones:', err.message);
    throw err;
  } finally {
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
  MIGRATIONS_REGISTRY
};

