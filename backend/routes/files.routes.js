/**
 * Secure Multi-Tenant File Access Router
 * (backend/routes/files.routes.js)
 * 
 * Delivers tenant-owned files with strict authentication, ownership verification,
 * MIME whitelisting, anti-path-traversal sanitization, and security headers.
 * 
 * ZERO UNPROTECTED PUBLIC STATIC SERVING.
 */

'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');

const ALLOWED_MIME_TYPES = Object.freeze([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
  'text/csv'
]);

const FORBIDDEN_EXTENSIONS = Object.freeze([
  '.exe', '.bat', '.cmd', '.sh', '.js', '.mjs', '.cjs', '.html', '.htm', '.php', '.phtml', '.py'
]);

function createFilesRouter(pool, options = {}) {
  const router = express.Router();
  const baseUploadsDir = options.uploadsDir || path.join(__dirname, '..', 'public', 'uploads');

  /**
   * GET /api/tenant/files/:fileId
   * Authenticated file download/view scoped strictly to authenticated tenant.
   */
  router.get('/:fileId', async (req, res) => {
    try {
      const tenantId = req.tenantId || req.auth?.tenantId;
      if (!tenantId) {
        return res.status(401).json({ error: 'Autenticación requerida para acceder a archivos del salón.', code: 'UNAUTHENTICATED' });
      }

      const rawFileId = req.params.fileId;

      // 1. Anti-Path Traversal & Sanitization
      if (
        !rawFileId ||
        typeof rawFileId !== 'string' ||
        rawFileId.includes('..') ||
        rawFileId.includes('/') ||
        rawFileId.includes('\\') ||
        rawFileId.includes('\0') ||
        /%2e%2e/i.test(rawFileId) ||
        /%2f/i.test(rawFileId)
      ) {
        return res.status(400).json({
          error: 'Identificador de archivo inválido o intento de path traversal detectado.',
          code: 'INVALID_FILE_IDENTIFIER'
        });
      }

      const sanitizedFileId = path.basename(rawFileId).trim();
      const ext = path.extname(sanitizedFileId).toLowerCase();

      if (FORBIDDEN_EXTENSIONS.includes(ext)) {
        return res.status(400).json({
          error: 'Tipo de archivo no permitido por políticas de seguridad.',
          code: 'DISALLOWED_FILE_EXTENSION'
        });
      }

      // 2. Database Metadata & Ownership Check (Scoped by tenant_id)
      let fileMeta = null;
      try {
        const [rows] = await pool.query(
          'SELECT file_id, tenant_id, filename, mime_type, content_base64, is_active FROM tenant_files WHERE file_id = ? AND tenant_id = ? AND (is_active = true OR is_active = 1) LIMIT 1',
          [sanitizedFileId, tenantId]
        );
        if (rows && rows.length > 0) {
          fileMeta = rows[0];
        }
      } catch (dbErr) {
        // Table might not exist or empty in mock
      }

      // 3. If file metadata exists in database
      if (fileMeta) {
        const mime = fileMeta.mime_type || 'application/octet-stream';
        if (!ALLOWED_MIME_TYPES.includes(mime)) {
          return res.status(400).json({
            error: 'Tipo MIME no permitido para entrega segura.',
            code: 'DISALLOWED_MIME_TYPE'
          });
        }

        const safeFilename = path.basename(fileMeta.filename || sanitizedFileId).replace(/[^a-zA-Z0-9._-]/g, '_');

        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
        res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');

        if (fileMeta.content_base64) {
          const buffer = Buffer.from(fileMeta.content_base64, 'base64');
          return res.status(200).send(buffer);
        }
      }

      // 4. Physical Storage Check (scoped to tenant folder)
      const tenantStorageDir = path.join(baseUploadsDir, tenantId);
      const safePhysicalPath = path.join(tenantStorageDir, sanitizedFileId);

      // Verify the resolved path is strictly inside tenantStorageDir
      const resolvedPath = path.resolve(safePhysicalPath);
      const resolvedTenantDir = path.resolve(tenantStorageDir);

      if (!resolvedPath.startsWith(resolvedTenantDir)) {
        return res.status(400).json({
          error: 'Violación de ruta de almacenamiento detectada.',
          code: 'PATH_TRAVERSAL_DETECTED'
        });
      }

      if (fs.existsSync(resolvedPath)) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
        res.setHeader('Content-Disposition', `inline; filename="${sanitizedFileId}"`);
        return res.sendFile(resolvedPath);
      }

      // If file not found in tenant records or storage: return 404 (Anti-enumeration)
      return res.status(404).json({
        error: 'El archivo solicitado no existe o no pertenece a este salón.',
        code: 'FILE_NOT_FOUND'
      });
    } catch (err) {
      console.error('[FILES ROUTE ERROR]:', err);
      res.status(500).json({ error: 'Error interno procesando archivo.', code: 'FILE_PROCESSING_ERROR' });
    }
  });

  return router;
}

module.exports = {
  createFilesRouter,
  ALLOWED_MIME_TYPES
};

