/**
 * Repositorio In-Memory (Fake) para Pruebas Unitarias TDD de Inventario (Fase 2B)
 * Reproduce fielmente las restricciones, unicidad multi-tenant, libro mayor inmutable,
 * idempotencia y cálculo de costo promedio ponderado sin tocar PostgreSQL.
 */

class InMemoryInventoryRepository {
  constructor() {
    this.products = new Map(); // `${tenantId}:${productId}` -> product
    this.locations = new Map(); // `${tenantId}:${locationId}` -> location
    this.stock = new Map(); // `${tenantId}:${productId}:${locationId}` -> { quantity, average_cost, ... }
    this.movements = []; // Array of movements
    this.suppliers = new Map(); // `${tenantId}:${supplierId}` -> supplier
    this.purchaseOrders = new Map(); // `${tenantId}:${orderId}` -> order
    this.purchaseOrderItems = new Map(); // `${tenantId}:${itemId}` -> item
    this.transfers = new Map(); // `${tenantId}:${transferId}` -> transfer
    this.transferItems = new Map(); // `${tenantId}:${itemId}` -> item
  }

  _makeId(prefix = 'id') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // === PRODUCTOS ===
  async createProduct(tenantId, productData) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    const {
      sku, barcode, name, description, category, unit_of_measure,
      sale_price, cost, tax_rate, min_stock, track_stock, is_active
    } = productData;

    if (!sku || !name) throw new Error('sku y name son requeridos');

    const numSalePrice = Number(sale_price) || 0;
    const numCost = Number(cost) || 0;
    const numMinStock = Number(min_stock) || 0;

    if (numSalePrice < 0 || numCost < 0 || numMinStock < 0) {
      const err = new Error('Precio, costo y stock mínimo no pueden ser negativos');
      err.code = 'CHECK_VIOLATION';
      throw err;
    }

    // Unicidad de SKU por tenant
    for (const p of this.products.values()) {
      if (p.tenant_id === String(tenantId) && p.sku.toLowerCase() === sku.trim().toLowerCase()) {
        const err = new Error(`El SKU "${sku}" ya existe en este salón`);
        err.code = 'UNIQUE_SKU_VIOLATION';
        throw err;
      }
    }

    // Unicidad de Barcode por tenant (si no es nulo)
    if (barcode && barcode.trim()) {
      for (const p of this.products.values()) {
        if (p.tenant_id === String(tenantId) && p.barcode && p.barcode.trim().toLowerCase() === barcode.trim().toLowerCase()) {
          const err = new Error(`El código de barras "${barcode}" ya existe en este salón`);
          err.code = 'UNIQUE_BARCODE_VIOLATION';
          throw err;
        }
      }
    }

    const id = productData.id || this._makeId('prod');
    const record = {
      id,
      tenant_id: String(tenantId),
      sku: sku.trim(),
      barcode: barcode ? barcode.trim() : null,
      name: name.trim(),
      description: description || null,
      category: category || 'General',
      unit_of_measure: unit_of_measure || 'unit',
      sale_price: numSalePrice,
      cost: numCost,
      tax_rate: Number(tax_rate ?? 0.18),
      min_stock: numMinStock,
      track_stock: track_stock !== false,
      is_active: is_active !== false,
      created_at: new Date(),
      updated_at: new Date()
    };

    this.products.set(`${tenantId}:${id}`, record);
    return { ...record };
  }

  async updateProduct(tenantId, productId, updateData) {
    if (!tenantId || !productId) throw new Error('tenant_id y productId son requeridos');
    const key = `${tenantId}:${productId}`;
    const existing = this.products.get(key);
    if (!existing) return null;

    if (updateData.sale_price !== undefined && Number(updateData.sale_price) < 0) {
      throw new Error('El precio de venta no puede ser negativo');
    }
    if (updateData.cost !== undefined && Number(updateData.cost) < 0) {
      throw new Error('El costo no puede ser negativo');
    }

    if (updateData.barcode && updateData.barcode.trim()) {
      for (const p of this.products.values()) {
        if (p.tenant_id === String(tenantId) && p.id !== productId && p.barcode && p.barcode.trim().toLowerCase() === updateData.barcode.trim().toLowerCase()) {
          const err = new Error(`El código de barras ya existe en este salón`);
          err.code = 'UNIQUE_BARCODE_VIOLATION';
          throw err;
        }
      }
    }

    const updated = {
      ...existing,
      ...updateData,
      updated_at: new Date()
    };
    this.products.set(key, updated);
    return { ...updated };
  }

  async getProductById(tenantId, productId) {
    if (!tenantId || !productId) return null;
    const item = this.products.get(`${tenantId}:${productId}`);
    return item ? { ...item } : null;
  }

  async getProductBySku(tenantId, sku) {
    if (!tenantId || !sku) return null;
    for (const p of this.products.values()) {
      if (p.tenant_id === String(tenantId) && p.sku.toLowerCase() === sku.trim().toLowerCase()) {
        return { ...p };
      }
    }
    return null;
  }

  async getProductByBarcode(tenantId, barcode) {
    if (!tenantId || !barcode) return null;
    for (const p of this.products.values()) {
      if (p.tenant_id === String(tenantId) && p.barcode && p.barcode.trim().toLowerCase() === barcode.trim().toLowerCase()) {
        return { ...p };
      }
    }
    return null;
  }

  async listProducts(tenantId, { search, category, activeOnly, limit = 50, offset = 0 } = {}) {
    if (!tenantId) return [];
    let list = Array.from(this.products.values()).filter(p => p.tenant_id === String(tenantId));

    if (activeOnly) list = list.filter(p => p.is_active);
    if (category && category !== 'Todas') list = list.filter(p => p.category === category);
    if (search) {
      const term = search.toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(term) ||
        p.sku.toLowerCase().includes(term) ||
        (p.barcode && p.barcode.toLowerCase().includes(term))
      );
    }
    return list.slice(offset, offset + limit);
  }

  // === UBICACIONES ===
  async getOrCreateDefaultLocation(tenantId, salonId = null) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    for (const loc of this.locations.values()) {
      if (loc.tenant_id === String(tenantId) && loc.is_default) {
        return { ...loc };
      }
    }

    const id = this._makeId('loc');
    const defaultLoc = {
      id,
      tenant_id: String(tenantId),
      salon_id: salonId || 1,
      name: 'Almacén Principal',
      code: 'LOC-MAIN',
      type: 'STORE',
      is_default: true,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date()
    };
    this.locations.set(`${tenantId}:${id}`, defaultLoc);
    return { ...defaultLoc };
  }

  async getLocationById(tenantId, locationId) {
    if (!tenantId || !locationId) return null;
    const loc = this.locations.get(`${tenantId}:${locationId}`);
    return loc ? { ...loc } : null;
  }

  async listLocations(tenantId) {
    if (!tenantId) return [];
    return Array.from(this.locations.values())
      .filter(l => l.tenant_id === String(tenantId) && l.is_active)
      .map(l => ({ ...l }));
  }

  async createLocation(tenantId, locationData) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    const { name, code, type, salon_id, is_default } = locationData;
    if (!name) throw new Error('name es requerido');

    // Check code uniqueness
    if (code) {
      for (const l of this.locations.values()) {
        if (l.tenant_id === String(tenantId) && l.code && l.code.toLowerCase() === code.trim().toLowerCase()) {
          throw new Error(`El código de ubicación "${code}" ya existe`);
        }
      }
    }

    const id = locationData.id || this._makeId('loc');
    const record = {
      id,
      tenant_id: String(tenantId),
      salon_id: salon_id || null,
      name: name.trim(),
      code: code ? code.trim() : null,
      type: type || 'STORE',
      is_default: Boolean(is_default),
      is_active: true,
      created_at: new Date(),
      updated_at: new Date()
    };
    this.locations.set(`${tenantId}:${id}`, record);
    return { ...record };
  }

  // === EXISTENCIAS & STOCK ===
  async getStock(tenantId, productId, locationId) {
    if (!tenantId || !productId || !locationId) {
      return { tenant_id: tenantId, product_id: productId, location_id: locationId, quantity: 0, average_cost: 0 };
    }
    const key = `${tenantId}:${productId}:${locationId}`;
    const record = this.stock.get(key);
    if (!record) {
      return { tenant_id: String(tenantId), product_id: String(productId), location_id: String(locationId), quantity: 0, average_cost: 0 };
    }
    return { ...record };
  }

  async updateStockBalance(tenantId, productId, locationId, newQuantity, newAvgCost) {
    if (!tenantId || !productId || !locationId) throw new Error('Parámetros de stock faltantes');
    if (Number(newQuantity) < 0) {
      const err = new Error('Stock no puede quedar negativo');
      err.code = 'INSUFFICIENT_STOCK';
      throw err;
    }

    const key = `${tenantId}:${productId}:${locationId}`;
    const existing = this.stock.get(key);
    const record = {
      id: existing?.id || this._makeId('stk'),
      tenant_id: String(tenantId),
      product_id: String(productId),
      location_id: String(locationId),
      quantity: Number(newQuantity),
      average_cost: Number(newAvgCost) || 0,
      last_movement_at: new Date(),
      updated_at: new Date()
    };
    this.stock.set(key, record);
    return { ...record };
  }

  async listStock(tenantId, { locationId, lowStockOnly = false, limit = 100, offset = 0 } = {}) {
    if (!tenantId) return [];
    let list = [];
    for (const [key, s] of this.stock.entries()) {
      if (s.tenant_id === String(tenantId)) {
        if (locationId && s.location_id !== String(locationId)) continue;
        const prod = this.products.get(`${tenantId}:${s.product_id}`);
        const loc = this.locations.get(`${tenantId}:${s.location_id}`);
        if (lowStockOnly && prod && s.quantity > prod.min_stock) continue;

        list.push({
          ...s,
          sku: prod?.sku || '',
          product_name: prod?.name || 'Desconocido',
          category: prod?.category || 'General',
          unit_of_measure: prod?.unit_of_measure || 'unit',
          min_stock: prod?.min_stock || 0,
          sale_price: prod?.sale_price || 0,
          location_name: loc?.name || 'Almacén'
        });
      }
    }
    return list.slice(offset, offset + limit);
  }

  // === LEDGER INMUTABLE DE MOVIMIENTOS ===
  async getMovementByIdempotencyKey(tenantId, idempotencyKey) {
    if (!tenantId || !idempotencyKey) return null;
    const found = this.movements.find(m =>
      m.tenant_id === String(tenantId) && m.idempotency_key === String(idempotencyKey)
    );
    return found ? { ...found } : null;
  }

  async recordMovement(tenantId, movementData) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    const {
      product_id, location_id, movement_type, quantity, unit_cost, total_cost,
      balance_after, reference_type, reference_id, idempotency_key, reason, user_id, user_name
    } = movementData;

    if (!product_id || !location_id || !movement_type || Number(quantity) === 0) {
      throw new Error('Datos de movimiento incompletos o cantidad cero');
    }

    if (idempotency_key) {
      const existing = await this.getMovementByIdempotencyKey(tenantId, idempotency_key);
      if (existing) {
        return { ...existing, is_duplicate: true };
      }
    }

    const record = {
      id: this._makeId('mov'),
      tenant_id: String(tenantId),
      product_id: String(product_id),
      location_id: String(location_id),
      movement_type,
      quantity: Number(quantity),
      unit_cost: Number(unit_cost) || 0,
      total_cost: Number(total_cost) || 0,
      balance_after: Number(balance_after) || 0,
      reference_type: reference_type || null,
      reference_id: reference_id || null,
      idempotency_key: idempotency_key || null,
      reason: reason || null,
      user_id: user_id || null,
      user_name: user_name || 'Sistema',
      created_at: new Date()
    };

    this.movements.push(record);
    return { ...record };
  }

  async listMovements(tenantId, { productId, locationId, movementType, limit = 50, offset = 0 } = {}) {
    if (!tenantId) return [];
    let list = this.movements.filter(m => m.tenant_id === String(tenantId));

    if (productId) list = list.filter(m => m.product_id === String(productId));
    if (locationId) list = list.filter(m => m.location_id === String(locationId));
    if (movementType) list = list.filter(m => m.movement_type === movementType);

    const mapped = list.map(m => {
      const prod = this.products.get(`${tenantId}:${m.product_id}`);
      const loc = this.locations.get(`${tenantId}:${m.location_id}`);
      return {
        ...m,
        product_name: prod?.name || '',
        sku: prod?.sku || '',
        location_name: loc?.name || ''
      };
    });

    return mapped.slice().reverse().slice(offset, offset + limit);
  }

  async getLowStockAlerts(tenantId, locationId = null) {
    if (!tenantId) return [];
    const alerts = [];
    for (const p of this.products.values()) {
      if (p.tenant_id === String(tenantId) && p.track_stock && p.is_active) {
        let totalQty = 0;
        let lastLoc = null;
        for (const s of this.stock.values()) {
          if (s.tenant_id === String(tenantId) && s.product_id === p.id) {
            if (locationId && s.location_id !== String(locationId)) continue;
            totalQty += s.quantity;
            lastLoc = this.locations.get(`${tenantId}:${s.location_id}`);
          }
        }
        if (totalQty <= p.min_stock) {
          alerts.push({
            product_id: p.id,
            sku: p.sku,
            product_name: p.name,
            category: p.category,
            min_stock: p.min_stock,
            current_stock: totalQty,
            location_name: lastLoc?.name || 'Almacén Principal',
            location_id: lastLoc?.id || null
          });
        }
      }
    }
    return alerts;
  }

  async getValuationReport(tenantId) {
    if (!tenantId) return [];
    const rows = [];
    for (const s of this.stock.values()) {
      if (s.tenant_id === String(tenantId) && s.quantity > 0) {
        const prod = this.products.get(`${tenantId}:${s.product_id}`);
        const loc = this.locations.get(`${tenantId}:${s.location_id}`);
        if (prod) {
          rows.push({
            product_id: prod.id,
            sku: prod.sku,
            product_name: prod.name,
            category: prod.category,
            location_id: s.location_id,
            location_name: loc?.name || 'Almacén',
            quantity: s.quantity,
            average_cost: s.average_cost,
            total_valuation: s.quantity * s.average_cost,
            sale_price: prod.sale_price,
            total_potential_revenue: s.quantity * prod.sale_price
          });
        }
      }
    }
    return rows.sort((a, b) => b.total_valuation - a.total_valuation);
  }

  // === PROVEEDORES (PLAN PRO) ===
  async createSupplier(tenantId, supplierData) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    const { name, rnc_tax_id, contact_name, phone, email, address, is_active } = supplierData;
    if (!name) throw new Error('name de proveedor es requerido');

    if (rnc_tax_id && rnc_tax_id.trim()) {
      for (const s of this.suppliers.values()) {
        if (s.tenant_id === String(tenantId) && s.rnc_tax_id && s.rnc_tax_id.toLowerCase() === rnc_tax_id.trim().toLowerCase()) {
          throw new Error(`El RNC "${rnc_tax_id}" ya está registrado en este salón`);
        }
      }
    }

    const id = supplierData.id || this._makeId('sup');
    const record = {
      id,
      tenant_id: String(tenantId),
      name: name.trim(),
      rnc_tax_id: rnc_tax_id ? rnc_tax_id.trim() : null,
      contact_name: contact_name || null,
      phone: phone || null,
      email: email || null,
      address: address || null,
      is_active: is_active !== false,
      created_at: new Date(),
      updated_at: new Date()
    };
    this.suppliers.set(`${tenantId}:${id}`, record);
    return { ...record };
  }

  async getSupplierById(tenantId, supplierId) {
    if (!tenantId || !supplierId) return null;
    const sup = this.suppliers.get(`${tenantId}:${supplierId}`);
    return sup ? { ...sup } : null;
  }

  async listSuppliers(tenantId, { activeOnly = true } = {}) {
    if (!tenantId) return [];
    let list = Array.from(this.suppliers.values()).filter(s => s.tenant_id === String(tenantId));
    if (activeOnly) list = list.filter(s => s.is_active);
    return list.map(s => ({ ...s }));
  }

  // === ÓRDENES DE COMPRA (PLAN PRO) ===
  async createPurchaseOrder(tenantId, orderData, items = []) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    const { supplier_id, location_id, order_number, notes, created_by } = orderData;
    if (!supplier_id || !location_id || !order_number) {
      throw new Error('supplier_id, location_id y order_number son requeridos');
    }

    // Verify order_number uniqueness per tenant
    for (const o of this.purchaseOrders.values()) {
      if (o.tenant_id === String(tenantId) && o.order_number.toLowerCase() === order_number.trim().toLowerCase()) {
        throw new Error(`La orden de compra "${order_number}" ya existe en este salón`);
      }
    }

    let totalAmount = 0;
    for (const it of items) {
      totalAmount += (Number(it.quantity_ordered) || 0) * (Number(it.unit_cost) || 0);
    }

    const id = orderData.id || this._makeId('po');
    const order = {
      id,
      tenant_id: String(tenantId),
      supplier_id: String(supplier_id),
      location_id: String(location_id),
      order_number: order_number.trim(),
      status: 'DRAFT',
      total_amount: totalAmount,
      notes: notes || null,
      created_by: created_by || null,
      approved_by: null,
      approved_at: null,
      created_at: new Date(),
      updated_at: new Date()
    };
    this.purchaseOrders.set(`${tenantId}:${id}`, order);

    const insertedItems = [];
    for (const it of items) {
      const itemId = it.id || this._makeId('poi');
      const itemRecord = {
        id: itemId,
        tenant_id: String(tenantId),
        purchase_order_id: id,
        product_id: String(it.product_id),
        quantity_ordered: Number(it.quantity_ordered),
        quantity_received: 0,
        unit_cost: Number(it.unit_cost) || 0,
        total_cost: (Number(it.quantity_ordered) || 0) * (Number(it.unit_cost) || 0)
      };
      this.purchaseOrderItems.set(`${tenantId}:${itemId}`, itemRecord);
      insertedItems.push(itemRecord);
    }

    return { ...order, items: insertedItems };
  }

  async getPurchaseOrderById(tenantId, orderId) {
    if (!tenantId || !orderId) return null;
    const order = this.purchaseOrders.get(`${tenantId}:${orderId}`);
    if (!order) return null;

    const supplier = this.suppliers.get(`${tenantId}:${order.supplier_id}`);
    const location = this.locations.get(`${tenantId}:${order.location_id}`);

    const items = [];
    for (const it of this.purchaseOrderItems.values()) {
      if (it.tenant_id === String(tenantId) && it.purchase_order_id === String(orderId)) {
        const prod = this.products.get(`${tenantId}:${it.product_id}`);
        items.push({
          ...it,
          product_name: prod?.name || '',
          sku: prod?.sku || ''
        });
      }
    }

    return {
      ...order,
      supplier_name: supplier?.name || '',
      location_name: location?.name || '',
      items
    };
  }

  async listPurchaseOrders(tenantId, { status, supplierId } = {}) {
    if (!tenantId) return [];
    let list = Array.from(this.purchaseOrders.values()).filter(o => o.tenant_id === String(tenantId));
    if (status) list = list.filter(o => o.status === status);
    if (supplierId) list = list.filter(o => o.supplier_id === String(supplierId));

    return list.map(o => {
      const supplier = this.suppliers.get(`${tenantId}:${o.supplier_id}`);
      const location = this.locations.get(`${tenantId}:${o.location_id}`);
      return {
        ...o,
        supplier_name: supplier?.name || '',
        location_name: location?.name || ''
      };
    });
  }

  async updatePurchaseOrderStatus(tenantId, orderId, newStatus, { approvedBy = null, approvedAt = null } = {}) {
    if (!tenantId || !orderId) return null;
    const key = `${tenantId}:${orderId}`;
    const order = this.purchaseOrders.get(key);
    if (!order) return null;

    const updated = {
      ...order,
      status: newStatus,
      approved_by: approvedBy || order.approved_by,
      approved_at: approvedAt || order.approved_at,
      updated_at: new Date()
    };
    this.purchaseOrders.set(key, updated);
    return { ...updated };
  }

  async updatePurchaseOrderItemReceived(tenantId, itemId, quantityReceived) {
    if (!tenantId || !itemId) return null;
    const key = `${tenantId}:${itemId}`;
    const item = this.purchaseOrderItems.get(key);
    if (!item) return null;

    const updated = {
      ...item,
      quantity_received: item.quantity_received + Number(quantityReceived)
    };
    this.purchaseOrderItems.set(key, updated);
    return { ...updated };
  }

  // === TRANSFERENCIAS (PLAN PRO) ===
  async createTransfer(tenantId, transferData, items = []) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    const { transfer_number, source_location_id, destination_location_id, notes, requested_by } = transferData;

    if (!transfer_number || !source_location_id || !destination_location_id) {
      throw new Error('transfer_number, source_location_id y destination_location_id son requeridos');
    }

    if (String(source_location_id) === String(destination_location_id)) {
      const err = new Error('La ubicación de origen y destino no pueden ser iguales');
      err.code = 'SAME_LOCATION_TRANSFER';
      throw err;
    }

    // Verify transfer_number uniqueness
    for (const t of this.transfers.values()) {
      if (t.tenant_id === String(tenantId) && t.transfer_number.toLowerCase() === transfer_number.trim().toLowerCase()) {
        throw new Error(`La transferencia "${transfer_number}" ya existe`);
      }
    }

    const id = transferData.id || this._makeId('trf');
    const record = {
      id,
      tenant_id: String(tenantId),
      transfer_number: transfer_number.trim(),
      source_location_id: String(source_location_id),
      destination_location_id: String(destination_location_id),
      status: 'REQUESTED',
      notes: notes || null,
      requested_by: requested_by || null,
      dispatched_by: null,
      received_by: null,
      dispatched_at: null,
      received_at: null,
      created_at: new Date(),
      updated_at: new Date()
    };
    this.transfers.set(`${tenantId}:${id}`, record);

    const insertedItems = [];
    for (const it of items) {
      const itemId = it.id || this._makeId('trfi');
      const itemRecord = {
        id: itemId,
        tenant_id: String(tenantId),
        transfer_id: id,
        product_id: String(it.product_id),
        quantity_requested: Number(it.quantity_requested),
        quantity_transferred: 0
      };
      this.transferItems.set(`${tenantId}:${itemId}`, itemRecord);
      insertedItems.push(itemRecord);
    }

    return { ...record, items: insertedItems };
  }

  async getTransferById(tenantId, transferId) {
    if (!tenantId || !transferId) return null;
    const transfer = this.transfers.get(`${tenantId}:${transferId}`);
    if (!transfer) return null;

    const sourceLoc = this.locations.get(`${tenantId}:${transfer.source_location_id}`);
    const destLoc = this.locations.get(`${tenantId}:${transfer.destination_location_id}`);

    const items = [];
    for (const it of this.transferItems.values()) {
      if (it.tenant_id === String(tenantId) && it.transfer_id === String(transferId)) {
        const prod = this.products.get(`${tenantId}:${it.product_id}`);
        items.push({
          ...it,
          product_name: prod?.name || '',
          sku: prod?.sku || ''
        });
      }
    }

    return {
      ...transfer,
      source_location_name: sourceLoc?.name || '',
      destination_location_name: destLoc?.name || '',
      items
    };
  }

  async listTransfers(tenantId, { status, sourceLocationId, destinationLocationId } = {}) {
    if (!tenantId) return [];
    let list = Array.from(this.transfers.values()).filter(t => t.tenant_id === String(tenantId));
    if (status) list = list.filter(t => t.status === status);
    if (sourceLocationId) list = list.filter(t => t.source_location_id === String(sourceLocationId));
    if (destinationLocationId) list = list.filter(t => t.destination_location_id === String(destinationLocationId));

    return list.map(t => {
      const sourceLoc = this.locations.get(`${tenantId}:${t.source_location_id}`);
      const destLoc = this.locations.get(`${tenantId}:${t.destination_location_id}`);
      return {
        ...t,
        source_location_name: sourceLoc?.name || '',
        destination_location_name: destLoc?.name || ''
      };
    });
  }

  async updateTransferStatus(tenantId, transferId, newStatus, meta = {}) {
    if (!tenantId || !transferId) return null;
    const key = `${tenantId}:${transferId}`;
    const transfer = this.transfers.get(key);
    if (!transfer) return null;

    const updated = {
      ...transfer,
      status: newStatus,
      dispatched_by: meta.dispatched_by || transfer.dispatched_by,
      dispatched_at: meta.dispatched_at || transfer.dispatched_at,
      received_by: meta.received_by || transfer.received_by,
      received_at: meta.received_at || transfer.received_at,
      updated_at: new Date()
    };
    this.transfers.set(key, updated);
    return { ...updated };
  }

  async updateTransferItemQuantity(tenantId, itemId, transferredQuantity) {
    if (!tenantId || !itemId) return null;
    const key = `${tenantId}:${itemId}`;
    const item = this.transferItems.get(key);
    if (!item) return null;

    const updated = {
      ...item,
      quantity_transferred: Number(transferredQuantity)
    };
    this.transferItems.set(key, updated);
    return { ...updated };
  }
}

module.exports = { InMemoryInventoryRepository };

