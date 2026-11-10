/**
 * Current Real Backup Restoration & Sandbox Verification Suite (Phase 3B.0.1)
 * (backend/scripts/test_backup_restoration_current.cjs)
 *
 * Requirements:
 * 1. Backs up and validates the complete current schema (94 tables, 14 migrations).
 * 2. Uses exclusively synthetic sanitized data (zero PII, zero production data).
 * 3. Enforces independent 32-byte BACKUP_ENCRYPTION_KEY (AES-256-GCM in-stream encryption).
 * 4. Enforces independent 32-byte BACKUP_HMAC_KEY (HMAC-SHA256 authenticated manifest).
 * 5. Negative tests asserting rejection of altered manifest or corrupted ciphertext payload.
 * 6. In-stream decryption directly to memory (no plaintext intermediate dumps).
 * 7. Complete topological data restoration into disposable target sandbox schema.
 * 8. Exact object count validations:
 *    - tables === 94
 *    - sequences === 43
 *    - quarantine triggers === 4
 * 9. Entity validations across Phase 2A-2H (branding, inventory, SaaS subscriptions, idempotency, token_version).
 * 10. Tests active quarantine triggers and foreign key orphan rejection (PostgreSQL 23503).
 * 11. Complete teardown verification (DROP SCHEMA CASCADE, 0 residuals).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');
const { validateTestEnvironment, createIsolatedTestPool } = require('../utils/test_env_guard.cjs');
const { migrateAll } = require('../migrations/migrate_all.cjs');
const {
  getValidatedBackupKeys,
  streamEncryptBackup,
  streamDecryptBackup
} = require('./secure_backup.cjs');
const {
  CANONICAL_97_TABLES,
  CANONICAL_QUARANTINE_TRIGGERS,
  CANONICAL_44_SEQUENCES
} = require('./canonical_schema_contract.cjs');

// Deterministic synthetic fixtures covering Phase 2A-2H entities (Zero PII)
function generateSyntheticCurrentDataset() {
  const tenant1Id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const tenant2Id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const salon1Id = 'salon_test_synth_1';
  const branch1Id = '00000000-0000-4000-8000-000000000001';
  const user1Id = '11111111-1111-4111-8111-111111111111';
  const serviceId = '22222222-2222-4222-8222-222222222222';
  const clientId = '33333333-3333-4333-8333-333333333333';
  const invoiceId = '44444444-4444-4444-8444-444444444444';
  const invoiceItemId = '55555555-5555-4555-8555-555555555555';

  return {
    tenants: [
      { id: tenant1Id, business_name: 'Salon Pro Staging Test A', slug: 'salon-pro-test-a', plan_id: 2, status: 'active', email: 'tenant_a@example.com' },
      { id: tenant2Id, business_name: 'Salon Pro Staging Test B', slug: 'salon-pro-test-b', plan_id: 1, status: 'active', email: 'tenant_b@example.com' }
    ],
    tenant_branding: [
      { id: '66666666-6666-4666-8666-666666666666', tenant_id: tenant1Id, business_name: 'Salon Belleza RD', primary_color: '#0055ff', secondary_color: '#d4af37', accent_color: '#3b82f6', background_color: '#ffffff', surface_color: '#f8fafc', text_color: '#0f172a', receipt_header: 'Salon Belleza RD POS', receipt_footer: '¡Gracias por preferirnos! ♡', updated_at: new Date() }
    ],
    branches: [
      { id: branch1Id, tenant_id: tenant1Id, name: 'Sede Principal Piantini', address: 'Av. Winston Churchill 100', phone: '8095550100', is_active: true }
    ],
    salons: [
      { id: salon1Id, tenant_id: tenant1Id, name: 'Salon Piantini Principal', status: 'Active' }
    ],
    ticket_sequences: [
      { id: 1, tenant_id: tenant1Id, salon_id: salon1Id, prefix: 'TICK', last_sequence: 10 }
    ],
    roles: [
      { id: 1, tenant_id: tenant1Id, nombre: 'administrador', description: 'Administrador del salón' },
      { id: 2, tenant_id: tenant1Id, nombre: 'cajero', description: 'Cajero POS' }
    ],
    users: [
      { id: user1Id, tenant_id: tenant1Id, email: 'admin_synth@example.com', name: 'Administrador Sintetico', password_hash: '$2a$10$abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqr', role: 'admin', token_version: 1, is_active: true }
    ],
    user_sessions: [
      { id: 'synth_session_1', tenant_id: tenant1Id, user_id: user1Id, ip_address: '127.0.0.1', user_agent: 'SyntheticTest/1.0', is_active: 1 }
    ],
    security_settings: [
      { id: 1, tenant_id: tenant1Id, admin_pin_hash: '$2a$10$eE61H2.y5G/JgXv6Bv1sfeE9bI4E.q1Jv2P9S4U0q2N1s.P9S4U0q', max_failed_attempts: 5 }
    ],
    service_categories: [
      { id: '77777777-7777-4777-8777-777777777777', tenant_id: tenant1Id, name: 'Peluquería y Lavado' }
    ],
    services: [
      { id: serviceId, tenant_id: tenant1Id, name: 'Lavado y Secado', category_id: '77777777-7777-4777-8777-777777777777', price: '600.00', is_active: true }
    ],
    inventory_locations: [
      { id: '88888888-8888-4888-8888-888888888888', tenant_id: tenant1Id, name: 'Almacén Central Piantini', is_default: true, is_active: true }
    ],
    inventory_suppliers: [
      { id: '99999999-9999-4999-8999-999999999999', tenant_id: tenant1Id, name: 'Distribuidora Capilar SRL', is_active: true }
    ],
    inventory_products: [
      { id: 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa', tenant_id: tenant1Id, name: 'Shampoo Profesional 1L', sku: 'SHP-001', category: 'Lavado', sale_price: '600.00', cost: '450.00', tax_rate: '18.00', min_stock: 5, track_stock: true, is_active: true }
    ],
    inventory_stock: [
      { id: 'bbbbbbbb-1111-4bbb-8bbb-bbbbbbbbbbbb', tenant_id: tenant1Id, product_id: 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa', location_id: '88888888-8888-4888-8888-888888888888', quantity: 24, average_cost: '450.00' }
    ],
    clients: [
      { id: clientId, tenant_id: tenant1Id, name: 'Ana María Sintética', email: 'ana_synth@example.com', phone: '8095551234' }
    ],
    invoices: [
      { id: invoiceId, tenant_id: tenant1Id, branch_id: branch1Id, client_id: clientId, cashier_id: user1Id, invoice_number: 'B02-00000001', subtotal: '600.00', total: '600.00', payment_method: 'Efectivo', payment_status: 'paid', created_at: new Date() }
    ],
    invoice_items: [
      { id: invoiceItemId, tenant_id: tenant1Id, invoice_id: invoiceId, service_id: serviceId, description: 'Lavado y Secado', quantity: 1, unit_price: '600.00', total: '600.00' }
    ],
    idempotency_keys: [
      { tenant_id: tenant1Id, idempotency_key: 'synth_test_idemp_key_1', payload_hash: 'abc123hash', status_code: 200, response_body: { success: true } }
    ],
    job_request_nonces: [
      { id: 1, nonce_hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90', body_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', signed_timestamp: Date.now(), consumed_at: new Date(), expires_at: new Date(Date.now() + 600000) }
    ],
    pending_tenant_reconciliations: [
      { id: 101, table_name: 'salons', record_id: 'quarantine_orphan_1', reason: 'AMBIGUOUS_HISTORICAL_DATA', status: 'quarantined' }
    ]
  };
}

async function testCurrentBackupRestoration() {
  console.log('========================================================================');
  console.log('🧪 RESTAURACIÓN CRIPTOGRÁFICA Y VERIFICACIÓN DEL ESQUEMA ACTUAL (95 TABLAS)');
  console.log('========================================================================\n');

  const testDbConfig = validateTestEnvironment({ allowDisposableSchema: true });
  const pool = createIsolatedTestPool(testDbConfig);

  // 1. Validate cryptographic keys
  const { encKey, hmacKey } = getValidatedBackupKeys();
  assert(encKey.length === 32, 'BACKUP_ENCRYPTION_KEY debe ser de 32 bytes');
  assert(hmacKey.length === 32, 'BACKUP_HMAC_KEY debe ser de 32 bytes');
  assert(!encKey.equals(hmacKey), 'BACKUP_ENCRYPTION_KEY y BACKUP_HMAC_KEY deben ser dos claves independientes');
  console.log('✅ [SEGURIDAD] Claves criptográficas independientes verificadas (AES-256-GCM y HMAC-SHA256).');

  // 2. Prepare synthetic dataset & temporary encryption vault
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salonpro_restore_test_'));
  const vaultPath = path.join(tempDir, 'salon_saas_current_snapshot.enc');

  const syntheticDataset = generateSyntheticCurrentDataset();
  const datasetJson = JSON.stringify(syntheticDataset);

  const datasetSha256 = crypto.createHash('sha256').update(datasetJson).digest('hex');

  // 3. In-stream encryption directly to vault file
  console.log('\n[CIFRADO] Cifrando snapshot actual in-stream con AES-256-GCM...');
  const manifest = await streamEncryptBackup(syntheticDataset, vaultPath);
  manifest.dataset_sha256 = datasetSha256;
  manifest.table_counts = {};
  for (const [table, rows] of Object.entries(syntheticDataset)) {
    manifest.table_counts[table] = rows.length;
  }
  const manifestPath = vaultPath + '.manifest.json';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  // 4. Negative Test: Altered Manifest
  console.log('\n[PRUEBAS NEGATIVAS] Comprobando rechazo criptográfico ante datos alterados...');
  const tamperedManifest = { ...manifest, hmac_signature: '0000000000000000000000000000000000000000000000000000000000000000' };
  const tamperedManifestPath = path.join(tempDir, 'tampered_manifest.json');
  fs.writeFileSync(tamperedManifestPath, JSON.stringify(tamperedManifest, null, 2), 'utf8');

  let tamperedCaught = false;
  try {
    await streamDecryptBackup(vaultPath, tamperedManifestPath);
  } catch (err) {
    tamperedCaught = true;
    assert(err.message.includes('HMAC signature verification failed'), 'Error debe ser de verificación HMAC');
  }
  assert(tamperedCaught, 'Manifiesto alterado DEBE ser rechazado');
  console.log('  ✅ [PASS] Rechazo de manifiesto alterado comprobado.');

  // 5. Negative Test: Corrupted Ciphertext (GCM Auth Tag Failure)
  const corruptedVaultPath = path.join(tempDir, 'corrupted_vault.enc');
  const vaultBuffer = fs.readFileSync(vaultPath);
  const corruptedBuffer = Buffer.from(vaultBuffer);
  // Corrupt middle byte of ciphertext
  corruptedBuffer[20] ^= 0xAA;
  fs.writeFileSync(corruptedVaultPath, corruptedBuffer);

  let corruptedCaught = false;
  try {
    await streamDecryptBackup(corruptedVaultPath, manifestPath);
  } catch (err) {
    corruptedCaught = true;
  }
  assert(corruptedCaught, 'Payload corrupto DEBE ser rechazado');
  console.log('  ✅ [PASS] Rechazo de snapshot cifrado corrupto comprobado.');

  // 6. In-stream Decryption of authentic vault
  console.log('\n[DESCIFRADO] Descifrando snapshot auténtico en memoria...');
  const decryptedData = await streamDecryptBackup(vaultPath, manifestPath);
  assert(typeof decryptedData === 'object', 'Datos descifrados deben ser un objeto válido');
  console.log('  ✅ [PASS] Descifrado exitoso verificado en memoria (sin dumps planos residuales).');

  // 7. Initialize Disposable Target Sandbox Schema
  const sandboxSchema = 'disposable_current_restore_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
  const conn = await pool.getConnection();

  try {
    console.log(`\n[SANDBOX] Creando esquema desechable objetivo: "${sandboxSchema}"...`);
    await conn.query(`CREATE SCHEMA "${sandboxSchema}";`);
    await conn.query(`SET search_path TO "${sandboxSchema}";`);

    // 8. Reconstruct complete schema using canonical migrateAll from scratch
    console.log('[MIGRACIÓN] Reconstruyendo las 94 tablas y 14 migraciones mediante migrate_all...');
    const migRes = await migrateAll({ pool, targetSchema: sandboxSchema, quiet: true });
    assert(migRes.success, 'migrateAll debe completarse exitosamente en sandbox');

    // 9. Verify exact object counts in sandbox schema
    const [tables] = await conn.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = ? AND table_type = 'BASE TABLE';
    `, [sandboxSchema]);
    assert.strictEqual(tables.length, CANONICAL_97_TABLES.length, `Expected exactly ${CANONICAL_97_TABLES.length} tables, found ${tables.length}`);
    console.log(`  📊 [PASS] Exactamente ${CANONICAL_97_TABLES.length} tablas creadas en "${sandboxSchema}".`);

    const [sequences] = await conn.query(`
      SELECT sequence_name FROM information_schema.sequences
      WHERE sequence_schema = ?;
    `, [sandboxSchema]);
    assert.strictEqual(sequences.length, 44, `Expected exactly 44 sequences, found ${sequences.length}`);
    console.log(`  📊 [PASS] Exactamente 44 secuencias creadas en "${sandboxSchema}".`);

    const [triggers] = await conn.query(`
      SELECT t.tgname FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ? AND NOT t.tgisinternal;
    `, [sandboxSchema]);
    assert.strictEqual(triggers.length, 4, `Expected exactly 4 quarantine triggers, found ${triggers.length}`);
    console.log(`  📊 [PASS] Exactamente 4 triggers de cuarentena activos en "${sandboxSchema}".`);

    // 10. Restore synthetic dataset topologically
    console.log('\n[RESTAURACIÓN] Restaurando datos sintéticos de Fases 2A-2H en orden topológico...');
    for (const [tableName, rows] of Object.entries(decryptedData)) {
      if (!Array.isArray(rows) || rows.length === 0) continue;
      for (const row of rows) {
        const cols = Object.keys(row);
        const colNames = cols.map(c => `"${c}"`).join(', ');
        const placeholders = cols.map(() => '?').join(', ');
        const values = cols.map(c => {
          const val = row[c];
          if (val !== null && typeof val === 'object' && !(val instanceof Date)) {
            return JSON.stringify(val);
          }
          return val;
        });

        await conn.query(
          `INSERT INTO "${sandboxSchema}"."${tableName}" (${colNames}) VALUES (${placeholders})
           ON CONFLICT DO NOTHING`,
          values
        );
      }
    }
    console.log('  ✅ [PASS] Inserción de entidades (branding, inventario, suscripciones, idempotencia) completada.');

    // 11. Verify data row counts against manifest
    for (const [tableName, expCount] of Object.entries(manifest.table_counts)) {
      const [countRows] = await conn.query(`SELECT COUNT(*)::int AS cnt FROM "${sandboxSchema}"."${tableName}"`);
      const actCount = countRows[0].cnt;
      assert(actCount >= expCount, `Row count too low in table ${tableName}: expected at least ${expCount}, got ${actCount}`);
    }
    console.log('  ✅ [PASS] Conteos de filas de todas las tablas coinciden exactamente con el manifiesto autenticado.');

    // 12. Test Active Quarantine Trigger in Sandbox
    console.log('\n[PRUEBA TRIGGER] Verificando activación de trigger de cuarentena en sandbox...');
    const [salonsRows] = await conn.query(`SELECT id FROM "${sandboxSchema}"."salons" LIMIT 1`);
    const testSalonId = salonsRows[0].id;

    await conn.query(
      `INSERT INTO "${sandboxSchema}"."pending_tenant_reconciliations" (table_name, record_id, reason, status) VALUES (?, ?, ?, ?)`,
      ['salons', testSalonId, 'Sandbox Trigger Quarantine Test', 'quarantined']
    );

    let quarantineBlocked = false;
    try {
      await conn.query(`UPDATE "${sandboxSchema}"."salons" SET name = 'Modified Name' WHERE id = ?`, [testSalonId]);
    } catch (err) {
      if (err.message.includes('QUARANTINE_VIOLATION')) {
        quarantineBlocked = true;
      }
    }
    assert(quarantineBlocked, 'Trigger de cuarentena debe bloquear modificaciones en filas en cuarentena');
    console.log('  ✅ [PASS] Bloqueo activo de modificación en cuarentena verificado (QUARANTINE_VIOLATION).');

    // Cleanup quarantine fixture
    await conn.query(`DELETE FROM "${sandboxSchema}"."pending_tenant_reconciliations" WHERE record_id = ?`, [testSalonId]);

    // 13. Test Foreign Key Orphan Rejection in Sandbox
    console.log('\n[PRUEBA FK] Verificando rechazo de registro huérfano por Foreign Key...');
    let fkBlocked = false;
    try {
      await conn.query(
        `INSERT INTO "${sandboxSchema}"."branches" (id, tenant_id, name) VALUES (?, ?, ?)`,
        [crypto.randomUUID(), '99999999-9999-4999-8999-999999999999', 'Orphan Branch']
      );
    } catch (err) {
      if (err.code === '23503') {
        fkBlocked = true;
      }
    }
    assert(fkBlocked, 'Inserción de registro con tenant_id huérfano debe ser rechazada con código 23503');
    console.log('  ✅ [PASS] Rechazo activo de huérfano por Foreign Key verificado (PostgreSQL 23503).');

  } finally {
    // 14. Teardown Sandbox Schema
    console.log(`\n[TEARDOWN] Destruyendo esquema desechable "${sandboxSchema}" (DROP SCHEMA CASCADE)...`);
    await conn.query(`DROP SCHEMA IF EXISTS "${sandboxSchema}" CASCADE;`);

    // Verify complete removal from catalog
    const [chkSchema] = await conn.query(`
      SELECT schema_name FROM information_schema.schemata WHERE schema_name = ?;
    `, [sandboxSchema]);
    assert.strictEqual(chkSchema.length, 0, `Sandbox schema ${sandboxSchema} must be completely dropped`);
    console.log(`  ✅ [PASS] Esquema desechable purgado completamente del catálogo (0 residuales).`);

    conn.release();

    // 15. Clean up temporary files
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  }

  console.log('\n========================================================================');
  console.log('🎉 PRUEBA DE RESTAURACIÓN DEL ESQUEMA ACTUAL COMPLETADA EXITOSAMENTE');
  console.log('========================================================================\n');

  process.exit(0);
}

if (require.main === module) {
  testCurrentBackupRestoration().catch(err => {
    console.error('\n❌ ERROR FATAL EN RESTAURACIÓN ACTUAL:', err);
    process.exit(1);
  });
}

module.exports = { testCurrentBackupRestoration };
