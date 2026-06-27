const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createConnection({
    host: '2.24.86.39', port: 3306,
    user: 'salon_admin', password: 'SalonPro2024!',
    database: 'u566429295_salonpro'
  });

  console.log('✅ Conectado - Agregando auto_billing_enabled a contracts...');

  const autoCols = [
    { name: 'auto_billing_enabled', def: 'TINYINT(1) DEFAULT 1' },
    { name: 'auto_renew', def: 'TINYINT(1) DEFAULT 1' }
  ];

  for (const col of autoCols) {
    try {
      await db.execute(`ALTER TABLE contracts ADD COLUMN ${col.name} ${col.def}`);
      console.log(`✅ contracts.${col.name} agregada`);
    } catch (e) {
      // Ignorar si ya existe
    }
  }

  await db.end();
  console.log('🎉 Listo!');
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
