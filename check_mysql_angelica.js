const mysql = require('mysql2/promise');

async function check() {
  let conn;
  try {
    conn = await mysql.createConnection({
      host: '2.24.86.39',
      user: 'salon_admin',
      password: 'SalonPro_2024_Success!',
      database: 'u566429295_salon_v2',
      connectTimeout: 8000
    });
    console.log('✅ Conectado a MySQL u566429295_salon_v2!');

    // Check columns of clients
    const [cols] = await conn.query("SHOW COLUMNS FROM clients");
    console.log('Columnas de clients:', cols.map(c => c.Field));

    console.log('\n--- 1. BUSCANDO CLIENTE EN clients POR EMAIL ---');
    const [clients] = await conn.query(
      "SELECT * FROM clients WHERE email LIKE '%angelicapereyra916@gmail.com%' OR email LIKE '%angelica%'"
    );
    console.log('Clientes encontrados por email:', JSON.stringify(clients, null, 2));

    let clientId = null;
    let clientEmail = null;
    if (clients && clients.length > 0) {
      clientId = clients[0].id;
      clientEmail = clients[0].email;
    }

    console.log('\n--- 2. CODIGOS EN verification_codes ---');
    try {
      const [vcols] = await conn.query("SHOW COLUMNS FROM verification_codes");
      console.log('Columnas de verification_codes:', vcols.map(c => c.Field));

      if (clientId) {
        const [codes] = await conn.query(
          "SELECT * FROM verification_codes WHERE client_id = ? ORDER BY created_at DESC",
          [clientId]
        );
        console.log('Códigos específicos del client_id:', JSON.stringify(codes, null, 2));
      }

      const [recentCodes] = await conn.query(
        "SELECT * FROM verification_codes ORDER BY created_at DESC LIMIT 15"
      );
      console.log('Últimos códigos en verification_codes:', JSON.stringify(recentCodes, null, 2));
    } catch (e) {
      console.error('Error con verification_codes:', e.message);
    }

    console.log('\n--- 3. CONFIGURACIÓN DE CORREO (email_settings) ---');
    try {
      const [settings] = await conn.query("SELECT * FROM email_settings");
      console.log('Email settings:', JSON.stringify(settings, null, 2));
    } catch (e) {
      console.error('Error email_settings:', e.message);
    }

    console.log('\n--- 4. BUSCAR EN OTRAS TABLAS (gift_cards / gift_certificates / visits / etc.) ---');
    const [tables] = await conn.query("SHOW TABLES");
    console.log('Tablas en la BD:', tables.map(t => Object.values(t)[0]));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    if (conn) await conn.end();
    process.exit(0);
  }
}

check();
