const mysql = require('mysql2/promise');

async function migrate() {
  const c = await mysql.createConnection({
    host: '82.197.82.137',
    user: 'u566429295_admin',
    password: 'Arrd1227',
    database: 'u566429295_salonpro'
  });

  try {
    console.log('Creando tabla de roles...');
    await c.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        permisos JSON NOT NULL
      )
    `);

    console.log('Creando tabla de usuarios de sistema...');
    await c.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(50) PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role_id INT,
        last_login TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE SET NULL
      )
    `);

    // Insertar roles base si no existen
    const [existingRoles] = await c.query('SELECT COUNT(*) as count FROM roles');
    if (existingRoles[0].count === 0) {
      console.log('Insertando roles por defecto...');
      const adminPerms = JSON.stringify({
        all: true,
        view_analytics: true,
        manage_staff: true,
        manage_plans: true,
        manage_clients: true,
        record_visits: true,
        process_payments: true
      });
      const staffPerms = JSON.stringify({
        all: false,
        view_analytics: false,
        manage_staff: false,
        manage_plans: false,
        manage_clients: true,
        record_visits: true,
        process_payments: false
      });
      
      await c.query('INSERT INTO roles (nombre, permisos) VALUES (?, ?)', ['Administrador', adminPerms]);
      await c.query('INSERT INTO roles (nombre, permisos) VALUES (?, ?)', ['Staff / Recepción', staffPerms]);
    }

    console.log('MIGRACIÓN DE ROLES COMPLETADA');
  } catch (e) {
    console.error('Error en migración:', e.message);
  } finally {
    c.destroy();
  }
}

migrate();
