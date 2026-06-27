const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createConnection({
    host: '2.24.86.39', port: 3306,
    user: 'salon_admin', password: 'SalonPro2024!',
    database: 'u566429295_salonpro'
  });

  // Ver el rol asignado al admin
  const [rows] = await db.execute(`
    SELECT c.*, r.name as role_name, r.nombre as role_nombre, r.permisos, r.nivel
    FROM clients c
    LEFT JOIN roles r ON c.role_id = r.id
    WHERE c.id = 'admin_01'
  `);
  console.log('Admin data:', JSON.stringify(rows[0], null, 2));

  // Ver todos los roles disponibles
  const [roles] = await db.execute('SELECT * FROM roles');
  console.log('\nRoles en DB:', JSON.stringify(roles, null, 2));

  // Actualizar nombre del rol admin para que el frontend lo reconozca
  await db.execute("UPDATE roles SET nombre = 'Administrador Global', name = 'superadmin', nivel = 99 WHERE id = 1");
  await db.execute("UPDATE clients SET tipo = 'superadmin' WHERE id = 'admin_01'");
  console.log('\n✅ Rol actualizado a superadmin');

  // Recrear vista
  await db.execute('CREATE OR REPLACE VIEW users AS SELECT * FROM clients');
  console.log('✅ Vista users actualizada');

  await db.end();
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
