/**
 * Repositorio de Auditoría de Cambios de Suscripción (tenant_subscription_events)
 * Toda inserción y consulta tenant-owned incluye obligatoriamente tenant_id.
 */

class SubscriptionAuditRepository {
  constructor(pool = null) {
    this.pool = pool;
  }

  async recordEvent({ tenant_id, previous_plan, new_plan, previous_status, new_status, reason, actor_id }) {
    if (!tenant_id) throw new Error('tenant_id es requerido para registrar evento de auditoría');
    if (!new_plan) throw new Error('new_plan es requerido');
    if (!actor_id) throw new Error('actor_id es requerido');

    if (this.pool) {
      await this.pool.query(`
        INSERT INTO tenant_subscription_events (
          tenant_id, previous_plan, new_plan, previous_status, new_status, reason, actor_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
      `, [
        tenant_id,
        previous_plan || null,
        new_plan,
        previous_status || 'active',
        new_status || 'active',
        reason || 'Cambio administrativo',
        actor_id
      ]);
    }

    return {
      tenant_id,
      previous_plan,
      new_plan,
      previous_status,
      new_status,
      reason,
      actor_id,
      created_at: new Date()
    };
  }

  async getHistoryByTenantId(tenantId) {
    if (!tenantId) throw new Error('tenant_id es requerido para consultar historial');
    if (this.pool) {
      const [rows] = await this.pool.query(
        "SELECT * FROM tenant_subscription_events WHERE tenant_id = ? ORDER BY created_at DESC",
        [tenantId]
      );
      return rows || [];
    }
    return [];
  }
}

module.exports = { SubscriptionAuditRepository };

