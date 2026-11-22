const express = require('express');
const { SaasPlanRepository } = require('../repositories/saas_plan.repository');
const { TenantSubscriptionRepository } = require('../repositories/tenant_subscription.repository');
const { EntitlementsRepository } = require('../repositories/entitlements.repository');
const { SubscriptionAuditRepository } = require('../repositories/subscription_audit.repository');
const { EntitlementsService } = require('../services/entitlements.service');
const { TenantBrandingRepository } = require('../repositories/tenant_branding.repository');
const { TenantBrandingService } = require('../services/tenant_branding.service');
const { DataRetentionService } = require('../services/data_retention.service');
const { permissionMapGrants } = require('../domain/rbac_catalog');
const { getPrivateStorageAdapter } = require('../services/private_storage_adapter');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createTenantRouter(pool, options = {}) {
  const router = express.Router();

  const entitlementsService = options.entitlementsService || new EntitlementsService({
    saasPlanRepo: new SaasPlanRepository(pool),
    subscriptionRepo: new TenantSubscriptionRepository(pool),
    entitlementsRepo: new EntitlementsRepository(pool),
    auditRepo: new SubscriptionAuditRepository(pool)
  });

  const tenantBrandingService = options.tenantBrandingService || new TenantBrandingService({
    repository: options.brandingRepository || new TenantBrandingRepository(pool)
  });

  // Autorización canónica para personalización y perfil de empresa (Owner, Admin o permiso explícito settings.manage)
  const canManageTenantCustomization = (req) => {
    const role = String(req.auth?.role || req.user?.role || '').toLowerCase();
    if (['propietario', 'owner', 'admin', 'administrador'].includes(role)) {
      return true;
    }
    const perms = req.auth?.permissions || req.user?.permissions;
    return permissionMapGrants(perms, 'settings.manage') || permissionMapGrants(perms, 'branding.manage');
  };

  // Helper: Obtener el tenant_id verificado por el middleware de autenticación
  const resolveTenantId = async (req) => {
    const verifiedTenantId = req.tenantId || req.auth?.tenantId;
    if (!verifiedTenantId) return null;

    if (pool) {
      const [rows] = await pool.query("SELECT id FROM tenants WHERE id = ? LIMIT 1", [verifiedTenantId]);
      if (rows && rows.length > 0) return rows[0].id;
    } else {
      return verifiedTenantId;
    }
    return null;
  };

  // GET /api/tenant/branding - Consulta canónica de branding de la empresa autenticado
  router.get('/branding', async (req, res) => {
    try {
      const tenantId = req.tenantId || req.auth?.tenantId || (await resolveTenantId(req));
      if (!tenantId) {
        return res.status(403).json({
          error: 'Contexto de empresa requerido para consultar branding.',
          code: 'TENANT_REQUIRED'
        });
      }

      const branding = await tenantBrandingService.getBranding(tenantId);
      if (pool && pool.isPostgres) {
        const [tRows] = await pool.query(
          'SELECT business_name, legal_name, rnc, email, owner_email, phone, owner_phone, address, website, currency, logo_url FROM tenants WHERE id = ? LIMIT 1',
          [tenantId]
        ).catch(() => [[]]);
        const tenantRow = tRows?.[0];
        if (tenantRow) {
          if (
            tenantRow.business_name &&
            tenantRow.business_name !== 'Salón de Prueba' &&
            (branding.is_default || !branding.business_name || branding.business_name === 'SalonPro')
          ) {
            branding.business_name = tenantRow.business_name;
          }
          if (!branding.logo_url && tenantRow.logo_url) branding.logo_url = tenantRow.logo_url;
          if (!branding.rnc && tenantRow.rnc) branding.rnc = tenantRow.rnc;
          if (!branding.address && tenantRow.address) branding.address = tenantRow.address;
          if (!branding.phone && (tenantRow.phone || tenantRow.owner_phone)) {
            branding.phone = tenantRow.phone || tenantRow.owner_phone;
          }
          if (!branding.email && (tenantRow.email || tenantRow.owner_email)) {
            branding.email = tenantRow.email || tenantRow.owner_email;
          }
          if (!branding.legal_name && tenantRow.legal_name) branding.legal_name = tenantRow.legal_name;
          if (!branding.website && tenantRow.website) branding.website = tenantRow.website;
          if (!branding.currency && tenantRow.currency) branding.currency = tenantRow.currency;
        }
      }
      res.json(branding);
    } catch (err) {
      console.error('Error fetching tenant branding:', err);
      res.status(500).json({ error: 'Error obteniendo branding de la empresa' });
    }
  });

  // PUT /api/tenant/branding - Actualización de branding (propietario, admin o permiso delegado settings.manage)
  router.put('/branding', async (req, res) => {
    try {
      const tenantId = req.tenantId || req.auth?.tenantId || (await resolveTenantId(req));
      if (!tenantId) {
        return res.status(403).json({
          error: 'Contexto de empresa requerido para actualizar branding.',
          code: 'TENANT_REQUIRED'
        });
      }

      if (!canManageTenantCustomization(req)) {
        return res.status(403).json({
          error: 'Se requiere rol de propietario, administrador o permiso delegado para modificar el branding de la empresa.',
          code: 'FORBIDDEN_ROLE'
        });
      }

      // Estricto Anti-Spoofing: Ignorar cualquier tenant_id enviado en body o query
      const { tenant_id: _ignoredTenantId, ...brandingPayload } = req.body || {};

      const updated = await tenantBrandingService.updateBranding(
        tenantId,
        brandingPayload,
        req.auth?.id || req.user?.id || req.auth?.userId
      );

      // Sincronizar campos compartidos con la tabla autoritativa tenants
      if (pool && (updated?.business_name || brandingPayload.logo_url !== undefined || brandingPayload.primary_color || brandingPayload.secondary_color || brandingPayload.receipt_footer !== undefined)) {
        await pool.query(
          `UPDATE tenants
           SET business_name = COALESCE(?, business_name),
               logo_url = CASE WHEN ? THEN ? ELSE logo_url END,
               primary_color = COALESCE(?, primary_color),
               secondary_color = COALESCE(?, secondary_color),
               receipt_footer = COALESCE(?, receipt_footer),
               updated_at = NOW()
           WHERE id = ?`,
          [
            brandingPayload.business_name !== undefined ? updated.business_name : null,
            brandingPayload.logo_url !== undefined,
            updated.logo_url || null,
            updated.primary_color || null,
            updated.secondary_color || null,
            updated.receipt_footer || null,
            tenantId
          ]
        ).catch(() => {});
      }

      if (pool) {
        const actorName = req.auth?.name || req.user?.name || req.auth?.email || 'Administrador';
        await pool.query(
          `INSERT INTO audit_logs (tenant_id, entity_type, entity_id, action, reason, user_name, details, created_at)
           VALUES (?, 'tenant_branding', ?, 'UPDATE_TENANT_BRANDING', ?, ?, ?, NOW())`,
          [
            tenantId,
            String(tenantId),
            'Actualización de identidad visual y personalización de empresa',
            actorName,
            `Branding actualizado: business_name=${updated?.business_name || ''}, primary=${updated?.primary_color || ''}, logo=${updated?.logo_url ? 'set' : 'none'}`
          ]
        ).catch(() => {});
      }

      res.json({
        success: true,
        message: 'Branding de la empresa actualizado correctamente',
        branding: updated
      });
    } catch (err) {
      console.error('Error updating tenant branding:', err);
      res.status(400).json({
        error: err.message || 'Error actualizando branding de la empresa',
        code: 'INVALID_BRANDING_PAYLOAD'
      });
    }
  });

  // POST /api/tenant/branding/reset - Restaurar a valores predeterminados SalonPro
  router.post('/branding/reset', async (req, res) => {
    try {
      const tenantId = req.tenantId || req.auth?.tenantId || (await resolveTenantId(req));
      if (!tenantId) {
        return res.status(403).json({
          error: 'Contexto de empresa requerido para reiniciar branding.',
          code: 'TENANT_REQUIRED'
        });
      }

      if (!canManageTenantCustomization(req)) {
        return res.status(403).json({
          error: 'Se requiere rol de propietario, administrador o permiso delegado para reiniciar el branding.',
          code: 'FORBIDDEN_ROLE'
        });
      }

      const reset = await tenantBrandingService.resetToDefaults(
        tenantId,
        req.auth?.id || req.user?.id || req.auth?.userId
      );

      if (pool) {
        await pool.query(
          `UPDATE tenants
           SET logo_url = NULL,
               primary_color = '#0f172a',
               secondary_color = '#d4af37',
               receipt_footer = '¡Gracias por preferirnos! ♡',
               updated_at = NOW()
           WHERE id = ?`,
          [tenantId]
        ).catch(() => {});

        const actorName = req.auth?.name || req.user?.name || req.auth?.email || 'Administrador';
        await pool.query(
          `INSERT INTO audit_logs (tenant_id, entity_type, entity_id, action, reason, user_name, details, created_at)
           VALUES (?, 'tenant_branding', ?, 'RESET_TENANT_BRANDING', ?, ?, ?, NOW())`,
          [
            tenantId,
            String(tenantId),
            'Restablecimiento de identidad visual a valores predeterminados',
            actorName,
            'Branding y logotipo de empresa restablecidos a valores neutrales'
          ]
        ).catch(() => {});
      }

      res.json({
        success: true,
        message: 'Branding restaurado a los valores predeterminados de SalonPro',
        branding: reset
      });
    } catch (err) {
      console.error('Error resetting tenant branding:', err);
      res.status(500).json({ error: 'Error reiniciando branding de la empresa' });
    }
  });

  // GET /api/tenant/entitlements - Consulta canónica de funcionalidades, límites y plan vigente
  router.get('/entitlements', async (req, res) => {
    try {
      const tenantId = req.tenantId || (await resolveTenantId(req));
      if (!tenantId) {
        return res.status(403).json({
          error: 'Contexto de empresa requerido para consultar permisos de plan.',
          code: 'TENANT_REQUIRED'
        });
      }

      const entitlements = await entitlementsService.getTenantEntitlements(tenantId);
      res.json(entitlements);
    } catch (err) {
      console.error('Error fetching tenant entitlements:', err);
      res.status(500).json({ error: 'Error obteniendo permisos de plan de la empresa' });
    }
  });

  // GET /api/tenant/settings - Obtener configuración y branding de la empresa activo
  router.get('/settings', async (req, res) => {
    try {
      const tenantId = await resolveTenantId(req);
      if (!tenantId) {
        return res.status(404).json({ error: 'Empresa no encontrado o no autorizado' });
      }

      const [rows] = await pool.query(`
        SELECT 
          t.*,
          sp.name as plan_name,
          sp.slug as plan_slug,
          sp.price_monthly as plan_price,
          (SELECT COUNT(*) FROM branches b WHERE b.tenant_id = t.id) as current_branches,
          (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id AND LOWER(COALESCE(u.role, '')) NOT IN ('superadmin', 'cliente_b2c', 'kiosco_asistencia') AND (u.is_active = TRUE OR u.estado = 'Activo')) as current_users
        FROM tenants t
        LEFT JOIN saas_plans sp ON t.plan_id = sp.id
        WHERE t.id = ?
      `, [tenantId]);

      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'Empresa no encontrado' });
      }

      res.json(rows[0]);
    } catch (error) {
      console.error('Error fetching tenant settings:', error);
      res.status(500).json({ error: 'Error obteniendo configuración de la empresa' });
    }
  });

  // GET /api/tenant/profile - Perfil autoritativo de empresa (tenants) + tokens visuales (tenant_branding)
  router.get('/profile', async (req, res) => {
    try {
      const tenantId = await resolveTenantId(req);
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de empresa requerido o no autorizado' });
      }

      const [rows] = await pool.query(`
        SELECT 
          t.*,
          sp.name as plan_name,
          sp.slug as plan_slug,
          sp.price_monthly as plan_price,
          (SELECT COUNT(*) FROM branches b WHERE b.tenant_id = t.id) as current_branches,
          (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id AND LOWER(COALESCE(u.role, '')) NOT IN ('superadmin', 'cliente_b2c', 'kiosco_asistencia') AND (u.is_active = TRUE OR u.estado = 'Activo')) as current_users
        FROM tenants t
        LEFT JOIN saas_plans sp ON t.plan_id = sp.id
        WHERE t.id = ?
      `, [tenantId]);

      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'Empresa no encontrado' });
      }

      const row = rows[0];
      const branding = await tenantBrandingService.getBranding(tenantId).catch(() => null);
      const hasCustomBranding = branding && !branding.is_default;

      return res.json({
        ...row,
        business_name: row.business_name || (hasCustomBranding ? branding.business_name : '') || 'SalonPro',
        email: row.email || row.owner_email || '',
        phone: row.phone || row.owner_phone || '',
        logo_url: (hasCustomBranding && branding.logo_url) ? branding.logo_url : (row.logo_url || ''),
        logo_dark_url: (hasCustomBranding && branding.logo_dark_url) ? branding.logo_dark_url : '',
        favicon_url: (hasCustomBranding && branding.favicon_url) ? branding.favicon_url : '',
        primary_color: (hasCustomBranding && branding.primary_color) ? branding.primary_color : (row.primary_color || row.brand_color || '#0f172a'),
        secondary_color: (hasCustomBranding && branding.secondary_color) ? branding.secondary_color : (row.secondary_color || '#d4af37'),
        accent_color: (hasCustomBranding && branding.accent_color) ? branding.accent_color : '#3b82f6',
        background_color: (hasCustomBranding && branding.background_color) ? branding.background_color : '#f8fafc',
        surface_color: (hasCustomBranding && branding.surface_color) ? branding.surface_color : '#ffffff',
        text_color: (hasCustomBranding && branding.text_color) ? branding.text_color : '#0f172a',
        receipt_header: (hasCustomBranding && branding.receipt_header) ? branding.receipt_header : (row.business_name || 'SalonPro - Sistema de Gestión'),
        receipt_footer: (hasCustomBranding && branding.receipt_footer) ? branding.receipt_footer : (row.receipt_footer || '¡Gracias por preferirnos! ♡')
      });
    } catch (error) {
      console.error('Error fetching tenant profile:', error);
      return res.status(500).json({ error: 'Error obteniendo perfil de la empresa' });
    }
  });

  // PUT /api/tenant/profile - Actualización unificada del perfil de empresa y sincronización con branding
  router.put('/profile', async (req, res) => {
    try {
      if (!canManageTenantCustomization(req)) {
        return res.status(403).json({
          error: 'Solo propietarios, administradores o personal delegado pueden modificar el perfil de la empresa',
          code: 'FORBIDDEN_ROLE'
        });
      }

      const tenantId = await resolveTenantId(req);
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de empresa requerido o no autorizado', code: 'TENANT_REQUIRED' });
      }

      const {
        business_name,
        legal_name,
        rnc,
        email,
        phone,
        address,
        website,
        logo_url,
        logo_dark_url,
        favicon_url,
        primary_color,
        secondary_color,
        accent_color,
        background_color,
        surface_color,
        text_color,
        receipt_header,
        receipt_footer,
        currency
      } = req.body || {};

      if (business_name !== undefined && !String(business_name).trim()) {
        return res.status(400).json({
          error: 'El nombre comercial de la empresa no puede estar vacío.',
          code: 'INVALID_BUSINESS_NAME'
        });
      }

      // 1. Si se enviaron tokens visuales o nombre comercial, validar y persistir primero en tenant_branding
      const hasBrandingFields = [
        business_name, logo_url, logo_dark_url, favicon_url,
        primary_color, secondary_color, accent_color,
        background_color, surface_color, text_color,
        receipt_header, receipt_footer
      ].some((v) => v !== undefined);

      let updatedBranding = null;
      if (hasBrandingFields) {
        const brandingPatch = {};
        if (business_name !== undefined) brandingPatch.business_name = business_name;
        if (logo_url !== undefined) brandingPatch.logo_url = logo_url || null;
        if (logo_dark_url !== undefined) brandingPatch.logo_dark_url = logo_dark_url || null;
        if (favicon_url !== undefined) brandingPatch.favicon_url = favicon_url || null;
        if (primary_color !== undefined) brandingPatch.primary_color = primary_color;
        if (secondary_color !== undefined) brandingPatch.secondary_color = secondary_color;
        if (accent_color !== undefined) brandingPatch.accent_color = accent_color;
        if (background_color !== undefined) brandingPatch.background_color = background_color;
        if (surface_color !== undefined) brandingPatch.surface_color = surface_color;
        if (text_color !== undefined) brandingPatch.text_color = text_color;
        if (receipt_header !== undefined) brandingPatch.receipt_header = receipt_header;
        if (receipt_footer !== undefined) brandingPatch.receipt_footer = receipt_footer;

        updatedBranding = await tenantBrandingService.updateBranding(
          tenantId,
          brandingPatch,
          req.auth?.id || req.user?.id || req.auth?.userId
        );
      }

      // 2. Actualizar tabla autoritativa tenants
      await pool.query(`
        UPDATE tenants
        SET
          business_name = COALESCE(?, business_name),
          legal_name = COALESCE(?, legal_name),
          rnc = COALESCE(?, rnc),
          email = COALESCE(?, email),
          owner_email = COALESCE(?, owner_email),
          phone = COALESCE(?, phone),
          owner_phone = COALESCE(?, owner_phone),
          address = COALESCE(?, address),
          website = COALESCE(?, website),
          logo_url = CASE WHEN ? THEN ? ELSE logo_url END,
          primary_color = COALESCE(?, primary_color),
          secondary_color = COALESCE(?, secondary_color),
          receipt_footer = COALESCE(?, receipt_footer),
          currency = COALESCE(?, currency),
          updated_at = NOW()
        WHERE id = ?
      `, [
        updatedBranding?.business_name ?? (business_name !== undefined ? String(business_name).trim() : null),
        legal_name ?? null,
        rnc ?? null,
        email ?? null,
        email ?? null,
        phone ?? null,
        phone ?? null,
        address ?? null,
        website ?? null,
        logo_url !== undefined,
        logo_url || null,
        updatedBranding?.primary_color ?? primary_color ?? null,
        updatedBranding?.secondary_color ?? secondary_color ?? null,
        updatedBranding?.receipt_footer ?? receipt_footer ?? null,
        currency ?? null,
        tenantId
      ]);

      if (business_name || address || phone) {
        await pool.query(`
          UPDATE branches
          SET
            name = COALESCE(?, name),
            address = COALESCE(?, address),
            phone = COALESCE(?, phone)
          WHERE tenant_id = ? AND is_main = true
        `, [business_name ? `${String(business_name).trim()} - Principal` : null, address ?? null, phone ?? null, tenantId]);
      }

      const [updatedRows] = await pool.query('SELECT * FROM tenants WHERE id = ? LIMIT 1', [tenantId]);
      const finalBranding = updatedBranding || await tenantBrandingService.getBranding(tenantId).catch(() => null);
      return res.json({
        success: true,
        tenant: {
          ...(updatedRows[0] || {}),
          ...(finalBranding ? {
            logo_url: finalBranding.logo_url ?? updatedRows[0]?.logo_url ?? '',
            primary_color: finalBranding.primary_color,
            secondary_color: finalBranding.secondary_color,
            accent_color: finalBranding.accent_color,
            background_color: finalBranding.background_color,
            surface_color: finalBranding.surface_color,
            text_color: finalBranding.text_color,
            receipt_header: finalBranding.receipt_header,
            receipt_footer: finalBranding.receipt_footer
          } : {})
        },
        branding: finalBranding
      });
    } catch (error) {
      console.error('Error updating tenant profile:', error);
      const status = error.message && (error.message.includes('Color inválido') || error.message.includes('Contraste insuficiente') || error.message.includes('URL de logo') || error.message.includes('nombre comercial'))
        ? 400
        : 500;
      return res.status(status).json({
        error: error.message || 'Error actualizando perfil de la empresa',
        code: status === 400 ? 'INVALID_PROFILE_PAYLOAD' : 'PROFILE_UPDATE_FAILED'
      });
    }
  });

  // POST /api/tenant/upload-logo - Subida canónica de logo a almacenamiento privado cifrado (private_files)
  router.post('/upload-logo', async (req, res) => {
    try {
      if (!canManageTenantCustomization(req)) {
        return res.status(403).json({
          error: 'Solo propietarios, administradores o personal delegado pueden subir el logotipo de la empresa.',
          code: 'FORBIDDEN_ROLE'
        });
      }

      const tenantId = req.tenantId || req.auth?.tenantId || (await resolveTenantId(req));
      if (!tenantId) {
        return res.status(403).json({
          error: 'Contexto de empresa requerido para subir logotipo.',
          code: 'TENANT_REQUIRED'
        });
      }

      const rawImage = req.body?.image || req.body?.base64 || req.body?.logo;
      if (!rawImage || typeof rawImage !== 'string') {
        return res.status(400).json({
          error: 'Se requiere una imagen codificada en Base64 (PNG, JPEG o WebP).',
          code: 'MISSING_LOGO_IMAGE'
        });
      }

      if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(rawImage.trim())) {
        return res.status(400).json({
          error: 'Formato de logotipo no soportado. Solo se permiten imágenes PNG, JPEG o WebP.',
          code: 'UNSUPPORTED_LOGO_FORMAT'
        });
      }

      const normalizedDataUri = rawImage.trim().replace(/^data:image\/jpg;base64,/i, 'data:image/jpeg;base64,');
      const storage = getPrivateStorageAdapter({ pool, maxSizeBytes: 5 * 1024 * 1024 });
      const saved = await storage.saveBase64({
        tenantId,
        category: 'tenant_logo',
        base64Data: normalizedDataUri
      });

      const canonicalLogoUrl = `/api/public/branding/${tenantId}/logo/${saved.id}`;
      return res.status(200).json({
        success: true,
        file_id: saved.id,
        logo_url: canonicalLogoUrl,
        mime_type: saved.mime_type,
        byte_size: saved.byte_size,
        sha256_hash: saved.sha256_hash
      });
    } catch (err) {
      console.error('[TENANT LOGO UPLOAD ERROR]:', err);
      const isClientErr = ['EMPTY_FILE', 'FILE_TOO_LARGE', 'MALICIOUS_PAYLOAD_DETECTED', 'INVALID_MIME_MAGIC_BYTES', 'UNSUPPORTED_MEDIA_TYPE', 'INVALID_BASE64_DATA'].includes(err.code);
      return res.status(isClientErr ? 400 : 500).json({
        error: err.message || 'Error al almacenar el logotipo de la empresa.',
        code: err.code || 'LOGO_UPLOAD_FAILED'
      });
    }
  });

  // GET /api/tenant/logo/:fileId - Descarga autenticada del logotipo de la empresa
  router.get('/logo/:fileId', async (req, res) => {
    try {
      const tenantId = req.tenantId || req.auth?.tenantId || (await resolveTenantId(req));
      const { fileId } = req.params;
      if (!tenantId || !UUID_REGEX.test(String(fileId || ''))) {
        return res.status(404).json({ error: 'Logotipo no encontrado' });
      }
      const [metaRows] = await pool.query(
        `SELECT id FROM private_files WHERE id = ? AND tenant_id = ? AND category = 'tenant_logo' AND deleted_at IS NULL LIMIT 1`,
        [fileId, tenantId]
      );
      if (!metaRows || metaRows.length === 0) {
        return res.status(404).json({ error: 'Logotipo no encontrado' });
      }
      const storage = getPrivateStorageAdapter({ pool });
      const fileData = await storage.readFile({ tenantId, fileId });
      res.setHeader('Content-Type', fileData.mimeType || 'image/png');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.send(fileData.buffer);
    } catch (err) {
      return res.status(err.statusCode || 404).json({ error: 'Logotipo no disponible' });
    }
  });

  // PUT /api/tenant/settings - Actualizar nombre, logo, colores, contacto y RNC de la empresa
  router.put('/settings', async (req, res) => {
    try {
      if (!canManageTenantCustomization(req)) {
        return res.status(403).json({
          error: 'Solo propietarios, administradores o personal delegado pueden modificar la configuración de la empresa',
          code: 'FORBIDDEN_ROLE'
        });
      }
      const tenantId = await resolveTenantId(req);
      if (!tenantId) {
        return res.status(404).json({ error: 'Empresa no encontrado o no autorizado' });
      }

      const {
        business_name,
        owner_name,
        owner_email,
        owner_phone,
        rnc,
        address,
        logo_url,
        brand_color,
        secondary_color,
        tagline,
        instagram_url,
        whatsapp_number,
        receipt_footer
      } = req.body;

      await pool.query(`
        UPDATE tenants
        SET 
          business_name = COALESCE(?, business_name),
          owner_name = COALESCE(?, owner_name),
          owner_email = COALESCE(?, owner_email),
          owner_phone = COALESCE(?, owner_phone),
          rnc = COALESCE(?, rnc),
          address = COALESCE(?, address),
          logo_url = COALESCE(?, logo_url),
          brand_color = COALESCE(?, brand_color),
          secondary_color = COALESCE(?, secondary_color),
          tagline = COALESCE(?, tagline),
          instagram_url = COALESCE(?, instagram_url),
          whatsapp_number = COALESCE(?, whatsapp_number),
          receipt_footer = COALESCE(?, receipt_footer),
          updated_at = NOW()
        WHERE id = ?
      `, [
        business_name ?? null,
        owner_name ?? null,
        owner_email ?? null,
        owner_phone ?? null,
        rnc ?? null,
        address ?? null,
        logo_url ?? null,
        brand_color ?? null,
        secondary_color ?? null,
        tagline ?? null,
        instagram_url ?? null,
        whatsapp_number ?? null,
        receipt_footer ?? null,
        tenantId
      ]);

      // Sincronizar también con la sucursal principal y salons de ESTE tenant únicamente
      if (business_name || address || owner_phone) {
        await pool.query(`
          UPDATE branches
          SET 
            name = COALESCE(?, name),
            address = COALESCE(?, address),
            phone = COALESCE(?, phone)
          WHERE tenant_id = ? AND is_main = true
        `, [business_name ? `${business_name} - Principal` : null, address ?? null, owner_phone ?? null, tenantId]);

        await pool.query(`
          UPDATE salons
          SET 
            name = COALESCE(?, name),
            address = COALESCE(?, address),
            phone = COALESCE(?, phone)
          WHERE tenant_id = ?
        `, [business_name ?? null, address ?? null, owner_phone ?? null, tenantId]);
      }

      const [updated] = await pool.query(`
        SELECT 
          t.*,
          sp.name as plan_name,
          sp.slug as plan_slug,
          sp.price_monthly as plan_price,
          (SELECT COUNT(*) FROM branches b WHERE b.tenant_id = t.id) as current_branches,
          (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id AND LOWER(COALESCE(u.role, '')) NOT IN ('superadmin', 'cliente_b2c', 'kiosco_asistencia') AND (u.is_active = TRUE OR u.estado = 'Activo')) as current_users
        FROM tenants t
        LEFT JOIN saas_plans sp ON t.plan_id = sp.id
        WHERE t.id = ?
      `, [tenantId]);

      res.json({
        success: true,
        message: 'Personalización de la empresa guardada correctamente',
        tenant: updated[0]
      });
    } catch (error) {
      console.error('Error updating tenant settings:', error);
      res.status(500).json({ error: 'Error guardando personalización: ' + error.message });
    }
  });

  // ==============================================================
  // MOTOR DE RETENCIÓN Y PURGA DRY-RUN (REM-P2-09 & Addendum 1)
  // ==============================================================

  const retentionService = new DataRetentionService(pool);

  // GET /api/tenant/retention/policies - Listar políticas de retención
  router.get('/retention/policies', async (req, res) => {
    try {
      const policies = await retentionService.listPolicies();
      res.json(policies);
    } catch (err) {
      res.status(500).json({ error: err.message, code: 'RETENTION_ERROR' });
    }
  });

  // POST /api/tenant/retention/dry-run - Evaluación sin impacto físico
  router.post('/retention/dry-run', async (req, res) => {
    try {
      const tenantId = req.tenantId || req.auth?.tenantId || (await resolveTenantId(req));
      const { category } = req.body || {};
      const result = await retentionService.runRetention({
        tenantId,
        category,
        isDryRun: true,
        executedBy: req.auth?.userId || req.auth?.id
      });
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message, code: err.code || 'RETENTION_ERROR' });
    }
  });

  // POST /api/tenant/retention/execute - Ejecución física (Fail-closed si no está habilitada)
  router.post('/retention/execute', async (req, res) => {
    try {
      const tenantId = req.tenantId || req.auth?.tenantId || (await resolveTenantId(req));
      const { category } = req.body || {};
      const result = await retentionService.runRetention({
        tenantId,
        category,
        isDryRun: false,
        executedBy: req.auth?.userId || req.auth?.id
      });
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message, code: err.code || 'RETENTION_ERROR' });
    }
  });

  return router;
}

module.exports = { createTenantRouter };
