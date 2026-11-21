'use strict';

/**
 * Utilidad de Conversión Verificable para Logos Base64 en tenant_branding y tenants (Bloque 3)
 * (backend/scripts/convert_base64_branding_logos.cjs)
 *
 * Garantías de seguridad de datos:
 * 1. Modo `--dry-run` por defecto (no modifica registros salvo que se pase `--apply`).
 * 2. Calcula el hash SHA-256 y tamaño en bytes del buffer original extraído del Data URI.
 * 3. Almacena el archivo cifrado con AES-256-GCM en `private_files` (`category = 'tenant_logo'`).
 * 4. Lee y descifra inmediatamente el archivo desde `PrivateStorageAdapter.readFile()`
 *    y verifica igualdad exacta byte a byte (`Buffer.compare === 0`) y `sha256_hash`.
 * 5. SOLO reemplaza el Data URI por `/api/public/branding/<tenantId>/logo/<fileId>`
 *    después de confirmar la integridad criptográfica de lectura.
 */

const crypto = require('crypto');
const assert = require('assert');
const { PrivateStorageAdapter } = require('../services/private_storage_adapter');

async function convertBase64BrandingLogos(options = {}) {
  const pool = options.pool || require('../db').pool;
  const applyChanges = Boolean(options.apply);
  const storageRoot = options.storageRoot || process.env.STORAGE_ROOT_DIR;
  const storage = new PrivateStorageAdapter({ pool, storageRoot, maxSizeBytes: 10 * 1024 * 1024 });

  const filterTenantId = options.tenantId ? String(options.tenantId) : null;
  const [brandingRows] = await pool.query(
    filterTenantId
      ? `SELECT tenant_id, business_name, logo_url FROM tenant_branding WHERE logo_url LIKE 'data:image/%' AND tenant_id = ?`
      : `SELECT tenant_id, business_name, logo_url FROM tenant_branding WHERE logo_url LIKE 'data:image/%'`,
    filterTenantId ? [filterTenantId] : []
  );

  const [tenantRows] = await pool.query(
    filterTenantId
      ? `SELECT id AS tenant_id, business_name, logo_url FROM tenants WHERE logo_url LIKE 'data:image/%' AND id = ?`
      : `SELECT id AS tenant_id, business_name, logo_url FROM tenants WHERE logo_url LIKE 'data:image/%'`,
    filterTenantId ? [filterTenantId] : []
  );

  const candidatesByTenant = new Map();
  for (const row of brandingRows || []) {
    candidatesByTenant.set(String(row.tenant_id), {
      tenantId: String(row.tenant_id),
      businessName: row.business_name,
      dataUri: row.logo_url,
      inTenantBranding: true,
      inTenants: false
    });
  }
  for (const row of tenantRows || []) {
    const tid = String(row.tenant_id);
    if (candidatesByTenant.has(tid)) {
      candidatesByTenant.get(tid).inTenants = true;
    } else {
      candidatesByTenant.set(tid, {
        tenantId: tid,
        businessName: row.business_name,
        dataUri: row.logo_url,
        inTenantBranding: false,
        inTenants: true
      });
    }
  }

  const results = [];

  for (const item of candidatesByTenant.values()) {
    const match = String(item.dataUri || '').match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      results.push({
        tenantId: item.tenantId,
        status: 'skipped_invalid_data_uri'
      });
      continue;
    }

    const declaredMime = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
    const originalBuffer = Buffer.from(match[2], 'base64');
    const originalSha256 = crypto.createHash('sha256').update(originalBuffer).digest('hex');

    if (!applyChanges) {
      results.push({
        tenantId: item.tenantId,
        businessName: item.businessName,
        status: 'dry_run_verified_candidate',
        mimeType: declaredMime,
        byteSize: originalBuffer.length,
        sha256Hash: originalSha256
      });
      continue;
    }

    // 1. Escribir en almacenamiento privado cifrado
    const saved = await storage.saveFile({
      tenantId: item.tenantId,
      category: 'tenant_logo',
      buffer: originalBuffer,
      mimeType: declaredMime
    });

    // 2. Leer y descifrar inmediatamente para confirmar integridad ANTES de tocar tenant_branding/tenants
    const readBack = await storage.readFile({
      tenantId: item.tenantId,
      fileId: saved.id
    });

    assert.strictEqual(readBack.sha256Hash, originalSha256, `SHA-256 mismatch al verificar logo de tenant ${item.tenantId}`);
    assert.strictEqual(Number(readBack.byteSize), originalBuffer.length, `Byte size mismatch al verificar logo de tenant ${item.tenantId}`);
    assert.strictEqual(Buffer.compare(readBack.buffer, originalBuffer), 0, `Buffer mismatch al verificar logo de tenant ${item.tenantId}`);

    const canonicalUrl = `/api/public/branding/${item.tenantId}/logo/${saved.id}`;

    // 3. Reemplazar el Data URI solo tras confirmar lectura íntegra
    if (item.inTenantBranding) {
      await pool.query(
        `UPDATE tenant_branding SET logo_url = ?, updated_at = NOW() WHERE tenant_id = ?`,
        [canonicalUrl, item.tenantId]
      );
    }
    if (item.inTenants) {
      await pool.query(
        `UPDATE tenants SET logo_url = ?, updated_at = NOW() WHERE id = ?`,
        [canonicalUrl, item.tenantId]
      );
    }

    results.push({
      tenantId: item.tenantId,
      businessName: item.businessName,
      status: 'converted_and_verified',
      fileId: saved.id,
      canonicalUrl,
      mimeType: readBack.mimeType,
      byteSize: readBack.byteSize,
      sha256Hash: readBack.sha256Hash
    });
  }

  return {
    mode: applyChanges ? 'apply' : 'dry_run',
    totalCandidates: candidatesByTenant.size,
    results
  };
}

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  convertBase64BrandingLogos({ apply })
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Error en convert_base64_branding_logos:', err);
      process.exit(1);
    });
}

module.exports = { convertBase64BrandingLogos };
