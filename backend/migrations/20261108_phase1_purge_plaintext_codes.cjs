/**
 * Migration: 20261108_phase1_purge_plaintext_codes
 * 
 * Permanently purges and invalidates all plaintext codes from verification_codes table,
 * ensuring only cryptographic SHA-256 hashes (code_hash) are retained.
 */

async function up(targetPool, targetSchema = null) {
  console.log('🛡️ [MIGRATION] Purgando códigos de verificación en texto plano...');
  const conn = await targetPool.getConnection();
  try {
    await conn.beginTransaction();

    if (targetSchema) {
      await conn.query(`SET search_path TO ${targetSchema}, public;`);
    }

    // 1. Ensure code column is nullable
    await conn.query(`
      ALTER TABLE verification_codes 
        ALTER COLUMN code DROP NOT NULL;
    `);

    // 2. Set all plaintext codes to NULL
    const [res] = await conn.query(`
      UPDATE verification_codes 
      SET code = NULL 
      WHERE code IS NOT NULL;
    `);

    await conn.commit();
    console.log(`✅ [MIGRATION] Purgados ${res.affectedRows || res.rowCount || 0} códigos en texto plano.`);
  } catch (err) {
    await conn.rollback();
    console.error('❌ [MIGRATION ERROR]: Error purgando códigos en texto plano:', err.message);
    throw err;
  } finally {
    conn.release();
  }
}

async function down(targetPool) {
  // Plaintext codes cannot be restored once purged
  console.log('ℹ️ [MIGRATION ROLLBACK] Los códigos purgados no pueden restaurarse en texto plano.');
}

module.exports = { up, down };

