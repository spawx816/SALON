const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createConnection({
    host: '2.24.86.39', port: 3306,
    user: 'salon_admin', password: 'SalonPro2024!',
    database: 'u566429295_salonpro'
  });

  console.log('🔄 Corrigiendo roles de clientes registrados...');

  // Todo el que no sea el admin principal, debe ser tipo 'client' y role_id 2
  const [result] = await db.execute(`
    UPDATE clients 
    SET tipo = 'client', role_id = 2 
    WHERE id != 'admin_01' AND (tipo IS NULL OR tipo = '' OR tipo = 'employee')
  `);

  console.log(`✅ ${result.affectedRows} registros corregidos.`);

  // Refrescar vista
  await db.execute('CREATE OR REPLACE VIEW users AS SELECT * FROM clients');
  console.log('✅ Vista users sincronizada.');

  await db.end();
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
