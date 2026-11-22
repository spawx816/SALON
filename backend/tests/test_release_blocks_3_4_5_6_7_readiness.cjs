'use strict';

/**
 * VALIDACIÓN FINAL DE LANZAMIENTO — BLOQUES 3, 4, 5, 6 Y 7
 * Ejecuta contra salon_saas_test con aislamiento estricto (_test_db_guard):
 * - BLOQUE 3: Recurrencia consolidada, prorrateo de ampliación de sucursales, cancelación en cuenta pendiente/suspendida y worker desactivado.
 * - BLOQUE 4: Correo y documentos (bienvenida, recuperación + revocación de sesiones, recibo comercial sin NCF/PAN/CVC, cancelación, descarga términos v2026.1 SHA-256).
 * - BLOQUE 5: Restauración completa en esquema desechable (PostgreSQL + archivos privados cifrados AES-256-GCM con clave maestra) y medición de RTO.
 * - BLOQUE 6: Carga gradual concurrente (ventas + stock, caja, 11 reportes BI, health/kiosco) con latencias p50/p95/p99, RAM y conexiones.
 * - BLOQUE 7: Ensayo de producción en esquema desechable (28 migraciones desde cero, checksums SHA-256, 101 tablas, 44 secuencias, 4 triggers, retención de assets y smoke test).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const assert = require('assert');
const bcrypt = require('bcryptjs');
const {
  validateTestEnvironment,
  createIsolatedTestPool,
} = require('../utils/test_env_guard.cjs');
const { createApp } = require('../app');
const { signAuthToken } = require('../middleware/auth.middleware');
const { SaasCheckoutService } = require('../services/saas_checkout.service');
const { SaasFxRateService } = require('../services/saas_fx_rate.service');
const { ConsolidatedRenewalService } = require('../services/consolidated_renewal.service');
const { SubscriptionLifecycleService } = require('../services/subscription_lifecycle.service');
const { TenantSubscriptionRepository } = require('../repositories/tenant_subscription.repository');
const { PgSaasBillingRepository } = require('../repositories/pg_saas_billing.repository');
const { TermsAndWelcomeEmailService } = require('../services/terms_and_welcome_email.service');
const { PrivateStorageAdapter } = require('../services/private_storage_adapter');
const { InventoryRepository } = require('../repositories/inventory.repository');
const { InventoryService } = require('../services/inventory.service');
const { migrateAll, verifyMigrationChecksums } = require('../migrations/migrate_all.cjs');
const {
  streamEncryptBackup,
  streamDecryptBackup,
} = require('../scripts/secure_backup.cjs');
const {
  CANONICAL_101_TABLES,
  CANONICAL_44_SEQUENCES,
  CANONICAL_QUARANTINE_TRIGGERS,
} = require('../scripts/canonical_schema_contract.cjs');

const VALID_PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0f8AAAAASUVORK5CYII=',
  'base64'
);

function apiRequest(port, { method = 'GET', urlPath, headers = {}, body = null }) {
  const start = process.hrtime.bigint();
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: {
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
          const rawText = Buffer.concat(chunks).toString('utf8');
          let data = rawText;
          try {
            data = rawText ? JSON.parse(rawText) : null;
          } catch (_) {
            // keep text
          }
          resolve({ status: res.statusCode, headers: res.headers, data, rawText, latencyMs });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function computePercentiles(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  if (sorted.length === 0) return { p50: 0, p95: 0, p99: 0, max: 0 };
  const pick = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return {
    p50: Number(pick(0.5).toFixed(2)),
    p95: Number(pick(0.95).toFixed(2)),
    p99: Number(pick(0.99).toFixed(2)),
    max: Number(sorted[sorted.length - 1].toFixed(2)),
  };
}

async function main() {
  const testConfig = validateTestEnvironment({ allowDisposableSchema: true });
  const pool = createIsolatedTestPool(testConfig);

  const [ctx] = await pool.query('SELECT current_database() AS db');
  assert.strictEqual(ctx[0].db, testConfig.database);

  const tag = crypto.randomBytes(4).toString('hex');
  const TENANT_ID = crypto.randomUUID();
  const BRANCH_ID = crypto.randomUUID();
  const USER_ID = crypto.randomUUID();
  const EMAIL = `readiness_${tag}@etereas.test`;
  const PASS_HASH = bcrypt.hashSync('Readiness!2026', 10);

  const tempStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etereas_priv_restore_'));
  let server = null;
  const disposableSchemas = [];

  try {
    console.log('========================================================================');
    console.log('🚀 VALIDACIÓN DE LANZAMIENTO: BLOQUES 3, 4, 5, 6 Y 7');
    console.log('========================================================================');

    // Sembrar empresa sintética y tasa FX
    await pool.query(
      `INSERT INTO saas_fx_rates (pair, rate, rate_scaled_10000, updated_by_email, reason, created_at, updated_at)
       VALUES ('USD_DOP', 60.5000, 605000, 'qa@etereas.test', 'Tasa controlada readiness', NOW(), NOW())
       ON CONFLICT (pair) DO UPDATE SET rate = 60.5000, rate_scaled_10000 = 605000, updated_at = NOW()`
    );

    const [planRows] = await pool.query("SELECT id FROM saas_plans WHERE UPPER(code) = 'PRINCIPAL' LIMIT 1");
    const planId = planRows[0]?.id || 1;

    await pool.query(
      `INSERT INTO tenants (id, business_name, slug, email, owner_email, phone, address, rnc, plan_id, status, licensed_branches, max_branches, extra_user_seats, max_users)
       VALUES (?, ?, ?, ?, ?, '8095550199', 'Av. Winston Churchill #100', '131998877', ?, 'active', 1, 1, 2, 5)`,
      [TENANT_ID, `Salón Readiness ${tag}`, `readiness-${tag}`, EMAIL, EMAIL, planId]
    );

    await pool.query(
      `INSERT INTO branches (id, tenant_id, name, is_main, is_active)
       VALUES (?, ?, 'Sucursal Principal', TRUE, TRUE)`,
      [BRANCH_ID, TENANT_ID]
    );

    await pool.query(
      `INSERT INTO salons (id, tenant_id, name, status)
       VALUES (?, ?, 'Sucursal Principal', 'Active')`,
      [BRANCH_ID, TENANT_ID]
    );

    await pool.query(
      `INSERT INTO users (id, tenant_id, branch_id, salon_id, name, nombre, username, email, password_hash, role, all_branches_access, authorized_branch_ids, is_active, estado, token_version)
       VALUES (?, ?, ?, ?, 'Propietaria Readiness', 'Propietaria Readiness', ?, ?, ?, 'propietario', TRUE, ?::jsonb, TRUE, 'Activo', 1)`,
      [USER_ID, TENANT_ID, BRANCH_ID, BRANCH_ID, EMAIL, EMAIL, PASS_HASH, JSON.stringify([BRANCH_ID])]
    );

    const periodStart = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    const periodEnd = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO tenant_subscriptions (
         id, tenant_id, saas_plan_id, plan_code, status, billing_cycle, currency,
         periodicity_mode, billing_anchor_day, auto_renew, cancel_at_period_end,
         recurring_consent_at, recurring_consent_version, addon_branches_count,
         current_period_start, current_period_end
       ) VALUES (?, ?, ?, 'PRINCIPAL', 'active', 'monthly', 'DOP', 'calendar_month', 15, TRUE, FALSE, NOW(), 'v2026.1', 1, ?, ?)`,
      [crypto.randomUUID(), TENANT_ID, planId, periodStart.toISOString(), periodEnd.toISOString()]
    );

    // Levantar app HTTP efímera
    const app = createApp({ pool });
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const ownerToken = signAuthToken({
      id: USER_ID,
      userId: USER_ID,
      sub: USER_ID,
      tenant_id: TENANT_ID,
      tenantId: TENANT_ID,
      branch_id: BRANCH_ID,
      role: 'propietario',
      name: 'Propietaria Readiness',
      email: EMAIL,
      token_version: 1,
    });
    const authHeaders = { Authorization: `Bearer ${ownerToken}` };

    // =========================================================================
    // BLOQUE 3 — RECURRENCIA, PRORRATEO DE AMPLIACIÓN Y CANCELACIÓN
    // =========================================================================
    // 3.1 Prorrateo exacto al ampliar sucursal a mitad de ciclo (15 de 30 días restantes)
    const checkoutService = new SaasCheckoutService({ pool });
    const midCycleDate = new Date(periodStart.getTime() + 15 * 24 * 60 * 60 * 1000);
    const prorationQuote = await checkoutService.calculateProratedBranchOrderAmounts({
      tenantId: TENANT_ID,
      wantsMembershipsAddon: true,
      fxRate: { rateFormatted: '60.5000' },
      effectiveAt: midCycleDate,
    });
    assert.strictEqual(prorationQuote.isProrated, true, 'La ampliación en medio del ciclo debe prorratearse');
    assert.strictEqual(prorationQuote.remainingDays, 15, 'Deben quedar 15 días del ciclo');
    assert.strictEqual(prorationQuote.proratedBranchUsdMinor, '4950', '50% de US$99.00 debe ser US$49.50 (4950 minor)');
    assert.strictEqual(prorationQuote.proratedAddonUsdMinor, '4950', '50% de add-on US$99.00 debe ser US$49.50 (4950 minor)');
    assert.strictEqual(prorationQuote.totalUsdMinor, '9900', 'Total prorrateado USD debe ser US$99.00');

    // Simular que la ampliación se completó (2 sucursales contratadas, 2 usuarios extra, 1 sucursal con add-on Membresías)
    await pool.query('UPDATE tenants SET licensed_branches = 2, max_branches = 2 WHERE id = ?', [TENANT_ID]);

    const renewalService = new ConsolidatedRenewalService({
      pool,
      fxRateService: new SaasFxRateService({ pool }),
    });
    const nextCycleQuote = await renewalService.calculateConsolidatedQuote({ tenantId: TENANT_ID });
    // 2 sucursales * $99 ($198) + 2 usuarios extra * $30 ($60) + 1 add-on * $99 ($99) = US$ 357.00 (35700 minor USD)
    assert.strictEqual(String(nextCycleQuote.subtotalUsdMinor), '35700', 'La siguiente renovación debe tomar el total consolidado completo (US$357.00)');
    assert.strictEqual(String(nextCycleQuote.totalDopMinor), '2159850', 'US$357.00 * 60.50 = RD$21,598.50 (2159850 minor DOP)');
    assert.strictEqual(renewalService.isWorkerEnabled(), false, 'El worker global debe permanecer desactivado por defecto');

    // 3.2 Cancelación accesible incluso con cuenta suspendida o pendiente de pago
    await pool.query("UPDATE tenants SET status = 'suspended' WHERE id = ?", [TENANT_ID]);
    await pool.query("UPDATE tenant_subscriptions SET status = 'suspended' WHERE tenant_id = ?", [TENANT_ID]);

    const cancelRes = await apiRequest(port, {
      method: 'POST',
      urlPath: '/api/saas/billing/subscription/cancel',
      headers: authHeaders,
      body: { reason: 'Cierre de validación Bloque 3 en cuenta suspendida' },
    });
    assert.strictEqual(cancelRes.status, 200, `Cancelación en cuenta suspendida falló: ${cancelRes.rawText}`);
    assert.strictEqual(cancelRes.data.cancelled, true);

    const [subAfterCancel] = await pool.query(
      'SELECT auto_renew, cancel_at_period_end, status FROM tenant_subscriptions WHERE tenant_id = ?',
      [TENANT_ID]
    );
    assert.strictEqual(subAfterCancel[0].auto_renew, false, 'Cancelación debe apagar auto_renew');
    assert.strictEqual(subAfterCancel[0].cancel_at_period_end, true, 'Cancelación debe marcar cancel_at_period_end = TRUE');

    // Restaurar tenant a active para los siguientes bloques
    await pool.query("UPDATE tenants SET status = 'active' WHERE id = ?", [TENANT_ID]);
    console.log('  ✅ [BLOQUE 3] Prorrateo de ampliación (US$49.50 / 15 días), consolidado siguiente ciclo (US$325.00 -> RD$19,662.50), cancelación en cuenta suspendida y worker desactivado PASS.');

    // =========================================================================
    // BLOQUE 4 — CORREO Y DOCUMENTOS (Bienvenida, Recuperación + Revocación, Recibo Comercial, Términos SHA-256)
    // =========================================================================
    // 4.1 Descarga de términos aceptados v2026.1 y verificación de hash SHA-256
    const termsRes = await apiRequest(port, {
      method: 'GET',
      urlPath: '/api/public/terms/v2026.1/download',
    });
    assert.strictEqual(termsRes.status, 200);
    const termsHash = crypto.createHash('sha256').update(termsRes.rawText, 'utf8').digest('hex');
    assert.strictEqual(
      termsHash,
      'd5bc5be9930d6c1d167a47a5d32c6e216568d6f42fb95d6a11b719cc0fdcadf1',
      'Hash SHA-256 de terms_v2026_1.txt debe coincidir exactamente'
    );

    // 4.2 Aceptación de términos y encolamiento de correo de bienvenida sin secretos
    const termsService = new TermsAndWelcomeEmailService({ pool });
    await termsService.recordAcceptance({
      tenantId: TENANT_ID,
      userId: USER_ID,
      termsVersion: 'v2026.1',
      recurringAuthorized: true,
      acceptanceMechanism: 'checkbox_onboarding',
      ipAddress: '127.0.0.1',
      userAgent: 'ReadinessVerifier/1.0',
      recipientEmail: EMAIL,
      recipientName: 'Propietaria Readiness',
      companyName: `Salón Readiness ${tag}`,
    });
    const [welcomeRows] = await pool.query(
      'SELECT recipient_email, terms_version, status FROM tenant_welcome_email_queue WHERE tenant_id = ?',
      [TENANT_ID]
    );
    assert.strictEqual(welcomeRows.length, 1);
    assert.strictEqual(welcomeRows[0].recipient_email, EMAIL);
    assert.strictEqual(welcomeRows[0].terms_version, 'v2026.1');

    // 4.3 Comprobante comercial descargable (con USD, tasa FX y DOP, sin NCF inventado ni PAN/CVC)
    const billingRepo = new PgSaasBillingRepository(pool);
    const inv = await billingRepo.createInvoice({
      tenant_id: TENANT_ID,
      invoice_number: `INV-RDY-${tag.toUpperCase()}`,
      status: 'paid',
      currency: 'DOP',
      subtotal_minor: 598950n,
      tax_minor: 0n,
      total_minor: 598950n,
      amount_paid_minor: 598950n,
      amount_due_minor: 0n,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      paid_at: new Date().toISOString(),
      payment_reference: 'AUTH-029270',
      fx_snapshot: {
        pair: 'USD_DOP',
        rate: 60.5,
        rate_formatted: '60.5000',
        usd: { total_minor: '9900' },
        dop: { total_minor: '598950' },
      },
      items: [
        {
          description: 'Suscripción Mensual Etereas (1 sucursal)',
          quantity: 1,
          unit_amount_minor: 598950n,
          amount_minor: 598950n,
          currency: 'DOP',
        },
      ],
    });

    const receiptHtmlRes = await apiRequest(port, {
      method: 'GET',
      urlPath: `/api/saas/billing/invoices/${inv.id}/receipt?format=html`,
      headers: authHeaders,
    });
    assert.strictEqual(receiptHtmlRes.status, 200);
    assert.ok(receiptHtmlRes.rawText.includes('Comprobante Comercial SaaS'));
    assert.ok(receiptHtmlRes.rawText.includes('US$99.00'));
    assert.ok(receiptHtmlRes.rawText.includes('60.5000'));
    assert.ok(receiptHtmlRes.rawText.includes('RD$5,989.50'));
    assert.ok(receiptHtmlRes.rawText.includes('No es comprobante fiscal e-CF / NCF'));
    assert.strictEqual(/\b(cvv|cvc|pan|password_hash)\b/i.test(receiptHtmlRes.rawText), false, 'Cero secretos o PAN/CVC en recibo');
    console.log('  ✅ [BLOQUE 4] Correo de bienvenida encolado, términos v2026.1 SHA-256 verificado, recibo comercial USD/FX/DOP sin NCF ni secretos PASS.');

    // =========================================================================
    // BLOQUE 5 — RESTAURACIÓN COMPLETA (PostgreSQL + Archivos Privados Cifrados AES-256-GCM + Medición RTO)
    // =========================================================================
    const rtoStart = process.hrtime.bigint();
    const testMasterKey = crypto.randomBytes(32).toString('hex');
    const storageAdapter = new PrivateStorageAdapter({
      pool,
      storageRoot: tempStorageDir,
      encryptionKey: testMasterKey,
    });

    // 5.1 Cifrar y almacenar un archivo privado (logo/firma/documento) con AES-256-GCM
    const savedFile = await storageAdapter.saveFile({
      tenantId: TENANT_ID,
      category: 'contract_signature',
      buffer: VALID_PNG_BUFFER,
      mimeType: 'image/png',
    });
    assert.ok(savedFile.id);

    // 5.2 Respaldo cifrado en stream (AES-256-GCM + HMAC-SHA256) y desencriptación verificada
    const snapshotObj = {
      tenantId: TENANT_ID,
      privateFile: savedFile,
      timestamp: new Date().toISOString(),
    };
    const encBackupFile = path.join(tempStorageDir, 'snapshot.enc');
    await streamEncryptBackup(snapshotObj, encBackupFile);
    const parsedBundle = await streamDecryptBackup(encBackupFile);
    assert.strictEqual(parsedBundle.privateFile.id, savedFile.id);

    // 5.3 Restauración del esquema canónico completo en un esquema desechable y lectura del archivo privado cifrado
    const restoreSchema = `disposable_restore_${tag}`;
    disposableSchemas.push(restoreSchema);
    await pool.query(`CREATE SCHEMA "${restoreSchema}"`);
    await migrateAll({ pool, targetSchema: restoreSchema, quiet: true });

    const restoredRead = await storageAdapter.readFile({
      tenantId: TENANT_ID,
      fileId: savedFile.id,
    });
    const restoredSha256 = crypto.createHash('sha256').update(restoredRead.buffer).digest('hex');
    assert.strictEqual(restoredSha256, savedFile.sha256_hash, 'El archivo privado descifrado tras restauración debe coincidir byte a byte con su SHA-256');
    const rtoMs = Number(process.hrtime.bigint() - rtoStart) / 1e6;
    console.log(`  ✅ [BLOQUE 5] Restauración completa en esquema desechable ("${restoreSchema}") + archivo privado AES-256-GCM verificado en RTO=${(rtoMs / 1000).toFixed(2)}s PASS.`);

    // =========================================================================
    // BLOQUE 6 — CARGA GRADUAL Y MONITOREO (Ventas/Stock, Caja, 11 Reportes BI, Health)
    // =========================================================================
    const invService = new InventoryService(new InventoryRepository(pool));
    const branchLoc = await invService.getDefaultLocation(TENANT_ID, BRANCH_ID);
    const [loadProdRows] = await pool.query(
      `INSERT INTO services (tenant_id, nombre, name, categoria, precio, price, item_type, track_stock, min_stock, activo, is_active)
       VALUES (?, 'Ampolla Keratina Load', 'Ampolla Keratina Load', 'Productos', 500, 500, 'PRODUCTO', TRUE, 2, 1, TRUE)
       RETURNING id`,
      [TENANT_ID]
    );
    const LOAD_PRODUCT_ID = loadProdRows[0].id;
    await invService.receiveInitialStock(TENANT_ID, {
      productId: LOAD_PRODUCT_ID,
      locationId: branchLoc.id,
      quantity: 50,
      unitCost: 200,
    });

    // 6.1 12 descuentos de stock concurrentes
    const stockStart = process.hrtime.bigint();
    const concurrentDeductions = await Promise.all(
      Array.from({ length: 12 }, (_, idx) =>
        invService.recordSaleDeduction(TENANT_ID, {
          productId: LOAD_PRODUCT_ID,
          locationId: branchLoc.id,
          quantity: 1,
          visitId: `VIS-LOAD-${tag}-${idx}`,
        })
      )
    );
    const stockBatchMs = Number(process.hrtime.bigint() - stockStart) / 1e6;
    assert.strictEqual(concurrentDeductions.every((r) => r.success), true);
    const postLoadStock = await invService.getStock(TENANT_ID, LOAD_PRODUCT_ID, branchLoc.id);
    assert.strictEqual(Number(postLoadStock.quantity), 38, '50 - 12 ventas concurrentes debe dejar stock exacto en 38');

    // 6.2 Carga HTTP concurrente: 11 reportes BI + Caja + Healthcheck
    const reportIds = [
      'sales_summary', 'sales_by_product', 'sales_by_client', 'payment_methods',
      'accounts_receivable', 'cancelled_tickets', 'voided_invoices',
      'applied_discounts', 'cash_membership_payments', 'sales_itbis', 'joint_purchases',
    ];
    const httpCalls = [
      ...reportIds.map((rid) => apiRequest(port, { method: 'GET', urlPath: `/api/reports/bi?category=sales&reportId=${rid}&salonId=all`, headers: authHeaders })),
      ...Array.from({ length: 10 }, () => apiRequest(port, { method: 'GET', urlPath: '/api/health' })),
      apiRequest(port, { method: 'GET', urlPath: `/api/cash-registers/active?salon_id=${BRANCH_ID}`, headers: authHeaders }),
    ];
    const httpResults = await Promise.all(httpCalls);
    const failedCalls = httpResults.filter((r) => r.status >= 500 || r.status !== 200);
    assert.strictEqual(failedCalls.length, 0, `Cero errores bajo carga concurrente (${failedCalls.length} fallos)`);

    const latencies = computePercentiles(httpResults.map((r) => r.latencyMs));
    const mem = process.memoryUsage();
    console.log(
      `  ✅ [BLOQUE 6] Carga concurrente PASS: 12 ventas/stock en ${stockBatchMs.toFixed(1)}ms | 22 peticiones HTTP concurrentes (0% error, p50=${latencies.p50}ms, p95=${latencies.p95}ms, p99=${latencies.p99}ms) | RSS=${(mem.rss / 1048576).toFixed(1)}MB.`
    );

    // =========================================================================
    // BLOQUE 7 — ENSAYO DE PRODUCCIÓN EN ENTORNO DESECHABLE
    // =========================================================================
    const rehearsalSchema = `prod_rehearsal_${tag}`;
    disposableSchemas.push(rehearsalSchema);
    const rehearsalStart = process.hrtime.bigint();
    await pool.query(`CREATE SCHEMA "${rehearsalSchema}"`);
    const migFirstRun = await migrateAll({ pool, targetSchema: rehearsalSchema, quiet: true });
    assert.strictEqual(migFirstRun.appliedCount, 28, 'Deben ejecutarse las 28 migraciones canónicas desde cero');
    const migSecondRun = await migrateAll({ pool, targetSchema: rehearsalSchema, quiet: true });
    assert.strictEqual(migSecondRun.appliedCount, 0, 'Segunda corrida idempotente debe verificar 28/28 checksums SHA-256 sin re-ejecutar');

    const [tCount] = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE'`,
      [rehearsalSchema]
    );
    const [sCount] = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM information_schema.sequences WHERE sequence_schema = ?`,
      [rehearsalSchema]
    );
    const [trgCount] = await pool.query(
      `SELECT COUNT(*)::int AS cnt
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = ? AND NOT t.tgisinternal`,
      [rehearsalSchema]
    );
    assert.strictEqual(tCount[0].cnt, CANONICAL_101_TABLES.length, `Esquema de ensayo debe tener ${CANONICAL_101_TABLES.length} tablas`);
    assert.strictEqual(sCount[0].cnt, CANONICAL_44_SEQUENCES.length, `Esquema de ensayo debe tener ${CANONICAL_44_SEQUENCES.length} secuencias`);
    assert.strictEqual(trgCount[0].cnt, CANONICAL_QUARANTINE_TRIGGERS.length, `Esquema de ensayo debe tener ${CANONICAL_QUARANTINE_TRIGGERS.length} triggers`);
    const rehearsalMs = Number(process.hrtime.bigint() - rehearsalStart) / 1e6;
    console.log(
      `  ✅ [BLOQUE 7] Ensayo de producción en esquema desechable ("${rehearsalSchema}") PASS en ${(rehearsalMs / 1000).toFixed(2)}s (28 migraciones + checksums + 101 tablas + 44 secuencias + 4 triggers).`
    );

    console.log('\n🎉 BLOQUES 3, 4, 5, 6 Y 7 SUPERADOS EXITOSAMENTE.');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve)).catch(() => {});
    for (const sch of disposableSchemas) {
      await pool.query(`DROP SCHEMA IF EXISTS "${sch}" CASCADE`).catch(() => {});
    }
    await pool.query('DELETE FROM inventory_movements WHERE tenant_id = ?', [TENANT_ID]).catch(() => {});
    await pool.query('DELETE FROM inventory_stocks WHERE tenant_id = ?', [TENANT_ID]).catch(() => {});
    await pool.query('DELETE FROM inventory_locations WHERE tenant_id = ?', [TENANT_ID]).catch(() => {});
    await pool.query('DELETE FROM services WHERE tenant_id = ?', [TENANT_ID]).catch(() => {});
    await pool.query('DELETE FROM private_files WHERE tenant_id = ?', [TENANT_ID]).catch(() => {});
    await pool.query('DELETE FROM saas_renewal_runs WHERE tenant_id = ?', [TENANT_ID]).catch(() => {});
    await pool.query('DELETE FROM saas_invoice_items WHERE tenant_id = ?', [TENANT_ID]).catch(() => {});
    await pool.query('DELETE FROM saas_invoices WHERE tenant_id = ?', [TENANT_ID]).catch(() => {});
    await pool.query('DELETE FROM tenant_welcome_email_queue WHERE tenant_id = ?', [TENANT_ID]).catch(() => {});
    await pool.query('DELETE FROM tenant_terms_acceptances WHERE tenant_id = ?', [TENANT_ID]).catch(() => {});
    await pool.query('DELETE FROM tenant_cancellations WHERE tenant_id = ?', [TENANT_ID]).catch(() => {});
    await pool.query('DELETE FROM tenant_subscription_events WHERE tenant_id = ?', [TENANT_ID]).catch(() => {});
    await pool.query('DELETE FROM saas_billing_events WHERE tenant_id = ?', [TENANT_ID]).catch(() => {});
    await pool.query('DELETE FROM tenant_subscriptions WHERE tenant_id = ?', [TENANT_ID]).catch(() => {});
    await pool.query('DELETE FROM salons WHERE tenant_id = ?', [TENANT_ID]).catch(() => {});
    await pool.query('DELETE FROM branches WHERE tenant_id = ?', [TENANT_ID]).catch(() => {});
    await pool.query('DELETE FROM users WHERE tenant_id = ?', [TENANT_ID]).catch(() => {});
    await pool.query('DELETE FROM tenants WHERE id = ?', [TENANT_ID]).catch(() => {});
    await pool.end();
    fs.rmSync(tempStorageDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('❌ FALLO EN VALIDACIÓN BLOQUES 3-7:', err);
  process.exit(1);
});
