/**
 * Repositorio de Suscripciones SaaS de Tenants
 * Toda consulta tenant-owned incluye obligatoriamente tenant_id.
 */
const { normalizePlanCode, SAAS_PLANS, SUBSCRIPTION_STATUSES } = require('../services/saas_catalog.constants');

class TenantSubscriptionRepository {
  constructor(pool = null) {
    this.pool = pool;
  }

  async findByTenantId(tenantId) {
    if (!tenantId) throw new Error('tenant_id es requerido para consultar la suscripción');

    if (this.pool) {
      const [rows] = await this.pool.query(
        "SELECT * FROM tenant_subscriptions WHERE tenant_id = ? LIMIT 1",
        [tenantId]
      );
      if (rows && rows.length > 0) {
        return {
          ...rows[0],
          plan_code: normalizePlanCode(rows[0].plan_code)
        };
      }
      // Fallback de retrocompatibilidad con tabla tenants
      const [tenantRows] = await this.pool.query(
        "SELECT id, plan_id, status FROM tenants WHERE id = ? LIMIT 1",
        [tenantId]
      );
      if (tenantRows && tenantRows.length > 0) {
        const rawStatus = tenantRows[0].status;
        const normalizedStatus = rawStatus === 'active' ? SUBSCRIPTION_STATUSES.ACTIVE : rawStatus;
        return {
          id: `legacy-${tenantId}`,
          tenant_id: tenantId,
          plan_code: SAAS_PLANS.PRINCIPAL,
          status: normalizedStatus,
          current_period_start: new Date(),
          current_period_end: null
        };
      }
      return null;
    }

    return null;
  }

  async upsertSubscription(tenantId, data) {
    if (!tenantId) throw new Error('tenant_id es requerido para upsert de suscripción');
    const planCode = normalizePlanCode(data.plan_code);
    if (!planCode) throw new Error(`Código de plan inválido: ${data.plan_code}`);

    const status = data.status || SUBSCRIPTION_STATUSES.ACTIVE;
    const periodStart = data.current_period_start || new Date();
    const periodEnd = data.current_period_end || null;

    if (this.pool) {
      await this.pool.query(`
        INSERT INTO tenant_subscriptions (tenant_id, plan_code, status, current_period_start, current_period_end, updated_at)
        VALUES (?, ?, ?, ?, ?, NOW())
        ON CONFLICT (tenant_id) DO UPDATE SET
          plan_code = EXCLUDED.plan_code,
          status = EXCLUDED.status,
          current_period_start = EXCLUDED.current_period_start,
          current_period_end = EXCLUDED.current_period_end,
          updated_at = NOW()
      `, [tenantId, planCode, status, periodStart, periodEnd]);

      // Sincronizar plan_id en tabla tenants sin sobreescribir has_memberships (gobernado por add-on)
      await this.pool.query(`
        UPDATE tenants
        SET plan_id = 1,
            updated_at = NOW()
        WHERE id = ?
      `, [tenantId]);
    }

    return {
      tenant_id: tenantId,
      plan_code: planCode,
      status,
      current_period_start: periodStart,
      current_period_end: periodEnd
    };
  }
}

module.exports = { TenantSubscriptionRepository };

