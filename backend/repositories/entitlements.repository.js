/**
 * Repositorio de Overrides y Límites de Entitlements por Tenant
 * Toda consulta tenant-owned incluye obligatoriamente tenant_id.
 */

class EntitlementsRepository {
  constructor(pool = null) {
    this.pool = pool;
  }

  async findOverridesByTenantId(tenantId, conn = null) {
    if (!tenantId) throw new Error('tenant_id es requerido para consultar overrides');
    const executor = conn || this.pool;

    if (executor) {
      const [rows] = await executor.query(
        "SELECT * FROM tenant_feature_overrides WHERE tenant_id = ? AND (expires_at IS NULL OR expires_at > NOW())",
        [tenantId]
      );
      return rows || [];
    }
    return [];
  }

  async findActiveBranchesByTenantId(tenantId, conn = null) {
    if (!tenantId) throw new Error('tenant_id es requerido para consultar sucursales');
    const executor = conn || this.pool;
    if (!executor) return null;

    const [rows] = await executor.query(
      "SELECT id::text as id, name, COALESCE(is_main, false) as is_main, COALESCE(is_active, true) as is_active FROM branches WHERE tenant_id = ? AND COALESCE(is_active, true) = true ORDER BY is_main DESC, name ASC",
      [tenantId]
    );
    return rows || [];
  }

  async upsertOverride(tenantId, overrideData, conn = null) {
    if (!tenantId) throw new Error('tenant_id es requerido para upsert de override');
    const { feature_key, is_enabled, reason, actor_id, expires_at, enabled_branch_ids = null } = overrideData;
    if (!feature_key) throw new Error('feature_key es requerido');

    const serializedBranches = Array.isArray(enabled_branch_ids)
      ? JSON.stringify([...new Set(enabled_branch_ids.map(String))])
      : null;

    const params = [tenantId, feature_key, Boolean(is_enabled), reason || 'Override administrativo', actor_id || 'system', expires_at || null, serializedBranches];
    if (conn && typeof conn.release === 'function') {
      await conn.query(`
        INSERT INTO tenant_feature_overrides (tenant_id, feature_key, is_enabled, reason, actor_id, expires_at, enabled_branch_ids, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), NOW())
        ON CONFLICT (tenant_id, feature_key) DO UPDATE SET
          is_enabled = EXCLUDED.is_enabled,
          reason = EXCLUDED.reason,
          actor_id = EXCLUDED.actor_id,
          expires_at = EXCLUDED.expires_at,
          enabled_branch_ids = EXCLUDED.enabled_branch_ids,
          updated_at = NOW()
      `, params);
    } else if (this.pool) {
      await this.pool.query(`
        INSERT INTO tenant_feature_overrides (tenant_id, feature_key, is_enabled, reason, actor_id, expires_at, enabled_branch_ids, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, NOW(), NOW())
        ON CONFLICT (tenant_id, feature_key) DO UPDATE SET
          is_enabled = EXCLUDED.is_enabled,
          reason = EXCLUDED.reason,
          actor_id = EXCLUDED.actor_id,
          expires_at = EXCLUDED.expires_at,
          enabled_branch_ids = EXCLUDED.enabled_branch_ids,
          updated_at = NOW()
      `, params);
    }

    return {
      tenant_id: tenantId,
      feature_key,
      is_enabled: Boolean(is_enabled),
      reason,
      actor_id,
      expires_at,
      enabled_branch_ids: Array.isArray(enabled_branch_ids) ? [...new Set(enabled_branch_ids.map(String))] : null
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

