const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../db');

async function backupDatabase() {
  const backupDir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `salon_saas_db_snapshot_${timestamp}.json`);

  console.log(`[BACKUP] Conectando a PostgreSQL en ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}...`);

  try {
    const [tables] = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    const backupData = {
      timestamp: new Date().toISOString(),
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      tableCount: tables.length,
      tables: {}
    };

    console.log(`[BACKUP] Tablas encontradas: ${tables.length}. Extrayendo registros...`);

    let totalRows = 0;
    for (const t of tables) {
      const tableName = t.table_name;
      try {
        const [rows] = await pool.query(`SELECT * FROM "${tableName}"`);
        backupData.tables[tableName] = {
          count: rows.length,
          rows: rows
        };
        totalRows += rows.length;
        console.log(`  - ${tableName}: ${rows.length} filas`);
      } catch (err) {
        console.warn(`  ⚠️ Error respaldando ${tableName}:`, err.message);
        backupData.tables[tableName] = { error: err.message, rows: [] };
      }
    }

    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2), 'utf8');
    const stats = fs.statSync(backupFile);
    const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);

    console.log(`\n✅ [BACKUP COMPLETADO EXITOSAMENTE]`);
    console.log(`Archivo: ${backupFile}`);
    console.log(`Tamaño: ${sizeMb} MB (${stats.size} bytes)`);
    console.log(`Total de filas respaldadas: ${totalRows}`);

    return { file: backupFile, totalRows, sizeMb, tables: tables.length };
  } catch (error) {
    console.error('❌ Error fatal durante el respaldo:', error);
    throw error;
  } finally {
    pool.rawPool?.end?.();
  }
}

backupDatabase();

