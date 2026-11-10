/**
 * Rutas de Inventario Multi-Tenant Real (Fase 2B)
 * REGLA INNEGOCIABLE:
 * - El tenant se resuelve estrictamente desde req.tenantId.
 * - Rutas Base protegidas por requirePlanFeature('inventory').
 * - Rutas Pro protegidas por requirePlanFeature('inventory_advanced').
 */
const express = require('express');
const { InventoryPhysicalSessionService } = require('../services/inventory_physical_session.service');

function createInventoryRouter({ inventoryService, purchaseService, transferService, physicalSessionService, requirePlanFeature }) {
  const router = express.Router();

  const getPhysicalService = () => {
    if (physicalSessionService) return physicalSessionService;
    const pool = inventoryService?.repo?.pool || inventoryService?.pool || require('../db').pool;
    return new InventoryPhysicalSessionService(pool);
  };

  // Middleware Base: Toda ruta de inventario requiere la funcionalidad 'inventory'
  router.use(requirePlanFeature('inventory'));

  // ==========================================
  // RUTAS PLAN BASE (INVENTORY BÁSICO)
  // ==========================================

  // 1. GET /api/inventory/products - Listar productos
  router.get('/products', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { search, category, activeOnly, limit = 50, offset = 0 } = req.query;
      const products = await inventoryService.listProducts(tenantId, {
        search,
        category,
        activeOnly: activeOnly === 'true' || activeOnly === '1',
        limit: Number(limit),
        offset: Number(offset)
      });
      res.json(products);
    } catch (err) {
      console.error('[INVENTORY ERROR] listProducts:', err);
      res.status(500).json({ error: err.message, code: 'INVENTORY_ERROR' });
    }
  });

  // 2. POST /api/inventory/products - Crear producto
  router.post('/products', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      // Descartar cualquier tenant_id enviado en body (Anti-spoofing)
      const { tenant_id: _ignored, ...productData } = req.body;

      if (!productData.sku || !productData.name) {
        return res.status(400).json({ error: 'SKU y Nombre de producto son obligatorios.', code: 'VALIDATION_ERROR' });
      }

      const product = await inventoryService.createProduct(tenantId, productData);

      // Si se envía initial_stock > 0, inicializar existencias
      if (Number(req.body.initial_stock) > 0) {
        await inventoryService.receiveInitialStock(tenantId, {
          productId: product.id,
          locationId: req.body.location_id || null,
          quantity: Number(req.body.initial_stock),
          unitCost: Number(product.cost) || 0,
          userId: req.user?.id || null,
          userName: req.user?.name || 'Recepción'
        });
      }

      res.status(201).json(product);
    } catch (err) {
      if (err.code === 'UNIQUE_SKU_VIOLATION' || err.code === 'UNIQUE_BARCODE_VIOLATION' || err.code === 'CHECK_VIOLATION') {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      console.error('[INVENTORY ERROR] createProduct:', err);
      res.status(500).json({ error: err.message, code: 'INVENTORY_ERROR' });
    }
  });

  // 3. GET /api/inventory/products/:id - Obtener producto
  router.get('/products/:id', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const product = await inventoryService.getProduct(tenantId, req.params.id);
      if (!product) {
        return res.status(404).json({ error: 'Producto no encontrado.', code: 'NOT_FOUND' });
      }
      res.json(product);
    } catch (err) {
      res.status(500).json({ error: err.message, code: 'INVENTORY_ERROR' });
    }
  });

  // 4. PUT /api/inventory/products/:id - Actualizar producto
  router.put('/products/:id', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { tenant_id: _ignored, id: _ignoredId, ...updateData } = req.body;
      const updated = await inventoryService.updateProduct(tenantId, req.params.id, updateData);
      if (!updated) {
        return res.status(404).json({ error: 'Producto no encontrado.', code: 'NOT_FOUND' });
      }
      res.json(updated);
    } catch (err) {
      if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message, code: 'NOT_FOUND' });
      res.status(500).json({ error: err.message, code: 'INVENTORY_ERROR' });
    }
  });

  // 5. GET /api/inventory/stock - Listar existencias actuales
  router.get('/stock', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { locationId, lowStockOnly, limit = 100, offset = 0 } = req.query;
      const stock = await inventoryService.listStock(tenantId, {
        locationId,
        lowStockOnly: lowStockOnly === 'true' || lowStockOnly === '1',
        limit: Number(limit),
        offset: Number(offset)
      });
      res.json(stock);
    } catch (err) {
      res.status(500).json({ error: err.message, code: 'INVENTORY_ERROR' });
    }
  });

  // 6. GET /api/inventory/stock/:productId - Existencia de un producto
  router.get('/stock/:productId', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const stock = await inventoryService.getStock(tenantId, req.params.productId, req.query.locationId);
      res.json(stock);
    } catch (err) {
      res.status(500).json({ error: err.message, code: 'INVENTORY_ERROR' });
    }
  });

  // 7. GET /api/inventory/movements - Historial del libro mayor de movimientos
  router.get('/movements', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { productId, locationId, movementType, limit = 50, offset = 0 } = req.query;
      const movements = await inventoryService.listMovements(tenantId, {
        productId,
        locationId,
        movementType,
        limit: Number(limit),
        offset: Number(offset)
      });
      res.json(movements);
    } catch (err) {
      res.status(500).json({ error: err.message, code: 'INVENTORY_ERROR' });
    }
  });

  // 8. POST /api/inventory/adjustments - Ajuste manual de existencias (Autorizado a Admin/SuperAdmin)
  router.post('/adjustments', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const userRole = req.user?.role || req.headers['x-user-role'];
      const { productId, locationId, quantity, adjustmentType, reason } = req.body;

      if (!productId || !adjustmentType || !quantity) {
        return res.status(400).json({ error: 'Faltan parámetros de ajuste requeridos.', code: 'VALIDATION_ERROR' });
      }

      const result = await inventoryService.makeAdjustment(tenantId, {
        productId,
        locationId,
        quantity: Number(quantity),
        adjustmentType,
        reason,
        userId: req.user?.id || null,
        userName: req.user?.name || 'Administrador',
        userRole
      });

      res.status(200).json(result);
    } catch (err) {
      if (err.code === 'UNAUTHORIZED_ROLE') {
        return res.status(403).json({ error: err.message, code: 'UNAUTHORIZED_ROLE' });
      }
      if (err.code === 'INSUFFICIENT_STOCK') {
        return res.status(400).json({ error: err.message, code: 'INSUFFICIENT_STOCK' });
      }
      if (err.code === 'NOT_FOUND') {
        return res.status(404).json({ error: err.message, code: 'NOT_FOUND' });
      }
      res.status(500).json({ error: err.message, code: 'INVENTORY_ERROR' });
    }
  });

  // 9. GET /api/inventory/alerts/low-stock - Alertas de productos bajo stock mínimo
  router.get('/alerts/low-stock', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const alerts = await inventoryService.getLowStockAlerts(tenantId, req.query.locationId);
      res.json(alerts);
    } catch (err) {
      res.status(500).json({ error: err.message, code: 'INVENTORY_ERROR' });
    }
  });

  // ==========================================
  // TOMA FÍSICA DE INVENTARIO (BASE Y PRO - REM-P2-03)
  // ==========================================

  // GET /api/inventory/physical-sessions - Listar sesiones
  router.get('/physical-sessions', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { limit = 20, offset = 0 } = req.query;
      const sessions = await getPhysicalService().listSessions({ tenantId, limit, offset });
      res.json(sessions);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message, code: err.code || 'PHYSICAL_INVENTORY_ERROR' });
    }
  });

  // POST /api/inventory/physical-sessions - Crear nueva sesión de toma física
  router.post('/physical-sessions', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { branch_id, location_id, notes } = req.body || {};
      const result = await getPhysicalService().createSession({
        tenantId,
        branchId: branch_id,
        locationId: location_id,
        notes,
        userId: req.auth?.userId || req.auth?.id
      });
      res.status(201).json(result);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message, code: err.code || 'PHYSICAL_INVENTORY_ERROR' });
    }
  });

  // GET /api/inventory/physical-sessions/:id - Detalle y productos de sesión
  router.get('/physical-sessions/:id', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const result = await getPhysicalService().getSession({ tenantId, sessionId: req.params.id });
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message, code: err.code || 'PHYSICAL_INVENTORY_ERROR' });
    }
  });

  // PUT /api/inventory/physical-sessions/:id/items - Registrar conteo físico
  router.put('/physical-sessions/:id/items', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { items } = req.body || {};
      const result = await getPhysicalService().recordCounts({
        tenantId,
        sessionId: req.params.id,
        items
      });
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message, code: err.code || 'PHYSICAL_INVENTORY_ERROR' });
    }
  });

  // POST /api/inventory/physical-sessions/:id/post - Publicar y ajustar inventario atómicamente
  router.post('/physical-sessions/:id/post', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const result = await getPhysicalService().postSession({
        tenantId,
        sessionId: req.params.id,
        userId: req.auth?.userId || req.auth?.id
      });
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message, code: err.code || 'PHYSICAL_INVENTORY_ERROR' });
    }
  });

  // POST /api/inventory/physical-sessions/:id/cancel - Cancelar sesión
  router.post('/physical-sessions/:id/cancel', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const result = await getPhysicalService().cancelSession({
        tenantId,
        sessionId: req.params.id,
        userId: req.auth?.userId || req.auth?.id
      });
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message, code: err.code || 'PHYSICAL_INVENTORY_ERROR' });
    }
  });

  // ==========================================
  // RUTAS PLAN PRO (INVENTORY AVANZADO)
  // ==========================================

  const requirePro = requirePlanFeature('inventory_advanced');

  // 10. GET /api/inventory/locations - Listar almacenes/ubicaciones
  router.get('/locations', requirePro, async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const locations = await inventoryService.listLocations(tenantId);
      res.json(locations);
    } catch (err) {
      res.status(500).json({ error: err.message, code: 'INVENTORY_ERROR' });
    }
  });

  // 11. POST /api/inventory/locations - Crear almacén/ubicación
  router.post('/locations', requirePro, async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { tenant_id: _ignored, ...locationData } = req.body;
      const location = await inventoryService.createLocation(tenantId, locationData);
      res.status(201).json(location);
    } catch (err) {
      res.status(500).json({ error: err.message, code: 'INVENTORY_ERROR' });
    }
  });

  // 12. GET /api/inventory/suppliers - Listar proveedores
  router.get('/suppliers', requirePro, async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const suppliers = await purchaseService.listSuppliers(tenantId, req.query);
      res.json(suppliers);
    } catch (err) {
      res.status(500).json({ error: err.message, code: 'INVENTORY_ERROR' });
    }
  });

  // 13. POST /api/inventory/suppliers - Crear proveedor
  router.post('/suppliers', requirePro, async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { tenant_id: _ignored, ...supplierData } = req.body;
      const supplier = await purchaseService.createSupplier(tenantId, supplierData);
      res.status(201).json(supplier);
    } catch (err) {
      res.status(500).json({ error: err.message, code: 'INVENTORY_ERROR' });
    }
  });

  // 14. GET /api/inventory/purchase-orders - Listar órdenes de compra
  router.get('/purchase-orders', requirePro, async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const orders = await purchaseService.listPurchaseOrders(tenantId, req.query);
      res.json(orders);
    } catch (err) {
      res.status(500).json({ error: err.message, code: 'INVENTORY_ERROR' });
    }
  });

  // 15. POST /api/inventory/purchase-orders - Crear orden de compra
  router.post('/purchase-orders', requirePro, async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { items, tenant_id: _ignored, ...orderData } = req.body;
      const order = await purchaseService.createPurchaseOrder(tenantId, orderData, items);
      res.status(201).json(order);
    } catch (err) {
      if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message, code: 'NOT_FOUND' });
      res.status(400).json({ error: err.message, code: 'VALIDATION_ERROR' });
    }
  });

  // 16. POST /api/inventory/purchase-orders/:id/approve - Aprobar orden de compra
  router.post('/purchase-orders/:id/approve', requirePro, async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const approved = await purchaseService.approvePurchaseOrder(tenantId, req.params.id, {
        userId: req.user?.id || null
      });
      res.json({ success: true, order: approved });
    } catch (err) {
      if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message, code: 'NOT_FOUND' });
      res.status(400).json({ error: err.message, code: 'OPERATION_ERROR' });
    }
  });

  // 17. POST /api/inventory/purchase-orders/:id/receive - Recepción parcial o total de compra
  router.post('/purchase-orders/:id/receive', requirePro, async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { itemsToReceive, idempotencyKey } = req.body;
      const result = await purchaseService.receivePurchaseOrder(tenantId, req.params.id, {
        itemsToReceive,
        idempotencyKey,
        userId: req.user?.id || null,
        userName: req.user?.name || 'Recepción'
      });
      res.json(result);
    } catch (err) {
      if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message, code: 'NOT_FOUND' });
      res.status(400).json({ error: err.message, code: 'OPERATION_ERROR' });
    }
  });

  // 18. GET /api/inventory/transfers - Listar transferencias
  router.get('/transfers', requirePro, async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const transfers = await transferService.listTransfers(tenantId, req.query);
      res.json(transfers);
    } catch (err) {
      res.status(500).json({ error: err.message, code: 'INVENTORY_ERROR' });
    }
  });

  // 19. POST /api/inventory/transfers - Solicitar transferencia entre almacenes
  router.post('/transfers', requirePro, async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { items, tenant_id: _ignored, ...transferData } = req.body;
      const transfer = await transferService.requestTransfer(tenantId, transferData, items);
      res.status(201).json(transfer);
    } catch (err) {
      if (err.code === 'SAME_LOCATION_TRANSFER') {
        return res.status(400).json({ error: err.message, code: 'SAME_LOCATION_TRANSFER' });
      }
      if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message, code: 'NOT_FOUND' });
      res.status(400).json({ error: err.message, code: 'VALIDATION_ERROR' });
    }
  });

  // 20. POST /api/inventory/transfers/:id/approve - Aprobar transferencia
  router.post('/transfers/:id/approve', requirePro, async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const approved = await transferService.approveTransfer(tenantId, req.params.id, {
        userId: req.user?.id || null
      });
      res.json({ success: true, transfer: approved });
    } catch (err) {
      if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message, code: 'NOT_FOUND' });
      res.status(400).json({ error: err.message, code: 'OPERATION_ERROR' });
    }
  });

  // 21. POST /api/inventory/transfers/:id/dispatch - Despachar transferencia (Salida de stock)
  router.post('/transfers/:id/dispatch', requirePro, async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { idempotencyKey } = req.body;
      const result = await transferService.dispatchTransfer(tenantId, req.params.id, {
        idempotencyKey,
        userId: req.user?.id || null,
        userName: req.user?.name || 'Despacho'
      });
      res.json(result);
    } catch (err) {
      if (err.code === 'INSUFFICIENT_STOCK') {
        return res.status(400).json({ error: err.message, code: 'INSUFFICIENT_STOCK' });
      }
      if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message, code: 'NOT_FOUND' });
      res.status(400).json({ error: err.message, code: 'OPERATION_ERROR' });
    }
  });

  // 22. POST /api/inventory/transfers/:id/receive - Recibir transferencia (Entrada de stock)
  router.post('/transfers/:id/receive', requirePro, async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { idempotencyKey } = req.body;
      const result = await transferService.receiveTransfer(tenantId, req.params.id, {
        idempotencyKey,
        userId: req.user?.id || null,
        userName: req.user?.name || 'Recepción'
      });
      res.json(result);
    } catch (err) {
      if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message, code: 'NOT_FOUND' });
      res.status(400).json({ error: err.message, code: 'OPERATION_ERROR' });
    }
  });

  // 23. GET /api/inventory/reports/valuation - Reporte de Valorización
  router.get('/reports/valuation', requirePro, async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const report = await inventoryService.getValuationReport(tenantId);
      res.json(report);
    } catch (err) {
      res.status(500).json({ error: err.message, code: 'INVENTORY_ERROR' });
    }
  });

  return router;
}

module.exports = { createInventoryRouter };

