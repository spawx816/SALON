import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';

const EntitlementsContext = createContext(null);

export const EntitlementsProvider = ({ children }) => {
  const { user } = useAuth();
  const [entitlements, setEntitlements] = useState({
    hasSubscription: false,
    plan: 'BASE',
    status: 'active',
    isActive: true,
    features: {
      pos: true,
      cash_registers: true,
      services_catalog: true,
      commissions: true,
      payroll: true,
      attendance: true,
      expenses: true,
      dgii_ecf: true,
      reports: true,
      security: true,
      clients: true,
      memberships: false,
      marketing: false
    },
    limits: {
      users: 3,
      branches: 1
    },
    usage: {
      users: 1,
      branches: 1
    }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const lastFetchedAtRef = useRef(0);

  const fetchEntitlements = useCallback(async () => {
    if (!user || user.isSuperAdmin) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      lastFetchedAtRef.current = Date.now();
      const res = await fetch('/api/tenant/entitlements', {
        cache: 'no-store',
        credentials: 'include',
        headers: {
          'Accept': 'application/json'
        }
      });

      if (res.ok) {
        const data = await res.json();
        setEntitlements(data);
      } else if (res.status === 403) {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || 'Suscripción inactiva o no autorizada');
      }
    } catch (err) {
      setError(err.message || 'Error cargando permisos de plan');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchEntitlements();
  }, [fetchEntitlements]);

  useEffect(() => {
    if (!user || user.isSuperAdmin) return undefined;
    const handleRevalidate = () => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - lastFetchedAtRef.current >= 5000) {
        fetchEntitlements();
      }
    };
    window.addEventListener('focus', handleRevalidate);
    document.addEventListener('visibilitychange', handleRevalidate);
    return () => {
      window.removeEventListener('focus', handleRevalidate);
      document.removeEventListener('visibilitychange', handleRevalidate);
    };
  }, [user, fetchEntitlements]);

  const hasFeature = useCallback((featureKey) => {
    if (user?.isSuperAdmin || user?.role?.toLowerCase() === 'superadmin') return true;
    if (!entitlements) return false;
    // Commercial features blocked if suspended
    const suspended = entitlements.isSuspended || entitlements.status === 'suspended' || entitlements.subscriptionStatus === 'suspended';
    if (suspended) return false;
    return Boolean(entitlements.features?.[featureKey]);
  }, [user, entitlements]);

  const rawPlan = (entitlements?.currentPlan || entitlements?.plan || 'PRINCIPAL').toUpperCase();
  const plan = rawPlan === 'BASE' || rawPlan === 'PRO' ? 'PRINCIPAL' : rawPlan;
  const isSuspended = Boolean(entitlements?.isSuspended || entitlements?.status === 'suspended' || entitlements?.subscriptionStatus === 'suspended');
  const hasMembershipsAddon = Boolean(!isSuspended && (entitlements?.addons?.memberships?.active || entitlements?.features?.memberships));
  const membershipsAddon = entitlements?.addons?.memberships || { active: hasMembershipsAddon, source: 'none', reason: null, expiresAt: null };
  const pricing = entitlements?.pricing || null;
  const isPro = hasMembershipsAddon;
  const isBase = !hasMembershipsAddon;

  return (
    <EntitlementsContext.Provider
      value={{
        entitlements,
        plan,
        isPro,
        isBase,
        hasMembershipsAddon,
        membershipsAddon,
        pricing,
        isSuspended,
        hasFeature,
        canAccess: hasFeature,
        limits: entitlements?.limits || { users: 3, branches: 1 },
        usage: entitlements?.usage || { users: 1, branches: 1 },
        loading,
        error,
        refetch: fetchEntitlements
      }}
    >
      {children}
    </EntitlementsContext.Provider>
  );
};

export const useEntitlements = () => {
  const context = useContext(EntitlementsContext);
  if (!context) {
    // Fallback seguro si se usa fuera del Provider
    return {
      entitlements: null,
      plan: 'PRINCIPAL',
      isPro: false,
      isBase: true,
      hasMembershipsAddon: false,
      membershipsAddon: { active: false, source: 'none', reason: null, expiresAt: null },
      pricing: null,
      isSuspended: false,
      hasFeature: () => false,
      canAccess: () => false,
      limits: { users: 3, branches: 1 },
      usage: { users: 1, branches: 1 },
      loading: false,
      error: null,
      refetch: async () => {}
    };
  }
  return context;
};

