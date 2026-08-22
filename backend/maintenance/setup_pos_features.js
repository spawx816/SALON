const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function setupPOSFeatures() {
  try {
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME
    });

    console.log('--- Configurando Tablas y Columnas para Módulo POS ---');

    const safeAddColumn = async (table, colName, colDef) => {
      try {
        await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN ${colName} ${colDef}`);
        console.log(`✅ Columna agregada a ${table}: ${colName}`);
      } catch (e) {
        if (e.message.includes('Duplicate column')) {
          console.log(`ℹ️ Columna ya existente en ${table}: ${colName}`);
        } else {
          console.error(`⚠️ Error en ${table}.${colName}:`, e.message);
        }
      }
    };

    await safeAddColumn('visits', 'status', "VARCHAR(30) DEFAULT 'Facturado'");
    await safeAddColumn('visits', 'ticket_number', "VARCHAR(50) DEFAULT NULL");
    await safeAddColumn('visits', 'total', "DECIMAL(10,2) DEFAULT 0.00");
    await safeAddColumn('visits', 'monto_recibido', "DECIMAL(10,2) DEFAULT 0.00");
    await safeAddColumn('visits', 'devuelta', "DECIMAL(10,2) DEFAULT 0.00");
    await safeAddColumn('visits', 'items_detail', "LONGTEXT DEFAULT NULL");
    await safeAddColumn('visits', 'draft_data', "LONGTEXT DEFAULT NULL");
    await safeAddColumn('visits', 'metodo_pago', "VARCHAR(50) DEFAULT 'Efectivo'");
    await safeAddColumn('visits', 'descuento_admin_autorizado', "TINYINT DEFAULT 0");

    // Table for employee payroll consumptions with exact timestamp
    await conn.query(`
      CREATE TABLE IF NOT EXISTS employee_consumptions (
        id VARCHAR(50) PRIMARY KEY,
        employee_id VARCHAR(50) NOT NULL,
        employee_name VARCHAR(255) NOT NULL,
        monto DECIMAL(10,2) NOT NULL,
        servicios LONGTEXT,
        visit_id VARCHAR(50),
        salon_id INT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(50) DEFAULT 'Pendiente_Nomina'
      )
    `);
    console.log('✅ Tabla employee_consumptions verificada/creada');

    // Table for cash register shifts
    await conn.query(`
      CREATE TABLE IF NOT EXISTS cash_registers (
        id INT PRIMARY KEY AUTO_INCREMENT,
        register_number VARCHAR(50),
        employee_id VARCHAR(50),
        employee_name VARCHAR(255),
        salon_id INT DEFAULT 1,
        monto_inicial DECIMAL(10,2) DEFAULT 0.00,
        monto_final DECIMAL(10,2) DEFAULT 0.00,
        diferencia DECIMAL(10,2) DEFAULT 0.00,
        opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        closed_at TIMESTAMP NULL,
        status VARCHAR(20) DEFAULT 'Abierta'
      )
    `);
    console.log('✅ Tabla cash_registers verificada/creada');

    await conn.end();
    console.log('✅ MIGRACIÓN POS COMPLETADA CON ÉXITO');
  } catch (err) {
    console.error('❌ Error en migración:', err);
  }
}

setupPOSFeatures();
