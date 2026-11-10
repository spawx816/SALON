const { pool } = require('./db');

async function migrate() {
  console.log('Iniciando sincronización de columnas para visits y contracts en PostgreSQL...');
  
  const visitsQueries = [
    'ALTER TABLE visits ADD COLUMN IF NOT EXISTS ncf_nota_credito VARCHAR(50)',
    'ALTER TABLE visits ADD COLUMN IF NOT EXISTS nota_credito_motivo TEXT',
    'ALTER TABLE visits ADD COLUMN IF NOT EXISTS nota_credito_fecha TIMESTAMP',
    'ALTER TABLE visits ADD COLUMN IF NOT EXISTS nota_credito_track_id VARCHAR(100)',
    'ALTER TABLE visits ADD COLUMN IF NOT EXISTS nota_credito_xml TEXT',
    'ALTER TABLE visits ADD COLUMN IF NOT EXISTS nota_credito_qr_url TEXT'
  ];

  const contractsQueries = [
    'ALTER TABLE contracts ADD COLUMN IF NOT EXISTS signature_hash TEXT',
    'ALTER TABLE contracts ADD COLUMN IF NOT EXISTS ip_address VARCHAR(50)',
    'ALTER TABLE contracts ADD COLUMN IF NOT EXISTS device_agent TEXT',
    'ALTER TABLE contracts ADD COLUMN IF NOT EXISTS geolocation VARCHAR(100)',
    'ALTER TABLE contracts ADD COLUMN IF NOT EXISTS payment_profile_id VARCHAR(100)',
    'ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_services TEXT',
    'ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_promo_services TEXT',
    'ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_promo_duration VARCHAR(50)',
    'ALTER TABLE contracts ADD COLUMN IF NOT EXISTS last_billed_date TIMESTAMP',
    'ALTER TABLE contracts ADD COLUMN IF NOT EXISTS next_billing_date TIMESTAMP',
    'ALTER TABLE contracts ADD COLUMN IF NOT EXISTS next_retry_date TIMESTAMP',
    'ALTER TABLE contracts ADD COLUMN IF NOT EXISTS auto_billing_enabled BOOLEAN DEFAULT TRUE',
    'ALTER TABLE contracts ADD COLUMN IF NOT EXISTS document_photo TEXT',
    'ALTER TABLE contracts ADD COLUMN IF NOT EXISTS selfie_photo TEXT'
  ];

  for (const q of visitsQueries) {
    try {
      await pool.query(q);
      console.log('✅ Ejecutado:', q);
    } catch (e) {
      console.error('Error en:', q, e.message);
    }
  }

  for (const q of contractsQueries) {
    try {
      await pool.query(q);
      console.log('✅ Ejecutado:', q);
    } catch (e) {
      console.error('Error en:', q, e.message);
    }
  }

  console.log('Migración de columnas finalizada exitosamente.');
  process.exit();
}

migrate();
