const express = require('express');
const crypto = require('crypto');
const { createQuarantineGuard } = require('../middleware/quarantine.middleware.cjs');
const { getConfiguredPricing } = require('../services/saas_catalog.constants');
const { getEffectiveRole, getBranchScope, requirePermission } = require('../middleware/rbac.middleware');

/**
 * Salons / Branches Management Router (Scoped strictly by tenant_id)
 */
function createSalonsRouter(poolOrOptions, options = {}) {
  const pool = (poolOrOptions && typeof poolOrOptions.query === 'function')
    ? poolOrOptions
    : (poolOrOptions?.pool || null);
  const opts = (poolOrOptions && typeof poolOrOptions.query === 'function')
    ? options
    : (poolOrOptions || options || {});
  const router = express.Router();
  const checkoutService = opts.saasCheckoutService || null;
  const billingRepo = opts.billingRepo || null;
  const entitlementsService = opts.entitlementsService || null;

  // Authorization helper: Acciones comerciales SaaS exclusivas del Propietario (Owner)
  const requireOwnerOnly = (req, res, next) => {
    const role = getEffectiveRole(req);
    if (role === 'propietario') {
      return next();
    }
    return res.status(403).json({
      error: 'Acceso denegado: la contratación de sucursales y acciones comerciales SaaS son exclusivas del Propietario.',
      code: 'OWNER_ONLY_SAAS_BILLING',
    });
  };

  // Authorization helper: Gestión operativa de sucursales (Owner, Admin o permiso branches.manage)
  const requireOwnerOrAdmin = (req, res, next) => {
    const role = getEffectiveRole(req);
    if (role === 'propietario') return next();
    if (role === 'admin' && !req.auth?.roleId) return next();
    return requirePermission('branches.manage')(req, res, next);
  };

  // GET /api/salons/licensing-status - Consulta estado de licencias de sucursales disponibles y precios
  router.get('/licensing-status', requirePermission('branches.manage', 'security.view'), async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de empresa requerido.', code: 'TENANT_REQUIRED' });
      }

      const [tenantRows] = await pool.query(
        `SELECT id, licensed_branches, max_branches, extra_user_seats, max_users FROM tenants WHERE id = ? LIMIT 1`,
        [tenantId]
      );
      const licensedBranches = Number(tenantRows[0]?.licensed_branches || tenantRows[0]?.max_branches || 1);

      const [branchCountRows] = await pool.query(
        `SELECT COUNT(*)::int as total FROM branches WHERE tenant_id = ? AND is_active = true`,
        [tenantId]
      );
      const currentBranches = Number(branchCountRows[0]?.total ?? branchCountRows[0]?.count ?? 0);
      const availableLicenses = Math.max(0, licensedBranches - currentBranches);

      const pricing = getConfiguredPricing();
      let defaultPaymentMethod = null;
      if (getEffectiveRole(req) === 'propietario' && billingRepo && typeof billingRepo.getDefaultPaymentMethod === 'function') {
        const pm = await billingRepo.getDefaultPaymentMethod(tenantId);
        if (pm && pm.token_reference) {
          defaultPaymentMethod = {
            id: pm.id,
            brand: pm.brand,
            last4: pm.last4,
            expMonth: pm.exp_month,
            expYear: pm.exp_year,
          };
        }
      }

      res.json({
        currentBranches,
        licensedBranches,
        availableLicenses,
        canCreateWithoutPayment: availableLicenses > 0,
        pricing: {
          branchMonthlyUsd: Number(pricing?.principal?.usd ?? 99),
          addonMonthlyUsd: Number(pricing?.addons?.memberships?.usd ?? 99),
          usersIncludedPerBranch: 3,
        },
        defaultPaymentMethod,
      });
    } catch (err) {
      res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
    }
  });

  // POST /api/salons/quote-add-branch - Cotización canónica de sucursal adicional (exclusivo Owner)
  router.post('/quote-add-branch', requireOwnerOnly, async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de empresa requerido.', code: 'TENANT_REQUIRED' });
      }

      if (!checkoutService) {
        return res.status(503).json({ error: 'Servicio de cotización no disponible.', code: 'SERVICE_UNAVAILABLE' });
      }

      // Regla de producto: el add-on de Membresías se contrata exclusivamente desde Mi suscripción → Add-on Suscripciones y Membresías.
      const quote = await checkoutService.calculateProratedBranchOrderAmounts({
        tenantId,
        wantsMembershipsAddon: false,
      });

      let defaultPaymentMethod = null;
      if (getEffectiveRole(req) === 'propietario' && billingRepo && typeof billingRepo.getDefaultPaymentMethod === 'function') {
        const pm = await billingRepo.getDefaultPaymentMethod(tenantId);
        if (pm && pm.token_reference) {
          defaultPaymentMethod = {
            id: pm.id,
            brand: pm.brand,
            last4: pm.last4,
            expMonth: pm.exp_month,
            expYear: pm.exp_year,
          };
        }
      }

      res.json({
        quote,
        defaultPaymentMethod,
      });
    } catch (err) {
      res.status(err.statusCode || 500).json({
        success: false,
        error: err.message,
        code: err.code || 'INTERNAL_ERROR',
        requiresAlternativePayment: err.statusCode === 402,
      });
    }
  });

  // POST /api/salons/contract-branch - Contrata o activa sucursal adicional (exclusivo Owner)
  router.post('/contract-branch', requireOwnerOnly, async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de empresa requerido.', code: 'TENANT_REQUIRED' });
      }

      const branchData = req.body?.branchData || req.body || {};
      // El formulario de sucursales nunca contrata ni activa el add-on de Membresías
      const wantsMembershipsAddon = false;
      const paymentMethodChoice = req.body?.paymentMethodChoice || req.body?.paymentOption || 'saved_card';

      if (!branchData || !branchData.name || !String(branchData.name).trim()) {
        return res.status(400).json({ error: 'El nombre de la sucursal es obligatorio.', code: 'BRANCH_NAME_REQUIRED' });
      }

      // 1. Verificar si hay licencias ya pagadas disponibles
      const [tenantRows] = await pool.query(
        `SELECT licensed_branches, max_branches FROM tenants WHERE id = ? LIMIT 1`,
        [tenantId]
      );
      const licensedBranches = Number(tenantRows[0]?.licensed_branches || tenantRows[0]?.max_branches || 1);
      const [branchCountRows] = await pool.query(
        `SELECT COUNT(*)::int as total FROM branches WHERE tenant_id = ? AND is_active = true`,
        [tenantId]
      );
      const currentBranches = Number(branchCountRows[0]?.total ?? branchCountRows[0]?.count ?? 0);
      const availableLicenses = Math.max(0, licensedBranches - currentBranches);

      if (availableLicenses > 0) {
        // Licencia disponible: se activa directamente sin cobro
        const branchId = crypto.randomUUID();
        await pool.query(
          `INSERT INTO branches (id, tenant_id, name, address, phone, is_main, is_active)
           VALUES (?, ?, ?, ?, ?, false, true)`,
          [branchId, tenantId, branchData.name.trim(), branchData.address || '', branchData.phone || '']
        );
        await pool.query(
          `INSERT INTO salons (id, tenant_id, name, address, phone, status)
           VALUES (?, ?, ?, ?, ?, 'Active')`,
          [branchId, tenantId, branchData.name.trim(), branchData.address || '', branchData.phone || '']
        );
        if (entitlementsService && typeof entitlementsService.invalidateTenantCache === 'function') {
          entitlementsService.invalidateTenantCache(tenantId);
        }
        return res.json({
          success: true,
          branchId,
          activated: true,
          paid: false,
          charged: false,
          usedAvailableLicense: true,
          message: 'Sucursal activada con éxito utilizando una licencia disponible de tu plan.',
        });
      }

      // 2. Requiere contratación pagada
      if (!checkoutService) {
        return res.status(503).json({ error: 'Servicio de contratación no disponible.', code: 'SERVICE_UNAVAILABLE' });
      }

      const orderResult = await checkoutService.createAddBranchOrder({
        tenantId,
        branchData,
        wantsMembershipsAddon: Boolean(wantsMembershipsAddon),
        actorUserId: req.auth?.id || null,
        clientIp: req.ip,
      });

      if (orderResult.canCreateWithoutPayment) {
        return res.json({
          success: true,
          activated: true,
          paid: false,
          message: 'Sucursal activada con éxito utilizando tu licencia disponible.',
        });
      }

      const order = orderResult.order;

      // 3a. Pago directo con tarjeta guardada autorizada
      if (paymentMethodChoice === 'saved_card') {
        const payResult = await checkoutService.payAddBranchWithSavedMethod({
          orderId: order.id,
          tenantId,
          actorUserId: req.auth?.id || null,
          clientIp: req.ip,
        });
        return res.json({
          success: true,
          activated: payResult.activated,
          paid: true,
          charged: true,
          branchId: orderResult.branchId,
          order: payResult.order,
          message: 'Sucursal contratada y activada con éxito.',
        });
      }

      // 3b. Pago mediante CardNet hosted checkout
      const origin = req.headers.origin || (req.headers.host ? `${req.protocol}://${req.headers.host}` : null);
      const checkoutResult = await checkoutService.initiateCardnetCheckout({
        orderId: order.id,
        tenantId,
        clientIp: req.ip,
        returnBaseUrl: origin,
      });

      return res.json({
        success: true,
        needsCheckout: true,
        requiresCheckout: true,
        branchId: orderResult.branchId,
        order: checkoutResult.order || order,
        checkout: checkoutResult.checkout || checkoutResult,
      });
    } catch (err) {
      res.status(err.statusCode || 500).json({
        success: false,
        error: err.message,
        code: err.code || 'INTERNAL_ERROR',
        requiresAlternativePayment: err.statusCode === 402,
      });
    }
  });

  // Fail-Closed Quarantine Protection Guard on Empresa Resources
  router.use('/:id', createQuarantineGuard(pool, 'salons', 'id'));

  // GET /api/salons
  router.get('/', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de empresa requerido.' });
      }

      const [branches] = await pool.query(`
        SELECT id, tenant_id, name, address, phone,
               CASE WHEN is_active THEN 'Active' ELSE 'Inactive' END as status,
               is_main, created_at
        FROM branches
        WHERE tenant_id = ?
        ORDER BY is_main DESC, created_at ASC
      `, [tenantId]);

      const scope = getBranchScope(req);
      const filterByScope = (list) => {
        if (scope.allBranches || getEffectiveRole(req) === 'cliente_b2c') return list;
        if (!scope.branchIds || scope.branchIds.length === 0) return [];
        return list.filter((b) => scope.branchIds.includes(String(b.id)));
      };

      if (branches && branches.length > 0) {
        return res.json(filterByScope(branches));
      }

      const [rows] = await pool.query('SELECT * FROM salons WHERE tenant_id = ? ORDER BY id ASC', [tenantId]);
      res.json(filterByScope(rows || []));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/salons/autocomplete - Search branches/salons strictly scoped to tenant (REM-P2-01)
  router.get('/autocomplete', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de empresa requerido.' });
      }

      const q = String(req.query.q || '').trim();
      if (q.length < 2) {
        return res.status(400).json({ error: 'El término de búsqueda debe tener al menos 2 caracteres.' });
      }

      const rawLimit = parseInt(req.query.limit || '20', 10);
      const limit = Math.min(Math.max(rawLimit, 1), 50);
      const searchPattern = `%${q}%`;

      const [branches] = await pool.query(`
        SELECT id, tenant_id, name, address, phone, is_main
        FROM branches
        WHERE tenant_id = ?
          AND (name ILIKE ? OR address ILIKE ?)
        ORDER BY is_main DESC, name ASC
        LIMIT ?
      `, [tenantId, searchPattern, searchPattern, limit]);

      if (branches && branches.length > 0) {
        return res.json(branches);
      }

      const [rows] = await pool.query(`
        SELECT id, tenant_id, name, address, phone
        FROM salons
        WHERE tenant_id = ?
          AND (name ILIKE ? OR address ILIKE ?)
        ORDER BY name ASC
        LIMIT ?
      `, [tenantId, searchPattern, searchPattern, limit]);

      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/salons
  router.post('/', requireOwnerOrAdmin, async (req, res) => {
    const { name, address, phone } = req.body;
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(403).json({ error: 'Contexto de empresa requerido.', code: 'TENANT_REQUIRED' });
    }

    try {
      if (!req.auth?.isSuperAdmin) {
        if (options.entitlementsService) {
          const limitCheck = await options.entitlementsService.checkLimit(tenantId, 'branches');
          if (!limitCheck.allowed) {
            return res.status(403).json({
              error: 'Has alcanzado el límite de sucursales permitido por tu plan. Contrata una sucursal adicional para continuar.',
              code: limitCheck.code || 'PLAN_LIMIT_REACHED',
              limit: 'branches',
              current: limitCheck.current,
              maximum: limitCheck.maximum,
              requiresCapacityContract: true,
              quoteEndpoint: '/api/salons/quote-add-branch',
            });
          }
        } else {
          const [tenantRows] = await pool.query('SELECT max_branches, licensed_branches FROM tenants WHERE id = ?', [tenantId]);
          const [branchCount] = await pool.query('SELECT COUNT(*) as total FROM branches WHERE tenant_id = ? AND is_active = true', [tenantId]);
          const maxBranches = parseInt(tenantRows[0]?.licensed_branches || tenantRows[0]?.max_branches || 1, 10);
          const currentBranches = parseInt(branchCount[0]?.total || 0, 10);

          if (currentBranches >= maxBranches) {
            return res.status(403).json({
              error: 'Has alcanzado el límite de sucursales permitido por tu plan. Contrata una sucursal adicional para continuar.',
              code: 'PLAN_LIMIT_REACHED',
              limit: 'branches',
              current: currentBranches,
              maximum: maxBranches,
              requiresCapacityContract: true,
              quoteEndpoint: '/api/salons/quote-add-branch',
            });
          }
        }
      }

      const branchId = crypto.randomUUID();
      await pool.query(
        'INSERT INTO branches (id, tenant_id, name, address, phone, is_main, is_active) VALUES (?, ?, ?, ?, ?, false, true)',
        [branchId, tenantId, name, address || '', phone || '']
      );

      await pool.query(
        "INSERT INTO salons (id, tenant_id, name, address, phone, status) VALUES (?, ?, ?, ?, ?, 'Active')",
        [branchId, tenantId, name, address || '', phone || '']
      );
      return res.json({ id: branchId, success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/salons/:id
  router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { name, address, phone, status } = req.body;
    const tenantId = req.tenantId;
    try {
      await pool.query(
        'UPDATE branches SET name = ?, address = ?, phone = ?, is_active = ? WHERE id::text = ? AND tenant_id = ?',
        [name, address, phone, status !== 'Inactive', String(id), tenantId]
      );
      await pool.query(
        'UPDATE salons SET name = ?, address = ?, phone = ?, status = ? WHERE id::text = ? AND tenant_id = ?',
        [name, address, phone, status || 'Active', String(id), tenantId]
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/salons/:id
  router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const tenantId = req.tenantId;
    try {
      await pool.query('DELETE FROM branches WHERE id::text = ? AND tenant_id = ? AND is_main = false', [String(id), tenantId]);
      await pool.query('DELETE FROM salons WHERE id::text = ? AND tenant_id = ?', [String(id), tenantId]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = {
  createSalonsRouter
};
