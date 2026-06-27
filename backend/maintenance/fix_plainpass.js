const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createConnection({
    host: '2.24.86.39', port: 3306,
    user: 'salon_admin', password: 'SalonPro2024!',
    database: 'u566429295_salonpro'
  });

  // El servidor VPS compara password en texto plano directamente
  await db.execute("UPDATE clients SET password = 'admin1234' WHERE id = 'admin_01'");
  console.log('✅ Password actualizado a texto plano: admin1234');

  const [r] = await db.execute("SELECT id, email, password, status FROM clients WHERE id = 'admin_01'");
  console.log('Admin actual:', r[0]);

  await db.end();
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
