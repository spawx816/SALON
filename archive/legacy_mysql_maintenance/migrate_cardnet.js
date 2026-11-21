const mysql = require('mysql2/promise');

async function migrate() {
  const c = await mysql.createConnection({
    host: '82.197.82.137',
    user: 'u566429295_admin',
    password: 'Arrd1227',
    database: 'u566429295_salonpro'
  });

  try {
    console.log('Altering clients...');
    await c.query('ALTER TABLE clients ADD COLUMN cardnet_customer_id VARCHAR(100) NULL');
  } catch (e) {
    console.log('clients col might exist:', e.message);
  }

  try {
    console.log('Altering contracts...');
    await c.query('ALTER TABLE contracts ADD COLUMN payment_profile_id VARCHAR(100) NULL');
    await c.query('ALTER TABLE contracts ADD COLUMN last_billed_date DATE NULL');
    await c.query('ALTER TABLE contracts ADD COLUMN next_billing_date DATE NULL');
    await c.query('ALTER TABLE contracts ADD COLUMN auto_billing_enabled TINYINT(1) DEFAULT 1');
  } catch (e) {
    console.log('contracts cols might exist:', e.message);
  }

  console.log('MIGRACION COMPLETA');
  c.destroy();
}

migrate();
