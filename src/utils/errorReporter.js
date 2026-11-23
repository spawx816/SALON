/**
 * Global Frontend Error Reporter
 * Captures uncaught runtime errors, unhandled promise rejections, React ErrorBoundary crashes,
 * and 5xx API failures, reporting them silently to POST /api/client-errors with local deduplication.
 */

const DEDUP_WINDOW_MS = 60 * 1000;
const recentFingerprints = new Map();
let initialized = false;

function getSavedUserContext() {
  try {
    const raw = window.localStorage.getItem('salon_pro_user');
    if (!raw) return {};
    const u = JSON.parse(raw);
    return {
      userEmail: u?.email || u?.username || undefined,
      userRole: u?.role || u?.rol || undefined,
      tenantId: u?.tenant_id || u?.tenantId || undefined,
    };
  } catch {
    return {};
  }
}

export function reportClientError({
  type = 'frontend_error',
  message = 'Error desconocido en interfaz',
  stack = '',
  componentStack = '',
  errorId = undefined,
  statusCode = undefined,
  method = undefined,
  url = undefined,
} = {}) {
  try {
    if (typeof window === 'undefined') return;
    const targetUrl = String(url || window.location.href || '');
    // Prevent infinite feedback loops
    if (targetUrl.includes('/api/client-errors')) return;

    const cleanMsg = String(message || '').slice(0, 500);
    const fp = `${type}|${targetUrl.split('?')[0]}|${cleanMsg.slice(0, 120)}`;
    const now = Date.now();
    const last = recentFingerprints.get(fp);
    if (last && now - last < DEDUP_WINDOW_MS) return;
    recentFingerprints.set(fp, now);
    if (recentFingerprints.size > 100) {
      const oldest = recentFingerprints.keys().next().value;
      recentFingerprints.delete(oldest);
    }

    const userCtx = getSavedUserContext();
    const payload = {
      type: String(type).slice(0, 80),
      message: cleanMsg,
      stack: String(stack || '').slice(0, 2500),
      componentStack: String(componentStack || '').slice(0, 1200),
      errorId: errorId ? String(errorId).slice(0, 64) : undefined,
      statusCode: statusCode ? Number(statusCode) : undefined,
      method: method ? String(method).slice(0, 16) : undefined,
      url: targetUrl.slice(0, 300),
      userAgent: String(navigator.userAgent || '').slice(0, 220),
      ...userCtx,
    };

    const nativeFetch = window.__etereasOriginalFetch || window.fetch;
    if (typeof nativeFetch === 'function') {
      nativeFetch('/api/client-errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        keepalive: true,
        body: JSON.stringify(payload),
      }).catch(() => {});
    }
  } catch {
    // Silent fail: error reporting must never break the app
  }
}

export function initGlobalErrorReporting() {
  if (typeof window === 'undefined' || initialized) return;
  initialized = true;

  window.addEventListener('error', (event) => {
    const err = event?.error;
    const msg = err?.message || event?.message || 'Uncaught window error';
    const stack = err?.stack || `${event?.filename || ''}:${event?.lineno || 0}:${event?.colno || 0}`;
    reportClientError({
      type: 'window_error',
      message: msg,
      stack,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason;
    const msg = reason instanceof Error
      ? reason.message
      : (typeof reason === 'string' ? reason : JSON.stringify(reason || 'Unhandled promise rejection'));
    const stack = reason instanceof Error ? (reason.stack || '') : '';
    reportClientError({
      type: 'unhandled_promise_rejection',
      message: msg,
      stack,
    });
  });
}
