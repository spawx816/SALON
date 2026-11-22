'use strict';

/**
 * Migración Incremental: Roles Predefinidos por Empresa y Metadatos de Plantillas RBAC
 * (backend/migrations/20261123_rbac_accounting_and_role_templates.cjs)
 *
 * Objetivo:
 * - Agregar identificadores estables de plantilla en `roles` (`template_key`, `template_version`, `is_customized`)
 *   para instalar roles predefinidos de forma idempotente, respetar roles personalizados y permitir
 *   restauración explícita sin recrear automáticamente roles eliminados por la empresa.
 */

const { pool: defaultPool } = require('../db');

async function up(targetPool = defaultPool, targetSchema = 'public') {
  const conn = await targetPool.getConnection();
  try {
    const schema = targetSchema || 'public';
    await conn.query(`SET search_path TO "${schema}";`);
    await conn.query('BEGIN');

    await conn.query(`
      ALTER TABLE "${schema}".roles
        ADD COLUMN IF NOT EXISTS template_key VARCHAR(64),
        ADD COLUMN IF NOT EXISTS template_version INTEGER DEFAULT 1,
        ADD COLUMN IF NOT EXISTS is_customized BOOLEAN DEFAULT FALSE;
    `);

    await conn.query(`
      UPDATE "${schema}".roles
      SET is_customized = COALESCE(is_customized, FALSE),
          template_version = CASE WHEN template_key IS NOT NULL THEN COALESCE(template_version, 1) ELSE template_version END
      WHERE is_customized IS NULL
         OR (template_key IS NOT NULL AND template_version IS NULL);
    `);

    await conn.query(`
      ALTER TABLE "${schema}".roles
        ALTER COLUMN is_customized SET DEFAULT FALSE,
        ALTER COLUMN is_customized SET NOT NULL;
    `);

    await conn.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_tenant_template_key
        ON "${schema}".roles (tenant_id, template_key)
        WHERE template_key IS NOT NULL;
    `);

    await conn.query('COMMIT');
    return { success: true };
  } catch (err) {
    await conn.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  name: '20261123_rbac_accounting_and_role_templates',
  up,
};
