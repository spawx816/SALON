'use strict';

/**
 * Migración idempotente: índice único atómico en schedule_overrides (tenant_id, employee_id, date)
 * para garantizar upsert sin duplicados bajo concurrencia.
 */
async function up(pool) {
  // 1. Eliminar posibles duplicados históricos conservando el registro más reciente (MAX(id))
  await pool.query(`
    DELETE FROM schedule_overrides a
    USING schedule_overrides b
    WHERE a.tenant_id = b.tenant_id
      AND a.employee_id = b.employee_id
      AND a.date = b.date
      AND a.id < b.id
  `);

  // 2. Crear índice único compuesto por tenant_id, employee_id, date
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_schedule_overrides_tenant_emp_date
    ON schedule_overrides (tenant_id, employee_id, date)
  `);
}

module.exports = { up };
