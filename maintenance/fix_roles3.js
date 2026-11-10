const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createConnection({
    host: '2.24.86.39', port: 3306,
    user: 'salon_admin', password: 'SalonPro2024!',
    database: 'u566429295_salonpro'
  });

  console.log('✅ Conectado - Agregando columnas faltantes a roles...');

  const columnsToAdd = [
    { name: 'permisos', def: 'JSON' },
    { name: 'nivel', def: 'INT DEFAULT 1' },
    { name: 'activo', def: 'TINYINT(1) DEFAULT 1' },
    { name: 'color', def: 'VARCHAR(20) DEFAULT NULL' },
    { name: 'icono', def: 'VARCHAR(50) DEFAULT NULL' }
  ];

  for (const col of columnsToAdd) {
    try {
      await db.execute(`ALTER TABLE roles ADD COLUMN ${col.name} ${col.def}`);
      console.log(`✅ roles.${col.name} agregada`);
    } catch (e) {
      console.log(`ℹ️  roles.${col.name} ya existe`);
    }
  }

  // Actualizar permisos por rol
  await db.execute(`UPDATE roles SET permisos = '["all"]', nivel = 99, activo = 1 WHERE id = 1`);
  await db.execute(`UPDATE roles SET permisos = '["client_area"]', nivel = 1, activo = 1 WHERE id = 2`);
  await db.execute(`UPDATE roles SET permisos = '["salon_ops"]', nivel = 5, activo = 1 WHERE id = 3`);

  console.log('✅ Permisos asignados a todos los roles');

  const [roles] = await db.execute('SELECT id, name, nombre, nivel FROM roles');
  console.log('Roles:', JSON.stringify(roles));

  await db.end();
  console.log('🎉 Listo!');
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
