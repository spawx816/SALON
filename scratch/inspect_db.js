const db = require('../backend/db');

async function inspect() {
  try {
    const tablesRes = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    console.log('--- TABLES IN POSTGRESQL ---');
    for (const row of tablesRes.rows) {
      const colRes = await db.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position;
      `, [row.table_name]);
      console.log(`\nTable: [${row.table_name}]`);
      console.log('Columns:', colRes.rows.map(c => `${c.column_name} (${c.data_type})`).join(', '));
    }
  } catch (err) {
    console.error('Inspection error:', err);
  } finally {
    process.exit(0);
  }
}

inspect();
