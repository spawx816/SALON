import { lazy } from 'react';

const CHUNK_ERROR_PATTERNS = [
  'failed to fetch dynamically imported module',
  'importing a module script failed',
  'error loading dynamically imported module',
  'loading chunk',
  'chunkloaderror'
];

export function isChunkLoadError(error) {
  if (!error) return false;
  if (error.isChunkLoadError) return true;
  const name = String(error.name || '').toLowerCase();
  const msg = String(error.message || error).toLowerCase();
  return name.includes('chunkloaderror') || CHUNK_ERROR_PATTERNS.some((p) => msg.includes(p));
}

export function getAppEntryVersion() {
  if (typeof document === 'undefined') return 'ssr';
  const entry = document.querySelector('script[type="module"][src*="/assets/"]');
  const src = entry?.getAttribute('src') || '';
  const match = src.match(/\/assets\/([^/?#]+)/);
  return match ? match[1] : (src || 'unknown');
}

function hasUnsavedWork() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (window.__ETEREAS_DIRTY_FORM__ === true) return true;

  const controls = document.querySelectorAll('form input, form textarea, form select, [role="dialog"] input, [role="dialog"] textarea');
  for (const el of controls) {
    if (el.type === 'hidden' || el.disabled || el.readOnly) continue;
    if (el.type === 'checkbox' || el.type === 'radio') {
      if (el.checked !== el.defaultChecked) return true;
    } else if (String(el.value || '') !== String(el.defaultValue || '')) {
      return true;
    }
  }
  return false;
}

export function lazyWithRetry(importer, chunkName = 'module') {
  return lazy(async () => {
    const version = getAppEntryVersion();
    try {
      return await importer();
    } catch (error) {
      if (!isChunkLoadError(error)) {
        throw error;
      }

      const retryKey = `etereas_chunk_retry:${version}`;
      let alreadyRetried = false;
      try {
        alreadyRetried = sessionStorage.getItem(retryKey) === '1';
      } catch {
        alreadyRetried = true;
      }

      const unsaved = hasUnsavedWork();
      console.error(JSON.stringify({
        level: 'error',
        event: 'DYNAMIC_IMPORT_FAILED',
        chunk: chunkName,
        version,
        already_retried: alreadyRetried,
        has_unsaved_work: unsaved,
        message: String(error?.message || error)
      }));

      if (!alreadyRetried && !unsaved && typeof window !== 'undefined') {
        try {
          sessionStorage.setItem(retryKey, '1');
        } catch { /* ignore storage restrictions */ }
        window.location.reload();
        return new Promise(() => {});
      }

      const enriched = error instanceof Error ? error : new Error(String(error));
      enriched.isChunkLoadError = true;
      enriched.appVersion = version;
      enriched.chunkName = chunkName;
      throw enriched;
    }
  });
}
