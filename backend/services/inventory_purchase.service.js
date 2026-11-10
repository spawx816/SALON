/**
 * Servicio de Órdenes de Compra y Proveedores de Inventario (Plan PRO)
 */

class InventoryPurchaseService {
  constructor({ purchaseRepo, inventoryRepo }) {
    this.purchaseRepo = purchaseRepo;
    this.inventoryRepo = inventoryRepo;
  }

  calculateWeightedAverageCost(currentQty, currentAvgCost, incomingQty, incomingCost) {
    const curQ = Number(currentQty) || 0;
    const curC = Number(currentAvgCost) || 0;
    const inQ = Number(incomingQty) || 0;
    const inC = Number(incomingCost) || 0;

    const totalQty = curQ + inQ;
    if (totalQty <= 0) return inC > 0 ? inC : curC;

    const totalValue = (curQ * curC) + (inQ * inC);
    return Math.round((totalValue / totalQty) * 10000) / 10000;
  }

  // === PROVEEDORES ===
  async createSupplier(tenantId, supplierData) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    return this.purchaseRepo.createSupplier(tenantId, supplierData);
  }

  async listSuppliers(tenantId, filters = {}) {
    if (!tenantId) return [];
    return this.purchaseRepo.listSuppliers(tenantId, filters);
  }

  // === ÓRDENES DE COMPRA ===
  async createPurchaseOrder(tenantId, orderData, items = []) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    if (!items || items.length === 0) {
      throw new Error('La orden de compra debe contener al menos un producto');
    }

    // Verificar que los productos existan y pertenezcan al tenant
    for (const it of items) {
      const prod = await this.inventoryRepo.getProductById(tenantId, it.product_id);
      if (!prod) {
        const err = new Error(`Producto ${it.product_id} no encontrado en este salón`);
        err.code = 'NOT_FOUND';
        throw err;
      }
    }

    return this.purchaseRepo.createPurchaseOrder(tenantId, orderData, items);
  }

  async getPurchaseOrder(tenantId, orderId) {
    if (!tenantId || !orderId) return null;
    return this.purchaseRepo.getPurchaseOrderById(tenantId, orderId);
  }

  async listPurchaseOrders(tenantId, filters = {}) {
    if (!tenantId) return [];
    return this.purchaseRepo.listPurchaseOrders(tenantId, filters);
  }

  async approvePurchaseOrder(tenantId, orderId, { userId = null } = {}) {
    if (!tenantId || !orderId) throw new Error('Parámetros requeridos faltantes');
    const order = await this.purchaseRepo.getPurchaseOrderById(tenantId, orderId);
    if (!order) {
      const err = new Error('Orden de compra no encontrada');
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (order.status !== 'DRAFT') {
      throw new Error(`Solo se pueden aprobar órdenes en estado DRAFT (estado actual: ${order.status})`);
    }

    return this.purchaseRepo.updatePurchaseOrderStatus(tenantId, orderId, 'APPROVED', {
      approvedBy: userId || 'admin',
      approvedAt: new Date()
    });
  }

  async receivePurchaseOrder(tenantId, orderId, { itemsToReceive = [], idempotencyKey = null, userId = null, userName = null }) {
    if (!tenantId || !orderId) throw new Error('Parámetros requeridos faltantes');
    if (!itemsToReceive || itemsToReceive.length === 0) {
      throw new Error('Debe especificar al menos un renglón para recepción');
    }

    const order = await this.purchaseRepo.getPurchaseOrderById(tenantId, orderId);
    if (!order) {
      const err = new Error('Orden de compra no encontrada');
      err.code = 'NOT_FOUND';
      throw err;
    }

    // Comprobación de idempotencia evaluada primero
    if (idempotencyKey) {
      const checkKey = `${idempotencyKey}:${itemsToReceive[0]?.product_id || 'item'}`;
      const existingMovement = (await this.inventoryRepo.getMovementByIdempotencyKey(tenantId, idempotencyKey)) ||
                               (await this.inventoryRepo.getMovementByIdempotencyKey(tenantId, checkKey));
      if (existingMovement) {
        return {
          idempotent: true,
          message: 'Recepción de compra previamente procesada',
          order
        };
      }
    }

    if (order.status !== 'APPROVED' && order.status !== 'PARTIALLY_RECEIVED') {
      throw new Error(`La orden de compra debe estar APROBADA o PARCIALMENTE RECIBIDA (estado actual: ${order.status})`);
    }

    const locationId = order.location_id;
    const movementsRecorded = [];

    for (const rec of itemsToReceive) {
      const line = order.items.find(i => String(i.id) === String(rec.item_id) || String(i.product_id) === String(rec.product_id));
      if (!line) {
        throw new Error(`Renglón ${rec.item_id || rec.product_id} no pertenece a esta orden de compra`);
      }

      const qtyReceiving = Number(rec.quantity_received || rec.quantity);
      if (qtyReceiving <= 0) continue;

      const remainingAllowed = Number(line.quantity_ordered) - Number(line.quantity_received);
      if (qtyReceiving > remainingAllowed) {
        throw new Error(`Cantidad a recibir (${qtyReceiving}) excede la cantidad pendiente (${remainingAllowed}) para el producto ${line.product_name || line.product_id}`);
      }

      const unitCost = Number(rec.unit_cost !== undefined ? rec.unit_cost : line.unit_cost) || 0;
      const currentStock = await this.inventoryRepo.getStock(tenantId, line.product_id, locationId);
      const newQty = currentStock.quantity + qtyReceiving;
      const newAvgCost = this.calculateWeightedAverageCost(currentStock.quantity, currentStock.average_cost, qtyReceiving, unitCost);

      const movKey = idempotencyKey
        ? `${idempotencyKey}:${line.product_id}`
        : `po_rcv:${orderId}:${line.product_id}:${Date.now()}`;

      const mov = await this.inventoryRepo.recordMovement(tenantId, {
        product_id: line.product_id,
        location_id: locationId,
        movement_type: 'PURCHASE_RECEIPT',
        quantity: qtyReceiving,
        unit_cost: unitCost,
        total_cost: qtyReceiving * unitCost,
        balance_after: newQty,
        reference_type: 'PURCHASE_ORDER',
        reference_id: String(orderId),
        idempotency_key: movKey,
        reason: `Recepción de orden de compra #${order.order_number}`,
        user_id: userId,
        user_name: userName
      });

      await this.inventoryRepo.updateStockBalance(tenantId, line.product_id, locationId, newQty, newAvgCost);
      await this.purchaseRepo.updatePurchaseOrderItemReceived(tenantId, line.id, qtyReceiving);

      movementsRecorded.push(mov);
    }

    // Evaluar si todos los renglones quedaron completamente recibidos
    const updatedOrder = await this.purchaseRepo.getPurchaseOrderById(tenantId, orderId);
    let allCompleted = true;
    for (const it of updatedOrder.items) {
      if (Number(it.quantity_received) < Number(it.quantity_ordered)) {
        allCompleted = false;
        break;
      }
    }

    const finalStatus = allCompleted ? 'COMPLETED' : 'PARTIALLY_RECEIVED';
    await this.purchaseRepo.updatePurchaseOrderStatus(tenantId, orderId, finalStatus);
    updatedOrder.status = finalStatus;

    return {
      success: true,
      status: finalStatus,
      movements: movementsRecorded,
      order: updatedOrder
    };
  }

  async cancelPurchaseOrder(tenantId, orderId, { userId = null, reason = 'Cancelación de orden' } = {}) {
    if (!tenantId || !orderId) throw new Error('Parámetros requeridos faltantes');
    const order = await this.purchaseRepo.getPurchaseOrderById(tenantId, orderId);
    if (!order) {
      const err = new Error('Orden de compra no encontrada');
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (order.status === 'COMPLETED') {
      throw new Error('No se puede cancelar una orden de compra ya completada');
    }

    return this.purchaseRepo.updatePurchaseOrderStatus(tenantId, orderId, 'CANCELLED');
  }
}

module.exports = { InventoryPurchaseService };
