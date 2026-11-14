const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { createAuthMiddleware, signAuthToken } = require('../middleware/auth.middleware');
const {
  SAAS_PLANS,
  SAAS_ADDONS,
  CANONICAL_PLAN_FEATURES,
  CANONICAL_PLANS_CATALOG,
  MEMBERSHIPS_ADDON_DEFAULT_USD,
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

      // Regla explícita de MRR recurrente:
      // - Solo suscripciones/tenants en estado comercial elegible ('active')
      // - Excluye cuentas de prueba (slug 'test-%' / '%-test' o email '%@test.%' / '%@example.%')
      // - Excluye cargos únicos / implementación (solo plan * sucursales + asientos extra + add-on membresías * sucursales)
      // - Agrupa por moneda sin mezclar divisas sin conversión definida
      const [mrrRows] = await pool.query(`
        SELECT
          t.id,
          t.slug,
          t.email,
          t.status as tenant_status,
          COALESCE(ts.status, t.status) as commercial_status,
          COALESCE(ts.currency, t.currency, 'USD') as currency,
          COALESCE(ts.billing_cycle, sp.billing_cycle, 'monthly') as billing_cycle,
          GREATEST(COALESCE(t.licensed_branches, t.max_branches, 1), 1) as billable_branches,
          GREATEST(COALESCE(t.extra_user_seats, 0), 0) as extra_seats,
          COALESCE(t.has_memberships, false) as has_memberships,
          COALESCE(sp.price_per_branch, sp.price_monthly, 0) as plan_price_per_branch,
          COALESCE(sp.price_yearly, 0) as plan_price_yearly,
          COALESCE(sp.extra_user_price, 0) as extra_user_price
        FROM tenants t
        LEFT JOIN tenant_subscriptions ts ON ts.tenant_id = t.id
        LEFT JOIN saas_plans sp ON (
          (ts.plan_code IS NOT NULL AND UPPER(sp.code) = UPPER(ts.plan_code))
          OR (ts.plan_code IS NULL AND sp.id = t.plan_id)
        )
        WHERE t.status = 'active'
          AND COALESCE(ts.status, 'active') IN ('active', 'past_due')
          AND LOWER(COALESCE(t.slug, '')) NOT LIKE 'test-%'
          AND LOWER(COALESCE(t.slug, '')) NOT LIKE '%-test'
          AND LOWER(COALESCE(t.email, '')) NOT LIKE '%@test.%'
          AND LOWER(COALESCE(t.email, '')) NOT LIKE '%@example.%'
      `);

      const mrrCentsByCurrency = {};
      for (const row of mrrRows) {
        const curr = String(row.currency || 'USD').trim().toUpperCase();
        const branches = Number(row.billable_branches) || 1;
        const extraSeats = Number(row.extra_seats) || 0;
        const planUnitCents = Math.round(Number(row.plan_price_per_branch || 0) * 100);
        const extraUnitCents = Math.round(Number(row.extra_user_price || 0) * 100);
        const addonUnitCents = row.has_memberships ? Math.round(Number(MEMBERSHIPS_ADDON_DEFAULT_USD || 99) * 100) : 0;

        let monthlyCents = (planUnitCents * branches) + (extraUnitCents * extraSeats) + (addonUnitCents * branches);
        if (String(row.billing_cycle).toLowerCase() === 'yearly' && Number(row.plan_price_yearly) > 0) {
          const yearlyPlanCents = Math.round(Number(row.plan_price_yearly) * 100) * branches;
          monthlyCents = Math.round(yearlyPlanCents / 12) + (extraUnitCents * extraSeats) + (addonUnitCents * branches);
        }
        mrrCentsByCurrency[curr] = (mrrCentsByCurrency[curr] || 0) + monthlyCents;
      }

      const mrrByCurrency = {};
      for (const [curr, cents] of Object.entries(mrrCentsByCurrency)) {
        mrrByCurrency[curr] = Number((cents / 100).toFixed(2));
      }

      res.json({
        total_tenants: parseInt(tenantsCount[0]?.total || 0, 10),
        active_tenants: parseInt(activeTenants[0]?.active || 0, 10),
        suspended_tenants: parseInt(suspendedTenants[0]?.suspended || 0, 10),
        total_branches: parseInt(branchesCount[0]?.total || 0, 10),
        total_users: parseInt(usersCount[0]?.total || 0, 10),
        mrr: mrrByCurrency.USD ?? Object.values(mrrByCurrency)[0] ?? 0,
        mrr_by_currency: mrrByCurrency
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
          COALESCE(ts.plan_code, sp.code, 'PRINCIPAL') as plan_code,
          COALESCE(ts.status, t.status) as subscription_status,
          sp.name as plan_name,
          sp.slug as plan_slug,
          COALESCE(sp.price_per_branch, sp.price_monthly, 0) as plan_price,
          COALESCE(sp.price_per_branch, sp.price_monthly, 0) as plan_price_per_branch,
          sp.max_branches as plan_max_branches,
          sp.max_users as plan_max_users,
          COALESCE(sp.users_per_branch, 3) as plan_users_per_branch,
          COALESCE(sp.extra_user_price, 0) as plan_extra_user_price,
          COALESCE(sp.is_public, true) as plan_is_public,
          (SELECT COUNT(*) FROM branches b WHERE b.tenant_id = t.id) as branches_count,
          (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id AND u.role != 'superadmin') as users_count,
          (SELECT COUNT(*) FROM clients c WHERE c.tenant_id = t.id) as clients_count
        FROM tenants t
        LEFT JOIN tenant_subscriptions ts ON ts.tenant_id = t.id
        LEFT JOIN saas_plans sp ON (
          (ts.plan_code IS NOT NULL AND UPPER(sp.code) = UPPER(ts.plan_code))
          OR (ts.plan_code IS NULL AND sp.id = t.plan_id)
        )
        ORDER BY t.created_at DESC
      `);
      res.json(tenants);
    } catch (error) {
      console.error('Error fetching tenants:', error);
      res.status(500).json({ error: 'Error listando salones' });
    }
  });

  // GET /api/saas/branches - Directorio global de sedes físicas (Control Plane)
  router.get('/branches', authenticate, requireSuperAdmin, async (req, res) => {
    try {
      const [branches] = await pool.query(`
        SELECT b.id, b.tenant_id, b.name, b.address, b.phone, b.is_main, b.is_active, b.created_at,
               t.business_name as tenant_name, t.status as tenant_status
        FROM branches b
        JOIN tenants t ON b.tenant_id = t.id
        ORDER BY t.business_name ASC, b.is_main DESC, b.created_at ASC
      `);
      res.json({ branches: branches || [] });
    } catch (error) {
      console.error('Error fetching global branches:', error);
      res.status(500).json({ error: 'Error listando sedes físicas de la plataforma' });
    }
  });

  // GET /api/saas/subscriptions - Lista de suscripciones SaaS de la plataforma (Control Plane)
  router.get('/subscriptions', authenticate, requireSuperAdmin, async (req, res) => {
    try {
      const [subscriptions] = await pool.query(`
        SELECT s.*, t.business_name, t.business_name as salon_name, t.status as tenant_status
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

  const ALLOWED_MODULE_KEYS = new Set([
    'pos', 'cash_register', 'cash_registers', 'appointments', 'clients', 'services',
    'services_catalog', 'employees', 'inventory', 'inventory_advanced', 'invoices',
    'dgii', 'dgii_ecf', 'commissions', 'payroll', 'expenses', 'marketing',
    'gift_cards', 'surveys', 'attendance', 'reports', 'security'
  ]);

  const STATUS_TRANSITIONS = Object.freeze({
    pending: ['active', 'suspended', 'cancelled'],
    active: ['past_due', 'suspended', 'cancelled', 'expired'],
    past_due: ['active', 'suspended', 'cancelled', 'expired'],
    suspended: ['active', 'cancelled'],
    expired: ['active', 'cancelled'],
    cancelled: ['active']
  });

  // PUT /api/saas/tenants/:id/modules - Actualizar módulos habilitados por salón (Merge parcial validado)
  router.put('/tenants/:id/modules', authenticate, requireSuperAdmin, async (req, res) => {
    const { id } = req.params;
    const rawPayload = req.body?.modules_config !== undefined ? req.body.modules_config : req.body;
    if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
      return res.status(400).json({ error: 'Se requiere un objeto válido de módulos', code: 'INVALID_MODULES_PAYLOAD' });
    }

    const patch = {};
    for (const [k, v] of Object.entries(rawPayload)) {
      if (k === 'memberships' || k === 'loyalty_plans') {
        return res.status(400).json({
          error: 'El add-on de Suscripciones/Membresías debe gestionarse desde el endpoint independiente de add-ons.',
          code: 'ADDON_SEPARATION_REQUIRED'
        });
      }
      if (!ALLOWED_MODULE_KEYS.has(k)) {
        return res.status(400).json({ error: `Módulo no permitido: ${k}`, code: 'INVALID_MODULE_KEY' });
      }
      if (typeof v !== 'boolean') {
        return res.status(400).json({ error: `El valor para ${k} debe ser booleano`, code: 'INVALID_MODULE_VALUE' });
      }
      patch[k] = v;
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'No se enviaron módulos válidos para actualizar' });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query('SELECT id, modules_config FROM tenants WHERE id = ? FOR UPDATE', [id]);
      if (!rows || rows.length === 0) {
        await conn.rollback();
        return res.status(404).json({ error: 'Salón no encontrado' });
      }

      const existingModules = (rows[0].modules_config && typeof rows[0].modules_config === 'object')
        ? rows[0].modules_config
        : {};
      const mergedModules = { ...existingModules, ...patch };

      await conn.query(
        'UPDATE tenants SET modules_config = ?::jsonb, updated_at = NOW() WHERE id = ?',
        [JSON.stringify(mergedModules), id]
      );

      await logControlPlaneSecurityAccess(req, 'CONTROL_PLANE_UPDATE_TENANT_MODULES', `Tenant ${id}: ${JSON.stringify(patch)}`);
      await conn.commit();
      if (typeof entitlementsService?.invalidateTenantCache === 'function') {
        entitlementsService.invalidateTenantCache(id);
      }
      res.json({ success: true, modules_config: mergedModules });
    } catch (error) {
      await conn.rollback();
      console.error('Error updating tenant modules:', error);
      res.status(500).json({ error: 'Error actualizando módulos del salón' });
    } finally {
      conn.release();
    }
  });

  // PUT /api/saas/tenants/:id/licensing - Actualizar límites de sucursales/asientos preservando plan y módulos
  router.put('/tenants/:id/licensing', authenticate, requireSuperAdmin, async (req, res) => {
    const { id } = req.params;
    const { licensed_branches, extra_user_seats, max_branches, max_users } = req.body || {};

    const hasBranches = licensed_branches !== undefined || max_branches !== undefined;
    const hasSeats = extra_user_seats !== undefined;
    const hasMaxUsers = max_users !== undefined;

    if (!hasBranches && !hasSeats && !hasMaxUsers) {
      return res.status(400).json({ error: 'Debe especificar licensed_branches o extra_user_seats' });
    }

    const parsedBranches = hasBranches ? Number(licensed_branches ?? max_branches) : null;
    const parsedExtraSeats = hasSeats ? Number(extra_user_seats) : null;
    const parsedMaxUsersExplicit = hasMaxUsers ? Number(max_users) : null;

    if (parsedBranches !== null && (!Number.isInteger(parsedBranches) || parsedBranches < 1 || parsedBranches > 500)) {
      return res.status(400).json({ error: 'licensed_branches debe ser un entero entre 1 y 500' });
    }
    if (parsedExtraSeats !== null && (!Number.isInteger(parsedExtraSeats) || parsedExtraSeats < 0 || parsedExtraSeats > 2000)) {
      return res.status(400).json({ error: 'extra_user_seats debe ser un entero entre 0 y 2000' });
    }
    if (parsedMaxUsersExplicit !== null && (!Number.isInteger(parsedMaxUsersExplicit) || parsedMaxUsersExplicit < 1 || parsedMaxUsersExplicit > 5000)) {
      return res.status(400).json({ error: 'max_users debe ser un entero entre 1 y 5000' });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query(
        `SELECT t.id, t.plan_id, t.licensed_branches, t.extra_user_seats, t.max_branches, t.max_users,
                t.modules_config, t.has_memberships, COALESCE(sp.users_per_branch, 3) as users_per_branch
         FROM tenants t
         LEFT JOIN tenant_subscriptions ts ON ts.tenant_id = t.id
         LEFT JOIN saas_plans sp ON (
           (ts.plan_code IS NOT NULL AND UPPER(sp.code) = UPPER(ts.plan_code))
           OR (ts.plan_code IS NULL AND sp.id = t.plan_id)
         )
         WHERE t.id = ? FOR UPDATE OF t`,
        [id]
      );
      if (!rows || rows.length === 0) {
        await conn.rollback();
        return res.status(404).json({ error: 'Salón no encontrado' });
      }

      const current = rows[0];
      const nextBranches = parsedBranches !== null ? parsedBranches : (Number(current.licensed_branches || current.max_branches) || 1);
      const nextExtraSeats = parsedExtraSeats !== null ? parsedExtraSeats : (Number(current.extra_user_seats) || 0);
      const usersPerBranch = Number(current.users_per_branch) || 3;
      const nextMaxUsers = parsedMaxUsersExplicit !== null
        ? parsedMaxUsersExplicit
        : (nextBranches * usersPerBranch) + nextExtraSeats;

      await conn.query(
        `UPDATE tenants
         SET licensed_branches = ?, max_branches = ?, extra_user_seats = ?, max_users = ?, updated_at = NOW()
         WHERE id = ?`,
        [nextBranches, nextBranches, nextExtraSeats, nextMaxUsers, id]
      );

      await logControlPlaneSecurityAccess(
        req,
        'CONTROL_PLANE_UPDATE_TENANT_LICENSING',
        `Tenant ${id}: branches=${nextBranches}, extra_seats=${nextExtraSeats}, max_users=${nextMaxUsers}`
      );
      await conn.commit();

      if (typeof entitlementsService?.invalidateTenantCache === 'function') {
        entitlementsService.invalidateTenantCache(id);
      }
      res.json({
        success: true,
        licensed_branches: nextBranches,
        max_branches: nextBranches,
        extra_user_seats: nextExtraSeats,
        max_users: nextMaxUsers,
        plan_id: current.plan_id,
        modules_config: current.modules_config,
        has_memberships: current.has_memberships
      });
    } catch (error) {
      await conn.rollback();
      console.error('Error updating tenant licensing:', error);
      res.status(500).json({ error: 'Error actualizando licenciamiento del salón' });
    } finally {
      conn.release();
    }
  });

  // POST /api/saas/tenants - Crear nuevo salón (Contrato único transaccional Control Plane)
  router.post('/tenants', authenticate, requireSuperAdmin, async (req, res) => {
    const {
      business_name,
      slug,
      owner_name,
      owner_email,
      owner_phone,
      admin_password,
      rnc,
      address,
      licensed_branches = 1,
      extra_user_seats = 0,
      status = 'active'
    } = req.body || {};

    if (!business_name || !owner_email || !admin_password) {
      return res.status(400).json({ error: 'Nombre del salón, email y contraseña del administrador son obligatorios' });
    }
    if (String(admin_password).length < 6) {
      return res.status(400).json({ error: 'La contraseña del administrador debe tener al menos 6 caracteres' });
    }
    const branchesNum = Number(licensed_branches);
    const extraSeatsNum = Number(extra_user_seats);
    if (!Number.isInteger(branchesNum) || branchesNum < 1 || branchesNum > 500) {
      return res.status(400).json({ error: 'licensed_branches debe ser un entero entre 1 y 500' });
    }
    if (!Number.isInteger(extraSeatsNum) || extraSeatsNum < 0 || extraSeatsNum > 2000) {
      return res.status(400).json({ error: 'extra_user_seats debe ser un entero entre 0 y 2000' });
    }

    const initialStatus = status === 'pending' ? 'pending' : 'active';
    const cleanBusinessName = String(business_name).trim();
    const cleanEmail = String(owner_email).trim().toLowerCase();
    const cleanOwnerName = String(owner_name || 'Propietario').trim();
    const cleanSlug = (slug || cleanBusinessName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    if (!cleanSlug) {
      return res.status(400).json({ error: 'El identificador (slug) del salón no es válido' });
    }

    const conn = await pool.getConnection();
    try {
      const [existingSlug] = await conn.query("SELECT id FROM tenants WHERE slug = ?", [cleanSlug]);
      if (existingSlug.length > 0) {
        return res.status(400).json({ error: 'El identificador (slug) del salón ya está en uso' });
      }

      const [existingEmail] = await conn.query("SELECT id FROM users WHERE LOWER(email) = LOWER(?)", [cleanEmail]);
      if (existingEmail.length > 0) {
        return res.status(400).json({ error: 'El correo electrónico ya está registrado en la plataforma' });
      }

      const [planRows] = await conn.query("SELECT * FROM saas_plans WHERE UPPER(code) = 'PRINCIPAL' LIMIT 1");
      const principalPlan = planRows[0] || { id: 3, users_per_branch: 3 };
      const usersPerBranch = Number(principalPlan.users_per_branch) || 3;
      const finalMaxUsers = (branchesNum * usersPerBranch) + extraSeatsNum;
      const finalModules = { ...CANONICAL_PLAN_FEATURES.PRINCIPAL, memberships: false };

      const tenantId = crypto.randomUUID();
      const branchId = crypto.randomUUID();
      const userId = crypto.randomUUID();
      const subscriptionId = crypto.randomUUID();
      const passwordHash = await bcrypt.hash(String(admin_password), 12);
      const actorId = String(req.auth?.userId || 'superadmin');

      await conn.beginTransaction();
      try {
        await conn.query(`
          INSERT INTO tenants (
            id, business_name, slug, email, phone, owner_name, owner_email, owner_phone,
            rnc, address, plan_id, status, licensed_branches, max_branches, extra_user_seats, max_users,
            has_memberships, modules_config
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, false, ?::jsonb)
        `, [
          tenantId, cleanBusinessName, cleanSlug, cleanEmail, owner_phone || '',
          cleanOwnerName, cleanEmail, owner_phone || '',
          rnc || '', address || '', principalPlan.id, initialStatus,
          branchesNum, branchesNum, extraSeatsNum, finalMaxUsers, JSON.stringify(finalModules)
        ]);

        await conn.query(`
          INSERT INTO branches (id, tenant_id, name, address, phone, is_main, is_active)
          VALUES (?, ?, ?, ?, ?, true, true)
        `, [branchId, tenantId, `${cleanBusinessName} - Principal`, address || 'Sucursal Principal', owner_phone || '']);

        await conn.query(`
          INSERT INTO salons (id, name, address, phone, status, tenant_id)
          VALUES (?, ?, ?, ?, 'Active', ?)
        `, [branchId, `${cleanBusinessName} - Principal`, address || 'Sucursal Principal', owner_phone || '', tenantId]);

        await conn.query(`
          INSERT INTO users (id, tenant_id, branch_id, name, nombre, email, password_hash, role, is_active, estado)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'owner', true, 'Activo')
        `, [userId, tenantId, branchId, cleanOwnerName, cleanOwnerName, cleanEmail, passwordHash]);

        await conn.query(`
          INSERT INTO tenant_subscriptions (
            id, tenant_id, saas_plan_id, plan_code, status, billing_cycle, currency, started_at, current_period_start, current_period_end
          )
          VALUES (?, ?, ?, 'PRINCIPAL', ?, 'monthly', 'USD', NOW(), NOW(), NOW() + INTERVAL '30 days')
        `, [subscriptionId, tenantId, principalPlan.id, initialStatus]);

        await conn.query(`
          INSERT INTO tenant_subscription_events (
            tenant_id, previous_plan, new_plan, previous_status, new_status, reason, actor_id
          )
          VALUES (?, NULL, 'PRINCIPAL', NULL, ?, ?, ?)
        `, [tenantId, initialStatus, 'Alta de salón desde Control Plane (Plan Principal sin add-on)', actorId]);

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
        subscription_id: subscriptionId,
        plan_code: 'PRINCIPAL',
        has_memberships: false,
        status: initialStatus
      });
    } catch (error) {
      console.error('Error creating tenant:', error.message);
      res.status(500).json({ error: 'Error interno al crear el nuevo salón' });
    } finally {
      conn.release();
    }
  });

  // PUT /api/saas/tenants/:id/status - Máquina de estados explícita + sincronización transaccional + auditoría
  router.put('/tenants/:id/status', authenticate, requireSuperAdmin, async (req, res) => {
    const { id } = req.params;
    const { status, reason } = req.body || {};
    const nextStatus = typeof status === 'string' ? status.trim().toLowerCase() : '';
    const allowedTargets = new Set(['pending', 'active', 'past_due', 'suspended', 'cancelled', 'expired']);

    if (!allowedTargets.has(nextStatus)) {
      return res.status(400).json({ error: `Estado comercial inválido: ${status}`, code: 'INVALID_TENANT_STATUS' });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [tenantRows] = await conn.query('SELECT id, status FROM tenants WHERE id = ? FOR UPDATE', [id]);
      if (!tenantRows || tenantRows.length === 0) {
        await conn.rollback();
        return res.status(404).json({ error: 'Salón no encontrado' });
      }

      const [subRows] = await conn.query('SELECT id, plan_code, status FROM tenant_subscriptions WHERE tenant_id = ? FOR UPDATE', [id]);
      const currentTenantStatus = String(tenantRows[0].status || 'pending').toLowerCase();
      const currentSubStatus = subRows[0] ? String(subRows[0].status || currentTenantStatus).toLowerCase() : currentTenantStatus;
      const canonicalCurrent = currentSubStatus;

      if (canonicalCurrent !== nextStatus) {
        const validNext = STATUS_TRANSITIONS[canonicalCurrent] || [];
        if (!validNext.includes(nextStatus)) {
          await conn.rollback();
          return res.status(400).json({
            error: `Transición de estado no permitida: ${canonicalCurrent} -> ${nextStatus}`,
            code: 'INVALID_STATUS_TRANSITION'
          });
        }
      }

      await conn.query('UPDATE tenants SET status = ?, updated_at = NOW() WHERE id = ?', [nextStatus, id]);
      if (subRows[0]) {
        await conn.query('UPDATE tenant_subscriptions SET status = ?, updated_at = NOW() WHERE tenant_id = ?', [nextStatus, id]);
      }

      const actorId = String(req.auth?.userId || 'superadmin');
      const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim() : `Cambio de estado administrativo (${canonicalCurrent} -> ${nextStatus})`;
      await conn.query(
        `INSERT INTO tenant_subscription_events (tenant_id, previous_plan, new_plan, previous_status, new_status, reason, actor_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, subRows[0]?.plan_code || 'PRINCIPAL', subRows[0]?.plan_code || 'PRINCIPAL', canonicalCurrent, nextStatus, cleanReason, actorId]
      );

      await conn.commit();
      if (typeof entitlementsService?.invalidateTenantCache === 'function') {
        entitlementsService.invalidateTenantCache(id);
      }
      res.json({ success: true, tenant_id: id, previous_status: canonicalCurrent, status: nextStatus });
    } catch (error) {
      await conn.rollback();
      console.error('Error updating tenant status:', error);
      res.status(500).json({ error: 'Error actualizando estado del salón' });
    } finally {
      conn.release();
    }
  });

  // PATCH /api/saas/tenants/:tenantId/subscription - Cambiar manualmente el plan SaaS de un tenant (PROTEGIDO SUPERADMIN)
  router.patch('/tenants/:tenantId/subscription', authenticate, requireSuperAdmin, async (req, res) => {
    const { tenantId } = req.params;
    const { plan, reason } = req.body || {};
    const actorId = req.auth?.userId || 'superadmin';

    if (!isValidPlanCode(plan)) {
      return res.status(400).json({
        error: 'Código de plan inválido. Solo se permite el plan comercial vigente (PRINCIPAL).',
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

  const parseOptionalPrice = (val) => {
    if (val === null || val === undefined || String(val).trim() === '') return null;
    const n = Number(val);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  // GET /api/saas/plans - Obtener catálogo SaaS vigente (Plan Principal único)
  router.get('/plans', async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
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
        const query = publicOnly
          ? "SELECT * FROM saas_plans WHERE UPPER(code) = 'PRINCIPAL' AND is_public = true AND is_active = true ORDER BY id ASC"
          : "SELECT * FROM saas_plans WHERE UPPER(code) = 'PRINCIPAL' ORDER BY id ASC";
        const [plans] = await pool.query(query);
        if (plans && plans.length > 0) {
          let planFeaturesRows = [];
          try {
            const [pf] = await pool.query('SELECT plan_code, feature_key, is_included FROM saas_plan_features');
            planFeaturesRows = pf || [];
          } catch (_) { }

          const canonicalDefaults = CANONICAL_PLAN_FEATURES[SAAS_PLANS.PRINCIPAL] || {};
          const addonCatalog = [
            {
              code: SAAS_ADDONS.MEMBERSHIPS,
              name: 'Suscripciones y Membresías',
              price_per_branch: MEMBERSHIPS_ADDON_DEFAULT_USD,
              currency: 'USD',
              implementation_separate: true
            }
          ];

          return res.json(plans.map(p => {
            const normCode = normalizePlanCode(p.code);
            const rawIncluded = (typeof p.included_features === 'object' && p.included_features !== null)
              ? { ...p.included_features }
              : {};
            if (rawIncluded.cajas !== undefined && rawIncluded.cash_registers === undefined) {
              rawIncluded.cash_registers = Boolean(rawIncluded.cajas);
            }
            delete rawIncluded.cajas;

            const baseIncluded = normCode === SAAS_PLANS.PRINCIPAL
              ? { ...canonicalDefaults, ...rawIncluded }
              : { ...rawIncluded };

            const matrixForPlan = planFeaturesRows.filter(
              r => String(r.plan_code || '').toUpperCase() === String(p.code || '').toUpperCase() || normalizePlanCode(r.plan_code) === normCode
            );
            for (const row of matrixForPlan) {
              baseIncluded[row.feature_key] = Boolean(row.is_included);
            }
            // Modelo comercial vigente: membresías B2C es add-on independiente, nunca incluido gratis en Plan Principal
            if (normCode === 'PRINCIPAL') {
              baseIncluded.memberships = false;
            }

            const canonicalMonthly = parseOptionalPrice(p.price_monthly ?? p.price_per_branch ?? p.price);
            const canonicalPerBranch = parseOptionalPrice(p.price_per_branch ?? p.price_monthly ?? p.price);
            const canonicalExtraUser = parseOptionalPrice(p.extra_user_price);
            const usersPerBranch = parseInt(p.users_per_branch, 10) || 3;

            return {
              ...p,
              code: normCode,
              currency: p.currency || 'USD',
              price: canonicalPerBranch,
              price_per_branch: canonicalPerBranch,
              price_monthly: canonicalMonthly,
              extra_user_price: canonicalExtraUser,
              users_per_branch: usersPerBranch,
              users_included: usersPerBranch,
              included_features: baseIncluded,
              addons: addonCatalog
            };
          }));
        }
        if (publicOnly) {
          return res.json([]);
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
      code,
      slug,
      description = '',
      badge_text = '',
      price_per_branch,
      price_monthly = 0,
      price_yearly = 0,
      users_per_branch = 3,
      extra_user_price = 15,
      max_branches = 1,
      max_users = 5,
      billing_cycle = 'monthly',
      included_features = {},
      is_public = true,
      is_featured = false,
      is_active = true
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'El nombre del plan es obligatorio' });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const cleanSlug = (slug || code || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const planCode = String(code || cleanSlug).toUpperCase();
      const normalizedFeatures = (typeof included_features === 'object' && included_features !== null && !Array.isArray(included_features))
        ? { ...included_features }
        : {};
      if (normalizePlanCode(planCode) === 'PRINCIPAL') {
        normalizedFeatures.memberships = false;
      }
      const featuresJson = JSON.stringify(normalizedFeatures);
      const effectivePrice = price_per_branch !== undefined ? (parseFloat(price_per_branch) || 0) : (parseFloat(price_monthly) || 0);

      const [inserted] = await conn.query(`
        INSERT INTO saas_plans (
          name, code, slug, description, badge_text, price, price_per_branch, price_monthly, price_yearly,
          users_per_branch, extra_user_price, max_branches, max_users, billing_cycle, included_features,
          is_public, is_featured, is_active
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?)
        RETURNING *
      `, [
        name, planCode, cleanSlug, description, badge_text,
        effectivePrice, effectivePrice, parseFloat(price_monthly) || effectivePrice, parseFloat(price_yearly) || 0,
        parseInt(users_per_branch, 10) || 3, parseFloat(extra_user_price) || 0,
        parseInt(max_branches, 10) || 1, parseInt(max_users, 10) || 5,
        billing_cycle || 'monthly', featuresJson,
        Boolean(is_public), Boolean(is_featured), Boolean(is_active)
      ]);

      const [validFeatureRows] = await conn.query('SELECT key FROM saas_features');
      const validKeys = new Set((validFeatureRows || []).map(r => r.key));
      for (const [fKey, fVal] of Object.entries(normalizedFeatures)) {
        if (validKeys.has(fKey)) {
          await conn.query(
            `INSERT INTO saas_plan_features (plan_code, feature_key, is_included)
             VALUES (?, ?, ?)
             ON CONFLICT (plan_code, feature_key) DO UPDATE SET is_included = EXCLUDED.is_included
             RETURNING plan_code`,
            [planCode, fKey, Boolean(fVal)]
          );
        }
      }

      await conn.commit();
      res.status(201).json({ success: true, plan: inserted?.[0] || null, message: 'Plan SaaS creado exitosamente' });
    } catch (error) {
      await conn.rollback();
      console.error('Error creating SaaS plan:', error);
      res.status(500).json({ error: 'Error creando plan SaaS: ' + error.message });
    } finally {
      conn.release();
    }
  });

  // PUT /api/saas/plans/:id - Actualizar plan SaaS existente (PROTEGIDO SUPERADMIN)
  router.put('/plans/:id', authenticate, requireSuperAdmin, async (req, res) => {
    const { id } = req.params;
    const body = req.body || {};

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [existingRows] = await conn.query('SELECT * FROM saas_plans WHERE id = ? LIMIT 1 FOR UPDATE', [id]);
      if (!existingRows || existingRows.length === 0) {
        await conn.rollback();
        return res.status(404).json({ error: 'Plan SaaS no encontrado' });
      }
      const existing = existingRows[0];
      const normCode = normalizePlanCode(existing.code);

      const nextName = body.name !== undefined ? body.name : existing.name;
      const nextDescription = body.description !== undefined ? body.description : (existing.description || '');
      const nextBadgeText = body.badge_text !== undefined ? body.badge_text : (existing.badge_text || '');
      const parsedPerBranch = body.price_per_branch !== undefined
        ? parseOptionalPrice(body.price_per_branch)
        : parseOptionalPrice(existing.price_per_branch ?? existing.price);
      const nextPricePerBranch = parsedPerBranch !== null ? parsedPerBranch : 0;
      const nextPriceMonthly = body.price_monthly !== undefined
        ?parseOptionalPrice(body.price_monthly)
        : (body.price_per_branch !== undefined
        ? parsedPerBranch
        : parseOptionalPrice(existing.price_monthly ?? existing.price_per_branch ?? existing.price));
      const nextPriceYearly = body.price_yearly !== undefined
          ? (parseOptionalPrice(body.price_yearly) ?? 0)
          : Number(existing.price_yearly ?? 0);
      const nextUsersPerBranch = body.users_per_branch !== undefined
        ? (parseInt(body.users_per_branch, 10) || 1)
        : Number(existing.users_per_branch ?? 3);
      const nextExtraUserPrice = body.extra_user_price !== undefined
        ?parseOptionalPrice(body.extra_user_price)
        : parseOptionalPrice(existing.extra_user_price);
      const nextMaxBranches = body.max_branches !== undefined
        ? (parseInt(body.max_branches, 10) || 1)
        : Number(existing.max_branches ?? 1);
      const nextMaxUsers = body.max_users !== undefined
        ? (parseInt(body.max_users, 10) || 1)
        : Number(existing.max_users ?? 5);
      const nextBillingCycle = body.billing_cycle !== undefined ? body.billing_cycle : (existing.billing_cycle || 'monthly');
      const nextIsPublic = body.is_public !== undefined ? Boolean(body.is_public) : Boolean(existing.is_public);
      const nextIsFeatured = body.is_featured !== undefined ? Boolean(body.is_featured) : Boolean(existing.is_featured);
      const nextIsActive = body.is_active !== undefined ? Boolean(body.is_active) : Boolean(existing.is_active);

      const baseFeatures = (typeof existing.included_features === 'object' && existing.included_features !== null)
        ? { ...existing.included_features }
        : {};
      if (baseFeatures.cajas !== undefined && baseFeatures.cash_registers === undefined) {
        baseFeatures.cash_registers = Boolean(baseFeatures.cajas);
      }
      delete baseFeatures.cajas;

      const rawIncoming = (typeof body.included_features === 'object' && body.included_features !== null && !Array.isArray(body.included_features))
        ? { ...body.included_features }
        : null;
      if (rawIncoming) {
        if (rawIncoming.cajas !== undefined && rawIncoming.cash_registers === undefined) {
          rawIncoming.cash_registers = Boolean(rawIncoming.cajas);
        }
        delete rawIncoming.cajas;
      }
      const incomingFeatures = rawIncoming;
      const mergedFeatures = incomingFeatures ? { ...baseFeatures, ...incomingFeatures } : baseFeatures;

      // Modelo comercial vigente: Clientes e Inventario incluidos; Membresías B2C es add-on independiente
      if (normCode === 'PRINCIPAL') {
        mergedFeatures.memberships = false;
      }

      const [updatedRows] = await conn.query(`
        UPDATE saas_plans
        SET name = ?,
            description = ?,
            badge_text = ?,
            price = ?,
            price_per_branch = ?,
            price_monthly = ?,
            price_yearly = ?,
            users_per_branch = ?,
            extra_user_price = ?,
            max_branches = ?,
            max_users = ?,
            billing_cycle = ?,
            included_features = ?::jsonb,
            is_public = ?,
            is_featured = ?,
            is_active = ?
        WHERE id = ?
        RETURNING *
      `, [
        nextName,
        nextDescription,
        nextBadgeText,
        nextPricePerBranch,
        nextPricePerBranch,
        nextPriceMonthly,
        nextPriceYearly,
        nextUsersPerBranch,
        nextExtraUserPrice,
        nextMaxBranches,
        nextMaxUsers,
        nextBillingCycle,
        JSON.stringify(mergedFeatures),
        nextIsPublic,
        nextIsFeatured,
        nextIsActive,
        id
      ]);

      if (incomingFeatures) {
        const [validFeatureRows] = await conn.query('SELECT key FROM saas_features');
        const validKeys = new Set((validFeatureRows || []).map(r => r.key));
        for (const [fKey, fVal] of Object.entries(mergedFeatures)) {
          if (validKeys.has(fKey)) {
            await conn.query(
              `INSERT INTO saas_plan_features (plan_code, feature_key, is_included)
               VALUES (?, ?, ?)
               ON CONFLICT (plan_code, feature_key) DO UPDATE SET is_included = EXCLUDED.is_included
               RETURNING plan_code`,
              [existing.code, fKey, Boolean(fVal)]
            );
          }
        }
      }

      if (entitlementsService?.auditRepo?.log) {
        try {
          await entitlementsService.auditRepo.log({
            tenantId: null,
            actorId: req.user?.id || 'superadmin',
            action: 'SAAS_PLAN_UPDATED',
            details: { planId: id, planCode: existing.code, updatedFields: Object.keys(body) }
          });
        } catch (_) { }
      }

      await conn.commit();
      res.json({
        success: true,
        plan: updatedRows?.[0] ? { ...updatedRows[0], code: normCode, included_features: mergedFeatures } : null,
        message: 'Plan SaaS actualizado exitosamente'
      });
    } catch (error) {
      await conn.rollback();
      console.error('Error updating SaaS plan:', error);
      res.status(500).json({ error: 'Error actualizando plan SaaS: ' + error.message });
    } finally {
      conn.release();
    }
  });

  // === CONTROL PLANE SECURITY ENDPOINTS (SuperAdmin únicamente, sin datos operativos de salones) ===
  const logControlPlaneSecurityAccess = async (req, action, details) => {
    try {
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || req.ip || '127.0.0.1';
      const userAgent = req.headers['user-agent'] || 'Unknown';
      await pool.query(
        `INSERT INTO security_audit_logs (user_id, user_name, action, details, ip_address, user_agent, tenant_id)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
        [String(req.auth?.userId || 'superadmin'), req.auth?.name || req.auth?.email || 'SuperAdmin', action, details, ip, userAgent]
      );
    } catch (e) {
      console.error('[CONTROL PLANE AUDIT LOG ERROR]:', e.message);
    }
  };

  router.get('/security/login-attempts', authenticate, requireSuperAdmin, async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200);
      const [attempts] = await pool.query(
        'SELECT id, email_or_cedula, ip_address, status, attempted_at, created_at FROM login_attempts ORDER BY id DESC LIMIT ?',
        [limit]
      );
      const [blockedIps] = await pool.query(
        'SELECT id, ip_address, reason, blocked_until, created_at FROM blocked_ips WHERE blocked_until IS NULL OR blocked_until > NOW() ORDER BY id DESC'
      );
      const [blockedAccounts] = await pool.query(
        'SELECT id, account_identifier, reason, blocked_until, created_at, attempts_count, strike_count, last_ip FROM account_lockouts WHERE blocked_until IS NULL OR blocked_until > NOW() ORDER BY id DESC'
      );
      await logControlPlaneSecurityAccess(req, 'CONTROL_PLANE_VIEW_LOGIN_ATTEMPTS', `Consulta global de intentos/bloqueos (${attempts.length} registros)`);
      res.json({ attempts, blockedIps, blockedAccounts });
    } catch (err) {
      console.error('[CONTROL PLANE LOGIN ATTEMPTS ERROR]:', err.message);
      res.status(500).json({ error: 'Error consultando seguridad de plataforma' });
    }
  });

  router.post('/security/unblock-ip', authenticate, requireSuperAdmin, async (req, res) => {
    try {
      const { ip_address } = req.body || {};
      if (!ip_address || typeof ip_address !== 'string') {
        return res.status(400).json({ error: 'ip_address es requerido' });
      }
      const cleanIp = ip_address.trim();
      await pool.query('DELETE FROM blocked_ips WHERE ip_address = ?', [cleanIp]);
      await pool.query("DELETE FROM login_attempts WHERE ip_address = ? AND status = 'failed'", [cleanIp]);
      await logControlPlaneSecurityAccess(req, 'CONTROL_PLANE_UNBLOCK_IP', `IP desbloqueada desde Control Plane: ${cleanIp}`);
      res.json({ success: true, message: `IP ${cleanIp} desbloqueada correctamente.` });
    } catch (err) {
      console.error('[CONTROL PLANE UNBLOCK IP ERROR]:', err.message);
      res.status(500).json({ error: 'Error desbloqueando IP' });
    }
  });

  router.post('/security/unblock-account', authenticate, requireSuperAdmin, async (req, res) => {
    try {
      const { account_identifier } = req.body || {};
      if (!account_identifier || typeof account_identifier !== 'string') {
        return res.status(400).json({ error: 'account_identifier es requerido' });
      }
      const cleanAccount = account_identifier.trim();
      await pool.query('DELETE FROM account_lockouts WHERE LOWER(account_identifier) = LOWER(?)', [cleanAccount]);
      await pool.query("DELETE FROM login_attempts WHERE LOWER(email_or_cedula) = LOWER(?) AND status = 'failed'", [cleanAccount]);
      await logControlPlaneSecurityAccess(req, 'CONTROL_PLANE_UNBLOCK_ACCOUNT', `Cuenta desbloqueada desde Control Plane: ${cleanAccount}`);
      res.json({ success: true, message: `Cuenta ${cleanAccount} desbloqueada correctamente.` });
    } catch (err) {
      console.error('[CONTROL PLANE UNBLOCK ACCOUNT ERROR]:', err.message);
      res.status(500).json({ error: 'Error desbloqueando cuenta' });
    }
  });

  router.get('/security/audit-logs', authenticate, requireSuperAdmin, async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 300);
      const [rows] = await pool.query(
        `SELECT id, user_id, user_name, action, details, ip_address, created_at
         FROM security_audit_logs
         WHERE tenant_id IS NULL
         ORDER BY id DESC
         LIMIT ?`,
        [limit]
      );
      await logControlPlaneSecurityAccess(req, 'CONTROL_PLANE_VIEW_PLATFORM_AUDIT', `Consulta de logs de plataforma (${rows.length} registros)`);
      res.json(rows);
    } catch (err) {
      console.error('[CONTROL PLANE AUDIT LOGS ERROR]:', err.message);
      res.status(500).json({ error: 'Error consultando logs del Control Plane' });
    }
  });

  return router;
}

module.exports = { createSaasRouter };
