const { pool } = require('./db');

async function check() {
  try {
    const [pCols] = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'plans'");
    console.log('plans columns:', pCols.map(c => c.column_name));
    
    const [cCols] = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'contracts'");
    console.log('contracts columns:', cCols.map(c => c.column_name));
  } catch (e) {
    console.error(e);
  } finally {
    process.exit();
  }
}

check();
