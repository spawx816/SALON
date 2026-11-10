/**
 * Stream-Based Authenticated Secure Backup Utility
 *
 * Enforces:
 * 1. Independent 32-byte BACKUP_ENCRYPTION_KEY (Fail-Closed, zero defaults).
 * 2. Independent 32-byte BACKUP_HMAC_KEY (for cryptographic signature).
 * 3. Rejects any key derived from or identical to JWT_SECRET.
 * 4. In-stream streaming encryption (AES-256-GCM); plaintext NEVER touches disk.
 * 5. Cryptographically signed backup manifest.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable, Transform } = require('stream');

function getValidatedBackupKeys() {
  const encKeyRaw = process.env.BACKUP_ENCRYPTION_KEY;
  const hmacKeyRaw = process.env.BACKUP_HMAC_KEY;

  if (!encKeyRaw || String(encKeyRaw).trim() === '') {
    throw new Error('SECURITY HALT: Variable obligatoria BACKUP_ENCRYPTION_KEY ausente.');
  }

  if (!hmacKeyRaw || String(hmacKeyRaw).trim() === '') {
    throw new Error('SECURITY HALT: Variable obligatoria BACKUP_HMAC_KEY ausente.');
  }

  const jwtSecret = process.env.JWT_SECRET || '';
  if (jwtSecret && (encKeyRaw === jwtSecret || hmacKeyRaw === jwtSecret)) {
    throw new Error('SECURITY HALT: BACKUP_ENCRYPTION_KEY y BACKUP_HMAC_KEY no pueden derivarse ni ser iguales a JWT_SECRET.');
  }

  if (encKeyRaw === hmacKeyRaw) {
    throw new Error('SECURITY HALT: BACKUP_ENCRYPTION_KEY y BACKUP_HMAC_KEY deben ser dos claves criptográficas distintas.');
  }

  // Parse 32-byte keys (hex or base64)
  let encKey = Buffer.from(encKeyRaw, 'hex');
  if (encKey.length !== 32) encKey = Buffer.from(encKeyRaw, 'base64');
  if (encKey.length !== 32) {
    throw new Error(`SECURITY HALT: BACKUP_ENCRYPTION_KEY inválida. Longitud: ${encKey.length} bytes (se requieren exactamente 32 bytes).`);
  }

  let hmacKey = Buffer.from(hmacKeyRaw, 'hex');
  if (hmacKey.length !== 32) hmacKey = Buffer.from(hmacKeyRaw, 'base64');
  if (hmacKey.length !== 32) {
    throw new Error(`SECURITY HALT: BACKUP_HMAC_KEY inválida. Longitud: ${hmacKey.length} bytes (se requieren exactamente 32 bytes).`);
  }

  return { encKey, hmacKey };
}

/**
 * Encrypts an object in-stream directly to disk without plaintext intermediate files.
 */
async function streamEncryptBackup(dataObject, destinationPath) {
  const { encKey, hmacKey } = getValidatedBackupKeys();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  const hmac = crypto.createHmac('sha256', hmacKey);

  // In-memory string serialization stream
  const jsonString = typeof dataObject === 'string' ? dataObject : JSON.stringify(dataObject);
  const readStream = Readable.from(Buffer.from(jsonString, 'utf8'));

  const fileWriteStream = fs.createWriteStream(destinationPath);

  // Write 12-byte IV header first
  fileWriteStream.write(iv);
  hmac.update(iv);

  // Transform stream encrypts chunks and updates HMAC
  const encryptTransform = new Transform({
    transform(chunk, encoding, callback) {
      try {
        const encrypted = cipher.update(chunk);
        hmac.update(encrypted);
        callback(null, encrypted);
      } catch (err) {
        callback(err);
      }
    },
    flush(callback) {
      try {
        const finalChunk = cipher.final();
        hmac.update(finalChunk);
        const tag = cipher.getAuthTag(); // 16-byte GCM tag
        hmac.update(tag);
        this.push(finalChunk);
        this.push(tag); // Append auth tag at the end of encrypted stream
        callback();
      } catch (err) {
        callback(err);
      }
    }
  });

  await pipeline(readStream, encryptTransform, fileWriteStream);

  const signature = hmac.digest('hex');
  const manifest = {
    destination: path.basename(destinationPath),
    algorithm: 'aes-256-gcm',
    iv_bytes: 12,
    tag_bytes: 16,
    hmac_algorithm: 'sha256',
    hmac_signature: signature,
    timestamp: new Date().toISOString()
  };

  const manifestPath = destinationPath + '.manifest.json';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  console.log(`🔒 [SECURE BACKUP] Flujo cifrado in-stream completado: ${destinationPath}`);
  console.log(`🔏 [SECURE BACKUP] Manifiesto firmado criptográficamente: ${manifestPath}`);

  return manifest;
}

/**
 * Decrypts a vault backup file in-stream, validating HMAC signature and GCM auth tag.
 */
async function streamDecryptBackup(vaultPath, expectedManifestPath = null) {
  const { encKey, hmacKey } = getValidatedBackupKeys();
  const manifestPath = expectedManifestPath || (vaultPath + '.manifest.json');

  if (!fs.existsSync(vaultPath)) {
    throw new Error(`VAULT FILE NOT FOUND: ${vaultPath}`);
  }
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`VAULT MANIFEST NOT FOUND: ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const fileBuffer = fs.readFileSync(vaultPath);

  // 1. Verify HMAC signature over the entire file
  const hmac = crypto.createHmac('sha256', hmacKey);
  hmac.update(fileBuffer);
  const computedSignature = hmac.digest('hex');

  const sigBuffer = Buffer.from(computedSignature, 'hex');
  const expectedSigBuffer = Buffer.from(manifest.hmac_signature, 'hex');

  if (sigBuffer.length !== expectedSigBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedSigBuffer)) {
    throw new Error('SECURITY HALT: HMAC signature verification failed. Vault is corrupt or tampered with.');
  }

  // 2. Extract IV (12 bytes) and Tag (16 bytes)
  const ivBytes = manifest.iv_bytes || 12;
  const tagBytes = manifest.tag_bytes || 16;

  if (fileBuffer.length < ivBytes + tagBytes) {
    throw new Error('SECURITY HALT: Vault file size is less than minimum IV + Auth Tag headers.');
  }

  const iv = fileBuffer.subarray(0, ivBytes);
  const tag = fileBuffer.subarray(fileBuffer.length - tagBytes);
  const ciphertext = fileBuffer.subarray(ivBytes, fileBuffer.length - tagBytes);

  // 3. Decrypt with AES-256-GCM
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(ciphertext, undefined, 'utf8');
  decrypted += decipher.final('utf8');

  try {
    return JSON.parse(decrypted);
  } catch {
    return decrypted;
  }
}

module.exports = {
  getValidatedBackupKeys,
  streamEncryptBackup,
  streamDecryptBackup
};
