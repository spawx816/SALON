const { pool } = require('./db');

async function fixAll() {
  console.log('🚀 [START] Creando tablas faltantes y tipos para PostgreSQL...');

  const queries = [
    // 1. staff_positions
    `CREATE TABLE IF NOT EXISTS staff_positions (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      description VARCHAR(255),
      base_salary DECIMAL(10,2) DEFAULT 0.00,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // 2. commission_categories
    `CREATE TABLE IF NOT EXISTS commission_categories (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(100) NOT NULL UNIQUE,
      porcentaje DECIMAL(5,2) DEFAULT 0.00,
      tipo VARCHAR(50) DEFAULT 'servicios',
      estado VARCHAR(20) DEFAULT 'activo',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // 3. marketing_settings
    `CREATE TABLE IF NOT EXISTS marketing_settings (
      id INT PRIMARY KEY DEFAULT 1,
      birthday_automation_enabled BOOLEAN DEFAULT true,
      birthday_discount INT DEFAULT 15,
      birthday_flyer_url TEXT,
      birthday_email_subject VARCHAR(255) DEFAULT '¡Feliz Cumpleaños! 🎉',
      birthday_email_template TEXT,
      mass_email_template TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // 4. email_logs
    `CREATE TABLE IF NOT EXISTS email_logs (
      id SERIAL PRIMARY KEY,
      client_id VARCHAR(100),
      email_type VARCHAR(100) NOT NULL,
      recipient_email VARCHAR(255) NOT NULL,
      subject VARCHAR(255) NOT NULL,
      sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      opened SMALLINT DEFAULT 0,
      opened_at TIMESTAMP
    )`,

    // 5. roles
    `CREATE TABLE IF NOT EXISTS roles (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(100) UNIQUE,
      permisos TEXT,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // 6. login_attempts
    `CREATE TABLE IF NOT EXISTS login_attempts (
      id SERIAL PRIMARY KEY,
      email_or_cedula VARCHAR(150),
      ip_address VARCHAR(100),
      status VARCHAR(50),
      attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // 7. security_audit_logs
    `CREATE TABLE IF NOT EXISTS security_audit_logs (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(100),
      user_name VARCHAR(150),
      action VARCHAR(100),
      details TEXT,
      ip_address VARCHAR(100),
      user_agent TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // 8. security_settings
    `CREATE TABLE IF NOT EXISTS security_settings (
      id INT PRIMARY KEY DEFAULT 1,
      max_login_attempts INT DEFAULT 5,
      lockout_duration_minutes INT DEFAULT 30,
      require_pin_for_discounts BOOLEAN DEFAULT true,
      session_timeout_minutes INT DEFAULT 45,
      ip_whitelist TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // 9. email_settings
    `CREATE TABLE IF NOT EXISTS email_settings (
      id INT PRIMARY KEY DEFAULT 1,
      smtp_host VARCHAR(255),
      smtp_port INT,
      smtp_user VARCHAR(255),
      smtp_pass VARCHAR(255),
      smtp_from VARCHAR(255),
      smtp_secure BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // 10. security_requests
    `CREATE TABLE IF NOT EXISTS security_requests (
      id SERIAL PRIMARY KEY,
      client_id VARCHAR(100),
      client_name VARCHAR(150),
      service_name VARCHAR(150),
      staff_name VARCHAR(150),
      auth_code VARCHAR(50),
      type VARCHAR(50),
      status VARCHAR(50) DEFAULT 'pending',
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // 11. user_sessions
    `CREATE TABLE IF NOT EXISTS user_sessions (
      id VARCHAR(150) PRIMARY KEY,
      user_id VARCHAR(100),
      user_name VARCHAR(150),
      role VARCHAR(50),
      salon_id VARCHAR(100) DEFAULT '1',
      ip_address VARCHAR(100),
      user_agent TEXT,
      device_info VARCHAR(150),
      is_active SMALLINT DEFAULT 1,
      last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // 12. Add missing columns to users table for compatibility with /users routes
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS nombre VARCHAR(150)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id INT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS salon_id VARCHAR(100)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS hora_entrada VARCHAR(50)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS hora_salida VARCHAR(50)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS dias_laborables VARCHAR(100)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS tolerancia_minutos INT DEFAULT 15`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS tipo VARCHAR(50) DEFAULT 'employee'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS password VARCHAR(255)`
  ];

  for (const q of queries) {
    try {
      await pool.query(q);
      console.log('✅ Query ejecutada');
    } catch (e) {
      console.warn('⚠️ Error ejecutando query:', e.message);
    }
  }

  // Sincronizar columna nombre y salon_id en users
  try {
    await pool.query(`UPDATE users SET nombre = name WHERE (nombre IS NULL OR nombre = '') AND name IS NOT NULL`);
    await pool.query(`UPDATE users SET salon_id = branch_id WHERE (salon_id IS NULL OR salon_id = '') AND branch_id IS NOT NULL`);
    console.log('✅ Users sincronizados (nombre/salon_id)');
  } catch(e) {
    console.warn('⚠️ Sincronizando users:', e.message);
  }

  // Seed standard positions if empty
  try {
    const [existingPos] = await pool.query('SELECT COUNT(*) as count FROM staff_positions');
    if (existingPos && existingPos[0] && parseInt(existingPos[0].count) === 0) {
      await pool.query(`
        INSERT INTO staff_positions (name, description, base_salary) VALUES
        ('Peluquera', 'Estilista / Especialista en cabello y secado', 18000.00),
        ('Lava pelo', 'Lavado, tratamientos capilares y asistencia', 18421.00),
        ('Manicurista', 'Cuidado y diseño de uñas', 15351.00),
        ('Encargada', 'Supervisión de operaciones y caja', 20000.00),
        ('Recepcionista', 'Atención al cliente, cobro y agendamiento', 18000.00),
        ('Cajera', 'Facturación y arqueo de caja', 18000.00)
        ON CONFLICT (name) DO NOTHING
      `);
      console.log('✅ Seed staff_positions ejecutado');
    }
  } catch (e) {
    console.warn('⚠️ Seed staff_positions:', e.message);
  }

  // Seed standard roles if empty
  try {
    const [existingRoles] = await pool.query('SELECT COUNT(*) as count FROM roles');
    if (existingRoles && existingRoles[0] && parseInt(existingRoles[0].count) === 0) {
      const defaultPerms = JSON.stringify({
        all: true,
        process_payments: true,
        record_visits: true,
        manage_services: true,
        manage_clients: true,
        manage_salons: true,
        view_analytics: true
      });
      await pool.query(`
        INSERT INTO roles (nombre, permisos, description) VALUES
        ('Administrador', '${defaultPerms}', 'Acceso total y configuración'),
        ('Recepción', '${defaultPerms}', 'Gestión de cobro, tickets y citas'),
        ('Cajero', '${defaultPerms}', 'Control de caja y pagos'),
        ('Peluquera', '{}', 'Estilista comisionista')
        ON CONFLICT (nombre) DO NOTHING
      `);
      console.log('✅ Seed roles ejecutado');
    }
  } catch (e) {
    console.warn('⚠️ Seed roles:', e.message);
  }

  // Seed marketing_settings default row if empty
  try {
    const [existingMkt] = await pool.query('SELECT COUNT(*) as count FROM marketing_settings');
    if (existingMkt && existingMkt[0] && parseInt(existingMkt[0].count) === 0) {
      await pool.query(`
        INSERT INTO marketing_settings (id, birthday_automation_enabled, birthday_discount, birthday_email_subject)
        VALUES (1, true, 15, '¡Feliz Cumpleaños! 🎉')
        ON CONFLICT (id) DO NOTHING
      `);
      console.log('✅ Seed marketing_settings ejecutado');
    }
  } catch(e) {
    console.warn('⚠️ Seed marketing_settings:', e.message);
  }

  // Seed security_settings default row if empty
  try {
    const [existingSec] = await pool.query('SELECT COUNT(*) as count FROM security_settings');
    if (existingSec && existingSec[0] && parseInt(existingSec[0].count) === 0) {
      await pool.query(`
        INSERT INTO security_settings (id, max_login_attempts, lockout_duration_minutes, require_pin_for_discounts, session_timeout_minutes)
        VALUES (1, 5, 30, true, 45)
        ON CONFLICT (id) DO NOTHING
      `);
      console.log('✅ Seed security_settings ejecutado');
    }
  } catch(e) {
    console.warn('⚠️ Seed security_settings:', e.message);
  }

  // Seed email_settings default row if empty
  try {
    const [existingEmail] = await pool.query('SELECT COUNT(*) as count FROM email_settings');
    if (existingEmail && existingEmail[0] && parseInt(existingEmail[0].count) === 0) {
      await pool.query(`
        INSERT INTO email_settings (id, smtp_host, smtp_port, smtp_from, smtp_secure)
        VALUES (1, 'smtp.gmail.com', 465, 'notificaciones@salonpro.io', true)
        ON CONFLICT (id) DO NOTHING
      `);
      console.log('✅ Seed email_settings ejecutado');
    }
  } catch(e) {
    console.warn('⚠️ Seed email_settings:', e.message);
  }

  // Seed commission_categories default rows if empty
  try {
    const [existingComm] = await pool.query('SELECT COUNT(*) as count FROM commission_categories');
    if (existingComm && existingComm[0] && parseInt(existingComm[0].count) === 0) {
      await pool.query(`
        INSERT INTO commission_categories (nombre, porcentaje, tipo, estado) VALUES
        ('Peluquería General', 40.00, 'servicios', 'activo'),
        ('Químicos y Tintes', 35.00, 'servicios', 'activo'),
        ('Lavado y Secado', 30.00, 'servicios', 'activo'),
        ('Uñas y Manicura', 50.00, 'servicios', 'activo')
        ON CONFLICT (nombre) DO NOTHING
      `);
      console.log('✅ Seed commission_categories ejecutado');
    }
  } catch(e) {
    console.warn('⚠️ Seed commission_categories:', e.message);
  }

  console.log('🎉 [DONE] Tablas creadas y pobladas con éxito.');
  process.exit(0);
}

fixAll().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
