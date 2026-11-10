const mysql = require('mysql2/promise');

async function update() {
  let conn;
  try {
    conn = await mysql.createConnection({
      host: '2.24.86.39',
      user: 'salon_admin',
      password: 'SalonPro_2024_Success!',
      database: 'u566429295_salon_v2',
      connectTimeout: 8000
    });

    console.log('--- 1. ACTUALIZANDO USUARIO ENMELYN EN users ---');
    await conn.query(`
      UPDATE users 
      SET salon_id = 4, 
          tipo = 'employee', 
          role = 'admin'
      WHERE id = '1789509958232' OR email = 'enmelyn@planbeautyrd.com'
    `);
    const [uUpdated] = await conn.query("SELECT id, nombre, email, role_id, salon_id, tipo, role FROM users WHERE email = 'enmelyn@planbeautyrd.com'");
    console.log('Usuario actualizado:', uUpdated);

    console.log('\n--- 2. ACTUALIZANDO FICHA DE EMPLEADA EN staff_records (ID 20) ---');
    await conn.query(`
      UPDATE staff_records 
      SET posicion = 'Encargada',
          localidad = 'Abatte Peluquería Sirena Villa Mella',
          salon_id = 4,
          status = 'Activo'
      WHERE id = 20
    `);
    const [sUpdated] = await conn.query("SELECT id, nombre, posicion, localidad, salon_id, email, status FROM staff_records WHERE id = 20");
    console.log('Staff record actualizado:', sUpdated);

    console.log('\n--- 3. ELIMINANDO REGISTRO TEMPORAL HUÉRFANO (ID 45) EN staff_records ---');
    await conn.query("DELETE FROM staff_records WHERE id = 45 AND nombre = 'Temporal'");
    const [checkTemp] = await conn.query("SELECT * FROM staff_records WHERE id = 45");
    console.log('Temporal restante (debe ser vacío):', checkTemp);

    console.log('\n✅ ¡Actualización completada con éxito!');
  } catch (err) {
    console.error('Error durante la actualización:', err);
  } finally {
    if (conn) await conn.end();
    process.exit(0);
  }
}

update();
