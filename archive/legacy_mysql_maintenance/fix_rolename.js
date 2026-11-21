const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createConnection({
    host: '2.24.86.39', port: 3306,
    user: 'salon_admin', password: 'SalonPro2024!',
    database: 'u566429295_salonpro'
  });

  // El VPS server.js verifica: role_name === 'Administrador'
  // Debemos poner nombre = 'Administrador' exactamente
  await db.execute("UPDATE roles SET nombre = 'Administrador', name = 'Administrador' WHERE id = 1");
  console.log('✅ Rol id=1 actualizado a Administrador');

  // Recrear vista
  await db.execute('CREATE OR REPLACE VIEW users AS SELECT * FROM clients');
  console.log('✅ Vista users actualizada');

  // Verificar
  const [r] = await db.execute('SELECT id, name, nombre FROM roles WHERE id = 1');
  console.log('Rol admin:', r[0]);

  await db.end();
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
