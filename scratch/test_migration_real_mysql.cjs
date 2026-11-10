const path = require('path');
const dotenv = require(path.join(__dirname, '../backend/node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));

async function testFullMigrationOnRealMySql() {
  console.log('=== TEST DE MIGRACIÓN Y OPERACIONES SOBRE MYSQL REAL (2.24.86.39) ===');
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
    // 1. Crear tablas temporales con el esquema exacto de la migración
    console.log('1. Creando tablas temporales de prueba en MySQL...');

    await conn.query(`
      CREATE TEMPORARY TABLE test_expense_concepts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        description VARCHAR(255) DEFAULT NULL,
        is_system TINYINT(1) DEFAULT 0,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_concept_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TEMPORARY TABLE test_expense_banks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        code VARCHAR(20) DEFAULT NULL,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TEMPORARY TABLE test_expense_loans (
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
        INDEX idx_loan_salon (salon_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TEMPORARY TABLE test_expense_accounts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        account_number VARCHAR(50) DEFAULT NULL,
        type VARCHAR(50) DEFAULT 'operative',
        bank_id INT DEFAULT NULL,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_account_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.query(`
      CREATE TEMPORARY TABLE test_expenses (
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
        INDEX idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('   OK: Las 5 tablas fueron creadas exitosamente.');

    // 2. Probar inserciones base de conceptos, bancos y cuentas
    console.log('2. Insertando catálogos base...');
    await conn.query(`
      INSERT INTO test_expense_concepts (name, description, is_system) VALUES
      ('TSS', 'Tesorería de la Seguridad Social', 1),
      ('INFOTEP', 'Instituto Nacional de Formación Técnico Profesional', 1),
      ('Anticipos de impuestos', 'Anticipos mensuales de Impuesto sobre la Renta DGII', 1),
      ('Impuesto a los activos', 'Impuesto anual a los activos DGII', 1),
      ('Residuos sólidos', 'Tasas municipales y aseo urbano', 1),
      ('Préstamos', 'Amortización de préstamos y cuotas financieras', 1),
      ('Otros', 'Otros gastos y desembolsos administrativos', 1)
    `);

    await conn.query(`
      INSERT INTO test_expense_banks (name, code) VALUES
      ('Banco Popular', 'BPD'),
      ('Banreservas', 'BR'),
      ('Banco BHD', 'BHD'),
      ('Banco Santa Cruz', 'BSC'),
      ('Banco Promerica', 'PROM')
    `);

    await conn.query(`
      INSERT INTO test_expense_accounts (name, account_number, type) VALUES
      ('Cuenta operativa · 5678', '5678', 'operative'),
      ('Cuenta nómina · 1234', '1234', 'payroll'),
      ('Caja chica · San Vicente', 'CC-SV', 'petty_cash'),
      ('Caja chica · Sirena Villa Mella', 'CC-SVM', 'petty_cash')
    `);

    await conn.query(`
      INSERT INTO test_expense_loans (bank_id, bank_name, loan_name, reference_number, salon_id, salon_name, total_amount) VALUES
      (1, 'Banco Popular', 'Local San Vicente', '001234', 1, 'San Vicente', 500000.00),
      (1, 'Banco Popular', 'Equipos', '005678', 1, 'San Vicente', 350000.00)
    `);

    console.log('   OK: Catálogos base insertados.');

    // 3. Insertar egresos de prueba (general y préstamo con desglose)
    console.log('3. Insertando egresos con desglose financiero y soporte...');
    const [ins1] = await conn.query(`
      INSERT INTO test_expenses (
        concept_name, payment_date, period, amount, payment_method,
        account_name, salon_id, salon_name, reference,
        is_loan, bank_name, loan_name, loan_ref, loan_period,
        breakdown_capital, breakdown_interest, breakdown_charges,
        status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Completado', ?)
    `, [
      'Préstamos', '2026-10-30', '2026-10', 24000.00, 'Transferencia',
      'Cuenta operativa · 5678', 1, 'San Vicente', 'TRX-00321',
      1, 'Banco Popular', 'Local San Vicente', '001234', 'Octubre 2026',
      18500.00, 4500.00, 1000.00, 'Administrador'
    ]);

    const [ins2] = await conn.query(`
      INSERT INTO test_expenses (
        concept_name, payment_date, period, amount, payment_method,
        account_name, salon_id, salon_name, reference,
        status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Completado', ?)
    `, [
      'TSS', '2026-10-28', '2026-10', 21500.00, 'Transferencia',
      'Cuenta operativa · 5678', 1, 'San Vicente', 'TSS-OCT-2026', 'Administrador'
    ]);

    console.log('   OK: Egresos creados con IDs', ins1.insertId, 'y', ins2.insertId);

    // 4. Validar suma de egresos activos
    const [sumRows1] = await conn.query(`
      SELECT SUM(amount) AS total, COUNT(*) AS count
      FROM test_expenses
      WHERE period = '2026-10' AND status != 'Anulado'
    `);
    const initialTotal = Number(sumRows1[0].total);
    console.log('4. Total activo calculado:', initialTotal, '(Esperado: 45500)');
    if (initialTotal !== 45500.00) throw new Error('Cálculo inicial incorrecto');

    // 5. Anulación con motivo
    console.log('5. Anulando egreso con ID', ins2.insertId, '...');
    await conn.query(`
      UPDATE test_expenses
      SET status = 'Anulado', void_reason = 'Error contable', voided_at = NOW(), voided_by = 'Auditor'
      WHERE id = ?
    `, [ins2.insertId]);

    // 6. Validar que el egreso anulado NO suma al total activo
    const [sumRows2] = await conn.query(`
      SELECT SUM(amount) AS total, COUNT(*) AS count
      FROM test_expenses
      WHERE period = '2026-10' AND status != 'Anulado'
    `);
    const totalAfterVoid = Number(sumRows2[0].total);
    console.log('6. Total tras anulación:', totalAfterVoid, '(Esperado: 24000)');
    if (totalAfterVoid !== 24000.00) throw new Error('Egreso anulado aún se incluye en la suma');

    // 7. Validar búsqueda predictiva y filtros
    const [searchRows] = await conn.query(`
      SELECT * FROM test_expenses
      WHERE (LOWER(concept_name) LIKE ? OR LOWER(reference) LIKE ? OR LOWER(loan_name) LIKE ?)
    `, ['%vicente%', '%vicente%', '%vicente%']);
    console.log('7. Búsqueda predictiva encontrada:', searchRows.length, 'registro(s)');
    if (searchRows.length !== 1 || searchRows[0].id !== ins1.insertId) throw new Error('Fallo en búsqueda');

    console.log('\n=== VALIDACIÓN REAL EN MYSQL COMPLETADA EXITOSAMENTE (100% OK) ===');

  } catch (e) {
    console.error('ERROR en validación MySQL:', e.message);
  } finally {
    conn.release();
    await pool.end();
  }
}

testFullMigrationOnRealMySql();

