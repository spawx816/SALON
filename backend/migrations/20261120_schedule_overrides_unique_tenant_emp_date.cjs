'use strict';

/**
 * Migración idempotente: índice único atómico en schedule_overrides (tenant_id, employee_id, date)
 * para garantizar upsert sin duplicados bajo concurrencia.
 *
 * Política de seguridad de datos:
 * - Antes de eliminar cualquier duplicado, archiva una copia íntegra de las filas descartadas
 *   en schedule_overrides_dedup_archive (con motivo y timestamp) para trazabilidad y recuperación.
 * - Conserva únicamente el registro más reciente (MAX(id)) por clave (tenant_id, employee_id, date).
 */
async function up(pool) {
  // 1. Inspeccionar si existen duplicados antes de modificar datos
  const [dupGroups] = await pool.query(`
    SELECT tenant_id, employee_id, date, COUNT(*)::int AS cnt, MAX(id) AS kept_id
    FROM schedule_overrides
    GROUP BY tenant_id, employee_id, date
    HAVING COUNT(*) > 1
  `);

  let archivedCount = 0;
  let deletedCount = 0;

  if (Array.isArray(dupGroups) && dupGroups.length > 0) {
    // Crear tabla de archivo trazable solo si existen duplicados a depurar
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schedule_overrides_dedup_archive (
        archive_id SERIAL PRIMARY KEY,
        original_id INTEGER,
        tenant_id TEXT,
        employee_id TEXT,
        date TEXT,
        row_snapshot JSONB,
        kept_id INTEGER,
        archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reason TEXT NOT NULL
      )
    `);

    const [archivedRows] = await pool.query(`
      INSERT INTO schedule_overrides_dedup_archive (original_id, tenant_id, employee_id, date, row_snapshot, kept_id, reason)
      SELECT a.id, a.tenant_id::text, a.employee_id::text, a.date::text, to_jsonb(a), d.kept_id,
             'Deduplicación previa a uq_schedule_overrides_tenant_emp_date (se conserva MAX(id))'
      FROM schedule_overrides a
      INNER JOIN (
        SELECT tenant_id, employee_id, date, MAX(id) AS kept_id
        FROM schedule_overrides
        GROUP BY tenant_id, employee_id, date
        HAVING COUNT(*) > 1
      ) d ON a.tenant_id = d.tenant_id AND a.employee_id = d.employee_id AND a.date = d.date
      WHERE a.id < d.kept_id
      RETURNING original_id
    `);
    archivedCount = Array.isArray(archivedRows) ? archivedRows.length : 0;

    const [deletedRows] = await pool.query(`
      DELETE FROM schedule_overrides a
      USING schedule_overrides b
      WHERE a.tenant_id = b.tenant_id
        AND a.employee_id = b.employee_id
        AND a.date = b.date
        AND a.id < b.id
      RETURNING a.id
    `);
    deletedCount = Array.isArray(deletedRows) ? deletedRows.length : 0;
  }

  // 2. Crear índice único compuesto por tenant_id, employee_id, date
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_schedule_overrides_tenant_emp_date
    ON schedule_overrides (tenant_id, employee_id, date)
  `);

  return {
    duplicateGroupsFound: Array.isArray(dupGroups) ? dupGroups.length : 0,
    archivedCount,
    deletedCount,
  };
}

module.exports = { up };
