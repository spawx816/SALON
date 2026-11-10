const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const REQUIRED_VARS = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASS', 'DB_NAME'];
const missingVars = REQUIRED_VARS.filter(v => !process.env[v] || String(process.env[v]).trim() === '');

if (missingVars.length > 0) {
  console.error(`❌ [ERROR FATAL]: Variables de base de datos obligatorias ausentes: [${missingVars.join(', ')}].`);
  console.error('El script rechaza conexiones por seguridad sin fallbacks hardcoded.');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT, 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  connectionTimeoutMillis: 5000,
});

async function runTest() {
  console.log('🔄 Probando conectividad con PostgreSQL utilizando variables de entorno...');
  console.log(`📦 Base de Datos: ${process.env.DB_NAME} en ${process.env.DB_HOST}:${process.env.DB_PORT}`);

  try {
    const client = await pool.connect();
    console.log('✅ ¡CONEXIÓN EXITOSA A POSTGRESQL!');

    const res = await client.query('SELECT version(), NOW() as server_time');
    console.log('📌 Versión del Servidor:', res.rows[0].version.split(' on ')[0]);
    console.log('⏰ Hora del Servidor:', res.rows[0].server_time);

    client.release();
    await pool.end();
    console.log('🚀 Verificación completada con éxito.');
    process.exit(0);
  } catch (err) {
    console.error('❌ ERROR AL CONECTAR CON POSTGRESQL:');
    console.error(err.message);
    await pool.end().catch(() => {});
    process.exit(1);
  }
}

runTest();
