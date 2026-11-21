const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'salon_pro',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function reset() {
  console.log('--- RESET NUCLEAR DE PLANES Y CONTRATOS ---');
  try {
    await pool.query('SET FOREIGN_KEY_CHECKS = 0');

    console.log('Borrando tablas corruptas...');
    await pool.query('DROP TABLE IF EXISTS plans');
    await pool.query('DROP TABLE IF EXISTS contracts');

    console.log('Recreando tabla PLANS con formato JSON nativo...');
    await pool.query(`
      CREATE TABLE plans (
        id VARCHAR(50) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        activation_fee DECIMAL(10, 2) DEFAULT 0,
        discount DECIMAL(5, 2) DEFAULT 0,
        color VARCHAR(50),
        location VARCHAR(255),
        services JSON,
        promo_services JSON,
        promo_duration_months INT DEFAULT 0,
        usage_limits JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('Recreando tabla CONTRACTS limpia...');
    await pool.query(`
      CREATE TABLE contracts (
        id VARCHAR(50) PRIMARY KEY,
        client_id VARCHAR(50) NOT NULL,
        plan_id VARCHAR(50),
        contract_services JSON,
        contract_price DECIMAL(10, 2),
        contract_promo_services JSON,
        contract_promo_duration INT DEFAULT 0,
        signature_hash VARCHAR(255),
        ip_address VARCHAR(50),
        device_agent TEXT,
        geolocation VARCHAR(255),
        timezone VARCHAR(100),
        signed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        payment_profile_id VARCHAR(100),
        card_token VARCHAR(255),
        last_billed_date DATE,
        next_billing_date DATE,
        auto_billing_enabled TINYINT(1) DEFAULT 1,
        status VARCHAR(20) DEFAULT 'Active',
        retry_count INT DEFAULT 0,
        next_retry_date DATE,
        salon_id INT DEFAULT 1,
        INDEX (client_id),
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
      )
    `);

    await pool.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('\n✅ SISTEMA RESETEADO Y LIMPIO.');
    console.log('Ahora puedes crear planes reales desde el panel de admin.');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ ERROR:', err.message);
    process.exit(1);
  }
}

reset();
