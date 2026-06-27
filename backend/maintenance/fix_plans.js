const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createConnection({
    host: '2.24.86.39', port: 3306,
    user: 'salon_admin', password: 'SalonPro2024!',
    database: 'u566429295_salonpro'
  });

  console.log('✅ Conectado - Revisando tabla plans...');

  // Ver columnas actuales
  const [cols] = await db.execute('SHOW COLUMNS FROM plans');
  console.log('Columnas actuales:', cols.map(c => c.Field).join(', '));

  // Columnas que puede necesitar la tabla plans
  const missingCols = [
    { name: 'contract_services', def: 'JSON' },
    { name: 'servicios', def: 'JSON' },
    { name: 'benefits', def: 'JSON' },
    { name: 'beneficios', def: 'JSON' },
    { name: 'features', def: 'JSON' },
    { name: 'descripcion', def: 'TEXT' },
    { name: 'description', def: 'TEXT' },
    { name: 'active', def: 'TINYINT(1) DEFAULT 1' },
    { name: 'activo', def: 'TINYINT(1) DEFAULT 1' },
    { name: 'color', def: "VARCHAR(20) DEFAULT '#000000'" },
    { name: 'icon', def: 'VARCHAR(50) DEFAULT NULL' },
    { name: 'max_visits', def: 'INT DEFAULT NULL' },
    { name: 'visitas_mes', def: 'INT DEFAULT NULL' },
    { name: 'duration_days', def: 'INT DEFAULT 30' },
    { name: 'stripe_price_id', def: 'VARCHAR(100) DEFAULT NULL' },
  ];

  for (const col of missingCols) {
    try {
      await db.execute(`ALTER TABLE plans ADD COLUMN ${col.name} ${col.def}`);
      console.log(`✅ plans.${col.name} agregada`);
    } catch (e) {
      console.log(`ℹ️  plans.${col.name} ya existe`);
    }
  }

  // Ver planes actuales y actualizar con datos básicos
  const [plans] = await db.execute('SELECT * FROM plans');
  console.log('\nPlanes actuales:', plans.length);

  for (const plan of plans) {
    await db.execute(
      `UPDATE plans SET 
        contract_services = ?,
        beneficios = ?,
        benefits = ?,
        activo = 1,
        active = 1
       WHERE id = ?`,
      [
        JSON.stringify(['Lavado', 'Tratamiento', 'Peinado']),
        JSON.stringify(['Descuento especial', 'Atención prioritaria']),
        JSON.stringify(['Descuento especial', 'Atención prioritaria']),
        plan.id
      ]
    );
  }
  console.log('✅ Planes actualizados con contract_services');

  const [updatedPlans] = await db.execute('SELECT id, title, price, contract_services FROM plans');
  console.log('Planes:', JSON.stringify(updatedPlans, null, 2));

  await db.end();
  console.log('\n🎉 Listo! Intenta guardar el plan de nuevo.');
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
