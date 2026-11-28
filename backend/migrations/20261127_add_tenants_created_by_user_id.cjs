/**
 * Migración: Añadir columna created_by_user_id a tenants para trazabilidad de Portal de Vendedores y SuperAdmin
 */
async function upTenantsCreatedByUserId(pool, targetSchema = 'public') {
  const schema = targetSchema || 'public';
  const conn = await pool.getConnection();
  try {
    await conn.query('BEGIN');
    await conn.query(`
      ALTER TABLE "${schema}".tenants
        ADD COLUMN IF NOT EXISTS created_by_user_id TEXT;
    `);
    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_tenants_created_by_user_id
        ON "${schema}".tenants (created_by_user_id)
        WHERE created_by_user_id IS NOT NULL;
    `);
    await conn.query('COMMIT');
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  upTenantsCreatedByUserId,
};
