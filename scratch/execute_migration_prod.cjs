const fs = require('fs');
const path = require('path');
const dotenv = require(path.join(__dirname, '../backend/node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));

async function applyMigration() {
  console.log('=== APLICANDO MIGRACIÓN OFICIAL: 20261103_create_expenses_tables.sql ===');
  console.log('Host:', process.env.DB_HOST);
  console.log('Database:', process.env.DB_NAME);

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 1,
    multipleStatements: true
  });

  const conn = await pool.getConnection();

  try {
    const migrationPath = path.join(__dirname, '../backend/migrations/20261103_create_expenses_tables.sql');
    const sqlContent = fs.readFileSync(migrationPath, 'utf8');

    console.log('1. Ejecutando sentencias DDL e inserts base...');
    await conn.query(sqlContent);
    console.log('   OK: Migración ejecutada con éxito.');

    // 2. Comprobar que las 5 tablas existen
    console.log('\n2. Verificando existencia de las tablas...');
    const [tables] = await conn.query(`
      SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('expense_concepts', 'expense_banks', 'expense_loans', 'expense_accounts', 'expenses')
      ORDER BY TABLE_NAME ASC
    `);

    const tableNames = tables.map(r => r.TABLE_NAME || Object.values(r)[0]);
    console.log('   Tablas detectadas en la base de datos:', tableNames);
    if (tableNames.length !== 5) {
      throw new Error(`Se esperaban 5 tablas y se encontraron ${tableNames.length}`);
    }

    // 3. Comprobar conteos iniciales
    const [cCount] = await conn.query('SELECT COUNT(*) AS total FROM expense_concepts');
    const [bCount] = await conn.query('SELECT COUNT(*) AS total FROM expense_banks');
    const [aCount] = await conn.query('SELECT COUNT(*) AS total FROM expense_accounts');
    const [lCount] = await conn.query('SELECT COUNT(*) AS total FROM expense_loans');
    const [eCount] = await conn.query('SELECT COUNT(*) AS total FROM expenses');

    console.log('\n3. Conteos de registros iniciales:');
    console.log('   - expense_concepts:', cCount[0].total, '(Catálogo de conceptos)');
    console.log('   - expense_banks:', bCount[0].total, '(Catálogo de bancos)');
    console.log('   - expense_accounts:', aCount[0].total, '(Cuentas operativas)');
    console.log('   - expense_loans:', lCount[0].total, '(Préstamos de sucursal)');
    console.log('   - expenses:', eCount[0].total, '(Egresos transaccionales: 0 limpio)');

    if (eCount[0].total !== 0) {
      throw new Error('Alerta: la tabla expenses no debería contener transacciones iniciales.');
    }

    // 4. Diagnóstico de estado (/status)
    const requiredTables = ['expense_concepts', 'expense_banks', 'expense_loans', 'expense_accounts', 'expenses'];
    const missingTables = requiredTables.filter(t => !tableNames.includes(t));
    const isReady = missingTables.length === 0;

    console.log('\n4. Estado del módulo:');
    console.log('   - Status:', isReady ? 'READY' : 'MIGRATION_PENDING');
    console.log('   - Missing tables:', missingTables);

    console.log('\n=== ACTIVACIÓN EN BASE DE DATOS COMPLETADA EXITOSAMENTE ===');

  } catch (err) {
    console.error('ERROR durante la migración:', err.message);
    process.exit(1);
  } finally {
    conn.release();
    await pool.end();
  }
}

applyMigration();

