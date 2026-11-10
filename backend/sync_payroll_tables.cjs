const { pool } = require('./db.js');

async function syncPayrollDb() {
  console.log('🔄 Sincronizando columnas y tablas para el módulo de Nómina...');

  // 1. employee_commissions_log
  const commCols = [
    "ALTER TABLE employee_commissions_log ADD COLUMN IF NOT EXISTS monto_comision NUMERIC(12,2) DEFAULT 0.00",
    "ALTER TABLE employee_commissions_log ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'Pendiente'",
    "ALTER TABLE employee_commissions_log ADD COLUMN IF NOT EXISTS employee_name VARCHAR(255)",
    "ALTER TABLE employee_commissions_log ADD COLUMN IF NOT EXISTS localidad VARCHAR(150)",
    "ALTER TABLE employee_commissions_log ADD COLUMN IF NOT EXISTS precio_servicio NUMERIC(12,2) DEFAULT 0.00",
    "ALTER TABLE employee_commissions_log ADD COLUMN IF NOT EXISTS cantidad NUMERIC(10,2) DEFAULT 1.00",
    "ALTER TABLE employee_commissions_log ADD COLUMN IF NOT EXISTS descuento_aplicado NUMERIC(12,2) DEFAULT 0.00",
    "ALTER TABLE employee_commissions_log ADD COLUMN IF NOT EXISTS monto_base NUMERIC(12,2) DEFAULT 0.00",
    "ALTER TABLE employee_commissions_log ADD COLUMN IF NOT EXISTS tipo_comision VARCHAR(50) DEFAULT 'Porcentaje'",
    "ALTER TABLE employee_commissions_log ADD COLUMN IF NOT EXISTS comision_valor NUMERIC(10,2) DEFAULT 0.00",
    "ALTER TABLE employee_commissions_log ADD COLUMN IF NOT EXISTS scheme_id INT",
    "ALTER TABLE employee_commissions_log ADD COLUMN IF NOT EXISTS rule_applied_description TEXT",
    "ALTER TABLE employee_commissions_log ADD COLUMN IF NOT EXISTS payout_id VARCHAR(100)"
  ];
  for (const q of commCols) {
    await pool.query(q);
  }
  await pool.query("UPDATE employee_commissions_log SET monto_comision = commission_amount WHERE (monto_comision IS NULL OR monto_comision = 0) AND commission_amount > 0");

  // 2. employee_discounts
  const discCols = [
    "ALTER TABLE employee_discounts ADD COLUMN IF NOT EXISTS employee_name VARCHAR(255)",
    "ALTER TABLE employee_discounts ADD COLUMN IF NOT EXISTS type VARCHAR(100) DEFAULT 'Servicio'",
    "ALTER TABLE employee_discounts ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2) DEFAULT 0.00",
    "ALTER TABLE employee_discounts ADD COLUMN IF NOT EXISTS date DATE DEFAULT CURRENT_DATE",
    "ALTER TABLE employee_discounts ADD COLUMN IF NOT EXISTS notes TEXT",
    "ALTER TABLE employee_discounts ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'Pendiente'",
    "ALTER TABLE employee_discounts ADD COLUMN IF NOT EXISTS created_by VARCHAR(150)",
    "ALTER TABLE employee_discounts ADD COLUMN IF NOT EXISTS cash_register_movement_id INT"
  ];
  for (const q of discCols) {
    await pool.query(q);
  }
  await pool.query("UPDATE employee_discounts SET amount = discount_amount WHERE (amount IS NULL OR amount = 0) AND discount_amount > 0");
  await pool.query("UPDATE employee_discounts SET date = created_at::date WHERE date IS NULL");

  // 3. payroll_concepts
  await pool.query("ALTER TABLE payroll_concepts ALTER COLUMN code DROP NOT NULL");
  await pool.query("ALTER TABLE payroll_concepts ALTER COLUMN name DROP NOT NULL");
  await pool.query("ALTER TABLE payroll_concepts ALTER COLUMN type DROP NOT NULL");

  const conceptCols = [
    "ALTER TABLE payroll_concepts ADD COLUMN IF NOT EXISTS activo SMALLINT DEFAULT 1",
    "ALTER TABLE payroll_concepts ADD COLUMN IF NOT EXISTS tipo VARCHAR(50)",
    "ALTER TABLE payroll_concepts ADD COLUMN IF NOT EXISTS nombre VARCHAR(100)",
    "ALTER TABLE payroll_concepts ADD COLUMN IF NOT EXISTS formula_tipo VARCHAR(50)",
    "ALTER TABLE payroll_concepts ADD COLUMN IF NOT EXISTS porcentaje NUMERIC(5,2) DEFAULT 0.00"
  ];
  for (const q of conceptCols) {
    await pool.query(q);
  }

  // Populate default concepts if empty
  const [existingConcepts] = await pool.query("SELECT COUNT(*) as count FROM payroll_concepts");
  if (parseInt(existingConcepts[0]?.count || 0) === 0) {
    const defaultConcepts = [
      ['SAL_FIJO', 'Salario Fijo', 'Ingreso', 'Ingreso', 'Salario fijo', 'Fijo', 0, 1],
      ['COMISION', 'Comisiones', 'Ingreso', 'Ingreso', 'Comisiones', 'Variable', 0, 1],
      ['FERIADO', 'Feriados', 'Ingreso', 'Ingreso', 'Feriados', 'Fijo', 0, 1],
      ['HORA_EXT', 'Horas Extras', 'Ingreso', 'Ingreso', 'Horas extras', 'Variable', 0, 1],
      ['OTRO_ING', 'Otros Ingresos / Bonos', 'Ingreso', 'Ingreso', 'Otros ingresos / Bonos', 'Fijo', 0, 1],
      ['TSS_EMP', 'TSS (Seguridad Social RD)', 'Descuento', 'Descuento', 'TSS (Seguridad Social RD)', 'Porcentaje', 5.91, 1],
      ['SERV_SAL', 'Servicios de Salón', 'Descuento', 'Descuento', 'Servicios de Salón', 'Variable', 0, 1],
      ['PRESTAMO', 'Préstamos y Anticipos', 'Descuento', 'Descuento', 'Préstamos y Anticipos', 'Fijo', 0, 1],
      ['AUSENCIA', 'Ausencias', 'Descuento', 'Descuento', 'Ausencias', 'Variable', 0, 1],
      ['TARDANZA', 'Tardanzas', 'Descuento', 'Descuento', 'Tardanzas', 'Variable', 0, 1],
      ['OTRO_DESC', 'Otros Descuentos', 'Descuento', 'Descuento', 'Otros descuentos', 'Fijo', 0, 1]
    ];
    for (const c of defaultConcepts) {
      await pool.query(
        "INSERT INTO payroll_concepts (code, name, type, tipo, nombre, formula_tipo, porcentaje, activo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        c
      );
    }
    console.log('✅ Catálogo de 11 conceptos de nómina inicializado en la BD');
  }

  console.log('✅ Base de datos sincronizada con éxito para Nómina.');
  process.exit(0);
}

syncPayrollDb().catch(err => {
  console.error('❌ Error sincronizando BD de nómina:', err);
  process.exit(1);
});
