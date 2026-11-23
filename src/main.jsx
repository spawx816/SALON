import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initGlobalErrorReporting, reportClientError } from './utils/errorReporter'

// Global Fetch Interceptor: ensure credentials: 'include' + silent 5xx error reporting
if (typeof window !== 'undefined' && window.fetch) {
  const originalFetch = window.fetch;
  window.__etereasOriginalFetch = originalFetch;
  initGlobalErrorReporting();
  window.fetch = async (resource, config = {}) => {
    let url = '';
    if (typeof resource === 'string') {
      url = resource;
    } else if (resource && resource.url) {
      url = resource.url;
    }

    if (url.includes('/api/')) {
      // HttpOnly cookie transport - always include credentials
      config.credentials = config.credentials || 'include';
    }

    try {
      const response = await originalFetch(resource, config);
      if (url.includes('/api/') && !url.includes('/api/client-errors') && response.status >= 500) {
        reportClientError({
          type: `api_http_${response.status}`,
          message: `Error ${response.status} en ${config?.method || 'GET'} ${url}`,
          method: config?.method || 'GET',
          statusCode: response.status,
          url,
        });
      }
      return response;
    } catch (networkErr) {
      const isBenignNavAbort =
        networkErr?.name === 'AbortError' ||
        url.includes('/api/auth/logout') ||
        (typeof document !== 'undefined' && document.visibilityState === 'hidden');
      if (url.includes('/api/') && !url.includes('/api/client-errors') && !isBenignNavAbort) {
        reportClientError({
          type: 'api_network_error',
          message: networkErr?.message || `Fallo de red en ${url}`,
          stack: networkErr?.stack || '',
          method: config?.method || 'GET',
          url,
        });
      }
      throw networkErr;
    }
  };
}

// Safeguard against IDE custom webview event loop freezing on alert()
if (typeof window !== 'undefined') {
  window.alert = (message) => {
    console.log('[ALERT BYPASSED]', message);
    
    // Create a beautiful floating glassmorphism toast notification in the DOM
    const toast = document.createElement('div');
    toast.style.position = 'fixed';
    toast.style.top = '24px';
    toast.style.right = '24px';
    toast.style.background = 'rgba(9, 9, 11, 0.95)';
    toast.style.color = '#ffffff';
    toast.style.padding = '16px 24px';
    toast.style.borderRadius = '16px';
    toast.style.boxShadow = '0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2)';
    toast.style.backdropFilter = 'blur(12px)';
    toast.style.border = '1px solid rgba(255, 255, 255, 0.1)';
    toast.style.fontFamily = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";
    toast.style.fontSize = '0.9rem';
    toast.style.fontWeight = '600';
    toast.style.zIndex = '99999';
    toast.style.transition = 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
    toast.style.transform = 'translateY(-20px)';
    toast.style.opacity = '0';
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.gap = '12px';
    
    // Icon
    const icon = document.createElement('span');
    icon.innerHTML = '✨';
    icon.style.fontSize = '1.2rem';
    
    const text = document.createElement('span');
    text.innerText = message;
    
    toast.appendChild(icon);
    toast.appendChild(text);
    document.body.appendChild(toast);
    
    // Trigger animation
    requestAnimationFrame(() => {
      toast.style.transform = 'translateY(0)';
      toast.style.opacity = '1';
    });
    
    // Remove after 4s
    setTimeout(() => {
      toast.style.transform = 'translateY(-20px)';
      toast.style.opacity = '0';
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, 4000);
  };
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

