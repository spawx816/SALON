const express = require('express');
const { SaasPlanRepository } = require('../repositories/saas_plan.repository');
const { TenantSubscriptionRepository } = require('../repositories/tenant_subscription.repository');
const { EntitlementsRepository } = require('../repositories/entitlements.repository');
const { SubscriptionAuditRepository } = require('../repositories/subscription_audit.repository');
const { EntitlementsService } = require('../services/entitlements.service');
const { TenantBrandingRepository } = require('../repositories/tenant_branding.repository');
const { TenantBrandingService } = require('../services/tenant_branding.service');

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

  // GET /api/tenant/branding - Consulta canónica de branding del salón autenticado
  router.get('/branding', async (req, res) => {
    try {
      const tenantId = req.tenantId || req.auth?.tenantId || (await resolveTenantId(req));
      if (!tenantId) {
        return res.status(403).json({
          error: 'Contexto de salón requerido para consultar branding.',
          code: 'TENANT_REQUIRED'
        });
      }

      const branding = await tenantBrandingService.getBranding(tenantId);
      res.json(branding);
    } catch (err) {
      console.error('Error fetching tenant branding:', err);
      res.status(500).json({ error: 'Error obteniendo branding del salón' });
    }
  });

  // PUT /api/tenant/branding - Actualización de branding (solo propietario o admin)
  router.put('/branding', async (req, res) => {
    try {
      const tenantId = req.tenantId || req.auth?.tenantId || (await resolveTenantId(req));
      if (!tenantId) {
        return res.status(403).json({
          error: 'Contexto de salón requerido para actualizar branding.',
          code: 'TENANT_REQUIRED'
        });
      }

      // Validación de rol: Solo propietario o admin
      const role = (req.auth?.role || req.user?.role || '').toLowerCase();
      const isOwnerOrAdmin = role === 'propietario' || role === 'owner' || role === 'admin' || role === 'administrador';
      if (!isOwnerOrAdmin) {
        return res.status(403).json({
          error: 'Se requiere rol de propietario o administrador para modificar el branding del salón.',
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

      res.json({
        success: true,
        message: 'Branding del salón actualizado correctamente',
        branding: updated
      });
    } catch (err) {
      console.error('Error updating tenant branding:', err);
      res.status(400).json({
        error: err.message || 'Error actualizando branding del salón',
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
          error: 'Contexto de salón requerido para reiniciar branding.',
          code: 'TENANT_REQUIRED'
        });
      }

      const role = (req.auth?.role || req.user?.role || '').toLowerCase();
      const isOwnerOrAdmin = role === 'propietario' || role === 'owner' || role === 'admin' || role === 'administrador';
      if (!isOwnerOrAdmin) {
        return res.status(403).json({
          error: 'Se requiere rol de propietario o administrador para reiniciar el branding.',
          code: 'FORBIDDEN_ROLE'
        });
      }

      const reset = await tenantBrandingService.resetToDefaults(
        tenantId,
        req.auth?.id || req.user?.id || req.auth?.userId
      );

      res.json({
        success: true,
        message: 'Branding restaurado a los valores predeterminados de SalonPro',
        branding: reset
      });
    } catch (err) {
      console.error('Error resetting tenant branding:', err);
      res.status(500).json({ error: 'Error reiniciando branding del salón' });
    }
  });

  // GET /api/tenant/entitlements - Consulta canónica de funcionalidades, límites y plan vigente
  router.get('/entitlements', async (req, res) => {
    try {
      const tenantId = req.tenantId || (await resolveTenantId(req));
      if (!tenantId) {
        return res.status(403).json({
          error: 'Contexto de salón requerido para consultar permisos de plan.',
          code: 'TENANT_REQUIRED'
        });
      }

      const entitlements = await entitlementsService.getTenantEntitlements(tenantId);
      res.json(entitlements);
    } catch (err) {
      console.error('Error fetching tenant entitlements:', err);
      res.status(500).json({ error: 'Error obteniendo permisos de plan del salón' });
    }
  });

  // GET /api/tenant/settings - Obtener configuración y branding del salón activo
  router.get('/settings', async (req, res) => {
    try {
      const tenantId = await resolveTenantId(req);
      if (!tenantId) {
        return res.status(404).json({ error: 'Salón no encontrado o no autorizado' });
      }

      const [rows] = await pool.query(`
        SELECT 
          t.*,
          sp.name as plan_name,
          sp.slug as plan_slug,
          sp.price_monthly as plan_price,
          (SELECT COUNT(*) FROM branches b WHERE b.tenant_id = t.id) as current_branches,
          (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) as current_users
        FROM tenants t
        LEFT JOIN saas_plans sp ON t.plan_id = sp.id
        WHERE t.id = ?
      `, [tenantId]);

      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'Salón no encontrado' });
      }

      res.json(rows[0]);
    } catch (error) {
      console.error('Error fetching tenant settings:', error);
      res.status(500).json({ error: 'Error obteniendo configuración del salón' });
    }
  });

  // PUT /api/tenant/settings - Actualizar nombre, logo, colores, contacto y RNC del salón
  router.put('/settings', async (req, res) => {
    try {
      const tenantId = await resolveTenantId(req);
      if (!tenantId) {
        return res.status(404).json({ error: 'Salón no encontrado o no autorizado' });
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
          (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) as current_users
        FROM tenants t
        LEFT JOIN saas_plans sp ON t.plan_id = sp.id
        WHERE t.id = ?
      `, [tenantId]);

      res.json({
        success: true,
        message: 'Personalización del salón guardada correctamente',
        tenant: updated[0]
      });
    } catch (error) {
      console.error('Error updating tenant settings:', error);
      res.status(500).json({ error: 'Error guardando personalización: ' + error.message });
    }
  });

  return router;
}

module.exports = { createTenantRouter };
