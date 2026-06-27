const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createConnection({
    host: '2.24.86.39', port: 3306,
    user: 'salon_admin', password: 'SalonPro2024!',
    database: 'u566429295_salonpro'
  });

  const [rows] = await db.execute('SELECT * FROM payments WHERE status LIKE "Fallido%" ORDER BY created_at DESC LIMIT 1');
  console.log('--- DETALLE DEL PAGO FALLIDO ---');
  if (rows.length > 0) {
    console.log(JSON.stringify(rows[0], null, 2));
  } else {
    console.log("No se encontraron pagos fallidos con ese criterio.");
  }
  
  await db.end();
})().catch(console.error);
