/**
 * Repositorio de Overrides y Límites de Entitlements por Tenant
 * Toda consulta tenant-owned incluye obligatoriamente tenant_id.
 */

class EntitlementsRepository {
  constructor(pool = null) {
    this.pool = pool;
  }

  async findOverridesByTenantId(tenantId) {
    if (!tenantId) throw new Error('tenant_id es requerido para consultar overrides');

    if (this.pool) {
      const [rows] = await this.pool.query(
        "SELECT * FROM tenant_feature_overrides WHERE tenant_id = ? AND (expires_at IS NULL OR expires_at > NOW())",
        [tenantId]
      );
      return rows || [];
    }
    return [];
  }

  async upsertOverride(tenantId, overrideData) {
    if (!tenantId) throw new Error('tenant_id es requerido para upsert de override');
    const { feature_key, is_enabled, reason, actor_id, expires_at } = overrideData;
    if (!feature_key) throw new Error('feature_key es requerido');

    if (this.pool) {
      await this.pool.query(`
        INSERT INTO tenant_feature_overrides (tenant_id, feature_key, is_enabled, reason, actor_id, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, NOW())
        ON CONFLICT (tenant_id, feature_key) DO UPDATE SET
          is_enabled = EXCLUDED.is_enabled,
          reason = EXCLUDED.reason,
          actor_id = EXCLUDED.actor_id,
          expires_at = EXCLUDED.expires_at,
          created_at = NOW()
      `, [tenantId, feature_key, Boolean(is_enabled), reason || 'Override administrativo', actor_id || 'system', expires_at || null]);
    }

    return {
      tenant_id: tenantId,
      feature_key,
      is_enabled: Boolean(is_enabled),
      reason,
      actor_id,
      expires_at
    };
  }

  async countResourceUsage(tenantId, resourceKey) {
    if (!tenantId) throw new Error('tenant_id es requerido para conteo de recursos');

    if (!this.pool) return 0;

    if (resourceKey === 'users') {
      const [rows] = await this.pool.query(
        "SELECT COUNT(*) as total FROM users WHERE tenant_id = ? AND role != 'superadmin' AND (is_active = TRUE OR estado = 'Activo')",
        [tenantId]
      );
      return parseInt(rows[0]?.total || 0, 10);
    }

    if (resourceKey === 'branches') {
      const [rows] = await this.pool.query(
        "SELECT COUNT(*) as total FROM branches WHERE tenant_id = ? AND is_active = TRUE",
        [tenantId]
      );
      return parseInt(rows[0]?.total || 0, 10);
    }

    return 0;
  }
}

module.exports = { EntitlementsRepository };

