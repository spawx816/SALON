/**
 * Migration: 20261113_single_plan_and_memberships_addon
 *
 * Transición al modelo comercial de un único Plan Principal + Add-on independiente de Suscripciones/Membresías B2C:
 *   1. Registra el Plan Principal (`PRINCIPAL`) en `saas_plans` y `saas_plan_features`.
 *   2. Migra suscripciones activas/existentes de `BASE` y `PRO` hacia `PRINCIPAL` sin generar cargos ni modificar facturas históricas.
 *   3. Preserva el acceso a `memberships` de los tenants `PRO` existentes mediante un entitlement de transición explícito y auditable (`legacy_pro_transition`) en `tenant_feature_overrides`.
 *   4. Es 100% idempotente y re-ejecutable.
 */

'use strict';

async function up(targetPool, targetSchema = 'public') {
  const conn = await targetPool.getConnection();
  try {
    const schema = targetSchema || 'public';
    await conn.query(`SET search_path TO "${schema}";`);
    await conn.beginTransaction();

    console.log(`[MIGRATION 20261113_single_plan_and_memberships_addon] Iniciando transición en esquema "${schema}"...`);

    // 1. Asegurar feature `memberships` marcada como add-on y features generales en `core`
    const features = [
      ['pos', 'Punto de Venta (POS)', 'Facturación POS y cobro en recepción', 'core'],
      ['cash_registers', 'Cajas Registradoras', 'Control de apertura, cierre y arqueo de cajas', 'core'],
      ['services_catalog', 'Catálogo de Servicios', 'Gestión de servicios y precios', 'core'],
      ['inventory', 'Inventario Operativo', 'Control de stock e insumos', 'core'],
      ['inventory_advanced', 'Inventario Avanzado Multisucursal', 'Compras, proveedores y transferencias multisucursal', 'core'],
      ['commissions', 'Comisiones', 'Cálculo de comisiones por empleado', 'core'],
      ['payroll', 'Nómina', 'Gestión de nómina y deducciones', 'core'],
      ['attendance', 'Asistencia', 'Control de asistencia del personal', 'core'],
      ['expenses', 'Egresos y Gastos', 'Registro y control de gastos operativos', 'core'],
      ['dgii_ecf', 'Comprobantes Fiscales DGII e-CF', 'Emisión y reportes fiscales 606/607/IT-1', 'core'],
      ['reports', 'Reportes y Analítica', 'Reportes financieros y operativos', 'core'],
      ['security', 'Seguridad y PIN', 'Control de autorizaciones y auditoría', 'core'],
      ['clients', 'Directorio CRM de Clientes', 'Fichas de clientes, historial y preferencias', 'core'],
      ['marketing', 'Marketing', 'Campañas y comunicación comercial', 'core'],
      ['memberships', 'Suscripciones y Membresías B2C', 'Add-on independiente: planes, contratos digitales y cobros recurrentes B2C', 'addon'],
    ];

    for (const [key, name, description, category] of features) {
      await conn.query(
        `INSERT INTO saas_features (key, name, description, category)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (key) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           category = EXCLUDED.category
         RETURNING key`,
        [key, name, description, category]
      );
    }

    // 2. Asegurar Plan Principal en `saas_plans`
    await conn.query(`
      INSERT INTO saas_plans (name, code, price, price_per_branch, billing_cycle, users_per_branch, extra_user_price, max_branches, max_employees, is_public, is_active, description)
      VALUES (
        'Plan Principal',
        'PRINCIPAL',
        0,
        0,
        'monthly',
        3,
        0,
        1,
        3,
        true,
        true,
        'Plan Principal único de Etereas: POS, cajas, DGII e-CF, Clientes/CRM, inventario avanzado, nómina, comisiones, marketing y reportes.'
      )
      ON CONFLICT (code) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        is_public = true,
        is_active = true
      RETURNING id
    `);

    // 3. Matriz `saas_plan_features` para `PRINCIPAL`
    const principalMappings = [
      ['PRINCIPAL', 'pos', true],
      ['PRINCIPAL', 'cash_registers', true],
      ['PRINCIPAL', 'services_catalog', true],
      ['PRINCIPAL', 'inventory', true],
      ['PRINCIPAL', 'inventory_advanced', true],
      ['PRINCIPAL', 'commissions', true],
      ['PRINCIPAL', 'payroll', true],
      ['PRINCIPAL', 'attendance', true],
      ['PRINCIPAL', 'expenses', true],
      ['PRINCIPAL', 'dgii_ecf', true],
      ['PRINCIPAL', 'reports', true],
      ['PRINCIPAL', 'security', true],
      ['PRINCIPAL', 'clients', true],
      ['PRINCIPAL', 'marketing', true],
      ['PRINCIPAL', 'memberships', false],
    ];
    for (const [planCode, featureKey, isIncluded] of principalMappings) {
      await conn.query(
        `INSERT INTO saas_plan_features (plan_code, feature_key, is_included)
         VALUES ($1, $2, $3)
         ON CONFLICT (plan_code, feature_key) DO UPDATE SET is_included = EXCLUDED.is_included
         RETURNING feature_key`,
        [planCode, featureKey, isIncluded]
      );
    }

    // 4. Transición auditable de `tenant_subscriptions` (BASE / PRO -> PRINCIPAL)
    const [subsToMigrate] = await conn.query(
      `SELECT tenant_id, plan_code, status
       FROM tenant_subscriptions
       WHERE UPPER(plan_code) IN ('BASE', 'PRO')`
    );

    let migratedBase = 0;
    let migratedPro = 0;

    for (const sub of subsToMigrate) {
      const prevPlan = String(sub.plan_code).toUpperCase();
      const tenantId = sub.tenant_id;

      if (prevPlan === 'PRO') {
        await conn.query(
          `INSERT INTO tenant_feature_overrides (tenant_id, feature_key, is_enabled, reason, actor_id, expires_at, created_at)
           VALUES ($1, 'memberships', true, 'legacy_pro_transition: Permiso heredado de plan PRO previo (transición sin cargo)', 'migration_20261113_single_plan_addon', NULL, NOW())
           ON CONFLICT (tenant_id, feature_key) DO NOTHING
           RETURNING id`,
          [tenantId]
        );
        migratedPro += 1;
      } else {
        migratedBase += 1;
      }

      await conn.query(
        `UPDATE tenant_subscriptions
         SET plan_code = 'PRINCIPAL', updated_at = NOW()
         WHERE tenant_id = $1 AND UPPER(plan_code) IN ('BASE', 'PRO')`,
        [tenantId]
      );

      await conn.query(
        `INSERT INTO tenant_subscription_events (
           tenant_id, previous_plan, new_plan, previous_status, new_status, reason, actor_id, created_at
         ) VALUES ($1, $2, 'PRINCIPAL', $3, $3, $4, 'migration_20261113_single_plan_addon', NOW())
         RETURNING id`,
        [
          tenantId,
          prevPlan,
          sub.status || 'active',
          prevPlan === 'PRO'
            ? 'Transición automática PRO → PRINCIPAL con entitlement legacy_pro_transition para membresías (sin cargo)'
            : 'Transición automática BASE → PRINCIPAL (sin cargo)',
        ]
      );
    }

    await conn.commit();
    console.log(
      `[MIGRATION 20261113_single_plan_and_memberships_addon] Completada. BASE→PRINCIPAL: ${migratedBase}, PRO→PRINCIPAL (con transición membresías): ${migratedPro}`
    );
    return { migratedBase, migratedPro };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function down() {
  // No destructiva: preserva datos históricos y trazabilidad de transición.
  console.log('[MIGRATION 20261113_single_plan_and_memberships_addon] down() es no-op por seguridad de auditoría.');
}

if (require.main === module) {
  const { pool } = require('../db');
  up(pool, process.env.DB_SCHEMA || 'public')
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Migration failed:', err);
      process.exit(1);
    });
}

module.exports = { up, down };
