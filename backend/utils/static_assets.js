const fs = require('fs');
const path = require('path');

const ASSET_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function resolveAssetsCacheDir() {
  const storageRoot = process.env.STORAGE_ROOT_DIR;
  if (storageRoot && storageRoot.trim()) {
    return path.join(storageRoot.trim(), 'assets_cache');
  }
  return null;
}

/**
 * Copies current Vite hashed JS/CSS assets into a persistent cache directory so
 * tabs open before a rolling/container deploy can still load lazy chunks, and
 * prunes cached assets older than 7 days.
 */
function syncDistAssetsCache(distDir, cacheDir = resolveAssetsCacheDir()) {
  if (!cacheDir) return;
  const distAssetsDir = path.join(distDir, 'assets');
  if (!fs.existsSync(distAssetsDir)) return;

  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    const now = Date.now();
    const files = fs.readdirSync(distAssetsDir);
    for (const file of files) {
      if (!/\.(js|css|mjs)$/i.test(file)) continue;
      const src = path.join(distAssetsDir, file);
      const dst = path.join(cacheDir, file);
      const stat = fs.statSync(src);
      if (!stat.isFile()) continue;
      if (!fs.existsSync(dst)) {
        fs.copyFileSync(src, dst);
      }
      try {
        fs.utimesSync(dst, new Date(now), new Date(now));
      } catch { /* ignore utimes errors */ }
    }

    const cachedFiles = fs.readdirSync(cacheDir);
    for (const file of cachedFiles) {
      const dst = path.join(cacheDir, file);
      try {
        const stat = fs.statSync(dst);
        if (stat.isFile() && now - stat.mtimeMs > ASSET_CACHE_TTL_MS) {
          fs.unlinkSync(dst);
        }
      } catch { /* ignore cleanup errors */ }
    }
  } catch (err) {
    console.warn('[STATIC ASSETS CACHE] Sync skipped:', err.message);
  }
}

function setStaticCacheHeaders(res, filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  if (normalized.endsWith('/index.html') || normalized.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return;
  }
  if (normalized.includes('/assets/') && /\.(js|mjs|css|woff2?|svg|png|jpe?g|webp|ico)$/i.test(normalized)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}

function createAssetsFallbackMiddleware(cacheDir = resolveAssetsCacheDir()) {
  return (req, res) => {
    const cleanName = path.basename(req.path || '');
    if (cacheDir && cleanName && /^[a-zA-Z0-9._-]+\.(js|mjs|css)$/.test(cleanName)) {
      const cachedPath = path.join(cacheDir, cleanName);
      if (fs.existsSync(cachedPath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        if (cleanName.endsWith('.css')) {
          res.setHeader('Content-Type', 'text/css; charset=utf-8');
        } else {
          res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        }
        return res.sendFile(cachedPath);
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(404).send('Not Found');
  };
}

module.exports = {
  resolveAssetsCacheDir,
  syncDistAssetsCache,
  setStaticCacheHeaders,
  createAssetsFallbackMiddleware
};
