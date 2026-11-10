const path = require('path');
const dotenv = require(path.join(__dirname, '../backend/node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));

async function testStats() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  const [stats] = await pool.query(`
    SELECT 
      COUNT(*) as total_operaciones,
      SUM(CASE WHEN status != 'Anulado' THEN 1 ELSE 0 END) as operaciones_vigentes,
      SUM(CASE WHEN status = 'Anulado' THEN 1 ELSE 0 END) as operaciones_anuladas,
      SUM(CASE WHEN status != 'Anulado' AND ncf IS NOT NULL AND TRIM(ncf) != '' AND ncf != 'NONE' THEN 1 ELSE 0 END) as vigentes_con_comprobante,
      SUM(CASE WHEN status != 'Anulado' AND (ncf IS NULL OR TRIM(ncf) = '' OR ncf = 'NONE') THEN 1 ELSE 0 END) as vigentes_sin_comprobante,
      SUM(CASE WHEN status = 'Anulado' AND ncf IS NOT NULL AND TRIM(ncf) != '' AND ncf != 'NONE' THEN 1 ELSE 0 END) as anuladas_con_comprobante,
      SUM(CASE WHEN status = 'Anulado' AND (ncf IS NULL OR TRIM(ncf) = '' OR ncf = 'NONE') THEN 1 ELSE 0 END) as anuladas_sin_comprobante,
      
      -- Desglose en Efectivo
      SUM(CASE WHEN (metodo_pago LIKE '%Efectivo%' OR metodo_pago LIKE '%Cash%') THEN 1 ELSE 0 END) as efectivo_total,
      SUM(CASE WHEN (metodo_pago LIKE '%Efectivo%' OR metodo_pago LIKE '%Cash%') AND status != 'Anulado' THEN 1 ELSE 0 END) as efectivo_vigente,
      SUM(CASE WHEN (metodo_pago LIKE '%Efectivo%' OR metodo_pago LIKE '%Cash%') AND status != 'Anulado' AND ncf IS NOT NULL AND TRIM(ncf) != '' AND ncf != 'NONE' THEN 1 ELSE 0 END) as efectivo_vigente_con_comprobante,
      SUM(CASE WHEN (metodo_pago LIKE '%Efectivo%' OR metodo_pago LIKE '%Cash%') AND status != 'Anulado' AND (ncf IS NULL OR TRIM(ncf) = '' OR ncf = 'NONE') THEN 1 ELSE 0 END) as efectivo_vigente_sin_comprobante,
      SUM(CASE WHEN (metodo_pago LIKE '%Efectivo%' OR metodo_pago LIKE '%Cash%') AND status = 'Anulado' THEN 1 ELSE 0 END) as efectivo_anuladas
    FROM visits
  `);
  console.log('Real Stats from DB:\n', stats[0]);
  await pool.end();
}
testStats();

