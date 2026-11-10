/**
 * Repository for Tenant Branding (SQL Prepared & In-Memory Implementations)
 * Strictly scopes all reads and mutations by tenant_id.
 */

const DEFAULT_SALONPRO_BRANDING = Object.freeze({
  business_name: 'SalonPro',
  logo_url: null,
  logo_dark_url: null,
  favicon_url: null,
  primary_color: '#0f172a',
  secondary_color: '#d4af37',
  accent_color: '#3b82f6',
  background_color: '#f8fafc',
  surface_color: '#ffffff',
  text_color: '#0f172a',
  receipt_header: 'SalonPro - Sistema de Gestión',
  receipt_footer: '¡Gracias por preferirnos! ♡'
});

class TenantBrandingRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findByTenantId(tenantId) {
    if (!this.pool || !tenantId) return null;
    const [rows] = await this.pool.query(
      `SELECT tenant_id, business_name, logo_url, logo_dark_url, favicon_url,
              primary_color, secondary_color, accent_color, background_color,
              surface_color, text_color, receipt_header, receipt_footer,
              updated_at, updated_by
       FROM tenant_branding
       WHERE tenant_id = ?
       LIMIT 1`,
      [tenantId]
    );
    return rows && rows.length > 0 ? rows[0] : null;
  }

  async upsert(tenantId, brandingData, updatedBy = null) {
    if (!this.pool || !tenantId) return null;
    await this.pool.query(
      `INSERT INTO tenant_branding (
         tenant_id, business_name, logo_url, logo_dark_url, favicon_url,
         primary_color, secondary_color, accent_color, background_color,
         surface_color, text_color, receipt_header, receipt_footer,
         updated_at, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
       ON CONFLICT (tenant_id) DO UPDATE SET
         business_name = EXCLUDED.business_name,
         logo_url = EXCLUDED.logo_url,
         logo_dark_url = EXCLUDED.logo_dark_url,
         favicon_url = EXCLUDED.favicon_url,
         primary_color = EXCLUDED.primary_color,
         secondary_color = EXCLUDED.secondary_color,
         accent_color = EXCLUDED.accent_color,
         background_color = EXCLUDED.background_color,
         surface_color = EXCLUDED.surface_color,
         text_color = EXCLUDED.text_color,
         receipt_header = EXCLUDED.receipt_header,
         receipt_footer = EXCLUDED.receipt_footer,
         updated_at = NOW(),
         updated_by = EXCLUDED.updated_by`,
      [
        tenantId,
        brandingData.business_name || DEFAULT_SALONPRO_BRANDING.business_name,
        brandingData.logo_url || null,
        brandingData.logo_dark_url || null,
        brandingData.favicon_url || null,
        brandingData.primary_color || DEFAULT_SALONPRO_BRANDING.primary_color,
        brandingData.secondary_color || DEFAULT_SALONPRO_BRANDING.secondary_color,
        brandingData.accent_color || DEFAULT_SALONPRO_BRANDING.accent_color,
        brandingData.background_color || DEFAULT_SALONPRO_BRANDING.background_color,
        brandingData.surface_color || DEFAULT_SALONPRO_BRANDING.surface_color,
        brandingData.text_color || DEFAULT_SALONPRO_BRANDING.text_color,
        brandingData.receipt_header || null,
        brandingData.receipt_footer || DEFAULT_SALONPRO_BRANDING.receipt_footer,
        updatedBy
      ]
    );
    return this.findByTenantId(tenantId);
  }

  async delete(tenantId) {
    if (!this.pool || !tenantId) return;
    await this.pool.query('DELETE FROM tenant_branding WHERE tenant_id = ?', [tenantId]);
  }
}

class InMemoryTenantBrandingRepository {
  constructor(initialData = new Map()) {
    this.store = new Map(initialData);
  }

  async findByTenantId(tenantId) {
    if (!tenantId) return null;
    const found = this.store.get(String(tenantId));
    return found ? { ...found } : null;
  }

  async upsert(tenantId, brandingData, updatedBy = null) {
    if (!tenantId) return null;
    const existing = this.store.get(String(tenantId)) || {};
    const record = {
      tenant_id: String(tenantId),
      business_name: brandingData.business_name ?? existing.business_name ?? DEFAULT_SALONPRO_BRANDING.business_name,
      logo_url: brandingData.logo_url !== undefined ? brandingData.logo_url : (existing.logo_url ?? null),
      logo_dark_url: brandingData.logo_dark_url !== undefined ? brandingData.logo_dark_url : (existing.logo_dark_url ?? null),
      favicon_url: brandingData.favicon_url !== undefined ? brandingData.favicon_url : (existing.favicon_url ?? null),
      primary_color: brandingData.primary_color ?? existing.primary_color ?? DEFAULT_SALONPRO_BRANDING.primary_color,
      secondary_color: brandingData.secondary_color ?? existing.secondary_color ?? DEFAULT_SALONPRO_BRANDING.secondary_color,
      accent_color: brandingData.accent_color ?? existing.accent_color ?? DEFAULT_SALONPRO_BRANDING.accent_color,
      background_color: brandingData.background_color ?? existing.background_color ?? DEFAULT_SALONPRO_BRANDING.background_color,
      surface_color: brandingData.surface_color ?? existing.surface_color ?? DEFAULT_SALONPRO_BRANDING.surface_color,
      text_color: brandingData.text_color ?? existing.text_color ?? DEFAULT_SALONPRO_BRANDING.text_color,
      receipt_header: brandingData.receipt_header !== undefined ? brandingData.receipt_header : (existing.receipt_header ?? null),
      receipt_footer: brandingData.receipt_footer !== undefined ? brandingData.receipt_footer : (existing.receipt_footer ?? DEFAULT_SALONPRO_BRANDING.receipt_footer),
      updated_at: new Date().toISOString(),
      updated_by: updatedBy || existing.updated_by || null
    };
    this.store.set(String(tenantId), record);
    return { ...record };
  }

  async delete(tenantId) {
    if (!tenantId) return;
    this.store.delete(String(tenantId));
  }
}

module.exports = {
  TenantBrandingRepository,
  InMemoryTenantBrandingRepository,
  DEFAULT_SALONPRO_BRANDING
};

