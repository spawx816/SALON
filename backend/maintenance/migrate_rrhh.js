const mysql = require('mysql2/promise');

async function migrate() {
  const config = {
    host: '82.197.82.137',
    user: 'u566429295_admin',
    password: 'Arrd1227',
    database: 'u566429295_salonpro'
  };

  try {
    const conn = await mysql.createConnection(config);
    console.log('Conectado a la DB para migración de RRHH...');

    await conn.query(`
      CREATE TABLE IF NOT EXISTS staff_records (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        cedula VARCHAR(20) UNIQUE,
        contacto VARCHAR(50),
        posicion VARCHAR(100),
        direccion TEXT,
        localidad VARCHAR(100),
        fecha_entrada DATE,
        fecha_salida DATE,
        status VARCHAR(20) DEFAULT 'Activo',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('¡Éxito! Tabla staff_records lista.');
    await conn.end();
  } catch (err) {
    console.error('Error en migración:', err.message);
  }
}

migrate();
