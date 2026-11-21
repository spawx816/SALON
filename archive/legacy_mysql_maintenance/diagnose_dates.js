const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createConnection({
    host: '2.24.86.39', port: 3306,
    user: 'salon_admin', password: 'SalonPro2024!',
    database: 'u566429295_salonpro'
  });

  const [contract] = await db.execute("SELECT last_billed_date FROM contracts WHERE client_id = '1778205337045'");
  const [visits] = await db.execute("SELECT visited_at FROM visits WHERE client_id = '1778205337045' ORDER BY visited_at DESC LIMIT 1");

  console.log('--- DIAGNÓSTICO DE FECHAS ---');
  console.log('Fecha del último COBRO en DB:', contract[0]?.last_billed_date);
  console.log('Fecha de la última VISITA en DB:', visits[0]?.visited_at);
  
  if (new Date(visits[0]?.visited_at) >= new Date(contract[0]?.last_billed_date)) {
      console.log('⚠️ PROBLEMA DETECTADO: La visita es igual o posterior al cobro, por eso no se resetea.');
  } else {
      console.log('✅ Las fechas parecen correctas. El problema podría estar en el Frontend.');
  }

  await db.end();
})().catch(console.error);
