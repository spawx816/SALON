/**
 * HOTFIX STAGING — /visitas
 * Regression suite: ThermalTicketModal must never read properties of a null
 * `printableTicketData`, parents must guard modal mounts, and ErrorBoundary
 * must not leak technical details in production builds.
 *
 * Renders real components through Vite SSR (no JSDOM dependency).
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let passed = 0;
let failed = 0;
async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ❌ [FAIL] ${name}\n         ${err && err.message}`);
  }
}

async function withVite(nodeEnv, fn) {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = nodeEnv;
  const { createServer } = await import('vite');
  const server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    mode: nodeEnv === 'production' ? 'production' : 'development',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    esbuild: { jsx: 'automatic' },
    oxc: { jsx: { runtime: 'automatic' } }
  });
  try {
    return await fn(server);
  } finally {
    await server.close();
    process.env.NODE_ENV = previous;
  }
}

const SAMPLE_TICKET = {
  ticketNumber: 'T-0001',
  clientName: 'Clienta Sintética',
  receptionistName: 'Recepción Demo',
  isPlanBeauty: false,
  isBirthdayWeek: false,
  services: [],
  total: 600
};

async function main() {
  console.log('========================================================================');
  console.log('🛠️  SUITE: HOTFIX /visitas — ThermalTicketModal null-safety');
  console.log('========================================================================');

  // ---------------------------------------------------------------- static
  await step('Static: modal has no direct `printableTicketData.` property access', () => {
    const src = read('src/components/visits/ThermalTicketModal.jsx');
    assert.ok(!/printableTicketData\s*\./.test(src), 'direct property access found');
    assert.ok(!/printableTicketData\s*=\s*\{\s*\}/.test(src), 'default {} must not mask null');
    assert.ok(/if\s*\(\s*!isOpen\s*\|\|\s*!printableTicketData\s*\)\s*return null/.test(src), 'early null guard missing');
  });

  await step('Static: VisitRecorder mounts ThermalTicketModal only with data', () => {
    const src = read('src/components/visits/VisitRecorder.jsx');
    assert.ok(/showPrintModal\s*&&\s*printableTicketData\s*&&/.test(src), 'parent guard missing');
  });

  await step('Static: ErrorBoundary hides raw error outside DEV and exposes error_id', () => {
    const src = read('src/components/common/ErrorBoundary.jsx');
    assert.ok(/isDev\s*&&\s*this\.state\.error/.test(src), 'raw error must be gated by isDev');
    assert.ok(/error_id/.test(src), 'error_id must be logged');
    assert.strictEqual((src.match(/export default/g) || []).length, 1, 'single default export');
  });

  // ---------------------------------------------------------------- SSR (dev)
  await withVite('development', async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { ThermalTicketModal } = await server.ssrLoadModule('/src/components/visits/ThermalTicketModal.jsx');
    const h = React.createElement;
    const render = (props) => renderToStaticMarkup(h(ThermalTicketModal, { onClose: () => {}, ...props }));

    await step('Closed modal + null data renders nothing', () => {
      assert.strictEqual(render({ isOpen: false, printableTicketData: null }), '');
    });
    await step('Open modal + null data renders nothing (no TypeError)', () => {
      assert.strictEqual(render({ isOpen: true, printableTicketData: null }), '');
    });
    await step('Open modal + undefined data renders nothing', () => {
      assert.strictEqual(render({ isOpen: true, printableTicketData: undefined }), '');
    });
    await step('Open modal + valid data renders ticket with business_name', () => {
      const html = render({ isOpen: true, printableTicketData: { ...SAMPLE_TICKET, business_name: 'Tenant Alfa Studio' } });
      assert.ok(html.includes('Tenant Alfa Studio'), 'business_name not rendered');
      assert.ok(html.includes('TOTAL'), 'total box not rendered');
    });
    await step('Tenant without business_name falls back to salon_name', () => {
      const html = render({ isOpen: true, printableTicketData: { ...SAMPLE_TICKET, salon_name: 'Salón Beta' } });
      assert.ok(html.includes('Salón Beta'));
    });
    await step('Tenant without any name and no logo renders neutral fallback', () => {
      const html = render({ isOpen: true, printableTicketData: { ...SAMPLE_TICKET } });
      assert.ok(html.length > 0, 'ticket should still render');
      assert.ok(!/undefined|null/.test(html.replace(/data-[a-z-]+="[^"]*"/g, '')), 'leaked undefined/null text');
    });
    await step('Pre-cuenta and currentUser=null render safely', () => {
      const html = render({ isOpen: true, currentUser: null, printableTicketData: { ...SAMPLE_TICKET, receptionistName: undefined, isPrecuenta: true } });
      assert.ok(html.length > 0);
    });
  });

  // ---------------------------------------------------------------- SSR (prod)
  await withVite('production', async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const mod = await server.ssrLoadModule('/src/components/common/ErrorBoundary.jsx');
    const ErrorBoundary = mod.default;

    await step('ErrorBoundary (production) shows neutral message + error ID, no raw error', () => {
      const secret = new TypeError("Cannot read properties of null (reading 'business_name')");
      const derived = ErrorBoundary.getDerivedStateFromError(secret);
      assert.ok(/^ERR-[A-Z0-9]+-[A-Z0-9]+$/.test(derived.errorId), 'invalid error id format');
      const instance = new ErrorBoundary({ children: null });
      instance.state = { ...instance.state, ...derived };
      const html = renderToStaticMarkup(React.createElement(React.Fragment, null, instance.render()));
      assert.ok(html.includes(derived.errorId), 'error id not displayed');
      assert.ok(!html.includes('business_name'), 'raw error leaked in production UI');
      assert.ok(!html.includes('TypeError'), 'error type leaked in production UI');
    });
  });

  console.log('------------------------------------------------------------------------');
  console.log(`Resultado: ${passed} PASS / ${failed} FAIL`);
  if (failed > 0) process.exit(1);
  console.log('🎉 HOTFIX /visitas VERIFICADO');
  process.exit(0);
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
