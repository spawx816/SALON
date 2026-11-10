/**
 * Data Retention & Purge Management Service (REM-P2-09 & Addendum 1)
 *
 * Implements:
 * 1. Policy-based retention evaluation (attendance photos, temp exports, job nonces).
 * 2. Mandatory dry-run default (is_dry_run = true).
 * 3. Strict legal hold protection: invoices, tax documents, and digital contracts NEVER purged.
 * 4. Fails closed with 403 PURGE_EXECUTION_BLOCKED if physical purge is requested without explicit feature flag.
 * 5. Full audit trail in data_retention_runs.
 */

'use strict';

class DataRetentionService {
  constructor(pool) {
    this.pool = pool;
  }

  async listPolicies() {
    const [rows] = await this.pool.query(`
      SELECT category, default_retention_days, legal_hold, action, description, updated_at
      FROM data_retention_policies
      ORDER BY category ASC
    `);
    return rows;
  }

  async runRetention({ tenantId, category, isDryRun = true, executedBy = null }) {
    if (!category || typeof category !== 'string') {
      const err = new Error('CATEGORY_REQUIRED: Categoría de retención obligatoria.');
      err.status = 400;
      throw err;
    }

    // 1. Fetch policy definition
    const [policies] = await this.pool.query(`
      SELECT * FROM data_retention_policies
      WHERE category = ?
      LIMIT 1
    `, [category]);

    if (policies.length === 0) {
      const err = new Error(`POLICY_NOT_FOUND: No existe política de retención para la categoría "${category}".`);
      err.status = 404;
      err.code = 'POLICY_NOT_FOUND';
      throw err;
    }

    const policy = policies[0];

    // 2. Strict Legal Hold Check (Addendum 1)
    if (policy.legal_hold) {
      const summary = {
        category,
        legal_hold: true,
        action: 'BLOCKED',
        message: 'Categoría sujeta a conservación legal obligatoria. Toda acción de purga o eliminación está permanentemente bloqueada.'
      };

      await this.pool.query(`
        INSERT INTO data_retention_runs (
          tenant_id, category, is_dry_run, records_scanned, records_eligible,
          records_purged, summary, executed_by
        ) VALUES (?, ?, ?, 0, 0, 0, ?, ?)
      `, [tenantId || null, category, Boolean(isDryRun), JSON.stringify(summary), executedBy || null]);

      return {
        category,
        is_dry_run: true,
        legal_hold: true,
        records_scanned: 0,
        records_eligible: 0,
        records_purged: 0,
        summary
      };
    }

    // 3. Execution Protection Feature Flag (Addendum 1)
    if (!isDryRun) {
      const isPurgeEnabled = process.env.ENABLE_DATA_PURGE === 'true';
      if (!isPurgeEnabled) {
        const err = new Error('PURGE_EXECUTION_BLOCKED: La ejecución física de purga está desactivada por política de seguridad en este entorno. Solo se permite evaluación en modo dry-run.');
        err.status = 403;
        err.code = 'PURGE_EXECUTION_BLOCKED';
        throw err;
      }
    }

    const retentionDays = Number(policy.default_retention_days) || 90;
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    let scannedCount = 0;
    let eligibleCount = 0;
    let purgedCount = 0;
    const details = [];

    // Category-specific evaluation
    if (category === 'attendance_photos') {
      const [attRows] = await this.pool.query(`
        SELECT id, timestamp
        FROM attendance
        WHERE tenant_id = ?
          AND photo_file_id IS NOT NULL
      `, [tenantId]);

      scannedCount = attRows.length;
      const eligible = attRows.filter(r => new Date(r.timestamp) < cutoffDate);
      eligibleCount = eligible.length;

      if (!isDryRun && eligibleCount > 0) {
        const ids = eligible.map(r => r.id);
        const [delRes] = await this.pool.query(`
          UPDATE attendance
          SET photo_file_id = NULL
          WHERE tenant_id = ? AND id::text = ANY(?::text[])
        `, [tenantId, ids]);
        purgedCount = delRes.rowCount || ids.length;
      }
    } else if (category === 'temp_exports') {
      const [expRows] = await this.pool.query(`
        SELECT id, expires_at
        FROM tenant_exports
        WHERE tenant_id = ?
      `, [tenantId]);

      scannedCount = expRows.length;
      const now = new Date();
      const eligible = expRows.filter(r => new Date(r.expires_at) < now);
      eligibleCount = eligible.length;

      if (!isDryRun && eligibleCount > 0) {
        const ids = eligible.map(r => r.id);
        const [delRes] = await this.pool.query(`
          UPDATE tenant_exports
          SET status = 'EXPIRED', download_token_hash = NULL
          WHERE tenant_id = ? AND id = ANY(?::uuid[])
        `, [tenantId, ids]);
        purgedCount = delRes.rowCount || ids.length;
      }
    } else if (category === 'system_job_nonces') {
      const [nonceRows] = await this.pool.query(`
        SELECT id, expires_at
        FROM job_request_nonces
      `);

      scannedCount = nonceRows.length;
      const now = new Date();
      const eligible = nonceRows.filter(r => new Date(r.expires_at) < now);
      eligibleCount = eligible.length;

      if (!isDryRun && eligibleCount > 0) {
        const ids = eligible.map(r => r.id);
        const [delRes] = await this.pool.query(`
          DELETE FROM job_request_nonces
          WHERE id = ANY(?::bigint[])
        `, [ids]);
        purgedCount = delRes.rowCount || ids.length;
      }
    }

    const runSummary = {
      category,
      cutoff_date: cutoffDate.toISOString(),
      retention_days: retentionDays,
      is_dry_run: Boolean(isDryRun),
      scanned_count: scannedCount,
      eligible_count: eligibleCount,
      purged_count: purgedCount
    };

    await this.pool.query(`
      INSERT INTO data_retention_runs (
        tenant_id, category, is_dry_run, records_scanned, records_eligible,
        records_purged, summary, executed_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      tenantId || null,
      category,
      Boolean(isDryRun),
      scannedCount,
      eligibleCount,
      purgedCount,
      JSON.stringify(runSummary),
      executedBy || null
    ]);

    return {
      category,
      is_dry_run: Boolean(isDryRun),
      legal_hold: false,
      records_scanned: scannedCount,
      records_eligible: eligibleCount,
      records_purged: purgedCount,
      summary: runSummary
    };
  }
}

module.exports = { DataRetentionService };

