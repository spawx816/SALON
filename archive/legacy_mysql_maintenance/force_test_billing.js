const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createConnection({
    host: '2.24.86.39', port: 3306,
    user: 'salon_admin', password: 'SalonPro2024!',
    database: 'u566429295_salonpro'
  });

  console.log('⚡ Preparando contrato para prueba inmediata...');

  // Ponemos la fecha de próximo cobro en el pasado (ayer) para que el cron lo procese
  await db.execute(`
    UPDATE contracts 
    SET next_billing_date = DATE_SUB(NOW(), INTERVAL 1 DAY),
        status = 'Active',
        auto_billing_enabled = 1
    WHERE status = 'Active' 
    LIMIT 1
  `);

  const [rows] = await db.execute('SELECT id, client_id, next_billing_date FROM contracts WHERE status = "Active" LIMIT 1');
  console.log('Contrato listo para cobrar:', rows[0]);

  await db.end();
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
