const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createConnection({
    host: '2.24.86.39', port: 3306,
    user: 'salon_admin', password: 'SalonPro2024!',
    database: 'u566429295_salonpro'
  });

  console.log('🔄 Preparando contrato para reintento inmediato...');

  const [result] = await db.execute(`
    UPDATE contracts 
    SET status = 'Pending_Retry', 
        retry_count = 1, 
        next_retry_date = DATE_SUB(NOW(), INTERVAL 5 MINUTE) 
    WHERE client_id = '1778205337045'
  `);

  console.log(`✅ Contrato listo (${result.affectedRows} filas).`);
  console.log('En el próximo ciclo de 2 minutos del cron job, verás el intento de cobro.');

  await db.end();
})().catch(console.error);
