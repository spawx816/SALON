/**
 * Servicio de Transferencias Multisucursal / Multialmacén (Plan PRO)
 */

class InventoryTransferService {
  constructor({ transferRepo, inventoryRepo }) {
    this.transferRepo = transferRepo;
    this.inventoryRepo = inventoryRepo;
  }

  async requestTransfer(tenantId, transferData, items = []) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    if (!items || items.length === 0) {
      throw new Error('La transferencia debe contener al menos un producto');
    }

    const { source_location_id, destination_location_id } = transferData;
    if (String(source_location_id) === String(destination_location_id)) {
      const err = new Error('La ubicación de origen y destino no pueden ser iguales');
      err.code = 'SAME_LOCATION_TRANSFER';
      throw err;
    }

    // Verificar existencia de ubicaciones dentro del tenant
    const srcLoc = await this.inventoryRepo.getLocationById(tenantId, source_location_id);
    const dstLoc = await this.inventoryRepo.getLocationById(tenantId, destination_location_id);
    if (!srcLoc || !dstLoc) {
      const err = new Error('Ubicación de origen o destino no encontrada en este salón');
      err.code = 'NOT_FOUND';
      throw err;
    }

    // Verificar productos
    for (const it of items) {
      const prod = await this.inventoryRepo.getProductById(tenantId, it.product_id);
      if (!prod) {
        const err = new Error(`Producto ${it.product_id} no encontrado en este salón`);
        err.code = 'NOT_FOUND';
        throw err;
      }
      if (Number(it.quantity_requested) <= 0) {
        throw new Error('La cantidad a transferir debe ser mayor a cero');
      }
    }

    return this.transferRepo.createTransfer(tenantId, transferData, items);
  }

  async getTransfer(tenantId, transferId) {
    if (!tenantId || !transferId) return null;
    return this.transferRepo.getTransferById(tenantId, transferId);
  }

  async listTransfers(tenantId, filters = {}) {
    if (!tenantId) return [];
    return this.transferRepo.listTransfers(tenantId, filters);
  }

  async approveTransfer(tenantId, transferId, { userId = null } = {}) {
    if (!tenantId || !transferId) throw new Error('Parámetros requeridos faltantes');
    const transfer = await this.transferRepo.getTransferById(tenantId, transferId);
    if (!transfer) {
      const err = new Error('Transferencia no encontrada');
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (transfer.status !== 'REQUESTED') {
      throw new Error(`Solo se pueden aprobar transferencias en estado REQUESTED (actual: ${transfer.status})`);
    }

    return this.transferRepo.updateTransferStatus(tenantId, transferId, 'APPROVED');
  }

  async dispatchTransfer(tenantId, transferId, { idempotencyKey = null, userId = null, userName = null } = {}) {
    if (!tenantId || !transferId) throw new Error('Parámetros requeridos faltantes');
    const transfer = await this.transferRepo.getTransferById(tenantId, transferId);
    if (!transfer) {
      const err = new Error('Transferencia no encontrada');
      err.code = 'NOT_FOUND';
      throw err;
    }

    // Idempotencia evaluada primero
    if (idempotencyKey) {
      const checkKey = `${idempotencyKey}:${transfer.items[0]?.product_id || 'root'}`;
      const existingMov = (await this.inventoryRepo.getMovementByIdempotencyKey(tenantId, idempotencyKey)) ||
                          (await this.inventoryRepo.getMovementByIdempotencyKey(tenantId, checkKey));
      if (existingMov) {
        return {
          idempotent: true,
          message: 'Despacho de transferencia previamente procesado',
          transfer
        };
      }
    }

    if (transfer.status !== 'APPROVED' && transfer.status !== 'REQUESTED') {
      throw new Error(`La transferencia debe estar APROBADA para su despacho (actual: ${transfer.status})`);
    }

    const sourceLocId = transfer.source_location_id;

    // 1. Validar existencias de todos los productos en el origen
    for (const it of transfer.items) {
      const currentStock = await this.inventoryRepo.getStock(tenantId, it.product_id, sourceLocId);
      const reqQty = Number(it.quantity_requested);
      if (currentStock.quantity < reqQty) {
        const err = new Error(`Stock insuficiente en origen para "${it.product_name || it.product_id}". Disponible: ${currentStock.quantity}, Requerido: ${reqQty}`);
        err.code = 'INSUFFICIENT_STOCK';
        throw err;
      }
    }

    // 2. Realizar salida de inventario (TRANSFER_OUT)
    const outMovements = [];
    for (const it of transfer.items) {
      const reqQty = Number(it.quantity_requested);
      const currentStock = await this.inventoryRepo.getStock(tenantId, it.product_id, sourceLocId);
      const newQty = currentStock.quantity - reqQty;
      const movKey = idempotencyKey ? `${idempotencyKey}:${it.product_id}` : `trf_out:${transferId}:${it.product_id}`;

      const mov = await this.inventoryRepo.recordMovement(tenantId, {
        product_id: it.product_id,
        location_id: sourceLocId,
        movement_type: 'TRANSFER_OUT',
        quantity: -reqQty,
        unit_cost: currentStock.average_cost,
        total_cost: reqQty * currentStock.average_cost,
        balance_after: newQty,
        reference_type: 'TRANSFER',
        reference_id: String(transferId),
        idempotency_key: movKey,
        reason: `Despacho de transferencia #${transfer.transfer_number}`,
        user_id: userId,
        user_name: userName
      });

      await this.inventoryRepo.updateStockBalance(tenantId, it.product_id, sourceLocId, newQty, currentStock.average_cost);
      await this.transferRepo.updateTransferItemQuantity(tenantId, it.id, reqQty);
      outMovements.push(mov);
    }

    await this.transferRepo.updateTransferStatus(tenantId, transferId, 'DISPATCHED', {
      dispatched_by: userId || 'admin',
      dispatched_at: new Date()
    });

    const updated = await this.transferRepo.getTransferById(tenantId, transferId);
    return {
      success: true,
      status: 'DISPATCHED',
      movements: outMovements,
      transfer: updated
    };
  }

  async receiveTransfer(tenantId, transferId, { idempotencyKey = null, userId = null, userName = null } = {}) {
    if (!tenantId || !transferId) throw new Error('Parámetros requeridos faltantes');
    const transfer = await this.transferRepo.getTransferById(tenantId, transferId);
    if (!transfer) {
      const err = new Error('Transferencia no encontrada');
      err.code = 'NOT_FOUND';
      throw err;
    }

    // Idempotencia evaluada primero
    if (idempotencyKey) {
      const checkKey = `${idempotencyKey}:${transfer.items[0]?.product_id || 'root'}`;
      const existingMov = (await this.inventoryRepo.getMovementByIdempotencyKey(tenantId, idempotencyKey)) ||
                          (await this.inventoryRepo.getMovementByIdempotencyKey(tenantId, checkKey));
      if (existingMov) {
        return {
          idempotent: true,
          message: 'Recepción de transferencia previamente procesada',
          transfer
        };
      }
    }

    if (transfer.status !== 'DISPATCHED') {
      throw new Error(`La transferencia debe estar DESPACHADA para ser recibida (actual: ${transfer.status})`);
    }

    const destLocId = transfer.destination_location_id;
    const inMovements = [];

    for (const it of transfer.items) {
      const qty = Number(it.quantity_transferred || it.quantity_requested);
      const currentStock = await this.inventoryRepo.getStock(tenantId, it.product_id, destLocId);
      const newQty = currentStock.quantity + qty;

      // Obtener costo de salida desde el producto o stock origen
      const prod = await this.inventoryRepo.getProductById(tenantId, it.product_id);
      const unitCost = prod ? Number(prod.cost) : 0;
      const movKey = idempotencyKey ? `${idempotencyKey}:${it.product_id}` : `trf_in:${transferId}:${it.product_id}`;

      const mov = await this.inventoryRepo.recordMovement(tenantId, {
        product_id: it.product_id,
        location_id: destLocId,
        movement_type: 'TRANSFER_IN',
        quantity: qty,
        unit_cost: unitCost,
        total_cost: qty * unitCost,
        balance_after: newQty,
        reference_type: 'TRANSFER',
        reference_id: String(transferId),
        idempotency_key: movKey,
        reason: `Recepción de transferencia #${transfer.transfer_number}`,
        user_id: userId,
        user_name: userName
      });

      await this.inventoryRepo.updateStockBalance(tenantId, it.product_id, destLocId, newQty, unitCost);
      inMovements.push(mov);
    }

    await this.transferRepo.updateTransferStatus(tenantId, transferId, 'RECEIVED', {
      received_by: userId || 'admin',
      received_at: new Date()
    });

    const updated = await this.transferRepo.getTransferById(tenantId, transferId);
    return {
      success: true,
      status: 'RECEIVED',
      movements: inMovements,
      transfer: updated
    };
  }

  async cancelTransfer(tenantId, transferId, { userId = null, reason = 'Cancelación de transferencia' } = {}) {
    if (!tenantId || !transferId) throw new Error('Parámetros requeridos faltantes');
    const transfer = await this.transferRepo.getTransferById(tenantId, transferId);
    if (!transfer) {
      const err = new Error('Transferencia no encontrada');
      err.code = 'NOT_FOUND';
      throw err;
    }

    if (transfer.status === 'DISPATCHED' || transfer.status === 'RECEIVED') {
      throw new Error(`No se puede cancelar una transferencia que ya ha sido ${transfer.status}`);
    }

    return this.transferRepo.updateTransferStatus(tenantId, transferId, 'CANCELLED');
  }
}

module.exports = { InventoryTransferService };
