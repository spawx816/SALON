const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createConnection({
    host: '2.24.86.39', port: 3306,
    user: 'salon_admin', password: 'SalonPro2024!',
    database: 'u566429295_salonpro'
  });

  console.log('✅ Conectado - Agregando campos de facturación...');

  const billingCols = [
    { name: 'last_billed_date', def: 'TIMESTAMP NULL' },
    { name: 'next_billing_date', def: 'TIMESTAMP NULL' },
    { name: 'billing_day', def: 'INT DEFAULT 1' },
    { name: 'billing_status', def: "VARCHAR(20) DEFAULT 'Active'" },
    { name: 'total_billed', def: 'DECIMAL(10,2) DEFAULT 0' },
    { name: 'failed_attempts', def: 'INT DEFAULT 0' }
  ];

  for (const col of billingCols) {
    try {
      await db.execute(`ALTER TABLE contracts ADD COLUMN ${col.name} ${col.def}`);
      console.log(`✅ contracts.${col.name} agregada`);
    } catch (e) {
      // Ignorar si ya existe
    }
  }

  await db.end();
  console.log('🎉 Campos de facturación listos.');
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
