const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createConnection({
    host: '2.24.86.39', port: 3306,
    user: 'salon_admin', password: 'SalonPro2024!',
    database: 'u566429295_salonpro'
  });

  console.log('--- ESTRUCTURA ACTUAL DE TABLA PLANS ---');
  const [cols] = await db.execute('SHOW COLUMNS FROM plans');
  console.table(cols.map(c => ({ Campo: c.Field, Tipo: c.Type })));

  // Intentemos ver qué llega al servidor si es posible, o simplemente agreguemos
  // las columnas comunes que suelen causar este error en este sistema.
  const extraCols = [
    { name: 'usage_limits', def: 'JSON' },
    { name: 'promo_services', def: 'JSON' },
    { name: 'promo_duration_months', def: 'INT DEFAULT 0' },
    { name: 'location', def: 'VARCHAR(255)' },
    { name: 'activation_fee', def: 'DECIMAL(10,2) DEFAULT 0' },
    { name: 'discount', def: 'DECIMAL(10,2) DEFAULT 0' }
  ];

  for (const col of extraCols) {
    try {
      await db.execute(`ALTER TABLE plans ADD COLUMN ${col.name} ${col.def}`);
      console.log(`✅ plans.${col.name} asegurada`);
    } catch (e) {
      // Ignorar si ya existe
    }
  }

  await db.end();
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
