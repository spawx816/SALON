/**
 * Tenant Portability & Export Routes (REM-P1-17)
 *
 * REST Endpoints for GDPR/ARCO tenant data export and secure time-bounded download.
 */

'use strict';

const express = require('express');
const { TenantPortabilityService } = require('../services/tenant_portability.service');

function createTenantPortabilityRoutes({ pool, authMiddleware }) {
  const router = express.Router();
  const service = new TenantPortabilityService({ pool });

  /**
   * POST /api/tenant/export
   * Initiates encrypted export of tenant data.
   */
  router.post('/export', authMiddleware, async (req, res) => {
    try {
      const tenantId = req.user.tenant_id;
      const userId = req.user.id;
      const { password, reason } = req.body;
      const idempotencyKey = req.headers['x-idempotency-key'] || req.body.idempotency_key;

      if (!tenantId) {
        return res.status(403).json({ error: 'TENANT_CONTEXT_REQUIRED', message: 'Contexto de tenant requerido' });
      }

      const result = await service.createTenantExport({
        tenantId,
        userId,
        userPassword: password,
        reason,
        idempotencyKey
      });

      return res.status(201).json({
        success: true,
        export_id: result.exportId,
        download_url: result.downloadUrl,
        download_token: result.downloadToken,
        expires_at: result.expiresAt,
        byte_size: result.byteSize,
        sha256_hash: result.sha256Hash
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.code || 'EXPORT_ERROR', message: err.message });
      }
      console.error('[TENANT_EXPORT_ERROR]', err);
      return res.status(500).json({ error: 'INTERNAL_EXPORT_ERROR', message: 'Error procesando exportación de datos' });
    }
  });

  /**
   * GET /api/tenant/export/:exportId/download
   * Downloads decrypted export bundle with token verification.
   */
  router.get('/export/:exportId/download', authMiddleware, async (req, res) => {
    try {
      const tenantId = req.user.tenant_id;
      const exportId = req.params.exportId;
      const rawToken = req.query.token;

      if (!tenantId) {
        return res.status(403).json({ error: 'TENANT_CONTEXT_REQUIRED', message: 'Contexto de tenant requerido' });
      }

      if (!rawToken) {
        return res.status(401).json({ error: 'TOKEN_REQUIRED', message: 'Token de descarga obligatorio en query parameter' });
      }

      const fileResult = await service.downloadTenantExport({
        tenantId,
        exportId,
        rawToken
      });

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Length', fileResult.byteSize);
      res.setHeader('Content-Disposition', `attachment; filename="tenant-export-${tenantId}-${exportId.substring(0, 8)}.json"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');

      return res.status(200).send(fileResult.buffer);
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.code || 'DOWNLOAD_ERROR', message: err.message });
      }
      console.error('[TENANT_EXPORT_DOWNLOAD_ERROR]', err);
      return res.status(500).json({ error: 'INTERNAL_DOWNLOAD_ERROR', message: 'Error descargando archivo exportado' });
    }
  });

  return router;
}

module.exports = {
  createTenantPortabilityRoutes
};

