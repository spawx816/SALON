/**
 * Repositorio de Planes SaaS B2B
 * Responsabilidad: Acceso a datos del catálogo global de planes (BASE y PRO).
 */
const {
  CANONICAL_PLANS_CATALOG,
  normalizePlanCode
} = require('../services/saas_catalog.constants');

class SaasPlanRepository {
  constructor(pool = null) {
    this.pool = pool;
  }

  async getAllPlans(publicOnly = false) {
    if (this.pool) {
      const [rows] = await this.pool.query(
        "SELECT * FROM saas_plans WHERE code IN ('BASE', 'PRO', 'base', 'pro') ORDER BY price ASC"
      );
      if (rows && rows.length > 0) {
        return rows.map(r => ({
          ...r,
          code: normalizePlanCode(r.code)
        }));
      }
    }
    // Fallback canónico en memoria
    return CANONICAL_PLANS_CATALOG.filter(p => (publicOnly ? true : true));
  }

  async findByCode(planCode) {
    const normalized = normalizePlanCode(planCode);
    if (!normalized) return null;

    if (this.pool) {
      const [rows] = await this.pool.query(
        "SELECT * FROM saas_plans WHERE UPPER(code) = ? LIMIT 1",
        [normalized]
      );
      if (rows && rows.length > 0) {
        return {
          ...rows[0],
          code: normalizePlanCode(rows[0].code)
        };
      }
    }

    return CANONICAL_PLANS_CATALOG.find(p => p.code === normalized) || null;
  }
}

module.exports = { SaasPlanRepository };

