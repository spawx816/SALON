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

async function cleanup() {
  console.log('--- INICIANDO LIMPIEZA TOTAL DE CLIENTES (v2) ---');
  try {
    // Desactivar temporalmente el chequeo de llaves foráneas
    await pool.query('SET FOREIGN_KEY_CHECKS = 0');

    const tablesToTruncate = [
      'surveys',
      'verification_codes',
      'visits',
      'payments',
      'contracts',
      'security_requests',
      'gift_cards'
    ];

    for (const table of tablesToTruncate) {
      console.log(`Limpiando tabla: ${table}...`);
      await pool.query(`TRUNCATE TABLE ${table}`);
    }

    console.log('Eliminando todos los clientes...');
    await pool.query('DELETE FROM clients');
    await pool.query('ALTER TABLE clients AUTO_INCREMENT = 1');

    // Reactivar el chequeo de llaves foráneas
    await pool.query('SET FOREIGN_KEY_CHECKS = 1');

    console.log('\n✅ LIMPIEZA COMPLETADA CON ÉXITO.');
    console.log('El sistema de clientes y transacciones está ahora vacío.');
    
    process.exit(0);
  } catch (err) {
    console.error('\n❌ ERROR DURANTE LA LIMPIEZA:', err.message);
    process.exit(1);
  }
}

cleanup();
