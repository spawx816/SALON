-- =====================================================================
-- MIGRACIÓN: Módulo de Egresos Contables (SalonPro)
-- Fecha: 2026-11-03
-- Descripción:
--   Crea las tablas necesarias para registrar y administrar salidas
--   de dinero no vinculadas a compras de proveedores (TSS, INFOTEP,
--   impuestos, cuotas de préstamos, anticipos, residuos sólidos, etc.).
-- =====================================================================

-- 1. Conceptos de egresos configurables
CREATE TABLE IF NOT EXISTS expense_concepts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(255) DEFAULT NULL,
  is_system TINYINT(1) DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_concept_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Entidades bancarias
CREATE TABLE IF NOT EXISTS expense_banks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  code VARCHAR(20) DEFAULT NULL,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Préstamos bancarios registrados
CREATE TABLE IF NOT EXISTS expense_loans (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Cuentas de salida / fondos de pago
CREATE TABLE IF NOT EXISTS expense_accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  account_number VARCHAR(50) DEFAULT NULL,
  type VARCHAR(50) DEFAULT 'operative',
  bank_id INT DEFAULT NULL,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_account_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Tabla principal de Egresos
CREATE TABLE IF NOT EXISTS expenses (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Inserción de conceptos base
INSERT IGNORE INTO expense_concepts (name, description, is_system) VALUES
('TSS', 'Tesorería de la Seguridad Social', 1),
('INFOTEP', 'Instituto Nacional de Formación Técnico Profesional', 1),
('Anticipos de impuestos', 'Anticipos mensuales de Impuesto sobre la Renta DGII', 1),
('Impuesto a los activos', 'Impuesto anual a los activos DGII', 1),
('Residuos sólidos', 'Tasas municipales y aseo urbano', 1),
('Préstamos', 'Amortización de préstamos y cuotas financieras', 1),
('Otros', 'Otros gastos y desembolsos administrativos', 1);

-- 7. Inserción de bancos comunes
INSERT IGNORE INTO expense_banks (name, code) VALUES
('Banco Popular', 'BPD'),
('Banreservas', 'BR'),
('Banco BHD', 'BHD'),
('Banco Santa Cruz', 'BSC'),
('Banco Promerica', 'PROM');

-- 8. Inserción de cuentas de salida comunes
INSERT IGNORE INTO expense_accounts (name, account_number, type) VALUES
('Cuenta operativa · 5678', '5678', 'operative'),
('Cuenta nómina · 1234', '1234', 'payroll'),
('Caja chica · San Vicente', 'CC-SV', 'petty_cash'),
('Caja chica · Sirena Villa Mella', 'CC-SVM', 'petty_cash');

-- 9. Inserción de préstamos iniciales registrados
INSERT IGNORE INTO expense_loans (id, bank_id, bank_name, loan_name, reference_number, salon_id, salon_name, total_amount, currency, status) VALUES
(1, (SELECT id FROM expense_banks WHERE name = 'Banco Popular' LIMIT 1), 'Banco Popular', 'Local San Vicente', '001234', 1, 'San Vicente', 500000.00, 'DOP', 'Activo'),
(2, (SELECT id FROM expense_banks WHERE name = 'Banco Popular' LIMIT 1), 'Banco Popular', 'Equipos', '005678', 1, 'San Vicente', 350000.00, 'DOP', 'Activo');
