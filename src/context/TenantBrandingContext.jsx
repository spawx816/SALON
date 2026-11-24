import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';

const DEFAULT_BRANDING = Object.freeze({
  business_name: 'SalonPro',
  logo_url: null,
  logo_dark_url: null,
  favicon_url: null,
  primary_color: '#09090b',
  secondary_color: '#a1a1aa',
  accent_color: '#ffffff',
  background_color: '#ffffff',
  surface_color: '#ffffff',
  text_color: '#09090b',
  receipt_header: 'SalonPro - Sistema de Gestión',
  receipt_footer: '¡Gracias por preferirnos! ♡',
  is_default: true
});

function parseHexColor(hex) {
  let cleaned = String(hex || '').replace('#', '').trim();
  if (cleaned.length === 3) {
    cleaned = cleaned.split('').map((c) => c + c).join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return { r: 15, g: 23, b: 42 };
  }
  const num = parseInt(cleaned, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}

function getRelativeLuminance({ r, g, b }) {
  const [rs, gs, bs] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

export function computeContrastRatio(hex1, hex2) {
  const lum1 = getRelativeLuminance(parseHexColor(hex1));
  const lum2 = getRelativeLuminance(parseHexColor(hex2));
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

export function pickReadableForeground(bgHex) {
  const whiteContrast = computeContrastRatio('#ffffff', bgHex);
  const darkContrast = computeContrastRatio('#0f172a', bgHex);
  return whiteContrast >= darkContrast ? '#ffffff' : '#0f172a';
}

const TenantBrandingContext = createContext(null);

export function TenantBrandingProvider({ children }) {
  const { user } = useAuth();
  const [branding, setBranding] = useState(DEFAULT_BRANDING);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const isSuperAdmin = Boolean(
    user?.role?.toLowerCase() === 'superadmin' ||
    user?.role_name?.toLowerCase()?.includes('superadmin') ||
    user?.isSuperAdmin
  );
  const isKioskOnlyUser = Boolean(
    user?.kioskOnly || String(user?.role || user?.rol || '').trim().toLowerCase() === 'kiosco_asistencia'
  );

  const tenantId = user?.tenant_id || user?.tenant?.id || null;

  // Apply CSS design tokens to the document root and bind real sidebar variables
  const applyCssTokens = useCallback((theme) => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const primary = theme?.primary_color || DEFAULT_BRANDING.primary_color;
    const secondary = theme?.secondary_color || DEFAULT_BRANDING.secondary_color;
    const accent = theme?.accent_color || DEFAULT_BRANDING.accent_color;
    const background = theme?.background_color || DEFAULT_BRANDING.background_color;
    const surface = theme?.surface_color || DEFAULT_BRANDING.surface_color;
    const text = theme?.text_color || DEFAULT_BRANDING.text_color;

    const sidebarText = pickReadableForeground(primary);
    const isLightSidebar = sidebarText === '#0f172a';
    const accentText = pickReadableForeground(accent);

    root.style.setProperty('--tenant-primary', primary);
    root.style.setProperty('--bg-sidebar', primary);
    root.style.setProperty('--tenant-secondary', secondary);
    root.style.setProperty('--tenant-accent', accent);
    root.style.setProperty('--tenant-background', background);
    root.style.setProperty('--tenant-surface', surface);
    root.style.setProperty('--tenant-text', text);

    root.style.setProperty('--tenant-sidebar-text', sidebarText);
    root.style.setProperty('--tenant-sidebar-muted', isLightSidebar ? 'rgba(15, 23, 42, 0.76)' : 'rgba(255, 255, 255, 0.78)');
    root.style.setProperty('--tenant-sidebar-group', isLightSidebar ? 'rgba(15, 23, 42, 0.58)' : 'rgba(255, 255, 255, 0.62)');
    root.style.setProperty('--tenant-sidebar-border', isLightSidebar ? 'rgba(15, 23, 42, 0.14)' : 'rgba(255, 255, 255, 0.12)');
    root.style.setProperty('--tenant-sidebar-card-bg', isLightSidebar ? 'rgba(15, 23, 42, 0.06)' : 'rgba(255, 255, 255, 0.06)');
    root.style.setProperty('--tenant-sidebar-hover', isLightSidebar ? 'rgba(15, 23, 42, 0.08)' : 'rgba(255, 255, 255, 0.08)');
    root.style.setProperty('--tenant-accent-text', accentText);
  }, []);

  // Fetch branding from API
  const fetchBranding = useCallback(async () => {
    if (!user || isSuperAdmin || isKioskOnlyUser || !tenantId) {
      setBranding(DEFAULT_BRANDING);
      applyCssTokens(DEFAULT_BRANDING);
      return;
    }

    // Try temporary visual cache first to prevent flash of unstyled content
    try {
      const cached = localStorage.getItem(`salon_pro_branding_${tenantId}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        setBranding(parsed);
        applyCssTokens(parsed);
      }
    } catch (_) {}

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tenant/branding', {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!res.ok) {
        throw new Error('Error al obtener la personalización de la empresa');
      }

      const data = await res.json();
      const resolved = { ...DEFAULT_BRANDING, ...data };
      setBranding(resolved);
      applyCssTokens(resolved);

      // Save to tenant-isolated cache
      try {
        localStorage.setItem(`salon_pro_branding_${tenantId}`, JSON.stringify(resolved));
      } catch (_) {}
    } catch (err) {
      console.warn('[Branding] Fallback a SalonPro neutral:', err.message);
      setError(err.message);
      setBranding(DEFAULT_BRANDING);
      applyCssTokens(DEFAULT_BRANDING);
    } finally {
      setLoading(false);
    }
  }, [user, isSuperAdmin, isKioskOnlyUser, tenantId, applyCssTokens]);

  useEffect(() => {
    fetchBranding();
  }, [fetchBranding]);

  // Update branding
  const updateBranding = async (payload) => {
    if (!tenantId || isSuperAdmin) {
      throw new Error('No autorizado para modificar branding de la empresa');
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tenant/branding', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error al guardar branding');
      }

      const updated = { ...DEFAULT_BRANDING, ...data.branding, is_default: false };
      setBranding(updated);
      applyCssTokens(updated);

      try {
        localStorage.setItem(`salon_pro_branding_${tenantId}`, JSON.stringify(updated));
      } catch (_) {}

      return updated;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  // Reset to SalonPro defaults
  const resetBranding = async () => {
    if (!tenantId || isSuperAdmin) return;

    setLoading(true);
    try {
      const res = await fetch('/api/tenant/branding/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!res.ok) throw new Error('Error al reiniciar branding');

      const data = await res.json();
      const resetData = { ...DEFAULT_BRANDING, ...data.branding, is_default: true };
      setBranding(resetData);
      applyCssTokens(resetData);

      try {
        localStorage.removeItem(`salon_pro_branding_${tenantId}`);
      } catch (_) {}

      return resetData;
    } finally {
      setLoading(false);
    }
  };

  return (
    <TenantBrandingContext.Provider
      value={{
        branding,
        loading,
        error,
        updateBranding,
        resetBranding,
        refreshBranding: fetchBranding,
        isDefault: branding.is_default
      }}
    >
      {children}
    </TenantBrandingContext.Provider>
  );
}

export function useTenantBranding() {
  const context = useContext(TenantBrandingContext);
  if (!context) {
    return {
      branding: DEFAULT_BRANDING,
      loading: false,
      error: null,
      updateBranding: async () => {},
      resetBranding: async () => {},
      refreshBranding: async () => {},
      isDefault: true
    };
  }
  return context;
}

