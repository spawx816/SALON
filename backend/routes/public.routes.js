const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const { TenantBrandingRepository } = require('../repositories/tenant_branding.repository');
const { TenantBrandingService } = require('../services/tenant_branding.service');
const { TermsAndWelcomeEmailService } = require('../services/terms_and_welcome_email.service');
const { signAuthToken } = require('../middleware/auth.middleware');

/**
 * Public Routes Router - Strictly unprivileged endpoints
 */
function createPublicRouter(pool, options = {}) {
  const router = express.Router();

  const tenantBrandingService = options.tenantBrandingService || new TenantBrandingService({
    repository: options.brandingRepository || new TenantBrandingRepository(pool)
  });
  const termsService = options.termsService || new TermsAndWelcomeEmailService({ pool });

  const onboardingLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hora
    max: process.env.NODE_ENV === 'test' ? 1000 : 10,
    message: { error: 'Demasiadas solicitudes de registro desde esta dirección IP. Intente más tarde.' },
    standardHeaders: true,
    legacyHeaders: false
  });

  /**
   * POST /api/public/onboarding
   * Flujo de autoservicio público para empresas.
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
      address,
      branches_count,
      extra_users_count,
      wants_memberships_addon,
      addon_branches_count
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

      const normalizedEmail = owner_email.trim().toLowerCase();
      const [existingUsers] = await conn.query(
        `SELECT u.id AS user_id, u.tenant_id, u.branch_id, u.name, u.email, u.password_hash,
                t.business_name, t.status AS tenant_status
         FROM users u
         LEFT JOIN tenants t ON t.id = u.tenant_id
         WHERE LOWER(u.email) = ?
         LIMIT 1`,
        [normalizedEmail]
      );

      if (existingUsers.length > 0) {
        const existing = existingUsers[0];
        if (existing.tenant_status !== 'pending' || !existing.tenant_id) {
          const err = new Error('Ya existe una cuenta registrada con este correo. Inicia sesión para continuar.');
          err.statusCode = 409;
          err.code = 'EMAIL_ALREADY_REGISTERED';
          throw err;
        }
        const passwordOk = await bcrypt.compare(String(admin_password), String(existing.password_hash || ''));
        if (!passwordOk) {
          const err = new Error('Ya existe un registro pendiente con este correo. Inicia sesión con tu contraseña para completar el pago.');
          err.statusCode = 409;
          err.code = 'PENDING_EMAIL_EXISTS';
          throw err;
        }

        const requestedAddonBranches = wants_memberships_addon
          ? Math.max(1, parseInt(addon_branches_count, 10) || 1)
          : 0;

        let reusableOrder = null;
        if (options.saasCheckoutService) {
          const [openOrders] = await conn.query(
            `SELECT * FROM saas_checkout_orders
             WHERE tenant_id = ? AND status IN ('pending_payment', 'processing') AND expires_at > NOW()
             ORDER BY created_at DESC LIMIT 1`,
            [existing.tenant_id]
          );
          if (openOrders.length > 0) {
            const { cardnet_session_key: _hidden, ...safeOrder } = openOrders[0];
            reusableOrder = {
              ...safeOrder,
              subtotal_minor: String(safeOrder.subtotal_minor ?? 0),
              tax_minor: String(safeOrder.tax_minor ?? 0),
              total_minor: String(safeOrder.total_minor ?? 0),
            };
          } else {
            reusableOrder = await options.saasCheckoutService.createOrder({
              tenantId: existing.tenant_id,
              actorUserId: existing.user_id,
              source: 'self_service',
              branchesCount: branches_count || 1,
              extraUsersCount: extra_users_count || 0,
              wantsMembershipsAddon: Boolean(wants_memberships_addon),
              addonBranchesCount: requestedAddonBranches,
              metadata: { onboarding: true, retried: true },
              dbConn: conn,
            });
          }
        }

        await conn.commit();

        const sessionId = crypto.randomBytes(24).toString('hex');
        const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
        const userAgent = req.headers['user-agent'] || 'unknown';
        await pool.query(`
          INSERT INTO user_sessions (id, user_id, user_name, role, salon_id, ip_address, user_agent, is_active, created_at, last_activity, tenant_id)
          VALUES (?, ?, ?, 'owner', ?, ?, ?, 1, NOW(), NOW(), ?)
        `, [
          sessionId,
          String(existing.user_id),
          existing.name || owner_name || 'Propietario',
          String(existing.branch_id),
          clientIp,
          userAgent,
          existing.tenant_id,
        ]);
        const token = signAuthToken({
          sub: String(existing.user_id),
          id: String(existing.user_id),
          email: existing.email,
          name: existing.name || owner_name || 'Propietario',
          role: 'owner',
          tenantId: existing.tenant_id,
          branchId: existing.branch_id,
          sessionId,
          isSuperAdmin: false,
          tokenVersion: 1,
        });

        res.cookie('auth_token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging',
          sameSite: 'lax',
          path: '/',
          maxAge: 24 * 60 * 60 * 1000,
        });

        return res.status(200).json({
          success: true,
          reused: true,
          paymentRequired: true,
          message: 'Registro pendiente recuperado. Completa el pago con CardNet para activar tu acceso.',
          tenant_id: existing.tenant_id,
          branch_id: existing.branch_id,
          user_id: existing.user_id,
          status: 'pending',
          order: reusableOrder,
          user: {
            id: existing.user_id,
            tenant_id: existing.tenant_id,
            branch_id: existing.branch_id,
            name: existing.name || owner_name || 'Propietario',
            nombre: existing.name || owner_name || 'Propietario',
            email: existing.email,
            role: 'owner',
            rol: 'owner',
            salon_id: existing.branch_id,
            salon_name: `${existing.business_name} - Principal`,
            tenant: {
              id: existing.tenant_id,
              business_name: existing.business_name,
              status: 'pending',
              subscription_status: 'pending_payment',
            },
            sessionId,
          },
        });
      }

      // 1. Obtener límites oficiales del Plan Principal en BD
      const [plans] = await conn.query(
        "SELECT * FROM saas_plans WHERE UPPER(code) IN ('PRINCIPAL', 'BASE') OR id = 1 ORDER BY CASE WHEN UPPER(code) = 'PRINCIPAL' THEN 0 ELSE 1 END LIMIT 1"
      );
      const basePlan = plans[0] || { max_users: 3, max_branches: 1 };
      const principalModules = {
        pos: true,
        cash_registers: true,
        services_catalog: true,
        inventory: true,
        inventory_advanced: true,
        commissions: true,
        payroll: true,
        attendance: true,
        expenses: true,
        dgii_ecf: true,
        reports: true,
        security: true,
        clients: true,
        marketing: true,
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
        parseInt(basePlan.max_users) || 3,
        parseInt(basePlan.max_branches) || 1,
        JSON.stringify(principalModules)
      ]);

      // Inserción de Sucursal Principal
      await conn.query(`
        INSERT INTO branches (id, tenant_id, name, address, phone, is_main, status, is_active)
        VALUES (?, ?, ?, ?, ?, true, 'Active', true)
      `, [branchId, tenantId, `${business_name} - Principal`, address || 'Sucursal Principal', owner_phone || '']);

      // Inserción de Empresa Legacy
      await conn.query(`
        INSERT INTO salons (id, name, address, phone, status, tenant_id)
        VALUES (?, ?, ?, ?, 'Active', ?)
      `, [branchId, `${business_name} - Principal`, address || 'Sucursal Principal', owner_phone || '', tenantId]);

      // Inserción de Usuario Administrador
      await conn.query(`
        INSERT INTO users (id, tenant_id, branch_id, name, nombre, email, password_hash, role, is_active, estado)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'owner', true, 'Activo')
      `, [userId, tenantId, branchId, owner_name || 'Administrador', owner_name || 'Administrador', owner_email.trim(), passwordHash]);

      // No crear datos operativos de ejemplo ni planes B2C si no corresponden al alta SaaS

      // Inserción atómica de Suscripción Inicial en espera de pago CardNet (NUNCA 'active' sin cobro verificado)
      await conn.query(`
        INSERT INTO tenant_subscriptions (
          tenant_id, plan_code, status, current_period_start, current_period_end, updated_at
        ) VALUES (?, 'PRINCIPAL', 'pending_payment', NOW(), NOW(), NOW())
        ON CONFLICT (tenant_id) DO UPDATE SET plan_code = 'PRINCIPAL', status = 'pending_payment', updated_at = NOW()
      `, [tenantId]);

      // Registro de Auditoría de Creación de Suscripción Inicial
      const requestedAddonBranches = wants_memberships_addon
        ? Math.max(1, parseInt(addon_branches_count, 10) || 1)
        : 0;
      const onboardingReason = wants_memberships_addon
        ? `Registro inicial pendiente de pago CardNet (Plan Principal + Add-on Membresías B2C ${requestedAddonBranches} suc.)`
        : 'Registro inicial pendiente de pago CardNet (Plan Principal)';
      await conn.query(`
        INSERT INTO tenant_subscription_events (
          tenant_id, previous_plan, new_plan, previous_status, new_status, reason, actor_id, created_at
        ) VALUES (?, NULL, 'PRINCIPAL', NULL, 'pending_payment', ?, 'onboarding', NOW())
      `, [tenantId, onboardingReason]);

      // Inyección de fallo controlada EXCLUSIVAMENTE para pruebas automáticas (NODE_ENV=test con header explícito)
      const isTestEnv = process.env.NODE_ENV === 'test';
      const injectFailure = isTestEnv && req.headers['x-test-force-rollback'] === 'true';
      if (injectFailure) {
        throw new Error('INTENTIONAL_TEST_FAILURE: Forzando rollback a mitad de transacción');
      }

      // Crear orden de checkout pendiente dentro de la misma transacción para garantizar atomicidad (sin tenants huérfanos)
      let checkoutOrder = null;
      if (options.saasCheckoutService) {
        checkoutOrder = await options.saasCheckoutService.createOrder({
          tenantId,
          actorUserId: userId,
          source: 'self_service',
          branchesCount: branches_count || 1,
          extraUsersCount: extra_users_count || 0,
          wantsMembershipsAddon: Boolean(wants_memberships_addon),
          addonBranchesCount: requestedAddonBranches,
          metadata: { onboarding: true },
          dbConn: conn,
        });
      }

      await conn.commit();

      // Emitir sesión restringida al flujo de pago (todas las rutas operativas quedan bloqueadas con 402 hasta aprobar pago)
      const sessionId = crypto.randomBytes(24).toString('hex');
      const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
      const userAgent = req.headers['user-agent'] || 'unknown';
      await pool.query(`
        INSERT INTO user_sessions (id, user_id, user_name, role, salon_id, ip_address, user_agent, is_active, created_at, last_activity, tenant_id)
        VALUES (?, ?, ?, 'owner', ?, ?, ?, 1, NOW(), NOW(), ?)
      `, [
        sessionId,
        String(userId),
        owner_name || 'Propietario',
        String(branchId),
        clientIp,
        userAgent,
        tenantId,
      ]);
      const token = signAuthToken({
        sub: String(userId),
        id: String(userId),
        email: owner_email.trim(),
        name: owner_name || 'Propietario',
        role: 'owner',
        tenantId,
        branchId,
        sessionId,
        isSuperAdmin: false,
        tokenVersion: 1,
      });

      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging',
        sameSite: 'lax',
        path: '/',
        maxAge: 24 * 60 * 60 * 1000,
      });

      if (req.body.accept_terms) {
        try {
          await termsService.recordAcceptance({
            tenantId,
            userId,
            termsVersion: req.body.terms_version || 'v2026.1',
            recurringAuthorized: Boolean(req.body.authorize_recurring),
            acceptanceMechanism: 'onboarding_checkbox',
            ipAddress: req.ip || req.connection?.remoteAddress,
            userAgent: req.headers['user-agent'],
            recipientEmail: owner_email.trim(),
            recipientName: owner_name || 'Propietario',
            companyName: business_name,
            accountStatus: 'pending_payment'
          });
        } catch (termsErr) {
          console.warn('[ONBOARDING] Error registrando términos (no bloqueante):', termsErr.message);
        }
      }

      res.status(201).json({
        success: true,
        paymentRequired: true,
        message: 'Espacio registrado. Completa el pago con CardNet para activar tu acceso al sistema.',
        tenant_id: tenantId,
        branch_id: branchId,
        user_id: userId,
        status: 'pending',
        order: checkoutOrder,
        user: {
          id: userId,
          tenant_id: tenantId,
          branch_id: branchId,
          name: owner_name || 'Propietario',
          nombre: owner_name || 'Propietario',
          email: owner_email.trim(),
          role: 'owner',
          rol: 'owner',
          salon_id: branchId,
          salon_name: `${business_name} - Principal`,
          tenant: {
            id: tenantId,
            business_name,
            status: 'pending',
            subscription_status: 'pending_payment',
          },
          sessionId,
        },
      });
    } catch (txError) {
      await conn.rollback();
      console.error('[ONBOARDING ROLLBACK]:', {
        correlationId: req.correlationId || null,
        code: txError.code || null,
        message: txError.message,
      });
      if (txError.statusCode && txError.statusCode >= 400 && txError.statusCode < 500) {
        return res.status(txError.statusCode).json({
          error: txError.message,
          code: txError.code || 'ONBOARDING_VALIDATION_ERROR',
        });
      }
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

  /**
   * GET /api/public/terms/:version
   * Consulta pública de versión de términos inmutables
   */
  router.get('/terms/:version', (req, res) => {
    try {
      const version = req.params.version;
      const terms = termsService.getTerms(version);
      res.json(terms);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message, code: err.code || 'TERMS_ERROR' });
    }
  });

  /**
   * GET /api/public/terms/:version/download
   * Descarga de copia íntegra en texto plano
   */
  router.get('/terms/:version/download', (req, res) => {
    try {
      const version = req.params.version;
      const terms = termsService.getTerms(version);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="terminos_etereas_${terms.version}.txt"`);
      res.send(terms.content);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message, code: err.code || 'TERMS_ERROR' });
    }
  });

  return router;
}

module.exports = { createPublicRouter };

