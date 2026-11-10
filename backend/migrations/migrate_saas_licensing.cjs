const { pool } = require('../db');

async function runMigration() {
  console.log('🔄 Ejecutando migración del modelo de 2 Planes SaaS (Plan Base y Plan Pro)...');
  try {
    // 1. Añadir columnas a saas_plans
    await pool.query(`
      ALTER TABLE saas_plans 
      ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS users_per_branch INT DEFAULT 3,
      ADD COLUMN IF NOT EXISTS extra_user_price DECIMAL(10,2) DEFAULT 15.00,
      ADD COLUMN IF NOT EXISTS price_per_branch DECIMAL(10,2) DEFAULT 49.00,
      ADD COLUMN IF NOT EXISTS description TEXT;
    `);
    console.log('✅ Columnas en saas_plans actualizadas.');

    // 2. Añadir columnas a tenants
    await pool.query(`
      ALTER TABLE tenants
      ADD COLUMN IF NOT EXISTS plan_id INT REFERENCES saas_plans(id),
      ADD COLUMN IF NOT EXISTS licensed_branches INT DEFAULT 1,
      ADD COLUMN IF NOT EXISTS extra_user_seats INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS memberships_price DECIMAL(10,2) DEFAULT 0.00;
    `);
    console.log('✅ Columnas en tenants actualizadas.');

    const baseFeatures = JSON.stringify({
      pos: true,
      cajas: true,
      services_catalog: true,
      inventory: true,
      payroll: true,
      attendance: true,
      dgii_ecf: true,
      reports: true,
      clients: false,
      memberships: false
    });

    const proFeatures = JSON.stringify({
      pos: true,
      cajas: true,
      services_catalog: true,
      inventory: true,
      payroll: true,
      attendance: true,
      dgii_ecf: true,
      reports: true,
      clients: true,
      memberships: true
    });

    // 3. Asegurar los 2 únicos planes oficiales: 'base' y 'pro'
    // Si existía 'starter' o 'salon-pro-base', normalizar el primero a 'base'
    const [existingBase] = await pool.query(`SELECT id FROM saas_plans WHERE code = 'base'`);
    if (existingBase.length === 0) {
      const [starterRow] = await pool.query(`SELECT id FROM saas_plans WHERE code IN ('starter', 'salon-pro-base') ORDER BY id ASC LIMIT 1`);
      if (starterRow.length > 0) {
        await pool.query(`
          UPDATE saas_plans SET
            name = 'Plan Base',
            code = 'base',
            description = 'Plan operativo de salón: Facturación, POS (Consumidor Final), Catálogo de Productos y Servicios, Cajas Registradoras y Creación de Usuarios. No permite registrar clientes ni suscripciones.',
            price = 49.00,
            price_per_branch = 49.00,
            users_per_branch = 3,
            extra_user_price = 15.00,
            is_public = TRUE,
            is_active = TRUE,
            included_features = $1::jsonb
          WHERE id = $2
        `, [baseFeatures, starterRow[0].id]);
      } else {
        await pool.query(`
          INSERT INTO saas_plans (
            name, code, description, price, price_per_branch, billing_cycle,
            users_per_branch, extra_user_price, max_branches, max_employees,
            is_public, is_active, included_features
          ) VALUES (
            'Plan Base', 'base',
            'Plan operativo de salón: Facturación, POS (Consumidor Final), Catálogo de Productos y Servicios, Cajas Registradoras y Creación de Usuarios. No permite registrar clientes ni suscripciones.',
            49.00, 49.00, 'monthly', 3, 15.00, 1, 3, TRUE, TRUE, $1::jsonb
          )
        `, [baseFeatures]);
      }
    } else {
      await pool.query(`
        UPDATE saas_plans SET
          name = 'Plan Base',
          description = 'Plan operativo de salón: Facturación, POS (Consumidor Final), Catálogo de Productos y Servicios, Cajas Registradoras y Creación de Usuarios. No permite registrar clientes ni suscripciones.',
          price = 49.00,
          price_per_branch = 49.00,
          users_per_branch = 3,
          extra_user_price = 15.00,
          is_public = TRUE,
          is_active = TRUE,
          included_features = $1::jsonb
        WHERE code = 'base'
      `, [baseFeatures]);
    }

    const [existingPro] = await pool.query(`SELECT id FROM saas_plans WHERE code = 'pro'`);
    if (existingPro.length === 0) {
      await pool.query(`
        INSERT INTO saas_plans (
          name, code, description, price, price_per_branch, billing_cycle,
          users_per_branch, extra_user_price, max_branches, max_employees,
          is_public, is_active, included_features
        ) VALUES (
          'Plan Pro', 'pro',
          'Plan completo con Clientes y Suscripciones (Plan Beauty): Incluye todo el Plan Base + Registro de Clientes, Directorio CRM, Membresías Recurrentes, Contratos Digitales, Pagos Automáticos y Gift Cards.',
          99.00, 99.00, 'monthly', 3, 15.00, 1, 3, TRUE, TRUE, $1::jsonb
        )
      `, [proFeatures]);
    } else {
      await pool.query(`
        UPDATE saas_plans SET
          name = 'Plan Pro',
          description = 'Plan completo con Clientes y Suscripciones (Plan Beauty): Incluye todo el Plan Base + Registro de Clientes, Directorio CRM, Membresías Recurrentes, Contratos Digitales, Pagos Automáticos y Gift Cards.',
          price = 99.00,
          price_per_branch = 99.00,
          users_per_branch = 3,
          extra_user_price = 15.00,
          is_public = TRUE,
          is_active = TRUE,
          included_features = $1::jsonb
        WHERE code = 'pro'
      `, [proFeatures]);
    }

    // Obtener IDs oficiales de Plan Base y Plan Pro
    const [basePlanRows] = await pool.query(`SELECT id FROM saas_plans WHERE code = 'base' LIMIT 1`);
    const [proPlanRows] = await pool.query(`SELECT id FROM saas_plans WHERE code = 'pro' LIMIT 1`);
    const basePlanId = basePlanRows[0]?.id;
    const proPlanId = proPlanRows[0]?.id;

    // Reasignar cualquier tenant que apuntara a planes obsoletos ('enterprise', 'salon-pro-base', etc.)
    if (basePlanId && proPlanId) {
      await pool.query(`
        UPDATE tenants
        SET plan_id = CASE WHEN has_memberships = TRUE THEN $1 ELSE $2 END
        WHERE plan_id IS NULL OR plan_id NOT IN ($1, $2)
      `, [proPlanId, basePlanId]);

      // Eliminar planes obsoletos que no sean 'base' ni 'pro'
      await pool.query(`DELETE FROM saas_plans WHERE code NOT IN ('base', 'pro')`);

      // Sincronizar flag has_memberships según el plan asignado ('pro' -> true, 'base' -> false)
      await pool.query(`
        UPDATE tenants
        SET has_memberships = (plan_id = $1),
            licensed_branches = COALESCE(licensed_branches, 1),
            extra_user_seats = COALESCE(extra_user_seats, 0)
      `, [proPlanId]);
    }

    console.log('✅ Planes consolidados exclusivamente en 2 niveles: Plan Base y Plan Pro.');
    console.log('🎉 Migración completada con éxito.');
  } catch (err) {
    console.error('❌ Error en migración:', err);
    throw err;
  } finally {
    await pool.end();
  }
}

runMigration().catch(err => {
  process.exit(1);
});
