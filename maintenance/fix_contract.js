const mysql = require('mysql2/promise');

async function fixContract() {
  const pool = mysql.createPool({
    host: '82.197.82.137',
    user: 'u566429295_admin',
    password: 'Arrd1227',
    database: 'u566429295_salonpro'
  });

  try {
    console.log('Fixing Anderson contract services...');
    const promoServices = JSON.stringify(["5 Lavados Premium", "1 Secado Especial"]);
    const contractServices = JSON.stringify(["4 Lavados Mensuales"]);
    await pool.query("UPDATE contracts SET contract_promo_services = ?, contract_services = ? WHERE client_id = '1777645718693'", [promoServices, contractServices]);
    console.log('Contract fixed!');
  } catch (e) {
    console.error('Failed:', e);
  } finally {
    await pool.end();
  }
}

fixContract();
