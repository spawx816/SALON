/**
 * TenantBrandingService
 * Manages tenant branding lifecycle, WCAG contrast calculation,
 * color sanitization, strict URL & anti-XSS validation, and per-tenant caching.
 */

const { DEFAULT_SALONPRO_BRANDING } = require('../repositories/tenant_branding.repository');

const HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function parseHex(hex) {
  let cleaned = hex.replace('#', '');
  if (cleaned.length === 3) {
    cleaned = cleaned.split('').map(c => c + c).join('');
  }
  const num = parseInt(cleaned, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}

function getLuminance({ r, g, b }) {
  const a = [r, g, b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

function calculateContrastRatio(hex1, hex2) {
  const lum1 = getLuminance(parseHex(hex1));
  const lum2 = getLuminance(parseHex(hex2));
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

function sanitizeText(str) {
  if (typeof str !== 'string') return '';
  // Strip script blocks completely and strip all HTML tags
  return str
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

function validateAndSanitizeUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();

  // Reject dangerous schemes
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('vbscript:') || lower.startsWith('data:text/html') || lower.includes('<script')) {
    throw new Error('URL de logo inválida o contiene esquemas no seguros');
  }

  // If data URI, allow only safe raster images (png, jpeg, webp)
  if (lower.startsWith('data:')) {
    if (!lower.startsWith('data:image/png') && !lower.startsWith('data:image/jpeg') && !lower.startsWith('data:image/webp')) {
      throw new Error('Solo se permiten imágenes en formato PNG, JPEG o WebP');
    }
  }

  return trimmed;
}

class TenantBrandingService {
  constructor({ repository }) {
    this.repository = repository;
    this.cache = new Map(); // tenant_id -> branding
  }

  /**
   * Get branding for tenant. Returns custom branding or fallback to neutral SalonPro.
   */
  async getBranding(tenantId) {
    if (!tenantId) {
      return { ...DEFAULT_SALONPRO_BRANDING, tenant_id: null, is_default: true };
    }

    const tId = String(tenantId);
    if (this.cache.has(tId)) {
      return { ...this.cache.get(tId) };
    }

    const found = await this.repository.findByTenantId(tId);
    if (!found) {
      const defaultBranding = {
        ...DEFAULT_SALONPRO_BRANDING,
        tenant_id: tId,
        is_default: true
      };
      this.cache.set(tId, defaultBranding);
      return { ...defaultBranding };
    }

    const branding = {
      ...DEFAULT_SALONPRO_BRANDING,
      ...found,
      is_default: false
    };
    this.cache.set(tId, branding);
    return { ...branding };
  }

  /**
   * Update tenant branding with validation and immediate cache invalidation.
   */
  async updateBranding(tenantId, updateData, updatedBy = null) {
    if (!tenantId) {
      throw new Error('El ID de tenant es obligatorio para actualizar branding');
    }

    const tId = String(tenantId);
    const existing = await this.getBranding(tId);

    // 1. Color validation
    const colorFields = ['primary_color', 'secondary_color', 'accent_color', 'background_color', 'surface_color', 'text_color'];
    const sanitizedColors = {};

    for (const field of colorFields) {
      if (updateData[field] !== undefined) {
        const val = String(updateData[field]).trim();
        if (!HEX_COLOR_REGEX.test(val)) {
          throw new Error(`Color inválido para ${field}: '${val}'. Debe ser un código hexadecimal válido (ej. #0f172a).`);
        }
        sanitizedColors[field] = val.toLowerCase();
      }
    }

    // 2. WCAG Contrast evaluation
    const effectiveText = sanitizedColors.text_color || existing.text_color || DEFAULT_SALONPRO_BRANDING.text_color;
    const effectiveBg = sanitizedColors.background_color || existing.background_color || DEFAULT_SALONPRO_BRANDING.background_color;
    const effectiveSurface = sanitizedColors.surface_color || existing.surface_color || DEFAULT_SALONPRO_BRANDING.surface_color;

    const bgRatio = calculateContrastRatio(effectiveText, effectiveBg);
    const surfaceRatio = calculateContrastRatio(effectiveText, effectiveSurface);

    // Severe illegibility threshold (ratio < 3.0:1)
    if (bgRatio < 3.0) {
      throw new Error(`Contraste insuficiente (${bgRatio.toFixed(2)}:1) entre color de texto (${effectiveText}) y fondo (${effectiveBg}). Mínimo requerido WCAG: 3.0:1.`);
    }
    if (surfaceRatio < 3.0) {
      throw new Error(`Contraste insuficiente (${surfaceRatio.toFixed(2)}:1) entre color de texto (${effectiveText}) y superficie (${effectiveSurface}). Mínimo requerido WCAG: 3.0:1.`);
    }

    // 3. Text sanitization
    const sanitizedTexts = {};
    if (updateData.business_name !== undefined) {
      const cleaned = sanitizeText(updateData.business_name);
      if (!cleaned) throw new Error('El nombre comercial no puede estar vacío');
      sanitizedTexts.business_name = cleaned.slice(0, 150);
    }
    if (updateData.receipt_header !== undefined) {
      sanitizedTexts.receipt_header = sanitizeText(updateData.receipt_header).slice(0, 255);
    }
    if (updateData.receipt_footer !== undefined) {
      sanitizedTexts.receipt_footer = sanitizeText(updateData.receipt_footer).slice(0, 255);
    }

    // 4. Logo & URL sanitization
    const sanitizedUrls = {};
    if (updateData.logo_url !== undefined) {
      sanitizedUrls.logo_url = validateAndSanitizeUrl(updateData.logo_url);
    }
    if (updateData.logo_dark_url !== undefined) {
      sanitizedUrls.logo_dark_url = validateAndSanitizeUrl(updateData.logo_dark_url);
    }
    if (updateData.favicon_url !== undefined) {
      sanitizedUrls.favicon_url = validateAndSanitizeUrl(updateData.favicon_url);
    }

    const payload = {
      ...sanitizedColors,
      ...sanitizedTexts,
      ...sanitizedUrls
    };

    // 5. Persist
    const updated = await this.repository.upsert(tId, payload, updatedBy);

    // 6. Immediate cache invalidation
    this.cache.delete(tId);

    const result = {
      ...DEFAULT_SALONPRO_BRANDING,
      ...updated,
      is_default: false,
      contrast_ratio_bg: Number(bgRatio.toFixed(2)),
      contrast_ratio_surface: Number(surfaceRatio.toFixed(2)),
      wcag_aa_compliant: bgRatio >= 4.5 && surfaceRatio >= 4.5
    };

    this.cache.set(tId, result);
    return result;
  }

  /**
   * Reset branding to default SalonPro.
   */
  async resetToDefaults(tenantId, updatedBy = null) {
    if (!tenantId) return;
    const tId = String(tenantId);
    await this.repository.delete(tId);
    this.cache.delete(tId);
    return this.getBranding(tId);
  }

  /**
   * Get public safe visual branding by slug or ID.
   */
  async getPublicSafeBranding(tenantIdOrSlug) {
    const branding = await this.getBranding(tenantIdOrSlug);
    // Return only public visual fields: zero PII, zero internal IDs
    return {
      business_name: branding.business_name,
      logo_url: branding.logo_url,
      logo_dark_url: branding.logo_dark_url,
      favicon_url: branding.favicon_url,
      primary_color: branding.primary_color,
      secondary_color: branding.secondary_color,
      accent_color: branding.accent_color,
      background_color: branding.background_color,
      surface_color: branding.surface_color,
      text_color: branding.text_color,
      receipt_header: branding.receipt_header,
      receipt_footer: branding.receipt_footer
    };
  }
}

module.exports = {
  TenantBrandingService,
  HEX_COLOR_REGEX,
  calculateContrastRatio
};
