const { pool } = require('./db');

async function dropConstraints() {
  console.log('🔓 Eliminando restricciones NOT NULL bloqueantes...');
  const client = await pool.rawPool.connect();

  try {
    await client.query('BEGIN');

    // 1. cash_registers
    await client.query(`
      ALTER TABLE cash_registers ALTER COLUMN tenant_id DROP NOT NULL;
      ALTER TABLE cash_registers ALTER COLUMN branch_id DROP NOT NULL;
      ALTER TABLE cash_registers ALTER COLUMN name DROP NOT NULL;
    `);

    // 2. clients
    await client.query(`
      ALTER TABLE clients ALTER COLUMN tenant_id DROP NOT NULL;
      ALTER TABLE clients ALTER COLUMN name DROP NOT NULL;
    `);

    // 3. services
    await client.query(`
      ALTER TABLE services ALTER COLUMN tenant_id DROP NOT NULL;
      ALTER TABLE services ALTER COLUMN name DROP NOT NULL;
    `);

    // 4. salons
    await client.query(`
      ALTER TABLE salons ALTER COLUMN name DROP NOT NULL;
    `);

    await client.query('COMMIT');
    console.log('✅ Restricciones NOT NULL eliminadas exitosamente.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error eliminando restricciones:', err);
  } finally {
    client.release();
    process.exit(0);
  }
}

dropConstraints();
