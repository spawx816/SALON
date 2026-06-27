const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

(async () => {
  const db = await mysql.createConnection({
    host: '2.24.86.39', port: 3306,
    user: 'salon_admin', password: 'SalonPro2024!',
    database: 'u566429295_salonpro'
  });

  const newPass = 'admin1234';
  const hash = bcrypt.hashSync(newPass, 10);

  await db.execute('UPDATE clients SET password = ? WHERE id = ?', [hash, 'admin_01']);
  console.log('✅ Contraseña actualizada para admin_01');
  console.log('📧 Email: admin@salonpro.com');
  console.log('🔑 Password: admin1234');

  await db.end();
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
