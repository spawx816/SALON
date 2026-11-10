const { pool } = require('./db');

async function createAllRemainingTables() {
  console.log('🚀 [MASTER MIGRATION] Creando todas las 16 tablas faltantes y funciones de compatibilidad...');

  // 1. Funciones de compatibilidad DATE_FORMAT
  const dateFuncs = [
    `CREATE OR REPLACE FUNCTION DATE_FORMAT(ts TIMESTAMPTZ, fmt TEXT) RETURNS TEXT AS $$
    DECLARE
      v_fmt TEXT := fmt;
    BEGIN
      IF ts IS NULL THEN RETURN NULL; END IF;
      v_fmt := replace(v_fmt, '%Y', 'YYYY');
      v_fmt := replace(v_fmt, '%y', 'YY');
      v_fmt := replace(v_fmt, '%m', 'MM');
      v_fmt := replace(v_fmt, '%d', 'DD');
      v_fmt := replace(v_fmt, '%H', 'HH24');
      v_fmt := replace(v_fmt, '%h', 'HH12');
      v_fmt := replace(v_fmt, '%i', 'MI');
      v_fmt := replace(v_fmt, '%s', 'SS');
      v_fmt := replace(v_fmt, '%p', 'PM');
      RETURN to_char(ts, v_fmt);
    END;
    $$ LANGUAGE plpgsql IMMUTABLE;`,

    `CREATE OR REPLACE FUNCTION DATE_FORMAT(ts TIMESTAMP, fmt TEXT) RETURNS TEXT AS $$
    DECLARE
      v_fmt TEXT := fmt;
    BEGIN
      IF ts IS NULL THEN RETURN NULL; END IF;
      v_fmt := replace(v_fmt, '%Y', 'YYYY');
      v_fmt := replace(v_fmt, '%y', 'YY');
      v_fmt := replace(v_fmt, '%m', 'MM');
      v_fmt := replace(v_fmt, '%d', 'DD');
      v_fmt := replace(v_fmt, '%H', 'HH24');
      v_fmt := replace(v_fmt, '%h', 'HH12');
      v_fmt := replace(v_fmt, '%i', 'MI');
      v_fmt := replace(v_fmt, '%s', 'SS');
      v_fmt := replace(v_fmt, '%p', 'PM');
      RETURN to_char(ts, v_fmt);
    END;
    $$ LANGUAGE plpgsql IMMUTABLE;`,

    `CREATE OR REPLACE FUNCTION DATE_FORMAT(d DATE, fmt TEXT) RETURNS TEXT AS $$
    DECLARE
      v_fmt TEXT := fmt;
    BEGIN
      IF d IS NULL THEN RETURN NULL; END IF;
      v_fmt := replace(v_fmt, '%Y', 'YYYY');
      v_fmt := replace(v_fmt, '%y', 'YY');
      v_fmt := replace(v_fmt, '%m', 'MM');
      v_fmt := replace(v_fmt, '%d', 'DD');
      RETURN to_char(d, v_fmt);
    END;
    $$ LANGUAGE plpgsql IMMUTABLE;`
  ];

  for (const f of dateFuncs) {
    try {
      await pool.query(f);
      console.log('✅ DATE_FORMAT function registrada');
    } catch (e) {
      console.warn('⚠️ Error creando DATE_FORMAT:', e.message);
    }
  }

  // 2. Definición de las 16 tablas
  const tableDefinitions = [
    // 1. appointments (Citas y Agenda)
    `CREATE TABLE IF NOT EXISTS appointments (
      id VARCHAR(50) PRIMARY KEY,
      client_id VARCHAR(100),
      client_name VARCHAR(150),
      salon_id VARCHAR(100) DEFAULT '1',
      date VARCHAR(20) NOT NULL,
      time VARCHAR(20) NOT NULL,
      services TEXT,
      status VARCHAR(30) DEFAULT 'Pendiente',
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // 2. attendance (Control biométrico de asistencia)
    `CREATE TABLE IF NOT EXISTS attendance (
      id VARCHAR(50) PRIMARY KEY,
      employee_id VARCHAR(100) NOT NULL,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      type VARCHAR(30) NOT NULL,
      photo TEXT,
      geolocation VARCHAR(100),
      device_info VARCHAR(255),
      status VARCHAR(30) DEFAULT 'Normal',
      lateness_minutes INT DEFAULT 0,
      extra_minutes INT DEFAULT 0,
      modified_by VARCHAR(100),
      modified_at TIMESTAMP,
      is_manual SMALLINT DEFAULT 0,
      modification_reason VARCHAR(255)
    )`,

    // 3. billing_codes (Códigos de autorización / facturación manual)
    `CREATE TABLE IF NOT EXISTS billing_codes (
      id SERIAL PRIMARY KEY,
      contract_id VARCHAR(100),
      code VARCHAR(20),
      action_type VARCHAR(50),
      is_used SMALLINT DEFAULT 0,
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // 4. commission_payouts (Liquidaciones de comisiones a estilistas)
    `CREATE TABLE IF NOT EXISTS commission_payouts (
      id SERIAL PRIMARY KEY,
      payout_number VARCHAR(50) NOT NULL UNIQUE,
      employee_id VARCHAR(100) NOT NULL,
      employee_name VARCHAR(150) NOT NULL,
      monto_total DECIMAL(12,2) NOT NULL DEFAULT 0,
      total_items INT NOT NULL DEFAULT 0,
      metodo_pago VARCHAR(50) DEFAULT 'Efectivo',
      notas TEXT,
      usuario_liquidador VARCHAR(100) DEFAULT 'Admin',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // 5. employee_commission_rules (Reglas de comisión individual por empleado)
    `CREATE TABLE IF NOT EXISTS employee_commission_rules (
      id SERIAL PRIMARY KEY,
      employee_id VARCHAR(100) NOT NULL,
      service_name VARCHAR(150) NOT NULL DEFAULT 'General',
      tipo_comision VARCHAR(50) DEFAULT 'Porcentaje',
      comision_valor DECIMAL(8,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT unique_emp_service UNIQUE (employee_id, service_name)
    )`,

    // 6. contact_messages (Mensajes de contacto recibidos)
    `CREATE TABLE IF NOT EXISTS contact_messages (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(150),
      email VARCHAR(150),
      telefono VARCHAR(50),
      mensaje TEXT,
      ip_address VARCHAR(100),
      status VARCHAR(30) DEFAULT 'Pendiente',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // 7. contract_settings (Configuración general de contratos)
    `CREATE TABLE IF NOT EXISTS contract_settings (
      id INT PRIMARY KEY DEFAULT 1,
      title VARCHAR(255) DEFAULT 'CONTRATO DE SERVICIOS DE BELLEZA',
      company_name VARCHAR(255) DEFAULT 'SALON PRO',
      company_rnc VARCHAR(50) DEFAULT '1-31-98765-4',
      company_address TEXT,
      renewal_fee DECIMAL(10,2) DEFAULT 800.00,
      min_duration_months INT DEFAULT 12,
      notice_cancellation_days INT DEFAULT 30,
      content TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // 8. dgii_606_purchases (Reporte 606 de compras y retenciones DGII)
    `CREATE TABLE IF NOT EXISTS dgii_606_purchases (
      id SERIAL PRIMARY KEY,
      periodo VARCHAR(6) NOT NULL,
      rnc_cedula VARCHAR(20) NOT NULL,
      tipo_id INT DEFAULT 1,
      tipo_bienes_servicios VARCHAR(4) DEFAULT '02',
      proveedor VARCHAR(255) NOT NULL,
      ncf VARCHAR(20) NOT NULL,
      ncf_modificado VARCHAR(20) DEFAULT '',
      fecha_factura VARCHAR(10) NOT NULL,
      fecha_pago VARCHAR(10) DEFAULT '',
      tipo_compra VARCHAR(50) DEFAULT 'Bienes',
      clasificacion_gasto VARCHAR(255) DEFAULT '02 - Gastos por trabajos, suministros y servicios',
      monto_servicios DECIMAL(14,2) DEFAULT 0,
      monto_bienes DECIMAL(14,2) DEFAULT 0,
      total_facturado DECIMAL(14,2) NOT NULL DEFAULT 0,
      itbis_facturado DECIMAL(14,2) DEFAULT 0,
      itbis_retenido DECIMAL(14,2) DEFAULT 0,
      itbis_proporcionalidad DECIMAL(14,2) DEFAULT 0,
      itbis_costo DECIMAL(14,2) DEFAULT 0,
      itbis_adelantar DECIMAL(14,2) DEFAULT 0,
      itbis_percibido DECIMAL(14,2) DEFAULT 0,
      tipo_retencion_isr VARCHAR(4) DEFAULT '',
      isr_retenido DECIMAL(14,2) DEFAULT 0,
      isr_percibido DECIMAL(14,2) DEFAULT 0,
      isc DECIMAL(14,2) DEFAULT 0,
      otros_impuestos DECIMAL(14,2) DEFAULT 0,
      propina_legal DECIMAL(14,2) DEFAULT 0,
      forma_pago VARCHAR(4) DEFAULT '02',
      estado VARCHAR(20) DEFAULT 'Completa',
      errores_validacion TEXT DEFAULT NULL,
      notas TEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // 9. holidays (Calendario de feriados de nómina)
    `CREATE TABLE IF NOT EXISTS holidays (
      id SERIAL PRIMARY KEY,
      date DATE NOT NULL UNIQUE,
      name VARCHAR(150) NOT NULL,
      type VARCHAR(50) DEFAULT 'Oficial',
      rate_multiplier DECIMAL(4,2) DEFAULT 2.00,
      is_active SMALLINT DEFAULT 1,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // 10. payroll_periods (Períodos de nómina quincenal/mensual)
    `CREATE TABLE IF NOT EXISTS payroll_periods (
      id SERIAL PRIMARY KEY,
      period_name VARCHAR(150) NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      total_empleados INT DEFAULT 0,
      total_neto DECIMAL(14,2) DEFAULT 0,
      total_ingresos DECIMAL(14,2) DEFAULT 0,
      total_descuentos DECIMAL(14,2) DEFAULT 0,
      status VARCHAR(50) DEFAULT 'En preparación',
      sucursal VARCHAR(100) DEFAULT 'Todas',
      departamento VARCHAR(100) DEFAULT 'Todos',
      is_immutable SMALLINT DEFAULT 0,
      approved_by VARCHAR(100),
      approved_at TIMESTAMP,
      snapshot_json TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // 11. payroll_items (Desglose individual por empleado en cada nómina)
    `CREATE TABLE IF NOT EXISTS payroll_items (
      id SERIAL PRIMARY KEY,
      payroll_id INT NOT NULL,
      employee_id VARCHAR(100) NOT NULL,
      employee_name VARCHAR(150) NOT NULL,
      posicion VARCHAR(100),
      sucursal VARCHAR(100),
      departamento VARCHAR(100),
      salario_fijo DECIMAL(12,2) DEFAULT 0,
      comisiones DECIMAL(12,2) DEFAULT 0,
      feriados DECIMAL(12,2) DEFAULT 0,
      horas_extras DECIMAL(12,2) DEFAULT 0,
      otros_ingresos DECIMAL(12,2) DEFAULT 0,
      total_ingresos DECIMAL(12,2) DEFAULT 0,
      tss DECIMAL(12,2) DEFAULT 0,
      servicios DECIMAL(12,2) DEFAULT 0,
      prestamos DECIMAL(12,2) DEFAULT 0,
      ausencias DECIMAL(12,2) DEFAULT 0,
      tardanzas DECIMAL(12,2) DEFAULT 0,
      otros_descuentos DECIMAL(12,2) DEFAULT 0,
      total_descuentos DECIMAL(12,2) DEFAULT 0,
      neto_pagar DECIMAL(12,2) DEFAULT 0,
      detalles_json TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // 12. payroll_concepts (Catálogo de conceptos y deducciones)
    `CREATE TABLE IF NOT EXISTS payroll_concepts (
      id SERIAL PRIMARY KEY,
      code VARCHAR(50) NOT NULL UNIQUE,
      name VARCHAR(150) NOT NULL,
      type VARCHAR(50) NOT NULL,
      is_taxable SMALLINT DEFAULT 1,
      is_active SMALLINT DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // 13. payroll_audit_logs (Auditoría de cambios manuales en nómina)
    `CREATE TABLE IF NOT EXISTS payroll_audit_logs (
      id SERIAL PRIMARY KEY,
      payroll_id INT NOT NULL,
      employee_id VARCHAR(100),
      employee_name VARCHAR(150),
      field_name VARCHAR(100),
      old_value VARCHAR(100),
      new_value VARCHAR(100),
      action_type VARCHAR(50),
      reason TEXT,
      user_name VARCHAR(100) DEFAULT 'Administrador',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // 14. pending_surveys (Cola de encuestas pendientes)
    `CREATE TABLE IF NOT EXISTS pending_surveys (
      id VARCHAR(50) PRIMARY KEY,
      client_id VARCHAR(100),
      status VARCHAR(30) DEFAULT 'Pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // 15. schedule_overrides (Excepciones y turnos especiales de personal)
    `CREATE TABLE IF NOT EXISTS schedule_overrides (
      id SERIAL PRIMARY KEY,
      employee_id VARCHAR(100) NOT NULL,
      date DATE NOT NULL,
      hora_entrada VARCHAR(20),
      hora_salida VARCHAR(20),
      reason VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // 16. surveys (Resultados de encuestas de satisfacción)
    `CREATE TABLE IF NOT EXISTS surveys (
      id VARCHAR(50) PRIMARY KEY,
      client_id VARCHAR(100),
      client_name VARCHAR(150),
      salon_id VARCHAR(100) DEFAULT '1',
      salon_name VARCHAR(150),
      staff_peluquera VARCHAR(150),
      staff_lava_pelo VARCHAR(150),
      staff_manicurista VARCHAR(150),
      q1 INT,
      q2 INT,
      q3 INT,
      q4 INT,
      q5 INT,
      q6 VARCHAR(50),
      q7 VARCHAR(50),
      q8 INT,
      q9 TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`
  ];

  for (const tSql of tableDefinitions) {
    try {
      await pool.query(tSql);
      console.log('✅ Tabla creada/verificada');
    } catch (e) {
      console.warn('⚠️ Error creando tabla:', e.message);
    }
  }

  // 3. Insertar defaults en contract_settings si no existe
  try {
    await pool.query(`
      INSERT INTO contract_settings (id, title, company_name, company_rnc, company_address, renewal_fee, min_duration_months, notice_cancellation_days)
      VALUES (1, 'CONTRATO DE SERVICIOS DE BELLEZA', 'GLAMOUR BEAUTY STUDIO', '1-31-98765-4', 'Av. Winston Churchill #109, Piantini', 800.00, 12, 30)
      ON CONFLICT (id) DO NOTHING
    `);
    console.log('✅ Default contract_settings creado');
  } catch(e) {
    console.warn('⚠️ Seed contract_settings:', e.message);
  }

  // 4. Insertar feriados dominicanos de referencia si tabla está vacía
  try {
    const [existingHol] = await pool.query('SELECT COUNT(*) as count FROM holidays');
    if (existingHol && existingHol[0] && parseInt(existingHol[0].count) === 0) {
      await pool.query(`
        INSERT INTO holidays (date, name, type, rate_multiplier) VALUES
        ('2026-01-01', 'Año Nuevo', 'Oficial', 2.00),
        ('2026-01-06', 'Día de los Santos Reyes', 'Oficial', 2.00),
        ('2026-01-21', 'Día de la Altagracia', 'Oficial', 2.00),
        ('2026-01-26', 'Día de Duarte', 'Oficial', 2.00),
        ('2026-02-27', 'Día de la Independencia', 'Oficial', 2.00),
        ('2026-04-03', 'Viernes Santo', 'Oficial', 2.00),
        ('2026-05-01', 'Día del Trabajo', 'Oficial', 2.00),
        ('2026-06-04', 'Corpus Christi', 'Oficial', 2.00),
        ('2026-08-16', 'Día de la Restauración', 'Oficial', 2.00),
        ('2026-09-24', 'Día de las Mercedes', 'Oficial', 2.00),
        ('2026-11-06', 'Día de la Constitución', 'Oficial', 2.00),
        ('2026-12-25', 'Navidad', 'Oficial', 2.00)
        ON CONFLICT (date) DO NOTHING
      `);
      console.log('✅ Feriados dominicanos oficiales poblados');
    }
  } catch(e) {
    console.warn('⚠️ Seed holidays:', e.message);
  }

  console.log('\n🎉 [COMPLETE] Todas las 16 tablas y dependencias de base de datos creadas con éxito!');
  process.exit(0);
}

createAllRemainingTables().catch(err => {
  console.error('Fatal error en migración:', err);
  process.exit(1);
});
