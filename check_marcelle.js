const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

async function checkMarcelle() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    timezone: '-04:00'
  });

  const [marcelleStaff] = await pool.query("SELECT id, nombre, localidad, dias_laborables, hora_entrada, hora_salida FROM staff_records WHERE nombre LIKE '%Marcelle%'");
  console.log('=== MARCELLE STAFF ===');
  console.log(marcelleStaff);

  if (marcelleStaff.length > 0) {
    const empId = marcelleStaff[0].id;
    const [att] = await pool.query(
      "SELECT id, type, status, lateness_minutes, extra_minutes, timestamp FROM attendance WHERE employee_id IN (?, ?) AND timestamp >= '2026-10-15 00:00:00' AND timestamp <= '2026-10-21 23:59:59' ORDER BY timestamp ASC",
      [empId, String(empId)]
    );
    console.log('=== MARCELLE ATTENDANCE OCT 15-21 ===');
    console.log(att.map(a => ({
      id: a.id,
      type: a.type,
      status: a.status,
      late: a.lateness_minutes,
      extra: a.extra_minutes,
      rawTs: a.timestamp,
      localDR: new Date(a.timestamp).toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo' })
    })));
  }

  await pool.end();
}

checkMarcelle().catch(console.error);
