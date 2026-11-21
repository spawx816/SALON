const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createConnection({
    host: '2.24.86.39', port: 3306,
    user: 'salon_admin', password: 'SalonPro2024!',
    database: 'u566429295_salonpro'
  });

  console.log('✅ Conectado - Agregando bloques de seguridad a contracts...');

  const safetyCols = [
    { name: 'device_agent', def: 'TEXT' },
    { name: 'browser_info', def: 'TEXT' },
    { name: 'os_info', def: 'VARCHAR(100)' },
    { name: 'signed_at', def: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
    { name: 'contract_version', def: "VARCHAR(20) DEFAULT '1.0'" },
    { name: 'metadata', def: 'JSON' }
  ];

  for (const col of safetyCols) {
    try {
      await db.execute(`ALTER TABLE contracts ADD COLUMN ${col.name} ${col.def}`);
      console.log(`✅ contracts.${col.name} agregada`);
    } catch (e) {
      // Ignorar si ya existe
    }
  }

  await db.end();
  console.log('🎉 Tabla contracts reforzada.');
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
