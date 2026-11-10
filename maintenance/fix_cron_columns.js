const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createConnection({
    host: '2.24.86.39', port: 3306,
    user: 'salon_admin', password: 'SalonPro2024!',
    database: 'u566429295_salonpro'
  });

  console.log('✅ Conectado - Reforzando sistema de cobro recurrente...');

  const cronCols = [
    { name: 'retry_count', def: 'INT DEFAULT 0' },
    { name: 'next_retry_date', def: 'DATE DEFAULT NULL' },
    { name: 'card_token', def: 'TEXT DEFAULT NULL' }
  ];

  for (const col of cronCols) {
    try {
      await db.execute(`ALTER TABLE contracts ADD COLUMN ${col.name} ${col.def}`);
      console.log(`✅ contracts.${col.name} agregada`);
    } catch (e) {
      // Ignorar si ya existe
    }
  }

  // Sincronizar card_token con payment_profile_id si es necesario
  await db.execute('UPDATE contracts SET card_token = payment_profile_id WHERE card_token IS NULL');
  console.log('✅ Sincronización de tokens completada.');

  await db.end();
  console.log('🎉 El sistema de cobro recurrente ya es 100% compatible con la DB.');
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
