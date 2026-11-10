const mysql = require('mysql2/promise');

async function migrate() {
  const connection = await mysql.createConnection({
    host: '82.197.82.137',
    user: 'u566429295_admin',
    password: 'Arrd1227',
    database: 'u566429295_salonpro'
  });

  try {
    console.log('Adding description and gateway_ref columns to payments table...');
    
    // Add gateway_ref column
    try {
      await connection.execute('ALTER TABLE payments ADD COLUMN gateway_ref VARCHAR(255) AFTER method');
      console.log('Column gateway_ref added.');
    } catch (e) {
      console.log('Column gateway_ref might already exist.');
    }

    // Add description column
    try {
      await connection.execute('ALTER TABLE payments ADD COLUMN description TEXT AFTER gateway_ref');
      console.log('Column description added.');
    } catch (e) {
      console.log('Column description might already exist.');
    }

    console.log('Migration completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    await connection.end();
  }
}

migrate();
