const { pool } = require('../db');

async function setPlans() {
  console.log('🔄 Setting up SaaS plans in PostgreSQL...');
  
  // 1. Starter POS
  await pool.query(`
    UPDATE saas_plans SET
      name = 'Starter POS',
      price = 29.00,
      price_per_branch = 29.00,
      users_per_branch = 2,
      extra_user_price = 15.00,
      description = 'Para salones individuales o barberías que inician. Incluye punto de venta POS, control de cajas y directorio de clientes.',
      is_public = TRUE,
      is_active = TRUE,
      included_features = '{"pos": true, "cajas": true, "clients": true, "services_catalog": true, "inventory": false, "payroll": false, "attendance": false, "dgii_ecf": false, "reports": false, "memberships": false}'::jsonb
    WHERE id = 1
  `);

  // 2. Salon Pro Base
  await pool.query(`
    UPDATE saas_plans SET
      name = 'Plan Base Salon Pro',
      price = 49.00,
      price_per_branch = 49.00,
      users_per_branch = 3,
      extra_user_price = 15.00,
      description = 'Plan todo incluido para salones: POS, Inventario, Nómina, Kiosco de Asistencia, DGII e-CF y Reportes. Membresías se vende como Add-on aparte.',
      is_public = TRUE,
      is_active = TRUE,
      included_features = '{"pos": true, "cajas": true, "clients": true, "services_catalog": true, "inventory": true, "payroll": true, "attendance": true, "dgii_ecf": true, "reports": true, "memberships": false}'::jsonb
    WHERE id = 4
  `);

  // 3. Enterprise Multi-Sede
  await pool.query(`
    UPDATE saas_plans SET
      name = 'Enterprise Multi-Sede',
      price = 99.00,
      price_per_branch = 99.00,
      users_per_branch = 5,
      extra_user_price = 12.00,
      description = 'Para cadenas y franquicias en expansión. Todo incluido con 5 usuarios base por sede, facturación DGII e-CF y módulo Plan Beauty incluido.',
      is_public = TRUE,
      is_active = TRUE,
      included_features = '{"pos": true, "cajas": true, "clients": true, "services_catalog": true, "inventory": true, "payroll": true, "attendance": true, "dgii_ecf": true, "reports": true, "memberships": true}'::jsonb
    WHERE id = 3
  `);

  // Plan 2 lo dejamos como Grandfathered (is_public = false) para probar el badge en el admin
  await pool.query(`
    UPDATE saas_plans SET
      is_public = FALSE,
      is_active = TRUE
    WHERE id = 2
  `);

  console.log('✅ Planes configurados con diferentes features, precios y cuotas!');
  await pool.end();
}

setPlans().catch(err => {
  console.error(err);
  process.exit(1);
});
