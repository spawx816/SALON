const path = require('path');
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));
const dotenv = require(path.join(__dirname, '../backend/node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '../backend/.env') });

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    database: process.env.DB_NAME,
    timezone: '-04:00'
  });

  const [all606] = await pool.query('SELECT * FROM dgii_606_purchases');
  console.log(`Total 606 rows in database: ${all606.length}`);
  all606.forEach(r => {
    console.log({
      id: r.id,
      periodo: r.periodo,
      proveedor: r.proveedor,
      ncf: r.ncf,
      fecha_factura: r.fecha_factura,
      fecha_pago: r.fecha_pago,
      total_facturado: r.total_facturado,
      itbis_retenido: r.itbis_retenido,
      isr_retenido: r.isr_retenido,
      clasificacion_gasto: r.clasificacion_gasto,
      estado: r.estado,
      notas: r.notas
    });
  });

  await pool.end();
}

main().catch(console.error);

