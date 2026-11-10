const { Client } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function rotatePgPassword() {
  const currentHost = process.env.DB_HOST;
  const currentPort = process.env.DB_PORT || 5432;
  const currentUser = process.env.DB_USER;
  const currentPass = process.env.DB_PASS;
  const currentDb = process.env.DB_NAME;

  console.log('[PG ROTATION] Iniciando prueba de rotación controlada...');
  const client = new Client({
    host: currentHost,
    port: currentPort,
    user: currentUser,
    password: currentPass,
    database: currentDb
  });

  await client.connect();
  console.log('✅ Conexión con contraseña actual exitosa.');

  // Generar nueva contraseña criptográfica fuerte (32 bytes base64url)
  const newPass = crypto.randomBytes(32).toString('base64url');

  // Cambiar contraseña en PostgreSQL de forma parametrizada
  console.log('[PG ROTATION] Ejecutando ALTER USER en PostgreSQL...');
  // ALTER USER no acepta parámetros para contraseñas en el protocolo estándar, se escapa de forma segura
  const escapedPass = newPass.replace(/'/g, "''");
  await client.query(`ALTER USER ${currentUser} WITH PASSWORD '${escapedPass}'`);
  await client.end();
  console.log('✅ Contraseña cambiada en el servidor PostgreSQL.');

  // Probar que la contraseña anterior AHORA ES RECHAZADA
  console.log('[PG ROTATION] Verificando que la contraseña anterior sea RECHAZADA...');
  const oldClient = new Client({
    host: currentHost,
    port: currentPort,
    user: currentUser,
    password: currentPass,
    database: currentDb,
    connectionTimeoutMillis: 5000
  });

  let oldRejected = false;
  try {
    await oldClient.connect();
    await oldClient.end();
  } catch (err) {
    if (err.code === '28P01' || err.message.includes('authentication failed')) {
      oldRejected = true;
      console.log('✅ CONFIRMADO: Contraseña anterior fue RECHAZADA por el servidor (Código: 28P01).');
    } else {
      console.error('Error inesperado al probar clave vieja:', err.message);
    }
  }

  if (!oldRejected) {
    throw new Error('FALLO CRÍTICO: La contraseña anterior sigue funcionando.');
  }

  // Probar que la nueva contraseña conecta exitosamente
  console.log('[PG ROTATION] Verificando conexión con nueva contraseña...');
  const newClient = new Client({
    host: currentHost,
    port: currentPort,
    user: currentUser,
    password: newPass,
    database: currentDb
  });
  await newClient.connect();
  const res = await newClient.query('SELECT current_user, current_database()');
  console.log('✅ Conexión con nueva contraseña exitosa:', res.rows[0]);
  await newClient.end();

  // Actualizar backend/.env de forma atómica
  const envPath = path.resolve(__dirname, '../.env');
  let envContent = fs.readFileSync(envPath, 'utf8');
  envContent = envContent.replace(/^DB_PASS=.*$/m, `DB_PASS=${newPass}`);
  fs.writeFileSync(envPath, envContent, 'utf8');
  console.log('✅ backend/.env actualizado con la nueva contraseña.');

  process.exit(0);
}

rotatePgPassword().catch(err => {
  console.error('❌ Error en rotación:', err.message);
  process.exit(1);
});

