import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

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

