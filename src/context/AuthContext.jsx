import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { dataService } from '../utils/dataService';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    try {
      const savedUser = typeof window !== 'undefined' ? localStorage.getItem('salon_pro_user') : null;
      return savedUser ? JSON.parse(savedUser) : null;
    } catch (e) {
      if (typeof window !== 'undefined') localStorage.removeItem('salon_pro_user');
      return null;
    }
  });
  const [loading, setLoading] = useState(false);
  const [sessionTerminatedReason, setSessionTerminatedReason] = useState(null);
  const userRef = useRef(user);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Heartbeat de seguridad: valida periódicamente (y al cargar) si la sesión está activa y la auto-registra
  useEffect(() => {
    if (!user) return;

    const performCheck = async () => {
      const currentUser = userRef.current;
      if (!currentUser) return;

      try {
        const check = await dataService.checkSessionStatus(currentUser.sessionId, currentUser.id, currentUser.role);
        if (check && check.valid === false) {
          console.warn('[SECURITY] Sesión invalidada por el servidor:', check.reason);
          const reasonMsg = check.reason === 'user_deleted' 
            ? 'Tu cuenta de usuario ha sido eliminada o desactivada por un administrador.' 
            : 'Tu sesión ha sido cerrada remotamente por seguridad.';
          
          setSessionTerminatedReason(reasonMsg);
          setUser(null);
          localStorage.removeItem('salon_pro_user');
          alert(`⚠️ Sesión finalizada: ${reasonMsg}`);
          window.location.href = '/login';
        } else if (check && check.sessionId && check.sessionId !== currentUser.sessionId) {
          const updated = { ...currentUser, sessionId: check.sessionId };
          setUser(updated);
          localStorage.setItem('salon_pro_user', JSON.stringify(updated));
        }
      } catch (err) {
        // En caso de corte de conexión temporal se mantiene sesión
      }
    };

    // Ejecutar chequeo/registro inmediato al inicio
    performCheck();

    const checkInterval = setInterval(performCheck, 10000);
    return () => clearInterval(checkInterval);
  }, [user?.id]);

  const login = async (email, password) => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      
      const data = await response.json();
      if (!response.ok) {
        const error = new Error(data.error || 'Error al iniciar sesión');
        error.status = data.status;
        error.id = data.id;
        throw error;
      }

      setUser(data);
      localStorage.setItem('salon_pro_user', JSON.stringify(data));
      setSessionTerminatedReason(null);
      return true;
    } catch (err) {
      console.error('Login error:', err.message);
      throw err;
    }
  };

  const logout = () => {
    if (user) {
      dataService.logoutSession(user.sessionId, user.id, user.nombre || user.name);
    }
    setUser(null);
    localStorage.removeItem('salon_pro_user');
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

