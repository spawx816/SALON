const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function init() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  await conn.query(`
    CREATE TABLE IF NOT EXISTS dgii_ncf_sequences (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tipo_comprobante VARCHAR(10) NOT NULL,
      nombre_comprobante VARCHAR(150) NOT NULL,
      no_solicitud VARCHAR(50),
      no_autorizacion VARCHAR(50),
      numero_desde VARCHAR(30) NOT NULL,
      numero_hasta VARCHAR(30) NOT NULL,
      secuencia_actual BIGINT NOT NULL DEFAULT 0,
      cantidad_aprobada INT NOT NULL,
      cantidad_usada INT NOT NULL DEFAULT 0,
      fecha_vencimiento DATE,
      estado ENUM('Activo', 'Agotado', 'Vencido', 'Inactivo') DEFAULT 'Activo',
      alerta_minima INT DEFAULT 5,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  console.log('✅ Table dgii_ncf_sequences created/verified');

  // Insert the approved sequence from the user's photo
  const [existing] = await conn.query('SELECT id FROM dgii_ncf_sequences WHERE no_solicitud = ? OR no_autorizacion = ?', ['6010004045', '6005529050']);
  if (existing.length === 0) {
    await conn.query(`
      INSERT INTO dgii_ncf_sequences 
      (tipo_comprobante, nombre_comprobante, no_solicitud, no_autorizacion, numero_desde, numero_hasta, secuencia_actual, cantidad_aprobada, cantidad_usada, fecha_vencimiento, estado)
      VALUES 
      ('E31', 'Factura de Crédito Fiscal Electrónico', '6010004045', '6005529050', 'E310000000001', 'E310000000010', 0, 10, 0, '2027-12-31', 'Activo')
    `);
    console.log('✅ Added approved E31 batch (Solicitud 6010004045) to database');
  }

  const [rows] = await conn.query('SELECT * FROM dgii_ncf_sequences');
  console.log('Current sequences in DB:', rows);
  await conn.end();
}

init().catch(console.error);
