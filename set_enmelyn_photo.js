const mysql = require('mysql2/promise');

async function setPhoto() {
  let conn;
  try {
    conn = await mysql.createConnection({
      host: '2.24.86.39',
      user: 'salon_admin',
      password: 'SalonPro_2024_Success!',
      database: 'u566429295_salon_v2',
      connectTimeout: 8000
    });

    // 1. Obtener la foto del ponche de entrada más reciente y claro de Enmelyn
    const [att] = await conn.query(`
      SELECT photo, timestamp, type, id 
      FROM attendance 
      WHERE employee_id = '20' 
        AND type = 'Check-In' 
        AND photo IS NOT NULL 
        AND photo LIKE 'data:image%'
      ORDER BY timestamp DESC 
      LIMIT 1
    `);

    if (!att || att.length === 0) {
      throw new Error('No se encontró foto de ponche para Enmelyn');
    }

    const punchRecord = att[0];
    const photoData = punchRecord.photo;
    console.log(`Foto seleccionada del ponche: ${punchRecord.id} (${punchRecord.type} del ${punchRecord.timestamp})`);
    console.log(`Longitud de la foto: ${photoData.length} caracteres`);

    // 2. Actualizar en staff_records (ID 20)
    const [resStaff] = await conn.query(
      "UPDATE staff_records SET profile_photo = ? WHERE id = 20",
      [photoData]
    );
    console.log(`staff_records actualizado: ${resStaff.affectedRows} fila(s) afectada(s)`);

    // 3. Actualizar en users (Enmelyn)
    const [resUser] = await conn.query(
      "UPDATE users SET profile_photo = ? WHERE email = 'enmelyn@planbeautyrd.com' OR id = '1789509958232'",
      [photoData]
    );
    console.log(`users actualizado: ${resUser.affectedRows} fila(s) afectada(s)`);

    // 4. Verificar ambas tablas
    const [verifyStaff] = await conn.query(
      "SELECT id, nombre, posicion, salon_id, LENGTH(profile_photo) as photo_len FROM staff_records WHERE id = 20"
    );
    console.log('Verificación staff_records:', verifyStaff);

    const [verifyUser] = await conn.query(
      "SELECT id, nombre, email, salon_id, LENGTH(profile_photo) as photo_len FROM users WHERE email = 'enmelyn@planbeautyrd.com'"
    );
    console.log('Verificación users:', verifyUser);

    console.log('✅ ¡Foto de perfil asignada con éxito a Enmelyn!');
  } catch (err) {
    console.error('Error al asignar foto:', err);
  } finally {
    if (conn) await conn.end();
    process.exit(0);
  }
}

setPhoto();
