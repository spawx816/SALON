/* global document */
'use strict';

/**
 * E2E Browser + API + DB Verification Suite:
 * Simplificación de la sección de renovación en "Mi suscripción" (/facturacion-saas)
 * y Consentimiento Recurrente Separado durante la contratación (/ Landing).
 */

const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const bcrypt = require('bcryptjs');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');
const {
  validateTestEnvironment,
  createIsolatedTestPool,
  getSanitizedChildEnv,
} = require('../utils/test_env_guard.cjs');

function findBrowserExecutable() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return undefined;
}

function getEphemeralPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function waitForServerHealth(port, maxWaitMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on('error', retry);
      req.setTimeout(1000, () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - start > maxWaitMs) return reject(new Error(`Server failed to start on port ${port}`));
      setTimeout(check, 200);
    };
    check();
  });
}

async function main() {
  const testConfig = validateTestEnvironment();
  const pool = createIsolatedTestPool(testConfig);
  const appPort = await getEphemeralPort();
  const baseUrl = `http://127.0.0.1:${appPort}`;
  const tag = crypto.randomBytes(4).toString('hex');
  const PASS = 'EtereasSub!2026';
  const passHash = await bcrypt.hash(PASS, 10);

  const createdTenantIds = [];
  let fxRateBackup = [];
  let serverProc = null;
  let browser = null;

  const createAccountFixture = async ({
    label,
    status = 'active',
    autoRenew = true,
    cancelAtPeriodEnd = false,
    hasConsent = true,
    consentVersion = 'v2026.1',
    periodicityMode = 'calendar_month',
    hasPaymentMethod = true,
  }) => {
    const tenantId = crypto.randomUUID();
    const branchId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const subId = crypto.randomUUID();
    const email = `sub_${label}_${tag}@test.local`;
    createdTenantIds.push(tenantId);

    await pool.query(
      `INSERT INTO tenants (id, business_name, slug, email, owner_name, owner_email, status, licensed_branches, max_branches, extra_user_seats, max_users)
       VALUES (?, ?, ?, ?, ?, ?, 'active', 1, 1, 0, 3)`,
      [tenantId, `Empresa ${label} ${tag}`, `emp-${label}-${tag}`, email, `Owner ${label}`, email]
    );
    await pool.query(
      `INSERT INTO branches (id, tenant_id, name, is_main, is_active)
       VALUES (?, ?, 'Sucursal Principal', TRUE, TRUE)`,
      [branchId, tenantId]
    );
    await pool.query(
      `INSERT INTO salons (id, tenant_id, name, status)
       VALUES (?, ?, 'Sucursal Principal', 'Active')`,
      [branchId, tenantId]
    );
    await pool.query(
      `INSERT INTO users (id, tenant_id, branch_id, name, nombre, email, password_hash, role, is_active, estado)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'owner', TRUE, 'Activo')`,
      [userId, tenantId, branchId, `Owner ${label}`, `Owner ${label}`, email, passHash]
    );

    const periodStart = '2026-11-15T12:00:00.000Z';
    const periodEnd = '2026-12-15T12:00:00.000Z';
    await pool.query(
      `INSERT INTO tenant_subscriptions (
         id, tenant_id, plan_code, status, billing_cycle, currency,
         periodicity_mode, billing_anchor_day, auto_renew, cancel_at_period_end,
         recurring_consent_at, recurring_consent_version,
         current_period_start, current_period_end, updated_at
       ) VALUES (?, ?, 'PRINCIPAL', ?, 'monthly', 'DOP', ?, 15, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        subId,
        tenantId,
        status,
        periodicityMode,
        autoRenew,
        cancelAtPeriodEnd,
        hasConsent ? periodStart : null,
        hasConsent ? consentVersion : null,
        periodStart,
        periodEnd,
      ]
    );

    if (hasConsent) {
      await pool.query(
        `INSERT INTO tenant_terms_acceptances (
           tenant_id, user_id, terms_version, document_hash, accepted_at_utc,
           acceptance_mechanism, recurring_authorized
         ) VALUES (?, ?, ?, 'hash_v2026_1_test', NOW(), 'onboarding_checkbox', TRUE)`,
        [tenantId, userId, consentVersion]
      );
    }

    if (hasPaymentMethod) {
      await pool.query(
        `INSERT INTO saas_payment_methods (
           tenant_id, gateway_type, token_reference, provider_customer_id,
           last4, brand, exp_month, exp_year, is_default
         ) VALUES (?, 'cardnet', ?, ?, '4242', 'visa', 12, 2029, TRUE)`,
        [tenantId, `tok_${tenantId.slice(0, 8)}`, `cus_${tenantId.slice(0, 8)}`]
      );
    }

    return { tenantId, branchId, userId, email };
  };

  try {
    const [existingFx] = await pool.query('SELECT * FROM saas_fx_rates WHERE pair = ?', ['USD_DOP']);
    fxRateBackup = existingFx || [];
    await pool.query('DELETE FROM saas_fx_rates WHERE pair = ?', ['USD_DOP']);
    await pool.query(
      `INSERT INTO saas_fx_rates (pair, rate, rate_scaled_10000, updated_by_email, reason, created_at, updated_at)
       VALUES ('USD_DOP', 60.0000, 600000, 'qa@etereas.test', 'Tasa controlada prueba UI renovación', NOW(), NOW())`
    );

    const accAuthorized = await createAccountFixture({
      label: 'auth',
      hasConsent: true,
      hasPaymentMethod: true,
      periodicityMode: 'calendar_month',
    });
    const accNoConsent = await createAccountFixture({
      label: 'noconsent',
      autoRenew: false,
      hasConsent: false,
      hasPaymentMethod: true,
      periodicityMode: 'fixed_30_days',
    });
    const accNoMethod = await createAccountFixture({
      label: 'nomethod',
      hasConsent: true,
      hasPaymentMethod: false,
      periodicityMode: 'calendar_month',
    });
    const accCancelled = await createAccountFixture({
      label: 'cancelled',
      status: 'cancelled',
      autoRenew: false,
      cancelAtPeriodEnd: true,
      hasConsent: true,
      hasPaymentMethod: true,
      periodicityMode: 'calendar_month',
    });

    const env = getSanitizedChildEnv(testConfig, appPort);
    env.SAAS_RENEWAL_WORKER_ENABLED = 'false';
    env.DISABLE_SCHEDULER = 'true';
    env.DGII_ENV = 'disabled';

    serverProc = spawn(process.execPath, [path.resolve(__dirname, '..', 'server.js')], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForServerHealth(appPort);

    const executablePath = findBrowserExecutable();
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const loginAndOpenBilling = async (email) => {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport({ width: 1366, height: 900 });
      const pageErrors = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));

      await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle2' });
      const loginRes = await page.evaluate(async (userEmail, userPass) => {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: userEmail, password: userPass }),
        });
        const data = await res.json();
        const userObj = data?.user || data;
        if (res.ok && userObj && userObj.id) {
          localStorage.setItem('salon_pro_user', JSON.stringify(userObj));
        }
        return { status: res.status };
      }, email, PASS);
      assert.strictEqual(loginRes.status, 200);

      await page.goto(`${baseUrl}/facturacion-saas`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('#sb-next-charge-title', { timeout: 15000 });
      return { ctx, page, pageErrors };
    };

    // =========================================================================
    // 1. CUENTA AUTORIZADA CON MÉTODO APTO (y worker desactivado)
    // =========================================================================
    {
      const { ctx, page, pageErrors } = await loginAndOpenBilling(accAuthorized.email);
      const bodyText = await page.evaluate(() => document.body.innerText);

      // Eliminados de la vista habitual:
      assert.strictEqual(bodyText.includes('Renovación Mensual Consolidada (DOP)'), false, 'No debe existir tarjeta Renovación Mensual Consolidada (DOP)');
      assert.strictEqual(bodyText.includes('Confirmar autorización automática'), false, 'No debe existir botón Confirmar autorización automática');
      assert.strictEqual(bodyText.includes('Acepto migrar mi periodicidad actual de 30 días'), false, 'No debe existir selector de migración 30 días a mes calendario');
      assert.strictEqual(bodyText.includes('Tasa manual vigente USD/DOP'), false, 'No debe mostrar información técnica de tasa manual');

      // Integrados en Próximo cobro:
      assert.strictEqual(bodyText.includes('Próximo cobro'), true);
      assert.strictEqual(bodyText.includes('RD$5,940.00 DOP'), true, 'Debe mostrar importe estimado y moneda en Próximo cobro');
      assert.strictEqual(bodyText.includes('Mensual (mes calendario)'), true, 'Debe mostrar periodicidad contratada');
      assert.strictEqual(bodyText.includes('VISA •••• 4242'), true, 'Debe mostrar método de pago enmascarado');
      assert.strictEqual(
        bodyText.includes('El importe en pesos se calcula con la tasa aplicable al emitir el cobro'),
        true,
        'Debe mostrar nota breve sobre conversión a pesos'
      );

      // Estado real (no muestra "Renovación automática activa" porque el worker está deshabilitado):
      assert.strictEqual(bodyText.includes('Renovación automática activa'), false, 'No debe afirmar Renovación automática activa cuando el servicio de cobro está deshabilitado');
      assert.strictEqual(bodyText.includes('Autorizada (v2026.1)'), true);
      assert.strictEqual(bodyText.includes('Autorizar renovación automática'), false, 'Cuenta ya autorizada no debe volver a pedir autorización');

      // Consultar desglose sin saturar la pantalla:
      const clickedBreakdown = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find((b) => b.innerText.trim() === 'Ver desglose');
        if (!btn) return false;
        btn.click();
        return true;
      });
      assert.strictEqual(clickedBreakdown, true, 'Debe permitir consultar el desglose');
      await page.waitForFunction(() => document.body.innerText.includes('Plan Principal Etereas (1 sucursal)'), { timeout: 5000 });

      // Mantener "Actualizar método de pago" y única acción de cancelación:
      assert.strictEqual(bodyText.includes('Actualizar método de pago'), true);
      assert.strictEqual(bodyText.includes('Solicitar cancelación'), true);
      assert.strictEqual(bodyText.includes('Desactivar renovación automática'), false, 'Debe existir una única acción de cancelación');

      assert.strictEqual(pageErrors.length, 0);
      await ctx.close();
      console.log('  ✅ [1/5] Cuenta autorizada: vista limpia en "Próximo cobro", desglose bajo demanda y estado real sin falso activo PASS.');
    }

    // =========================================================================
    // 2. CUENTA EXISTENTE SIN CONSENTIMIENTO VÁLIDO (ciclo 30 días preservado + acción única)
    // =========================================================================
    {
      const { ctx, page, pageErrors } = await loginAndOpenBilling(accNoConsent.email);
      const bodyTextBefore = await page.evaluate(() => document.body.innerText);

      assert.strictEqual(bodyTextBefore.includes('Sin consentimiento registrado'), true);
      assert.strictEqual(bodyTextBefore.includes('Mensual (ciclo de 30 días)'), true);
      assert.strictEqual(bodyTextBefore.includes('Autorizar renovación automática'), true, 'Debe mostrar acción contextual para cuenta sin consentimiento');

      // Abrir modal contextual y verificar que el checkbox NO viene premarcado
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find((b) => b.innerText.trim() === 'Autorizar renovación automática');
        btn.click();
      });
      await page.waitForSelector('#sb-consent-modal-title', { timeout: 5000 });
      const isPreChecked = await page.evaluate(() => {
        const cb = document.querySelector('[aria-labelledby="sb-consent-modal-title"] input[type="checkbox"]');
        return cb ? cb.checked : null;
      });
      assert.strictEqual(isPreChecked, false, 'El consentimiento NUNCA debe estar premarcado');

      // Marcar y guardar autorización
      await page.click('[aria-labelledby="sb-consent-modal-title"] input[type="checkbox"]');
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('[aria-labelledby="sb-consent-modal-title"] button')).find((b) =>
          b.innerText.includes('Guardar autorización')
        );
        btn.click();
      });

      await page.waitForFunction(() => document.body.innerText.includes('Autorizada (v2026.1)'), { timeout: 10000 });
      const bodyTextAfter = await page.evaluate(() => document.body.innerText);
      assert.strictEqual(bodyTextAfter.includes('Autorizar renovación automática'), false, 'La acción contextual debe desaparecer tras autorizar una sola vez');
      assert.strictEqual(bodyTextAfter.includes('Mensual (ciclo de 30 días)'), true, 'No debe migrar ciclo de 30 días a mes calendario sin aceptación');

      const [subDb] = await pool.query(
        'SELECT periodicity_mode, auto_renew, recurring_consent_at, recurring_consent_version FROM tenant_subscriptions WHERE tenant_id = ?',
        [accNoConsent.tenantId]
      );
      assert.strictEqual(subDb[0].periodicity_mode, 'fixed_30_days', 'periodicity_mode en BD debe conservar fixed_30_days');
      assert.strictEqual(subDb[0].auto_renew, true);
      assert.strictEqual(subDb[0].recurring_consent_version, 'v2026.1');
      assert.ok(subDb[0].recurring_consent_at);

      assert.strictEqual(pageErrors.length, 0);
      await ctx.close();
      console.log('  ✅ [2/5] Cuenta sin consentimiento: acción contextual de una sola vez, checkbox no premarcado y preservación de 30 días PASS.');
    }

    // =========================================================================
    // 3. CUENTA CON MÉTODO DE PAGO NO DISPONIBLE
    // =========================================================================
    {
      const { ctx, page, pageErrors } = await loginAndOpenBilling(accNoMethod.email);
      const bodyText = await page.evaluate(() => document.body.innerText);

      assert.strictEqual(bodyText.includes('Método de pago no disponible'), true);
      assert.strictEqual(bodyText.includes('Autorizada (v2026.1)'), true);
      assert.strictEqual(bodyText.includes('No disponible'), true);
      assert.strictEqual(bodyText.includes('Renovación automática activa'), false);

      assert.strictEqual(pageErrors.length, 0);
      await ctx.close();
      console.log('  ✅ [3/5] Cuenta con método no disponible: distingue autorización vigente de falta de método apto PASS.');
    }

    // =========================================================================
    // 4. CUENTA CANCELADA
    // =========================================================================
    {
      const { ctx, page, pageErrors } = await loginAndOpenBilling(accCancelled.email);
      const bodyText = await page.evaluate(() => document.body.innerText);

      assert.strictEqual(bodyText.includes('Renovación desactivada'), true);
      assert.strictEqual(bodyText.includes('Desactivada por cancelación'), true);
      assert.strictEqual(bodyText.includes('Autorizar renovación automática'), false, 'Cuenta cancelada no debe mostrar botón de autorizar');
      assert.strictEqual(bodyText.includes('Cancelación registrada'), true);

      assert.strictEqual(pageErrors.length, 0);
      await ctx.close();
      console.log('  ✅ [4/5] Cuenta cancelada: estado real desactivado y sin acciones de consentimiento PASS.');
    }

    // =========================================================================
    // 5. CONTRATACIÓN EN LANDING (/): CONSENTIMIENTO RECURRENTE SEPARADO Y NO PREMARCADO
    // =========================================================================
    {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport({ width: 1366, height: 900 });
      await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle2' });

      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find((b) => b.innerText.includes('Contratar'));
        btn.click();
      });
      await page.waitForSelector('#reg-owner-name', { timeout: 5000 });
      await page.type('#reg-owner-name', 'Laura Contratacion');
      await page.type('#reg-owner-email', `laura_${tag}@test.local`);
      await page.type('#reg-owner-phone', '8095551234');
      await page.click('.et-modal-card form button[type="submit"]');

      await page.waitForSelector('#reg-business-name', { timeout: 5000 });
      await page.type('#reg-business-name', `Estudio Laura ${tag}`);
      await page.type('#reg-password', PASS);
      await page.click('.et-modal-card form button[type="submit"]');

      await page.waitForSelector('#reg-authorize-recurring', { timeout: 5000 });
      const checkboxesState = await page.evaluate(() => {
        const boxes = Array.from(document.querySelectorAll('.et-modal-card form input[type="checkbox"]'));
        return boxes.map((b) => ({ id: b.id, checked: b.checked }));
      });
      assert.strictEqual(checkboxesState.length, 2, 'Paso 3 de contratación debe tener 2 checkboxes separados (Términos y Consentimiento recurrente)');
      assert.strictEqual(checkboxesState[0].checked, false, 'Aceptación de términos no debe estar premarcada');
      assert.strictEqual(checkboxesState[1].checked, false, 'Consentimiento recurrente separado no debe estar premarcado');

      await ctx.close();
      console.log('  ✅ [5/5] Contratación en Landing (/): consentimiento recurrente separado y nunca premarcado PASS.');
    }

    console.log('\n🎉 SUITE DE SIMPLIFICACIÓN DE RENOVACIÓN EN "MI SUSCRIPCIÓN" SUPERADA (5/5 PASS).');
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (serverProc && !serverProc.killed) serverProc.kill();

    await pool.query('DELETE FROM saas_fx_rates WHERE pair = ?', ['USD_DOP']).catch(() => {});
    for (const r of fxRateBackup) {
      await pool.query(
        `INSERT INTO saas_fx_rates (pair, rate, rate_scaled_10000, updated_by_email, reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [r.pair, r.rate, r.rate_scaled_10000, r.updated_by_email, r.reason, r.created_at, r.updated_at]
      ).catch(() => {});
    }

    for (const tid of createdTenantIds) {
      await pool.query('DELETE FROM tenant_welcome_email_queue WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM tenant_terms_acceptances WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM saas_payment_methods WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM tenant_subscriptions WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM user_sessions WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM security_audit_logs WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM salons WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM branches WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM users WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM tenants WHERE id = ?', [tid]).catch(() => {});
    }
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ FALLO EN SUITE DE SIMPLIFICACIÓN DE RENOVACIÓN:', err);
  process.exit(1);
});
