const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const { TenantBrandingRepository } = require('../repositories/tenant_branding.repository');
const { TenantBrandingService } = require('../services/tenant_branding.service');

/**
 * Public Routes Router - Strictly unprivileged endpoints
 */
function createPublicRouter(pool, options = {}) {
  const router = express.Router();

  const tenantBrandingService = options.tenantBrandingService || new TenantBrandingService({
    repository: options.brandingRepository || new TenantBrandingRepository(pool)
  });

  const onboardingLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hora
    max: process.env.NODE_ENV === 'test' ? 1000 : 10,
    message: { error: 'Demasiadas solicitudes de registro desde esta dirección IP. Intente más tarde.' },
    standardHeaders: true,
    legacyHeaders: false
  });

  /**
   * POST /api/public/onboarding
   * Flujo de autoservicio público para salones.
   * REGLAS ESTRICTAS DE SEGURIDAD:
   * 1. Siempre se crea en estado 'pending'.
   * 2. Plan forzado al plan público base (plan_id = 1).
   * 3. Límites sanitizados obligatoriamente a los valores del Plan Base en BD.
   * 4. Transacción atómica estricta usando conexión dedicada (pool.getConnection()).
   * 5. NUNCA devuelve un token utilizable mientras el tenant siga 'pending'.
   */
  router.post('/onboarding', onboardingLimiter, async (req, res) => {
    const {
      business_name,
      owner_name,
      owner_email,
      owner_phone,
      admin_password,
      rnc,
      address
    } = req.body;

    if (!business_name || !owner_email || !admin_password) {
      return res.status(400).json({ error: 'business_name, owner_email y admin_password son obligatorios' });
    }

    if (String(admin_password).length < 8) {
      return res.status(400).json({ error: 'La contraseña de administrador debe tener al menos 8 caracteres' });
    }

    // Adquirir conexión dedicada del pool para aislamiento transaccional real
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      // 1. Obtener límites oficiales del Plan Base en BD
      const [plans] = await conn.query('SELECT * FROM saas_plans WHERE id = 1 OR code = \'base\' LIMIT 1');
      const basePlan = plans[0] || { max_users: 5, max_branches: 1 };
      const baseModules = {
        pos: true,
        cajas: true,
        services_catalog: true,
        inventory: true,
        payroll: true,
        attendance: true,
        dgii_ecf: true,
        reports: true,
        clients: false,
        memberships: false
      };

      const tenantId = crypto.randomUUID();
      const branchId = crypto.randomUUID();
      const userId = crypto.randomUUID();

      const cleanSlug = business_name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') + '-' + Date.now().toString(36);

      const passwordHash = await bcrypt.hash(String(admin_password), 10);

      // Inserción de Tenant (Siempre status = 'pending')
      await conn.query(`
        INSERT INTO tenants (
          id, business_name, slug, email, phone, owner_name, owner_email, owner_phone,
          rnc, address, plan_id, status, max_users, max_branches, modules_config
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending', ?, ?, ?::jsonb)
      `, [
        tenantId, business_name, cleanSlug, owner_email.trim(), owner_phone || '',
        owner_name || 'Propietario', owner_email.trim(), owner_phone || '',
        rnc || '', address || '',
        parseInt(basePlan.max_users) || 5,
        parseInt(basePlan.max_branches) || 1,
        JSON.stringify(basePlan.included_features || baseModules)
      ]);

      // Inserción de Sucursal Principal
      await conn.query(`
        INSERT INTO branches (id, tenant_id, name, address, phone, is_main, status, is_active)
        VALUES (?, ?, ?, ?, ?, true, 'Active', true)
      `, [branchId, tenantId, `${business_name} - Principal`, address || 'Sucursal Principal', owner_phone || '']);

      // Inserción de Salón Legacy
      await conn.query(`
        INSERT INTO salons (id, name, address, phone, status, tenant_id)
        VALUES (?, ?, ?, ?, 'Active', ?)
      `, [branchId, `${business_name} - Principal`, address || 'Sucursal Principal', owner_phone || '', tenantId]);

      // Inserción de Usuario Administrador
      await conn.query(`
        INSERT INTO users (id, tenant_id, branch_id, name, nombre, email, password_hash, role, is_active, estado)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'owner', true, 'Activo')
      `, [userId, tenantId, branchId, owner_name || 'Administrador', owner_name || 'Administrador', owner_email.trim(), passwordHash]);

      // Inserción de Planes B2C
      const defaultTenantPlans = [
        ['silver', 'Plan Silver', 1500, '4 lavados y secados al mes', JSON.stringify(['4 Lavados mensuales', 'Secado incluido'])],
        ['gold', 'Plan Beauty Pro', 1950, '4 lavados profundos + hidratación', JSON.stringify(['4 Lavados mensuales', '15% desc. en servicios extra'])],
        ['black', 'Plan VIP Black', 3200, 'Lavados ilimitados + manicure', JSON.stringify(['Lavados ilimitados', '20% desc. en servicios extra'])]
      ];
      for (const [pId, pName, pPrice, pDesc, pFeatures] of defaultTenantPlans) {
        await conn.query(`
          INSERT INTO plans (tenant_id, id, name, title, price, description, features)
          VALUES (?, ?, ?, ?, ?, ?, ?::jsonb)
          ON CONFLICT DO NOTHING
        `, [tenantId, pId, pName, pName, pPrice, pDesc, pFeatures]);
      }

      // Inserción atómica de Suscripción Inicial (REGLA INNEGOCIABLE: Siempre Plan BASE)
      await conn.query(`
        INSERT INTO tenant_subscriptions (
          tenant_id, plan_code, status, current_period_start, current_period_end, updated_at
        ) VALUES (?, 'BASE', 'active', NOW(), NOW() + INTERVAL '30 days', NOW())
        ON CONFLICT (tenant_id) DO UPDATE SET plan_code = 'BASE', status = 'active', updated_at = NOW()
      `, [tenantId]);

      // Registro de Auditoría de Creación de Suscripción Inicial
      await conn.query(`
        INSERT INTO tenant_subscription_events (
          tenant_id, previous_plan, new_plan, previous_status, new_status, reason, actor_id, created_at
        ) VALUES (?, NULL, 'BASE', NULL, 'active', 'Suscripción inicial de onboarding (Plan Base)', 'onboarding', NOW())
      `, [tenantId]);

      // Inyección de fallo controlada EXCLUSIVAMENTE para pruebas automáticas (NODE_ENV=test con header explícito)
      const isTestEnv = process.env.NODE_ENV === 'test';
      const injectFailure = isTestEnv && req.headers['x-test-force-rollback'] === 'true';
      if (injectFailure) {
        throw new Error('INTENTIONAL_TEST_FAILURE: Forzando rollback a mitad de transacción');
      }

      await conn.commit();

      // NUNCA devolver token utilizable mientras status sea pending
      res.status(201).json({
        success: true,
        message: 'Solicitud de registro recibida exitosamente. Su cuenta está pendiente de activación por el equipo administrativo de SalonPro.',
        tenant_id: tenantId,
        branch_id: branchId,
        user_id: userId,
        status: 'pending'
      });
    } catch (txError) {
      await conn.rollback();
      console.error('[ONBOARDING ROLLBACK]:', txError.message);
      // NUNCA devolver mensajes internos ni detalles de base de datos al cliente
      res.status(500).json({ error: 'Ocurrió un error procesando el registro. Por favor intente más tarde.' });
    } finally {
      conn.release();
    }
  });

  /**
   * GET /api/public/branding/:slug
   * Visual-only branding for public login, booking, or catalog pages.
   * Delivers exclusively safe visual properties without PII or internal IDs.
   */
  router.get('/branding/:slug', async (req, res) => {
    try {
      const { slug } = req.params;
      if (!slug || slug === 'default' || slug === 'salonpro') {
        const defaultSafe = await tenantBrandingService.getPublicSafeBranding(null);
        return res.json(defaultSafe);
      }

      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(slug);
      let targetTenantId = slug;
      if (pool) {
        const [rows] = isUuid
          ? await pool.query('SELECT id FROM tenants WHERE id = ? OR slug = ? LIMIT 1', [slug, slug])
          : await pool.query('SELECT id FROM tenants WHERE slug = ? LIMIT 1', [slug]);
        if (rows && rows.length > 0) {
          targetTenantId = rows[0].id;
        }
      }

      const safeBranding = await tenantBrandingService.getPublicSafeBranding(targetTenantId);
      res.json(safeBranding);
    } catch (err) {
      console.error('Error fetching public branding:', err);
      const defaultSafe = await tenantBrandingService.getPublicSafeBranding(null);
      res.json(defaultSafe);
    }
  });

  return router;
}

module.exports = { createPublicRouter };

