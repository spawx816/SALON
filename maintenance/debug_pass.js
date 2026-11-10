const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

(async () => {
  const db = await mysql.createConnection({
    host: '2.24.86.39', port: 3306,
    user: 'salon_admin', password: 'SalonPro2024!',
    database: 'u566429295_salonpro'
  });

  // Verificar qué hash tiene actualmente
  const [rows] = await db.execute('SELECT id, email, password FROM clients WHERE id = ?', ['admin_01']);
  console.log('Hash actual en DB:', rows[0]);

  // Verificar si bcryptjs puede validar
  const storedHash = rows[0].password;
  const testPass = 'admin1234';
  const valid = bcrypt.compareSync(testPass, storedHash);
  console.log('¿bcryptjs valida admin1234?', valid);

  // También guardar contraseña plana para test
  await db.execute('UPDATE clients SET password = ? WHERE id = ?', ['admin1234_plain', 'admin_01']);
  
  // Y también crear nuevo hash fresco
  const freshHash = bcrypt.hashSync('admin1234', 12);
  await db.execute('UPDATE clients SET password = ? WHERE id = ?', [freshHash, 'admin_01']);
  console.log('✅ Nuevo hash guardado:', freshHash.substring(0, 30) + '...');

  await db.end();
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
