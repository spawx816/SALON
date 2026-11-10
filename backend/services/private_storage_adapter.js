/**
 * Private Encrypted Storage Adapter (REM-P1-10 & REM-P1-11)
 *
 * Implements tenant-scoped, AES-256-GCM encrypted file storage at rest.
 * Ensures zero Base64 blobs in relational tables, strict tenant isolation,
 * magic bytes MIME validation, and tamper-evident authenticated decryption.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pool: defaultPool } = require('../db');

// Allowed MIME types and their canonical magic bytes signatures
const MAGIC_SIGNATURES = [
  { mime: 'image/jpeg', test: (buf) => buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF },
  { mime: 'image/png',  test: (buf) => buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 && buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A },
  { mime: 'image/webp', test: (buf) => buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP' },
  { mime: 'application/pdf', test: (buf) => buf.length >= 4 && buf.toString('ascii', 0, 4) === '%PDF' },
  { mime: 'application/json', test: (buf) => {
    if (buf.length < 2) return false;
    const str = buf.toString('utf8', 0, Math.min(buf.length, 64)).trim();
    return str.startsWith('{') || str.startsWith('[');
  }},
  { mime: 'application/zip', test: (buf) => buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4B && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07) }
];

// Dangerous magic headers (executables, scripts, PHP, HTML)
function detectDangerousPayload(buf) {
  if (buf.length >= 2 && buf[0] === 0x4D && buf[1] === 0x5A) return 'DOS/PE_EXECUTABLE';
  if (buf.length >= 4 && buf[0] === 0x7F && buf[1] === 0x45 && buf[2] === 0x4C && buf[3] === 0x46) return 'ELF_EXECUTABLE';
  const prefix = buf.toString('utf8', 0, Math.min(buf.length, 512)).toLowerCase();
  if (prefix.includes('<?php')) return 'PHP_SCRIPT';
  if (prefix.includes('<script') || prefix.includes('<html')) return 'HTML_SCRIPT_POLYGLOT';
  return null;
}

class PrivateStorageAdapter {
  constructor(options = {}) {
    this.pool = options.pool || defaultPool;
    this.maxSizeBytes = options.maxSizeBytes || 10 * 1024 * 1024; // 10MB
    this.storageRoot = options.storageRoot || process.env.STORAGE_ROOT_DIR || path.join(__dirname, '../data/storage');
    this._initKey(options.encryptionKey);
  }

  _initKey(customKey) {
    const rawKey = customKey || process.env.STORAGE_ENCRYPTION_KEY;
    if (rawKey && typeof rawKey === 'string' && rawKey.trim().length > 0) {
      const trimmed = rawKey.trim();
      if (trimmed.length === 64) {
        this.masterKey = Buffer.from(trimmed, 'hex');
      } else if (trimmed.length === 32) {
        this.masterKey = Buffer.from(trimmed, 'utf8');
      } else {
        // Deterministically hash to 32 bytes
        this.masterKey = crypto.createHash('sha256').update(trimmed).digest();
      }
    } else {
      // In development / test fallback if not provided
      if (process.env.NODE_ENV === 'production') {
        throw new Error('FATAL SECURITY DEFENSE: STORAGE_ENCRYPTION_KEY missing in production.');
      }
      this.masterKey = crypto.createHash('sha256').update('salonpro-dev-storage-secret-key-32b').digest();
    }
  }

  validateMagicBytes(buffer, declaredMime) {
    const dangerous = detectDangerousPayload(buffer);
    if (dangerous) {
      const err = new Error(`SECURITY ALERT: Payload rejected due to executable/script signature (${dangerous})`);
      err.code = 'MALICIOUS_PAYLOAD_DETECTED';
      throw err;
    }

    if (declaredMime) {
      const sig = MAGIC_SIGNATURES.find(s => s.mime === declaredMime);
      if (sig && !sig.test(buffer)) {
        const err = new Error(`MIME mismatch: declared ${declaredMime} does not match magic bytes.`);
        err.code = 'INVALID_MIME_MAGIC_BYTES';
        throw err;
      }
    }

    for (const sig of MAGIC_SIGNATURES) {
      if (sig.test(buffer)) {
        return sig.mime;
      }
    }

    const err = new Error('Unsupported or unrecognizable file format.');
    err.code = 'UNSUPPORTED_MEDIA_TYPE';
    throw err;
  }

  /**
   * Encrypts and stores a binary file for a specific tenant.
   */
  async saveFile({ tenantId, category, buffer, mimeType, retentionDays = null, client = null }) {
    if (!tenantId) throw new Error('saveFile requires tenantId');
    if (!category) throw new Error('saveFile requires category');
    if (!Buffer.isBuffer(buffer)) throw new Error('saveFile requires buffer to be a Buffer');

    if (buffer.length === 0) {
      const err = new Error('Cannot store empty file (0 bytes).');
      err.code = 'EMPTY_FILE';
      throw err;
    }

    if (buffer.length > this.maxSizeBytes) {
      const err = new Error(`File size (${buffer.length} bytes) exceeds limit of ${this.maxSizeBytes} bytes.`);
      err.code = 'FILE_TOO_LARGE';
      throw err;
    }

    const verifiedMime = this.validateMagicBytes(buffer, mimeType);
    const sha256Hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const fileId = crypto.randomUUID();

    // 12-byte random IV for AES-256-GCM
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);
    
    // Additional Authenticated Data (AAD): bind tenant_id and file_id
    const aad = Buffer.from(`${tenantId}:${fileId}:${category}`, 'utf8');
    cipher.setAAD(aad);

    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Tenant-isolated directory on disk
    const tenantDir = path.join(this.storageRoot, String(tenantId));
    if (!fs.existsSync(tenantDir)) {
      fs.mkdirSync(tenantDir, { recursive: true });
    }

    const relStoragePath = path.join(String(tenantId), `${fileId}.enc`);
    const absStoragePath = path.join(this.storageRoot, relStoragePath);
    fs.writeFileSync(absStoragePath, encrypted);

    let retentionUntil = null;
    if (retentionDays && Number.isInteger(retentionDays) && retentionDays > 0) {
      retentionUntil = new Date(Date.now() + retentionDays * 86400000);
    }

    const sql = `
      INSERT INTO private_files (
        id, tenant_id, category, mime_type, byte_size, sha256_hash, 
        storage_path, encryption_iv, encryption_tag, retention_until, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
      RETURNING id, tenant_id, category, mime_type, byte_size, sha256_hash, created_at
    `;
    const params = [
      fileId,
      tenantId,
      category,
      verifiedMime,
      buffer.length,
      sha256Hash,
      relStoragePath,
      iv.toString('hex'),
      authTag.toString('hex'),
      retentionUntil
    ];

    const executor = client || this.pool;
    const [rows] = await executor.query(sql, params);

    return rows[0] || {
      id: fileId,
      tenant_id: tenantId,
      category,
      mime_type: verifiedMime,
      byte_size: buffer.length,
      sha256_hash: sha256Hash
    };
  }

  /**
   * Parses and stores a Base64 data string (from webcams, canvas, signatures).
   */
  async saveBase64({ tenantId, category, base64Data, retentionDays = null, client = null }) {
    if (!base64Data || typeof base64Data !== 'string') {
      const err = new Error('Base64 payload missing or invalid.');
      err.code = 'INVALID_BASE64_DATA';
      throw err;
    }

    let cleanBase64 = base64Data;
    let declaredMime = null;

    const dataUriMatch = base64Data.match(/^data:([^;]+);base64,(.+)$/);
    if (dataUriMatch) {
      declaredMime = dataUriMatch[1];
      cleanBase64 = dataUriMatch[2];
    }

    const buffer = Buffer.from(cleanBase64, 'base64');
    return this.saveFile({
      tenantId,
      category,
      buffer,
      mimeType: declaredMime,
      retentionDays,
      client
    });
  }

  /**
   * Retrieves and decrypts a private file with strict tenant isolation.
   * Throws 404 NOT_FOUND if file does not exist OR belongs to another tenant.
   */
  async readFile({ tenantId, fileId, client = null }) {
    if (!tenantId || !fileId) {
      const err = new Error('tenantId and fileId are required');
      err.code = 'BAD_REQUEST';
      err.statusCode = 400;
      throw err;
    }

    const sql = `
      SELECT id, tenant_id, category, mime_type, byte_size, sha256_hash, 
             storage_path, encryption_iv, encryption_tag, deleted_at
      FROM private_files
      WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
    `;
    const executor = client || this.pool;
    const [rows] = await executor.query(sql, [fileId, tenantId]);

    if (!rows || rows.length === 0) {
      const err = new Error('Archivo no encontrado');
      err.code = 'FILE_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const fileMeta = rows[0];
    const absPath = path.join(this.storageRoot, fileMeta.storage_path);

    if (!fs.existsSync(absPath)) {
      const err = new Error('Archivo no encontrado en almacenamiento físico');
      err.code = 'PHYSICAL_FILE_MISSING';
      err.statusCode = 404;
      throw err;
    }

    const encryptedData = fs.readFileSync(absPath);
    const iv = Buffer.from(fileMeta.encryption_iv, 'hex');
    const authTag = Buffer.from(fileMeta.encryption_tag, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, iv);
    decipher.setAuthTag(authTag);

    // Bind AAD: must match exact tuple from encryption
    const aad = Buffer.from(`${tenantId}:${fileId}:${fileMeta.category}`, 'utf8');
    decipher.setAAD(aad);

    let decrypted;
    try {
      decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
    } catch (cipherErr) {
      const err = new Error('Integrity check failed: ciphertext or auth tag tampered.');
      err.code = 'DECRYPTION_INTEGRITY_FAILURE';
      err.statusCode = 500;
      throw err;
    }

    // Verify SHA-256 integrity against database hash
    const computedHash = crypto.createHash('sha256').update(decrypted).digest('hex');
    if (computedHash !== fileMeta.sha256_hash) {
      const err = new Error('SHA-256 checksum mismatch after decryption.');
      err.code = 'CHECKSUM_MISMATCH';
      err.statusCode = 500;
      throw err;
    }

    return {
      fileId: fileMeta.id,
      tenantId: fileMeta.tenant_id,
      category: fileMeta.category,
      mimeType: fileMeta.mime_type,
      byteSize: fileMeta.byte_size,
      sha256Hash: fileMeta.sha256_hash,
      buffer: decrypted
    };
  }

  /**
   * Deletes a private file (soft-delete by default, optional disk purge).
   */
  async deleteFile({ tenantId, fileId, hardDelete = false, client = null }) {
    if (!tenantId || !fileId) {
      const err = new Error('tenantId and fileId are required');
      err.code = 'BAD_REQUEST';
      err.statusCode = 400;
      throw err;
    }

    const executor = client || this.pool;
    const [rows] = await executor.query(
      `SELECT id, storage_path FROM private_files WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [fileId, tenantId]
    );

    if (!rows || rows.length === 0) {
      const err = new Error('Archivo no encontrado');
      err.code = 'FILE_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    if (hardDelete) {
      const absPath = path.join(this.storageRoot, rows[0].storage_path);
      if (fs.existsSync(absPath)) {
        fs.unlinkSync(absPath);
      }
      await executor.query(`DELETE FROM private_files WHERE id = $1 AND tenant_id = $2`, [fileId, tenantId]);
    } else {
      await executor.query(
        `UPDATE private_files SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2`,
        [fileId, tenantId]
      );
    }

    return { success: true, fileId, hardDelete };
  }
}

let singleton = null;
function getPrivateStorageAdapter(options = {}) {
  if (!singleton || options.fresh) {
    singleton = new PrivateStorageAdapter(options);
  }
  return singleton;
}

module.exports = {
  PrivateStorageAdapter,
  getPrivateStorageAdapter
};
