const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createConnection({
    host: '2.24.86.39', port: 3306,
    user: 'salon_admin', password: 'SalonPro2024!',
    database: 'u566429295_salonpro'
  });

  console.log('✅ Conectado - Agregando salon_id a contracts...');

  try {
    await db.execute('ALTER TABLE contracts ADD COLUMN salon_id INT DEFAULT 1');
    console.log('✅ contracts.salon_id agregada');
  } catch (e) {
    console.log('ℹ️ contracts.salon_id ya existe');
  }

  await db.end();
  console.log('🎉 Listo!');
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
