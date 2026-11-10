import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';

const DEFAULT_BRANDING = Object.freeze({
  business_name: 'SalonPro',
  logo_url: null,
  logo_dark_url: null,
  favicon_url: null,
  primary_color: '#0f172a',
  secondary_color: '#d4af37',
  accent_color: '#3b82f6',
  background_color: '#ffffff',
  surface_color: '#ffffff',
  text_color: '#0f172a',
  receipt_header: 'SalonPro - Sistema de Gestión',
  receipt_footer: '¡Gracias por preferirnos! ♡',
  is_default: true
});

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

  const tenantId = user?.tenant_id || user?.tenant?.id || null;

  // Apply CSS design tokens to the document root
  const applyCssTokens = useCallback((theme) => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.style.setProperty('--tenant-primary', theme.primary_color || DEFAULT_BRANDING.primary_color);
    root.style.setProperty('--tenant-secondary', theme.secondary_color || DEFAULT_BRANDING.secondary_color);
    root.style.setProperty('--tenant-accent', theme.accent_color || DEFAULT_BRANDING.accent_color);
    root.style.setProperty('--tenant-background', theme.background_color || DEFAULT_BRANDING.background_color);
    root.style.setProperty('--tenant-surface', theme.surface_color || DEFAULT_BRANDING.surface_color);
    root.style.setProperty('--tenant-text', theme.text_color || DEFAULT_BRANDING.text_color);
  }, []);

  // Fetch branding from API
  const fetchBranding = useCallback(async () => {
    if (!user || isSuperAdmin || !tenantId) {
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
        throw new Error('Error al obtener la personalización del salón');
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
  }, [user, isSuperAdmin, tenantId, applyCssTokens]);

  useEffect(() => {
    fetchBranding();
  }, [fetchBranding]);

  // Update branding
  const updateBranding = async (payload) => {
    if (!tenantId || isSuperAdmin) {
      throw new Error('No autorizado para modificar branding del salón');
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

