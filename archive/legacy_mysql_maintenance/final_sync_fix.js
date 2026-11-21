const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createConnection({
    host: '2.24.86.39', port: 3306,
    user: 'salon_admin', password: 'SalonPro2024!',
    database: 'u566429295_salonpro'
  });

  console.log('✅ Conectado. Sincronizando todas las tablas críticas...');

  // 1. Asegurar que 'plans' tenga todo
  await db.execute(`ALTER TABLE plans MODIFY COLUMN id VARCHAR(50)`);
  
  // 2. Crear tabla 'contracts' si no existe (algunos sistemas la usan al guardar planes)
  await db.execute(`CREATE TABLE IF NOT EXISTS contracts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    client_id VARCHAR(50),
    plan_id VARCHAR(50),
    status VARCHAR(20),
    contract_services JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  console.log('✅ Tabla contracts asegurada');

  // 3. Revisar si hay una tabla 'subscriptions' o similar
  try {
    await db.execute(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_services JSON`);
  } catch(e) {}

  // 4. ELIMINAR CACHE DE LA VISTA
  await db.execute('DROP VIEW IF EXISTS users');
  await db.execute('CREATE VIEW users AS SELECT * FROM clients');
  console.log('✅ Vista users refrescada');

  await db.end();
  console.log('🚀 Base de datos sincronizada. REINICIA EL SERVICIO EN LA VPS AHORA.');
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
