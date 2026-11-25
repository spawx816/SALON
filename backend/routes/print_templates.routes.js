'use strict';

const express = require('express');
const crypto = require('crypto');
const { getEffectiveRole } = require('../middleware/rbac.middleware');
const { expandEffectivePermissions, permissionMapGrants } = require('../domain/rbac_catalog');
const {
  DOCUMENT_TYPES,
  ALLOWED_PAPER_WIDTHS,
  ALLOWED_NUMBERING_MODES,
  DEFAULT_TEMPLATES,
  stripUnsafeText,
  validateTimezone,
  sanitizeTemplateConfig,
  hasRestaurantOperationalData,
  resolveActiveTemplate,
  issueTurnTicket,
} = require('../services/print_templates.service');

function createPrintTemplatesRouter(pool) {
  const router = express.Router();

  const canManageTemplates = (req) => {
    const role = getEffectiveRole(req);
    if (role === 'propietario' || (role === 'admin' && !req.auth?.roleId)) return true;
    const perms = expandEffectivePermissions(req.auth?.permissions || req.user?.permissions || {});
    return permissionMapGrants(perms, 'security.manage');
  };

  const canOperateTurnTickets = (req) => {
    const role = getEffectiveRole(req);
    if (role === 'cliente_b2c' || role === 'contador') return false;
    if (['propietario', 'admin', 'cajero', 'recepcionista'].includes(role) || req.auth?.isSuperAdmin) return true;
    const perms = expandEffectivePermissions(req.user?.permissions || {});
    return permissionMapGrants(perms, 'record_visits') || permissionMapGrants(perms, 'process_payments');
  };

  const checkBranchAccess = (req, branchId) => {
    const role = getEffectiveRole(req);
    if (role === 'propietario' || req.auth?.isSuperAdmin) return true;
    if (role === 'admin' && !req.auth?.roleId && req.auth?.allBranchesAccess !== false) return true;
    if (req.auth?.allBranchesAccess === true) return true;
    const allowed = Array.isArray(req.auth?.authorizedBranchIds) ? req.auth.authorizedBranchIds.map(String) : [];
    if (!branchId || branchId === 'default') return true;
    return allowed.includes(String(branchId));
  };

  // GET /api/print-templates/availability
  router.get('/print-templates/availability', async (req, res) => {
    const hasRestaurant = await hasRestaurantOperationalData(pool, req.tenantId);
    res.json({
      ticket_turno: { available: true },
      ticket_venta: { available: true },
      factura_comercial: { available: true },
      comanda_restaurante: {
        available: hasRestaurant,
        reason: hasRestaurant ? null : 'No existen datos operativos de restaurante (mesas o pedidos) en este espacio.',
      },
      defaults: DEFAULT_TEMPLATES,
    });
  });

  // GET /api/print-templates
  router.get('/print-templates', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(403).json({ error: 'Contexto de empresa requerido' });

      const { document_type, branch_id } = req.query;
      let sql = 'SELECT * FROM print_templates WHERE tenant_id = ?';
      const params = [tenantId];

      if (document_type && DOCUMENT_TYPES.includes(document_type)) {
        sql += ' AND document_type = ?';
        params.push(document_type);
      }
      if (branch_id) {
        sql += ' AND (branch_id = ? OR branch_id IS NULL)';
        params.push(String(branch_id));
      }
      sql += ' ORDER BY is_default DESC, updated_at DESC';

      const [rows] = await pool.query(sql, params);
      const modeParams = [tenantId];
      let modeSql = `
        SELECT document_type FROM print_templates
        WHERE tenant_id = ?
          AND document_type IN ('ticket_turno', 'ticket_venta')
          AND status = 'published'
          AND is_default = TRUE
      `;
      if (branch_id && branch_id !== 'default') {
        modeSql += ' AND (branch_id = ? OR branch_id IS NULL) ORDER BY CASE WHEN branch_id IS NOT NULL THEN 0 ELSE 1 END, updated_at DESC LIMIT 1';
        modeParams.push(String(branch_id));
      } else {
        modeSql += ' ORDER BY CASE WHEN branch_id IS NULL THEN 0 ELSE 1 END, updated_at DESC LIMIT 1';
      }
      const [modeRows] = await pool.query(modeSql, modeParams).catch(() => [[]]);
      const activeTicketMode = modeRows?.[0]?.document_type === 'ticket_turno' ? 'ticket_turno' : 'ticket_venta';

      res.json({
        templates: rows || [],
        defaults: DEFAULT_TEMPLATES,
        active_ticket_mode: activeTicketMode,
      });
    } catch (err) {
      res.status(500).json({ error: 'Error cargando plantillas de impresión: ' + err.message });
    }
  });

  // GET /api/print-templates/active
  router.get('/print-templates/active', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(403).json({ error: 'Contexto de empresa requerido' });
      const docType = String(req.query.document_type || 'ticket_turno');
      const branchId = req.query.branch_id ? String(req.query.branch_id) : null;
      const active = await resolveActiveTemplate(pool, tenantId, docType, branchId);
      res.json({ template: active });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/print-templates (Create draft or publish)
  router.post('/print-templates', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(403).json({ error: 'Contexto de empresa requerido' });
      if (!canManageTemplates(req)) {
        return res.status(403).json({ error: 'No tienes permiso para crear o editar plantillas de impresión.' });
      }

      const documentType = String(req.body?.document_type || 'ticket_turno');
      if (!DOCUMENT_TYPES.includes(documentType)) {
        return res.status(400).json({ error: 'Tipo de documento inválido.' });
      }
      if (documentType === 'comanda_restaurante') {
        const hasRestaurant = await hasRestaurantOperationalData(pool, tenantId);
        if (!hasRestaurant) {
          return res.status(400).json({ error: 'Comanda de restaurante no disponible sin datos operativos de restaurante.' });
        }
      }

      const paperWidth = ALLOWED_PAPER_WIDTHS.includes(req.body?.paper_width) ? req.body.paper_width : '80mm';
      if (paperWidth === 'A4' && documentType !== 'factura_comercial') {
        return res.status(400).json({ error: 'El formato A4 solo aplica para Factura comercial.' });
      }

      const numberingMode = ALLOWED_NUMBERING_MODES.includes(req.body?.numbering_mode) ? req.body.numbering_mode : 'daily_reset';
      const timezone = validateTimezone(req.body?.timezone);
      const name = stripUnsafeText(req.body?.name || DEFAULT_TEMPLATES[documentType]?.name || 'Plantilla', 120);
      const branchId = req.body?.branch_id ? String(req.body.branch_id).trim() : null;
      const sanitizedConfig = sanitizeTemplateConfig(req.body?.config_json, documentType);
      const publishNow = Boolean(req.body?.publish);
      const isDefault = Boolean(req.body?.is_default);
      const id = crypto.randomUUID();
      const actorId = req.auth?.userId || req.user?.id || null;

      if (isDefault && publishNow) {
        if (documentType === 'ticket_turno' || documentType === 'ticket_venta') {
          await pool.query(
            `UPDATE print_templates SET is_default = FALSE
             WHERE tenant_id = ? AND document_type IN ('ticket_turno', 'ticket_venta') AND (branch_id IS NOT DISTINCT FROM ?)`,
            [tenantId, branchId]
          );
        } else {
          await pool.query(
            `UPDATE print_templates SET is_default = FALSE
             WHERE tenant_id = ? AND document_type = ? AND (branch_id IS NOT DISTINCT FROM ?)`,
            [tenantId, documentType, branchId]
          );
        }
      }

      const [rows] = await pool.query(
        `INSERT INTO print_templates (
           id, tenant_id, branch_id, document_type, name, paper_width, numbering_mode, timezone,
           status, is_default, version, config_json, published_config_json, published_version,
           updated_by_user_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, NOW(), NOW())
         RETURNING *`,
        [
          id,
          tenantId,
          branchId,
          documentType,
          name,
          paperWidth,
          numberingMode,
          timezone,
          publishNow ? 'published' : 'draft',
          publishNow && isDefault,
          JSON.stringify(sanitizedConfig),
          publishNow ? JSON.stringify(sanitizedConfig) : null,
          publishNow ? 1 : null,
          actorId ? String(actorId) : null,
        ]
      );

      res.status(201).json({ template: rows?.[0] || { id, tenant_id: tenantId, document_type: documentType, name } });
    } catch (err) {
      res.status(500).json({ error: 'Error guardando plantilla: ' + err.message });
    }
  });

  // PUT /api/print-templates/:id (Update draft or publish new version)
  router.put('/print-templates/:id', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(403).json({ error: 'Contexto de empresa requerido' });
      if (!canManageTemplates(req)) {
        return res.status(403).json({ error: 'No tienes permiso para editar plantillas de impresión.' });
      }

      const [existingRows] = await pool.query(
        'SELECT * FROM print_templates WHERE id = ? AND tenant_id = ? LIMIT 1',
        [req.params.id, tenantId]
      );
      if (!existingRows || existingRows.length === 0) {
        return res.status(404).json({ error: 'Plantilla no encontrada.' });
      }
      const existing = existingRows[0];
      const documentType = existing.document_type;
      const paperWidth = ALLOWED_PAPER_WIDTHS.includes(req.body?.paper_width) ? req.body.paper_width : existing.paper_width;
      if (paperWidth === 'A4' && documentType !== 'factura_comercial') {
        return res.status(400).json({ error: 'El formato A4 solo aplica para Factura comercial.' });
      }

      const numberingMode = ALLOWED_NUMBERING_MODES.includes(req.body?.numbering_mode) ? req.body.numbering_mode : existing.numbering_mode;
      const timezone = req.body?.timezone ? validateTimezone(req.body.timezone) : existing.timezone;
      const name = req.body?.name ? stripUnsafeText(req.body.name, 120) : existing.name;
      const branchId = req.body?.branch_id !== undefined ? (req.body.branch_id ? String(req.body.branch_id).trim() : null) : existing.branch_id;
      const sanitizedConfig = sanitizeTemplateConfig(req.body?.config_json || existing.config_json, documentType);
      const publishNow = Boolean(req.body?.publish);
      const nextVersion = Number(existing.version || 1) + 1;
      const actorId = req.auth?.userId || req.user?.id || null;

      const [updatedRows] = await pool.query(
        `UPDATE print_templates SET
           name = ?,
           branch_id = ?,
           paper_width = ?,
           numbering_mode = ?,
           timezone = ?,
           status = ?,
           version = ?,
           config_json = ?,
           published_config_json = COALESCE(?, published_config_json),
           published_version = COALESCE(?, published_version),
           updated_by_user_id = ?,
           updated_at = NOW()
         WHERE id = ? AND tenant_id = ?
         RETURNING *`,
        [
          name,
          branchId,
          paperWidth,
          numberingMode,
          timezone,
          publishNow ? 'published' : existing.status,
          nextVersion,
          JSON.stringify(sanitizedConfig),
          publishNow ? JSON.stringify(sanitizedConfig) : null,
          publishNow ? nextVersion : null,
          actorId ? String(actorId) : null,
          req.params.id,
          tenantId,
        ]
      );

      res.json({ template: updatedRows?.[0] || existing });
    } catch (err) {
      res.status(500).json({ error: 'Error actualizando plantilla: ' + err.message });
    }
  });

  // POST /api/print-templates/:id/set-default
  router.post('/print-templates/:id/set-default', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(403).json({ error: 'Contexto de empresa requerido' });
      if (!canManageTemplates(req)) {
        return res.status(403).json({ error: 'No tienes permiso para configurar la plantilla predeterminada.' });
      }

      const [rows] = await pool.query(
        'SELECT * FROM print_templates WHERE id = ? AND tenant_id = ? LIMIT 1',
        [req.params.id, tenantId]
      );
      if (!rows || rows.length === 0) return res.status(404).json({ error: 'Plantilla no encontrada.' });
      const tpl = rows[0];

      if (tpl.document_type === 'ticket_turno' || tpl.document_type === 'ticket_venta') {
        await pool.query(
          `UPDATE print_templates SET is_default = FALSE
           WHERE tenant_id = ? AND document_type IN ('ticket_turno', 'ticket_venta') AND (branch_id IS NOT DISTINCT FROM ?)`,
          [tenantId, tpl.branch_id]
        );
      } else {
        await pool.query(
          `UPDATE print_templates SET is_default = FALSE
           WHERE tenant_id = ? AND document_type = ? AND (branch_id IS NOT DISTINCT FROM ?)`,
          [tenantId, tpl.document_type, tpl.branch_id]
        );
      }

      const [updated] = await pool.query(
        `UPDATE print_templates
         SET is_default = TRUE,
             status = 'published',
             published_config_json = COALESCE(published_config_json, config_json),
             published_version = COALESCE(published_version, version),
             updated_at = NOW()
         WHERE id = ? AND tenant_id = ?
         RETURNING *`,
        [req.params.id, tenantId]
      );

      res.json({ template: updated?.[0] || tpl });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/print-templates/restore-default
  router.post('/print-templates/restore-default', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(403).json({ error: 'Contexto de empresa requerido' });
      if (!canManageTemplates(req)) {
        return res.status(403).json({ error: 'No tienes permiso para restaurar plantillas.' });
      }

      const documentType = String(req.body?.document_type || 'ticket_turno');
      const def = DEFAULT_TEMPLATES[documentType];
      if (!def) return res.status(400).json({ error: 'Tipo de documento inválido.' });

      const branchId = req.body?.branch_id ? String(req.body.branch_id).trim() : null;
      await pool.query(
        `UPDATE print_templates SET is_default = FALSE
         WHERE tenant_id = ? AND document_type = ? AND (branch_id IS NOT DISTINCT FROM ?)`,
        [tenantId, documentType, branchId]
      );

      const id = crypto.randomUUID();
      const [inserted] = await pool.query(
        `INSERT INTO print_templates (
           id, tenant_id, branch_id, document_type, name, paper_width, numbering_mode, timezone,
           status, is_default, version, config_json, published_config_json, published_version,
           updated_by_user_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'published', TRUE, 1, ?, ?, 1, ?, NOW(), NOW())
         RETURNING *`,
        [
          id,
          tenantId,
          branchId,
          documentType,
          def.name,
          def.paper_width,
          def.numbering_mode,
          def.timezone,
          JSON.stringify(def.config_json),
          JSON.stringify(def.config_json),
          req.auth?.userId ? String(req.auth.userId) : null,
        ]
      );

      res.json({ template: inserted?.[0] || { id, ...def } });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/turn-tickets (Emit Car Wash turn ticket WITHOUT creating sale/invoice)
  router.post('/turn-tickets', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(403).json({ error: 'Contexto de empresa requerido' });
      if (!canOperateTurnTickets(req)) {
        return res.status(403).json({ error: 'No tienes permiso para emitir tickets de turno.' });
      }

      const branchId = req.body?.branch_id || req.user?.branch_id || 'default';
      if (!checkBranchAccess(req, branchId)) {
        return res.status(403).json({ error: 'No tienes acceso a esta sucursal.' });
      }

      const idempotencyKey = req.headers['idempotency-key'] || req.body?.idempotency_key || null;
      const result = await issueTurnTicket(pool, {
        tenantId,
        branchId,
        serviceName: req.body?.service_name || null,
        observations: req.body?.observations || null,
        customerLabel: req.body?.customer_label || null,
        idempotencyKey,
        actorUserId: req.auth?.userId || req.user?.id || null,
      });

      res.status(result.idempotentReplay ? 200 : 201).json(result);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message || 'Error emitiendo turno.' });
    }
  });

  // GET /api/turn-tickets (List recent turn tickets for reprinting)
  router.get('/turn-tickets', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(403).json({ error: 'Contexto de empresa requerido' });
      if (!canOperateTurnTickets(req)) {
        return res.status(403).json({ error: 'No tienes permiso para consultar tickets de turno.' });
      }

      const branchId = req.query.branch_id ? String(req.query.branch_id) : null;
      if (branchId && !checkBranchAccess(req, branchId)) {
        return res.status(403).json({ error: 'No tienes acceso a esta sucursal.' });
      }

      let sql = 'SELECT * FROM turn_tickets WHERE tenant_id = ?';
      const params = [tenantId];
      if (branchId) {
        sql += ' AND branch_id = ?';
        params.push(branchId);
      }
      sql += ' ORDER BY issued_at DESC LIMIT 50';

      const [rows] = await pool.query(sql, params);
      res.json({ tickets: rows || [] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/turn-tickets/:id (Reprint preserving original number & frozen template snapshot)
  router.get('/turn-tickets/:id', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(403).json({ error: 'Contexto de empresa requerido' });
      if (!canOperateTurnTickets(req)) {
        return res.status(403).json({ error: 'No tienes permiso para reimprimir tickets de turno.' });
      }

      const [rows] = await pool.query(
        'SELECT * FROM turn_tickets WHERE id = ? AND tenant_id = ? LIMIT 1',
        [req.params.id, tenantId]
      );
      if (!rows || rows.length === 0) return res.status(404).json({ error: 'Turno no encontrado.' });
      if (!checkBranchAccess(req, rows[0].branch_id)) {
        return res.status(403).json({ error: 'No tienes acceso a la sucursal de este turno.' });
      }

      res.json({ ticket: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createPrintTemplatesRouter };
