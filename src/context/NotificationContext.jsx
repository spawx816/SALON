import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle, AlertCircle, X } from 'lucide-react';

const NotificationContext = createContext();

export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([]);
  const [persistentNotifications, setPersistentNotifications] = useState([]);

  const showNotification = useCallback((message, type = 'success', persistent = false) => {
    const id = Date.now();
    const newNotif = { id, message, type, time: new Date(), read: false };
    
    if (persistent) {
      setPersistentNotifications(prev => [newNotif, ...prev]);
    } else {
      setNotifications(prev => [...prev, newNotif]);
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== id));
      }, 4000);
    }
  }, []);

  const removeNotification = (id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const removePersistent = (id) => {
    setPersistentNotifications(prev => prev.filter(n => n.id !== id));
  };

  const markAllRead = () => {
    setPersistentNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  return (
    <NotificationContext.Provider value={{ 
      showNotification, 
      persistentNotifications, 
      removePersistent, 
      markAllRead 
    }}>
      {children}
      <div style={{ position: 'fixed', bottom: '2rem', right: '2rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', zIndex: 9999 }}>
        {notifications.map(n => (
          <div 
            key={n.id} 
            style={{ 
              background: 'white', 
              border: '1px solid var(--border-subtle)',
              padding: '1rem 1.25rem', 
              borderRadius: '16px', 
              boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.75rem',
              minWidth: '300px',
              animation: 'slideIn 0.3s ease-out forwards'
            }}
          >
            {n.type === 'success' ? (
              <CheckCircle size={20} color="#10b981" />
            ) : (
              <AlertCircle size={20} color="#ef4444" />
            )}
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{n.message}</span>
            <button 
              onClick={() => removeNotification(n.id)}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', padding: '0.25rem' }}
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </NotificationContext.Provider>
  );
};

export const useNotification = () => useContext(NotificationContext);
