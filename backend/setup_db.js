const mysql = require('mysql2/promise');
require('dotenv').config();

const setup = async () => {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  console.log('--- RECONSTRUCCIÓN DE BASE DE DATOS SALON PRO ---');

  try {
    // 1. SALONS
    await connection.query(`CREATE TABLE IF NOT EXISTS salons (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(255),
      address TEXT,
      phone VARCHAR(50)
    )`);
    await connection.query("INSERT IGNORE INTO salons (id, name, address, phone) VALUES (1, 'Abatte Peluquería San Vicente', 'Av. San Vicente de Paúl', '809-000-0000')");

    // 2. CLIENTS
    await connection.query(`CREATE TABLE IF NOT EXISTS clients (
      id VARCHAR(50) PRIMARY KEY,
      cedula VARCHAR(20) UNIQUE,
      nombre VARCHAR(255),
      telefono VARCHAR(50),
      email VARCHAR(255) UNIQUE,
      password VARCHAR(255),
      must_change_password TINYINT(1) DEFAULT 1,
      frecuencia VARCHAR(50),
      salon_id INT DEFAULT 1,
      calle VARCHAR(255),
      numero VARCHAR(50),
      sector VARCHAR(255),
      ciudad VARCHAR(255),
      status VARCHAR(50) DEFAULT 'Activo',
      cardnet_customer_id VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // 3. PLANS
    await connection.query(`CREATE TABLE IF NOT EXISTS plans (
      id VARCHAR(50) PRIMARY KEY,
      title VARCHAR(100),
      price DECIMAL(10,2),
      activation_fee DECIMAL(10,2) DEFAULT 0,
      discount DECIMAL(10,2) DEFAULT 0,
      color VARCHAR(20),
      location VARCHAR(100),
      services JSON,
      promo_services JSON,
      promo_duration_months INT DEFAULT 0,
      usage_limits JSON
    )`);

    // RE-INSERT DEFAULT PLANS
    const defaultPlans = [
      ['silver', 'PLAN SILVER', 1500.00, 500.00, 0, 'blue', 'Abatte Peluquería San Vicente', '["Lavado y Secado", "Tratamiento Profundo"]', '["Corte de Puntas"]', 1, '{"visits": 4, "services": "Ilimitados"}'],
      ['gold', 'PLAN GOLD', 2500.00, 500.00, 0, 'amber', 'Abatte Peluquería San Vicente', '["Lavado y Secado", "Manicura Simple", "Pedicura Simple"]', '["Tinte Completo"]', 1, '{"visits": 6, "services": "Ilimitados"}'],
      ['black', 'PLAN BLACK', 4500.00, 500.00, 0, 'slate', 'Abatte Peluquería San Vicente', '["Lavado y Secado", "Manicura SPA", "Pedicura SPA", "Masaje Relajante"]', '["Balayage"]', 1, '{"visits": 8, "services": "Ilimitados"}']
    ];

    for (const p of defaultPlans) {
      await connection.query('INSERT IGNORE INTO plans (id, title, price, activation_fee, discount, color, location, services, promo_services, promo_duration_months, usage_limits) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', p);
    }

    // 4. CONTRACTS
    await connection.query(`CREATE TABLE IF NOT EXISTS contracts (
      id VARCHAR(50) PRIMARY KEY,
      client_id VARCHAR(50),
      plan_id VARCHAR(50),
      signed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      signature_data LONGTEXT,
      status VARCHAR(50) DEFAULT 'Activo',
      card_token VARCHAR(255),
      cardnet_profile_id VARCHAR(50)
    )`);

    // 5. PAYMENTS
    await connection.query(`CREATE TABLE IF NOT EXISTS payments (
      id VARCHAR(50) PRIMARY KEY,
      client_id VARCHAR(50),
      plan_id VARCHAR(50),
      amount DECIMAL(10,2),
      method VARCHAR(50),
      status VARCHAR(50),
      gateway_ref VARCHAR(255),
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // 6. VISITS
    await connection.query(`CREATE TABLE IF NOT EXISTS visits (
      id VARCHAR(50) PRIMARY KEY,
      client_id VARCHAR(50),
      client_name VARCHAR(255),
      servicios JSON,
      empleado_peluquera VARCHAR(255),
      empleado_manicurista VARCHAR(255),
      proxima_fecha DATE,
      recordatorio_auto TINYINT(1) DEFAULT 0,
      salon_id INT DEFAULT 1,
      visited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // 7. RRHH (Staff Records)
    await connection.query(`CREATE TABLE IF NOT EXISTS staff_records (
      id INT PRIMARY KEY AUTO_INCREMENT,
      nombre VARCHAR(255) NOT NULL,
      cedula VARCHAR(20) UNIQUE NOT NULL,
      contacto VARCHAR(50),
      posicion VARCHAR(100),
      direccion TEXT,
      localidad VARCHAR(255),
      fecha_entrada DATE,
      fecha_salida DATE,
      motivo_salida TEXT,
      status ENUM('Activo', 'Inactivo', 'Vacaciones', 'Licencia') DEFAULT 'Activo',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // 8. EMAIL SETTINGS
    await connection.query(`CREATE TABLE IF NOT EXISTS email_settings (
      id INT PRIMARY KEY,
      smtp_host VARCHAR(255),
      smtp_port INT,
      smtp_user VARCHAR(255),
      smtp_pass VARCHAR(255),
      smtp_from VARCHAR(255),
      smtp_secure TINYINT(1) DEFAULT 0
    )`);

    // 9. VERIFICATION CODES
    await connection.query(`CREATE TABLE IF NOT EXISTS verification_codes (
      id INT PRIMARY KEY AUTO_INCREMENT,
      client_id VARCHAR(50),
      code VARCHAR(10),
      is_used TINYINT(1) DEFAULT 0,
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    console.log('✅ BASE DE DATOS RECONSTRUIDA EXITOSAMENTE');
    process.exit(0);
  } catch (err) {
    console.error('❌ ERROR DURANTE LA CONFIGURACIÓN:', err.message);
    process.exit(1);
  }
};

setup();
