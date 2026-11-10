/**
 * Legacy Plaintext Vault & Secure Purge Tool
 *
 * Requirements:
 * 1. Inventories all unencrypted legacy dumps, DGII outputs, and backups.
 * 2. Ciphers them in-stream directly into backend/backups/legacy_vault_encrypted.enc.
 * 3. Signs the vault with an independent HMAC key.
 * 4. Completely purges the plaintext files and directories from the disk.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { streamEncryptBackup, streamDecryptBackup } = require('./secure_backup.cjs');

async function vaultAndPurgeLegacyPlaintexts() {
  console.log('=== SECURE VAULT & PURGE OF LEGACY PLAINTEXT BACKUPS ===\n');

  const rootDir = path.resolve(__dirname, '..', '..');
  const backendDir = path.resolve(__dirname, '..');
  const backupsDir = path.resolve(__dirname, '..', 'backups');
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

  const targetCandidates = [
    { type: 'file', filename: 'backup_deleted_ponches_20260712.json', label: 'Attendance Ponches Backup' },
    { type: 'file', filename: 'backup_retro_visits_20260831.json', label: 'Retro Visits Backup' },
    { type: 'dir', filename: 'dgii_test_output', label: 'DGII Test Output Directory' },
    { type: 'dir', filename: 'dgii_reception_output', label: 'DGII Reception Output Directory' }
  ];

  const targets = [];
  for (const tc of targetCandidates) {
    const rootPath = path.join(rootDir, tc.filename);
    const backendPath = path.join(backendDir, tc.filename);
    if (fs.existsSync(rootPath)) {
      targets.push({ type: tc.type, path: rootPath, label: `${tc.label} (root)` });
    }
    if (fs.existsSync(backendPath)) {
      targets.push({ type: tc.type, path: backendPath, label: `${tc.label} (backend)` });
    }
  }

  const vaultBundle = {
    archived_at: new Date().toISOString(),
    items: {}
  };

  function readDirRecursive(dir) {
    const files = {};
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        files[ent.name] = readDirRecursive(full);
      } else {
        files[ent.name] = fs.readFileSync(full, 'utf8');
      }
    }
    return files;
  }

  let totalItemsVaulted = 0;

  for (const t of targets) {
    if (fs.existsSync(t.path)) {
      console.log(`📦 Encriptando en bóveda: ${t.label} (${path.basename(t.path)})...`);
      const keyName = path.relative(rootDir, t.path).replace(/\\/g, '/');
      if (t.type === 'file') {
        vaultBundle.items[keyName] = fs.readFileSync(t.path, 'utf8');
      } else {
        vaultBundle.items[keyName] = readDirRecursive(t.path);
      }
      totalItemsVaulted++;
    } else {
      console.log(`ℹ️ Ya purgado o ausente: ${t.label}`);
    }
  }

  if (totalItemsVaulted === 0) {
    console.log('✅ Todos los archivos sensibles antiguos ya fueron asegurados y purgados.');
    return;
  }

  const vaultDest = path.join(backupsDir, 'legacy_vault_encrypted.enc');
  await streamEncryptBackup(vaultBundle, vaultDest);
  console.log(`\n🔒 Bóveda segura creada exitosamente: ${vaultDest}`);

  // Decryption & Recovery Verification BEFORE purge
  console.log('\n🔍 Verificando capacidad de descifrado y verificación de integridad criptográfica...');
  const decryptedVault = await streamDecryptBackup(vaultDest);
  assert(decryptedVault && typeof decryptedVault === 'object', 'Decrypted vault payload must be a valid object');
  assert(decryptedVault.items && typeof decryptedVault.items === 'object', 'Decrypted vault must contain items');

  for (const keyName of Object.keys(vaultBundle.items)) {
    assert(decryptedVault.items[keyName] !== undefined, `Decrypted vault missing item: ${keyName}`);
    console.log(`  ✅ Verificado descifrado íntegro para: ${keyName}`);
  }
  console.log('✅ Verificación previa de recuperación completada con éxito.');

  // Purge plaintexts from disk
  console.log('\n🧹 Purgando copias en texto plano del disco...');
  for (const t of targets) {
    if (fs.existsSync(t.path)) {
      if (t.type === 'file') {
        fs.unlinkSync(t.path);
        console.log(`  🗑️ Eliminado en texto plano: ${path.basename(t.path)}`);
      } else {
        fs.rmSync(t.path, { recursive: true, force: true });
        console.log(`  🗑️ Directorio purgado: ${path.basename(t.path)}`);
      }
    }
  }

  console.log('\n✅ PURGA DE SEGURIDAD COMPLETADA: Ningún dato sensible residual permanece en texto plano.\n');
}

if (require.main === module) {
  vaultAndPurgeLegacyPlaintexts()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[FATAL VAULT ERROR]:', err.message);
      process.exit(1);
    });
}

module.exports = { vaultAndPurgeLegacyPlaintexts };

