const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
  const db = await mysql.createConnection({
    host: '2.24.86.39',
    port: 3306,
    user: 'salon_admin',
    password: 'SalonPro2024!',
    database: 'u566429295_salonpro'
  });

  console.log('✅ Conectado a la base de datos remota');

  // Crear tabla roles
  await db.execute(`CREATE TABLE IF NOT EXISTS roles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) UNIQUE,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.execute(`INSERT IGNORE INTO roles (id, name, description) VALUES
    (1, 'admin', 'Administrador del sistema'),
    (2, 'client', 'Cliente regular'),
    (3, 'staff', 'Personal del salon')`);
  console.log('✅ Tabla roles creada');

  // Agregar columna role_id a clients si no existe
  try {
    await db.execute('ALTER TABLE clients ADD COLUMN role_id INT DEFAULT 2');
    console.log('✅ Columna role_id agregada a clients');
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME') console.log('ℹ️ role_id ya existe en clients');
    else throw e;
  }

  // Recrear la vista users para incluir role_id
  await db.execute('CREATE OR REPLACE VIEW users AS SELECT * FROM clients');
  console.log('✅ Vista users actualizada');

  // Asignar admin
  await db.execute("UPDATE clients SET role_id=1 WHERE id='admin_01'");
  console.log('✅ admin_01 asignado como administrador');

  // Crear tabla permissions si el server la necesita
  await db.execute(`CREATE TABLE IF NOT EXISTS permissions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    role_id INT,
    resource VARCHAR(100),
    action VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  console.log('✅ Tabla permissions creada');

  // Crear tabla user_roles si el server la necesita
  await db.execute(`CREATE TABLE IF NOT EXISTS user_roles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id VARCHAR(50),
    role_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.execute("INSERT IGNORE INTO user_roles (user_id, role_id) VALUES ('admin_01', 1)");
  console.log('✅ Tabla user_roles creada y admin asignado');

  await db.end();
  console.log('\n🎉 CONFIGURACIÓN COMPLETA - Intenta entrar ahora!');
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
