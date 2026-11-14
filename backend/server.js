const path = require('path');
if (process.env.NODE_ENV !== 'test') {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
}

const fs = require('fs');
const axios = require('axios');
const { pool } = require('./db');
const { createApp } = require('./app');
const { processSubscriptionsInternal } = require('./routes/contracts.routes');

// Instantiate Express application with production database pool
const app = createApp({ pool });

// Setup Database Schema for legacy MySQL (if applicable)
const setupDB = async () => {
  if (pool.isPostgres) {
    console.log(`✅ [DB] PostgreSQL activo en ${process.env.DB_HOST}:${process.env.DB_PORT || '5432'}: Esquema gestionado nativamente.`);
    return;
  }
};
setupDB();

// CardNet Configuration for background scheduler
const CARDNET_CONFIG = {
  MERCHANT_NUMBER: process.env.CARDNET_MERCHANT_NUMBER,
  TERMINAL_ID: process.env.CARDNET_TERMINAL_ID,
  BASE_URL: process.env.CARDNET_BASE_URL,
  PUBLIC_KEY: process.env.CARDNET_PUBLIC_KEY,
  PRIVATE_KEY: process.env.CARDNET_PRIVATE_KEY,
  ENV: process.env.CARDNET_ENV,
  TIMEOUT: parseInt(process.env.CARDNET_TIMEOUT) || 30000
};

const getCardNetAuthHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Basic ${CARDNET_CONFIG.PRIVATE_KEY}`
});

// REMOVED (JOB-001 / JOB-002): startInternalScheduler with setInterval and SPAWX hostname checks abolished.
// Background billing jobs must run through standalone workers (backend/workers/billing.worker.cjs).

// === SEO Engine & Pre-rendering Fallback for React Router ===
function getSeoContentForPath(reqPath) {
  const defaults = {
    title: 'Plan Beauty RD | Plan mensual de lavados y peinados',
    description: 'Disfruta lavados y peinados mensuales en salones afiliados de República Dominicana por RD$1,950 al mes. Cuida tu cabello de forma premium.',
    canonical: 'https://planbeautyrd.com' + reqPath,
    robots: 'index, follow',
    schema: null,
    htmlContent: ''
  };

  const noIndexPaths = ['/login', '/registro', '/registro-cliente', '/lista-clientes', '/visitas', '/mis-servicios', '/dashboard', '/pagos', '/planes', '/equipo', '/sucursales', '/configuracion', '/regalos', '/encuesta', '/activar'];
  const shouldNoIndex = noIndexPaths.some(p => reqPath.startsWith(p));

  return {
    ...defaults,
    title: reqPath === '/login' ? 'Iniciar sesión | Plan Beauty RD' : defaults.title,
    description: reqPath === '/login' ? 'Accede a tu cuenta de cliente o administración de Plan Beauty.' : defaults.description,
    robots: shouldNoIndex ? 'noindex, nofollow' : 'index, follow'
  };
}

// API 404 JSON fallback - never serve SPA HTML for /api/* routes
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint de API no encontrado',
    code: 'API_ROUTE_NOT_FOUND'
  });
});

// SPA Fallback for React Router - MUST BE AFTER ALL API ROUTES
app.get(/.*/, (req, res) => {
  if (req.path.includes('.')) {
    return res.status(404).send('Not Found');
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
  fs.readFile(indexPath, 'utf8', (err, html) => {
    if (err) {
      return res.sendFile(indexPath);
    }

    try {
      const seo = getSeoContentForPath(req.path);
      let modifiedHtml = html;
      modifiedHtml = modifiedHtml.replace(/<title>.*?<\/title>/, `<title>${seo.title}</title>`);
      modifiedHtml = modifiedHtml.replace(/<meta name="description" content=".*?" \/>/, `<meta name="description" content="${seo.description}" />`);
      modifiedHtml = modifiedHtml.replace(/<link id="canonical-link" rel="canonical" href=".*?" \/>/, `<link id="canonical-link" rel="canonical" href="${seo.canonical}" />`);
      modifiedHtml = modifiedHtml.replace(/<meta id="robots-meta" name="robots" content=".*?">/, `<meta id="robots-meta" name="robots" content="${seo.robots}">`);
      res.send(modifiedHtml);
    } catch (seoErr) {
      console.error('[SEO INJECTION ERROR]:', seoErr.message);
      res.send(html);
    }
  });
});

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION PREVENTED]:', err.message);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION PREVENTED]:', reason);
});

const { GracefulShutdownCoordinator } = require('./utils/graceful_shutdown.coordinator.cjs');

const PORT = process.env.PORT || 5005;
let serverInstance = null;
const shutdownCoordinator = new GracefulShutdownCoordinator();

// Register graceful shutdown middleware
app.use(shutdownCoordinator.createMiddleware());

const isMainOrLauncher = require.main === module ||
  (require.main && (
    require.main.filename === path.resolve(__dirname, 'server.js') ||
    require.main.filename === path.resolve(__dirname, '..', 'server.js')
  )) ||
  (process.argv[1] && (
    process.argv[1].endsWith('server.js') ||
    process.argv[1].endsWith('server.cjs')
  ));

if (isMainOrLauncher) {
  serverInstance = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Salon Pro SaaS API Server running securely on http://127.0.0.1:${PORT}`);
    // Explicit server timeouts (REM-P2-07)
    serverInstance.headersTimeout = parseInt(process.env.HTTP_HEADERS_TIMEOUT_MS || '65000', 10);
    serverInstance.requestTimeout = parseInt(process.env.HTTP_REQUEST_TIMEOUT_MS || '30000', 10);
    serverInstance.keepAliveTimeout = parseInt(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS || '61000', 10);

    shutdownCoordinator.registerServer(serverInstance);
    shutdownCoordinator.attachProcessSignals();
  });
}

module.exports = {
  app,
  get server() { return serverInstance; },
  shutdownCoordinator
};
