import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { dataService } from '../utils/dataService';

const AuthContext = createContext(null);

const SESSION_REPLACED_TEXT = 'Tu sesión se cerró porque se inició sesión con esta cuenta en otro dispositivo.';

function clearLocalAuthAndBrandingStorage() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem('salon_pro_user');
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('salon_pro_branding_')) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    try {
      const savedUser = typeof window !== 'undefined' ? localStorage.getItem('salon_pro_user') : null;
      return savedUser ? JSON.parse(savedUser) : null;
    } catch {
      if (typeof window !== 'undefined') localStorage.removeItem('salon_pro_user');
      return null;
    }
  });
  const [loading, setLoading] = useState(false);
  const [sessionTerminatedReason, setSessionTerminatedReason] = useState(() => {
    try {
      if (typeof window === 'undefined') return null;
      return sessionStorage.getItem('etereas_session_notice') || localStorage.getItem('etereas_session_notice') || null;
    } catch {
      return null;
    }
  });
  const userRef = useRef(user);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const terminateLocalSessionWithReason = useCallback((rawReason, rawCode, rawErrorMsg) => {
    const isReplaced =
      rawCode === 'SESSION_REPLACED' ||
      rawReason === 'session_replaced' ||
      (rawErrorMsg && String(rawErrorMsg).includes('otro dispositivo'));
    const reasonMsg = isReplaced
      ? SESSION_REPLACED_TEXT
      : rawReason === 'user_deleted'
        ? 'Tu cuenta de usuario ha sido eliminada o desactivada por un administrador.'
        : (rawErrorMsg || 'Tu sesión ha sido cerrada remotamente por seguridad.');

    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem('etereas_session_notice', reasonMsg);
        sessionStorage.setItem('etereas_session_notice', reasonMsg);
      }
    } catch { /* ignore */ }
    clearLocalAuthAndBrandingStorage();

    setSessionTerminatedReason(reasonMsg);
    setUser(null);
  }, []);

  // Escuchar invalidación de sesión detectada en cualquier petición protegida (/api/* -> 401 SESSION_REPLACED / SESSION_REVOKED)
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onInvalidated = (evt) => {
      if (!userRef.current) return;
      const detail = evt?.detail || {};
      terminateLocalSessionWithReason(detail.reason, detail.code, detail.message);
    };
    window.addEventListener('etereas:session-invalidated', onInvalidated);
    return () => window.removeEventListener('etereas:session-invalidated', onInvalidated);
  }, [terminateLocalSessionWithReason]);

  // Sincronizar pestañas del mismo navegador (comparten cookie auth_token y localStorage)
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onStorage = (evt) => {
      if (evt.key === 'etereas_session_notice' && evt.newValue) {
        try {
          sessionStorage.setItem('etereas_session_notice', evt.newValue);
        } catch { /* ignore */ }
        setSessionTerminatedReason(evt.newValue);
      } else if (evt.key === 'salon_pro_user') {
        if (!evt.newValue) {
          try {
            const notice = localStorage.getItem('etereas_session_notice') || sessionStorage.getItem('etereas_session_notice');
            if (notice) {
              sessionStorage.setItem('etereas_session_notice', notice);
              setSessionTerminatedReason(notice);
            }
          } catch { /* ignore */ }
          setUser(null);
        } else {
          try {
            const parsed = JSON.parse(evt.newValue);
            if (parsed && parsed.id) {
              setUser(parsed);
              setSessionTerminatedReason(null);
            }
          } catch { /* ignore */ }
        }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Heartbeat de seguridad: valida periódicamente (y al cargar) si la sesión está activa
  useEffect(() => {
    if (!user) return undefined;

    const performCheck = async () => {
      const currentUser = userRef.current;
      if (!currentUser) return;

      try {
        const check = await dataService.checkSessionStatus(currentUser.sessionId, currentUser.id, currentUser.role);
        if (check && check.valid === false) {
          console.warn('[SECURITY] Sesión invalidada por el servidor:', check.reason || check.code);
          terminateLocalSessionWithReason(check.reason, check.code, check.error);
        } else if (check) {
          let needsUpdate = false;
          let updated = { ...currentUser };

          if (check.sessionId && check.sessionId !== currentUser.sessionId) {
            updated.sessionId = check.sessionId;
            needsUpdate = true;
          }

          if (check.tenant) {
            const prevTenantJson = JSON.stringify(currentUser.tenant || {});
            const nextTenantJson = JSON.stringify(check.tenant);
            if (prevTenantJson !== nextTenantJson) {
              updated.tenant = check.tenant;
              updated.salon_name = check.tenant.business_name || updated.salon_name;
              needsUpdate = true;
            }
          }

          if (needsUpdate) {
            setUser(updated);
            localStorage.setItem('salon_pro_user', JSON.stringify(updated));
          }
        }
      } catch {
        // En caso de corte de conexión temporal se mantiene sesión
      }
    };

    // Ejecutar chequeo inmediato al inicio
    performCheck();

    const checkInterval = setInterval(performCheck, 10000);
    return () => clearInterval(checkInterval);
  }, [user?.id, terminateLocalSessionWithReason]);

  const login = async (email, password) => {
    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      
      const rawText = await response.text();
      let data = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        data = {};
      }
      if (!response.ok) {
        const error = new Error(data.error || `Error al iniciar sesión (HTTP ${response.status})`);
        error.status = data.status;
        error.id = data.id;
        throw error;
      }
      if (!data || !data.id) {
        throw new Error('Respuesta vacía o inválida del servidor al iniciar sesión.');
      }

      clearLocalAuthAndBrandingStorage();
      try {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('etereas_session_notice');
          sessionStorage.removeItem('etereas_session_notice');
        }
      } catch { /* ignore */ }
      setUser(data);
      localStorage.setItem('salon_pro_user', JSON.stringify(data));
      setSessionTerminatedReason(null);
      return true;
    } catch (err) {
      console.error('Login error:', err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    if (user) {
      dataService.logoutSession(user.sessionId, user.id, user.nombre || user.name);
    }
    clearLocalAuthAndBrandingStorage();
    try {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('etereas_session_notice');
        sessionStorage.removeItem('etereas_session_notice');
      }
    } catch { /* ignore */ }
    setSessionTerminatedReason(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, sessionTerminatedReason }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    return {
      user: null,
      login: async () => false,
      logout: () => {},
      loading: false,
      sessionTerminatedReason: null
    };
  }
  return context;
};

