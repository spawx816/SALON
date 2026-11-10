/**
 * Authenticated Private Files Access Routes (REM-P1-10 & REM-P1-11)
 *
 * Provides strictly authenticated, tenant-isolated access to encrypted files at rest.
 * Enforces HTTP 404 on cross-tenant access and role-based permissions for sensitive documents.
 */

'use strict';

const express = require('express');
const { getPrivateStorageAdapter } = require('../services/private_storage_adapter');

function createPrivateFilesRoutes({ pool, authMiddleware }) {
  const router = express.Router();
  const storageAdapter = getPrivateStorageAdapter({ pool });

  /**
   * GET /api/tenant/private-files/:fileId
   * Stream decrypted private file for authenticated user.
   */
  router.get('/private-files/:fileId', authMiddleware, async (req, res) => {
    try {
      const tenantId = req.user.tenant_id;
      const fileId = req.params.fileId;

      if (!tenantId) {
        return res.status(403).json({ error: 'TENANT_CONTEXT_REQUIRED', message: 'Contexto de tenant requerido' });
      }

      // UUID format validation to prevent injection or invalid queries
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(fileId)) {
        return res.status(404).json({ error: 'FILE_NOT_FOUND', message: 'Archivo no encontrado' });
      }

      const fileResult = await storageAdapter.readFile({ tenantId, fileId });

      // Sensitivity check: contract signatures and ID documents restricted to admins/owners/superadmins
      const SENSITIVE_CATEGORIES = ['contract_signature', 'contract_document', 'contract_selfie'];
      if (SENSITIVE_CATEGORIES.includes(fileResult.category)) {
        const allowedRoles = ['admin', 'owner', 'superadmin'];
        if (!allowedRoles.includes(req.user.role)) {
          // If requester is a client, verify if contract belongs to this client
          let isOwnerClient = false;
          if (req.user.role === 'client' && req.user.id) {
            const [contractRows] = await pool.query(
              `SELECT id FROM contracts 
               WHERE tenant_id = $1 AND client_id::text = $2 
                 AND (signature_file_id = $3 OR document_photo_file_id = $3 OR selfie_photo_file_id = $3)`,
              [tenantId, String(req.user.id), fileId]
            );
            if (contractRows && contractRows.length > 0) {
              isOwnerClient = true;
            }
          }

          if (!isOwnerClient) {
            return res.status(404).json({ error: 'FILE_NOT_FOUND', message: 'Archivo no encontrado' });
          }
        }
      }

      // Security headers for file delivery
      res.setHeader('Content-Type', fileResult.mimeType);
      res.setHeader('Content-Length', fileResult.byteSize);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
      res.setHeader('Content-Security-Policy', "default-src 'none'");

      return res.status(200).send(fileResult.buffer);
    } catch (err) {
      if (err.statusCode === 404 || err.code === 'FILE_NOT_FOUND' || err.code === 'PHYSICAL_FILE_MISSING') {
        return res.status(404).json({ error: 'FILE_NOT_FOUND', message: 'Archivo no encontrado' });
      }
      console.error('[PRIVATE_FILES_ERROR]', err);
      return res.status(500).json({ error: 'INTERNAL_FILE_ERROR', message: 'Error procesando archivo' });
    }
  });

  return router;
}

module.exports = {
  createPrivateFilesRoutes
};

