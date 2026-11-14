const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { createAuthMiddleware, signAuthToken } = require('../middleware/auth.middleware');
const {
  CANONICAL_PLANS_CATALOG,
  normalizePlanCode,
  isValidPlanCode
} = require('../services/saas_catalog.constants');
const { SaasPlanRepository } = require('../repositories/saas_plan.repository');
const { TenantSubscriptionRepository } = require('../repositories/tenant_subscription.repository');
const { EntitlementsRepository } = require('../repositories/entitlements.repository');
const { SubscriptionAuditRepository } = require('../repositories/subscription_audit.repository');
const { EntitlementsService } = require('../services/entitlements.service');

function createSaasRouter(pool, options = {}) {
  const router = express.Router();
  const { authenticate, requireSuperAdmin, verifyAuthToken, extractTokenFromRequest } = createAuthMiddleware(pool);

  const entitlementsService = options.entitlementsService || new EntitlementsService({
    saasPlanRepo: new SaasPlanRepository(pool),
    subscriptionRepo: new TenantSubscriptionRepository(pool),
    entitlementsRepo: new EntitlementsRepository(pool),
    auditRepo: new SubscriptionAuditRepository(pool)
  });

  // Rate Limiter para creación de salones públicos
  const onboardingLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Límite de solicitudes de registro alcanzado para esta dirección IP. Intenta más tarde.' }
  });

  // Helper: check if caller has a valid signed SuperAdmin token
  const isCallerSuperAdmin = async (req) => {
    if (req.auth && req.auth.isSuperAdmin === true) return true;
    const token = extractTokenFromRequest(req);
    if (!token) return false;
    try {
      const decoded = verifyAuthToken(token);
      if (String(decoded.role || '').toLowerCase() !== 'superadmin') return false;
      const [rows] = await pool.query(
        "SELECT id, role, is_active FROM users WHERE id::text = ? AND role = 'superadmin' AND is_active = TRUE LIMIT 1",
        [String(decoded.sub || decoded.id)]
      );
      return Boolean(rows && rows.length > 0);
    } catch (e) {
      return false;
    }
  };

  // GET /api/saas/metrics - KPIs globales para SuperAdmin (PROTEGIDO)
  router.get('/metrics', authenticate, requireSuperAdmin, async (req, res) => {
    try {
      const [tenantsCount] = await pool.query("SELECT COUNT(*) as total FROM tenants");
      const [activeTenants] = await pool.query("SELECT COUNT(*) as active FROM tenants WHERE status = 'active'");
      const [suspendedTenants] = await pool.query("SELECT COUNT(*) as suspended FROM tenants WHERE status = 'suspended'");
      const [branchesCount] = await pool.query("SELECT COUNT(b.id) as total FROM branches b JOIN tenants t ON b.tenant_id = t.id");
      const [usersCount] = await pool.query("SELECT COUNT(u.id) as total FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.role != 'superadmin'");
      const [mrrResult] = await pool.query(`
        SELECT COALESCE(SUM(sp.price_monthly), 0) as mrr
        FROM tenants t
        JOIN saas_plans sp ON t.plan_id = sp.id
        WHERE t.status = 'active'
      `);

      res.json({
        total_tenants: parseInt(tenantsCount[0]?.total || 0),
        active_tenants: parseInt(activeTenants[0]?.active || 0),
        suspended_tenants: parseInt(suspendedTenants[0]?.suspended || 0),
        total_branches: parseInt(branchesCount[0]?.total || 0),
        total_users: parseInt(usersCount[0]?.total || 0),
        mrr: parseFloat(mrrResult[0]?.mrr || 0)
      });
    } catch (error) {
      console.error('Error fetching SaaS metrics:', error);
      res.status(500).json({ error: 'Error obteniendo métricas SaaS' });
    }
  });

  // GET /api/saas/tenants - Lista de salones registrados (PROTEGIDO SUPERADMIN)
  router.get('/tenants', authenticate, requireSuperAdmin, async (req, res) => {
    try {
      const [tenants] = await pool.query(`
        SELECT 
          t.*,
          sp.name as plan_name,
          sp.slug as plan_slug,
          sp.price_monthly as plan_price,
          sp.max_branches as plan_max_branches,
          sp.max_users as plan_max_users,
          (SELECT COUNT(*) FROM branches b WHERE b.tenant_id = t.id) as branches_count,
          (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) as users_count,
          (SELECT COUNT(*) FROM clients c WHERE c.tenant_id = t.id) as clients_count
        FROM tenants t
        LEFT JOIN saas_plans sp ON t.plan_id = sp.id
        ORDER BY t.created_at DESC
      `);
      res.json(tenants);
    } catch (error) {
      console.error('Error fetching tenants:', error);
      res.status(500).json({ error: 'Error listando salones' });
    }
  });

  // GET /api/saas/subscriptions - Lista de suscripciones SaaS de la plataforma (Control Plane)
  router.get('/subscriptions', authenticate, requireSuperAdmin, async (req, res) => {
    try {
      const [subscriptions] = await pool.query(`
        SELECT s.*, t.business_name, t.name as salon_name
        FROM tenant_subscriptions s
        LEFT JOIN tenants t ON s.tenant_id = t.id
        ORDER BY s.created_at DESC
      `);
      res.json({ subscriptions: subscriptions || [] });
    } catch (error) {
      console.error('Error fetching platform subscriptions:', error);
      res.status(500).json({ error: 'Error listando suscripciones SaaS' });
    }
  });

  // GET /api/saas/invoices - Lista de facturas de SalonPro a los salones (Control Plane)
  router.get('/invoices', authenticate, requireSuperAdmin, async (req, res) => {
    try {
      const [invoices] = await pool.query(`
        SELECT i.*, t.business_name
        FROM saas_invoices i
        LEFT JOIN tenants t ON i.tenant_id = t.id
        ORDER BY i.created_at DESC
      `);
      res.json({ invoices: invoices || [] });
    } catch (error) {
      console.error('Error fetching platform SaaS invoices:', error);
      res.status(500).json({ error: 'Error listando facturas de la plataforma' });
    }
  });

  // PUT /api/saas/tenants/:id/modules - Actualizar módulos habilitados por salón (PROTEGIDO SUPERADMIN)
  router.put('/tenants/:id/modules', authenticate, requireSuperAdmin, async (req, res) => {
    const { id } = req.params;
    const { modules_config } = req.body;
    try {
      await pool.query(
        "UPDATE tenants SET modules_config = ?::jsonb, updated_at = NOW() WHERE id = ?",
        [JSON.stringify(modules_config || {}), id]
      );
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating tenant modules:', error);
      res.status(500).json({ error: 'Error actualizando módulos del salón' });
    }
  });

  // PUT /api/saas/tenants/:id/licensing - Actualizar límites de usuarios, sucursales y plan (PROTEGIDO SUPERADMIN)
  router.put('/tenants/:id/licensing', authenticate, requireSuperAdmin, async (req, res) => {
    const { id } = req.params;
    const { plan_id, max_users, max_branches } = req.body;
    try {
      const parsedPlanId = parseInt(plan_id) || 1;
      let modules_config = {};
      if (parsedPlanId === 1) {
        modules_config = {
          pos: true, appointments: false, clients: true, services: true,
          employees: true, inventory: true, cash_register: true, invoices: true,
          dgii: true, commissions: true, payroll: false, expenses: true,
          marketing: false, loyalty_plans: false, gift_cards: false, surveys: false,
          attendance: false, reports: true, security: true
        };
      } else {
        modules_config = {
          pos: true, appointments: true, clients: true, services: true,
          employees: true, inventory: true, cash_register: true, invoices: true,
          dgii: true, commissions: true, payroll: true, expenses: true,
          marketing: true, loyalty_plans: true, gift_cards: true, surveys: true,
          attendance: true, reports: true, security: true
        };
      }

      await pool.query(
        "UPDATE tenants SET plan_id = ?, max_users = ?, max_branches = ?, modules_config = ?::jsonb, updated_at = NOW() WHERE id = ?",
        [parsedPlanId, parseInt(max_users) || 5, parseInt(max_branches) || 1, JSON.stringify(modules_config), id]
      );
      res.json({ success: true, modules_config });
    } catch (error) {
      console.error('Error updating tenant licensing:', error);
      res.status(500).json({ error: 'Error actualizando licenciamiento del salón' });
    }
  });

  // POST /api/saas/tenants - Crear nuevo salón (PROTEGIDO EXCLUSIVAMENTE POR SUPERADMIN)
  router.post('/tenants', authenticate, requireSuperAdmin, async (req, res) => {
    const {
      business_name,
      slug,
      owner_name,
      owner_email,
      owner_phone,
      admin_password,
      plan_id = 1,
      rnc,
      address,
      max_users,
      max_branches,
      modules_config,
      status = 'active'
    } = req.body;

    if (!business_name || !owner_email || !admin_password) {
      return res.status(400).json({ error: 'Nombre del salón, email y contraseña del administrador son obligatorios' });
    }

    const conn = await pool.getConnection();

    try {
      const cleanSlug = (slug || business_name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

      const [existingSlug] = await conn.query("SELECT id FROM tenants WHERE slug = ?", [cleanSlug]);
      if (existingSlug.length > 0) {
        return res.status(400).json({ error: 'El identificador (slug) del salón ya está en uso' });
      }

      const [existingEmail] = await conn.query("SELECT id FROM users WHERE LOWER(email) = LOWER(?)", [owner_email.trim()]);
      if (existingEmail.length > 0) {
        return res.status(400).json({ error: 'El correo electrónico ya está registrado en la plataforma' });
      }

      let parsedPlanId = parseInt(plan_id) || 1;
      const [planRows] = await conn.query("SELECT * FROM saas_plans WHERE id = ? LIMIT 1", [parsedPlanId]);
      const selectedPlan = planRows[0] || { id: 1, max_users: 5, max_branches: 1 };

      const tenantId = crypto.randomUUID();
      const branchId = crypto.randomUUID();
      const userId = crypto.randomUUID();
      const passwordHash = await bcrypt.hash(admin_password, 12);

      const defaultModules = parsedPlanId === 1 ? {
        pos: true, appointments: false, clients: true, services: true,
        employees: true, inventory: true, cash_register: true, invoices: true,
        dgii: true, commissions: true, payroll: false, expenses: true,
        marketing: false, loyalty_plans: false, gift_cards: false, surveys: false,
        attendance: false, reports: true, security: true
      } : {
        pos: true, appointments: true, clients: true, services: true,
        employees: true, inventory: true, cash_register: true, invoices: true,
        dgii: true, commissions: true, payroll: true, expenses: true,
        marketing: true, loyalty_plans: true, gift_cards: true, surveys: true,
        attendance: true, reports: true, security: true
      };

      const finalMaxUsers = max_users ? parseInt(max_users) : (parseInt(selectedPlan.max_users) || 5);
      const finalMaxBranches = max_branches ? parseInt(max_branches) : (parseInt(selectedPlan.max_branches) || 1);
      const finalModules = modules_config ? modules_config : (selectedPlan.included_features || defaultModules);
      const initialStatus = status === 'pending' ? 'pending' : 'active';

      // Transacción atómica estricta usando conexión dedicada
      await conn.beginTransaction();
      try {
        await conn.query(`
          INSERT INTO tenants (id, business_name, slug, email, phone, owner_name, owner_email, owner_phone, rnc, address, plan_id, status, max_users, max_branches, modules_config)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb)
        `, [
          tenantId, business_name, cleanSlug, owner_email.trim(), owner_phone || '', owner_name || 'Propietario', owner_email.trim(), owner_phone || '',
          rnc || '', address || '', parsedPlanId, initialStatus,
          finalMaxUsers, finalMaxBranches, JSON.stringify(finalModules)
        ]);

        await conn.query(`
          INSERT INTO branches (id, tenant_id, name, address, phone, is_main, is_active)
          VALUES (?, ?, ?, ?, ?, true, true)
        `, [branchId, tenantId, `${business_name} - Principal`, address || 'Sucursal Principal', owner_phone || '']);

        await conn.query(`
          INSERT INTO salons (id, name, address, phone, status, tenant_id)
          VALUES (?, ?, ?, ?, 'Active', ?)
        `, [branchId, `${business_name} - Principal`, address || 'Sucursal Principal', owner_phone || '', tenantId]);

        await conn.query(`
          INSERT INTO users (id, tenant_id, branch_id, name, nombre, email, password_hash, role, is_active, estado)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'owner', true, 'Activo')
        `, [userId, tenantId, branchId, owner_name || 'Administrador', owner_name || 'Administrador', owner_email.trim(), passwordHash]);

        // Inicializar planes B2C base para este nuevo tenant
        const defaultTenantPlans = [
          ['silver', 'Plan Silver', 1500, '4 lavados y secados al mes', JSON.stringify(['4 Lavados mensuales', 'Secado incluido'])],
          ['gold', 'Plan Beauty Pro', 1950, '4 lavados profundos + hidratación', JSON.stringify(['4 Lavados mensuales', '15% desc. en servicios extra'])],
          ['black', 'Plan VIP Black', 3200, 'Lavados ilimitados + manicure', JSON.stringify(['Lavados ilimitados', '20% desc. en servicios extra'])]
        ];
        for (const [pId, pName, pPrice, pDesc, pFeatures] of defaultTenantPlans) {
          await conn.query(
            `INSERT INTO plans (tenant_id, id, name, title, price, description, features) VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) ON CONFLICT DO NOTHING`,
            [tenantId, pId, pName, pName, pPrice, pDesc, pFeatures]
          );
        }

        await conn.commit();
      } catch (txError) {
        await conn.rollback();
        throw txError;
      }

      res.status(201).json({
        success: true,
        message: 'Salón registrado exitosamente por SuperAdmin',
        tenant_id: tenantId,
        branch_id: branchId,
        user_id: userId,
        status: initialStatus
      });
    } catch (error) {
      console.error('Error creating tenant:', error);
      res.status(500).json({ error: 'Error creando nuevo salón: ' + error.message });
    } finally {
      conn.release();
    }
  });

  // PUT /api/saas/tenants/:id/status - Suspender o activar salón (PROTEGIDO SUPERADMIN)
  router.put('/tenants/:id/status', authenticate, requireSuperAdmin, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
      await pool.query("UPDATE tenants SET status = ?, updated_at = NOW() WHERE id = ?", [status, id]);
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating tenant status:', error);
      res.status(500).json({ error: 'Error actualizando estado del salón' });
    }
  });

  // PATCH /api/saas/tenants/:tenantId/subscription - Cambiar manualmente el plan SaaS de un tenant (PROTEGIDO SUPERADMIN)
  router.patch('/tenants/:tenantId/subscription', authenticate, requireSuperAdmin, async (req, res) => {
    const { tenantId } = req.params;
    const { plan, reason } = req.body;
    const actorId = req.auth?.id || req.headers['x-user-id'] || 'superadmin';

    if (!isValidPlanCode(plan)) {
      return res.status(400).json({
        error: 'Código de plan inválido. Solo se permite BASE o PRO.',
        code: 'INVALID_PLAN_CODE'
      });
    }

    const normalizedPlan = normalizePlanCode(plan);

    try {
      const updated = await entitlementsService.changeTenantPlan(tenantId, normalizedPlan, {
        actorId,
        reason: reason || 'Cambio manual de plan por SuperAdmin'
      });
      res.json({
        success: true,
        tenant_id: tenantId,
        plan: updated.plan_code,
        status: updated.status
      });
    } catch (err) {
      console.error('Error changing tenant subscription:', err);
      const statusCode = err.code === 'INVALID_TRANSITION' || err.code === 'INVALID_PLAN_CODE' ? 400 : 500;
      res.status(statusCode).json({ error: err.message || 'Error actualizando suscripción' });
    }
  });

  // GET /api/saas/plans - Obtener catálogo SaaS vigente (Plan Principal único)
  router.get('/plans', async (req, res) => {
    try {
      const publicOnly = req.query.public_only === 'true';
      if (!publicOnly) {
        const isSa = await isCallerSuperAdmin(req);
        if (!isSa) {
          return res.status(403).json({
            error: 'Acceso denegado: Se requieren privilegios de SuperAdmin para consultar el catálogo administrativo de planes SaaS.',
            code: 'SUPERADMIN_REQUIRED'
          });
        }
      }

      if (pool) {
        const query = "SELECT * FROM saas_plans WHERE UPPER(code) = 'PRINCIPAL' ORDER BY id ASC";
        const [plans] = await pool.query(query);
        if (plans && plans.length > 0) {
          return res.json(plans.map(p => ({
            ...p,
            code: normalizePlanCode(p.code)
          })));
        }
      }

      res.json(CANONICAL_PLANS_CATALOG);
    } catch (error) {
      res.status(500).json({ error: 'Error obteniendo planes SaaS' });
    }
  });

  // PUT /api/saas/tenants/:tenantId/addons/:addonCode - Activar/desactivar add-on independiente (PROTEGIDO SUPERADMIN)
  router.put('/tenants/:tenantId/addons/:addonCode', authenticate, requireSuperAdmin, async (req, res) => {
    try {
      const { tenantId, addonCode } = req.params;
      const { enabled, reason, source } = req.body || {};
      const result = await entitlementsService.setAddonStatus(tenantId, addonCode, {
        enabled: Boolean(enabled),
        source: source === 'legacy_pro_transition' ? 'legacy_pro_transition' : 'commercial_addon',
        reason,
        actorId: req.user?.id || 'superadmin',
      });
      res.json({ success: true, addon: result });
    } catch (err) {
      if (err.code === 'INVALID_ADDON_CODE') {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      res.status(500).json({ error: 'Error actualizando add-on del salón' });
    }
  });

  // POST /api/saas/plans - Crear un nuevo plan de suscripción SaaS (PROTEGIDO SUPERADMIN)
  router.post('/plans', authenticate, requireSuperAdmin, async (req, res) => {
    const {
      name,
      slug,
      description = '',
      badge_text = '',
      price_monthly = 0,
      price_yearly = 0,
      max_branches = 1,
      max_users = 5,
      features = [],
      is_public = true,
      is_featured = false,
      is_active = true
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'El nombre del plan es obligatorio' });
    }

    try {
      const cleanSlug = (slug || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const featuresJson = JSON.stringify(Array.isArray(features) ? features : []);

      await pool.query(`
        INSERT INTO saas_plans (name, slug, description, badge_text, price_monthly, price_yearly, max_branches, max_users, features, is_public, is_featured, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?)
      `, [
        name, cleanSlug, description, badge_text,
        parseFloat(price_monthly) || 0, parseFloat(price_yearly) || 0,
        parseInt(max_branches) || 1, parseInt(max_users) || 5,
        featuresJson, Boolean(is_public), Boolean(is_featured), Boolean(is_active)
      ]);

      res.status(201).json({ success: true, message: 'Plan SaaS creado exitosamente' });
    } catch (error) {
      console.error('Error creating SaaS plan:', error);
      res.status(500).json({ error: 'Error creando plan SaaS: ' + error.message });
    }
  });

  // PUT /api/saas/plans/:id - Actualizar plan SaaS existente (PROTEGIDO SUPERADMIN)
  router.put('/plans/:id', authenticate, requireSuperAdmin, async (req, res) => {
    const { id } = req.params;
    const {
      name,
      description = '',
      badge_text = '',
      price_monthly = 0,
      price_yearly = 0,
      max_branches = 1,
      max_users = 5,
      features = [],
      is_public = true,
      is_featured = false,
      is_active = true
    } = req.body;

    try {
      const featuresJson = JSON.stringify(Array.isArray(features) ? features : []);
      await pool.query(`
        UPDATE saas_plans
        SET name = ?,
            description = ?,
            badge_text = ?,
            price_monthly = ?,
            price_yearly = ?,
            max_branches = ?,
            max_users = ?,
            features = ?::jsonb,
            is_public = ?,
            is_featured = ?,
            is_active = ?
        WHERE id = ?
      `, [
        name, description, badge_text,
        parseFloat(price_monthly) || 0, parseFloat(price_yearly) || 0,
        parseInt(max_branches) || 1, parseInt(max_users) || 5,
        featuresJson, Boolean(is_public), Boolean(is_featured), Boolean(is_active),
        id
      ]);

      res.json({ success: true, message: 'Plan SaaS actualizado exitosamente' });
    } catch (error) {
      console.error('Error updating SaaS plan:', error);
      res.status(500).json({ error: 'Error actualizando plan SaaS: ' + error.message });
    }
  });

  return router;
}

module.exports = { createSaasRouter };
