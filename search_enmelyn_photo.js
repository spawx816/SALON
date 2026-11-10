const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function search() {
  let conn;
  try {
    conn = await mysql.createConnection({
      host: '2.24.86.39',
      user: 'salon_admin',
      password: 'SalonPro_2024_Success!',
      database: 'u566429295_salon_v2',
      connectTimeout: 8000
    });

    console.log('--- 1. BUSCANDO EN TABLA attendance EN MYSQL ---');
    // Let's see all distinct employee_ids in attendance
    const [empIds] = await conn.query("SELECT DISTINCT employee_id, COUNT(*) as cnt FROM attendance GROUP BY employee_id");
    console.log('Employee IDs en attendance:', empIds);

    const [withPhoto] = await conn.query(
      "SELECT id, employee_id, timestamp, type, LENGTH(photo) as photo_len, SUBSTRING(photo, 1, 50) as photo_sample FROM attendance WHERE photo IS NOT NULL AND photo != '' ORDER BY id DESC LIMIT 20"
    );
    console.log('Ponches con foto en BD:', withPhoto);

    // Specifically for Enmelyn (ID 20 or similar)
    const [enmelynAtt] = await conn.query(
      "SELECT id, employee_id, timestamp, type, LENGTH(photo) as photo_len FROM attendance WHERE (employee_id = '20' OR employee_id = 20 OR employee_id = 'EMP-20') AND photo IS NOT NULL AND photo != ''"
    );
    console.log('Ponches de Enmelyn con foto en BD:', enmelynAtt);

    console.log('\n--- 2. BUSCANDO EN backup_deleted_ponches_20260712.json ---');
    const backupPath = path.join(__dirname, 'backup_deleted_ponches_20260712.json');
    if (fs.existsSync(backupPath)) {
      console.log('Leyendo backup JSON...');
      const data = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
      console.log(`Total registros en backup: ${data.length}`);
      
      const enmelynBackup = data.filter(r => 
        (String(r.employee_id) === '20' || String(r.employee_name || '').toLowerCase().includes('enmely') || String(r.nombre || '').toLowerCase().includes('enmely')) &&
        (r.photo || r.photo_url || r.image)
      );
      console.log(`Encontrados en backup para Enmelyn con foto: ${enmelynBackup.length}`);
      if (enmelynBackup.length > 0) {
        console.log('Muestra backup Enmelyn:', {
          id: enmelynBackup[0].id,
          employee_id: enmelynBackup[0].employee_id,
          timestamp: enmelynBackup[0].timestamp || enmelynBackup[0].date,
          photo_len: (enmelynBackup[0].photo || enmelynBackup[0].photo_url || enmelynBackup[0].image || '').length,
          photo_start: (enmelynBackup[0].photo || enmelynBackup[0].photo_url || enmelynBackup[0].image || '').substring(0, 50)
        });
      }
    } else {
      console.log('No existe backup JSON en esta ruta');
    }

  } catch (err) {
    console.error('Error:', err);
  } finally {
    if (conn) await conn.end();
    process.exit(0);
  }
}

search();
