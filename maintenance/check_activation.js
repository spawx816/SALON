const mysql = require('mysql2/promise');

(async () => {
  const pool = mysql.createPool({
    host: '82.197.82.137',
    user: 'u566429295_admin',
    password: 'Arrd1227',
    database: 'u566429295_salonpro'
  });

  try {
    const [clients] = await pool.query('SELECT id, email, status FROM clients WHERE email = "neveb29175@iapapi.com"');
    console.log('Client status:', JSON.stringify(clients, null, 2));
    
    const [codes] = await pool.query('SELECT * FROM verification_codes WHERE client_id = ?', [clients[0]?.id]);
    console.log('Codes for this client:', JSON.stringify(codes, null, 2));

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
    process.exit(0);
  }
})();
