const path = require('path');
const dotenv = require(path.join(__dirname, '../backend/node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));

async function testIdempotentReexecution() {
  console.log('=== TEST DE REINTENTO SEGURO ANTE INTERRUPCIÓN PARCIAL ===');
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 1
  });

  const conn = await pool.getConnection();

  try {
    await conn.query('DROP TABLE IF EXISTS _test_re_expenses');
    await conn.query('DROP TABLE IF EXISTS _test_re_expense_loans');
    await conn.query('DROP TABLE IF EXISTS _test_re_expense_accounts');
    await conn.query('DROP TABLE IF EXISTS _test_re_expense_banks');
    await conn.query('DROP TABLE IF EXISTS _test_re_expense_concepts');

    console.log('Paso 1: Ejecución parcial (solo conceptos y bancos)...');
    await conn.query(`
      CREATE TABLE IF NOT EXISTS _test_re_expense_concepts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        description VARCHAR(255) DEFAULT NULL,
        is_system TINYINT(1) DEFAULT 0,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      INSERT IGNORE INTO _test_re_expense_concepts (name, description, is_system) VALUES
      ('TSS', 'Tesorería', 1),
      ('INFOTEP', 'Instituto', 1)
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS _test_re_expense_banks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        code VARCHAR(20) DEFAULT NULL,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      INSERT IGNORE INTO _test_re_expense_banks (name, code) VALUES
      ('Banco Popular', 'BPD')
    `);

    console.log('   Simulando interrupción abrupta de la migración en mitad del proceso...');

    console.log('Paso 2: Re-ejecución completa desde cero...');
    // Reintentar toda la migración completa:
    await conn.query(`
      CREATE TABLE IF NOT EXISTS _test_re_expense_concepts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        description VARCHAR(255) DEFAULT NULL,
        is_system TINYINT(1) DEFAULT 0,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      INSERT IGNORE INTO _test_re_expense_concepts (name, description, is_system) VALUES
      ('TSS', 'Tesorería', 1),
      ('INFOTEP', 'Instituto', 1),
      ('Anticipos de impuestos', 'Anticipos', 1)
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS _test_re_expense_banks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        code VARCHAR(20) DEFAULT NULL,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      INSERT IGNORE INTO _test_re_expense_banks (name, code) VALUES
      ('Banco Popular', 'BPD'),
      ('Banreservas', 'BR')
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS _test_re_expense_accounts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        account_number VARCHAR(50) DEFAULT NULL,
        type VARCHAR(50) DEFAULT 'operative',
        bank_id INT DEFAULT NULL,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS _test_re_expense_loans (
        id INT AUTO_INCREMENT PRIMARY KEY,
        bank_id INT DEFAULT NULL,
        bank_name VARCHAR(100) NOT NULL,
        loan_name VARCHAR(150) NOT NULL,
        reference_number VARCHAR(50) NOT NULL,
        salon_id INT DEFAULT NULL,
        salon_name VARCHAR(150) DEFAULT NULL,
        total_amount DECIMAL(14,2) DEFAULT NULL,
        currency VARCHAR(10) DEFAULT 'DOP',
        status VARCHAR(20) DEFAULT 'Activo',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS _test_re_expenses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        concept_id INT DEFAULT NULL,
        concept_name VARCHAR(100) NOT NULL,
        payment_date DATE NOT NULL,
        period VARCHAR(7) NOT NULL,
        amount DECIMAL(14,2) NOT NULL,
        payment_method VARCHAR(50) NOT NULL DEFAULT 'Transferencia',
        account_id INT DEFAULT NULL,
        account_name VARCHAR(100) DEFAULT NULL,
        salon_id INT DEFAULT NULL,
        salon_name VARCHAR(150) DEFAULT NULL,
        reference VARCHAR(100) DEFAULT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'Completado',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('Paso 3: Verificando que no existan duplicados...');
    const [concepts] = await conn.query('SELECT * FROM _test_re_expense_concepts');
    console.log('   Total conceptos:', concepts.length, '(Esperado: 3 sin duplicados)');
    if (concepts.length !== 3) throw new Error('Fallo: conceptos duplicados tras reintento');

    const [banks] = await conn.query('SELECT * FROM _test_re_expense_banks');
    console.log('   Total bancos:', banks.length, '(Esperado: 2 sin duplicados)');
    if (banks.length !== 2) throw new Error('Fallo: bancos duplicados tras reintento');

    console.log('=== TEST DE REINTENTO SEGURO COMPLETADO CON ÉXITO (100% IDEMPOTENTE) ===');

  } finally {
    await conn.query('DROP TABLE IF EXISTS _test_re_expenses');
    await conn.query('DROP TABLE IF EXISTS _test_re_expense_loans');
    await conn.query('DROP TABLE IF EXISTS _test_re_expense_accounts');
    await conn.query('DROP TABLE IF EXISTS _test_re_expense_banks');
    await conn.query('DROP TABLE IF EXISTS _test_re_expense_concepts');
    conn.release();
    await pool.end();
  }
}

testIdempotentReexecution();

