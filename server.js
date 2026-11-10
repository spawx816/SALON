/**
 * SalonPro SaaS - Canonical Launcher
 *
 * This launcher strictly delegates to backend/server.js to guarantee absolute
 * behavioral parity between local development, testing, package.json scripts,
 * and PM2 production process managers.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const canonicalBackend = require('./backend/server.js');

export default canonicalBackend;
export const app = canonicalBackend.app;
export const server = canonicalBackend.server;
export const startInternalScheduler = canonicalBackend.startInternalScheduler;
