/**
 * Servicio de Inventario y Control de Existencias (Base y Pro)
 * Centraliza las reglas de negocio, libro mayor, idempotencia y costo promedio.
 */

class InventoryService {
  constructor(optionsOrRepo, purchaseRepo = null, transferRepo = null) {
    if (optionsOrRepo && typeof optionsOrRepo === 'object' && optionsOrRepo.inventoryRepo) {
      this.repo = optionsOrRepo.inventoryRepo;
      this.purchaseRepo = optionsOrRepo.purchaseRepo || null;
      this.transferRepo = optionsOrRepo.transferRepo || null;
    } else {
      this.repo = optionsOrRepo;
      this.purchaseRepo = purchaseRepo;
      this.transferRepo = transferRepo;
    }
  }

  // === CÁLCULO DE COSTO PROMEDIO PONDERADO ===
  calculateWeightedAverageCost(currentQty, currentAvgCost, incomingQty, incomingCost) {
    const curQ = Number(currentQty) || 0;
    const curC = Number(currentAvgCost) || 0;
    const inQ = Number(incomingQty) || 0;
    const inC = Number(incomingCost) || 0;

    const totalQty = curQ + inQ;
    if (totalQty <= 0) {
      return inC > 0 ? inC : curC;
    }

    const totalValue = (curQ * curC) + (inQ * inC);
    const avg = totalValue / totalQty;
    return Math.round(avg * 10000) / 10000;
  }

  // === PRODUCTOS ===
  async createProduct(tenantId, productData) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    return this.repo.createProduct(tenantId, productData);
  }

  async updateProduct(tenantId, productId, updateData) {
    if (!tenantId || !productId) throw new Error('tenant_id y productId son requeridos');
    const existing = await this.repo.getProductById(tenantId, productId);
    if (!existing) {
      const err = new Error('Producto no encontrado');
      err.code = 'NOT_FOUND';
      throw err;
    }
    return this.repo.updateProduct(tenantId, productId, updateData);
  }

  async getProduct(tenantId, productId) {
    if (!tenantId || !productId) return null;
    return this.repo.getProductById(tenantId, productId);
  }

  async listProducts(tenantId, filters = {}) {
    if (!tenantId) return [];
    return this.repo.listProducts(tenantId, filters);
  }

  // === UBICACIONES Y ALMACENES ===
  async getDefaultLocation(tenantId, salonId = null) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    return this.repo.getOrCreateDefaultLocation(tenantId, salonId);
  }

  async listLocations(tenantId) {
    if (!tenantId) return [];
    return this.repo.listLocations(tenantId);
  }

  async createLocation(tenantId, locationData) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    return this.repo.createLocation(tenantId, locationData);
  }

  // === EXISTENCIAS ===
  async getStock(tenantId, productId, locationId = null) {
    if (!tenantId || !productId) throw new Error('tenant_id y productId son requeridos');
    let locId = locationId;
    if (!locId) {
      const defLoc = await this.getDefaultLocation(tenantId);
      locId = defLoc.id;
    }
    return this.repo.getStock(tenantId, productId, locId);
  }

  async listStock(tenantId, filters = {}) {
    if (!tenantId) return [];
    return this.repo.listStock(tenantId, filters);
  }

  async getLowStockAlerts(tenantId, locationId = null) {
    if (!tenantId) return [];
    return this.repo.getLowStockAlerts(tenantId, locationId);
  }

  async getValuationReport(tenantId) {
    if (!tenantId) return [];
    return this.repo.getValuationReport(tenantId);
  }

  // === ENTRADA INICIAL DE MERCANCÍA ===
  async receiveInitialStock(tenantId, { productId, locationId = null, quantity, unitCost = 0, userId = null, userName = null, reason = 'Entrada inicial de inventario' }) {
    if (!tenantId || !productId) throw new Error('Parámetros requeridos faltantes');
    const qty = Number(quantity);
    if (qty <= 0) throw new Error('La cantidad inicial debe ser mayor a cero');

    const product = await this.repo.getProductById(tenantId, productId);
    if (!product) {
      const err = new Error('Producto no encontrado');
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (product.item_type && String(product.item_type).toUpperCase() !== 'PRODUCTO') {
      const err = new Error('Solo se puede ajustar stock de ítems tipo PRODUCTO del Catálogo');
      err.code = 'INVALID_ITEM_TYPE';
      throw err;
    }

    let locId = locationId;
    if (!locId) {
      const defLoc = await this.getDefaultLocation(tenantId);
      locId = defLoc.id;
    }

    const currentStock = await this.repo.getStock(tenantId, productId, locId);
    const curQty = Number(currentStock.quantity) || 0;
    const curAvgCost = Number(currentStock.average_cost) || 0;
    const newQty = curQty + qty;
    const newAvgCost = this.calculateWeightedAverageCost(curQty, curAvgCost, qty, unitCost);

    const movement = await this.repo.recordMovement(tenantId, {
      product_id: productId,
      location_id: locId,
      movement_type: 'INITIAL',
      quantity: qty,
      unit_cost: unitCost,
      total_cost: qty * unitCost,
      balance_after: newQty,
      reference_type: 'INITIAL_STOCK',
      reference_id: null,
      idempotency_key: `init:${productId}:${locId}:${Date.now()}`,
      reason,
      user_id: userId,
      user_name: userName
    });

    await this.repo.updateStockBalance(tenantId, productId, locId, newQty, newAvgCost);

    return {
      movement,
      current_stock: newQty,
      average_cost: newAvgCost
    };
  }

  // === DESCUENTO AUTOMÁTICO POR VENTA (POS CHECKOUT) ===
  async recordSaleDeduction(tenantId, { productId, locationId = null, quantity, visitId, lineId = null, userId = null, userName = null }) {
    if (!tenantId || !productId) throw new Error('Parámetros requeridos faltantes');
    const qty = Number(quantity);
    if (qty <= 0) return { skipped: true, reason: 'Cantidad cero o negativa' };

    const product = await this.repo.getProductById(tenantId, productId);
    if (!product) {
      const err = new Error('Producto no encontrado en inventario');
      err.code = 'NOT_FOUND';
      throw err;
    }

    // Si el producto no controla stock, se ignora el movimiento de inventario sin error
    if (!product.track_stock) {
      return { skipped: true, track_stock: false, reason: 'Producto sin control de stock activado' };
    }

    let locId = locationId;
    if (!locId) {
      const defLoc = await this.getDefaultLocation(tenantId);
      locId = defLoc.id;
    }

    // Atomic deduction with row-level locking (SELECT ... FOR UPDATE) and auto-retry
    return this.repo.executeAtomicSaleDeduction(tenantId, {
      productId,
      locationId: locId,
      quantity: qty,
      visitId,
      lineId,
      userId,
      userName
    });
  }

  // === REVERSIÓN POR ANULACIÓN DE VENTA (POS VOID) ===
  async recordSaleVoid(tenantId, { productId, locationId = null, quantity, visitId, lineId = null, userId = null, userName = null, reason = 'Anulación de venta POS' }) {
    if (!tenantId || !productId) throw new Error('Parámetros requeridos faltantes');
    const qty = Number(quantity);
    if (qty <= 0) return { skipped: true };

    const product = await this.repo.getProductById(tenantId, productId);
    if (!product || !product.track_stock) {
      return { skipped: true, reason: 'Producto no encontrado o sin control de stock' };
    }

    let locId = locationId;
    if (!locId) {
      const defLoc = await this.getDefaultLocation(tenantId);
      locId = defLoc.id;
    }

    // Atomic reversal with row-level locking and idempotency protection
    return this.repo.executeAtomicSaleVoid(tenantId, {
      productId,
      locationId: locId,
      quantity: qty,
      visitId,
      lineId,
      userId,
      userName,
      reason
    });
  }

  // === AJUSTES DE STOCK (IN/OUT) CON AUTORIZACIÓN ===
  async makeAdjustment(tenantId, { productId, locationId = null, quantity, adjustmentType, reason, userId = null, userName = null, userRole = null }) {
    if (!tenantId || !productId || !adjustmentType) {
      throw new Error('Parámetros de ajuste incompletos');
    }

    // Validación de roles de autorización
    const roleLower = String(userRole || '').toLowerCase();
    if (roleLower !== 'admin' && roleLower !== 'superadmin' && roleLower !== 'administrador' && roleLower !== 'owner' && roleLower !== 'propietario') {
      const err = new Error('Solo los administradores tienen permiso para realizar ajustes manuales de inventario');
      err.code = 'UNAUTHORIZED_ROLE';
      throw err;
    }

    const qty = Math.abs(Number(quantity) || 0);
    if (qty <= 0) throw new Error('La cantidad de ajuste debe ser mayor a cero');

    const product = await this.repo.getProductById(tenantId, productId);
    if (!product) {
      const err = new Error('Producto no encontrado');
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (product.item_type && String(product.item_type).toUpperCase() !== 'PRODUCTO') {
      const err = new Error('Solo se puede ajustar stock de ítems tipo PRODUCTO del Catálogo');
      err.code = 'INVALID_ITEM_TYPE';
      throw err;
    }

    let locId = locationId;
    if (!locId) {
      const defLoc = await this.getDefaultLocation(tenantId);
      locId = defLoc.id;
    }

    if (this.repo.pool && typeof this.repo.executeAtomicAdjustment === 'function') {
      return this.repo.executeAtomicAdjustment(tenantId, {
        productId,
        locationId: locId,
        quantity: qty,
        adjustmentType,
        reason,
        userId,
        userName,
        productCost: Number(product.cost ?? product.costo ?? 0) || 0
      });
    }

    const currentStock = await this.repo.getStock(tenantId, productId, locId);
    const curQty = Number(currentStock.quantity) || 0;
    let signedQty = 0;
    let newQty = 0;

    if (adjustmentType === 'ADJUSTMENT_IN') {
      signedQty = qty;
      newQty = curQty + qty;
    } else if (adjustmentType === 'ADJUSTMENT_OUT') {
      if (curQty < qty) {
        const err = new Error(`Stock insuficiente para ajuste de salida. Actual: ${curQty}, Solicitado: ${qty}`);
        err.code = 'INSUFFICIENT_STOCK';
        throw err;
      }
      signedQty = -qty;
      newQty = curQty - qty;
    } else {
      throw new Error(`Tipo de ajuste inválido: ${adjustmentType}. Use ADJUSTMENT_IN o ADJUSTMENT_OUT.`);
    }

    const movement = await this.repo.recordMovement(tenantId, {
      product_id: productId,
      location_id: locId,
      movement_type: adjustmentType,
      quantity: signedQty,
      unit_cost: currentStock.average_cost,
      total_cost: qty * currentStock.average_cost,
      balance_after: newQty,
      reference_type: 'MANUAL_ADJUSTMENT',
      reference_id: null,
      idempotency_key: `adj:${productId}:${locId}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`,
      reason: reason || 'Ajuste manual de inventario',
      user_id: userId,
      user_name: userName
    });

    await this.repo.updateStockBalance(tenantId, productId, locId, newQty, currentStock.average_cost);

    return {
      success: true,
      movement,
      previous_stock: currentStock.quantity,
      new_stock: newQty
    };
  }

  async listMovements(tenantId, filters = {}) {
    if (!tenantId) return [];
    return this.repo.listMovements(tenantId, filters);
  }
}

module.exports = { InventoryService };

