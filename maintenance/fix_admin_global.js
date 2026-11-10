const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createConnection({
    host: '2.24.86.39', port: 3306,
    user: 'salon_admin', password: 'SalonPro2024!',
    database: 'u566429295_salonpro'
  });

  // Agregar columna tipo/is_admin si no existe
  const extraCols = [
    { name: 'tipo', def: "VARCHAR(50) DEFAULT 'client'" },
    { name: 'is_admin', def: 'TINYINT(1) DEFAULT 0' },
    { name: 'is_global_admin', def: 'TINYINT(1) DEFAULT 0' },
    { name: 'nivel_acceso', def: 'INT DEFAULT 1' },
  ];

  for (const col of extraCols) {
    try {
      await db.execute(`ALTER TABLE clients ADD COLUMN ${col.name} ${col.def}`);
      console.log(`✅ ${col.name} agregada`);
    } catch (e) {
      console.log(`ℹ️  ${col.name} ya existe`);
    }
  }

  // Asignar todos los flags de admin al admin_01
  await db.execute(`UPDATE clients SET 
    tipo = 'admin',
    is_admin = 1,
    is_global_admin = 1,
    nivel_acceso = 99,
    role_id = 1
    WHERE id = 'admin_01'`);
  
  console.log('✅ admin_01 tiene todos los privilegios de administrador global');

  // Recrear la vista users para incluir las nuevas columnas
  await db.execute('CREATE OR REPLACE VIEW users AS SELECT * FROM clients');
  console.log('✅ Vista users actualizada');

  const [admin] = await db.execute("SELECT id, nombre, email, tipo, is_admin, is_global_admin, nivel_acceso, role_id FROM clients WHERE id = 'admin_01'");
  console.log('Admin:', JSON.stringify(admin[0], null, 2));

  await db.end();
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
