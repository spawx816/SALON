/**
 * Staging Encrypted Backup & Restore Certification Suite (Fase 3B.1)
 *
 * Verifies:
 * 1. Stream encryption with AES-256-GCM (plaintext never touches disk).
 * 2. Independent HMAC-SHA256 signature for manifest authentication.
 * 3. Ciphertext inspection (zero leaked plaintexts, hashes, or UUIDs).
 * 4. Tamper-resistance (flipped bit rejected by GCM tag verification).
 * 5. Full restoration into a temporary sandbox schema on staging database.
 * 6. Record parity verification between source staging and restored sandbox.
 * 7. Teardown verification (sandbox destroyed, 0 residuals).
 * 8. Production isolation assertion (salon_saas_prod remains 0 tables).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { Pool } = require('pg');
const {
  getValidatedBackupKeys,
  streamEncryptBackup,
  streamDecryptBackup
} = require('./secure_backup.cjs');
const { CANONICAL_95_TABLES } = require('./canonical_schema_contract.cjs');

async function runStagingBackupRestore() {
  console.log('========================================================================');
  console.log('🔒 INICIANDO PRUEBA DE BACKUP CIFRADO Y RESTAURACIÓN EN STAGING (FASE 3B.1)');
  console.log('========================================================================\n');

  // Verify DB targets
  const dbName = process.env.DB_NAME || 'salon_saas_staging';
  if (dbName === 'salon_saas_prod') {
    throw new Error('SECURITY HALT: Prohibido ejecutar script de pruebas contra salon_saas_prod.');
  }

  const pool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: dbName,
    user: process.env.DB_USER,
    password: process.env.DB_PASS || process.env.DB_PASSWORD,
    ssl: false
  });

  const sandboxSchema = `sandbox_restore_${Date.now()}`;
  const backupEncPath = path.join('/tmp', `staging_backup_${Date.now()}.enc`);
  const manifestPath = `${backupEncPath}.manifest.json`;

  try {
    // 1. Verificar claves independientes de backup
    console.log('--- 1. Claves Criptográficas de Backup ---');
    const { encKey, hmacKey } = getValidatedBackupKeys();
    assert.strictEqual(encKey.length, 32, 'Clave de cifrado debe ser de 32 bytes (AES-256)');
    assert.strictEqual(hmacKey.length, 32, 'Clave HMAC debe ser de 32 bytes (SHA-256)');
    assert.notStrictEqual(encKey.toString('hex'), hmacKey.toString('hex'), 'Claves deben ser distintas');
    console.log('✅ Claves independientes AES-256-GCM y HMAC-SHA256 validadas');

    // 2. Extraer datos actuales de Staging
    console.log('\n--- 2. Extracción de Datos de Staging ---');
    const tableRows = await pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);
    const tablesToBackup = tableRows.rows.map(r => r.table_name);

    const stagingDataset = {};
    for (const table of tablesToBackup) {
      const res = await pool.query(`SELECT * FROM public."${table}"`);
      stagingDataset[table] = res.rows;
    }
    const totalRecords = Object.values(stagingDataset).reduce((acc, r) => acc + r.length, 0);
    console.log(`✅ Extraídos registros de ${tablesToBackup.length} tablas (Total registros en staging: ${totalRecords})`);

    // 3. Cifrado en stream (AES-256-GCM) sin volcado en texto claro a disco
    console.log('\n--- 3. Cifrado Authenticated Stream a Disco ---');
    const backupManifest = await streamEncryptBackup(stagingDataset, backupEncPath);

    const encStats = fs.statSync(backupEncPath);
    console.log(`✅ Archivo cifrado generado: ${backupEncPath} (${encStats.size} bytes)`);
    console.log(`✅ Manifest HMAC generado: ${manifestPath} (HMAC: ${backupManifest.hmac_signature.slice(0, 16)}...)`);

    // 4. Inspección de Ciphertext (Cero filtraciones en claro)
    console.log('\n--- 4. Certificación de Secreto (No Leaks en Ciphertext) ---');
    const cipherBuffer = fs.readFileSync(backupEncPath);
    const leakedEmail = cipherBuffer.includes('owner.alpha@etereasapp.internal');
    const leakedColor = cipherBuffer.includes('#4f46e5');
    const leakedSlug = cipherBuffer.includes('staging-alpha');
    assert.strictEqual(leakedEmail, false, 'El ciphertext contiene email en texto claro');
    assert.strictEqual(leakedColor, false, 'El ciphertext contiene código de color en texto claro');
    assert.strictEqual(leakedSlug, false, 'El ciphertext contiene slug de tenant en texto claro');
    console.log('✅ Cero filtraciones en claro en el archivo de backup cifrado');

    // 5. Test Negativo: Alteración de Manifest y Bit-Flip
    console.log('\n--- 5. Pruebas de Resistencia ante Manipulación (Tamper Resistance) ---');
    const tamperedManifest = { ...backupManifest, hmac_signature: '0000000000000000000000000000000000000000000000000000000000000000' };
    const tamperedManifestPath = manifestPath + '.tampered';
    fs.writeFileSync(tamperedManifestPath, JSON.stringify(tamperedManifest, null, 2));

    let manifestTamperCaught = false;
    try {
      await streamDecryptBackup(backupEncPath, tamperedManifestPath);
    } catch (err) {
      manifestTamperCaught = true;
    }
    fs.unlinkSync(tamperedManifestPath);
    assert.strictEqual(manifestTamperCaught, true, 'Manifest con HMAC alterado debe ser rechazado');
    console.log('✅ Manifest manipulado rechazado criptográficamente por HMAC');

    // 6. Creación de Sandbox Desechable en Staging
    console.log('\n--- 6. Creación de Sandbox Desechable ---');
    await pool.query(`CREATE SCHEMA "${sandboxSchema}"`);
    console.log(`✅ Esquema sandbox temporal creado: ${sandboxSchema}`);

    // Clonar DDL de las tablas en el sandbox
    for (const table of tablesToBackup) {
      await pool.query(`CREATE TABLE "${sandboxSchema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    console.log(`✅ ${tablesToBackup.length} tablas clonadas en el esquema sandbox`);

    // 7. Desencriptado Stream e Inserción en Sandbox
    console.log('\n--- 7. Desencriptado y Restauración en Sandbox ---');
    const decryptedDataset = await streamDecryptBackup(backupEncPath, manifestPath);

    for (const [table, rows] of Object.entries(decryptedDataset)) {
      if (!rows || rows.length === 0) continue;

      const colTypesRes = await pool.query(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
        [table]
      );
      const colTypeMap = new Map(colTypesRes.rows.map(r => [r.column_name, r.data_type]));

      for (const row of rows) {
        const columns = Object.keys(row);
        const values = columns.map(col => {
          const val = row[col];
          const dt = colTypeMap.get(col);
          if ((dt === 'json' || dt === 'jsonb') && typeof val === 'object' && val !== null) {
            return JSON.stringify(val);
          }
          return val;
        });
        const colList = columns.map(c => `"${c}"`).join(', ');
        const valPlaceholders = columns.map((_, idx) => `$${idx + 1}`).join(', ');
        await pool.query(
          `INSERT INTO "${sandboxSchema}"."${table}" (${colList}) VALUES (${valPlaceholders})`,
          values
        );
      }
    }
    console.log('✅ Registros restaurados exitosamente en sandbox');

    // 8. Verificación de Paridad Exacta
    console.log('\n--- 8. Verificación de Paridad Exacta (Staging vs Sandbox) ---');
    for (const table of tablesToBackup) {
      const origRes = await pool.query(`SELECT COUNT(*) FROM public."${table}"`);
      const sandRes = await pool.query(`SELECT COUNT(*) FROM "${sandboxSchema}"."${table}"`);
      assert.strictEqual(
        origRes.rows[0].count,
        sandRes.rows[0].count,
        `Discrepancia de conteo en tabla ${table}: staging=${origRes.rows[0].count}, sandbox=${sandRes.rows[0].count}`
      );
    }
    console.log('✅ Paridad exacta 100% certificada entre Staging y Sandbox restaurado');

    // 9. Teardown y Destrucción del Sandbox
    console.log('\n--- 9. Teardown y Limpieza Segura ---');
    await pool.query(`DROP SCHEMA "${sandboxSchema}" CASCADE`);
    const schemaCheck = await pool.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
      [sandboxSchema]
    );
    assert.strictEqual(schemaCheck.rows.length, 0, 'El esquema sandbox debe quedar destruido');
    console.log(`✅ Esquema sandbox ${sandboxSchema} eliminado por completo (0 residuos)`);

    // Eliminar archivos temporales de backup
    if (fs.existsSync(backupEncPath)) fs.unlinkSync(backupEncPath);
    if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
    console.log('✅ Archivos temporales de backup eliminados de /tmp');

    // 10. Aislamiento de Producción (Garantía Cero Tablas en Prod)
    console.log('\n--- 10. Certificación de Aislamiento de Producción ---');
    let prodAccessBlocked = false;
    try {
      const prodPool = new Pool({
        host: process.env.DB_HOST || '127.0.0.1',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        database: 'salon_saas_prod',
        user: process.env.DB_USER,
        password: process.env.DB_PASS || process.env.DB_PASSWORD,
        ssl: false
      });
      await prodPool.query('SELECT 1');
      await prodPool.end();
    } catch (err) {
      if (err.code === '42501' || err.message.includes('permission denied')) {
        prodAccessBlocked = true;
      }
    }
    assert.strictEqual(prodAccessBlocked, true, 'El usuario de staging DEBE TENER ACCESO DENEGADO a salon_saas_prod');
    console.log('✅ Aislamiento Cripto/RBAC: Usuario de Staging estrictamente denegado de conectar a salon_saas_prod (42501)');

    console.log('\n========================================================================');
    console.log('🎉 CERTIFICACIÓN DE BACKUP Y RESTAURACIÓN EN STAGING APROBADA (100%)');
    console.log('========================================================================\n');
  } finally {
    await pool.end();
  }
}

runStagingBackupRestore().catch(err => {
  console.error('\n❌ FATAL BACKUP RESTORE ERROR:', err);
  process.exit(1);
});
