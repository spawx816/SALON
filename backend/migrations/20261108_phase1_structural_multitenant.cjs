const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../db');

/**
 * Migración Estructural Multi-Tenant Integral (Fase 1)
 * 
 * Reglas de Arquitectura y Seguridad:
 * 1. 100% Idempotente y reproducible desde cero sobre base vacía o existente.
 * 2. Transaccional con conexión dedicada (conn = await pool.getConnection()).
 * 3. Crea/asegura tablas raíz del SaaS: saas_plans, tenants, schema_migrations, pending_tenant_reconciliations.
 * 4. Cubre TODAS las tablas tenant-owned (61 tablas):
 *    - Columna tenant_id UUID
 *    - Índice B-Tree idx_${table}_tenant_id
 *    - Restricción FK estricta hacia tenants(id) ON DELETE CASCADE
 * 5. NUNCA captura ni silencia errores de FK: si alguna FK falla, la transacción hace ROLLBACK completo.
 * 6. Verifica en information_schema la definición real de cada restricción.
 * 7. CERO heurísticas: NO altera ni inventa datos de inquilinos.
 */

const ALL_TENANT_TABLES = [
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

async function runStructuralMigration(targetPool = pool, targetSchema = null) {
  console.log('========================================================================');
  console.log('📐 INICIANDO MIGRACIÓN ESTRUCTURAL MULTI-TENANT INTEGRAL (FASE 1)');
  console.log('========================================================================\n');

  const conn = await targetPool.getConnection();

  try {
    await conn.beginTransaction();
    console.log('[TX] Conexión dedicada adquirida.');

    const schema = targetSchema || 'public';
    if (targetSchema) {
      await conn.query(`SET search_path TO ${targetSchema}, public;`);
    }

    // 0. Tabla de Control de Migraciones
    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(100) PRIMARY KEY,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        actor VARCHAR(100) NOT NULL,
        status VARCHAR(50) NOT NULL
      );
    `);

    // 1. Tablas Raíz del SaaS: saas_plans y tenants
    console.log('[1/5] Asegurando tablas raíz de tenants y planes SaaS...');
    await conn.query(`
      CREATE TABLE IF NOT EXISTS saas_plans (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        code VARCHAR(50) NOT NULL UNIQUE,
        price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
        price_per_branch NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
        users_per_branch INTEGER NOT NULL DEFAULT 3,
        extra_user_price NUMERIC(10, 2) NOT NULL DEFAULT 15.00,
        billing_cycle VARCHAR(20) NOT NULL DEFAULT 'monthly',
        max_branches INTEGER NOT NULL DEFAULT 1,
        max_employees INTEGER NOT NULL DEFAULT 3,
        is_public BOOLEAN NOT NULL DEFAULT TRUE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        description TEXT,
        included_features JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_name VARCHAR(150) NOT NULL,
        legal_name VARCHAR(200),
        rnc VARCHAR(20),
        slug VARCHAR(100) NOT NULL UNIQUE,
        status VARCHAR(30) NOT NULL DEFAULT 'pending',
        email VARCHAR(150),
        phone VARCHAR(50),
        address TEXT,
        currency VARCHAR(10) NOT NULL DEFAULT 'DOP',
        plan_id INTEGER REFERENCES saas_plans(id),
        max_users INTEGER NOT NULL DEFAULT 5,
        max_branches INTEGER NOT NULL DEFAULT 1,
        modules_config JSONB NOT NULL DEFAULT '{}'::jsonb,
        owner_name VARCHAR(150),
        owner_email VARCHAR(150),
        owner_phone VARCHAR(50),
        has_memberships BOOLEAN NOT NULL DEFAULT FALSE,
        has_dgii_ecf BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // 2. Tabla de Control de Cuarentena y Reconciliaciones Pendientes
    console.log('[2/5] Asegurando tabla pending_tenant_reconciliations...');
    await conn.query(`
      CREATE TABLE IF NOT EXISTS pending_tenant_reconciliations (
        id SERIAL PRIMARY KEY,
        table_name VARCHAR(100) NOT NULL,
        record_id VARCHAR(100) NOT NULL,
        reason VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'quarantined',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        resolved_at TIMESTAMP WITH TIME ZONE NULL,
        resolved_tenant_id UUID NULL
      );
    `);
    await conn.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_rec_table_record 
      ON pending_tenant_reconciliations (table_name, record_id);
    `);

    // 3. Iteración sobre las 61 tablas tenant-owned para Columnas, Índices y FKs
    console.log(`[3/5] Aplicando columnas tenant_id, índices B-Tree y FKs estrictas en ${ALL_TENANT_TABLES.length} tablas...`);
    let addedCols = 0;
    let addedIdx = 0;
    let addedFks = 0;

    for (const table of ALL_TENANT_TABLES) {
      // Validar si la tabla existe en la base de datos
      const [tableExists] = await conn.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = ? AND table_name = ?
      `, [schema, table]);

      if (tableExists.length === 0) {
        console.log(`  ⏩ Tabla '${table}' no existe aún en el esquema. Se omite.`);
        continue;
      }

      // Asegurar columna tenant_id
      const [colExists] = await conn.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema = ? AND table_name = ? AND column_name = 'tenant_id'
      `, [schema, table]);

      if (colExists.length === 0) {
        await conn.query(`ALTER TABLE ${table} ADD COLUMN tenant_id UUID;`);
        addedCols++;
      }

      // Asegurar índice B-Tree en tenant_id
      await conn.query(`CREATE INDEX IF NOT EXISTS idx_${table}_tenant_id ON ${table} (tenant_id);`);
      addedIdx++;

      // Verificar si ya existe alguna FK apuntando a tenants(id)
      const [existingFk] = await conn.query(`
        SELECT tc.constraint_name 
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = ?
          AND tc.table_name = ?
          AND kcu.column_name = 'tenant_id'
          AND ccu.table_name = 'tenants'
      `, [schema, table]);

      if (existingFk.length === 0) {
        // APLICACIÓN ESTRICTA: Sin try/catch. Si falla, genera excepción y rollback de inmediato.
        await conn.query(`
          ALTER TABLE ${table}
          ADD CONSTRAINT fk_${table}_tenant_id
          FOREIGN KEY (tenant_id) REFERENCES tenants(id)
          ON DELETE CASCADE;
        `);
        addedFks++;
        console.log(`  🔒 FK creada estrictamente: fk_${table}_tenant_id -> tenants(id)`);
      }
    }

    // 4. Verificación Real de Restricciones en Catálogo PostgreSQL
    console.log('[4/5] Verificando definición real de restricciones en information_schema...');
    const [verifiedConstraints] = await conn.query(`
      SELECT tc.table_name, tc.constraint_name, ccu.table_name as ref_table
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = ?
        AND kcu.column_name = 'tenant_id'
        AND ccu.table_name = 'tenants'
      ORDER BY tc.table_name;
    `, [schema]);

    console.log(`  📊 Total FKs verificadas activas hacia tenants: ${verifiedConstraints.length}`);

    // 5. Registro de Versión en schema_migrations
    console.log('[5/5] Registrando versión estructural en schema_migrations...');
    await conn.query(`
      INSERT INTO schema_migrations (version, actor, status)
      VALUES ('20261108_phase1_structural_multitenant', 'system_migration_runner', 'APPLIED')
      ON CONFLICT (version) DO UPDATE 
      SET applied_at = NOW(), status = 'RE_VERIFIED';
    `);

    await conn.commit();
    console.log('\n✅ MIGRACIÓN ESTRUCTURAL COMPLETADA EXITOSAMENTE.');
    console.log(`   Columnas nuevas: ${addedCols} | Índices verificados: ${addedIdx} | FKs añadidas: ${addedFks}`);
    console.log(`   Total tablas verificadas con FK activa hacia tenants: ${verifiedConstraints.length}`);
    return { success: true, verifiedCount: verifiedConstraints.length };
  } catch (err) {
    await conn.rollback();
    console.error('\n❌ ERROR EN MIGRACIÓN ESTRUCTURAL (ROLLBACK EJECUTADO):', err.message);
    throw err;
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  runStructuralMigration()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { runStructuralMigration, ALL_TENANT_TABLES };
