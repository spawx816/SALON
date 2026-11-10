const { pool } = require('./db');

async function check() {
  try {
    console.log('--- 1. BUSCANDO CLIENTE ---');
    const [clients] = await pool.query(
      "SELECT * FROM clients WHERE email ILIKE '%angelicapereyra916@gmail.com%' OR email ILIKE '%angelica%' OR name ILIKE '%angelica%'"
    );
    console.log('Clientes encontrados:', JSON.stringify(clients, null, 2));

    let clientId = null;
    if (clients && clients.length > 0) {
      clientId = clients[0].id;
    }

    console.log('\n--- 2. CODIGOS DE VERIFICACION (verification_codes) ---');
    if (clientId) {
      const [codes] = await pool.query(
        "SELECT * FROM verification_codes WHERE client_id::text = ? ORDER BY created_at DESC",
        [String(clientId)]
      );
      console.log('Códigos encontrados para el cliente:', JSON.stringify(codes, null, 2));
    }

    console.log('\n--- 3. ÚLTIMOS CÓDIGOS REGISTRADOS EN verification_codes ---');
    const [recentCodes] = await pool.query(
      "SELECT * FROM verification_codes ORDER BY created_at DESC LIMIT 15"
    );
    console.log('Últimos códigos en verification_codes:', JSON.stringify(recentCodes, null, 2));

    console.log('\n--- 4. CONFIGURACIÓN DE CORREO (email_settings) ---');
    const [settings] = await pool.query("SELECT * FROM email_settings LIMIT 5");
    console.log('Email settings:', JSON.stringify(settings, null, 2));

    console.log('\n--- 5. BUSCAR EN OTRAS TABLAS (gift_cards, surveys, visits, etc.) ---');
    if (clientId) {
      const [visits] = await pool.query("SELECT * FROM visits WHERE client_id::text = ? ORDER BY created_at DESC LIMIT 5", [String(clientId)]);
      console.log('Visitas recientes de la clienta:', JSON.stringify(visits, null, 2));

      const [memberships] = await pool.query("SELECT * FROM memberships WHERE client_id::text = ? OR client_name ILIKE '%angelica%'", [String(clientId)]);
      console.log('Membresías:', JSON.stringify(memberships, null, 2));
    }

  } catch (err) {
    console.error('Error durante la revisión:', err);
  } finally {
    process.exit(0);
  }
}

check();
