const path = require('path');
require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));

async function inspectSchema() {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  const [cols] = await c.query("DESCRIBE dgii_ncf_sequences");
  console.log('dgii_ncf_sequences columns:');
  console.dir(cols, { depth: null });

  const [rows] = await c.query("SELECT id, tipo_comprobante, no_solicitud, no_autorizacion, numero_desde, numero_hasta, secuencia_actual, cantidad_aprobada, cantidad_usada, fecha_vencimiento, CURDATE(), fecha_vencimiento >= CURDATE() as is_valid_date, estado FROM dgii_ncf_sequences");
  console.log('\nRows with CURDATE() comparison:');
  console.dir(rows, { depth: null });

  await c.end();
}

inspectSchema().catch(console.error);

