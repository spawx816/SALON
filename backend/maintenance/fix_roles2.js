const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createConnection({
    host: '2.24.86.39',
    port: 3306,
    user: 'salon_admin',
    password: 'SalonPro2024!',
    database: 'u566429295_salonpro'
  });

  console.log('✅ Conectado');

  // Agregar columna nombre a roles
  try {
    await db.execute('ALTER TABLE roles ADD COLUMN nombre VARCHAR(50)');
    console.log('✅ Columna nombre agregada a roles');
  } catch (e) {
    console.log('ℹ️ nombre ya existe:', e.message);
  }

  // Sincronizar nombre con name
  await db.execute('UPDATE roles SET nombre = name');
  console.log('✅ roles.nombre sincronizado');

  // Verificar la tabla roles
  const [roles] = await db.execute('SELECT * FROM roles');
  console.log('Roles:', JSON.stringify(roles, null, 2));

  await db.end();
  console.log('🎉 Listo! Intenta el login de nuevo.');
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
