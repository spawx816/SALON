const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function clean() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  const [rows] = await pool.query("SELECT id, ncf, total, codigo_seguridad_ecf FROM visits WHERE ncf LIKE 'E3232%' OR ncf LIKE 'E3131%' OR ncf LIKE 'E3434%'");
  console.log('Rows to fix:', rows.length);

  for (const r of rows) {
    const fixedNcf = r.ncf.replace(/^E(31|32|34)\1/, 'E$1');
    const totalFormatted = Number(r.total || 0).toFixed(2);
    const code = r.codigo_seguridad_ecf || '2744B2';
    const qr = fixedNcf.startsWith('E32')
      ? `https://fc.dgii.gov.do/eCF/ConsultaTimbreFC?RncEmisor=131917038&ENCF=${fixedNcf}&MontoTotal=${totalFormatted}&CodigoSeguridad=${code}`
      : `https://fc.dgii.gov.do/eCF/ConsultaTimbre?RncEmisor=131917038&ENCF=${fixedNcf}&MontoTotal=${totalFormatted}&FechaEmision=02-10-2026&FechaFirma=02-10-2026&CodigoSeguridad=${code}`;

    await pool.query('UPDATE visits SET ncf = ?, qr_code_url = ? WHERE id = ?', [fixedNcf, qr, r.id]);
    console.log(`✅ Factura ${r.id}: ${r.ncf} -> ${fixedNcf}`);
  }

  // Also adjust secuencia_actual in dgii_ncf_sequences
  await pool.query("UPDATE dgii_ncf_sequences SET secuencia_actual = 10 WHERE tipo_comprobante = 'E31'");
  await pool.query("UPDATE dgii_ncf_sequences SET secuencia_actual = 13 WHERE tipo_comprobante = 'E32'");
  await pool.query("UPDATE dgii_ncf_sequences SET secuencia_actual = 0 WHERE tipo_comprobante = 'E34'");

  const [seqs] = await pool.query('SELECT tipo_comprobante, secuencia_actual, cantidad_usada FROM dgii_ncf_sequences');
  console.log('Updated Sequences State:', seqs);

  process.exit(0);
}

clean().catch(err => {
  console.error(err);
  process.exit(1);
});
