const mysql = require('mysql2/promise');

async function initDB() {
  console.log('Connecting to MySQL database...');
  try {
    const connection = await mysql.createConnection({
      host: '82.197.82.137',
      user: 'u566429295_admin',
      password: 'Arrd1227', // Use exactly the user-provided password
      database: 'u566429295_salonpro',
      connectTimeout: 10000 
    });

    console.log('Connected to MySQL successfully!');

    // 1. Clients Table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS clients (
        id VARCHAR(50) PRIMARY KEY,
        cedula VARCHAR(50) UNIQUE NOT NULL,
        nombre VARCHAR(255) NOT NULL,
        telefono VARCHAR(50),
        email VARCHAR(255),
        frecuencia VARCHAR(50) DEFAULT 'Mensual',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Table "clients" created or verified.');

    // 2. Visits Table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS visits (
        id VARCHAR(50) PRIMARY KEY,
        client_id VARCHAR(50) NOT NULL,
        client_name VARCHAR(255),
        servicios JSON,
        empleado_peluquera VARCHAR(255),
        empleado_manicurista VARCHAR(255),
        proxima_fecha DATE,
        recordatorio_auto BOOLEAN DEFAULT 0,
        total DECIMAL(10, 2) DEFAULT 0,
        visited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
      )
    `);
    console.log('Table "visits" created or verified.');

    // 3. Surveys Table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS surveys (
        id VARCHAR(50) PRIMARY KEY,
        client_id VARCHAR(50),
        q1 INT,
        q2 INT,
        q3 INT,
        q4 INT,
        q5 INT,
        q6 VARCHAR(50),
        q7 VARCHAR(50),
        q8 INT,
        q9 TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
      )
    `);
    console.log('Table "surveys" created or verified.');

    // 4. Plans Table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS plans (
        id VARCHAR(50) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        discount DECIMAL(5, 2) DEFAULT 0,
        color VARCHAR(50),
        location VARCHAR(255),
        services JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Table "plans" created or verified.');

    // 5. Contracts Table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS contracts (
        id VARCHAR(50) PRIMARY KEY,
        client_id VARCHAR(50) NOT NULL,
        plan_id VARCHAR(50),
        signature_hash VARCHAR(255),
        ip_address VARCHAR(50),
        device_agent TEXT,
        timezone VARCHAR(100),
        signed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
      )
    `);
    console.log('Table "contracts" created or verified.');

    console.log('====================================');
    console.log('DATABASE INITIALIZATION COMPLETE.');
    console.log('====================================');
    await connection.end();

  } catch (error) {
    console.error('Failed to initialize database:', error.message);
  }
}

initDB();
