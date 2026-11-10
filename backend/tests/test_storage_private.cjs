/**
 * Test Suite: Private Encrypted Storage & PII Shield (REM-P1-10 & REM-P1-11)
 *
 * Validates:
 * 1. AES-256-GCM encryption at rest on filesystem.
 * 2. Authenticated decryption with SHA-256 integrity verification.
 * 3. Tamper detection (modified ciphertext or auth tag fails fail-closed).
 * 4. Magic bytes MIME validation & malicious executable rejection.
 * 5. Strict multi-tenant isolation: cross-tenant access returns 404.
 * 6. Deletion (soft and hard) and retention enforcement.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { validateTestEnvironment, createIsolatedTestPool } = require('../utils/test_env_guard.cjs');
const { PrivateStorageAdapter } = require('../services/private_storage_adapter');

async function runStoragePrivateSuite() {
  console.log('========================================================================');
  console.log('🛡️ SUITE: ALMACENAMIENTO PRIVADO CIFRADO Y AISLAMIENTO (REM-P1-10/11)');
  console.log('========================================================================\n');

  const testConfig = validateTestEnvironment({ allowDisposableSchema: true });
  const pool = createIsolatedTestPool(testConfig);
  const conn = await pool.getConnection();

  const tempStorageRoot = path.join(__dirname, '../data/test_storage_' + Date.now());
  const encryptionKey = crypto.randomBytes(32).toString('hex');

  const adapter = new PrivateStorageAdapter({
    pool,
    storageRoot: tempStorageRoot,
    encryptionKey
  });

  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();

  try {
    // 0. Setup test tenants
    await conn.query(`INSERT INTO tenants (id, business_name, slug, email) VALUES ($1, 'Tenant A Storage', 'tenant-a-storage', 'storage-a@test.com') ON CONFLICT DO NOTHING`, [tenantA]);
    await conn.query(`INSERT INTO tenants (id, business_name, slug, email) VALUES ($1, 'Tenant B Storage', 'tenant-b-storage', 'storage-b@test.com') ON CONFLICT DO NOTHING`, [tenantB]);

    // --- TEST 1: Cifrado y almacenamiento en disco ---
    console.log('--- TEST 1: Cifrado AES-256-GCM en reposo ---');
    // Minimal valid JPEG header (FF D8 FF E0 ...)
    const sampleJpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01]);
    const fileA = await adapter.saveFile({
      tenantId: tenantA,
      category: 'attendance_photo',
      buffer: sampleJpeg,
      mimeType: 'image/jpeg'
    });

    assert.ok(fileA.id, 'File record must return UUID id');
    assert.strictEqual(fileA.tenant_id, tenantA);
    assert.strictEqual(fileA.mime_type, 'image/jpeg');

    // Verify physical file on disk
    const diskPath = path.join(tempStorageRoot, tenantA, `${fileA.id}.enc`);
    assert.ok(fs.existsSync(diskPath), 'Encrypted file must exist in tenant directory');
    const diskBytes = fs.readFileSync(diskPath);
    // Ciphertext must NOT match plaintext
    assert.notDeepStrictEqual(diskBytes, sampleJpeg, 'Disk file must be encrypted');
    console.log('  ✅ [PASS 1] Archivo guardado con cifrado AES-256-GCM en disco');

    // --- TEST 2: Descifrado auténtico y verificación de hash ---
    console.log('\n--- TEST 2: Descifrado y verificación de integridad SHA-256 ---');
    const readResult = await adapter.readFile({ tenantId: tenantA, fileId: fileA.id });
    assert.deepStrictEqual(readResult.buffer, sampleJpeg, 'Decrypted buffer must match original');
    assert.strictEqual(readResult.sha256Hash, fileA.sha256_hash);
    console.log('  ✅ [PASS 2] Descifrado exitoso con integridad de hash garantizada');

    // --- TEST 3: Detección de alteración (Tampering Defense) ---
    console.log('\n--- TEST 3: Detección de manipulación de datos cifrados ---');
    // Tamper with one byte of the encrypted file on disk
    const tamperedBytes = Buffer.from(diskBytes);
    tamperedBytes[0] ^= 0xFF;
    fs.writeFileSync(diskPath, tamperedBytes);

    let tamperingCaught = false;
    try {
      await adapter.readFile({ tenantId: tenantA, fileId: fileA.id });
    } catch (err) {
      if (err.code === 'DECRYPTION_INTEGRITY_FAILURE') {
        tamperingCaught = true;
      }
    }
    assert.ok(tamperingCaught, 'Tampered ciphertext must fail GCM auth tag check');
    // Restore original
    fs.writeFileSync(diskPath, diskBytes);
    console.log('  ✅ [PASS 3] Manipulación de ciphertext detectada y rechazada por GCM auth tag');

    // --- TEST 4: Aislamiento estricto multi-tenant (IDOR Defense) ---
    console.log('\n--- TEST 4: Aislamiento multi-tenant (HTTP 404 para otro tenant) ---');
    let crossTenantBlocked = false;
    try {
      // Tenant B tries to read Tenant A's file
      await adapter.readFile({ tenantId: tenantB, fileId: fileA.id });
    } catch (err) {
      if (err.statusCode === 404 || err.code === 'FILE_NOT_FOUND') {
        crossTenantBlocked = true;
      }
    }
    assert.ok(crossTenantBlocked, 'Cross-tenant file read must fail with 404 NOT_FOUND');
    console.log('  ✅ [PASS 4] Acceso cruzado entre tenants bloqueado estrictamente con 404');

    // --- TEST 5: Validación de Magic Bytes MIME y rechazo de ejecutables ---
    console.log('\n--- TEST 5: Validación de Magic Bytes y bloqueo de ejecutables ---');
    // Try to upload an executable (MZ header)
    const fakeExecutable = Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    let exeBlocked = false;
    try {
      await adapter.saveFile({
        tenantId: tenantA,
        category: 'attendance_photo',
        buffer: fakeExecutable,
        mimeType: 'image/jpeg' // lying mime
      });
    } catch (err) {
      if (err.code === 'MALICIOUS_PAYLOAD_DETECTED') {
        exeBlocked = true;
      }
    }
    assert.ok(exeBlocked, 'Executable PE header must be rejected');

    // Try to upload PHP script
    const fakePhp = Buffer.from('<?php echo "injected"; ?>');
    let phpBlocked = false;
    try {
      await adapter.saveFile({
        tenantId: tenantA,
        category: 'attendance_photo',
        buffer: fakePhp,
        mimeType: 'image/jpeg'
      });
    } catch (err) {
      if (err.code === 'MALICIOUS_PAYLOAD_DETECTED') {
        phpBlocked = true;
      }
    }
    assert.ok(phpBlocked, 'PHP script payload must be rejected');
    console.log('  ✅ [PASS 5] Cargas ejecutables y políglotas bloqueadas de inmediato');

    // --- TEST 6: Helper Base64 para firmas y fotos de asistencia ---
    console.log('\n--- TEST 6: Almacenamiento directo desde Data URI Base64 ---');
    const base64Png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const sigFile = await adapter.saveBase64({
      tenantId: tenantA,
      category: 'contract_signature',
      base64Data: base64Png,
      retentionDays: 365
    });
    assert.ok(sigFile.id, 'Signature file must be saved and returned');
    assert.strictEqual(sigFile.mime_type, 'image/png');

    const readSig = await adapter.readFile({ tenantId: tenantA, fileId: sigFile.id });
    assert.strictEqual(readSig.mimeType, 'image/png');
    assert.strictEqual(readSig.buffer.length, 70);
    console.log('  ✅ [PASS 6] Conversión segura de Base64 a almacenamiento cifrado verificada');

    // --- TEST 7: Borrado lógico y físico ---
    console.log('\n--- TEST 7: Borrado lógico y físico con aislamiento ---');
    await adapter.deleteFile({ tenantId: tenantA, fileId: fileA.id, hardDelete: false });
    // After soft-delete, readFile must return 404
    let softDelete404 = false;
    try {
      await adapter.readFile({ tenantId: tenantA, fileId: fileA.id });
    } catch (err) {
      if (err.statusCode === 404) softDelete404 = true;
    }
    assert.ok(softDelete404, 'Soft deleted file must return 404 on read');

    // Hard delete
    await adapter.deleteFile({ tenantId: tenantA, fileId: sigFile.id, hardDelete: true });
    const sigDiskPath = path.join(tempStorageRoot, tenantA, `${sigFile.id}.enc`);
    assert.ok(!fs.existsSync(sigDiskPath), 'Hard deleted file must be purged from disk');
    console.log('  ✅ [PASS 7] Borrado seguro (lógico y físico) validado');

    console.log('\n========================================================================');
    console.log('🎉 TODAS LAS PRUEBAS DE ALMACENAMIENTO CIFRADO PRIVADO PASARON (PASS)');
    console.log('========================================================================\n');
  } finally {
    // Teardown
    try {
      await conn.query(`DELETE FROM private_files WHERE tenant_id IN ($1, $2)`, [tenantA, tenantB]);
      await conn.query(`DELETE FROM tenants WHERE id IN ($1, $2)`, [tenantA, tenantB]);
      if (fs.existsSync(tempStorageRoot)) {
        fs.rmSync(tempStorageRoot, { recursive: true, force: true });
      }
    } catch (_) {}
    conn.release();
    await pool.end();
  }
}

if (require.main === module) {
  runStoragePrivateSuite().catch(err => {
    console.error('\n❌ ERROR EN SUITE DE ALMACENAMIENTO PRIVADO:', err);
    process.exit(1);
  });
}

module.exports = { runStoragePrivateSuite };
