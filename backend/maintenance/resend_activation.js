const mysql = require('mysql2/promise');
const nodemailer = require('nodemailer');

async function resend() {
  const config = {
    host: '82.197.82.137',
    user: 'u566429295_admin',
    password: 'Arrd1227',
    database: 'u566429295_salonpro'
  };

  const pool = mysql.createPool(config);

  try {
    // 1. Get last client
    const [clients] = await pool.query('SELECT * FROM clients ORDER BY created_at DESC LIMIT 1');
    if (clients.length === 0) return console.log('No hay clientes.');
    
    const client = clients[0];
    console.log(`Re-enviando credenciales para: ${client.nombre} (${client.email})`);

    // 2. Get Email Settings
    const [settings] = await pool.query('SELECT * FROM email_settings LIMIT 1');
    if (settings.length === 0) return console.log('No hay configuración de correo.');
    const s = settings[0];

    // 3. Send Email
    const transporter = nodemailer.createTransport({
      host: s.smtp_host, port: s.smtp_port, secure: s.smtp_port == 465,
      auth: { user: s.smtp_user, pass: s.smtp_pass }
    });

    const tempPassword = client.password; // Assuming it was generated and stored

    await transporter.sendMail({
      from: `"${s.smtp_from || 'Abatte Peluquería'}" <${s.smtp_user}>`,
      to: client.email,
      subject: 'Bienvenida a Abatte Peluquería - Tus Credenciales',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 40px; border: 1px solid #eee; border-radius: 20px; background: #fff;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #09090b; margin: 0; font-size: 24px; font-weight: 900;">¡Hola ${client.nombre}!</h1>
          </div>
          
          <p style="color: #444; line-height: 1.6;">Tu cuenta en <strong>Abatte Peluquería</strong> ha sido creada. Ya puedes acceder a tu panel de cliente para gestionar tus servicios.</p>
          
          <div style="background: #f8fafc; padding: 25px; border-radius: 16px; margin: 30px 0; border: 1px solid #e2e8f0;">
            <p style="margin: 0 0 10px 0; font-size: 0.9rem; color: #64748b;">Tus credenciales de acceso:</p>
            <p style="margin: 5px 0; font-size: 1.1rem;"><strong>Usuario:</strong> ${client.email}</p>
            <p style="margin: 5px 0; font-size: 1.1rem;"><strong>Contraseña Temporal:</strong> <span style="background: #09090b; color: #fff; padding: 2px 8px; border-radius: 4px;">${tempPassword}</span></p>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="http://localhost:5173/login" style="background: #09090b; color: #fff; padding: 16px 32px; border-radius: 12px; text-decoration: none; font-weight: 800; display: inline-block;">
              Iniciar Sesión
            </a>
          </div>

          <p style="color: #ef4444; font-size: 0.85rem; font-weight: 700;">IMPORTANTE: Se te pedirá cambiar esta contraseña al ingresar por primera vez por motivos de seguridad.</p>
          
          <hr style="border: 0; border-top: 1px solid #eee; margin: 30px 0;" />
          <p style="font-size: 0.75rem; color: #999; text-align: center;">
            Abatte Peluquería &copy; 2026
          </p>
        </div>
      `
    });

    console.log('✅ Credenciales re-enviadas con éxito.');

  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await pool.end();
  }
}

resend();
