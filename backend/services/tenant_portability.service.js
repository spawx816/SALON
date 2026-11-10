/**
 * Tenant Portability Export Service (REM-P1-17)
 *
 * Implements GDPR/ARCO-compliant tenant data export.
 * Sanitizes all security secrets (password hashes, PINs, tokens),
 * encrypts the export bundle at rest via PrivateStorageAdapter,
 * and issues single-tenant, time-bounded (24h) download tokens.
 */

'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getPrivateStorageAdapter } = require('./private_storage_adapter');

const EXPORT_TABLES = [
  'clients',
  'appointments',
  'visits',
  'invoices',
  'invoice_items',
  'payments',
  'contracts',
  'services',
  'service_categories',
  'inventory_products',
  'inventory_stock',
  'inventory_movements',
  'staff_records',
  'expenses'
];

class TenantPortabilityService {
  constructor({ pool, storageAdapter = null }) {
    this.pool = pool;
    this.storageAdapter = storageAdapter || getPrivateStorageAdapter({ pool });
  }

  /**
   * Generates a sanitized export of all tenant data.
   */
  async createTenantExport({ tenantId, userId, userPassword, reason, idempotencyKey = null }) {
    if (!tenantId || !userId) {
      const err = new Error('tenantId and userId are required');
      err.code = 'BAD_REQUEST';
      err.statusCode = 400;
      throw err;
    }

    if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
      const err = new Error('Se requiere un motivo justificado para la exportación (mínimo 5 caracteres).');
      err.code = 'INVALID_EXPORT_REASON';
      err.statusCode = 400;
      throw err;
    }

    if (!userPassword || typeof userPassword !== 'string') {
      const err = new Error('Se requiere confirmar la contraseña del propietario para autorizar la exportación.');
      err.code = 'PASSWORD_CONFIRMATION_REQUIRED';
      err.statusCode = 401;
      throw err;
    }

    // 1. Re-authenticate user password
    const [userRows] = await this.pool.query(
      `SELECT id, password_hash, role, is_active FROM users WHERE id::text = $1 AND tenant_id = $2`,
      [String(userId), tenantId]
    );

    if (!userRows || userRows.length === 0) {
      const err = new Error('Usuario no encontrado o no pertenece a este tenant');
      err.code = 'USER_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const requestingUser = userRows[0];
    if (!requestingUser.is_active) {
      const err = new Error('Usuario inactivo');
      err.code = 'USER_INACTIVE';
      err.statusCode = 403;
      throw err;
    }

    if (!['owner', 'superadmin', 'admin'].includes(requestingUser.role)) {
      const err = new Error('Solo el propietario o administrador del tenant puede exportar datos.');
      err.code = 'FORBIDDEN_INSUFFICIENT_ROLE';
      err.statusCode = 403;
      throw err;
    }

    const passwordValid = await bcrypt.compare(userPassword, requestingUser.password_hash);
    if (!passwordValid) {
      const err = new Error('Contraseña incorrecta. Autorización denegada.');
      err.code = 'INVALID_CREDENTIALS';
      err.statusCode = 401;
      throw err;
    }

    // 2. Check idempotency if key provided
    if (idempotencyKey) {
      const [existing] = await this.pool.query(
        `SELECT id, file_id, expires_at, created_at, status 
         FROM tenant_exports 
         WHERE tenant_id = $1 AND idempotency_key = $2 AND expires_at > CURRENT_TIMESTAMP`,
        [tenantId, idempotencyKey]
      );
      if (existing && existing.length > 0) {
        return {
          exportId: existing[0].id,
          fileId: existing[0].file_id,
          expiresAt: existing[0].expires_at,
          status: existing[0].status,
          cached: true
        };
      }
    }

    // 3. Extract and sanitize tenant data across tables
    const exportBundle = {
      format_version: '1.0',
      system: 'SalonPro SaaS',
      tenant_id: tenantId,
      exported_at: new Date().toISOString(),
      requested_by_user_id: userId,
      reason: reason.trim(),
      data: {}
    };

    for (const table of EXPORT_TABLES) {
      try {
        const [rows] = await this.pool.query(
          `SELECT * FROM "${table}" WHERE tenant_id = $1 ORDER BY 1 LIMIT 50000`,
          [tenantId]
        );

        // Sanitize rows
        exportBundle.data[table] = (rows || []).map(row => {
          const sanitized = { ...row };
          // Strip critical secrets
          delete sanitized.password_hash;
          delete sanitized.password;
          delete sanitized.admin_pin;
          delete sanitized.token_version;
          delete sanitized.salt;
          return sanitized;
        });
      } catch (tableErr) {
        // Table might not exist or be empty in specific versions
        console.warn(`[EXPORT_TABLE_WARNING] Could not export table ${table}: ${tableErr.message}`);
        exportBundle.data[table] = [];
      }
    }

    const exportJson = JSON.stringify(exportBundle, null, 2);
    const exportBuffer = Buffer.from(exportJson, 'utf8');

    // 4. Save encrypted export file via PrivateStorageAdapter (7 days retention)
    const fileRecord = await this.storageAdapter.saveFile({
      tenantId,
      category: 'tenant_export',
      buffer: exportBuffer,
      mimeType: 'application/json',
      retentionDays: 7
    });

    // 5. Generate secure 24-hour expiring download token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000); // 24 hours
    const exportId = crypto.randomUUID();

    await this.pool.query(
      `INSERT INTO tenant_exports (
        id, tenant_id, requested_by_user_id, status, reason, 
        file_id, download_token_hash, expires_at, idempotency_key, created_at
      ) VALUES ($1, $2, $3, 'completed', $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)`,
      [
        exportId,
        tenantId,
        userId,
        reason.trim(),
        fileRecord.id,
        tokenHash,
        expiresAt,
        idempotencyKey || null
      ]
    );

    return {
      exportId,
      fileId: fileRecord.id,
      downloadToken: rawToken,
      downloadUrl: `/api/tenant/export/${exportId}/download?token=${rawToken}`,
      expiresAt,
      byteSize: exportBuffer.length,
      sha256Hash: fileRecord.sha256_hash,
      status: 'completed'
    };
  }

  /**
   * Validates token and returns decrypted export buffer.
   */
  async downloadTenantExport({ tenantId, exportId, rawToken }) {
    if (!tenantId || !exportId || !rawToken) {
      const err = new Error('Parametros incompletos para descarga de exportación');
      err.code = 'BAD_REQUEST';
      err.statusCode = 400;
      throw err;
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const [rows] = await this.pool.query(
      `SELECT id, tenant_id, file_id, download_token_hash, expires_at, status 
       FROM tenant_exports 
       WHERE id = $1 AND tenant_id = $2`,
      [exportId, tenantId]
    );

    if (!rows || rows.length === 0) {
      const err = new Error('Exportación no encontrada');
      err.code = 'EXPORT_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const exportMeta = rows[0];

    // Check expiration
    if (new Date() > new Date(exportMeta.expires_at)) {
      const err = new Error('El enlace de descarga ha expirado (validez máxima: 24 horas).');
      err.code = 'EXPORT_TOKEN_EXPIRED';
      err.statusCode = 410;
      throw err;
    }

    // Constant-time token verification
    const expectedBuf = Buffer.from(exportMeta.download_token_hash, 'hex');
    const actualBuf = Buffer.from(tokenHash, 'hex');
    if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
      const err = new Error('Token de descarga inválido.');
      err.code = 'INVALID_DOWNLOAD_TOKEN';
      err.statusCode = 401;
      throw err;
    }

    // Read and decrypt file via storage adapter
    return this.storageAdapter.readFile({
      tenantId,
      fileId: exportMeta.file_id
    });
  }
}

module.exports = {
  TenantPortabilityService,
  EXPORT_TABLES
};
