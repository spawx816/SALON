const mysql = require('mysql2/promise');

async function fullCleanup() {
  const config = {
    host: '82.197.82.137',
    user: 'u566429295_admin',
    password: 'Arrd1227',
    database: 'u566429295_salonpro'
  };

  const pool = mysql.createPool(config);

  try {
    console.log('Iniciando limpieza total de datos de clientes...');

    // Desactivar temporalmente las restricciones de llave foránea para evitar errores de integridad
    await pool.query('SET FOREIGN_KEY_CHECKS = 0');

    console.log('Vaciando tabla de visitas...');
    await pool.query('DELETE FROM visits');

    console.log('Vaciando tabla de contratos...');
    await pool.query('DELETE FROM contracts');

    console.log('Vaciando tabla de clientes...');
    await pool.query('DELETE FROM clients');

    console.log('Vaciando tabla de códigos de verificación...');
    await pool.query('DELETE FROM verification_codes');

    console.log('Vaciando tabla de solicitudes de seguridad...');
    await pool.query('DELETE FROM security_requests');

    // Reactivar restricciones
    await pool.query('SET FOREIGN_KEY_CHECKS = 1');

    console.log('✅ Limpieza completada con éxito. La base de datos de clientes está vacía y lista para nuevas pruebas.');

  } catch (e) {
    console.error('❌ Error durante la limpieza:', e.message);
  } finally {
    await pool.end();
  }
}

fullCleanup();
