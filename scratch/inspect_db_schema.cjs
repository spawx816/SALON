const path = require('path');
const dotenv = require(path.join(__dirname, '../backend/node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));

async function inspect() {
  console.log('--- INSPECCIÓN DE BASE DE DATOS SALONPRO ---');
  console.log('Host:', process.env.DB_HOST);
  console.log('DB:', process.env.DB_NAME);

  let pool;
  try {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 3,
      connectTimeout: 8000
    });

    const [tables] = await pool.query('SHOW TABLES');
    const tableNames = tables.map(r => Object.values(r)[0]);
    console.log(`\nTablas existentes en la base (${tableNames.length} total):`);

    const checkList = [
      'expense_concepts',
      'expense_banks',
      'expense_loans',
      'expense_accounts',
      'expenses',
      'audit_logs',
      'salons',
      'users'
    ];

    for (const tableName of checkList) {
      const exists = tableNames.includes(tableName);
      console.log(`\n> Tabla [${tableName}]: ${exists ? 'EXISTE' : 'NO EXISTE'}`);
      if (exists) {
        const [columns] = await pool.query(`DESCRIBE \`${tableName}\``);
        console.log(`  Columnas (${columns.length}):`);
        columns.forEach(col => {
          console.log(`    - ${col.Field}: ${col.Type} | Null: ${col.Null} | Key: ${col.Key} | Default: ${col.Default}`);
        });

        // Ver si tiene llaves foráneas o índices
        const [indexes] = await pool.query(`SHOW INDEX FROM \`${tableName}\``);
        const indexNames = [...new Set(indexes.map(i => i.Key_name))];
        console.log(`  Índices: ${indexNames.join(', ')}`);
      }
    }

  } catch (err) {
    console.error('ERROR de conexión o consulta:', err.message);
  } finally {
    if (pool) await pool.end();
  }
}

inspect();
