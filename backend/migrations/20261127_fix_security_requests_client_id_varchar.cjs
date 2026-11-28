/**
 * Migración: Convertir security_requests.client_id a VARCHAR(255) para soportar 'POS', UUIDs y códigos de empleado
 */
async function upFixSecurityRequestsClientIdVarchar(pool, targetSchema = 'public') {
  const schema = targetSchema || 'public';
  const conn = await pool.getConnection();
  try {
    await conn.query('BEGIN');
    await conn.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = '${schema}'
            AND table_name = 'security_requests'
            AND column_name = 'client_id'
            AND data_type <> 'character varying'
        ) THEN
          ALTER TABLE "${schema}".security_requests
            ALTER COLUMN client_id TYPE VARCHAR(255) USING client_id::text;
        END IF;
      END $$;
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
  upFixSecurityRequestsClientIdVarchar,
};
