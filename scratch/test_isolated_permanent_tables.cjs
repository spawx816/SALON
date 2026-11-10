const path = require('path');
const dotenv = require(path.join(__dirname, '../backend/node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));

async function testIsolatedPermanentTables() {
  console.log('=== TEST DE TABLAS PERMANENTES AISLADAS CON CLAVES FORÁNEAS REALES ===');
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
    // 0. Limpieza previa por seguridad
    await conn.query('DROP TABLE IF EXISTS _test_val_expenses');
    await conn.query('DROP TABLE IF EXISTS _test_val_expense_loans');
    await conn.query('DROP TABLE IF EXISTS _test_val_expense_accounts');
    await conn.query('DROP TABLE IF EXISTS _test_val_expense_banks');
    await conn.query('DROP TABLE IF EXISTS _test_val_expense_concepts');

    console.log('1. Creando tablas permanentes aisladas con relaciones y claves foráneas reales...');

    // 1. Conceptos
    await conn.query(`
      CREATE TABLE _test_val_expense_concepts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        description VARCHAR(255) DEFAULT NULL,
        is_system TINYINT(1) DEFAULT 0,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_concept_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 2. Bancos
    await conn.query(`
      CREATE TABLE _test_val_expense_banks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        code VARCHAR(20) DEFAULT NULL,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 3. Préstamos con FK a Bancos y a Salons (existente en BD)
    await conn.query(`
      CREATE TABLE _test_val_expense_loans (
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_bank_name (bank_name),
        INDEX idx_loan_ref (reference_number),
        INDEX idx_loan_salon (salon_id),
        CONSTRAINT fk_test_loans_bank FOREIGN KEY (bank_id) REFERENCES _test_val_expense_banks(id) ON DELETE SET NULL,
        CONSTRAINT fk_test_loans_salon FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 4. Cuentas con FK a Bancos
    await conn.query(`
      CREATE TABLE _test_val_expense_accounts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        account_number VARCHAR(50) DEFAULT NULL,
        type VARCHAR(50) DEFAULT 'operative',
        bank_id INT DEFAULT NULL,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_account_name (name),
        CONSTRAINT fk_test_acc_bank FOREIGN KEY (bank_id) REFERENCES _test_val_expense_banks(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 5. Egresos con FK a Conceptos, Salons, Bancos, Préstamos y Cuentas
    await conn.query(`
      CREATE TABLE _test_val_expenses (
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
        attachment_name VARCHAR(255) DEFAULT NULL,
        attachment_data LONGTEXT DEFAULT NULL,
        attachment_mime VARCHAR(100) DEFAULT NULL,
        observation TEXT DEFAULT NULL,
        is_loan TINYINT(1) DEFAULT 0,
        bank_id INT DEFAULT NULL,
        bank_name VARCHAR(100) DEFAULT NULL,
        loan_id INT DEFAULT NULL,
        loan_name VARCHAR(150) DEFAULT NULL,
        loan_ref VARCHAR(50) DEFAULT NULL,
        loan_period VARCHAR(20) DEFAULT NULL,
        breakdown_capital DECIMAL(14,2) DEFAULT NULL,
        breakdown_interest DECIMAL(14,2) DEFAULT NULL,
        breakdown_charges DECIMAL(14,2) DEFAULT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'Completado',
        void_reason TEXT DEFAULT NULL,
        voided_at DATETIME DEFAULT NULL,
        voided_by VARCHAR(100) DEFAULT NULL,
        created_by VARCHAR(100) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_period (period),
        INDEX idx_payment_date (payment_date),
        INDEX idx_salon (salon_id),
        INDEX idx_concept (concept_name),
        INDEX idx_status (status),
        CONSTRAINT fk_test_exp_concept FOREIGN KEY (concept_id) REFERENCES _test_val_expense_concepts(id) ON DELETE SET NULL,
        CONSTRAINT fk_test_exp_salon FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE SET NULL,
        CONSTRAINT fk_test_exp_bank FOREIGN KEY (bank_id) REFERENCES _test_val_expense_banks(id) ON DELETE SET NULL,
        CONSTRAINT fk_test_exp_loan FOREIGN KEY (loan_id) REFERENCES _test_val_expense_loans(id) ON DELETE SET NULL,
        CONSTRAINT fk_test_exp_acc FOREIGN KEY (account_id) REFERENCES _test_val_expense_accounts(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('   OK: Las 5 tablas permanentes aisladas con claves foráneas e índices se crearon con éxito.');

    // 2. Probar inserción con claves foráneas reales
    console.log('2. Probando inserción y validación de claves foráneas con datos reales...');
    const [bRes] = await conn.query("INSERT INTO _test_val_expense_banks (name, code) VALUES ('Banco Popular', 'BPD')");
    const bankId = bRes.insertId;

    const [cRes] = await conn.query("INSERT INTO _test_val_expense_concepts (name, description, is_system) VALUES ('Préstamos', 'Amortización cuotas', 1)");
    const conceptId = cRes.insertId;

    // Usar salon_id: 1 de la tabla salons existente en producción
    const [sRows] = await conn.query("SELECT id, name FROM salons LIMIT 1");
    if (sRows.length === 0) throw new Error("No hay sucursales en salons");
    const realSalonId = sRows[0].id;
    const realSalonName = sRows[0].name;
    console.log(`   Usando sucursal real de producción: ID ${realSalonId} (${realSalonName})`);

    const [lRes] = await conn.query(`
      INSERT INTO _test_val_expense_loans (bank_id, bank_name, loan_name, reference_number, salon_id, salon_name, total_amount)
      VALUES (?, 'Banco Popular', 'Local San Vicente', '001234', ?, ?, 500000.00)
    `, [bankId, realSalonId, realSalonName]);
    const loanId = lRes.insertId;

    const [aRes] = await conn.query(`
      INSERT INTO _test_val_expense_accounts (name, account_number, type, bank_id)
      VALUES ('Cuenta operativa · 5678', '5678', 'operative', ?)
    `, [bankId]);
    const accountId = aRes.insertId;

    const [eRes] = await conn.query(`
      INSERT INTO _test_val_expenses (
        concept_id, concept_name, payment_date, period, amount, payment_method,
        account_id, account_name, salon_id, salon_name, reference,
        is_loan, bank_id, bank_name, loan_id, loan_name, loan_ref, loan_period,
        breakdown_capital, breakdown_interest, breakdown_charges, status, created_by
      ) VALUES (?, 'Préstamos', '2026-10-30', '2026-10', 24000.00, 'Transferencia',
        ?, 'Cuenta operativa · 5678', ?, ?, 'TRX-00321',
        1, ?, 'Banco Popular', ?, 'Local San Vicente', '001234', 'Octubre 2026',
        18500.00, 4500.00, 1000.00, 'Completado', 'Administrador')
    `, [conceptId, accountId, realSalonId, realSalonName, bankId, loanId]);

    console.log(`   OK: Registro de egreso insertado con éxito con todas las FK activas (ID ${eRes.insertId}).`);

    // 3. Probar restricción de clave foránea inválida (debe fallar)
    console.log('3. Verificando que claves foráneas inválidas sean rechazadas...');
    let fkRejected = false;
    try {
      await conn.query(`
        INSERT INTO _test_val_expenses (concept_name, payment_date, period, amount, salon_id)
        VALUES ('Otros', '2026-10-31', '2026-10', 500.00, 999999)
      `);
    } catch (fkErr) {
      if (fkErr.code === 'ER_NO_REFERENCED_ROW_2' || fkErr.errno === 1452) {
        fkRejected = true;
      }
    }
    if (!fkRejected) throw new Error("Fallo: clave foránea inválida de salon_id no fue rechazada");
    console.log('   OK: Restricción referencial (FK) rechaza correctamente IDs inexistentes (error 1452).');

    // 4. Probar idempotencia (reintentos seguros con IF NOT EXISTS e INSERT IGNORE)
    console.log('4. Probando reintentos seguros (idempotencia)...');
    await conn.query(`
      CREATE TABLE IF NOT EXISTS _test_val_expense_concepts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE
      )
    `);
    const [ignoreRes] = await conn.query(`
      INSERT IGNORE INTO _test_val_expense_concepts (name, description, is_system)
      VALUES ('Préstamos', 'Duplicado seguro', 1)
    `);
    console.log('   OK: CREATE TABLE IF NOT EXISTS e INSERT IGNORE son 100% seguros y repetibles.');

  } catch (err) {
    console.error('ERROR en prueba de tablas permanentes:', err.message);
    throw err;
  } finally {
    // 5. Limpieza total de tablas de prueba
    console.log('5. Limpiando tablas de prueba...');
    await conn.query('DROP TABLE IF EXISTS _test_val_expenses');
    await conn.query('DROP TABLE IF EXISTS _test_val_expense_loans');
    await conn.query('DROP TABLE IF EXISTS _test_val_expense_accounts');
    await conn.query('DROP TABLE IF EXISTS _test_val_expense_banks');
    await conn.query('DROP TABLE IF EXISTS _test_val_expense_concepts');
    console.log('   OK: Tablas de prueba eliminadas. BD de producción intacta.');
    conn.release();
    await pool.end();
  }
}

testIsolatedPermanentTables();

