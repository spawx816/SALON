const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createConnection({
    host: '2.24.86.39', port: 3306,
    user: 'salon_admin', password: 'SalonPro2024!',
    database: 'u566429295_salonpro'
  });

  console.log('✅ Conectado - Agregando campos de geolocalización...');

  const geoCols = [
    { name: 'geolocation', def: 'TEXT' },
    { name: 'latitude', def: 'VARCHAR(50)' },
    { name: 'longitude', def: 'VARCHAR(50)' },
    { name: 'accuracy', def: 'VARCHAR(50)' }
  ];

  for (const col of geoCols) {
    try {
      await db.execute(`ALTER TABLE contracts ADD COLUMN ${col.name} ${col.def}`);
      console.log(`✅ contracts.${col.name} agregada`);
    } catch (e) {
      // Ignorar si ya existe
    }
  }

  await db.end();
  console.log('🎉 Geolocalización lista.');
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
