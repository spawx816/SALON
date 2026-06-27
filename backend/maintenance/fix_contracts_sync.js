const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createConnection({
    host: '2.24.86.39', port: 3306,
    user: 'salon_admin', password: 'SalonPro2024!',
    database: 'u566429295_salonpro'
  });

  console.log('✅ Conectado - Corrigiendo tabla contracts...');

  const missingCols = [
    { name: 'contract_services', def: 'JSON' },
    { name: 'contract_price', def: 'DECIMAL(10,2) DEFAULT 0' },
    { name: 'contract_promo_services', def: 'JSON' },
    { name: 'contract_promo_duration', def: 'INT DEFAULT 0' },
    { name: 'payment_profile_id', def: 'VARCHAR(100) DEFAULT NULL' },
    { name: 'signed_at', def: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' }
  ];

  for (const col of missingCols) {
    try {
      await db.execute(`ALTER TABLE contracts ADD COLUMN ${col.name} ${col.def}`);
      console.log(`✅ contracts.${col.name} agregada`);
    } catch (e) {
      // Si ya existe, ignorar
    }
  }

  await db.end();
  console.log('🎉 Tabla contracts sincronizada con el código.');
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
