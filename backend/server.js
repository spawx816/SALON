const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const axios = require('axios');
const nodemailer = require('nodemailer');
const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// === SEO & CANONICAL REDIRECTS ===
app.use((req, res, next) => {
  const host = req.get('host');
  if (!host) return next();

  const isProduction = host.includes('planbeautyrd.com');
  const isWww = host.startsWith('www.');
  const forwardedProto = req.headers['x-forwarded-proto'];

  if (isProduction) {
    // 1. Redirigir WWW a no-WWW siempre a HTTPS
    if (isWww) {
      const cleanHost = host.replace(/^www\./, '');
      return res.redirect(301, `https://${cleanHost}${req.originalUrl}`);
    }
    
    // 2. Redirigir HTTP a HTTPS solo si detectamos explícitamente que es HTTP
    // Esto evita bucles si el proxy no envía el header correctamente
    if (forwardedProto === 'http') {
      return res.redirect(301, `https://${host}${req.originalUrl}`);
    }
  }
  next();
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.static(path.join(__dirname, '..', 'dist')));

const CARDNET_CONFIG = {
  MERCHANT_NUMBER: process.env.CARDNET_MERCHANT_NUMBER,
  TERMINAL_ID: process.env.CARDNET_TERMINAL_ID,
  BASE_URL: process.env.CARDNET_BASE_URL,
  PUBLIC_KEY: process.env.CARDNET_PUBLIC_KEY,
  PRIVATE_KEY: process.env.CARDNET_PRIVATE_KEY,
  ENV: process.env.CARDNET_ENV,
  TIMEOUT: parseInt(process.env.CARDNET_TIMEOUT) || 30000
};

const getCardNetAuthHeaders = () => {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Basic ${CARDNET_CONFIG.PRIVATE_KEY}`
  };
};

// Database Pool Configuration
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: '-04:00'
});

// Configure Dominican Republic Timezone (-04:00) on all session connections
pool.on('connection', (connection) => {
  connection.query("SET time_zone = '-04:00'");
});

// GLOBAL LOGGER
app.use((req, res, next) => {
  console.log(`[GLOBAL LOG] ${req.method} ${req.url}`);
  next();
});

// SECURITY HEADERS MIDDLEWARE (Required for CardNet and security audit)
app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), interest-cohort=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://servicios.cardnet.com.do https://labservicios.cardnet.com.do; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: *; frame-src 'self' https://servicios.cardnet.com.do https://labservicios.cardnet.com.do; connect-src 'self' https://servicios.cardnet.com.do https://labservicios.cardnet.com.do;");
  next();
});

// Setup Database Tables
const setupDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS verification_codes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        client_id VARCHAR(50),
        code VARCHAR(6),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        is_used TINYINT DEFAULT 0
      )
    `);
    console.log('[DB] Verification codes table ready.');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_settings (
        id INT PRIMARY KEY DEFAULT 1,
        smtp_host VARCHAR(255),
        smtp_port INT,
        smtp_user VARCHAR(255),
        smtp_pass VARCHAR(255),
        smtp_from VARCHAR(255),
        smtp_secure TINYINT DEFAULT 1
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS security_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        client_id VARCHAR(50),
        service_name VARCHAR(255),
        staff_name VARCHAR(100),
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gift_cards (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(20) UNIQUE NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        balance DECIMAL(10,2) NOT NULL,
        client_id VARCHAR(50),
        recipient_name VARCHAR(100),
        status VARCHAR(20) DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gift_card_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        gift_card_id INT NOT NULL,
        amount_redeemed DECIMAL(10,2) NOT NULL,
        balance_before DECIMAL(10,2) NOT NULL,
        balance_after DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (gift_card_id) REFERENCES gift_cards(id) ON DELETE CASCADE
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS billing_codes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        contract_id VARCHAR(50),
        code VARCHAR(6),
        action_type ENUM('cancellation', 'manual_billing'),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        is_used TINYINT DEFAULT 0
      )
    `);
    console.log('[DB] Billing codes table ready.');

    // Alter clients table to track birthday emails sent
    try {
      await pool.query('ALTER TABLE clients ADD COLUMN last_birthday_sent_year INT DEFAULT 0');
      console.log('[DB] Column last_birthday_sent_year checked/created in clients table.');
    } catch (err) {
      // Column probably already exists or clients table not seeded yet, ignore safely
    }

    // Setup Marketing Settings Table
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS marketing_settings (
          id INT PRIMARY KEY DEFAULT 1,
          birthday_automation_enabled TINYINT(1) DEFAULT 1,
          birthday_discount INT DEFAULT 15,
          birthday_flyer_url TEXT,
          birthday_email_subject VARCHAR(255) DEFAULT '¡Feliz Cumpleaños! 🎉',
          birthday_email_template TEXT,
          mass_email_template TEXT
        )
      `);
      
      // Seed default row if not exists
      const [rows] = await pool.query('SELECT COUNT(*) as count FROM marketing_settings');
      if (rows[0].count === 0) {
        await pool.query(`
          INSERT INTO marketing_settings (id, birthday_automation_enabled, birthday_discount, birthday_flyer_url, birthday_email_subject, birthday_email_template, mass_email_template)
          VALUES (1, 1, 15, '', '¡Feliz Cumpleaños {{nombre}}! 🎉', '¡Hola {{nombre}}! Esperamos que tengas un día maravilloso. Como regalo de cumpleaños, disfruta de un {{descuento}}% de descuento en cualquiera de nuestros servicios durante esta semana. ¡Te esperamos!', '¡Hola {{nombre}}! Tenemos una oferta para ti.')
        `);
        console.log('[DB] Default marketing settings seeded.');
      }
      console.log('[DB] Marketing settings table ready.');
    } catch (err) {
      console.error('[DB ERROR] Failed to setup/seed marketing_settings table:', err.message);
    }

    // Setup Email Logs Table for Tracking
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS email_logs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          client_id VARCHAR(50) NULL,
          email_type VARCHAR(50) NOT NULL,
          recipient_email VARCHAR(255) NOT NULL,
          subject VARCHAR(255) NOT NULL,
          sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          opened TINYINT DEFAULT 0,
          opened_at TIMESTAMP NULL
        )
      `);
      console.log('[DB] Email logs table ready for tracking.');
    } catch (err) {
      console.error('[DB ERROR] Failed to setup email_logs table:', err.message);
    }

    // Setup Schedule Overrides Table for temporary schedule changes
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS schedule_overrides (
          id INT AUTO_INCREMENT PRIMARY KEY,
          employee_id VARCHAR(50) NOT NULL,
          date DATE NOT NULL,
          original_hora_entrada TIME NULL,
          original_hora_salida TIME NULL,
          new_hora_entrada TIME NOT NULL,
          new_hora_salida TIME NOT NULL,
          reason VARCHAR(255) NOT NULL,
          created_by VARCHAR(255) NOT NULL,
          status VARCHAR(20) DEFAULT 'Activo',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY emp_date_unique (employee_id, date)
        )
      `);
      console.log('[DB] Schedule overrides table ready.');
    } catch (err) {
      console.error('[DB ERROR] Failed to setup schedule_overrides table:', err.message);
    }

    console.log('Database synchronized successfully');

    // Extend attendance.type ENUM to include 'Ausencia' if needed
    try {
      await pool.query(`ALTER TABLE attendance MODIFY COLUMN type ENUM('Check-In', 'Check-Out', 'Ausencia') NOT NULL`);
    } catch (alterErr) {
      if (!alterErr.message.includes('Duplicate')) {
        console.warn('[DB] Could not alter attendance type ENUM:', alterErr.message);
      }
    }

    // Allow NULL in attendance.photo (auto-generated absence records don't have a photo)
    try {
      await pool.query(`ALTER TABLE attendance MODIFY COLUMN photo MEDIUMTEXT NULL`);
    } catch (alterErr) {
      console.warn('[DB] Could not alter attendance photo column:', alterErr.message);
    }

    // Add lateness_minutes column if it does not exist
    try {
      await pool.query(`ALTER TABLE attendance ADD COLUMN lateness_minutes INT DEFAULT 0`);
      console.log('[DB] Column lateness_minutes added successfully.');
    } catch (alterErr) {
      if (!alterErr.message.includes('duplicate column') && !alterErr.message.includes('Duplicate column')) {
        console.warn('[DB] Could not add lateness_minutes column:', alterErr.message);
      }
    }

    // Add extra_minutes column if it does not exist
    try {
      await pool.query(`ALTER TABLE attendance ADD COLUMN extra_minutes INT DEFAULT 0`);
      console.log('[DB] Column extra_minutes added successfully.');
    } catch (alterErr) {
      if (!alterErr.message.includes('duplicate column') && !alterErr.message.includes('Duplicate column')) {
        console.warn('[DB] Could not add extra_minutes column:', alterErr.message);
      }
    }

    // Add modified_by column if it does not exist
    try {
      await pool.query(`ALTER TABLE attendance ADD COLUMN modified_by VARCHAR(100) NULL`);
      console.log('[DB] Column modified_by added successfully.');
    } catch (alterErr) {
      if (!alterErr.message.includes('duplicate column') && !alterErr.message.includes('Duplicate column')) {
        console.warn('[DB] Could not add modified_by column:', alterErr.message);
      }
    }

    // Add modified_at column if it does not exist
    try {
      await pool.query(`ALTER TABLE attendance ADD COLUMN modified_at TIMESTAMP NULL`);
      console.log('[DB] Column modified_at added successfully.');
    } catch (alterErr) {
      if (!alterErr.message.includes('duplicate column') && !alterErr.message.includes('Duplicate column')) {
        console.warn('[DB] Could not add modified_at column:', alterErr.message);
      }
    }

    // Add is_manual column if it does not exist
    try {
      await pool.query(`ALTER TABLE attendance ADD COLUMN is_manual TINYINT DEFAULT 0`);
      console.log('[DB] Column is_manual added successfully.');
    } catch (alterErr) {
      if (!alterErr.message.includes('duplicate column') && !alterErr.message.includes('Duplicate column')) {
        console.warn('[DB] Could not add is_manual column:', alterErr.message);
      }
    }

    // Add modification_reason column if it does not exist
    try {
      await pool.query(`ALTER TABLE attendance ADD COLUMN modification_reason VARCHAR(255) NULL`);
      console.log('[DB] Column modification_reason added successfully.');
    } catch (alterErr) {
      if (!alterErr.message.includes('duplicate column') && !alterErr.message.includes('Duplicate column')) {
        console.warn('[DB] Could not add modification_reason column:', alterErr.message);
      }
    }

    // Add email column to staff_records if it does not exist
    try {
      await pool.query(`ALTER TABLE staff_records ADD COLUMN email VARCHAR(255) NULL`);
      console.log('[DB] Column email added to staff_records successfully.');
    } catch (alterErr) {
      if (!alterErr.message.includes('duplicate column') && !alterErr.message.includes('Duplicate column')) {
        console.warn('[DB] Could not add email column to staff_records:', alterErr.message);
      }
    }
  } catch (err) {
    console.error('Database connection failed:', err.message);
  }
};
setupDB();

// === SECURITY LOGS ===
app.post('/api/security/log-request', async (req, res) => {
  const { clientId, serviceName, staffName } = req.body;
  try {
    await pool.query(
      'INSERT INTO security_requests (client_id, service_name, staff_name) VALUES (?, ?, ?)',
      [clientId, serviceName, staffName]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/security/requests', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT r.*, c.nombre as client_name, v.code as active_code
      FROM security_requests r
      LEFT JOIN clients c ON r.client_id = c.id
      LEFT JOIN verification_codes v ON r.client_id = v.client_id AND v.is_used = 0 AND v.expires_at > NOW()
      WHERE r.created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      ORDER BY r.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === AUTHENTICATION / PASSWORD RECOVERY ===
app.post('/api/auth/forgot-password', async (req, res) => {
  const { emailOrCedula } = req.body;
  const rawInput = emailOrCedula || req.body.email; // Support both names
  const input = rawInput ? String(rawInput).trim() : '';
  console.log(`[AUTH] Forgot password request for: ${input}`);
  
  if (!input) return res.status(400).json({ error: 'Debes proporcionar un correo o cédula.' });

  try {
    // 1. Check if input matches email OR cedula in clients OR users
    const [clients] = await pool.query(
      'SELECT id, nombre, email FROM clients WHERE email = ? OR cedula = ?', 
      [input, input]
    );
    const [users] = await pool.query(
      'SELECT id, nombre, email FROM users WHERE email = ?', 
      [input]
    );
    
    const account = clients[0] || users[0];
    if (!account) {
      return res.status(404).json({ error: 'No se encontró ninguna cuenta asociada.' });
    }

    const targetEmail = account.email;
    if (!targetEmail) {
       return res.status(400).json({ error: 'La cuenta encontrada no tiene un correo electrónico asociado.' });
    }

    // 2. Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 3600000); // 1 hour

    // 3. Save to verification_codes
    await pool.query(
      'INSERT INTO verification_codes (client_id, code, expires_at) VALUES (?, ?, ?)',
      [account.id, code, expiresAt]
    );

    // 4. Send Email
    const [settings] = await pool.query('SELECT * FROM email_settings LIMIT 1');
    const s = settings[0] || {};
    const smtp_host = s.smtp_host || process.env.SMTP_HOST;
    const smtp_port = s.smtp_port || process.env.SMTP_PORT;
    const smtp_user = s.smtp_user || process.env.SMTP_USER;
    const smtp_pass = s.smtp_pass || process.env.SMTP_PASS;
    let smtp_from = process.env.SMTP_FROM || s.smtp_from || 'hola@planbeautyrd.com';
    
    // Safety check: if it doesn't look like an email, use fallback
    if (!smtp_from || !smtp_from.includes('@')) {
      smtp_from = 'hola@planbeautyrd.com';
    }

    if (!smtp_host || !smtp_user || !smtp_pass) {
      return res.status(500).json({ error: 'Configuración de correo incompleta. Contacte al administrador.' });
    }

    console.log(`[AUTH] Sending email from: ${smtp_from}`);

    const transporter = nodemailer.createTransport({
      host: smtp_host,
      port: smtp_port,
      secure: smtp_port == 465,
      auth: { user: smtp_user, pass: smtp_pass }
    });

    await transporter.sendMail({
      from: smtp_from.trim(),
      to: targetEmail,
      subject: "Restablecer tu contraseña - Plan Beauty",
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; borderRadius: 10px;">
          <h2 style="color: #d4af37; text-align: center;">Recuperación de Contraseña</h2>
          <p>Hola <strong>${account.nombre}</strong>,</p>
          <p>Has solicitado restablecer tu contraseña para tu cuenta (${targetEmail}). Usa el siguiente código de verificación:</p>
          <div style="background: #f8f9fa; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 10px; color: #09090b; margin: 20px 0;">
            ${code}
          </div>
          <p>Este código expirará en 1 hora.</p>
          <p>Si no solicitaste este cambio, puedes ignorar este correo.</p>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="font-size: 12px; color: #666; text-align: center;">Plan Beauty RD - Abatte Peluquería</p>
        </div>
      `
    });

    res.json({ success: true, message: 'Código enviado al correo asociado.' });
  } catch (err) {
    console.error('[AUTH] Forgot Password Error:', err);
    res.status(500).json({ error: 'Error al procesar la solicitud. ' + err.message });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { emailOrCedula, code, newPassword } = req.body;
  const rawInput = emailOrCedula || req.body.email;
  const input = rawInput ? String(rawInput).trim() : '';
  
  try {
    // 1. Get account
    const [clients] = await pool.query('SELECT id FROM clients WHERE email = ? OR cedula = ?', [input, input]);
    const [users] = await pool.query('SELECT id FROM users WHERE email = ?', [input]);
    const account = clients[0] || users[0];
    const isClient = !!clients[0];

    if (!account) return res.status(404).json({ error: 'Cuenta no encontrada.' });

    // 2. Verify code
    const [codes] = await pool.query(
      'SELECT id, expires_at FROM verification_codes WHERE client_id = ? AND code = ? AND is_used = 0 ORDER BY created_at DESC LIMIT 1',
      [account.id, code]
    );

    if (codes.length === 0) {
      return res.status(400).json({ error: 'Código inválido o expirado.' });
    }

    const codeRecord = codes[0];
    const expiresAtTime = codeRecord.expires_at instanceof Date 
      ? codeRecord.expires_at.getTime() 
      : new Date(codeRecord.expires_at).getTime();

    if (Date.now() > expiresAtTime) {
      return res.status(400).json({ error: 'Código inválido o expirado.' });
    }

    // 3. Update Password (Plain text as per current system, should be hashed in future)
    const table = isClient ? 'clients' : 'users';
    await pool.query(`UPDATE ${table} SET password = ? WHERE id = ?`, [newPassword, account.id]);

    // 4. Mark code as used
    await pool.query('UPDATE verification_codes SET is_used = 1 WHERE id = ?', [codeRecord.id]);

    res.json({ success: true, message: 'Contraseña actualizada con éxito.' });
  } catch (err) {
    console.error('[AUTH] Reset Password Error:', err);
    res.status(500).json({ error: 'Error al restablecer la contraseña.' });
  }
});

app.post('/api/clients/:id/unlink-card', async (req, res) => {
  const { id } = req.params;
  try {
    // 1. Verificar si hay contratos activos que dependan de esta tarjeta
    const [activeContracts] = await pool.query(
      "SELECT id FROM contracts WHERE client_id = ? AND status IN ('Active', 'Pending_Retry')",
      [id]
    );

    if (activeContracts.length > 0) {
      return res.status(400).json({ 
        error: "No se puede desvincular la tarjeta porque el cliente tiene contratos activos. Por favor, suspende los contratos primero." 
      });
    }

    // 2. Si no hay activos, proceder a desvincular
    await pool.query('UPDATE contracts SET card_token = NULL, payment_profile_id = NULL WHERE client_id = ?', [id]);
    await pool.query('UPDATE clients SET cardnet_customer_id = NULL WHERE id = ?', [id]);
    
    res.json({ success: true, message: "Tarjeta desvinculada correctamente." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === CLIENTS ===
app.post('/api/cardnet/customer/:customerId/update-profile', async (req, res) => {
  try {
    const { customerId } = req.params;
    const { paymentProfileId, expiration, enable } = req.body;
    
    if (!customerId || customerId === 'undefined') {
      throw new Error("ID de cliente de CardNet no válido.");
    }

    const response = await axios.post(
      `${CARDNET_CONFIG.BASE_URL}/api/Customer/${customerId}/PaymentProfileUpdate`,
      { 
        PaymentProfileID: paymentProfileId,
        PaymentProfileId: paymentProfileId,
        Expiration: expiration,
        Enable: enable === undefined ? true : enable
      },
      { headers: getCardNetAuthHeaders() }
    );

    res.json(response.data.Response || response.data);
  } catch (err) {
    console.error('[CARDNET] Update Profile Error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message, details: err.response?.data });
  }
});

app.post('/api/cardnet/customer/:customerId/delete-profile', async (req, res) => {
  try {
    const { customerId } = req.params;
    const { paymentProfileId } = req.body;
    console.log('[CARDNET] Deleting Profile:', paymentProfileId);

    const response = await axios.post(
      `${CARDNET_CONFIG.BASE_URL}/api/Customer/${customerId}/PaymentProfileDelete`,
      { 
        PaymentProfileID: paymentProfileId,
        PaymentProfileId: paymentProfileId 
      },
      { headers: getCardNetAuthHeaders() }
    );

    const result = response.data.Response || response.data;
    res.json(result);
  } catch (err) {
    console.error('[CARDNET] Delete Profile Error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message, details: err.response?.data });
  }
});

// === CONTRACTS ===
app.get('/api/contracts', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        c.id, c.client_id, c.plan_id, c.signed_at, c.signature_hash, c.status, 
        c.last_billed_date, c.next_billing_date, c.next_retry_date, 
        c.retry_count, c.card_token, c.cardnet_profile_id, 
        c.contract_services, c.contract_price, c.contract_promo_services, 
        c.contract_promo_duration, c.payment_profile_id, c.auto_billing_enabled, 
        c.last_annual_fee_date, c.ip_address, c.device_agent, 
        c.geolocation, c.salon_id,
        cl.nombre as clientName, 
        cl.cedula as clientCedula,
        cl.calle as address,
        cl.numero as house_number,
        cl.sector,
        p.title as planTitle,
        p.services as planServices,
        p.activation_fee
      FROM contracts c
      JOIN clients cl ON c.client_id = cl.id
      JOIN plans p ON c.plan_id = p.id
      ORDER BY c.signed_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch single contract with all details (including heavy photo columns)
app.get('/api/contracts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT 
        c.*, 
        cl.nombre as clientName, 
        cl.cedula as clientCedula, 
        cl.calle as address, 
        cl.numero as house_number, 
        cl.sector as sector, 
        cl.ciudad as ciudad, 
        p.title as planTitle 
       FROM contracts c 
       LEFT JOIN clients cl ON c.client_id = cl.id 
       LEFT JOIN plans p ON c.plan_id = p.id 
       WHERE c.id = ?`,
      [id]
    );
    if (rows.length > 0) {
      res.json(rows[0]);
    } else {
      res.status(404).json({ error: 'Contrato no encontrado' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- CONTRACT ACTIONS (CANCEL & BILL) WITH CODES ---
app.post('/api/contracts/:id/request-code', async (req, res) => {
  const { id } = req.params;
  const { actionType } = req.body; // 'cancellation' or 'manual_billing'
  
  try {
    const [contracts] = await pool.query(`
      SELECT c.*, cl.nombre, cl.email 
      FROM contracts c 
      JOIN clients cl ON c.client_id = cl.id 
      WHERE c.id = ?`, [id]);
    
    if (contracts.length === 0) return res.status(404).json({ error: 'Contrato no encontrado.' });
    const contract = contracts[0];
    
    if (!contract.email) return res.status(400).json({ error: 'El cliente no tiene un correo electrónico asociado.' });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await pool.query(
      'INSERT INTO billing_codes (contract_id, code, action_type, expires_at) VALUES (?, ?, ?, ?)',
      [id, code, actionType, expiresAt]
    );

    const [settings] = await pool.query('SELECT * FROM email_settings LIMIT 1');
    const s = settings[0] || {};
    const transporter = nodemailer.createTransport({
      host: s.smtp_host, port: s.smtp_port, secure: s.smtp_port == 465,
      auth: { user: s.smtp_user, pass: s.smtp_pass }
    });

    const actionName = actionType === 'cancellation' ? 'Cancelación de Plan' : 'Confirmación de Facturación';
    
    await transporter.sendMail({
      from: `"${s.smtp_from || 'Abatte Peluquería'}" <${s.smtp_user}>`,
      to: contract.email,
      subject: `Código de Verificación - ${actionName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 40px; border: 1px solid #eee; border-radius: 20px; background: #fff;">
          <h2 style="color: #09090b; text-align: center;">Verificación de Seguridad</h2>
          <p>Hola <strong>${contract.nombre}</strong>,</p>
          <p>Se ha solicitado una acción de <strong>${actionName}</strong> para tu contrato. Usa el siguiente código para autorizarla:</p>
          <div style="background: #f8fafc; padding: 30px; border-radius: 16px; margin: 30px 0; border: 1px solid #e2e8f0; text-align: center;">
            <span style="font-size: 32px; font-weight: 900; letter-spacing: 8px; color: #09090b;">${code}</span>
          </div>
          <p style="color: #64748b; font-size: 0.85rem; text-align: center;">Este código expirará en 15 minutos.</p>
        </div>
      `
    });

    res.json({ success: true, message: 'Código enviado al cliente.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/contracts/:id/confirm-action', async (req, res) => {
  const { id } = req.params;
  const { code, actionType } = req.body;

  try {
    const [rows] = await pool.query(
      'SELECT id, expires_at FROM billing_codes WHERE contract_id = ? AND code = ? AND action_type = ? AND is_used = 0',
      [id, code, actionType]
    );

    if (rows.length === 0) return res.status(400).json({ error: 'Código inválido o expirado.' });

    const codeRecord = rows[0];
    const expiresAtTime = codeRecord.expires_at instanceof Date 
      ? codeRecord.expires_at.getTime() 
      : new Date(codeRecord.expires_at).getTime();

    if (Date.now() > expiresAtTime) {
      return res.status(400).json({ error: 'Código inválido o expirado.' });
    }

    await pool.query('UPDATE billing_codes SET is_used = 1 WHERE id = ?', [codeRecord.id]);

    if (actionType === 'cancellation') {
      const [contractRows] = await pool.query(`
        SELECT c.client_id, cl.nombre, cl.email, cl.cardnet_customer_id, c.payment_profile_id 
        FROM contracts c 
        JOIN clients cl ON c.client_id = cl.id 
        WHERE c.id = ?
      `, [id]);
      
      if (contractRows.length > 0) {
        const client = contractRows[0];

        // 1. Intentar borrar tarjeta desde la pasarela real de CardNet si existe perfil guardado
        if (client.cardnet_customer_id && client.payment_profile_id && !String(client.payment_profile_id).startsWith('mock_')) {
          try {
            console.log(`[CARDNET DELETION] Eliminando Perfil de Pago: ${client.payment_profile_id} para Cliente CardNet: ${client.cardnet_customer_id}`);
            await axios.post(
              `${CARDNET_CONFIG.BASE_URL}/api/Customer/${client.cardnet_customer_id}/PaymentProfileDelete`,
              { 
                PaymentProfileID: client.payment_profile_id,
                PaymentProfileId: client.payment_profile_id 
              },
              { headers: getCardNetAuthHeaders(), timeout: CARDNET_CONFIG.TIMEOUT }
            );
            console.log('[CARDNET DELETION] Tarjeta borrada de CardNet de forma segura.');
          } catch (cardnetErr) {
            console.error('[CARDNET DELETION] No se pudo borrar la tarjeta en CardNet, continuando limpieza local:', cardnetErr.response?.data || cardnetErr.message);
          }
        }

        // 2. Limpieza de base de datos local (Borrado de tarjeta, selfies, cédula y firmas)
        await pool.query("UPDATE clients SET status = 'Cancelled', cardnet_customer_id = NULL WHERE id = ?", [client.client_id]);
        await pool.query(`
          UPDATE contracts 
          SET status = 'Cancelled', 
              auto_billing_enabled = 0, 
              payment_profile_id = NULL, 
              card_token = NULL, 
              document_photo = NULL, 
              selfie_photo = NULL, 
              signature_hash = NULL 
          WHERE id = ?
        `, [id]);
        
        console.log(`[CANCELLATION SUCCESS] Datos borrados de forma segura para cliente: ${client.client_id} (Contrato: ${id})`);
        
        // Despachar correo electrónico si el cliente tiene email registrado
        if (client.email) {
          try {
            const [settings] = await pool.query('SELECT * FROM email_settings LIMIT 1');
            if (settings.length > 0) {
              const s = settings[0];
              const transporter = nodemailer.createTransport({
                host: s.smtp_host, port: s.smtp_port, secure: s.smtp_port == 465,
                auth: { user: s.smtp_user, pass: s.smtp_pass }
              });

              const subject = 'Esperamos verte pronto nuevamente';
              const bodyHtml = `
                <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #fdf8f5; padding: 40px 15px; text-align: center;">
                  <!--[if !mso]><!-->
                  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
                  <!--<![endif]-->
                  
                  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 15px 35px rgba(74, 55, 40, 0.05); border: 1px solid #f3e8df; padding: 40px 30px; box-sizing: border-box; text-align: left;">
                    
                    <!-- Header -->
                    <div style="text-align: center; margin-bottom: 30px; border-bottom: 1px solid #f3e8df; padding-bottom: 20px;">
                      <h1 style="color: #000000; font-family: 'Plus Jakarta Sans', Arial, sans-serif; font-size: 24px; font-weight: 800; letter-spacing: 2px; margin: 0;">
                        PLAN<span style="color: #d4af37;">BEAUTY</span>RD
                      </h1>
                    </div>

                    <!-- Greeting -->
                    <p style="font-family: 'Plus Jakarta Sans', Arial, sans-serif; font-size: 16px; color: #000000; font-weight: 700; margin-bottom: 20px;">
                      Hola ${client.nombre},
                    </p>
                    
                    <!-- Message Body -->
                    <p style="font-family: 'Plus Jakarta Sans', Arial, sans-serif; font-size: 15px; color: #4a3728; line-height: 1.7; margin-bottom: 18px;">
                      Hemos recibido la cancelación de tu membresía en <strong>PLAN BEAUTY</strong> y queremos agradecerte por habernos permitido acompañarte en tu rutina de belleza. ✨
                    </p>
                    
                    <p style="font-family: 'Plus Jakarta Sans', Arial, sans-serif; font-size: 15px; color: #4a3728; line-height: 1.7; margin-bottom: 18px;">
                      En <strong>ABATTE PELUQUERIA</strong> siempre tendrás las puertas abiertas. Esperamos volver a verte muy pronto y seguir brindándote la experiencia que mereces.
                    </p>
                    
                    <p style="font-family: 'Plus Jakarta Sans', Arial, sans-serif; font-size: 15px; color: #4a3728; line-height: 1.7; margin-bottom: 30px;">
                      Si deseas reactivar tu membresía en el futuro, solo debes pasar por el salón y con gusto te ayudaremos.
                    </p>

                    <!-- Valediction -->
                    <p style="font-family: 'Plus Jakarta Sans', Arial, sans-serif; font-size: 15px; color: #000000; font-weight: 700; margin-bottom: 5px;">
                      Con cariño,
                    </p>
                    <p style="font-family: 'Plus Jakarta Sans', Arial, sans-serif; font-size: 15px; color: #d4af37; font-weight: 800; margin: 0;">
                      Equipo ABATTE PELUQUERIA
                    </p>

                    <!-- Divider -->
                    <div style="border-top: 1px solid #f3e8df; margin-top: 35px; padding-top: 20px; text-align: center;">
                      <p style="margin: 0; font-family: 'Plus Jakarta Sans', Arial, sans-serif; font-size: 11px; color: #a18a78; text-transform: uppercase; letter-spacing: 2px; font-weight: 700;">
                        PLAN BEAUTY • ABATTE PELUQUERÍA
                      </p>
                      <p style="margin: 5px 0 0 0; font-family: 'Plus Jakarta Sans', Arial, sans-serif; font-size: 9px; color: #bcaaa4;">
                        © 2026 PLAN BEAUTY RD. TU PLAN, TU BELLEZA.
                      </p>
                    </div>

                  </div>
                </div>
              `;

              await transporter.sendMail({
                from: `"${s.smtp_from || 'PLAN BEAUTY'}" <${s.smtp_user}>`,
                to: client.email,
                subject: subject,
                html: bodyHtml
              });
              console.log(`[CANCELLATION EMAIL] Sent cancellation notice to ${client.email}`);
            }
          } catch (mailErr) {
            console.error('[CANCELLATION EMAIL ERROR] Failed to send cancellation email:', mailErr.message);
          }
        }
      }
      return res.json({ success: true, message: 'Contrato cancelado exitosamente.' });
    } else if (actionType === 'manual_billing') {
      const [contractData] = await pool.query(`
        SELECT c.*, p.price, p.title as planTitle, cl.cardnet_customer_id 
        FROM contracts c 
        JOIN plans p ON c.plan_id = p.id 
        JOIN clients cl ON c.client_id = cl.id 
        WHERE c.id = ?`, [id]);
      
      const c = contractData[0];
      if (!c.cardnet_customer_id || !c.cardnet_profile_id) {
        return res.status(400).json({ error: 'El cliente no tiene un método de pago vinculado.' });
      }

      return res.json({ success: true, verified: true, contract: c });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === SALONS ===
app.get('/api/salons', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        s.*, 
        COUNT(DISTINCT cl.id) as client_count,
        SUM(p.price) as total_revenue
      FROM salons s
      LEFT JOIN clients cl ON s.id = cl.salon_id
      LEFT JOIN contracts co ON cl.id = co.client_id
      LEFT JOIN plans p ON co.plan_id = p.id
      GROUP BY s.id
      ORDER BY s.name ASC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/salons', async (req, res) => {
  try {
    const { name, address, phone, maps_url } = req.body;
    const [result] = await pool.query('INSERT INTO salons (name, address, phone, maps_url) VALUES (?, ?, ?, ?)', [name, address, phone || '', maps_url || '']);
    res.json({ id: result.insertId, name, address, phone, maps_url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/salons/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM salons WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// === CLIENTS ===
app.get('/api/clients', async (req, res) => {
  console.log(`[API] Fetching all clients from DB: ${process.env.DB_NAME}...`);
  try {
    const [rows] = await pool.query(`
      SELECT cl.*, p.title as planName
      FROM clients cl
      LEFT JOIN contracts c ON c.client_id = cl.id AND (c.status = 'Active' OR c.status = 'Pending_Retry')
      LEFT JOIN plans p ON c.plan_id = p.id
    `);
    console.log(`[API] Found ${rows.length} clients.`);
    res.json(rows);
  } catch (err) {
    console.error('[API ERROR] Failed to fetch clients:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clients', async (req, res) => {
  try {
    const id = Date.now().toString();
    const { cedula, nombre, telefono, email, frecuencia, salon_id, calle, numero, sector, ciudad, fechaNacimiento, registration_source } = req.body;
    const [existing] = await pool.query('SELECT id FROM clients WHERE email = ? OR cedula = ?', [email, cedula]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Ya existe un usuario con este correo o cédula' });
    }

    // Generate Random Password (8 chars)
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let tempPassword = "";
    for (let i = 0; i < 8; i++) tempPassword += charset.charAt(Math.floor(Math.random() * charset.length));

    await pool.query(
      'INSERT INTO clients (id, cedula, nombre, telefono, email, password, must_change_password, frecuencia, salon_id, calle, numero, sector, ciudad, status, role_id, tipo, fecha_nacimiento, registration_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, cedula, nombre, telefono, email, tempPassword, 1, frecuencia || 'Mensual', salon_id || 1, calle || null, numero || null, sector || null, ciudad || null, 'Active', 2, 'client', fechaNacimiento || null, registration_source || 'Self']
    );

    // Send Email
    const [settings] = await pool.query('SELECT * FROM email_settings LIMIT 1');
    if (settings.length > 0) {
      const s = settings[0];
      const transporter = nodemailer.createTransport({
        host: s.smtp_host, port: s.smtp_port, secure: s.smtp_port == 465,
        auth: { user: s.smtp_user, pass: s.smtp_pass }
      });

      try {
        await transporter.sendMail({
          from: `"${s.smtp_from || 'Abatte Peluquería'}" <${s.smtp_user}>`,
          to: email,
          subject: 'Bienvenida a Abatte Peluquería - Tus Credenciales',
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 40px; border: 1px solid #eee; border-radius: 20px; background: #fff;">
              <div style="text-align: center; margin-bottom: 30px;">
                <h1 style="color: #09090b; margin: 0; font-size: 24px; font-weight: 900;">¡Hola ${nombre}!</h1>
              </div>
              
              <p style="color: #444; line-height: 1.6;">Tu cuenta en <strong>Abatte Peluquería</strong> ha sido creada. Ya puedes acceder a tu panel de cliente para gestionar tus servicios.</p>
              
              <div style="background: #f8fafc; padding: 25px; border-radius: 16px; margin: 30px 0; border: 1px solid #e2e8f0;">
                <p style="margin: 0 0 10px 0; font-size: 0.9rem; color: #64748b;">Tus credenciales de acceso:</p>
                <p style="margin: 5px 0; font-size: 1.1rem;"><strong>Usuario:</strong> ${email}</p>
                <p style="margin: 5px 0; font-size: 1.1rem;"><strong>Contraseña Temporal:</strong> <span style="background: #09090b; color: #fff; padding: 2px 8px; border-radius: 4px;">${tempPassword}</span></p>
              </div>

              <div style="text-align: center; margin: 30px 0;">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/login" style="background: #09090b; color: #fff; padding: 16px 32px; border-radius: 12px; text-decoration: none; font-weight: 800; display: inline-block;">
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
      } catch (mailErr) {
        console.error('Error sending welcome email:', mailErr);
      }
    }

    res.json({ id, cedula, nombre, email, status: 'Active' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/activate', async (req, res) => {
  const { clientId, code, password } = req.body;
  try {
    const [rows] = await pool.query(
      'SELECT id, expires_at FROM verification_codes WHERE client_id = ? AND code = ? AND is_used = 0',
      [clientId, code]
    );

    if (rows.length === 0) {
      return res.status(400).json({ error: 'Código inválido o expirado' });
    }

    const codeRecord = rows[0];
    const expiresAtTime = codeRecord.expires_at instanceof Date 
      ? codeRecord.expires_at.getTime() 
      : new Date(codeRecord.expires_at).getTime();

    if (Date.now() > expiresAtTime) {
      return res.status(400).json({ error: 'Código inválido o expirado' });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    await pool.query('UPDATE verification_codes SET is_used = 1 WHERE id = ?', [codeRecord.id]);
    await pool.query('UPDATE clients SET status = "Active", password = ? WHERE id = ?', [password, clientId]);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === CLIENT UPDATES ===
app.put('/api/clients/:id', async (req, res) => {
  const { id } = req.params;
  const { cedula, nombre, telefono, email, calle, numero, sector, ciudad, fecha_nacimiento } = req.body;
  try {
    await pool.query(
      'UPDATE clients SET cedula = ?, nombre = ?, telefono = ?, email = ?, calle = ?, numero = ?, sector = ?, ciudad = ?, fecha_nacimiento = ? WHERE id = ?',
      [cedula, nombre, telefono, email, calle || null, numero || null, sector || null, ciudad || null, fecha_nacimiento || null, id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/clients/cedula/:cedula', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM clients WHERE cedula = ?', [req.params.cedula]);
    if (rows.length > 0) {
      const client = rows[0];
      const [contracts] = await pool.query("SELECT plan_id FROM contracts WHERE client_id = ? AND status != 'Cancelled'", [client.id]);
      client.active_plan_ids = contracts.map(c => c.plan_id.toString());
      return res.json(client);
    }
    res.status(404).json({ error: 'Not found' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === VISITS & POS TICKETING ===
app.get('/api/visits', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT v.*, s.name as salon_name FROM visits v LEFT JOIN salons s ON v.salon_id = s.id ORDER BY v.visited_at DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/visits/pending', async (req, res) => {
  try {
    const salonId = req.query.salon_id || 1;
    const [rows] = await pool.query(
      `SELECT v.*, COALESCE(s.name, 'Sucursal San Vicente de Paúl') as salon_name,
              (SELECT c.plan_id FROM contracts c JOIN clients cl ON c.client_id = cl.id WHERE (c.client_id = v.client_id OR cl.nombre = v.client_name) AND (c.status = 'Activo' OR c.status = 'Active') LIMIT 1) as plan_beauty_id
       FROM visits v 
       LEFT JOIN salons s ON v.salon_id = s.id 
       WHERE v.status = 'Pendiente' AND v.salon_id = ? 
       ORDER BY v.visited_at DESC`,
      [salonId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/visits/client/:clientId', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT v.*, s.name as salon_name FROM visits v LEFT JOIN salons s ON v.salon_id = s.id WHERE v.client_id = ? ORDER BY v.visited_at ASC', [req.params.clientId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new ticket (Pending status, physical print generation)
app.post('/api/visits/ticket', async (req, res) => {
  try {
    const id = Date.now().toString();
    const { clientId, clientName, servicios, empleadoPeluquera, empleadoLavaPelo, empleadoManicurista, salon_id } = req.body;
    const sId = salon_id || 1;

    // Get branch name
    const [salonRows] = await pool.query("SELECT name FROM salons WHERE id = ?", [sId]);
    const salonName = salonRows[0]?.name || 'Sucursal San Vicente de Paúl';

    // Generate sequence ticket number for branch
    const [countRows] = await pool.query("SELECT COUNT(*) as cnt FROM visits WHERE salon_id = ?", [sId]);
    const seqNum = (countRows[0].cnt + 1).toString().padStart(4, '0');
    const ticketNumber = `SD-${seqNum}`;

    await pool.query(
      `INSERT INTO visits (id, client_id, client_name, servicios, empleado_peluquera, empleado_lava_pelo, empleado_manicurista, salon_id, status, ticket_number, visited_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pendiente', ?, NOW())`,
      [id, clientId || 'INVITADO', clientName || 'Cliente General', JSON.stringify(servicios || []), empleadoPeluquera || 'N/A', empleadoLavaPelo || 'N/A', empleadoManicurista || 'N/A', sId, ticketNumber]
    );

    res.json({ id, ticketNumber, salonName, clientName: clientName || 'Cliente General', createdAt: new Date().toISOString(), success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update draft state when clicking "Volver atrás"
app.put('/api/visits/:id/draft', async (req, res) => {
  try {
    const { id } = req.params;
    const { draft_data, items_detail, total, servicios, empleado_peluquera, empleado_lava_pelo, empleado_manicurista } = req.body;

    await pool.query(
      `UPDATE visits SET 
        draft_data = ?, 
        items_detail = ?, 
        total = ?, 
        servicios = ?, 
        empleado_peluquera = ?, 
        empleado_lava_pelo = ?, 
        empleado_manicurista = ?
       WHERE id = ?`,
      [
        JSON.stringify(draft_data || {}),
        JSON.stringify(items_detail || []),
        total || 0.00,
        JSON.stringify(servicios || []),
        empleado_peluquera || 'N/A',
        empleado_lava_pelo || 'N/A',
        empleado_manicurista || 'N/A',
        id
      ]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Finalize checkout and mark as Facturado
app.post('/api/visits/:id/checkout', async (req, res) => {
  try {
    const { id } = req.params;
    const { total, monto_recibido, devuelta, metodo_pago, items_detail, employee_consumption } = req.body;

    await pool.query(
      `UPDATE visits SET 
        status = 'Facturado', 
        total = ?, 
        monto_recibido = ?, 
        devuelta = ?, 
        metodo_pago = ?, 
        items_detail = ?, 
        visited_at = NOW() 
       WHERE id = ?`,
      [total || 0, monto_recibido || 0, devuelta || 0, metodo_pago || 'Efectivo', JSON.stringify(items_detail || []), id]
    );

    // Record employee consumption for payroll deduction if applicable
    if (employee_consumption && employee_consumption.employee_id) {
      const consumptionId = 'CONS-' + Date.now();
      await pool.query(
        `INSERT INTO employee_consumptions (id, employee_id, employee_name, monto, servicios, visit_id, salon_id, created_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), 'Pendiente_Nomina')`,
        [
          consumptionId,
          employee_consumption.employee_id,
          employee_consumption.employee_name || 'Empleado',
          employee_consumption.monto || total,
          JSON.stringify(employee_consumption.servicios || []),
          id,
          employee_consumption.salon_id || 1
        ]
      );
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/visits', async (req, res) => {
  try {
    const id = Date.now().toString();
    const { clientId, clientName, servicios, empleadoPeluquera, empleadoManicurista, proximaFecha, autoReminder, salon_id } = req.body;
    await pool.query(
      "INSERT INTO visits (id, client_id, client_name, servicios, empleado_peluquera, empleado_manicurista, proxima_fecha, recordatorio_auto, salon_id, status, visited_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Facturado', NOW())",
      [id, clientId, clientName, JSON.stringify(servicios || []), empleadoPeluquera, empleadoManicurista, proximaFecha || null, autoReminder ? 1 : 0, salon_id || 1]
    );

    // Trigger Survey
    const [clientData] = await pool.query('SELECT email FROM clients WHERE id = ?', [clientId]);
    if (clientData[0]?.email) {
      sendSurveyEmail(clientId, clientName, clientData[0].email);
    }

    res.json({ id, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === CASH REGISTERS (CAJA ÚNICA POR JORNADA) ===
app.get('/api/cash-registers/active', async (req, res) => {
  try {
    const { salon_id, employee_id } = req.query;
    const [rows] = await pool.query(
      "SELECT * FROM cash_registers WHERE salon_id = ? AND status = 'Abierta' ORDER BY opened_at DESC LIMIT 1",
      [salon_id || 1]
    );
    res.json(rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cash-registers/open', async (req, res) => {
  try {
    const { salon_id, employee_id, employee_name, monto_inicial } = req.body;
    // Check if open register exists
    const [existing] = await pool.query(
      "SELECT * FROM cash_registers WHERE salon_id = ? AND status = 'Abierta'",
      [salon_id || 1]
    );
    if (existing.length > 0) {
      return res.json({ success: true, register: existing[0], message: 'Caja ya se encuentra abierta' });
    }

    const regNum = 'CAJA-' + Date.now().toString().slice(-6);
    const [result] = await pool.query(
      "INSERT INTO cash_registers (register_number, employee_id, employee_name, salon_id, monto_inicial, opened_at, status) VALUES (?, ?, ?, ?, ?, NOW(), 'Abierta')",
      [regNum, employee_id || 'SYS', employee_name || 'Cajero', salon_id || 1, monto_inicial || 0.00]
    );

    res.json({ success: true, registerId: result.insertId, registerNumber: regNum });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === EMPLOYEE OTP AUTHORIZATION ===
app.post('/api/auth/send-employee-otp', async (req, res) => {
  try {
    const { employeeId, employeeEmail, employeeName } = req.body;
    if (!employeeEmail) {
      return res.status(400).json({ error: 'El empleado no tiene correo registrado.' });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    await pool.query(
      'INSERT INTO verification_codes (client_id, code, expires_at) VALUES (?, ?, ?)',
      [employeeId || 'EMP', code, expiresAt]
    );

    // Send email using system SMTP settings
    const [smtpRows] = await pool.query('SELECT * FROM email_settings WHERE id = 1');
    if (smtpRows[0] && smtpRows[0].smtp_host) {
      const nodemailer = require('nodemailer');
      const cfg = smtpRows[0];
      const transporter = nodemailer.createTransport({
        host: cfg.smtp_host,
        port: cfg.smtp_port,
        secure: parseInt(cfg.smtp_port) === 465,
        auth: { user: cfg.smtp_user, pass: cfg.smtp_pass }
      });

      await transporter.sendMail({
        from: cfg.smtp_from || '"Plan Beauty SALON PRO" <hola@planbeautyrd.com>',
        to: employeeEmail,
        subject: `🔒 Código de Seguridad Consumo Nómina: ${code}`,
        text: `Hola ${employeeName || ''}, tu código de autorización para consumo en salón a las ${new Date().toLocaleTimeString('es-DO')} es: ${code}`,
        html: `
          <div style="font-family: sans-serif; padding: 20px; border: 1px solid #ec4899; border-radius: 12px; max-width: 500px;">
            <h2 style="color: #be185d;">Autorización de Consumo de Empleado</h2>
            <p>Hola <strong>${employeeName || 'Colaborador'}</strong>,</p>
            <p>Se ha registrado un consumo de servicios en salón a las <strong>${new Date().toLocaleTimeString('es-DO')}</strong>.</p>
            <p style="font-size: 24px; font-weight: bold; color: #ec4899; letter-spacing: 4px; text-align: center; background: #fdf2f8; padding: 10px; border-radius: 8px;">${code}</p>
            <p style="font-size: 12px; color: #64748b;">Si no realizaste esta solicitud, por favor comunícate con administración inmediatamente.</p>
          </div>
        `
      });
    }

    res.json({ success: true, message: 'Código de autorización enviado al correo.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === BULK ITEM CATALOGUE IMPORT ===
app.post('/api/services/bulk-import', async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No se recibieron ítems válidos.' });
    }

    let insertedCount = 0;
    for (const item of items) {
      if (!item.nombre && !item.name) continue;
      const name = item.nombre || item.name;
      const price = parseFloat(item.precio || item.price || 0);
      const category = item.categoria || item.category || 'General';

      // Insert or update existing service
      await pool.query(
        `INSERT INTO services (nombre, categoria, precio, activo)
         VALUES (?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE precio = VALUES(precio), categoria = VALUES(categoria)`,
        [name, category, price]
      ).catch(async () => {
        // Fallback for custom tables structure
        await pool.query(
          `INSERT INTO plans (id, title, price, color, location, services)
           VALUES (?, ?, ?, 'blue', 'San Vicente', ?)
           ON DUPLICATE KEY UPDATE price = VALUES(price)`,
          ['SERV-' + Date.now() + Math.random().toString().slice(-4), name, price, JSON.stringify([name])]
        ).catch(() => {});
      });

      insertedCount++;
    }

    res.json({ success: true, count: insertedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// === SETTINGS ===
app.get('/api/settings/email', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM email_settings WHERE id = 1');
    res.json(rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings/email', async (req, res) => {
  const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_secure } = req.body;
  try {
    await pool.query(`
      INSERT INTO email_settings (id, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_secure)
      VALUES (1, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        smtp_host = VALUES(smtp_host),
        smtp_port = VALUES(smtp_port),
        smtp_user = VALUES(smtp_user),
        smtp_pass = VALUES(smtp_pass),
        smtp_from = VALUES(smtp_from),
        smtp_secure = VALUES(smtp_secure)
    `, [smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_secure ? 1 : 0]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings/email/test', async (req, res) => {
  const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_secure, test_email } = req.body;
  try {
    const nodemailer = require('nodemailer');
    
    // Auto-detect secure based on port if not explicitly set correctly
    const isPort465 = parseInt(smtp_port) === 465;
    
    const transporter = nodemailer.createTransport({
      host: smtp_host,
      port: parseInt(smtp_port),
      secure: isPort465, // true for 465, false for other ports
      auth: {
        user: smtp_user,
        pass: smtp_pass
      },
      tls: {
        // Force IPv4 to avoid ENETUNREACH issues on some networks
        rejectUnauthorized: false
      },
      family: 4,
      connectionTimeout: 10000,
      greetingTimeout: 10000
    });

    // 1. Verify connection
    await transporter.verify();

    // 2. Send test email
    await transporter.sendMail({
      from: `"${smtp_from || 'SalonPro Test'}" <${smtp_user}>`,
      to: test_email,
      subject: 'Prueba de Conexión - SalonPro',
      text: 'Este es un correo de prueba para verificar tu configuración SMTP en SalonPro.',
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #10b981; border-radius: 10px; background: #f0fdf4;">
          <h2 style="color: #059669; margin-top: 0;">¡Conexión Exitosa!</h2>
          <p>Este correo confirma que la configuración de tu servidor SMTP en <strong>SalonPro</strong> funciona correctamente.</p>
          <hr style="border: none; border-top: 1px solid #d1fae5; margin: 20px 0;" />
          <p style="font-size: 0.8rem; color: #666;">Enviado desde: ${smtp_host}:${smtp_port}</p>
        </div>
      `
    });

    res.json({ success: true, message: 'Correo de prueba enviado con éxito.' });
  } catch (err) {
    console.error('[EMAIL TEST] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// === UTILITY: SEND SURVEY EMAIL ===
async function sendSurveyEmail(clientId, clientName, clientEmail) {
  console.log(`[Survey Email] Preparing to send to ${clientEmail} (Client: ${clientId})`);
  try {
    const [settings] = await pool.query('SELECT * FROM email_settings WHERE id = 1');
    if (settings.length === 0 || !settings[0].smtp_host) {
      console.warn("[Survey Email] No SMTP settings found.");
      return;
    }

    const s = settings[0];
    // 1. Get client details (especially cedula)
    const [clients] = await pool.query('SELECT cedula FROM clients WHERE id = ?', [clientId]);
    const clientCedula = clients.length > 0 ? clients[0].cedula : clientId;

    // 2. Create pending survey record
    const pendingId = Math.floor(Date.now() / 1000); // Fits in standard INT
    await pool.query('INSERT INTO pending_surveys (id, client_id) VALUES (?, ?)', [pendingId, clientId]);

    // 2. Send Email
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: s.smtp_host,
      port: parseInt(s.smtp_port),
      secure: parseInt(s.smtp_port) === 465,
      auth: { user: s.smtp_user, pass: s.smtp_pass },
      tls: { rejectUnauthorized: false },
      family: 4
    });

    const portalLink = `https://planbeautyrd.com/encuesta?cedula=${clientCedula}`;

    await transporter.sendMail({
      from: `"${s.smtp_from || 'PLAN BEAUTY'}" <${s.smtp_user}>`,
      to: clientEmail,
      subject: '✨ Cuéntanos tu experiencia en PLAN BEAUTY',
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; background-color: #ffffff;">
          <div style="background-color: #000000; padding: 40px 30px; text-align: center;">
            <h1 style="margin: 0; font-size: 26px; color: #ffffff !important;">¡Gracias por visitarnos!</h1>
          </div>
          <div style="padding: 30px; color: #1e293b; line-height: 1.6;">
            <p style="color: #1e293b;">Hola <strong>${clientName}</strong>,</p>
            <p style="color: #1e293b;">Gracias por confiar en <strong>PLAN BEAUTY</strong>. Fue un placer atenderte y ser parte de tu experiencia de belleza ✨</p>
            <p style="color: #1e293b;">Tu opinión es muy importante para nosotros, ya que nos ayuda a seguir mejorando cada detalle de nuestro servicio.</p>
            <p style="color: #1e293b;">Te invitamos a completar nuestra breve encuesta en el siguiente enlace:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${portalLink}" style="background-color: #000000; color: #ffffff !important; padding: 14px 28px; border-radius: 12px; text-decoration: none; font-weight: bold; display: inline-block;">Completar Encuesta</a>
            </div>
            <p style="color: #64748b; font-size: 0.9rem;">Si el botón no funciona, copia y pega este enlace: ${portalLink}</p>
            <p style="margin-top: 40px; border-top: 1px solid #f1f5f9; padding-top: 20px; font-size: 0.9rem; color: #64748b;">
              Atentamente,<br>
              <strong>Equipo ABATTE PELUQUERÍA</strong>
            </p>
          </div>
        </div>
      `
    });
    console.log(`[SURVEY] Email sent and record created for ${clientEmail}`);
  } catch (err) {
    console.error('[SURVEY ERROR]', err.message);
  }
}

// === UTILITY: SEND PAYMENT RECEIPT EMAIL ===
async function sendPaymentReceiptEmail(clientId, clientName, clientEmail, amount, description, reference) {
  try {
    const [settings] = await pool.query('SELECT * FROM email_settings WHERE id = 1');
    if (settings.length === 0 || !settings[0].smtp_host) return;

    const s = settings[0];
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: s.smtp_host,
      port: parseInt(s.smtp_port),
      secure: parseInt(s.smtp_port) === 465,
      auth: { user: s.smtp_user, pass: s.smtp_pass },
      tls: { rejectUnauthorized: false },
      family: 4
    });

    const date = new Date().toLocaleDateString('es-DO', { 
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    await transporter.sendMail({
      from: `"${s.smtp_from || 'PLAN BEAUTY'}" <${s.smtp_user}>`,
      to: clientEmail,
      subject: '✅ Recibo de Pago - PLAN BEAUTY',
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; background-color: #ffffff;">
          <div style="background-color: #000000; padding: 40px 30px; text-align: center;">
            <h1 style="margin: 0; font-size: 26px; color: #ffffff !important;">Confirmación de Pago</h1>
          </div>
          <div style="padding: 30px; color: #1e293b; line-height: 1.6;">
            <p style="color: #1e293b;">Hola <strong>${clientName}</strong>,</p>
            <p style="color: #1e293b;">Hemos recibido correctamente el pago de tu suscripción ✅</p>
            <p style="color: #1e293b;">Gracias por formar parte de <strong>PLAN BEAUTY</strong>. Nos alegra acompañarte en tu experiencia de belleza y cuidado personal ✨</p>
            
            <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 25px 0;">
              <h3 style="margin-top: 0; color: #000000; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px;">Detalles de la transacción:</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #64748b;">Monto:</td>
                  <td style="padding: 8px 0; text-align: right; font-weight: bold; color: #000000;">RD$ ${parseFloat(amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748b;">Concepto:</td>
                  <td style="padding: 8px 0; text-align: right; color: #1e293b;">${description}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748b;">Referencia:</td>
                  <td style="padding: 8px 0; text-align: right; color: #1e293b;">${reference}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748b;">Fecha:</td>
                  <td style="padding: 8px 0; text-align: right; color: #1e293b;">${date}</td>
                </tr>
              </table>
            </div>

            <p style="color: #1e293b; text-align: center; font-weight: bold; margin-top: 30px;">Gracias por elegir PLAN BEAUTY</p>
            
            <p style="margin-top: 40px; border-top: 1px solid #f1f5f9; padding-top: 20px; font-size: 0.9rem; color: #64748b; text-align: center;">
              Atentamente,<br>
              <strong>Equipo ABATTE PELUQUERÍA</strong>
            </p>
          </div>
        </div>
      `
    });
    console.log(`[PAYMENT EMAIL] Receipt sent to ${clientEmail} for ref: ${reference}`);
  } catch (err) {
    console.error('[PAYMENT EMAIL ERROR]', err.message);
  }
}

async function sendPaymentFailedEmail(clientId, clientName, clientEmail, amount, errorMsg) {
  try {
    const [settings] = await pool.query('SELECT * FROM email_settings WHERE id = 1');
    if (settings.length === 0 || !settings[0].smtp_host) return;

    const s = settings[0];
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: s.smtp_host,
      port: parseInt(s.smtp_port),
      secure: parseInt(s.smtp_port) === 465,
      auth: { user: s.smtp_user, pass: s.smtp_pass },
      tls: { rejectUnauthorized: false },
      family: 4
    });

    await transporter.sendMail({
      from: `"${s.smtp_from || 'PLAN BEAUTY'}" <${s.smtp_user}>`,
      to: clientEmail,
      subject: '⚠️ Error en Cobro de Suscripción - PLAN BEAUTY',
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #fee2e2; border-radius: 16px; overflow: hidden; background-color: #ffffff;">
          <div style="background-color: #ef4444; padding: 40px 30px; text-align: center;">
            <h1 style="margin: 0; font-size: 26px; color: #ffffff !important;">Aviso de Cobro Fallido</h1>
          </div>
          <div style="padding: 30px; color: #1e293b; line-height: 1.6;">
            <p style="color: #1e293b;">Hola <strong>${clientName}</strong>,</p>
            <p style="color: #1e293b;">Te informamos que no pudimos procesar el cobro recurrente de tu suscripción por un monto de <strong>RD$ ${parseFloat(amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>.</p>
            
            <div style="background-color: #fef2f2; border: 1px solid #fee2e2; border-radius: 12px; padding: 20px; margin: 25px 0;">
              <p style="margin: 0; color: #b91c1c;"><strong>Motivo:</strong> ${errorMsg}</p>
            </div>

            <p style="color: #1e293b;">Debido a este inconveniente, tu perfil ha sido marcado como <strong>Inactivo</strong> temporalmente. Por favor, visita nuestra sucursal o contáctanos para actualizar tu método de pago y reactivar tus beneficios.</p>
            
            <p style="color: #1e293b; text-align: center; font-weight: bold; margin-top: 30px;">Queremos que sigas disfrutando de PLAN BEAUTY</p>
            
            <p style="margin-top: 40px; border-top: 1px solid #f1f5f9; padding-top: 20px; font-size: 0.9rem; color: #64748b; text-align: center;">
              Atentamente,<br>
              <strong>Equipo ABATTE PELUQUERÍA</strong>
            </p>
          </div>
        </div>
      `
    });
    console.log(`[PAYMENT EMAIL] Failure notice sent to ${clientEmail}`);
  } catch (err) {
    console.error('[EMAIL ERROR]', err);
  }
}

// === OTP VERIFICATION & SERVICE DEDUCTION ===
app.post('/api/otp/generate', async (req, res) => {
  const { clientId, clientEmail } = req.body;
  const code = Math.floor(100000 + Math.random() * 900000).toString();

  try {
    // Invalidate old codes
    await pool.query('UPDATE verification_codes SET is_used = 1 WHERE client_id = ?', [clientId]);
    
    // Insert new code with 15 mins expiration using MySQL's NOW()
    await pool.query(
      'INSERT INTO verification_codes (client_id, code, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))',
      [clientId, code]
    );

    console.log(`[OTP] Generated code ${code} for client ${clientId} (${clientEmail})`);
    
    // --- SEND EMAIL ATTEMPT ---
    try {
      const [settings] = await pool.query('SELECT * FROM email_settings WHERE id = 1');
      if (settings.length > 0 && settings[0].smtp_host) {
        const s = settings[0];
        // We'll use a dynamic import for nodemailer or check if available
        try {
          const nodemailer = require('nodemailer');
          const isPort465 = parseInt(s.smtp_port) === 465;

          const transporter = nodemailer.createTransport({
            host: s.smtp_host,
            port: parseInt(s.smtp_port),
            secure: isPort465,
            auth: {
              user: s.smtp_user,
              pass: s.smtp_pass
            },
            tls: {
              rejectUnauthorized: false
            },
            family: 4
          });

          await transporter.sendMail({
            from: `"${s.smtp_from || 'PLAN BEAUTY'}" <${s.smtp_user}>`,
            to: clientEmail,
            subject: 'Tu Código de Seguridad - PLAN BEAUTY',
            text: `Hola, tu código de seguridad para confirmar el servicio es: ${code}. Expira en 15 minutos.`,
            html: `<div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                    <h2 style="color: #09090b;">Verificación de Servicio</h2>
                    <p>Hola, usa el siguiente código para autorizar el descuento de tu servicio en el salón:</p>
                    <div style="font-size: 2rem; font-weight: bold; color: #09090b; margin: 20px 0;">${code}</div>
                    <p style="color: #666; font-size: 0.8rem;">Este código expira en 15 minutos. Si no solicitaste este código, por favor ignora este correo.</p>
                   </div>`
          });
          console.log(`[EMAIL] OTP sent successfully to ${clientEmail}`);
        } catch (e) {
          console.error('[EMAIL] Failed to send email:', e.message);
        }
      }
    } catch (err) {
      console.error('[SETTINGS] Could not fetch email settings for OTP:', err.message);
    }
    
    res.json({ success: true, code, message: 'Código generado.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/otp/active/:clientId', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT code, expires_at FROM verification_codes WHERE client_id = ? AND is_used = 0 ORDER BY created_at DESC LIMIT 1',
      [req.params.clientId]
    );
    if (rows.length > 0) {
      const codeRecord = rows[0];
      const expiresAtTime = codeRecord.expires_at instanceof Date 
        ? codeRecord.expires_at.getTime() 
        : new Date(codeRecord.expires_at).getTime();

      if (Date.now() <= expiresAtTime) {
        return res.json({ code: codeRecord.code });
      }
    }
    res.status(404).json({ error: 'No hay código activo.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/security/requests', async (req, res) => {
  try {
    // Usamos un margen de tiempo más amplio y comprobamos códigos creados recientemente
    const [rows] = await pool.query(`
      SELECT 
        vc.code as active_code,
        c.nombre as client_name,
        c.cedula as client_id,
        'Facturación de Membresía' as service_name,
        'Staff Recepción' as staff_name,
        vc.created_at
      FROM verification_codes vc
      JOIN clients c ON vc.client_id = c.id
      WHERE vc.is_used = 0 
        AND vc.created_at >= DATE_SUB(NOW(), INTERVAL 30 MINUTE)
      ORDER BY vc.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/otp/verify', async (req, res) => {
  const { clientId, code, visitData } = req.body;
  try {
    const [rows] = await pool.query(
      'SELECT id, expires_at FROM verification_codes WHERE client_id = ? AND code = ? AND is_used = 0',
      [clientId, code]
    );

    if (rows.length === 0) {
      return res.status(400).json({ error: 'Código inválido o expirado.' });
    }

    const codeRecord = rows[0];
    const expiresAtTime = codeRecord.expires_at instanceof Date 
      ? codeRecord.expires_at.getTime() 
      : new Date(codeRecord.expires_at).getTime();

    if (Date.now() > expiresAtTime) {
      return res.status(400).json({ error: 'Código inválido o expirado.' });
    }

    // Mark code as used
    await pool.query('UPDATE verification_codes SET is_used = 1 WHERE id = ?', [codeRecord.id]);

    // Record the visit (Discount service)
    const visitId = Date.now().toString();
    await pool.query(
      'INSERT INTO visits (id, client_id, client_name, servicios, empleado_peluquera, empleado_lava_pelo, empleado_manicurista, salon_id, visited_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      [visitId, clientId, visitData.clientName, JSON.stringify(visitData.servicios), visitData.empleadoPeluquera || 'N/A', visitData.empleadoLavaPelo || 'N/A', visitData.empleadoManicurista || 'N/A', visitData.salon_id || 1]
    );

    // Trigger Survey
    const [clientData] = await pool.query('SELECT email FROM clients WHERE id = ?', [clientId]);
    console.log(`[OTP Verify] Client: ${clientId}, Email: ${clientData[0]?.email}, Name: ${visitData.clientName}`);
    
    if (clientData[0]?.email) {
      console.log(`[OTP Verify] Sending survey email to ${clientData[0].email}...`);
      sendSurveyEmail(clientId, visitData.clientName, clientData[0].email);
    } else {
      console.warn(`[OTP Verify] No email found for client ${clientId}, survey not sent.`);
    }

    res.json({ success: true, visitId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/otp/verify-only', async (req, res) => {
  const { clientId, code } = req.body;
  try {
    const [rows] = await pool.query(
      'SELECT id, expires_at FROM verification_codes WHERE client_id = ? AND code = ? AND is_used = 0',
      [clientId, code]
    );

    if (rows.length === 0) {
      return res.status(400).json({ error: 'Código inválido o expirado.' });
    }

    const codeRecord = rows[0];
    const expiresAtTime = codeRecord.expires_at instanceof Date 
      ? codeRecord.expires_at.getTime() 
      : new Date(codeRecord.expires_at).getTime();

    if (Date.now() > expiresAtTime) {
      return res.status(400).json({ error: 'Código inválido o expirado.' });
    }

    // Mark code as used
    await pool.query('UPDATE verification_codes SET is_used = 1 WHERE id = ?', [codeRecord.id]);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/surveys/stats', async (req, res) => {
  const { startDate, endDate, salonId, staffName, clientId } = req.query;
  
  try {
    const [rows] = await pool.query(`
      SELECT s.*, 
             COALESCE(s.client_name, c.nombre) as client_name,
             COALESCE(s.salon_name, sal.name) as salon_name
      FROM surveys s
      LEFT JOIN clients c ON s.client_id = c.id
      LEFT JOIN salons sal ON s.salon_id = sal.id
      WHERE 1=1
      ${startDate ? ' AND s.created_at >= ?' : ''}
      ${endDate ? ' AND s.created_at <= ?' : ''}
      ${salonId && salonId !== 'all' ? ' AND s.salon_id = ?' : ''}
      ${staffName ? ' AND (s.staff_peluquera = ? OR s.staff_lava_pelo = ? OR s.staff_manicurista = ?)' : ''}
      ${clientId ? ' AND s.client_id = ?' : ''}
    `.replace(/\s+/g, ' '), [
      ...(startDate ? [startDate] : []),
      ...(endDate ? [endDate + ' 23:59:59'] : []),
      ...(salonId && salonId !== 'all' ? [parseInt(salonId)] : []),
      ...(staffName ? [staffName, staffName, staffName] : []),
      ...(clientId ? [clientId] : [])
    ]);
    
    let sentQuery = `
      SELECT COUNT(ps.id) as sent_count 
      FROM pending_surveys ps
      LEFT JOIN (
        SELECT v1.client_id, v1.salon_id, v1.empleado_peluquera, v1.empleado_lava_pelo, v1.empleado_manicurista
        FROM visits v1
        INNER JOIN (
          SELECT client_id, MAX(visited_at) as max_visited_at
          FROM visits
          GROUP BY client_id
        ) v2 ON v1.client_id = v2.client_id AND v1.visited_at = v2.max_visited_at
      ) last_v ON ps.client_id = last_v.client_id
      WHERE 1=1
    `.replace(/\s+/g, ' ');
    let sentParams = [];
    if (startDate) { sentQuery += ' AND ps.created_at >= ?'; sentParams.push(startDate); }
    if (endDate) { sentQuery += ' AND ps.created_at <= ?'; sentParams.push(endDate + ' 23:59:59'); }
    if (clientId) { sentQuery += ' AND ps.client_id = ?'; sentParams.push(clientId); }
    if (salonId && salonId !== 'all') { sentQuery += ' AND last_v.salon_id = ?'; sentParams.push(parseInt(salonId)); }
    if (staffName) { sentQuery += ' AND (last_v.empleado_peluquera = ? OR last_v.empleado_lava_pelo = ? OR last_v.empleado_manicurista = ?)'; sentParams.push(staffName, staffName, staffName); }
    const [[{ sent_count }]] = await pool.query(sentQuery, sentParams);

    if (rows.length === 0) {
      return res.json({ nps: 0, averages: {}, total: 0, raw: [], sent_count: sent_count || 0, answered_count: 0 });
    }

    const calculateNPS = (values) => {
      let p = 0, d = 0, t = 0;
      values.forEach(v => {
        const val = parseInt(v);
        if (isNaN(val)) return;
        if (val >= 9) p++;
        else if (val <= 6) d++;
        t++;
      });
      return t > 0 ? parseFloat(((p - d) / t * 100).toFixed(2)) : 0;
    };

    // Gather all valid rating scores from all questions across all rows to calculate the combined NPS Global
    const allScores = [];
    rows.forEach(r => {
      const p_vals = [
        r.q1, 
        r.q2, 
        r.staff_peluquera !== 'N/A' ? r.q3 : null,
        r.staff_lava_pelo !== 'N/A' ? r.q4 : null,
        r.staff_manicurista !== 'N/A' ? r.q5 : null,
        r.q7, 
        r.q8
      ].map(v => parseInt(v)).filter(v => v !== null && !isNaN(v) && v >= 0);
      
      allScores.push(...p_vals);
    });

    const npsGlobal = calculateNPS(allScores);
    
    const questions = ['q1', 'q2', 'q3', 'q4', 'q5', 'q7', 'q8'];
    const averages = {};
    const npsPerQuestion = {};

    questions.forEach(q => {
      const vals = rows.map(r => {
        // Ignorar calificaciones si el personal no fue asignado ('N/A')
        if (q === 'q3' && r.staff_peluquera === 'N/A') return null;
        if (q === 'q4' && r.staff_lava_pelo === 'N/A') return null;
        if (q === 'q5' && r.staff_manicurista === 'N/A') return null;
        return parseInt(r[q]);
      }).filter(v => v !== null && !isNaN(v) && v >= 0);
      
      const sum = vals.reduce((a, b) => a + b, 0);
      averages[q] = vals.length > 0 ? (sum / vals.length).toFixed(1) : 0;
      npsPerQuestion[q] = calculateNPS(vals);
    });

    res.json({
      nps: npsGlobal,
      npsPerQuestion,
      averages,
      total: rows.length,
      sent_count: sent_count || 0,
      answered_count: rows.length,
      raw: rows.map(r => {
        // Calculate Personal NPS for this specific response (ignoring ratings of unassigned staff)
        const p_vals = [
          r.q1, 
          r.q2, 
          r.staff_peluquera !== 'N/A' ? r.q3 : null,
          r.staff_lava_pelo !== 'N/A' ? r.q4 : null,
          r.staff_manicurista !== 'N/A' ? r.q5 : null,
          r.q7, 
          r.q8
        ].map(v => parseInt(v)).filter(v => v !== null && !isNaN(v) && v >= 0);
        
        let p = 0, d = 0, t = 0;
        p_vals.forEach(v => {
          if (v >= 9) p++;
          else if (v <= 6) d++;
          t++;
        });
        const personalNps = t > 0 ? parseFloat(((p - d) / t * 100).toFixed(2)) : 0;
        return { ...r, personalNps };
      })
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



app.get('/api/surveys', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM surveys');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check if client has pending survey
app.get('/api/surveys/pending/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    const [rows] = await pool.query(
      'SELECT id FROM pending_surveys WHERE client_id = ? AND status = "Pending" LIMIT 1',
      [clientId]
    );
    res.json({ hasPending: rows.length > 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/surveys', async (req, res) => {
  try {
    const id = Date.now().toString();
    const { clientId, responses } = req.body;

    // 1. Get client's last visit to capture context (salon, staff)
    const [visits] = await pool.query(
      'SELECT salon_id, empleado_peluquera, empleado_lava_pelo, empleado_manicurista FROM visits WHERE client_id = ? ORDER BY visited_at DESC LIMIT 1',
      [clientId]
    );
    
    const v = visits[0] || {};

    await pool.query(
      'INSERT INTO surveys (id, client_id, client_name, salon_id, salon_name, staff_peluquera, staff_lava_pelo, staff_manicurista, q1, q2, q3, q4, q5, q6, q7, q8) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id, clientId, responses.clientName || 'Cliente', 
        v.salon_id || 1, responses.salonName || 'San Vicente',
        v.empleado_peluquera || 'N/A', v.empleado_lava_pelo || 'N/A', v.empleado_manicurista || 'N/A',
        responses.q1, responses.q2, responses.q3, responses.q4, responses.q5, responses.q6, responses.q7, responses.q8
      ]
    );

    // Mark as completed in pending_surveys
    await pool.query('UPDATE pending_surveys SET status = "Completed" WHERE client_id = ? AND status = "Pending"', [clientId]);

    res.json({ id, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// === GIFTS REDEMPTION ===
app.post('/api/gifts/redeem', async (req, res) => {
  const { giftCode } = req.body;
  try {
    const [rows] = await pool.query('SELECT * FROM gift_cards WHERE code = ?', [giftCode]);
    if (rows.length === 0) return res.status(404).json({ error: 'Código no encontrado' });
    
    const gift = rows[0];
    if (gift.status !== 'Active' && gift.status !== 'Partially_Redeemed') {
      return res.status(400).json({ error: 'Este certificado ya no está activo' });
    }
    
    // In the client/public version, we redeem the FULL remaining balance for a specific service
    const amountToRedeem = gift.balance;
    const newBalance = 0;
    const newStatus = 'Redeemed';
    
    await pool.query(
      'UPDATE gift_cards SET balance = ?, status = ?, used_at = NOW() WHERE id = ?', 
      [newBalance, newStatus, gift.id]
    );

    // Record consumption history log
    await pool.query(
      'INSERT INTO gift_card_logs (gift_card_id, amount_redeemed, balance_before, balance_after) VALUES (?, ?, ?, ?)',
      [gift.id, amountToRedeem, gift.balance, newBalance]
    );
    
    res.json({ success: true, message: 'Canje exitoso', amount: amountToRedeem });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === PLANS ===
app.get('/api/plans', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM plans');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/plans', async (req, res) => {
  let connection;
  try {
    const { plans, applyToExisting } = req.body;
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 1. Limpieza total de planes para evitar duplicados e inconsistencias
    await connection.query('DELETE FROM plans');

    if (Array.isArray(plans)) {
      for (const plan of plans) {
        // Aseguramos que los servicios sean siempre un array real antes de stringificar para la DB
        const ensureData = (val) => {
          if (Array.isArray(val)) return JSON.stringify(val);
          if (typeof val === 'string') {
            try {
              const p = JSON.parse(val);
              return JSON.stringify(Array.isArray(p) ? p : [p]);
            } catch {
              return JSON.stringify(val.split(',').map(s => s.trim()).filter(Boolean));
            }
          }
          return JSON.stringify([]);
        };

        const servicesStr = ensureData(plan.services);
        const promoServicesStr = ensureData(plan.promo_services);
        const usageLimitsStr = JSON.stringify(plan.usage_limits || { visits: '', services: '' });

        await connection.query(
          'INSERT INTO plans (id, title, price, activation_fee, discount, color, location, services, promo_services, promo_duration_months, usage_limits) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            plan.id,
            plan.title,
            plan.price,
            plan.activation_fee || 0,
            plan.discount || 0,
            plan.color,
            plan.location,
            servicesStr,
            promoServicesStr,
            plan.promo_duration_months || 0,
            usageLimitsStr
          ]
        );

        // 2. Sincronizar contratos si se solicita (con los mismos strings limpios)
        if (applyToExisting) {
          await connection.query(
            `UPDATE contracts SET 
              contract_services = ?, 
              contract_price = ?, 
              contract_promo_services = ?, 
              contract_promo_duration = ? 
             WHERE plan_id = ?`,
            [
              servicesStr,
              plan.price,
              promoServicesStr,
              plan.promo_duration_months || 0,
              plan.id
            ]
          );
        }
      }
    }

    await connection.commit();
    res.json({ success: true, message: 'Planes sincronizados correctamente.' });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('[DATABASE ERROR]:', err.message);
    res.status(500).json({ error: 'Fallo al guardar planes: ' + err.message });
  } finally {
    if (connection) connection.release();
  }
});


app.get('/api/contracts/client/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    const clean = clientId ? clientId.trim() : '';
    const [rows] = await pool.query(`
      SELECT 
        c.*, 
        cl.nombre as clientName, 
        cl.cedula as clientCedula,
        cl.telefono as clientPhone,
        cl.email as clientEmail,
        COALESCE(p.title, 'Plan Beauty') as planTitle
      FROM contracts c
      JOIN clients cl ON c.client_id = cl.id
      LEFT JOIN plans p ON (c.plan_id = p.id OR CAST(c.plan_id AS CHAR) = CAST(p.id AS CHAR))
      WHERE (c.client_id = ? OR cl.cedula = ? OR TRIM(cl.nombre) = ? OR cl.nombre LIKE ?)
        AND (c.status = 'Active' OR c.status = 'Activo')
      ORDER BY c.signed_at DESC
    `, [clean, clean, clean, `%${clean}%`]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/clients/:id/payment-profile', async (req, res) => {
  try {
    const { id } = req.params;
    const [clients] = await pool.query('SELECT cardnet_customer_id FROM clients WHERE id = ?', [id]);
    const cardnetCustomerId = clients[0]?.cardnet_customer_id;

    if (!cardnetCustomerId) {
      // Intento de fallback local con el token del contrato activo
      const [contracts] = await pool.query(
        'SELECT payment_profile_id, card_token FROM contracts WHERE client_id = ? AND status = "Active" LIMIT 1',
        [id]
      );
      if (contracts.length > 0 && contracts[0].payment_profile_id) {
        const last4 = '8888';
        const brand = contracts[0].card_token?.toLowerCase().includes('mastercard') ? 'MasterCard' : (contracts[0].card_token?.toLowerCase().includes('amex') ? 'Amex' : 'Visa');
        return res.json({
          PaymentProfileId: contracts[0].payment_profile_id,
          Brand: brand,
          Last4: last4,
          Expiration: "203012",
          Enable: "1",
          IsSimulated: true
        });
      }
      return res.json(null);
    }

    const url = `${CARDNET_CONFIG.BASE_URL}/api/Customer/${cardnetCustomerId}`;
    
    try {
      const response = await axios.get(url, { headers: getCardNetAuthHeaders(), timeout: CARDNET_CONFIG.TIMEOUT });
      const customer = response.data.Response || response.data;
      const profiles = customer.PaymentProfiles || [];
      const profile = profiles.find(p => p.Enable === "1") || profiles[0];
      res.json(profile || null);
    } catch (error) {
      console.error("[CARDNET] Error fetching profile from CardNet (down or overload). Serving simulated fallback:", error.message);
      
      // Intentar fallback del contrato activo antes del mock genérico
      const [contracts] = await pool.query(
        'SELECT payment_profile_id, card_token FROM contracts WHERE client_id = ? AND status = "Active" LIMIT 1',
        [id]
      );
      const last4 = contracts.length > 0 && contracts[0].card_token?.slice(-4) ? contracts[0].card_token.slice(-4) : cardnetCustomerId.toString().slice(-4).padStart(4, '9');
      const brand = contracts.length > 0 && contracts[0].card_token?.toLowerCase().includes('mastercard') ? 'MasterCard' : (contracts.length > 0 && contracts[0].card_token?.toLowerCase().includes('amex') ? 'Amex' : 'Visa');
      
      const mockProfile = {
        PaymentProfileId: contracts.length > 0 ? contracts[0].payment_profile_id : `mock_${cardnetCustomerId}`,
        Brand: brand,
        Last4: last4,
        Expiration: "203012",
        Enable: "1",
        IsSimulated: true
      };
      res.json(mockProfile);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === COMPREHENSIVE ANALYTICS REPORTS ===
app.get('/api/reports/analytics', async (req, res) => {
  const { salon_id, start_date, end_date } = req.query;
  const hasSalon = salon_id && salon_id !== 'all';
  const salonVal = hasSalon ? parseInt(salon_id) : null;
  const hasDate = Boolean(start_date && end_date);

  const whereDatePayments = hasDate ? `AND p.created_at BETWEEN '${start_date} 00:00:00' AND '${end_date} 23:59:59'` : '';
  const whereSalonPayments = hasSalon ? `AND COALESCE(p.salon_id, c.salon_id) = ${salonVal}` : '';

  try {
    // 1. Daily Sales
    const [sales] = await pool.query(`
      SELECT DATE(p.created_at) as date, SUM(p.amount) as total 
      FROM payments p
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE p.status = 'Aprobado' ${whereSalonPayments} ${whereDatePayments}
      GROUP BY DATE(p.created_at) 
      ORDER BY date DESC ${hasDate ? '' : 'LIMIT 30'}
    `);

    // 2. Client Status Summary
    const [activeClients] = await pool.query(`
      SELECT COUNT(*) as count 
      FROM contracts ct
      LEFT JOIN clients c ON ct.client_id = c.id
      WHERE ct.status = 'Active' ${hasSalon ? `AND COALESCE(ct.salon_id, c.salon_id) = ${salonVal}` : ''}
    `);
    const [cancelledClients] = await pool.query(`
      SELECT COUNT(*) as count 
      FROM contracts ct
      LEFT JOIN clients c ON ct.client_id = c.id
      WHERE ct.status = 'Cancelled' ${hasSalon ? `AND COALESCE(ct.salon_id, c.salon_id) = ${salonVal}` : ''}
    `);

    // 3. Inactive Clients (> 15 days)
    const [inactive] = await pool.query(`
      SELECT cl.id, cl.nombre, cl.telefono, MAX(v.visited_at) as last_visit
      FROM clients cl
      JOIN contracts c ON cl.id = c.client_id
      LEFT JOIN visits v ON cl.id = v.client_id
      WHERE c.status = 'Active' ${hasSalon ? `AND COALESCE(c.salon_id, cl.salon_id) = ${salonVal}` : ''}
      GROUP BY cl.id, cl.nombre, cl.telefono
      HAVING last_visit < DATE_SUB(NOW(), INTERVAL 15 DAY) OR last_visit IS NULL
      ORDER BY last_visit ASC
    `);

    // 4. Payment Methods Breakdown
    const [payments] = await pool.query(`
      SELECT p.method, SUM(p.amount) as total, COUNT(*) as count
      FROM payments p
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE p.status = 'Aprobado' ${whereSalonPayments} ${whereDatePayments}
      GROUP BY p.method
    `);

    // 5. Visit Frequency (Filtered by Date Range and Salon)
    const [frequency] = await pool.query(`
      SELECT visit_count, COUNT(*) as client_count FROM (
        SELECT v.client_id, COUNT(*) as visit_count 
        FROM visits v
        LEFT JOIN clients c ON v.client_id = c.id
        WHERE 1=1
          ${hasSalon ? `AND COALESCE(v.salon_id, c.salon_id) = ${salonVal}` : ''}
          ${hasDate ? `AND v.visited_at BETWEEN '${start_date} 00:00:00' AND '${end_date} 23:59:59'` : ''}
        GROUP BY v.client_id
      ) as t
      GROUP BY visit_count
      ORDER BY visit_count ASC
    `);

    // 6. Renewal Revenue
    const [renewalRevenue] = await pool.query(`
      SELECT SUM(p.amount) as total
      FROM payments p
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE p.status = 'Aprobado' 
        AND p.plan_id IS NOT NULL 
        AND p.plan_id != 'gift_card'
        ${whereSalonPayments}
        ${whereDatePayments}
    `);

    // 7. Cash Payments
    const [cashPayments] = await pool.query(`
      SELECT p.id, p.amount, p.created_at, p.applied_by, p.method,
             c.nombre as client_name, s.name as salon_name
      FROM payments p
      LEFT JOIN clients c ON p.client_id = c.id
      LEFT JOIN salons s ON COALESCE(p.salon_id, c.salon_id) = s.id
      WHERE p.status = 'Aprobado' AND (p.method = 'Efectivo/POS' OR p.method = 'Efectivo')
        ${whereSalonPayments}
        ${whereDatePayments}
      ORDER BY p.created_at DESC
      LIMIT 100
    `);

    res.json({
      dailySales: sales,
      renewalRevenue: renewalRevenue[0]?.total || 0,
      clientSummary: {
        active: activeClients[0]?.count || 0,
        cancelled: cancelledClients[0]?.count || 0
      },
      inactiveClients: inactive,
      paymentBreakdown: payments,
      visitFrequency: frequency,
      cashPayments: cashPayments
    });

  } catch (err) {
    console.error('[ANALYTICS ERROR]:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/clients/:id/payment-profiles', async (req, res) => {
  try {
    const { id } = req.params;
    const [clients] = await pool.query('SELECT cardnet_customer_id FROM clients WHERE id = ?', [id]);
    const cardnetCustomerId = clients[0]?.cardnet_customer_id;

    if (!cardnetCustomerId) {
      const [contracts] = await pool.query(
        'SELECT payment_profile_id, card_token FROM contracts WHERE client_id = ? AND status = "Active" LIMIT 1',
        [id]
      );
      if (contracts.length > 0 && contracts[0].payment_profile_id) {
        const last4 = '8888';
        const brand = contracts[0].card_token?.toLowerCase().includes('mastercard') ? 'MasterCard' : (contracts[0].card_token?.toLowerCase().includes('amex') ? 'Amex' : 'Visa');
        return res.json([
          {
            PaymentProfileId: contracts[0].payment_profile_id,
            Brand: brand,
            Last4: last4,
            Expiration: "203012",
            Enable: "1",
            IsSimulated: true
          }
        ]);
      }
      return res.json([]);
    }

    const url = `${CARDNET_CONFIG.BASE_URL}/api/Customer/${cardnetCustomerId}`;
    
    try {
      const response = await axios.get(url, { headers: getCardNetAuthHeaders(), timeout: CARDNET_CONFIG.TIMEOUT });
      const customer = response.data.Response || response.data;
      res.json(customer.PaymentProfiles || []);
    } catch (error) {
      console.error("[CARDNET] Error fetching profiles list from CardNet (down or overload). Serving simulated fallback:", error.message);
      
      const [contracts] = await pool.query(
        'SELECT payment_profile_id, card_token FROM contracts WHERE client_id = ? AND status = "Active" LIMIT 1',
        [id]
      );
      const last4 = contracts.length > 0 && contracts[0].card_token?.slice(-4) ? contracts[0].card_token.slice(-4) : cardnetCustomerId.toString().slice(-4).padStart(4, '9');
      const brand = contracts.length > 0 && contracts[0].card_token?.toLowerCase().includes('mastercard') ? 'MasterCard' : (contracts.length > 0 && contracts[0].card_token?.toLowerCase().includes('amex') ? 'Amex' : 'Visa');
      
      const mockProfiles = [
        {
          PaymentProfileId: contracts.length > 0 ? contracts[0].payment_profile_id : `mock_${cardnetCustomerId}`,
          Brand: brand,
          Last4: last4,
          Expiration: "203012",
          Enable: "1",
          IsSimulated: true
        }
      ];
      res.json(mockProfiles);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/clients/:id/payment-method', async (req, res) => {
  const { id } = req.params;
  const { pwToken } = req.body;

  try {
    const [clients] = await pool.query('SELECT cardnet_customer_id FROM clients WHERE id = ?', [id]);
    let cardnetCustomerId = clients[0]?.cardnet_customer_id;
    
    // Si el cliente no tiene ID de CardNet, le generamos uno simulado local
    if (!cardnetCustomerId) {
      cardnetCustomerId = 'mock_cust_' + Math.floor(100000 + Math.random() * 900000);
      await pool.query('UPDATE clients SET cardnet_customer_id = ? WHERE id = ?', [cardnetCustomerId, id]);
    }

    console.log(`[CARDNET] Actualizando tarjeta para cliente ${id}. Activando token: ${pwToken}`);
    
    // Si es un token simulado o el entorno es de pruebas locales
    if (String(pwToken || '').startsWith('mock_')) {
      const mockProfileId = `mock_profile_${Date.now()}`;
      await pool.query(
        'UPDATE contracts SET payment_profile_id = ?, card_token = ? WHERE client_id = ?',
        [mockProfileId, pwToken, id]
      );
      console.log(`[CARDNET] Tarjeta simulada local vinculada con éxito. Profile ID: ${mockProfileId}`);
      return res.json({ success: true, paymentProfileId: mockProfileId });
    }

    try {
      const activateRes = await axios.post(
        `${CARDNET_CONFIG.BASE_URL}/api/Customer/${cardnetCustomerId}/activate`,
        { Token: pwToken, ActivationCode: "" },
        { headers: getCardNetAuthHeaders(), timeout: CARDNET_CONFIG.TIMEOUT }
      );
      
      const custData = activateRes.data.Response || activateRes.data;
      const profiles = custData.PaymentProfiles || [];
      const match = profiles.find(p => p.Token === pwToken) || profiles[profiles.length - 1];

      if (!match) throw new Error("No se pudo identificar el perfil de pago en CardNet.");
      
      const paymentProfileId = match.PaymentProfileId.toString();
      const cardToken = match.Token;

      // Actualizar todos los contratos de este cliente con el nuevo ID de perfil y el nuevo TOKEN
      await pool.query(
        'UPDATE contracts SET payment_profile_id = ?, card_token = ? WHERE client_id = ?',
        [paymentProfileId, cardToken, id]
      );

      console.log(`[CARDNET] Tarjeta vinculada vía CardNet con éxito. Profile ID: ${paymentProfileId}`);
      res.json({ success: true, paymentProfileId });
    } catch (apiErr) {
      console.error("[CARDNET] Error en activación CardNet (caído o sobrecargado). Utilizando fallback local:", apiErr.message);
      
      const mockProfileId = `mock_profile_${Date.now()}`;
      await pool.query(
        'UPDATE contracts SET payment_profile_id = ?, card_token = ? WHERE client_id = ?',
        [mockProfileId, pwToken, id]
      );
      
      res.json({ success: true, paymentProfileId: mockProfileId });
    }
  } catch (err) {
    console.error('[CARDNET] Error actualizando tarjeta:', err.message);
    res.status(500).json({ error: err.message });
  }
});
// 0. Middleware de Log para depuración
app.use('/api/cardnet', (req, res, next) => {
  console.log(`[DEBUG] Petición recibida: ${req.method} ${req.url}`);
  next();
});

// === SYSTEM STATUS & VERSION ===
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    version: '1.2.0',
    environment: process.env.CARDNET_ENV || 'DEVELOPMENT',
    database: 'connected',
    timezone: '-04:00',
    currentTime: new Date().toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo' })
  });
});

// === GATEWAY STATUS ENDPOINT ===
app.get('/api/cardnet/status', async (req, res) => {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    
    const urlObj = new URL(process.env.CARDNET_BASE_URL || 'https://labservicios.cardnet.com.do');
    
    // Hacemos una petición GET simple al origen del servidor de CardNet
    const response = await fetch(urlObj.origin, {
      method: 'GET',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    const latency = Date.now() - start;
    
    res.json({
      success: true,
      active: true,
      env: process.env.CARDNET_ENV || 'TEST',
      latency,
      message: `La plataforma está conectada exitosamente al entorno de ${process.env.CARDNET_ENV === 'PROD' ? 'producción' : 'pruebas'} de CardNet Dominicana.`
    });
  } catch (err) {
    const latency = Date.now() - start;
    res.json({
      success: false,
      active: false,
      env: process.env.CARDNET_ENV || 'TEST',
      latency: err.name === 'AbortError' ? 6000 : latency,
      error: err.message,
      message: 'No se pudo establecer conexión con el servidor de CardNet Dominicana.'
    });
  }
});

// 1. Create or Get Customer (Alias /session para compatibilidad)
app.post(['/api/cardnet/customer', '/api/cardnet/session'], async (req, res) => {
  try {
    const { email, clientId } = req.body;

    if (!email && !clientId) {
      return res.status(400).json({
        success: false,
        error: 'Debe enviar email o clientId para crear/obtener sesión de CardNet.'
      });
    }

    let existingCustomerId = null;

    // 1. Buscar en DB si ya tenemos ID
    if (clientId) {
      const [rows] = await pool.query(
        'SELECT cardnet_customer_id FROM clients WHERE id = ?',
        [clientId]
      );
      if (rows.length > 0) existingCustomerId = rows[0].cardnet_customer_id;
    }

    // 2. Si existe, intentar recuperarlo directo
    if (existingCustomerId) {
      try {
        const response = await axios.get(
          `${CARDNET_CONFIG.BASE_URL}/api/Customer/${existingCustomerId}`,
          { headers: getCardNetAuthHeaders() }
        );
        const customer = response.data.Response || response.data;
        return res.json({
          success: true,
          customerId: customer.CustomerId,
          uniqueId: customer.UniqueID,
          captureUrl: customer.CaptureURL,
          publicKey: CARDNET_CONFIG.PUBLIC_KEY,
          merchantNumber: CARDNET_CONFIG.MERCHANT_NUMBER,
          merchantTerminal: CARDNET_CONFIG.TERMINAL_ID,
          fullResponse: customer
        });
      } catch (e) {
        console.warn('[CARDNET] Customer ID in DB failed, resetting in DB to regenerate: ', e.message);
        if (clientId) {
          await pool.query('UPDATE clients SET cardnet_customer_id = NULL WHERE id = ?', [clientId]);
        }
      }
    }

    // 3. Crear o Fetch por Email
    try {
      const response = await axios.post(
        `${CARDNET_CONFIG.BASE_URL}/api/Customer`,
        { Email: email || `user-${clientId}@salonpro.do`, Enable: 'true' },
        { headers: getCardNetAuthHeaders() }
      );
      const customer = response.data.Response || response.data;
      
      if (clientId && customer.CustomerId) {
        await pool.query('UPDATE clients SET cardnet_customer_id = ? WHERE id = ?', [customer.CustomerId.toString(), clientId]);
      }

      return res.json({
        success: true,
        customerId: customer.CustomerId,
        uniqueId: customer.UniqueID,
        captureUrl: customer.CaptureURL,
        publicKey: CARDNET_CONFIG.PUBLIC_KEY,
        merchantNumber: CARDNET_CONFIG.MERCHANT_NUMBER,
        merchantTerminal: CARDNET_CONFIG.TERMINAL_ID,
        fullResponse: customer
      });
    } catch (apiErr) {
      const errorData = apiErr.response?.data || {};
      // Si ya existe (CS005 o ResponseCode 13)
      if (errorData.ResponseCode === '13' || JSON.stringify(errorData).includes("already exists")) {
        const custId = errorData.Response?.CustomerId || errorData.CustomerId;
        if (custId) {
          const retryRes = await axios.get(
            `${CARDNET_CONFIG.BASE_URL}/api/Customer/${custId}`,
            { headers: getCardNetAuthHeaders() }
          );
          const finalCust = retryRes.data.Response || retryRes.data;
          // Guardar el CustomerId correcto de producción en la base de datos
          if (clientId) {
            await pool.query('UPDATE clients SET cardnet_customer_id = ? WHERE id = ?', [finalCust.CustomerId.toString(), clientId]);
          }
          return res.json({
            success: true,
            customerId: finalCust.CustomerId,
            uniqueId: finalCust.UniqueID,
            captureUrl: finalCust.CaptureURL,
            publicKey: CARDNET_CONFIG.PUBLIC_KEY,
            merchantNumber: CARDNET_CONFIG.MERCHANT_NUMBER,
            merchantTerminal: CARDNET_CONFIG.TERMINAL_ID,
            fullResponse: finalCust
          });
        }
      }
      throw apiErr;
    }
  } catch (err) {
    console.error('[CARDNET SESSION ERROR]', err.response?.data || err.message);
    res.status(500).json({
      success: false,
      error: 'Error de sesión CardNet: ' + err.message,
      details: err.response?.data
    });
  }
});


// 2. Get Customer (to get CaptureURL + UniqueID)
app.get('/api/cardnet/customer/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    console.log('[CARDNET] Consulting Customer:', customerId);

    const response = await axios.get(
      `${CARDNET_CONFIG.BASE_URL}/api/Customer/${customerId}`,
      { headers: getCardNetAuthHeaders() }
    );

    const customer = response.data.Response || response.data;
    res.json(customer);
  } catch (err) {
    console.error('[CARDNET] Get Customer Error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message, details: err.response?.data });
  }
});

// 3. Activate Payment Profile (Optional/Manual Activation)
app.post('/api/cardnet/customer/:customerId/activate', async (req, res) => {
  try {
    const { customerId } = req.params;
    const { token, activationCode } = req.body;
    console.log('[CARDNET] Activating Profile:', token);

    const response = await axios.post(
      `${CARDNET_CONFIG.BASE_URL}/api/Customer/${customerId}/activate`,
      { Token: token, ActivationCode: activationCode || "" },
      { headers: getCardNetAuthHeaders(), timeout: CARDNET_CONFIG.TIMEOUT }
    );

    const result = response.data.Response || response.data;
    res.json(result);
  } catch (err) {
    console.error('[CARDNET] Activate Error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message, details: err.response?.data });
  }
});

// === COBRO AD-HOC (MANUAL) EN PERFIL DE PAGO GUARDADO ===
app.post('/api/cardnet/customer/:customerId/charge-profile', async (req, res) => {
  const { customerId } = req.params;
  const { paymentProfileId, amount, description, clientId } = req.body;
  
  console.log(`[CARDNET] Cobro Ad-Hoc manual solicitado para Cliente: ${clientId}, CustomerID: ${customerId}, ProfileID: ${paymentProfileId}, Monto: RD$ ${amount}`);
  
  try {
    const isProductionEnv = CARDNET_CONFIG.ENV === 'PRODUCTION';
    const isMockProfile = !isProductionEnv && 
                          (String(paymentProfileId || '').startsWith('mock_') || String(customerId || '').startsWith('mock_'));
    
    if (!paymentProfileId && !isMockProfile) {
      return res.status(400).json({
        success: false,
        error: "Debe seleccionar una tarjeta válida para realizar el cobro."
      });
    }

    let isApproved = false;
    let purchaseResult = null;
    
    if (isMockProfile) {
      isApproved = true;
      purchaseResult = {
        Transaction: {
          Status: "Approved",
          OrderNumber: `CN-MAN-${Date.now().toString().slice(-6)}`,
          RemoteId: `MAN-${Date.now().toString().slice(-6)}`,
          Description: "Aprobado (Modo Simulación local - Ambiente de Pruebas)"
        },
        ResponseCode: "00"
      };
      console.log("[CARDNET BYPASS] [ENTORNO TEST] Aprobando cobro manual simulado automáticamente.");
    } else {
      // 2. Realizar cobro real vía CardNet
      const amountCents = Math.round(parseFloat(amount) * 100);
      const purchasePayload = {
        TrxToken: paymentProfileId,
        Order: `MAN-${Date.now().toString().slice(-6)}`,
        Amount: amountCents,
        Currency: "DOP",
        Capture: true,
        Description: description || `Cobro Manual PLAN BEAUTY`,
        CustomerIP: req.ip || "127.0.0.1",
        MerchantNumber: CARDNET_CONFIG.MERCHANT_NUMBER,
        MerchantTerminal: CARDNET_CONFIG.TERMINAL_ID,
        DataDo: { Tax: "0", Invoice: `INV-${Date.now().toString().slice(-6)}` }
      };

      console.log('[CARDNET] Enviando Payload de Compra Manual:', JSON.stringify(purchasePayload, null, 2));

      try {
        const response = await axios.post(
          `${CARDNET_CONFIG.BASE_URL}/api/Purchase`,
          purchasePayload,
          { headers: getCardNetAuthHeaders(), timeout: 15000 }
        );

        purchaseResult = response.data.Response || response.data;
        if (response.data.Errors && response.data.Errors.length > 0) {
          purchaseResult = {
            ...purchaseResult,
            Errors: response.data.Errors,
            ResponseCode: response.data.Errors[0].ErrorCode,
            ResponseMessage: response.data.Errors[0].Message
          };
        }
        isApproved = purchaseResult.Transaction?.Status === "Approved" || 
                     purchaseResult.ResponseCode === "00" ||
                     purchaseResult.Transaction?.Steps?.some(s => s.ResponseCode === "00");
        
        // Bypass TR005 en Sandbox
        if (!isApproved && !isProductionEnv) {
          const desc = (purchaseResult.ResponseMessage || purchaseResult.Transaction?.Description || "").toUpperCase();
          if (desc.includes("TR005") || purchaseResult.ResponseCode === "TR005") {
            console.log("[CARDNET] Detectado TR005 en Sandbox durante cobro manual. Aplicando Bypass.");
            isApproved = true;
          }
        }
      } catch (apiErr) {
        console.error("[CARDNET] Error consultando API de CardNet:", apiErr.message);
        if (!isProductionEnv) {
          console.log("[CARDNET] Activando fallback local de contingencia en ambiente de pruebas.");
          isApproved = true;
          purchaseResult = {
            Transaction: {
              Status: "Approved",
              OrderNumber: `CN-CONT-${Date.now().toString().slice(-6)}`,
              RemoteId: `CONT-${Date.now().toString().slice(-6)}`,
              Description: "Aprobado por contingencia local (ambiente de pruebas)"
            },
            ResponseCode: "00"
          };
        } else {
          // En producción, la caída de CardNet no aprueba cobros falsos
          throw new Error("No se pudo conectar con la pasarela de pagos CardNet para procesar la transacción. Intente nuevamente.");
        }
      }
    }

    if (isApproved) {
      const gatewayRef = purchaseResult?.Transaction?.OrderNumber || purchaseResult?.Transaction?.RemoteId || `CN-${Date.now().toString().slice(-6)}`;
      const payId = `PAY-MAN-${Date.now()}`;
      
      // Registrar pago aprobado en la base de datos
      await pool.query(
        'INSERT INTO payments (id, client_id, plan_id, amount, method, status, gateway_ref, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [payId, clientId || null, null, amount, 'Tarjeta_Guardada', 'Aprobado', gatewayRef, description || 'Cobro Manual de Suscripción']
      );

      // Si el pago es exitoso, reactivar al cliente
      if (clientId) {
        await pool.query('UPDATE clients SET status = "Active" WHERE id = ?', [clientId]);
        // Restablecer contrato suspendido/cancelado
        const [contracts] = await pool.query('SELECT id, plan_id FROM contracts WHERE client_id = ? LIMIT 1', [clientId]);
        if (contracts.length > 0) {
          const intervalUnit = CARDNET_CONFIG.ENV === 'PRODUCTION' ? 'MONTH' : 'HOUR';
          await pool.query(
            `UPDATE contracts SET status = "Active", retry_count = 0, last_billed_date = NOW(), next_billing_date = DATE_ADD(NOW(), INTERVAL 1 ${intervalUnit}) WHERE id = ?`,
            [contracts[0].id]
          );
        }
      }

      res.json({ 
        success: true, 
        ResponseCode: "00", 
        Status: "Approved", 
        AuthorizationCode: purchaseResult?.Transaction?.RemoteId || "MOCK_AUTH",
        purchaseResult 
      });
    } else {
      // Registrar pago fallido en la base de datos para que sea visible en el historial
      const payId = `PAY-MAN-FAIL-${Date.now()}`;
      await pool.query(
        'INSERT INTO payments (id, client_id, plan_id, amount, method, status, description, cardnet_raw_response) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [payId, clientId || null, null, amount, 'Tarjeta_Guardada', 'Rechazado', description || 'Cobro Manual Fallido', JSON.stringify(purchaseResult)]
      );

      // Si el cobro manual falló (tarjeta declinada), activamos el ciclo de reintentos en el contrato
      if (clientId) {
        // 1. Desactivar cliente
        await pool.query('UPDATE clients SET status = "Inactive" WHERE id = ?', [clientId]);

        // 2. Buscar contrato del cliente
        const [contracts] = await pool.query('SELECT id, retry_count FROM contracts WHERE client_id = ? LIMIT 1', [clientId]);
        if (contracts.length > 0) {
          const contract = contracts[0];
          const newRetryCount = contract.retry_count + 1;
          
          let newStatus = 'Pending_Retry';
          if (newRetryCount >= 90) {
            newStatus = 'Suspended';
          }

          const isProductionEnv = CARDNET_CONFIG.ENV === 'PRODUCTION';
          const nextRetrySql = isProductionEnv
            ? `CONCAT(DATE(DATE_ADD(NOW(), INTERVAL 1 DAY)), ' 17:00:00')`
            : `DATE_ADD(NOW(), INTERVAL 5 MINUTE)`;

          await pool.query(
            `UPDATE contracts SET status = ?, retry_count = ?, next_retry_date = ${nextRetrySql} WHERE id = ?`,
            [newStatus, newRetryCount, contract.id]
          );
          
          console.log(`[RETRY ENG] Cobro manual fallido de cliente: ${clientId}. Contrato establecido a ${newStatus} (Intento ${newRetryCount}/90)`);
        }
      }

      res.json({
        success: false,
        ResponseCode: purchaseResult?.ResponseCode || "05",
        Message: purchaseResult?.ResponseMessage || purchaseResult?.Transaction?.Description || 'El cobro fue declinado por el banco.',
        purchaseResult
      });
    }
  } catch (err) {
    console.error('[CARDNET] Error en cobro manual:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 4. Process Purchase (Pagar)
app.post('/api/cardnet/purchase', async (req, res) => {
  try {
    const { trxToken, amount, order, description, tax, invoice, customerIp } = req.body;
    console.log('[CARDNET] Processing Purchase:', amount, order);

    const payload = {
      TrxToken: trxToken,
      Order: order || `ORD-${Date.now()}`,
      Amount: Math.round(parseFloat(amount) * 100),
      Currency: "DOP",
      Capture: true,
      Description: description || "Cobro SalonPro", // Asegurar descripción
      CustomerIP: customerIp || "127.0.0.1",
      MerchantNumber: CARDNET_CONFIG.MERCHANT_NUMBER,
      MerchantTerminal: CARDNET_CONFIG.TERMINAL_ID,
      DataDo: {
        Tax: "0",
        Invoice: `INV-${Date.now().toString().slice(-6)}`
      }
    };

    console.log('[CARDNET] Enviando Payload de Compra (Intento 4):', JSON.stringify(payload, null, 2));

    const response = await axios.post(
      `${CARDNET_CONFIG.BASE_URL}/api/Purchase`,
      payload,
      { headers: getCardNetAuthHeaders() }
    );

    const result = response.data.Response || response.data;
    res.json(result);
  } catch (err) {
    console.error('[CARDNET] Purchase Error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message, details: err.response?.data });
  }
});



// === LEGACY/CONTRACT WRAPPER (Updated to use new flow) ===

// === LEGACY/CONTRACT WRAPPER (Updated to use new flow) ===
app.post('/api/contracts', async (req, res) => {
  try {
    const id = Date.now().toString();
    const { clientId, planId, signature_hash, pwToken } = req.body;

    const [clients] = await pool.query('SELECT * FROM clients WHERE id = ?', [clientId]);
    if (clients.length === 0) throw new Error('Client not found');
    const client = clients[0];

    const [plans] = await pool.query('SELECT * FROM plans WHERE id = ?', [planId]);
    if (plans.length === 0) throw new Error('Plan not found');
    const plan = plans[0];

    // Evitar duplicados: Un cliente no puede contratar el mismo plan dos veces de forma activa
    const [existing] = await pool.query(
      "SELECT id FROM contracts WHERE client_id = ? AND plan_id = ? AND status != 'Cancelled'",
      [clientId, planId]
    );
    if (existing.length > 0) throw new Error('El cliente ya posee este plan contratado actualmente.');

    const cardnetCustomerId = client.cardnet_customer_id;
    if (!cardnetCustomerId) throw new Error("CardNet Customer ID not found.");

    // Activate the token if it was provided as a one-time token
    let paymentProfileId = null;
    let persistentToken = pwToken; 

    const isProductionEnv = CARDNET_CONFIG.ENV === 'PRODUCTION';
    const isMockToken = !isProductionEnv && (!pwToken || pwToken === 'TOKEN_PENDING' || String(pwToken || '').startsWith('mock_'));

    if (isProductionEnv && (!pwToken || pwToken === 'TOKEN_PENDING' || String(pwToken || '').startsWith('mock_'))) {
      throw new Error("Se requiere una tarjeta de crédito/débito real y válida para activar una suscripción en producción.");
    }

    if (isMockToken) {
      paymentProfileId = `mock_profile_${Date.now()}`;
      persistentToken = pwToken || `mock_token_${Date.now()}`;
      console.log(`[CARDNET BYPASS] [ENTORNO TEST] Token simulado/contingencia detectado: ${persistentToken}`);
    }

    if (pwToken && !isMockToken) {
      try {
        console.log(`[CARDNET] Activando token: ${pwToken} para cliente: ${cardnetCustomerId}`);
        const activateRes = await axios.post(
          `${CARDNET_CONFIG.BASE_URL}/api/Customer/${cardnetCustomerId}/activate`,
          { Token: pwToken, ActivationCode: "" },
          { headers: getCardNetAuthHeaders(), timeout: CARDNET_CONFIG.TIMEOUT }
        );
        
        const custData = activateRes.data.Response || activateRes.data;
        const profiles = custData.PaymentProfiles || [];
        
        // Buscamos coincidencia exacta por token o el último perfil añadido
        const match = profiles.find(p => p.Token === pwToken) || profiles[profiles.length - 1];

        if (match) {
          paymentProfileId = match.PaymentProfileId?.toString();
          persistentToken = match.Token;
          console.log('[CARDNET] OK - Perfil identificado:', paymentProfileId);
        }
      } catch (actErr) {
        console.warn('[CARDNET] Aviso en activación:', actErr.message);
      }

      // Si aún no tenemos el ID del perfil, hacemos un último intento consultando el cliente completo
      if (!paymentProfileId) {
        try {
          const customerRes = await axios.get(
            `${CARDNET_CONFIG.BASE_URL}/api/Customer/${cardnetCustomerId}`,
            { headers: getCardNetAuthHeaders(), timeout: CARDNET_CONFIG.TIMEOUT }
          );
          const fullCust = customerRes.data.Response || customerRes.data;
          const profiles = fullCust.PaymentProfiles || [];
          const match = profiles.find(p => p.Token === pwToken) || profiles[profiles.length - 1];
          if (match) {
            paymentProfileId = match.PaymentProfileId?.toString();
            persistentToken = match.Token;
            console.log('[CARDNET] OK - Perfil recuperado tras consulta:', paymentProfileId);
          }
        } catch (fErr) {
          console.error('[CARDNET] Error crítico: No se pudo obtener el perfil de pago.');
        }
      }
    }

    if (!persistentToken) throw new Error("No se pudo determinar un token de pago válido.");

    // Process initial charge (Full Plan Price + Activation Fee)
    const activationFee = parseFloat(plan.activation_fee || 0);
    const planPrice = parseFloat(plan.price || 0);
    const totalAmount = planPrice + activationFee;
    const finalAmountCents = Math.round(totalAmount * 100);

    console.log(`[CARDNET] Intentando cobro inicial: Plan (RD$ ${planPrice}) + Inscripción (RD$ ${activationFee}) = Total: RD$ ${totalAmount}`);

    let purchaseResult = null;
    let isApproved = false;

    if (isMockToken) {
      isApproved = true;
      purchaseResult = {
        Transaction: {
          Status: "Approved",
          OrderNumber: `CN-MOCK-${Date.now().toString().slice(-6)}`,
          RemoteId: `MOCK-${Date.now().toString().slice(-6)}`,
          Description: "Cobro Simulado por Contingencia"
        },
        ResponseCode: "00"
      };
      console.log("[CARDNET BYPASS] Aprobando cobro inicial simulado automáticamente.");
    } else {
      const purchasePayload = {
        TrxToken: persistentToken,
        Order: `ORD-${Date.now().toString().slice(-6)}`,
        Amount: finalAmountCents,
        Currency: "DOP",
        Capture: true,
        Description: activationFee > 0 
          ? `Inscripción + Primer Mes: ${plan.title}` 
          : `Activación de Plan: ${plan.title}`,
        CustomerIP: req.ip || "127.0.0.1",
        MerchantNumber: CARDNET_CONFIG.MERCHANT_NUMBER,
        MerchantTerminal: CARDNET_CONFIG.TERMINAL_ID,
        DataDo: { Tax: "0", Invoice: `INV-${id.slice(-6)}` }
      };

      console.log('[CARDNET] Payload de Cobro Inicial:', JSON.stringify(purchasePayload, null, 2));

      // --- Robust Charge Logic with Retry & TR005 Bypass ---
      let attempts = 0;
      const maxAttempts = 2;

      while (attempts < maxAttempts && !isApproved) {
        attempts++;
        try {
          console.log(`[CARDNET] Intento de cobro #${attempts} para PLAN: ${plan.title}`);
          const purchaseRes = await axios.post(
            `${CARDNET_CONFIG.BASE_URL}/api/Purchase`,
            purchasePayload,
            { headers: getCardNetAuthHeaders(), timeout: 15000 }
          );

          purchaseResult = purchaseRes.data.Response || purchaseRes.data;
          if (purchaseRes.data.Errors && purchaseRes.data.Errors.length > 0) {
            purchaseResult = {
              ...purchaseResult,
              Errors: purchaseRes.data.Errors,
              ResponseCode: purchaseRes.data.Errors[0].ErrorCode,
              ResponseMessage: purchaseRes.data.Errors[0].Message
            };
          }
          console.log(`[CARDNET] Resultado Intento #${attempts}:`, JSON.stringify(purchaseResult, null, 2));

          isApproved = purchaseResult.Transaction?.Status === "Approved" || 
                       purchaseResult.ResponseCode === "00" ||
                       purchaseResult.Transaction?.Steps?.some(s => s.ResponseCode === "00");

          // Bypass específico para TR005 en Ambiente de Pruebas
          if (!isApproved && !isProductionEnv) {
             const desc = (purchaseResult.ResponseMessage || purchaseResult.Transaction?.Description || "").toUpperCase();
             if (desc.includes("TR005") || purchaseResult.ResponseCode === "TR005") {
                console.log("[CARDNET] Detectado TR005 en Sandbox. Aplicando Bypass de Pruebas.");
                isApproved = true;
             }
          }

          if (!isApproved && attempts < maxAttempts) {
            console.log("[CARDNET] Cobro declinado, reintentando en 1.5s...");
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
        } catch (err) {
          console.error(`[CARDNET] Error en intento #${attempts}:`, err.message);
          if (attempts >= maxAttempts) {
            if (!isProductionEnv) {
              // Aprobación por contingencia de red/servidor caído (solo en pruebas)
              console.warn("[CARDNET] Servidor de CardNet inalcanzable. Aprobando cobro inicial por contingencia local.");
              isApproved = true;
              paymentProfileId = paymentProfileId || `mock_contingency_${Date.now()}`;
              purchaseResult = {
                Transaction: {
                  Status: "Approved",
                  OrderNumber: `CN-CONT-${Date.now().toString().slice(-6)}`,
                  RemoteId: `CONT-${Date.now().toString().slice(-6)}`,
                  Description: "Aprobado por contingencia local (servidor de pruebas caído)"
                },
                ResponseCode: "00"
              };
            } else {
              console.error("[CARDNET] Servidor de CardNet inalcanzable en producción. Abortando cobro y guardado del contrato.");
              throw new Error("No se pudo conectar con CardNet para validar la tarjeta e iniciar la suscripción.");
            }
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }
    }

    if (!isApproved) {
      // CLEANUP: Si el cobro inicial falla, borramos el perfil de pago recién creado en CardNet
      // para evitar dejar tarjetas inválidas vinculadas al cliente.
      if (cardnetCustomerId && paymentProfileId) {
        try {
          console.log(`[CARDNET CLEANUP] Eliminando perfil de pago fallido: ${paymentProfileId} para cliente: ${cardnetCustomerId}`);
          await axios.delete(
            `${CARDNET_CONFIG.BASE_URL}/api/Customer/${cardnetCustomerId}/PaymentProfile/${paymentProfileId}`,
            { headers: getCardNetAuthHeaders(), timeout: CARDNET_CONFIG.TIMEOUT }
          );
          console.log('[CARDNET CLEANUP] Perfil eliminado exitosamente.');
        } catch (delErr) {
          console.error('[CARDNET CLEANUP ERROR] No se pudo eliminar el perfil fallido:', delErr.message);
        }
      }

      throw new Error(`El cobro inicial fue declinado tras ${maxAttempts} intentos: ${purchaseResult?.ResponseMessage || purchaseResult?.Transaction?.Description || "Error de conexión"}`);
    }

    // Save contract
    // Billing Interval: 1 month for PRODUCTION, 2 minutes for TEST
    const today = new Date();
    let nextBilling;
    if (CARDNET_CONFIG.ENV === 'PRODUCTION') {
      nextBilling = new Date(today);
      nextBilling.setMonth(nextBilling.getMonth() + 1); // 1 mes en producción
    } else {
      nextBilling = new Date(today.getTime() + (1000 * 60 * 2)); // 2 minutos en pruebas
    }
    const toLocalSqlString = (d) => {
      const tzOffset = d.getTimezoneOffset() * 60000;
      return new Date(d.getTime() - tzOffset).toISOString().slice(0, 19).replace('T', ' ');
    };
    
    const nextBillingStr = toLocalSqlString(nextBilling);
    const todayStr = toLocalSqlString(today);

    const getClientIp = (req) => {
      // Prioritize IP sent from client-side (fetched via public API)
      if (req.body.ip_address && req.body.ip_address !== 'Cargando...' && req.body.ip_address !== 'undefined') {
        return req.body.ip_address;
      }
      
      const forwarded = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.headers['remote-addr'];
      if (forwarded) {
        return forwarded.split(',')[0].trim();
      }
      return req.ip || req.socket.remoteAddress || '127.0.0.1';
    };

    const clientIp = getClientIp(req);
    const { documentPhoto, selfiePhoto, deviceAgent } = req.body;
    await pool.query(
      'INSERT INTO contracts (id, client_id, plan_id, contract_services, contract_price, contract_promo_services, contract_promo_duration, signature_hash, ip_address, device_agent, geolocation, payment_profile_id, card_token, last_billed_date, next_billing_date, salon_id, status, auto_billing_enabled, document_photo, selfie_photo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id, 
        clientId, 
        planId, 
        JSON.stringify(plan.services || []),
        plan.price,
        JSON.stringify(plan.promo_services || []),
        plan.promo_duration_months || 0,
        signature_hash, 
        clientIp, 
        deviceAgent || req.headers['user-agent'],
        req.body.geolocation || null,
        paymentProfileId, 
        persistentToken, 
        todayStr, 
        nextBillingStr, 
        client.salon_id || 1,
        'Active',
        1,
        documentPhoto || null,
        selfiePhoto || null
      ]
    );

    // LOG INITIAL PAYMENT
    const gatewayRef = purchaseResult?.Transaction?.OrderNumber || purchaseResult?.Transaction?.RemoteId || `CN-${id.slice(-6)}`;
    await pool.query(
      'INSERT INTO payments (id, client_id, plan_id, amount, method, status, gateway_ref, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [`PAY-INIT-${id}`, clientId, planId, totalAmount, 'CardNet_Recurring_Setup', 'Aprobado', gatewayRef, activationFee > 0 ? `Inscripción + Primer Mes: ${plan.title}` : `Activación de Plan: ${plan.title}`]
    );

    // UPDATE CLIENT STATUS TO ACTIVE
    await pool.query('UPDATE clients SET status = "Active" WHERE id = ?', [clientId]);

    // SEND PAYMENT RECEIPT EMAIL
    sendPaymentReceiptEmail(clientId, client.nombre, client.email, totalAmount, activationFee > 0 ? `Inscripción + Primer Mes: ${plan.title}` : `Activación de Plan: ${plan.title}`, gatewayRef);

    res.json({ success: true, paymentProfileId, purchaseResult });
  } catch (err) {
    console.error('Contract processing error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// === RRHH (Staff Records) ===
app.get('/api/rrhh/staff', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM staff_records ORDER BY nombre ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rrhh/staff', async (req, res) => {
  try {
    const { nombre, cedula, contacto, posicion, email, direccion, localidad, fecha_entrada, profile_photo, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos, salon_id } = req.body;
    const [result] = await pool.query(
      'INSERT INTO staff_records (nombre, cedula, contacto, posicion, email, direccion, localidad, fecha_entrada, profile_photo, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos, salon_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        nombre, 
        cedula, 
        contacto, 
        posicion, 
        email || null,
        direccion, 
        localidad, 
        fecha_entrada,
        profile_photo || null,
        hora_entrada || null,
        hora_salida || null,
        dias_laborables || null,
        tolerancia_minutos !== undefined ? tolerancia_minutos : 15,
        salon_id || null
      ]
    );
    res.json({ id: result.insertId, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/rrhh/staff/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, cedula, contacto, posicion, email, direccion, localidad, fecha_entrada, fecha_salida, status, profile_photo, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos, salon_id } = req.body;
    await pool.query(
      'UPDATE staff_records SET nombre=?, cedula=?, contacto=?, posicion=?, email=?, direccion=?, localidad=?, fecha_entrada=?, fecha_salida=?, status=?, profile_photo=?, hora_entrada=?, hora_salida=?, dias_laborables=?, tolerancia_minutos=?, salon_id=? WHERE id=?',
      [
        nombre, 
        cedula, 
        contacto, 
        posicion, 
        email || null,
        direccion, 
        localidad, 
        fecha_entrada, 
        fecha_salida || null, 
        status || 'Activo',
        profile_photo || null,
        hora_entrada || null,
        hora_salida || null,
        dias_laborables || null,
        tolerancia_minutos !== undefined ? tolerancia_minutos : 15,
        salon_id || null,
        id
      ]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Manual Payment & Contract Renewal
app.post('/api/contracts/renew-manual', async (req, res) => {
  try {
    const { clientId, amount, appliedBy, salonId } = req.body;

    // Check if contract exists
    const [contracts] = await pool.query('SELECT * FROM contracts WHERE client_id = ?', [clientId]);
    if (contracts.length === 0) throw new Error('El cliente no tiene un contrato de suscripción válido.');

    const contract = contracts[0];

    // Log payment manually
    const paymentId = `PAY-MANUAL-${Date.now()}`;
    await pool.query(
      'INSERT INTO payments (id, client_id, plan_id, amount, method, status, applied_by, salon_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [paymentId, clientId, contract.plan_id, amount, 'Efectivo/POS', 'Aprobado', appliedBy || 'Sistema', salonId || null]
    );

    // SEND PAYMENT RECEIPT EMAIL
    try {
      const [cRows] = await pool.query('SELECT nombre, email FROM clients WHERE id = ?', [clientId]);
      if (cRows.length > 0 && cRows[0].email) {
        sendPaymentReceiptEmail(clientId, cRows[0].nombre, cRows[0].email, amount, 'Renovación Manual de Suscripción', paymentId);
      }
    } catch (e) {
      console.error('[EMAIL ERROR] Manual renewal receipt failed:', e.message);
    }

    // Standardize to UTC for consistent service counting
    const intervalUnit = CARDNET_CONFIG.ENV === 'PRODUCTION' ? 'MONTH' : 'HOUR';
    await pool.query(
      `UPDATE contracts SET last_billed_date = NOW(), next_billing_date = DATE_ADD(NOW(), INTERVAL 1 ${intervalUnit}), auto_billing_enabled = 1, status = "Active", retry_count = 0 WHERE client_id = ?`,
      [clientId]
    );
    await pool.query('UPDATE clients SET status = "Active" WHERE id = ?', [clientId]);

    const nextDate = new Date();
    nextDate.setMonth(nextDate.getMonth() + 1);
    const nextStr = nextDate.toISOString().slice(0, 19).replace('T', ' ');

    res.json({ success: true, nextBillingStr: nextStr });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === AUTOMATED BILLING WORKER (CRON SIMULATION) ===
app.post('/api/cron/process-subscriptions', async (req, res) => {
  const results = { processed: 0, successful: 0, failed: 0, retries: 0, logs: [] };
  
  try {
    // 1. Fetch contracts due for regular billing OR due for retry
    const [dueContracts] = await pool.query(`
      SELECT c.*, cl.nombre, cl.email, cl.cardnet_customer_id, 
             COALESCE(c.contract_price, p.price) as effective_price,
             p.title as plan_title, p.services as plan_services
      FROM contracts c
      JOIN clients cl ON c.client_id = cl.id
      JOIN plans p ON c.plan_id = p.id
      WHERE (c.status = 'Active' AND c.next_billing_date <= NOW())
         OR (c.status = 'Pending_Retry' AND c.next_retry_date <= NOW() AND c.retry_count < 90)
    `);

    console.log(`[CRON] Processing ${dueContracts.length} contracts for billing/retry...`);

    for (const contract of dueContracts) {
      results.processed++;
      const isRetry = contract.status === 'Pending_Retry';
      
      try {
        // --- ANNUAL RENEWAL LOGIC ---
        let chargeAmount = parseFloat(contract.effective_price);
        let annualFeeApplied = false;
        
        // ANNUAL RENEWAL: Every 365 days from last fee or creation
        const baseDate = contract.last_annual_fee_date || contract.signed_at || contract.created_at;
        const lastAnnual = baseDate ? new Date(baseDate) : new Date();
        const daysSinceAnnual = (new Date() - lastAnnual) / (1000 * 60 * 60 * 24);
        
        if (daysSinceAnnual >= 365) {
          console.log(`[CRON] Aplicando cargo de RENOVACIÓN ANUAL (RD$ 800) para ${contract.nombre}`);
          chargeAmount += 800;
          annualFeeApplied = true;
        }

        const amountCents = Math.round(chargeAmount * 100);
        const purchasePayload = {
          TrxToken: contract.card_token || contract.payment_profile_id || contract.cardnet_profile_id,
          Order: `AUTO-${Date.now().toString().slice(-6)}`,
          Amount: amountCents,
          Currency: "DOP",
          Capture: true,
          Description: annualFeeApplied 
            ? `Mensualidad ${contract.plan_title} + Renovación Anual` 
            : `Mensualidad ${contract.plan_title} (Auto)`,
          CustomerIP: req.ip || "127.0.0.1",
          MerchantNumber: CARDNET_CONFIG.MERCHANT_NUMBER,
          MerchantTerminal: CARDNET_CONFIG.TERMINAL_ID,
          DataDo: { Tax: "0", Invoice: `INV-${Date.now().toString().slice(-6)}` }
        };

        const purchaseRes = await axios.post(
          `${CARDNET_CONFIG.BASE_URL}/api/Purchase`,
          purchasePayload,
          { headers: getCardNetAuthHeaders(), timeout: 15000 }
        );

        const purchaseResult = purchaseRes.data.Response || purchaseRes.data;
        const isApproved = purchaseResult.Transaction?.Status === "Approved" || purchaseResult.ResponseCode === "00";

        if (isApproved) {
          // Success Path
          let servicesToReset = [];
          try {
            servicesToReset = typeof contract.plan_services === 'string' 
              ? JSON.parse(contract.plan_services) 
              : (contract.plan_services || []);
          } catch (e) {
            console.error("[CRON] Error parsing plan services:", e);
          }

          const recurrenceNum = CARDNET_CONFIG.ENV === 'PRODUCTION' ? 1 : 2;
          const recurrenceUnit = CARDNET_CONFIG.ENV === 'PRODUCTION' ? 'MONTH' : 'MINUTE';

          // Update contract and annual fee date if applied
          const updateQuery = annualFeeApplied
            ? `UPDATE contracts SET status = "Active", retry_count = 0, next_retry_date = NULL, last_billed_date = NOW(), next_billing_date = DATE_ADD(NOW(), INTERVAL ${recurrenceNum} ${recurrenceUnit}), last_annual_fee_date = NOW(), contract_services = ? WHERE id = ?`
            : `UPDATE contracts SET status = "Active", retry_count = 0, next_retry_date = NULL, last_billed_date = NOW(), next_billing_date = DATE_ADD(NOW(), INTERVAL ${recurrenceNum} ${recurrenceUnit}), contract_services = ? WHERE id = ?`;

          await pool.query(updateQuery, [JSON.stringify(servicesToReset), contract.id]);
          await pool.query('UPDATE clients SET status = "Active" WHERE id = ?', [contract.client_id]);

          const gatewayRef = purchaseResult?.Transaction?.OrderNumber || purchaseResult?.Transaction?.RemoteId || `AUTO-${contract.id.slice(-4)}`;
          await pool.query(
            'INSERT INTO payments (id, client_id, plan_id, amount, method, status, gateway_ref, description, cardnet_raw_response) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [`PAY-AUTO-${Date.now()}-${contract.id.slice(-4)}`, contract.client_id, contract.plan_id, chargeAmount, 'CardNet_Auto', 'Aprobado', gatewayRef, annualFeeApplied ? `Mensualidad + Renovación Anual: ${contract.plan_title}` : `Cobro Mensual Recurrente: ${contract.plan_title}`, JSON.stringify(purchaseRes.data)]
          );

          // SEND PAYMENT RECEIPT EMAIL
          if (contract.email) {
            sendPaymentReceiptEmail(contract.client_id, contract.nombre, contract.email, chargeAmount, annualFeeApplied ? `Mensualidad + Renovación Anual: ${contract.plan_title}` : `Cobro Mensual Recurrente: ${contract.plan_title}`, gatewayRef);
          }

          results.successful++;
          results.logs.push(`[OK] ${contract.nombre} - ${contract.plan_title}`);
        } else {
          const declineError = new Error(purchaseResult.ResponseMessage || "Declinada");
          declineError.isDecline = true;
          throw declineError;
        }
      } catch (err) {
        // Failure Path
        const errorString = (
          err.message + ' ' + 
          (typeof err.response?.data === 'string' ? err.response.data : JSON.stringify(err.response?.data || ''))
        ).toLowerCase();

        const isSystemError = !err.isDecline && (
                              !err.response || 
                              [429, 500, 502, 503, 504].includes(err.response?.status) || 
                              err.code === 'ECONNABORTED' || 
                              err.code === 'ETIMEDOUT' || 
                              errorString.includes('timeout') ||
                              errorString.includes('network') ||
                              errorString.includes('unconditional drop overload') ||
                              errorString.includes('service unavailable')
        );

        if (isSystemError) {
          const newRetryCount = contract.retry_count + 1;
          let newStatus = 'Pending_Retry';
          if (newRetryCount >= 90) {
            newStatus = 'Suspended';
          }

          console.warn(`[CRON] CardNet System Error charging ${contract.nombre} (Plan: ${contract.plan_title}) - Intento ${newRetryCount}/90: ${err.message}.`);

          const isProductionEnv = CARDNET_CONFIG.ENV === 'PRODUCTION';
          const nextRetrySql = isProductionEnv
            ? `CONCAT(DATE(DATE_ADD(NOW(), INTERVAL 1 DAY)), ' 17:00:00')`
            : `DATE_ADD(NOW(), INTERVAL 2 MINUTE)`;

          // Update contract with new status, increment retry count and schedule next attempt
          await pool.query(
            `UPDATE contracts SET status = ?, retry_count = ?, next_retry_date = ${nextRetrySql} WHERE id = ?`,
            [newStatus, newRetryCount, contract.id]
          );

          // Si el contrato se suspende por exceder reintentos, desactivamos la cuenta del cliente
          if (newRetryCount >= 90) {
            await pool.query('UPDATE clients SET status = "Inactive" WHERE id = ?', [contract.client_id]);
            console.log(`[CRON] Contrato ${contract.id} de ${contract.nombre} SUSPENDIDO por 90 errores de conexión consecutivos. Cliente desactivado.`);
          }

          // Registrar el log del fallo de conexión
          const paymentStatus = newRetryCount >= 90 ? 'Suspendido' : `Error_Conexion - Intento ${newRetryCount}`;
          const paymentDescription = newRetryCount >= 90 
            ? `Contrato Suspendido tras 90 Errores de Conexión CardNet` 
            : `Error de Conexión CardNet (Reintento automático ${newRetryCount}/90 programado)`;

          await pool.query(
            'INSERT INTO payments (id, client_id, plan_id, amount, method, status, description, cardnet_raw_response) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [`PAY-SYS-${Date.now()}-${contract.id.slice(-4)}`, contract.client_id, contract.plan_id, contract.effective_price, 'CardNet_Auto', paymentStatus, paymentDescription, JSON.stringify({ error: err.message, status: err.response?.status, attempt: newRetryCount })]
          );
        } else {
          // Real decline (e.g. Card rejected, insufficient funds, etc.)
          const newRetryCount = contract.retry_count + 1;
          let newStatus = 'Pending_Retry';
          if (newRetryCount >= 90) {
            newStatus = 'Suspended';
          }

          console.warn(`[CRON] CardNet Real Decline charging ${contract.nombre} (Plan: ${contract.plan_title}) - Intento ${newRetryCount}/90: ${err.message}.`);

          const isProductionEnv = CARDNET_CONFIG.ENV === 'PRODUCTION';
          const nextRetrySql = isProductionEnv
            ? `CONCAT(DATE(DATE_ADD(NOW(), INTERVAL 1 DAY)), ' 17:00:00')`
            : `DATE_ADD(NOW(), INTERVAL 2 MINUTE)`;

          await pool.query(
            `UPDATE contracts SET status = ?, retry_count = ?, next_retry_date = ${nextRetrySql} WHERE id = ?`,
            [newStatus, newRetryCount, contract.id]
          );

          // DESACTIVAR AL CLIENTE POR PAGO FALLIDO REAL
          await pool.query('UPDATE clients SET status = "Inactive" WHERE id = ?', [contract.client_id]);

          // Log failed payment attempt with CardNet response
          await pool.query(
            'INSERT INTO payments (id, client_id, plan_id, amount, method, status, description, cardnet_raw_response) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [`PAY-FAIL-${Date.now()}-${contract.id.slice(-4)}`, contract.client_id, contract.plan_id, contract.effective_price, 'CardNet_Auto', `Fallido - Intento ${newRetryCount}`, `Intento Recurrente Fallido: ${contract.plan_title} (Declinado)`, JSON.stringify(err.response?.data || { error: err.message })]
          );

          // NOTIFICAR AL CLIENTE POR EMAIL (solo en el primer intento para evitar spam diario)
          if (contract.email && newRetryCount === 1) {
            sendPaymentFailedEmail(contract.client_id, contract.nombre, contract.email, contract.effective_price, err.message);
          }
        }

        results.failed++;
        if (isRetry) results.retries++;
        results.logs.push(`[FAIL] ${contract.nombre} - ${err.message} (Intento)`);
      }
    }

    res.json(results);
  } catch (err) {
    console.error('[CRON ERROR]', err);
    res.status(500).json({ error: err.message });
  }
});


// === DASHBOARD STATS ===


// === DASHBOARD STATS ===
app.get('/api/dashboard/summary', async (req, res) => {
  try {
    // 1. Visitas de hoy
    const [todayVisits] = await pool.query('SELECT COUNT(*) as count FROM visits WHERE DATE(visited_at) = CURRENT_DATE()');
    
    // 2. Clientes con contrato activo
    const [activeClients] = await pool.query('SELECT COUNT(DISTINCT client_id) as count FROM contracts WHERE status = "Active"');
    
    // 3. Ingresos Mensuales Estimados (Suma de planes activos)
    const [monthlyRevenue] = await pool.query(`
      SELECT SUM(p.price) as total 
      FROM contracts c 
      JOIN plans p ON c.plan_id = p.id 
      WHERE c.status = 'Active'
    `);

    // 4. Ventas Diarias (Suma de pagos hoy)
    const [dailySales] = await pool.query(`
      SELECT SUM(amount) as total
      FROM payments
      WHERE DATE(created_at) = CURRENT_DATE() AND status = 'Aprobado'
    `);

    // 5. Tráfico semanal (Últimos 7 días para el gráfico)
    const [weeklyTraffic] = await pool.query(`
      SELECT DATE(visited_at) as date, COUNT(*) as count 
      FROM visits 
      WHERE visited_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
      GROUP BY DATE(visited_at)
      ORDER BY DATE(visited_at) ASC
    `);

    // 6. Últimas 5 visitas con detalle
    const [recentVisits] = await pool.query(`
      SELECT v.*, s.name as salon_name 
      FROM visits v 
      LEFT JOIN salons s ON v.salon_id = s.id 
      ORDER BY v.visited_at DESC 
      LIMIT 5
    `);

    res.json({
      metrics: {
        todayVisits: todayVisits[0].count,
        activeClients: activeClients[0].count,
        monthlyRevenue: monthlyRevenue[0].total || 0,
        dailySales: dailySales[0].total || 0
      },
      weeklyTraffic,
      recentVisits: recentVisits.map(v => ({
        ...v,
        servicios: typeof v.servicios === 'string' ? JSON.parse(v.servicios) : (v.servicios || [])
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard/plan-usage', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
          p.id AS plan_id,
          p.title AS plan_name,
          p.services AS plan_services,
          COUNT(DISTINCT v.client_id) AS unique_clients_used,
          COUNT(v.id) AS total_visits
      FROM visits v
      JOIN contracts c ON v.client_id = c.client_id
      JOIN plans p ON c.plan_id = p.id
      WHERE MONTH(v.visited_at) = MONTH(CURRENT_DATE())
        AND YEAR(v.visited_at) = YEAR(CURRENT_DATE())
      GROUP BY p.id, p.title, p.services
    `);

    // Parse json services directly for frontend ease
    const parsedRows = rows.map(r => ({
      ...r,
      plan_services: typeof r.plan_services === 'string' ? JSON.parse(r.plan_services) : r.plan_services
    }));

    res.json(parsedRows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard/billing-stats', async (req, res) => {
  try {
    // 1. Ingreso Mensual Estimado (Suma de precios de todos los contratos activos)
    const [incomeRow] = await pool.query(`
      SELECT SUM(p.price) as total_estimated
      FROM contracts c
      JOIN plans p ON c.plan_id = p.id
      WHERE c.auto_billing_enabled = 1
    `);

    // 2. Conteo de suscripciones activas
    const [subRow] = await pool.query('SELECT COUNT(*) as active_count FROM contracts WHERE auto_billing_enabled = 1');

    // 3. Último cobro automático
    const [lastAutoRow] = await pool.query(`
      SELECT created_at 
      FROM payments 
      WHERE method = 'CardNet_Auto' 
      ORDER BY created_at DESC 
      LIMIT 1
    `);

    // 4. Historial de transacciones (últimas 20)
    const [recentPayments] = await pool.query(`
      SELECT p.*, c.nombre as client_name
      FROM payments p
      LEFT JOIN clients c ON p.client_id = c.id
      ORDER BY p.created_at DESC
      LIMIT 20
    `);

    // 5. Total Pagos Aprobados (Histórico)
    const [approvedRow] = await pool.query("SELECT SUM(amount) as total FROM payments WHERE status = 'Aprobado'");

    // 6. Total Pagos Fallidos (Histórico)
    const [failedRow] = await pool.query("SELECT COUNT(*) as count FROM payments WHERE status LIKE 'Fallido%'");

    res.json({
      totalEstimated: incomeRow[0].total_estimated || 0,
      totalApproved: approvedRow[0].total || 0,
      totalFailedCount: failedRow[0].count || 0,
      activeSubscriptions: subRow[0].active_count || 0,
      lastAutoBilling: lastAutoRow[0]?.created_at || null,
      recentPayments
    });
  } catch (err) {
    console.error('Billing stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

// === APPOINTMENTS ===
app.post('/api/appointments', async (req, res) => {
  try {
    const id = `APT-${Date.now()}`;
    const { clientId, date, time, services } = req.body;
    await pool.query(
      'INSERT INTO appointments (id, client_id, date, time, services) VALUES (?, ?, ?, ?, ?)',
      [id, clientId, date, time, JSON.stringify(services)]
    );
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === PAYMENTS ===
app.post('/api/payments', async (req, res) => {
  try {
    const id = `PAY-${Date.now()}`;
    const { clientId, planId, amount, method, appliedBy, salonId } = req.body;
    await pool.query(
      'INSERT INTO payments (id, client_id, plan_id, amount, method, status, applied_by, salon_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, clientId, planId, amount, method || 'Tarjeta', 'Aprobado', appliedBy || 'Sistema', salonId || null]
    );
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/payments/client/:clientId', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM payments WHERE client_id = ? ORDER BY created_at DESC', [req.params.clientId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === EMPLOYEES (Fetched from RRHH staff_records) ===
app.get('/api/employees', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        id, 
        nombre, 
        posicion as rol, 
        status,
        profile_photo,
        hora_entrada,
        hora_salida,
        dias_laborables,
        tolerancia_minutos,
        salon_id
      FROM staff_records 
      WHERE status = 'Activo' OR status = 'Active'
      ORDER BY nombre ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error('[EMPLOYEES FETCH ERROR]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/employees', async (req, res) => {
  try {
    const id = Date.now().toString();
    const { nombre, rol } = req.body;
    await pool.query(
      'INSERT INTO employees (id, nombre, rol) VALUES (?, ?, ?)',
      [id, nombre, rol]
    );
    res.json({ id, nombre, rol });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === ROLES & PERMISSIONS ===
app.get('/api/roles', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM roles');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/roles', async (req, res) => {
  try {
    const { nombre, permisos } = req.body;
    // Aseguramos que permisos sea un objeto válido antes de stringify
    const safePerms = permisos || {};
    const [result] = await pool.query(
      'INSERT INTO roles (nombre, permisos) VALUES (?, ?)',
      [nombre, JSON.stringify(safePerms)]
    );
    res.json({ success: true, id: result.insertId, nombre, permisos: safePerms });
  } catch (err) {
    console.error('[ROLES ERROR]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/roles/:id', async (req, res) => {
  try {
    const { nombre, permisos } = req.body;
    await pool.query(
      'UPDATE roles SET nombre = ?, permisos = ? WHERE id = ?',
      [nombre, JSON.stringify(permisos), req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === USERS (SYSTEM STAFF) ===
app.get('/api/users', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT u.id, u.nombre, u.email, u.role_id, u.salon_id, u.profile_photo, u.hora_entrada, u.hora_salida, u.dias_laborables, u.tolerancia_minutos, r.nombre as role_name, r.permisos 
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const { nombre, email, password, role_id, tipo, salon_id, profile_photo, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos } = req.body;
    
    if (!nombre || !email || !password) {
      return res.status(400).json({ error: 'Nombre, email y contraseña son requeridos.' });
    }

    const id = Date.now().toString();

    await pool.query(
      'INSERT INTO users (id, nombre, email, password, role_id, tipo, salon_id, profile_photo, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        nombre, 
        email, 
        password, 
        role_id || null, 
        tipo || 'employee',
        salon_id || null, // NULL significa Global
        profile_photo || null,
        hora_entrada || null,
        hora_salida || null,
        dias_laborables || null,
        tolerancia_minutos !== undefined ? tolerancia_minutos : 15
      ]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[USERS CREATE ERROR] Full Stack:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id', async (req, res) => {
  try {
    const { nombre, email, password, role_id, profile_photo, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos } = req.body;
    await pool.query(
      'UPDATE users SET nombre = ?, email = ?, password = ?, role_id = ?, profile_photo = ?, hora_entrada = ?, hora_salida = ?, dias_laborables = ?, tolerancia_minutos = ? WHERE id = ?',
      [
        nombre, 
        email, 
        password, 
        role_id, 
        profile_photo || null, 
        hora_entrada || null,
        hora_salida || null,
        dias_laborables || null,
        tolerancia_minutos !== undefined ? tolerancia_minutos : 15,
        req.params.id
      ]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/verify', async (req, res) => {
  try {
    const { id, password } = req.body;
    if (!id || !password) {
      return res.status(400).json({ error: 'ID y contraseña son requeridos.' });
    }
    
    const [rows] = await pool.query('SELECT password FROM users WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }
    
    const matches = (password === rows[0].password);
    res.json({ success: matches });
  } catch (err) {
    console.error('[USERS VERIFY ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// === DATABASE AUTHENTICATION ===
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email: rawEmail, password } = req.body;
    const email = rawEmail ? String(rawEmail).trim() : '';

    // Check system users first
    const [users] = await pool.query(`
      SELECT u.*, r.nombre as role_name, r.permisos 
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.email = ? AND u.password = ? AND u.tipo != 'client'
    `, [email, password]);

    if (users.length > 0) {
      const user = users[0];
      await pool.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
      return res.json({
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        role: user.role_name === 'Administrador' ? 'admin' : 'employee',
        role_id: user.role_id,
        role_name: user.role_name,
        salon_id: user.salon_id,
        permissions: typeof user.permisos === 'string' ? JSON.parse(user.permisos) : user.permisos
      });
    }

    // Check if it's a client login (using email or cedula)
    const [clients] = await pool.query('SELECT * FROM clients WHERE (email = ? OR cedula = ?) AND password = ?', [email, email, password]);
    if (clients.length > 0) {
      const client = clients[0];
      return res.json({
        id: client.id,
        nombre: client.nombre,
        email: client.email,
        cedula: client.cedula,
        role: 'client',
        mustChangePassword: client.must_change_password === 1
      });
    }

    res.status(401).json({ error: 'Credenciales inválidas' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clients/change-password', async (req, res) => {
  const { clientId, currentPassword, newPassword } = req.body;
  try {
    const [clients] = await pool.query('SELECT password FROM clients WHERE id = ?', [clientId]);
    if (clients.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
    
    if (clients[0].password !== currentPassword) {
      return res.status(401).json({ error: 'La contraseña actual es incorrecta' });
    }

    await pool.query('UPDATE clients SET password = ?, must_change_password = 0 WHERE id = ?', [newPassword, clientId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/employees/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM employees WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/gifts/purchase', async (req, res) => {
  try {
    const { clientId, amount, details, pwToken } = req.body;
    
    let persistentToken = pwToken;
    const [clients] = await pool.query('SELECT * FROM clients WHERE id = ?', [clientId]);
    const client = clients[0];
    const cardnetCustomerId = client?.cardnet_customer_id;

    if (pwToken && !String(pwToken).startsWith('mock_')) {
      if (cardnetCustomerId) {
        try {
          console.log(`[CARDNET GIFT] Activando token: ${pwToken} para cliente: ${cardnetCustomerId}`);
          const activateRes = await axios.post(
            `${CARDNET_CONFIG.BASE_URL}/api/Customer/${cardnetCustomerId}/activate`,
            { Token: pwToken, ActivationCode: "" },
            { headers: getCardNetAuthHeaders(), timeout: CARDNET_CONFIG.TIMEOUT }
          );
          
          const custData = activateRes.data.Response || activateRes.data;
          const profiles = custData.PaymentProfiles || [];
          
          // Buscamos coincidencia exacta por token o el último perfil añadido
          const match = profiles.find(p => p.Token === pwToken) || profiles[profiles.length - 1];

          if (match) {
            persistentToken = match.Token;
            console.log('[CARDNET GIFT] Token activado y resuelto con éxito:', match.PaymentProfileId?.toString());
            
            // Opcional: También guardarlo en contracts si no tiene tarjeta activa
            await pool.query(
              'UPDATE contracts SET payment_profile_id = ?, card_token = ? WHERE client_id = ?',
              [match.PaymentProfileId?.toString(), match.Token, clientId]
            );
          }
        } catch (actErr) {
          console.warn('[CARDNET GIFT] Aviso en activación:', actErr.message);
        }
      }
    }

    if (!persistentToken) {
      if (!client) throw new Error('Client not found');
      
      if (!cardnetCustomerId) {
        return res.status(400).json({ error: 'NoSavedCard', message: 'No hay tarjeta guardada.' });
      }

      const [contracts] = await pool.query('SELECT card_token FROM contracts WHERE client_id = ? AND card_token IS NOT NULL ORDER BY signed_at DESC LIMIT 1', [clientId]);
      if (contracts.length > 0 && contracts[0].card_token) {
        persistentToken = contracts[0].card_token;
      } else {
        // Intenta sacar de CardNet
        try {
          const customerRes = await axios.get(
            `${CARDNET_CONFIG.BASE_URL}/api/Customer/${cardnetCustomerId}`,
            { headers: getCardNetAuthHeaders() }
          );
          const fullCust = customerRes.data.Response || customerRes.data;
          const profiles = fullCust.PaymentProfiles || [];
          if (profiles.length > 0) {
            const activeProfile = profiles.find(p => p.Enabled) || profiles[0];
            persistentToken = activeProfile.Token;
          }
        } catch (e) {
          console.error("Error consultando perfiles en CardNet:", e.message);
        }
      }
    }

    if (!persistentToken) {
      return res.status(400).json({ error: 'NoSavedCard', message: 'No se encontró un token válido para cobrar.' });
    }

    // Aseguramos que el token sea solo el string del TokenId
    let cleanToken = persistentToken;
    if (typeof persistentToken === 'object' && persistentToken.TokenId) {
      cleanToken = persistentToken.TokenId;
    } else if (typeof persistentToken === 'string' && persistentToken.startsWith('{')) {
      try {
        const parsed = JSON.parse(persistentToken);
        cleanToken = parsed.TokenId || persistentToken;
      } catch (e) {}
    }

    const finalAmountCents = Math.round(parseFloat(amount) * 100);

    const purchasePayload = {
      TrxToken: cleanToken,
      Order: `INIT-${Date.now().toString().slice(-6)}`,
      Amount: finalAmountCents,
      Currency: "DOP",
      Capture: true,
      Description: `Activación GiftCard + RD$ 800 Fee`,
      CustomerIP: req.ip || "127.0.0.1",
      MerchantNumber: CARDNET_CONFIG.MERCHANT_NUMBER,
      MerchantTerminal: CARDNET_CONFIG.TERMINAL_ID,
      DataDo: { Tax: "0", Invoice: `INV-${Date.now().toString().slice(-6)}` }
    };

    console.log('[CARDNET] Cobro GiftCard:', purchasePayload);

    const purchaseRes = await axios.post(
      `${CARDNET_CONFIG.BASE_URL}/api/Purchase`,
      purchasePayload,
      { headers: getCardNetAuthHeaders() }
    );

    console.log('[CARDNET] Respuesta de compra de regalo:', JSON.stringify(purchaseRes.data, null, 2));

    const purchaseResult = purchaseRes.data.Response || purchaseRes.data;
    const isProductionEnv = CARDNET_CONFIG.ENV === 'PRODUCTION';
    const isApproved = purchaseResult.Transaction?.Status === "Approved" || 
                       purchaseResult.ResponseCode === "00" ||
                       purchaseResult.Transaction?.Steps?.some(s => s.ResponseCode === "00") ||
                       (!isProductionEnv && ((purchaseResult.ResponseMessage || purchaseResult.Transaction?.Description || "").toUpperCase().includes("TR005") || purchaseResult.ResponseCode === "TR005")); 

    if (!isApproved) {
       throw new Error(`Tarjeta declinada: ${purchaseResult?.ResponseMessage || purchaseResult?.Transaction?.Description || "Error de conexión"}`);
    }

    const giftCode = `GIFT-${Math.floor(100000 + Math.random() * 899999)}`;
    const paymentId = `PAY-GIFT-${Date.now()}`;
    
    // Save payment
    const gatewayRef = purchaseResult?.Transaction?.OrderNumber || purchaseResult?.Transaction?.RemoteId || `GIFT-${Date.now().toString().slice(-6)}`;
    await pool.query(
      'INSERT INTO payments (id, client_id, plan_id, amount, method, status, gateway_ref, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [paymentId, clientId, 'gift_card', amount, 'CardNet_Saved_Card', 'Aprobado', gatewayRef, `Compra de GiftCard para: ${details?.to || 'Invitado'}`]
    );

    // Save gift card record
    await pool.query(
      'INSERT INTO gift_cards (code, amount, balance, client_id, recipient_name, status) VALUES (?, ?, ?, ?, ?, ?)',
      [giftCode, amount, amount, clientId, details?.to || 'Invitado', 'Active']
    );

    res.json({ success: true, paymentId, giftCode });

  } catch (err) {
    console.error('Gift purchase error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoints for Gift Cards
app.get('/api/admin/gifts', async (req, res) => {
  try {
    const [cards] = await pool.query(`
      SELECT g.*, c.nombre as purchaser_name 
      FROM gift_cards g 
      LEFT JOIN clients c ON g.client_id = c.id 
      ORDER BY g.created_at DESC
    `);
    res.json(cards);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/gifts/:id/logs', async (req, res) => {
  try {
    const [logs] = await pool.query(
      'SELECT * FROM gift_card_logs WHERE gift_card_id = ? ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/gifts/redeem', async (req, res) => {
  const { code, amount } = req.body;
  try {
    const [cards] = await pool.query('SELECT * FROM gift_cards WHERE code = ?', [code]);
    if (cards.length === 0) return res.status(404).json({ error: 'Código no encontrado' });
    
    const card = cards[0];
    if (card.status !== 'Active' && card.status !== 'Partially_Redeemed') {
      return res.status(400).json({ error: 'Esta tarjeta no está activa' });
    }
    
    if (Number(card.balance) < Number(amount)) {
      return res.status(400).json({ error: 'Saldo insuficiente' });
    }
    
    const newBalance = Number(card.balance) - Number(amount);
    const newStatus = newBalance <= 0 ? 'Redeemed' : 'Partially_Redeemed';
    
    await pool.query(
      'UPDATE gift_cards SET balance = ?, status = ? WHERE code = ?',
      [newBalance, newStatus, code]
    );

    // Record consumption history log
    await pool.query(
      'INSERT INTO gift_card_logs (gift_card_id, amount_redeemed, balance_before, balance_after) VALUES (?, ?, ?, ?)',
      [card.id, amount, card.balance, newBalance]
    );
    
    res.json({ success: true, newBalance, status: newStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public/Client Gift Card access
app.get('/api/gifts', async (req, res) => {
  const { clientId, code } = req.query;
  try {
    let query = 'SELECT * FROM gift_cards';
    let params = [];
    if (clientId) {
      query += ' WHERE client_id = ?';
      params.push(clientId);
    } else if (code) {
      query += ' WHERE code = ?';
      params.push(code);
    }
    query += ' ORDER BY created_at DESC';
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/gifts/send-email', async (req, res) => {
  const { recipientEmail, giftDetails, giftCode } = req.body;
  
  try {
    const [settings] = await pool.query('SELECT * FROM email_settings LIMIT 1');
    if (settings.length === 0) {
      console.error('[EMAIL ERROR] No email configuration in database');
      return res.status(400).json({ error: 'Email configuration missing' });
    }
    
    const s = settings[0];
    const transporter = nodemailer.createTransport({
      host: s.smtp_host, port: s.smtp_port, secure: s.smtp_port == 465,
      auth: { user: s.smtp_user, pass: s.smtp_pass }
    });

    const fs = require('fs');
    const path = require('path');
    
    // Check multiple possible paths for the art
    const possiblePaths = [
      path.join(__dirname, '../public/gift_card_art.jpg'),
      path.join(__dirname, 'public/gift_card_art.jpg'),
      path.join(__dirname, '../dist/gift_card_art.jpg')
    ];
    
    let artPath = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        artPath = p;
        break;
      }
    }

    if (!artPath) {
      console.error('[EMAIL ERROR] Gift card art not found in:', possiblePaths);
      // We send anyway without attachment if art is missing, or return error
      // Better to return error if it's crucial
    }

    const attachments = artPath ? [{
      filename: 'gift-card.jpg',
      path: artPath,
      cid: 'giftcard'
    }] : [];

    await transporter.sendMail({
      from: `"${s.smtp_from || 'Abatte Peluquería'}" <${s.smtp_user}>`,
      to: recipientEmail,
      subject: `¡Un Regalo de Abatte Peluquería para ti! 🎁`,
      attachments,
      html: `
        <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: auto; padding: 40px; text-align: center; background-color: #ffffff;">
          <h1 style="color: #09090b; margin: 0 0 40px 0; font-size: 24px; font-weight: 900;">¡Has recibido un Regalo Especial!</h1>
          
          <!-- Contenedor de la Tarjeta (Simula la vista del Dashboard) -->
          <div style="display: inline-block; width: 450px; height: 554px; ${artPath ? "background-image: url('cid:giftcard');" : "background-color: #f1f5f9;"} background-size: 450px 554px; background-repeat: no-repeat; border-radius: 30px; box-shadow: 0 20px 40px rgba(0,0,0,0.2); position: relative; text-align: left; overflow: hidden;">
            
            <!-- Código (Esquina Superior Derecha) -->
            <div style="padding: 22px 28px 0 0; text-align: right;">
              <span style="background: rgba(255,255,255,0.9); padding: 6px 12px; border-radius: 10px; font-family: monospace; font-size: 11px; font-weight: 900; color: #d4af37; border: 1px solid rgba(212,175,55,0.3);">
                ID: ${giftCode}
              </span>
            </div>

            <!-- Espaciado para bajar al área de datos del diseño -->
            <div style="height: 395px;"></div>

            <!-- Área de Monto -->
            <div style="padding-left: 260px; height: 40px; line-height: 40px; font-size: 24px; font-weight: 900; color: #d97d8b;">
              ${giftDetails.m}
            </div>

            <!-- Área de De/Para (Fila Inferior) -->
            <div style="height: 50px; padding-top: 5px;">
               <table width="100%" border="0" cellpadding="0" cellspacing="0">
                 <tr>
                   <td width="95"></td>
                   <td width="125" align="center" style="font-size: 14px; font-weight: 700; color: #164e25; font-style: italic; font-family: 'Georgia', serif;">
                     ${giftDetails.from || ''}
                   </td>
                   <td width="55"></td>
                   <td width="125" align="center" style="font-size: 14px; font-weight: 700; color: #164e25; font-style: italic; font-family: 'Georgia', serif;">
                     ${giftDetails.to || ''}
                   </td>
                   <td width="50"></td>
                 </tr>
               </table>
            </div>
          </div>

          <div style="margin-top: 50px; padding: 0 20px;">
            <p style="color: #475569; font-size: 1.1rem; line-height: 1.6; margin-bottom: 10px;">
              ¡Hola! <strong>${giftDetails.from || 'Alguien'}</strong> quiere que te consientas.
            </p>
            <p style="color: #64748b; font-size: 0.95rem; line-height: 1.6;">
              Visítanos en nuestra sucursal de la <strong>Av. San Vicente de Paul (Plaza El Poder)</strong> y presenta el código de tu tarjeta para redimir tu regalo.
            </p>
          </div>
          
          <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 40px 0;" />
          <p style="font-size: 0.8rem; color: #94a3b8;">
            <strong>Abatte Peluquería</strong><br/>
            Belleza que Inspira
          </p>
        </div>
      `
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Email gift error detailed:', {
      message: err.message,
      code: err.code,
      command: err.command,
      stack: err.stack
    });
    res.status(500).json({ error: 'Error enviando el correo', details: err.message });
  }
});

// === AUTOMATED SCHEDULER (Internal Cron) ===
// Iniciar ciclo de cobro automático
let lastBirthdaySentDate = null; // Track last date birthday emails were sent (YYYY-MM-DD)

const startInternalScheduler = () => {
  // En producción, ejecutamos la revisión cada 1 hora; en pruebas cada 2 minutos
  const checkInterval = CARDNET_CONFIG.ENV === 'PRODUCTION' 
    ? 1000 * 60 * 60 * 1  // 1 hora en producción
    : 1000 * 60 * 2;      // 2 minutos en pruebas
  
  console.log(`[SCHEDULER] Iniciando ciclo cada ${checkInterval / 1000 / 60} minutos (Modo: ${CARDNET_CONFIG.ENV})`);
  
  setInterval(async () => {
    const now = new Date();
    console.log(`[SCHEDULER] Triggering billing process at ${now.toLocaleString()}...`);
    const port = process.env.PORT || 5005;
    
    // 1. Process plan billing/subscriptions
    try {
      await axios.post(`http://localhost:${port}/api/cron/process-subscriptions`);
      console.log('[SCHEDULER] Billing process completed successfully.');
    } catch (err) {
      console.error('[SCHEDULER] Billing process failed:', err.message);
    }

    // 2. Process automated birthday greetings (runs once daily)
    try {
      // Get today's date in DR format (taking local timezone offset)
      const drTime = new Date(new Date().getTime() - (4 * 60 * 60 * 1000)); // Dominican Republic is UTC-4
      const todayStr = drTime.toISOString().split('T')[0];
      
      if (lastBirthdaySentDate !== todayStr) {
        console.log(`[SCHEDULER] Triggering daily automated birthday emails for: ${todayStr}...`);
        const bRes = await axios.post(`http://localhost:${port}/api/marketing/send-daily-birthdays`);
        if (bRes.data && bRes.data.success) {
          lastBirthdaySentDate = todayStr;
          console.log(`[SCHEDULER] Daily automated birthdays processed. Sent: ${bRes.data.sent}`);
        }
      }
    } catch (err) {
      console.error('[SCHEDULER] Daily automated birthdays failed:', err.message);
    }
  }, checkInterval); 
};

// Utility endpoint for Certification Testing
app.post('/api/test/force-retry', async (req, res) => {
  const { clientId } = req.body;
  try {
    const [result] = await pool.query(
      "UPDATE contracts SET status = 'Pending_Retry', retry_count = 1, next_retry_date = DATE_SUB(NOW(), INTERVAL 5 MINUTE) WHERE client_id = ?",
      [clientId]
    );
    res.json({ success: true, message: `Contrato ${clientId} listo para reintento.`, affectedRows: result.affectedRows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para cobro manual AD-HOC (Para pruebas de certificación)
app.post('/api/test/manual-charge', async (req, res) => {
  const { clientId, amount } = req.body;
  console.log(`[TEST] Recibida petición de cobro manual: Cliente ${clientId}, Monto ${amount}`);
  try {
    // 1. Buscar token del cliente
    const [contracts] = await pool.query(
      "SELECT card_token, id FROM contracts WHERE client_id = ? AND status = 'Active' LIMIT 1",
      [clientId]
    );

    if (!contracts[0]?.card_token) {
      console.log(`[TEST] Error: No se encontró token activo para el cliente ${clientId}`);
      return res.status(404).json({ error: "No se encontró un token de tarjeta activo para este cliente." });
    }

    const token = contracts[0].card_token;
    console.log(`[TEST] Token encontrado: ${token.substring(0, 10)}...`);
    
    // VALIDACIÓN DE MONTO: Asegurar que sea un número válido y positivo
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: "El monto debe ser un número válido mayor a 0." });
    }
    const amountCents = Math.round(parsedAmount * 100);

    // 2. Ejecutar cobro en CardNet
    const purchasePayload = {
      TrxToken: token,
      Order: `TEST-${Date.now().toString().slice(-6)}`,
      Amount: amountCents,
      Currency: "DOP",
      Capture: true,
      Description: `Cobro de Prueba Manual RD$ ${amount}`,
      CustomerIP: req.ip || "127.0.0.1",
      MerchantNumber: CARDNET_CONFIG.MERCHANT_NUMBER,
      MerchantTerminal: CARDNET_CONFIG.TERMINAL_ID,
      DataDo: { Tax: "0", Invoice: `INV-${Date.now().toString().slice(-6)}` }
    };

    console.log(`[TEST] Enviando petición a CardNet...`);
    const purchaseRes = await axios.post(
      `${CARDNET_CONFIG.BASE_URL}/api/Purchase`,
      purchasePayload,
      { headers: getCardNetAuthHeaders() }
    );
    console.log(`[TEST] Respuesta recibida de CardNet.`);

    res.json({
      success: purchaseRes.data.Response?.Transaction?.Status === "Approved" || purchaseRes.data.ResponseCode === "00",
      cardnet_response: purchaseRes.data,
      message: "Respuesta recibida de CardNet"
    });

    // Guardar también este cobro manual en la DB para tener historial de pruebas
    await pool.query(
      'INSERT INTO payments (id, client_id, amount, method, status, gateway_ref, description, cardnet_raw_response) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [`PAY-TEST-${Date.now()}`, clientId, amount, 'CardNet_Manual_Test', 'Test', purchasePayload.Order, 'Prueba Manual de Certificación', JSON.stringify(purchaseRes.data)]
    );

  } catch (err) {
    console.error("[TEST] Error en cobro manual:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Listar clientes para pruebas
app.get('/api/test/clients', async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT id, nombre, email, cardnet_customer_id FROM clients");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === MARKETING ROUTES ===

// === MARKETING LOGGER & TRACKING ===

const logSentEmailAndGetPixel = async (req, clientId, emailType, recipientEmail, subject) => {
  try {
    const [res] = await pool.query(
      'INSERT INTO email_logs (client_id, email_type, recipient_email, subject) VALUES (?, ?, ?, ?)',
      [clientId || null, emailType, recipientEmail, subject]
    );
    const emailLogId = res.insertId;
    const host = req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const pixelUrl = `${protocol}://${host}/api/marketing/track-open/${emailLogId}`;
    return `<img src="${pixelUrl}" width="1" height="1" style="display:none;" />`;
  } catch (err) {
    console.error('[EMAIL LOG] Error logging sent email:', err);
    return '';
  }
};

app.get('/api/marketing/track-open/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      'UPDATE email_logs SET opened = 1, opened_at = CURRENT_TIMESTAMP WHERE id = ? AND opened = 0',
      [id]
    );
  } catch (err) {
    console.error('[EMAIL TRACK] Error updating tracking state:', err.message);
  }
  const buf = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.writeHead(200, {
    'Content-Type': 'image/gif',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate, private'
  });
  res.end(buf);
});

app.get('/api/marketing/stats', async (req, res) => {
  try {
    // Get all emails sent this month
    const [sentRows] = await pool.query(`
      SELECT COUNT(*) as total 
      FROM email_logs 
      WHERE MONTH(sent_at) = MONTH(NOW()) AND YEAR(sent_at) = YEAR(NOW())
    `);
    const totalSent = sentRows[0]?.total || 0;

    // Get all opened emails this month
    const [openedRows] = await pool.query(`
      SELECT COUNT(*) as total 
      FROM email_logs 
      WHERE opened = 1 AND MONTH(sent_at) = MONTH(NOW()) AND YEAR(sent_at) = YEAR(NOW())
    `);
    const totalOpened = openedRows[0]?.total || 0;

    const openRate = totalSent > 0 ? Math.round((totalOpened / totalSent) * 100) : 0;

    res.json({
      success: true,
      totalSent,
      openRate
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/marketing/send-mass', async (req, res) => {
  const { subject, template, campaignType, flyerUrl } = req.body;
  try {
    const [clients] = await pool.query(`
      SELECT c.id, c.email, c.nombre, s.name as salon_name, s.address as salon_address 
      FROM clients c
      LEFT JOIN salons s ON c.salon_id = s.id
      WHERE c.email IS NOT NULL AND c.email != ''
    `);
    const [settings] = await pool.query('SELECT * FROM email_settings LIMIT 1');
    
    if (settings.length === 0) throw new Error("No hay configuración de correo.");
    const s = settings[0];

    const flyerPath = getCampaignFlyerPath();
    const attachments = [];
    let imageSrc = null;

    if (campaignType === 'image') {
      if (flyerPath) {
        const path = require('path');
        attachments.push({
          filename: path.basename(flyerPath),
          path: flyerPath,
          cid: 'campaignflyer',
          contentType: getMimeType(flyerPath),
          disposition: 'inline'
        });
        imageSrc = 'cid:campaignflyer';
      } else if (flyerUrl) {
        imageSrc = getAbsoluteFlyerUrl(req, flyerUrl);
      }
    }

    const transporter = nodemailer.createTransport({
      host: s.smtp_host, port: s.smtp_port, secure: s.smtp_port == 465,
      auth: { user: s.smtp_user, pass: s.smtp_pass }
    });

    let sent = 0;
    for (const client of clients) {
      // Add a small delay to prevent SMTP spam triggers (1.5 seconds)
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const body = template ? template.replace(/\{\{nombre\}\}/g, client.nombre) : '';
      const trackingPixel = await logSentEmailAndGetPixel(req, client.id, 'massive', client.email, subject);
      
      try {
        await transporter.sendMail({
          from: `"${s.smtp_from || 'PLAN BEAUTY'}" <${s.smtp_user}>`,
          to: client.email,
          subject: subject,
          text: campaignType === 'image' ? `Hola ${client.nombre}, te enviamos una nueva promoción. Abre el correo para ver los detalles.` : body,
          attachments: attachments,
          html: campaignType === 'image' && imageSrc ? `
            <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f9f9f9; padding: 40px 15px; text-align: center;">
              <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 15px 35px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; padding: 0; box-sizing: border-box; text-align: left;">
                <!-- Personal Greeting -->
                <div style="padding: 35px 30px 20px 30px;">
                  <h2 style="margin: 0; color: #000000; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 22px; font-weight: 800; text-align: left; letter-spacing: -0.5px;">
                    ¡Hola ${client.nombre}!
                  </h2>
                </div>

                <!-- Full width / Responsive Flyer -->
                <div style="display: block; width: 100%; text-align: center;">
                  <img src="${imageSrc}" alt="Promoción" style="width: 100%; max-width: 100%; height: auto; display: block; margin: 0 auto; border: none;" />
                </div>
                
                <!-- Simple Elegant Footer -->
                <div style="padding: 30px 20px; text-align: center; border-top: 1px solid #eeeeee;">
                  <p style="margin: 0; font-size: 14px; font-weight: 700; color: #000000;">${client.salon_name || 'Abatte Peluquería'}</p>
                  <p style="margin: 5px 0 0 0; font-size: 12px; color: #666666;">
                    ${client.salon_address || 'Av. San Vicente de Paúl, Santo Domingo Este.'}
                  </p>
                  <p style="margin: 20px 0 0 0; font-size: 10px; color: #999999; text-transform: uppercase; letter-spacing: 1px; line-height: 1.5;">
                    Si no desea recibir estos correos, <a href="#" style="color: #999999; text-decoration: underline;">cancele su suscripción aquí</a>.
                  </p>
                  <p style="margin: 10px 0 0 0; font-size: 9px; color: #bcaaa4; text-transform: uppercase; letter-spacing: 1px;">
                    © 2026 PLAN BEAUTY RD. TU PLAN, TU BELLEZA.
                  </p>
                </div>
              </div>
            </div>
            ${trackingPixel}
          ` : `
            <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f9f9f9; padding: 40px 0;">
              <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
                <!-- Header -->
                <div style="background-color: #000000; padding: 30px; text-align: center;">
                  <h1 style="color: #ffffff; margin: 0; font-size: 24px; letter-spacing: 2px; font-weight: 900;">
                    PLAN<span style="color: #d4af37;">BEAUTY</span>RD
                  </h1>
                  <p style="color: #d4af37; margin: 5px 0 0 0; font-size: 10px; text-transform: uppercase; letter-spacing: 3px; font-weight: 700;">
                    TU PLAN, TU BELLEZA
                  </p>
                </div>
                
                <!-- Content -->
                <div style="padding: 40px 30px; line-height: 1.8; color: #333333;">
                  <h2 style="margin-top: 0; color: #000000; font-size: 20px;">¡Hola ${client.nombre}!</h2>
                  <p style="font-size: 16px;">${body.replace(/\n/g, '<br>')}</p>
                </div>
                
                <!-- Footer -->
                <div style="background-color: #f1f1f1; padding: 30px; text-align: center; border-top: 1px solid #eeeeee;">
                  <p style="margin: 0; font-size: 14px; font-weight: 700; color: #000000;">${client.salon_name || 'Abatte Peluquería San Vicente'}</p>
                  <p style="margin: 5px 0; font-size: 12px; color: #666666;">
                    ${client.salon_address || 'Av. San Vicente de Paúl, Santo Domingo, República Dominicana'}
                  </p>
                  <div style="margin-top: 20px;">
                    <a href="https://planbeautyrd.com" style="color: #000000; text-decoration: none; font-size: 12px; font-weight: 700; margin: 0 10px;">Sitio Web</a>
                    <span style="color: #cccccc;">|</span>
                    <a href="#" style="color: #000000; text-decoration: none; font-size: 12px; font-weight: 700; margin: 0 10px;">Instagram</a>
                  </div>
                  <p style="margin-top: 30px; font-size: 10px; color: #999999; text-transform: uppercase; letter-spacing: 1px;">
                    © 2026 PLAN BEAUTY RD. TODOS LOS DERECHOS RESERVADOS.
                  </p>
                </div>
              </div>
            </div>
            ${trackingPixel}
          `
        });
        sent++;
      } catch (e) {
        console.error(`Error enviando a ${client.email}:`, e.message);
      }
    }

    res.json({ success: true, sent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === UPLOAD BIRTHDAY FLYER ===
app.post('/api/marketing/upload-flyer', async (req, res) => {
  try {
    const { base64Data, fileName } = req.body;
    if (!base64Data) {
      return res.status(400).json({ error: 'No se recibió ninguna imagen.' });
    }

    const fs = require('fs');
    const base64Image = base64Data.replace(/^data:image\/\w+;base64,/, "");
    const ext = fileName ? path.extname(fileName) : '.png';
    const finalFileName = `birthday_flyer${ext}`;
    const publicDir = path.join(__dirname, '..', 'public');
    const publicFilePath = path.join(publicDir, finalFileName);
    
    const distDir = path.join(__dirname, '..', 'dist');
    const distFilePath = path.join(distDir, finalFileName);

    // Delete any existing files starting with 'birthday_flyer.' in both folders to avoid duplicates
    const deleteExistingFlyers = (dir) => {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        files.forEach(f => {
          if (f.startsWith('birthday_flyer.')) {
            try {
              fs.unlinkSync(path.join(dir, f));
              console.log(`[MARKETING] Deleted old flyer on disk: ${f}`);
            } catch (err) {
              console.warn(`[MARKETING] Could not delete file: ${f}`, err.message);
            }
          }
        });
      }
    };

    deleteExistingFlyers(publicDir);
    deleteExistingFlyers(distDir);

    let saved = false;

    // Guardar en public si es posible
    try {
      if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
      }
      fs.writeFileSync(publicFilePath, Buffer.from(base64Image, 'base64'));
      saved = true;
    } catch (e) {
      console.warn('[MARKETING] No se pudo guardar en public:', e.message);
    }

    // Guardar en dist si es posible
    try {
      if (!fs.existsSync(distDir)) {
        fs.mkdirSync(distDir, { recursive: true });
      }
      fs.writeFileSync(distFilePath, Buffer.from(base64Image, 'base64'));
      saved = true;
    } catch (e) {
      console.warn('[MARKETING] No se pudo guardar en dist:', e.message);
    }

    if (!saved) {
      throw new Error('No se pudo guardar el archivo en ninguna carpeta estática.');
    }

    const flyerUrl = `/${finalFileName}?v=${Date.now()}`;

    console.log(`[MARKETING] Flyer de cumpleaños actualizado con éxito. URL: ${flyerUrl}`);
    res.json({ success: true, flyerUrl });
  } catch (err) {
    console.error('[MARKETING UPLOAD ERROR]', err);
    res.status(500).json({ error: err.message });
  }
});

const getCampaignFlyerPath = () => {
  const fs = require('fs');
  const path = require('path');
  const publicDir = path.join(__dirname, '..', 'public');
  const distDir = path.join(__dirname, '..', 'dist');
  
  let flyerFile = null;
  
  if (fs.existsSync(publicDir)) {
    const files = fs.readdirSync(publicDir);
    flyerFile = files.find(f => f.startsWith('campaign_flyer.'));
    if (flyerFile) return path.join(publicDir, flyerFile);
  }
  
  if (fs.existsSync(distDir)) {
    const files = fs.readdirSync(distDir);
    flyerFile = files.find(f => f.startsWith('campaign_flyer.'));
    if (flyerFile) return path.join(distDir, flyerFile);
  }
  
  return null;
};

app.post('/api/marketing/upload-campaign-flyer', async (req, res) => {
  try {
    const { base64Data, fileName } = req.body;
    if (!base64Data) {
      return res.status(400).json({ error: 'No se recibió ninguna imagen.' });
    }

    const fs = require('fs');
    const base64Image = base64Data.replace(/^data:image\/\w+;base64,/, "");
    const ext = fileName ? path.extname(fileName) : '.png';
    const finalFileName = `campaign_flyer${ext}`;
    const publicDir = path.join(__dirname, '..', 'public');
    const publicFilePath = path.join(publicDir, finalFileName);
    
    const distDir = path.join(__dirname, '..', 'dist');
    const distFilePath = path.join(distDir, finalFileName);

    const deleteExistingFlyers = (dir) => {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        files.forEach(f => {
          if (f.startsWith('campaign_flyer.')) {
            try {
              fs.unlinkSync(path.join(dir, f));
            } catch (err) {
              console.warn(`[MARKETING] Could not delete file: ${f}`, err.message);
            }
          }
        });
      }
    };

    deleteExistingFlyers(publicDir);
    deleteExistingFlyers(distDir);

    let saved = false;

    try {
      if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
      }
      fs.writeFileSync(publicFilePath, Buffer.from(base64Image, 'base64'));
      saved = true;
    } catch (e) {
      console.warn('[MARKETING] No se pudo guardar en public:', e.message);
    }

    try {
      if (!fs.existsSync(distDir)) {
        fs.mkdirSync(distDir, { recursive: true });
      }
      fs.writeFileSync(distFilePath, Buffer.from(base64Image, 'base64'));
      saved = true;
    } catch (e) {
      console.warn('[MARKETING] No se pudo guardar en dist:', e.message);
    }

    if (!saved) throw new Error("No se pudo escribir el archivo en disco.");

    const flyerUrl = `/${finalFileName}?v=${Date.now()}`;
    res.json({ success: true, flyerUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET Marketing Settings
app.get('/api/marketing/settings', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM marketing_settings WHERE id = 1 LIMIT 1');
    if (rows.length === 0) {
      return res.json({
        birthday_automation_enabled: 1,
        birthday_discount: 15,
        birthday_flyer_url: '',
        birthday_email_subject: '¡Feliz Cumpleaños! 🎉',
        birthday_email_template: '¡Hola {{nombre}}! Esperamos que tengas un día maravilloso. Como regalo de cumpleaños, disfruta de un {{descuento}}% de descuento en cualquiera de nuestros servicios durante esta semana. ¡Te esperamos!',
        mass_email_template: '¡Hola {{nombre}}! Tenemos una oferta para ti.'
      });
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST Marketing Settings
app.post('/api/marketing/settings', async (req, res) => {
  const { 
    birthday_automation_enabled, 
    birthday_discount, 
    birthday_flyer_url, 
    birthday_email_subject, 
    birthday_email_template, 
    mass_email_template 
  } = req.body;
  try {
    await pool.query(`
      INSERT INTO marketing_settings (
        id, birthday_automation_enabled, birthday_discount, birthday_flyer_url, 
        birthday_email_subject, birthday_email_template, mass_email_template
      ) 
      VALUES (
        1, ?, ?, ?, ?, ?, ?
      )
      ON DUPLICATE KEY UPDATE 
        birthday_automation_enabled = VALUES(birthday_automation_enabled),
        birthday_discount = VALUES(birthday_discount),
        birthday_flyer_url = VALUES(birthday_flyer_url),
        birthday_email_subject = VALUES(birthday_email_subject),
        birthday_email_template = VALUES(birthday_email_template),
        mass_email_template = VALUES(mass_email_template)
    `, [
      birthday_automation_enabled === true || birthday_automation_enabled == 1 ? 1 : 0,
      parseInt(birthday_discount) || 15,
      birthday_flyer_url || '',
      birthday_email_subject || '¡Feliz Cumpleaños! 🎉',
      birthday_email_template || '',
      mass_email_template || ''
    ]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET active birthday flyer URL
app.get('/api/marketing/birthday-flyer', (req, res) => {
  try {
    const flyerUrl = getBirthdayFlyerUrl(req);
    res.json({ success: true, flyerUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const getCampaignFlyerUrl = (req) => {
  const flyerPath = getCampaignFlyerPath();
  if (flyerPath) {
    const path = require('path');
    return `/${path.basename(flyerPath)}`;
  }
  return '';
};

// GET active campaign flyer URL
app.get('/api/marketing/campaign-flyer', (req, res) => {
  try {
    const flyerUrl = getCampaignFlyerUrl(req);
    res.json({ success: true, flyerUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Helper to dynamically locate uploaded flyer in public or dist
const getBirthdayFlyerUrl = (req) => {
  const fs = require('fs');
  const path = require('path');
  const publicDir = path.join(__dirname, '..', 'public');
  const distDir = path.join(__dirname, '..', 'dist');
  
  let flyerFile = null;
  
  if (fs.existsSync(publicDir)) {
    const files = fs.readdirSync(publicDir);
    flyerFile = files.find(f => f.startsWith('birthday_flyer.'));
  }
  
  if (!flyerFile && fs.existsSync(distDir)) {
    const files = fs.readdirSync(distDir);
    flyerFile = files.find(f => f.startsWith('birthday_flyer.'));
  }
  
  if (flyerFile) {
    return `/${flyerFile}?v=${Date.now()}`;
  }
  
  return null;
};

// Helper to get MIME type based on file extension
const getMimeType = (filePath) => {
  if (!filePath) return 'image/jpeg';
  const ext = require('path').extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
};

// Helper to convert dynamic/relative URLs into absolute URLs for emails
const getAbsoluteFlyerUrl = (req, relativeUrl) => {
  if (!relativeUrl) return null;
  
  // If it's already an absolute URL, return it as is
  if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
    return relativeUrl;
  }
  
  let baseUrl = '';
  if (process.env.FRONTEND_URL && !process.env.FRONTEND_URL.includes('localhost')) {
    baseUrl = process.env.FRONTEND_URL.replace(/\/$/, '');
  } else {
    const host = req ? req.get('host') : process.env.BACKEND_HOST || 'planbeautyrd.com';
    const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
    const protocol = isLocal ? 'http' : 'https';
    
    // Si la URL es de localhost pero estamos en un email, usamos la URL de producción
    // para asegurar que los servidores externos de Google/Gmail puedan acceder a la imagen
    if (isLocal) {
      baseUrl = 'https://planbeautyrd.com';
    } else {
      baseUrl = `${protocol}://${host}`;
    }
  }
  
  const cleanRelative = relativeUrl.startsWith('/') ? relativeUrl : `/${relativeUrl}`;
  return `${baseUrl}${cleanRelative}`;
};

// Helper to get the absolute file path of the flyer on disk
const getBirthdayFlyerPath = () => {
  const fs = require('fs');
  const path = require('path');
  const publicDir = path.join(__dirname, '..', 'public');
  const distDir = path.join(__dirname, '..', 'dist');
  
  let flyerFile = null;
  
  if (fs.existsSync(publicDir)) {
    const files = fs.readdirSync(publicDir);
    flyerFile = files.find(f => f.startsWith('birthday_flyer.'));
    if (flyerFile) return path.join(publicDir, flyerFile);
  }
  
  if (fs.existsSync(distDir)) {
    const files = fs.readdirSync(distDir);
    flyerFile = files.find(f => f.startsWith('birthday_flyer.'));
    if (flyerFile) return path.join(distDir, flyerFile);
  }
  
  return null;
};

app.post('/api/marketing/send-birthdays', async (req, res) => {
  const { discountPercent, flyerUrl } = req.body;
  try {
    const [mSettings] = await pool.query('SELECT * FROM marketing_settings WHERE id = 1 LIMIT 1');
    const settings = mSettings[0] || {
      birthday_discount: 15,
      birthday_email_subject: '¡Feliz Cumpleaños! 🎉',
      birthday_email_template: '¡Hola {{nombre}}! Esperamos que tengas un día maravilloso. Como regalo de cumpleaños, disfruta de un {{descuento}}% de descuento en cualquiera de nuestros servicios durante esta semana. ¡Te esperamos!'
    };

    const finalDiscountPercent = discountPercent || settings.birthday_discount || 15;
    const finalSubject = settings.birthday_email_subject || '¡Feliz Cumpleaños! 🎉';
    const finalTemplate = settings.birthday_email_template || '';

    // Resolve inline attachment or remote flyer URL to bypass Gmail proxy localhost block
    const flyerPath = getBirthdayFlyerPath();
    const attachments = [];
    let imageSrc = null;

    if (flyerPath) {
      const path = require('path');
      attachments.push({
        filename: path.basename(flyerPath),
        path: flyerPath,
        cid: 'birthdayflyer',
        contentType: getMimeType(flyerPath),
        disposition: 'inline'
      });
      imageSrc = 'cid:birthdayflyer';
      console.log(`[MARKETING] Attached birthday flyer inline: ${flyerPath} with CID: birthdayflyer`);
    } else if (flyerUrl) {
      imageSrc = getAbsoluteFlyerUrl(req, flyerUrl);
    } else {
      const relativeFlyer = getBirthdayFlyerUrl(req);
      if (relativeFlyer) {
        imageSrc = getAbsoluteFlyerUrl(req, relativeFlyer);
      }
    }

    // Find clients with birthday today (ignoring year) who have an active contract/plan
    const [clients] = await pool.query(`
      SELECT DISTINCT c.id, c.email, c.nombre, s.name as salon_name, s.address as salon_address 
      FROM clients c
      JOIN contracts cn ON c.id = cn.client_id
      LEFT JOIN salons s ON c.salon_id = s.id
      WHERE DATE_FORMAT(c.fecha_nacimiento, '%m-%d') = DATE_FORMAT(NOW(), '%m-%d')
      AND cn.status = 'Active'
      AND c.email IS NOT NULL AND c.email != ''
    `);

    const [emailSettingsRows] = await pool.query('SELECT * FROM email_settings LIMIT 1');
    if (emailSettingsRows.length === 0) throw new Error("No hay configuración de correo.");
    const s = emailSettingsRows[0];

    const transporter = nodemailer.createTransport({
      host: s.smtp_host, port: s.smtp_port, secure: s.smtp_port == 465,
      auth: { user: s.smtp_user, pass: s.smtp_pass }
    });

    let sent = 0;
    for (const client of clients) {
      // Add a small delay to prevent SMTP spam triggers (1.5 seconds)
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const subject = finalSubject.replace(/\{\{nombre\}\}/g, client.nombre).replace(/\{\{descuento\}\}/g, finalDiscountPercent);
      const messageBody = finalTemplate.replace(/\{\{nombre\}\}/g, client.nombre).replace(/\{\{descuento\}\}/g, finalDiscountPercent);
      const trackingPixel = await logSentEmailAndGetPixel(req, client.id, 'birthday', client.email, subject);

      try {
        await transporter.sendMail({
          from: `"${s.smtp_from || 'PLAN BEAUTY'}" <${s.smtp_user}>`,
          to: client.email,
          subject: subject,
          attachments: attachments,
          html: `
            <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #fdf8f5; padding: 40px 15px; text-align: center;">
              <!--[if !mso]><!-->
              <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,700;1,400&family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
              <!--<![endif]-->
              
              <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 15px 35px rgba(74, 55, 40, 0.05); border: 1px solid #f3e8df; padding: 40px 30px; box-sizing: border-box; text-align: center;">
                
                <!-- Elegant Greeting -->
                <h1 style="color: #000000; font-family: 'Cormorant Garamond', 'Playfair Display', Georgia, serif; font-size: 32px; font-weight: 400; margin: 0 0 25px 0; text-align: center; line-height: 1.2;">
                  Hola <span style="font-weight: 700; color: #000000;">${client.nombre}</span>
                </h1>

                ${messageBody ? `
                <p style="font-family: 'Plus Jakarta Sans', Arial, sans-serif; font-size: 15px; color: #4a3728; line-height: 1.6; margin-bottom: 25px; text-align: center; white-space: pre-line;">
                  ${messageBody}
                </p>
                ` : ''}
                
                <!-- Flyer Container -->
                ${imageSrc ? `
                <div style="text-align: center; border-radius: 16px; overflow: hidden; border: 1px solid #ebd9cc; box-shadow: 0 8px 24px rgba(74, 55, 40, 0.05); margin: 0 auto; max-width: 100%;">
                  <img src="${imageSrc}" alt="Tu Regalo de Cumpleaños" style="max-width: 100%; height: auto; display: block; margin: 0 auto;" />
                </div>
                ` : `
                <div style="padding: 30px; background: #fffdfb; border: 1px dashed #ecd8c9; border-radius: 16px; color: #a17865; font-family: 'Plus Jakarta Sans', sans-serif;">
                  <p style="margin: 0; font-size: 18px; font-weight: 600;">Disfruta un ${finalDiscountPercent}% de Descuento</p>
                  <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.8;">Válido durante toda la semana de tu cumpleaños en cualquier servicio.</p>
                </div>
                `}
                
              </div>
              
              <!-- Premium Elegant Footer -->
              <div style="text-align: center; margin-top: 25px;">
                <p style="margin: 0; font-family: 'Plus Jakarta Sans', Arial, sans-serif; font-size: 11px; color: #a18a78; text-transform: uppercase; letter-spacing: 2px; font-weight: 700;">
                  PLAN BEAUTY • ABATTE PELUQUERÍA
                </p>
                <p style="margin: 5px 0 0 0; font-family: 'Plus Jakarta Sans', Arial, sans-serif; font-size: 9px; color: #bcaaa4;">
                  © 2026 PLAN BEAUTY RD. TU PLAN, TU BELLEZA.
                </p>
              </div>
            </div>
            ${trackingPixel}
          `
        });
        
        // Mark as sent in DB for this year
        await pool.query('UPDATE clients SET last_birthday_sent_year = YEAR(NOW()) WHERE id = ?', [client.id]);
        sent++;
      } catch (e) {
        console.error(`Error enviando cumple a ${client.email}:`, e.message);
      }
    }

    res.json({ success: true, sent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Automated daily birthdays cron endpoint
app.post('/api/marketing/send-daily-birthdays', async (req, res) => {
  try {
    const [mSettings] = await pool.query('SELECT * FROM marketing_settings WHERE id = 1 LIMIT 1');
    const settings = mSettings[0] || {
      birthday_automation_enabled: 1,
      birthday_discount: 15,
      birthday_email_subject: '¡Feliz Cumpleaños! 🎉',
      birthday_email_template: '¡Hola {{nombre}}! Esperamos que tengas un día maravilloso. Como regalo de cumpleaños, disfruta de un {{descuento}}% de descuento en cualquiera de nuestros servicios durante esta semana. ¡Te esperamos!'
    };

    if (!settings.birthday_automation_enabled) {
      console.log('[DAILY CRON] Automated birthday greetings are currently disabled in settings.');
      return res.json({ success: true, sent: 0, message: 'La automatización de cumpleaños está desactivada en la configuración.' });
    }

    const finalDiscountPercent = settings.birthday_discount || 15;
    const finalSubject = settings.birthday_email_subject || '¡Feliz Cumpleaños! 🎉';
    const finalTemplate = settings.birthday_email_template || '';

    // Resolve inline attachment or remote flyer URL to bypass Gmail proxy localhost block
    const flyerPath = getBirthdayFlyerPath();
    const attachments = [];
    let imageSrc = null;

    if (flyerPath) {
      const path = require('path');
      attachments.push({
        filename: path.basename(flyerPath),
        path: flyerPath,
        cid: 'birthdayflyer',
        contentType: getMimeType(flyerPath),
        disposition: 'inline'
      });
      imageSrc = 'cid:birthdayflyer';
      console.log(`[DAILY CRON] Attached birthday flyer inline: ${flyerPath} with CID: birthdayflyer`);
    } else {
      const relativeFlyer = getBirthdayFlyerUrl(req);
      if (relativeFlyer) {
        imageSrc = getAbsoluteFlyerUrl(req, relativeFlyer);
      }
    }

    // Find clients with birthday today who have an active contract/plan and haven't received it this year
    const [clients] = await pool.query(`
      SELECT DISTINCT c.id, c.email, c.nombre, s.name as salon_name, s.address as salon_address 
      FROM clients c
      JOIN contracts cn ON c.id = cn.client_id
      LEFT JOIN salons s ON c.salon_id = s.id
      WHERE DATE_FORMAT(c.fecha_nacimiento, '%m-%d') = DATE_FORMAT(NOW(), '%m-%d')
      AND cn.status = 'Active'
      AND (c.last_birthday_sent_year IS NULL OR c.last_birthday_sent_year < YEAR(NOW()))
      AND c.email IS NOT NULL AND c.email != ''
    `);

    console.log(`[DAILY BIRTHDAY CRON] Found ${clients.length} birthday clients today.`);

    if (clients.length === 0) {
      return res.json({ success: true, sent: 0, message: 'No hay cumpleañeros pendientes hoy.' });
    }

    const [emailSettingsRows] = await pool.query('SELECT * FROM email_settings LIMIT 1');
    if (emailSettingsRows.length === 0) throw new Error("No hay configuración de correo.");
    const s = emailSettingsRows[0];

    const transporter = nodemailer.createTransport({
      host: s.smtp_host, port: s.smtp_port, secure: s.smtp_port == 465,
      auth: { user: s.smtp_user, pass: s.smtp_pass }
    });

    let sent = 0;
    for (const client of clients) {
      // Add a small delay to prevent SMTP spam triggers (1.5 seconds)
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const subject = finalSubject.replace(/\{\{nombre\}\}/g, client.nombre).replace(/\{\{descuento\}\}/g, finalDiscountPercent);
      const messageBody = finalTemplate.replace(/\{\{nombre\}\}/g, client.nombre).replace(/\{\{descuento\}\}/g, finalDiscountPercent);
      const trackingPixel = await logSentEmailAndGetPixel(req, client.id, 'birthday_automated', client.email, subject);

      try {
        await transporter.sendMail({
          from: `"${s.smtp_from || 'PLAN BEAUTY'}" <${s.smtp_user}>`,
          to: client.email,
          subject: subject,
          attachments: attachments,
          html: `
            <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #fdf8f5; padding: 40px 15px; text-align: center;">
              <!--[if !mso]><!-->
              <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,700;1,400&family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
              <!--<![endif]-->
              
              <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 15px 35px rgba(74, 55, 40, 0.05); border: 1px solid #f3e8df; padding: 40px 30px; box-sizing: border-box; text-align: center;">
                
                <!-- Elegant Greeting -->
                <h1 style="color: #000000; font-family: 'Cormorant Garamond', 'Playfair Display', Georgia, serif; font-size: 32px; font-weight: 400; margin: 0 0 25px 0; text-align: center; line-height: 1.2;">
                  Hola <span style="font-weight: 700; color: #000000;">${client.nombre}</span>
                </h1>

                ${messageBody ? `
                <p style="font-family: 'Plus Jakarta Sans', Arial, sans-serif; font-size: 15px; color: #4a3728; line-height: 1.6; margin-bottom: 25px; text-align: center; white-space: pre-line;">
                  ${messageBody}
                </p>
                ` : ''}
                
                <!-- Flyer Container -->
                ${imageSrc ? `
                <div style="text-align: center; border-radius: 16px; overflow: hidden; border: 1px solid #ebd9cc; box-shadow: 0 8px 24px rgba(74, 55, 40, 0.05); margin: 0 auto; max-width: 100%;">
                  <img src="${imageSrc}" alt="Tu Regalo de Cumpleaños" style="max-width: 100%; height: auto; display: block; margin: 0 auto;" />
                </div>
                ` : `
                <div style="padding: 30px; background: #fffdfb; border: 1px dashed #ecd8c9; border-radius: 16px; color: #a17865; font-family: 'Plus Jakarta Sans', sans-serif;">
                  <p style="margin: 0; font-size: 18px; font-weight: 600;">Disfruta un ${finalDiscountPercent}% de Descuento</p>
                  <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.8;">Válido durante toda la semana de tu cumpleaños en cualquier servicio.</p>
                </div>
                `}
                
              </div>
              
              <!-- Premium Elegant Footer -->
              <div style="text-align: center; margin-top: 25px;">
                <p style="margin: 0; font-family: 'Plus Jakarta Sans', Arial, sans-serif; font-size: 11px; color: #a18a78; text-transform: uppercase; letter-spacing: 2px; font-weight: 700;">
                  PLAN BEAUTY • ABATTE PELUQUERÍA
                </p>
                <p style="margin: 5px 0 0 0; font-family: 'Plus Jakarta Sans', Arial, sans-serif; font-size: 9px; color: #bcaaa4;">
                  © 2026 PLAN BEAUTY RD. TU PLAN, TU BELLEZA.
                </p>
              </div>
            </div>
            ${trackingPixel}
          `
        });

        // Mark as sent in DB for this year
        await pool.query('UPDATE clients SET last_birthday_sent_year = YEAR(NOW()) WHERE id = ?', [client.id]);
        sent++;
      } catch (e) {
        console.error(`Error enviando cumpleaños automático a ${client.email}:`, e.message);
      }
    }

    res.json({ success: true, sent });
  } catch (err) {
    console.error('[DAILY BIRTHDAY ERROR]', err);
    res.status(500).json({ error: err.message });
  }
});


// === ATTENDANCE / PONCHEO ===

// PUT /api/users/:id/profile-photo - Save profile photo (base64) for facial recognition
app.put('/api/users/:id/profile-photo', async (req, res) => {
  try {
    const { id } = req.params;
    const { profile_photo } = req.body; // base64 string
    
    if (!profile_photo) {
      return res.status(400).json({ error: 'La foto de perfil es requerida.' });
    }
    
    await pool.query('UPDATE users SET profile_photo = ? WHERE id = ?', [profile_photo, id]);
    res.json({ success: true, message: 'Foto de perfil de asistencia actualizada exitosamente.' });
  } catch (err) {
    console.error('[ATTENDANCE ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users/:id/profile-photo - Retrieve profile photo for an employee
app.get('/api/users/:id/profile-photo', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT profile_photo FROM users WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Empleado no encontrado.' });
    }
    res.json({ profile_photo: rows[0].profile_photo });
  } catch (err) {
    console.error('[ATTENDANCE ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/attendance/today/:employeeId - Get today's attendance logs for an employee
app.get('/api/attendance/today/:employeeId', async (req, res) => {
  try {
    const { employeeId } = req.params;
    const [rows] = await pool.query(
      `SELECT id, type, timestamp FROM attendance 
       WHERE employee_id = ? AND DATE(timestamp) = DATE(NOW())
       ORDER BY timestamp DESC`,
      [employeeId]
    );
    res.json(rows);
  } catch (err) {
    console.error('[ATTENDANCE ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/attendance/schedule-overrides - Fetch all schedule overrides (audit log)
app.get('/api/attendance/schedule-overrides', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT o.*, COALESCE(s.nombre, u.nombre) as employeeName
       FROM schedule_overrides o
       LEFT JOIN staff_records s ON o.employee_id = s.id
       LEFT JOIN users u ON o.employee_id = u.id
       ORDER BY o.date DESC, o.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('[ATTENDANCE ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/attendance/schedule-swap - Swap shifts/schedules between two employees
app.post('/api/attendance/schedule-swap', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { employeeId1, employeeId2, date, reason, createdBy } = req.body;
    if (!employeeId1 || !employeeId2 || !date || !createdBy) {
      return res.status(400).json({ error: 'Faltan parámetros obligatorios para el intercambio.' });
    }

    await connection.beginTransaction();

    // Helper function to get effective schedule (looks in overrides first, then standard profiles)
    const getSchedule = async (empId) => {
      // Check overrides first
      const [over] = await connection.query(
        "SELECT new_hora_entrada, new_hora_salida FROM schedule_overrides WHERE employee_id = ? AND date = ? AND status = 'Activo'",
        [empId, date]
      );
      if (over.length > 0) {
        return { entrada: over[0].new_hora_entrada, salida: over[0].new_hora_salida };
      }

      // Check standard profile
      let [empData] = await connection.query(
        'SELECT nombre, hora_entrada, hora_salida FROM staff_records WHERE id = ?',
        [empId]
      );
      if (empData.length === 0) {
        const [usrData] = await connection.query(
          'SELECT nombre, hora_entrada, hora_salida FROM users WHERE id = ?',
          [empId]
        );
        empData = usrData;
      }
      return {
        nombre: empData.length > 0 ? empData[0].nombre : `Empleado #${empId}`,
        entrada: (empData.length > 0 && empData[0].hora_entrada) ? empData[0].hora_entrada : '09:00:00',
        salida: (empData.length > 0 && empData[0].hora_salida) ? empData[0].hora_salida : '18:00:00'
      };
    };

    const sched1 = await getSchedule(employeeId1);
    const sched2 = await getSchedule(employeeId2);

    const reason1 = `Intercambio de turno con ${sched2.nombre} - ${reason || 'Permiso especial'}`;
    const reason2 = `Intercambio de turno con ${sched1.nombre} - ${reason || 'Permiso especial'}`;

    // Apply cross-overrides
    // Employee 1 gets Employee 2's schedule
    await connection.query(
      `INSERT INTO schedule_overrides 
       (employee_id, date, original_hora_entrada, original_hora_salida, new_hora_entrada, new_hora_salida, reason, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
       original_hora_entrada = VALUES(original_hora_entrada),
       original_hora_salida = VALUES(original_hora_salida),
       new_hora_entrada = VALUES(new_hora_entrada),
       new_hora_salida = VALUES(new_hora_salida),
       reason = VALUES(reason),
       created_by = VALUES(created_by),
       status = 'Activo'`,
      [employeeId1, date, sched1.entrada, sched1.salida, sched2.entrada, sched2.salida, reason1, createdBy]
    );

    // Employee 2 gets Employee 1's schedule
    await connection.query(
      `INSERT INTO schedule_overrides 
       (employee_id, date, original_hora_entrada, original_hora_salida, new_hora_entrada, new_hora_salida, reason, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
       original_hora_entrada = VALUES(original_hora_entrada),
       original_hora_salida = VALUES(original_hora_salida),
       new_hora_entrada = VALUES(new_hora_entrada),
       new_hora_salida = VALUES(new_hora_salida),
       reason = VALUES(reason),
       created_by = VALUES(created_by),
       status = 'Activo'`,
      [employeeId2, date, sched2.entrada, sched2.salida, sched1.entrada, sched1.salida, reason2, createdBy]
    );

    await connection.commit();
    res.json({ success: true, message: 'Intercambio de turnos registrado con éxito.' });
  } catch (err) {
    await connection.rollback();
    console.error('[ATTENDANCE ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// POST /api/attendance/schedule-override - Create or update a schedule override
app.post('/api/attendance/schedule-override', async (req, res) => {
  try {
    const { employeeId, date, newHoraEntrada, newHoraSalida, reason, createdBy } = req.body;
    
    if (!employeeId || !date || !newHoraEntrada || !newHoraSalida || !reason || !createdBy) {
      return res.status(400).json({ error: 'Faltan parámetros obligatorios.' });
    }

    // 1. Fetch current employee scheduling as default template
    let [employees] = await pool.query(
      'SELECT hora_entrada, hora_salida FROM staff_records WHERE id = ?', 
      [employeeId]
    );
    if (employees.length === 0) {
      const [systemUsers] = await pool.query(
        'SELECT hora_entrada, hora_salida FROM users WHERE id = ?',
        [employeeId]
      );
      if (systemUsers.length > 0) {
        employees = systemUsers;
      }
    }
    
    const origEntrada = employees.length > 0 ? employees[0].hora_entrada : null;
    const origSalida = employees.length > 0 ? employees[0].hora_salida : null;

    // 2. Insert or replace schedule override
    await pool.query(
      `INSERT INTO schedule_overrides 
       (employee_id, date, original_hora_entrada, original_hora_salida, new_hora_entrada, new_hora_salida, reason, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
       original_hora_entrada = VALUES(original_hora_entrada),
       original_hora_salida = VALUES(original_hora_salida),
       new_hora_entrada = VALUES(new_hora_entrada),
       new_hora_salida = VALUES(new_hora_salida),
       reason = VALUES(reason),
       created_by = VALUES(created_by),
       status = 'Activo'`,
      [employeeId, date, origEntrada, origSalida, newHoraEntrada, newHoraSalida, reason, createdBy]
    );

    res.json({ success: true, message: 'Cambio de horario temporal registrado con éxito.' });
  } catch (err) {
    console.error('[ATTENDANCE ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/attendance/schedule-override/:id - Delete (annul) a schedule override
app.delete('/api/attendance/schedule-override/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("UPDATE schedule_overrides SET status = 'Anulado' WHERE id = ?", [id]);
    res.json({ success: true, message: 'Cambio de horario anulado con éxito.' });
  } catch (err) {
    console.error('[ATTENDANCE ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// Helper functions for Dominican Republic Timezone (America/Santo_Domingo, UTC-4)
function getDRDateString(date = new Date()) {
  const options = { timeZone: 'America/Santo_Domingo', year: 'numeric', month: '2-digit', day: '2-digit' };
  const formatter = new Intl.DateTimeFormat('en-US', options);
  const parts = formatter.formatToParts(date);
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  return `${year}-${month}-${day}`;
}

function getDRTimestampString() {
  const d = new Date();
  const options = {
    timeZone: 'America/Santo_Domingo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  };
  const formatter = new Intl.DateTimeFormat('en-US', options);
  const parts = formatter.formatToParts(d);
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  const hour = parts.find(p => p.type === 'hour').value;
  const minute = parts.find(p => p.type === 'minute').value;
  const second = parts.find(p => p.type === 'second').value;
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function isDRTimePastLimit(hourString, graceMinutes = 15) {
  if (!hourString) return false;
  const [h, m, s] = hourString.split(':').map(Number);
  
  // Obtener la hora actual en República Dominicana
  const nowDRString = new Date().toLocaleString('en-US', { timeZone: 'America/Santo_Domingo' });
  const nowDR = new Date(nowDRString);
  
  // Construir el límite del turno en República Dominicana
  const limitDR = new Date(nowDRString);
  limitDR.setHours(h, m, s || 0, 0);
  
  const limitTime = limitDR.getTime() + (graceMinutes * 60 * 1000);
  return nowDR.getTime() > limitTime;
}

function normalizeDayName(str) {
  if (!str) return '';
  return str.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

// Helper function for CompreFace face verification
async function verifyFacesWithCompreFace(webcamBuffer, referenceBuffer) {
  const endpoint = (process.env.COMPREFACE_ENDPOINT || 'http://localhost:8000').replace(/\/$/, '');
  const apiKey = process.env.COMPREFACE_API_KEY;
  if (!apiKey || apiKey === 'YOUR_COMPREFACE_API_KEY') {
    throw new Error('La API Key de CompreFace no está configurada o es inválida.');
  }

  const url = `${endpoint}/api/v1/verification/verify`;

  // Utilizar native FormData y Blob de Node.js v20 (no requiere dependencias externas)
  const formData = new FormData();
  formData.append('source_image', new Blob([webcamBuffer], { type: 'image/jpeg' }), 'webcam.jpg');
  formData.append('target_image', new Blob([referenceBuffer], { type: 'image/jpeg' }), 'reference.jpg');

  try {
    const res = await axios.post(url, formData, {
      headers: {
        'x-api-key': apiKey
      }
    });

    // CompreFace devuelve un arreglo de resultados con la similitud
    const match = res.data.result?.[0]?.face_matches?.[0];
    const similarity = match ? match.similarity : 0;

    return {
      isIdentical: similarity >= 0.90, // Umbral estricto para evitar falsos positivos
      confidence: similarity
    };
  } catch (err) {
    console.error('[COMPREFACE ERROR]:', err.response ? err.response.data : err.message);
    if (err.response && err.response.data && err.response.data.message) {
      const msg = err.response.data.message;
      if (msg.includes('No face found') || msg.includes('no face')) {
        throw new Error('No se detectó un rostro claro en la captura de la cámara o en la foto de perfil. Asegúrese de estar bajo buena luz.');
      }
      throw new Error(err.response.data.message);
    }
    throw new Error('Error al conectar con el servidor de biometría CompreFace.');
  }
}

function base64ToBuffer(base64Str) {
  if (!base64Str) return null;
  const parts = base64Str.split(',');
  const rawBase64 = parts.length > 1 ? parts[1] : parts[0];
  return Buffer.from(rawBase64, 'base64');
}

// POST /api/attendance/punch - Record employee check-in or check-out
app.post('/api/attendance/punch', async (req, res) => {
  try {
    const { employeeId, type, photo, geolocation, deviceInfo } = req.body;
    
    if (!employeeId || !type || !photo) {
      return res.status(400).json({ error: 'Faltan datos obligatorios (empleado, tipo o foto).' });
    }
    
    // Validate employee exists and load schedule configurations from staff_records or users
    let [employees] = await pool.query(
      'SELECT id, nombre, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos, profile_photo FROM staff_records WHERE id = ?', 
      [employeeId]
    );
    if (employees.length === 0) {
      // Look in users table instead
      const [systemUsers] = await pool.query(
        'SELECT id, nombre, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos, profile_photo FROM users WHERE id = ?',
        [employeeId]
      );
      if (systemUsers.length === 0) {
        return res.status(404).json({ error: 'Empleado no encontrado.' });
      }
      employees = systemUsers;
    }
    
    const emp = employees[0];

    // --- BIOMETRICS VERIFICATION (COMPREFACE) ---
    if (emp.profile_photo) {
      try {
        const webCamBuffer = base64ToBuffer(photo);
        const refPhotoBuffer = base64ToBuffer(emp.profile_photo);

        if (!webCamBuffer) {
          return res.status(400).json({ error: 'La captura de cámara enviada no es válida.' });
        }
        if (!refPhotoBuffer) {
          return res.status(400).json({ error: 'La foto de perfil del empleado no contiene datos de imagen válidos.' });
        }

        console.log(`[COMPREFACE] Iniciando validación facial para ${emp.nombre}...`);
        const verifyResult = await verifyFacesWithCompreFace(webCamBuffer, refPhotoBuffer);
        console.log(`[COMPREFACE] Similitud: ${verifyResult.confidence}, Coincide: ${verifyResult.isIdentical}`);

        if (!verifyResult.isIdentical) {
          return res.status(400).json({ error: 'Verificación biométrica fallida. Su rostro no coincide con el empleado seleccionado.' });
        }
      } catch (faceErr) {
        console.error('[COMPREFACE EXCEPTION]:', faceErr.message);
        return res.status(400).json({ error: faceErr.message || 'Error al validar la biometría.' });
      }
    }
    let status = 'Normal';
    let latenessMinutes = 0;
    let extraMinutes = 0;

    // Check if there is a temporary schedule override for this employee today
    const todayDateStr = getDRDateString();
    const [overrides] = await pool.query(
      "SELECT new_hora_entrada, new_hora_salida FROM schedule_overrides WHERE employee_id = ? AND date = ? AND status = 'Activo'",
      [employeeId, todayDateStr]
    );

    // Resolve base schedule for today (Tuesday, Lunes, etc.) using America/Santo_Domingo timezone
    const nowDRString = new Date().toLocaleString('en-US', { timeZone: 'America/Santo_Domingo' });
    const nowDRDate = new Date(nowDRString);
    const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const todayName = dayNames[nowDRDate.getDay()];

    let baseHoraEntrada = emp.hora_entrada;
    let baseHoraSalida = emp.hora_salida;

    if (emp.dias_laborables && emp.dias_laborables.trim().startsWith('{')) {
      try {
        const parsedSchedule = JSON.parse(emp.dias_laborables);
        const normalizedToday = normalizeDayName(todayName);
        const matchingKey = Object.keys(parsedSchedule).find(k => normalizeDayName(k) === normalizedToday);
        const daySched = matchingKey ? parsedSchedule[matchingKey] : null;
        if (daySched) {
          baseHoraEntrada = daySched.entrada || null;
          baseHoraSalida = daySched.salida || null;
        } else {
          baseHoraEntrada = null;
          baseHoraSalida = null;
        }
      } catch (e) {
        console.error("Error parsing employee daily schedule JSON in punch API:", e.message);
      }
    } else if (emp.dias_laborables) {
      const workingDays = emp.dias_laborables.split(',');
      const normalizedToday = normalizeDayName(todayName);
      const isWorkingDay = workingDays.some(d => normalizeDayName(d) === normalizedToday);
      if (!isWorkingDay) {
        baseHoraEntrada = null;
        baseHoraSalida = null;
      }
    }

    const effectiveHoraEntrada = overrides.length > 0 ? overrides[0].new_hora_entrada : baseHoraEntrada;
    const effectiveHoraSalida = overrides.length > 0 ? overrides[0].new_hora_salida : baseHoraSalida;
    
    if (type === 'Check-In' && effectiveHoraEntrada) {
      const now = new Date(nowDRString);
      const [expH, expM, expS] = effectiveHoraEntrada.split(':').map(Number);
      const expDate = new Date(nowDRString);
      expDate.setHours(expH, expM, expS || 0, 0);
      
      const graceMinutes = emp.tolerancia_minutos !== null ? emp.tolerancia_minutos : 15;
      const limitDate = new Date(expDate.getTime() + graceMinutes * 60 * 1000);
      
      if (now > limitDate) {
        status = 'Tardanza';
        const diffMs = now - expDate;
        latenessMinutes = Math.max(0, Math.floor(diffMs / (1000 * 60)));
      }
    } else if (type === 'Check-Out' && effectiveHoraSalida) {
      const now = new Date(nowDRString);
      const [expH, expM, expS] = effectiveHoraSalida.split(':').map(Number);
      const expDate = new Date(nowDRString);
      expDate.setHours(expH, expM, expS || 0, 0);

      const isScheduledUntil9PM = (expH === 21 && expM === 0);

      // Fetch today's check-in punch for this employee to check for tardiness/delays
      const [checkins] = await pool.query(
        `SELECT timestamp, lateness_minutes 
         FROM attendance 
         WHERE employee_id = ? 
           AND type = 'Check-In' 
           AND DATE(timestamp) = ? 
         ORDER BY timestamp DESC 
         LIMIT 1`,
        [employeeId, todayDateStr]
      );

      let actualCheckinDate = null;
      if (checkins.length > 0) {
        const checkinDRString = new Date(checkins[0].timestamp).toLocaleString('en-US', { timeZone: 'America/Santo_Domingo' });
        actualCheckinDate = new Date(checkinDRString);
      } else if (effectiveHoraEntrada) {
        const [entH, entM, entS] = effectiveHoraEntrada.split(':').map(Number);
        actualCheckinDate = new Date(nowDRString);
        actualCheckinDate.setHours(entH, entM, entS || 0, 0);
      }

      // Early check-in rule: if actual check-in is earlier than scheduled entry, treat as scheduled entry only if within 15 minutes
      if (effectiveHoraEntrada && actualCheckinDate) {
        const [entH, entM, entS] = effectiveHoraEntrada.split(':').map(Number);
        const scheduledEntryDate = new Date(nowDRString);
        scheduledEntryDate.setHours(entH, entM, entS || 0, 0);
        
        const diffMs = scheduledEntryDate - actualCheckinDate;
        const earlyMinutes = diffMs / (1000 * 60);

        if (earlyMinutes > 0 && earlyMinutes <= 15) {
          actualCheckinDate = scheduledEntryDate;
        }
      }

      let scheduledDurationMinutes = 0;
      if (effectiveHoraEntrada) {
        const [entH, entM, entS] = effectiveHoraEntrada.split(':').map(Number);
        scheduledDurationMinutes = (expH * 60 + expM) - (entH * 60 + entM);
        if (scheduledDurationMinutes < 0) {
          scheduledDurationMinutes += 24 * 60; // Handle wrap around midnight
        }
      }

      if (isScheduledUntil9PM) {
        // Special logic for 9:00 PM closing shift
        const eightPM = new Date(nowDRString);
        eightPM.setHours(20, 0, 0, 0); // 8:00 PM

        if (now >= eightPM && now < expDate) {
          // Checked out between 8:00 PM and 9:00 PM: normal status, no overtime
          status = 'Normal';
          extraMinutes = 0;
        } else if (now < eightPM) {
          // Checked out before 8:00 PM: early checkout
          status = 'Salida Temprana';
          extraMinutes = 0;
        } else {
          // Checked out after 9:00 PM: overtime starts after completing scheduled hours
          status = 'Normal';
          if (actualCheckinDate && scheduledDurationMinutes > 0) {
            const workedDurationMinutes = Math.max(0, Math.floor((now - actualCheckinDate) / (1000 * 60)));
            extraMinutes = Math.max(0, workedDurationMinutes - scheduledDurationMinutes);
          } else {
            const diffMs = now - expDate;
            extraMinutes = Math.max(0, Math.floor(diffMs / (1000 * 60)));
          }
        }
      } else {
        // Standard shift logic
        if (now < expDate) {
          status = 'Salida Temprana';
          extraMinutes = 0;
        } else {
          status = 'Normal';
          if (actualCheckinDate && scheduledDurationMinutes > 0) {
            const workedDurationMinutes = Math.max(0, Math.floor((now - actualCheckinDate) / (1000 * 60)));
            extraMinutes = Math.max(0, workedDurationMinutes - scheduledDurationMinutes);
          } else {
            const diffMs = now - expDate;
            extraMinutes = Math.max(0, Math.floor(diffMs / (1000 * 60)));
          }
        }
      }
    }
    
    const punchId = `PUNCH-${Date.now()}-${employeeId}`;
    
    // Si es Check-In, eliminar cualquier registro previo de 'Ausencia' autogenerado hoy para este empleado
    if (type === 'Check-In') {
      await pool.query(
        "DELETE FROM attendance WHERE employee_id = ? AND DATE(timestamp) = ? AND type = 'Ausencia'",
        [employeeId, todayDateStr]
      );
    }

    await pool.query(
      `INSERT INTO attendance (id, employee_id, type, photo, geolocation, device_info, timestamp, status, lateness_minutes, extra_minutes) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [punchId, employeeId, type, photo || null, geolocation || null, deviceInfo || null, getDRTimestampString(), status, latenessMinutes, extraMinutes]
    );
    
    console.log(`[ATTENDANCE] Ponche registrado: ${type} (${status}) para ${emp.nombre} (${employeeId})`);
    res.json({ success: true, message: `Ponche de ${type === 'Check-In' ? 'Entrada' : 'Salida'} registrado como ${status} correctamente.`, name: emp.nombre });
  } catch (err) {
    console.error('[ATTENDANCE ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/attendance/today - Lightweight: only real punches for today (no absent generation)
// Used by the kiosk to auto-detect whether to show Check-In or Check-Out
app.get('/api/attendance/today', async (req, res) => {
  try {
    const todayStr = getDRDateString();
    const [rows] = await pool.query(
      `SELECT a.id, a.employee_id, a.type, a.status, a.timestamp, a.lateness_minutes, a.extra_minutes
       FROM attendance a
       WHERE DATE(a.timestamp) = ? AND a.type IN ('Check-In', 'Check-Out')
       ORDER BY a.timestamp ASC`,
      [todayStr]
    );
    res.json(rows);
  } catch (err) {
    console.error('[ATTENDANCE TODAY ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/attendance/history - Fetch historical attendance logs for admin panel
app.get('/api/attendance/history', async (req, res) => {
  try {
    const { startDate, endDate, employeeId, status, type, salonId } = req.query;
    
    const start = startDate || getDRDateString(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
    const end = endDate || getDRDateString();

    // 1. Fetch active staff and system users (excluding admins/clients) to know who should work
    const [staff] = await pool.query(
      "SELECT id, nombre, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos, salon_id, fecha_entrada FROM staff_records WHERE status = 'Activo' OR status = 'Active'"
    );
    const [users] = await pool.query(
      "SELECT u.id, u.nombre, u.hora_entrada, u.hora_salida, u.dias_laborables, u.tolerancia_minutos, u.salon_id, r.nombre as role_name, u.created_at as fecha_entrada FROM users u LEFT JOIN roles r ON u.role_id = r.id"
    );
    const systemStaff = users.filter(u => {
      const role = (u.role_name || '').toLowerCase();
      return !role.includes('admin') && !role.includes('client');
    });

    const allEmployees = [...staff];
    systemStaff.forEach(sysUser => {
      if (!allEmployees.some(c => c.nombre.toLowerCase().trim() === sysUser.nombre.toLowerCase().trim())) {
        allEmployees.push(sysUser);
      }
    });

    // 2. Fetch all schedule overrides within this date range
    const [rangeOverrides] = await pool.query(
      "SELECT employee_id, DATE_FORMAT(date, '%Y-%m-%d') as dateStr, new_hora_entrada, new_hora_salida FROM schedule_overrides WHERE date >= ? AND date <= ? AND status = 'Activo'",
      [start, end]
    );
    const overrideMap = new Map();
    rangeOverrides.forEach(o => {
      overrideMap.set(`${o.employee_id}:${o.dateStr}`, o);
    });

    // 3. Fetch all existing attendance records in this range
    const [existingPunches] = await pool.query(
      "SELECT employee_id, DATE_FORMAT(timestamp, '%Y-%m-%d') as dateStr, type FROM attendance WHERE timestamp >= ? AND timestamp <= ?",
      [`${start} 00:00:00`, `${end} 23:59:59`]
    );

    const punchSet = new Set(existingPunches.map(p => `${p.employee_id}:${p.dateStr}`));
    const absentSet = new Set(existingPunches.filter(p => p.type === 'Ausencia').map(p => `${p.employee_id}:${p.dateStr}`));
    // Track employees who actually checked in — never generate Ausencia for these
    const checkinSet = new Set(existingPunches.filter(p => p.type === 'Check-In').map(p => `${p.employee_id}:${p.dateStr}`));

    // 4. Generate missing Ausente records for scheduled work days in range (excluding future days)
    const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const curDate = new Date(start + 'T12:00:00');
    const endDateObj = new Date(end + 'T12:00:00');
    const todayStr = getDRDateString();

    while (curDate <= endDateObj) {
      const dateStr = getDRDateString(curDate);
      const dayName = dayNames[curDate.getDay()];

      for (const emp of allEmployees) {
        let isWorkingDay = false;
        let empDailyHoraEntrada = emp.hora_entrada;
        let empDailyHoraSalida = emp.hora_salida;

        if (emp.dias_laborables && emp.dias_laborables.trim().startsWith('{')) {
          try {
            const parsedSchedule = JSON.parse(emp.dias_laborables);
            const normalizedDay = normalizeDayName(dayName);
            const matchingKey = Object.keys(parsedSchedule).find(k => normalizeDayName(k) === normalizedDay);
            const daySched = matchingKey ? parsedSchedule[matchingKey] : null;
            if (daySched && daySched.entrada && daySched.salida) {
              isWorkingDay = true;
              empDailyHoraEntrada = daySched.entrada;
              empDailyHoraSalida = daySched.salida;
            }
          } catch (e) {
            console.error("Error parsing daily schedule JSON for employee", emp.id, e.message);
          }
        } else {
          const workingDays = (emp.dias_laborables || '').split(',');
          const normalizedDay = normalizeDayName(dayName);
          isWorkingDay = emp.dias_laborables && workingDays.some(d => normalizeDayName(d) === normalizedDay);
        }

        if (isWorkingDay) {
          // No generar ausencias para fechas anteriores a la contratación del empleado
          if (emp.fecha_entrada) {
            const empHireDateStr = getDRDateString(new Date(emp.fecha_entrada));
            if (dateStr < empHireDateStr) {
              continue;
            }
          }

          const lookupKey = `${emp.id}:${dateStr}`;
          
          if (!punchSet.has(lookupKey)) {
            let shouldMarkAbsent = true;
            const override = overrideMap.get(lookupKey);
            const effectiveHoraEntrada = override ? override.new_hora_entrada : empDailyHoraEntrada;

            if (dateStr > todayStr) {
              shouldMarkAbsent = false;
            } else if (dateStr <= '2026-07-12') {
              shouldMarkAbsent = false;
            } else if (dateStr === todayStr) {
              if (effectiveHoraEntrada) {
                const grace = emp.tolerancia_minutos !== null && emp.tolerancia_minutos !== undefined ? emp.tolerancia_minutos : 15;
                const isPast = isDRTimePastLimit(effectiveHoraEntrada, grace);
                if (!isPast) {
                  shouldMarkAbsent = false;
                }
              } else {
                shouldMarkAbsent = false;
              }
            }

            if (shouldMarkAbsent && !absentSet.has(lookupKey) && !checkinSet.has(lookupKey)) {
              const punchId = `ABSENT-${Date.now()}-${emp.id}-${dateStr}`;
              const entryTime = effectiveHoraEntrada || '09:00:00';
              await pool.query(
                `INSERT INTO attendance (id, employee_id, type, photo, geolocation, device_info, timestamp, status) 
                 VALUES (?, ?, 'Ausencia', NULL, NULL, 'Autogenerado por Sistema', ?, 'Ausente')`,
                [punchId, emp.id, `${dateStr} ${entryTime}`]
              );
              punchSet.add(lookupKey);
              absentSet.add(lookupKey);
            }
          }
        }
      }
      curDate.setDate(curDate.getDate() + 1);
    }

    // 4. Query combined history
    let sql = `
      SELECT a.id, a.employee_id, a.timestamp, a.type, a.photo, a.geolocation, a.device_info, a.status, a.lateness_minutes, a.extra_minutes,
             COALESCE(s.nombre, u.nombre) as employeeName,
             sal.name as salonName,
             COALESCE(s.dias_laborables, u.dias_laborables) as dias_laborables,
             o.new_hora_entrada as override_hora_entrada,
             o.new_hora_salida as override_hora_salida,
             COALESCE(s.hora_entrada, u.hora_entrada) as base_hora_entrada,
             COALESCE(s.hora_salida, u.hora_salida) as base_hora_salida,
             COALESCE(s.tolerancia_minutos, u.tolerancia_minutos) as tolerancia_minutos
      FROM attendance a
      LEFT JOIN staff_records s ON a.employee_id = s.id
      LEFT JOIN users u ON a.employee_id = u.id
      LEFT JOIN salons sal ON COALESCE(s.salon_id, u.salon_id) = sal.id
      LEFT JOIN schedule_overrides o ON a.employee_id = o.employee_id AND DATE(a.timestamp) = o.date AND o.status = 'Activo'
    `;
    const params = [];
    const conditions = [];
    
    if (startDate) {
      conditions.push(`a.timestamp >= ?`);
      params.push(`${startDate} 00:00:00`);
    }
    if (endDate) {
      conditions.push(`a.timestamp <= ?`);
      params.push(`${endDate} 23:59:59`);
    }
    if (employeeId) {
      conditions.push(`a.employee_id = ?`);
      params.push(employeeId);
    }
    if (salonId) {
      conditions.push(`COALESCE(s.salon_id, u.salon_id) = ?`);
      params.push(salonId);
    }
    if (status) {
      conditions.push(`a.status = ?`);
      params.push(status);
    }
    if (type) {
      conditions.push(`a.type = ?`);
      params.push(type);
    }
    
    if (conditions.length > 0) {
      sql += ` WHERE ` + conditions.join(' AND ');
    }
    
    sql += ` ORDER BY a.timestamp DESC`;
    
    const [rows] = await pool.query(sql, params);
    const formattedRows = rows.map(row => {
      let finalEntrada = row.base_hora_entrada;
      let finalSalida = row.base_hora_salida;

      if (row.dias_laborables && row.dias_laborables.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(row.dias_laborables);
          const dateObj = new Date(row.timestamp);
          const dayName = dayNames[dateObj.getDay()];
          const daySched = parsed[dayName];
          if (daySched && daySched.entrada && daySched.salida) {
            finalEntrada = daySched.entrada;
            finalSalida = daySched.salida;
          }
        } catch (e) {}
      }

      if (row.override_hora_entrada) {
        finalEntrada = row.override_hora_entrada;
      }
      if (row.override_hora_salida) {
        finalSalida = row.override_hora_salida;
      }

      return {
        id: row.id,
        employee_id: row.employee_id,
        timestamp: row.timestamp,
        type: row.type,
        photo: row.photo,
        geolocation: row.geolocation,
        device_info: row.device_info,
        status: row.status,
        lateness_minutes: row.lateness_minutes,
        extra_minutes: row.extra_minutes,
        employeeName: row.employeeName,
        salonName: row.salonName,
        hora_entrada: finalEntrada,
        hora_salida: finalSalida,
        tolerancia_minutos: row.tolerancia_minutos
      };
    });

    res.json(formattedRows);
  } catch (err) {
    console.error('[ATTENDANCE ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/attendance/pending - Fetch all pending attendance records (missing check-in/out)
app.get('/api/attendance/pending', async (req, res) => {
  try {
    const { startDate, endDate, employeeId, salonId } = req.query;
    
    // Default to last 7 days (excluding future days)
    const start = startDate || getDRDateString(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
    const end = endDate || getDRDateString();

    // 1. Fetch active staff and system users
    const [staff] = await pool.query(
      "SELECT id, nombre, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos, salon_id FROM staff_records WHERE status = 'Activo' OR status = 'Active'"
    );
    const [users] = await pool.query(
      "SELECT u.id, u.nombre, u.hora_entrada, u.hora_salida, u.dias_laborables, u.tolerancia_minutos, u.salon_id, r.nombre as role_name FROM users u LEFT JOIN roles r ON u.role_id = r.id"
    );
    const systemStaff = users.filter(u => {
      const role = (u.role_name || '').toLowerCase();
      return !role.includes('admin') && !role.includes('client');
    });

    const allEmployees = [...staff];
    systemStaff.forEach(sysUser => {
      if (!allEmployees.some(c => c.nombre.toLowerCase().trim() === sysUser.nombre.toLowerCase().trim())) {
        allEmployees.push(sysUser);
      }
    });

    // Apply employeeId and salonId filters
    let filteredEmployees = allEmployees;
    if (employeeId) {
      filteredEmployees = filteredEmployees.filter(e => String(e.id) === String(employeeId));
    }
    if (salonId) {
      filteredEmployees = filteredEmployees.filter(e => String(e.salon_id) === String(salonId));
    }

    // 2. Fetch all schedule overrides in the range
    const [rangeOverrides] = await pool.query(
      "SELECT employee_id, DATE_FORMAT(date, '%Y-%m-%d') as dateStr, new_hora_entrada, new_hora_salida FROM schedule_overrides WHERE date >= ? AND date <= ? AND status = 'Activo'",
      [start, end]
    );
    const overrideMap = new Map();
    rangeOverrides.forEach(o => {
      overrideMap.set(`${o.employee_id}:${o.dateStr}`, o);
    });

    // 3. Fetch all attendance logs in the range
    const [punches] = await pool.query(
      "SELECT id, employee_id, type, DATE_FORMAT(timestamp, '%Y-%m-%d') as dateStr, DATE_FORMAT(timestamp, '%H:%i:%s') as timeStr, timestamp, status, is_manual, modified_by, modified_at, modification_reason FROM attendance WHERE timestamp >= ? AND timestamp <= ?",
      [`${start} 00:00:00`, `${end} 23:59:59`]
    );

    // Group punches by employeeId and dateStr
    const punchMap = new Map();
    punches.forEach(p => {
      const key = `${p.employee_id}:${p.dateStr}`;
      if (!punchMap.has(key)) {
        punchMap.set(key, []);
      }
      punchMap.get(key).push(p);
    });

    const pendingIncidents = [];
    const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    
    // Generate dates range
    const curDate = new Date(start + 'T12:00:00');
    const endDateObj = new Date(end + 'T12:00:00');
    const todayStr = getDRDateString();

    while (curDate <= endDateObj) {
      const dateStr = getDRDateString(curDate);
      const dayName = dayNames[curDate.getDay()];

      for (const emp of filteredEmployees) {
        let isWorkingDay = false;
        let empDailyHoraEntrada = emp.hora_entrada;
        let empDailyHoraSalida = emp.hora_salida;

        // Determine if it was scheduled to be a working day
        if (emp.dias_laborables && emp.dias_laborables.trim().startsWith('{')) {
          try {
            const parsedSchedule = JSON.parse(emp.dias_laborables);
            const normalizedDay = normalizeDayName(dayName);
            const matchingKey = Object.keys(parsedSchedule).find(k => normalizeDayName(k) === normalizedDay);
            const daySched = matchingKey ? parsedSchedule[matchingKey] : null;
            if (daySched && daySched.entrada && daySched.salida) {
              isWorkingDay = true;
              empDailyHoraEntrada = daySched.entrada;
              empDailyHoraSalida = daySched.salida;
            }
          } catch (e) {}
        } else {
          const workingDays = (emp.dias_laborables || '').split(',');
          const normalizedDay = normalizeDayName(dayName);
          isWorkingDay = emp.dias_laborables && workingDays.some(d => normalizeDayName(d) === normalizedDay);
        }

        // Apply override if active
        const lookupKey = `${emp.id}:${dateStr}`;
        const override = overrideMap.get(lookupKey);
        if (override) {
          isWorkingDay = true;
          empDailyHoraEntrada = override.new_hora_entrada;
          empDailyHoraSalida = override.new_hora_salida;
        }

        if (isWorkingDay) {
          const dayPunches = punchMap.get(lookupKey) || [];
          const checkIn = dayPunches.find(p => p.type === 'Check-In');
          const checkOut = dayPunches.find(p => p.type === 'Check-Out');
          const absence = dayPunches.find(p => p.type === 'Ausencia');

          let hasIncident = false;
          let incidentType = '';

          // Priority: Real Check-In always overrides Ausencia records (Ausencia can be stale/auto-generated)
          // 1. Has both Check-In and Check-Out → complete, no incident
          // 2. Has Check-In but no Check-Out → missing_checkout (regardless of Ausencia)
          // 3. Has Check-Out but no Check-In → missing_checkin
          // 4. No real punches at all:
          //    - If Ausencia record exists → legitimately absent (skip, not a pending issue)
          //    - If no records at all → missing_all (only for past days)

          if (checkIn && checkOut) {
            // Complete - no incident
          } else if (checkIn && !checkOut) {
            // Employee showed up but never checked out
            if (dateStr < todayStr) {
              hasIncident = true;
              incidentType = 'missing_checkout';
            } else if (dateStr === todayStr) {
              if (empDailyHoraSalida && isDRTimePastLimit(empDailyHoraSalida, 60)) {
                hasIncident = true;
                incidentType = 'missing_checkout';
              }
            }
          } else if (!checkIn && checkOut) {
            // Has checkout but no check-in (unusual scenario)
            hasIncident = true;
            incidentType = 'missing_checkin';
          } else if (!checkIn && !checkOut) {
            // No real punches - only flag if not legitimately absent
            if (!absence) {
              // No records at all - missing attendance
              if (dateStr < todayStr) {
                hasIncident = true;
                incidentType = 'missing_all';
              } else if (dateStr === todayStr) {
                if (empDailyHoraEntrada) {
                  const grace = emp.tolerancia_minutos !== null && emp.tolerancia_minutos !== undefined ? emp.tolerancia_minutos : 15;
                  if (isDRTimePastLimit(empDailyHoraEntrada, grace)) {
                    hasIncident = true;
                    incidentType = 'missing_all';
                  }
                }
              }
            }
            // If absence exists and no real Check-In → legitimately marked absent, skip
          }

          if (hasIncident && incidentType !== 'missing_all') {
            pendingIncidents.push({
              employeeId: emp.id,
              employeeName: emp.nombre,
              date: dateStr,
              scheduledIn: empDailyHoraEntrada,
              scheduledOut: empDailyHoraSalida,
              checkIn: checkIn ? { id: checkIn.id, time: checkIn.timeStr, timestamp: checkIn.timestamp, isManual: checkIn.is_manual, modifiedBy: checkIn.modified_by, modifiedAt: checkIn.modified_at, reason: checkIn.modification_reason } : null,
              checkOut: checkOut ? { id: checkOut.id, time: checkOut.timeStr, timestamp: checkOut.timestamp, isManual: checkOut.is_manual, modifiedBy: checkOut.modified_by, modifiedAt: checkOut.modified_at, reason: checkOut.modification_reason } : null,
              absence: absence ? { id: absence.id, timestamp: absence.timestamp } : null,
              incidentType
            });
          }
        }
      }
      curDate.setDate(curDate.getDate() + 1);
    }

    pendingIncidents.sort((a, b) => b.date.localeCompare(a.date));
    res.json(pendingIncidents);
  } catch (err) {
    console.error('[ATTENDANCE PENDING ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/attendance/adjust - Manually adjust missing check-in/out with audit log
app.post('/api/attendance/adjust', async (req, res) => {
  try {
    const { employeeId, date, checkInTime, checkOutTime, reason, modifiedBy } = req.body;

    if (!employeeId || !date || !reason || !modifiedBy) {
      return res.status(400).json({ error: 'Faltan datos obligatorios (empleado, fecha, motivo o administrador).' });
    }

    // 1. Delete any existing 'Ausencia' records for this employee on this date
    await pool.query(
      "DELETE FROM attendance WHERE employee_id = ? AND DATE(timestamp) = ? AND type = 'Ausencia'",
      [employeeId, date]
    );

    // 2. Adjust Check-In
    if (checkInTime) {
      const [existingIn] = await pool.query(
        "SELECT id FROM attendance WHERE employee_id = ? AND DATE(timestamp) = ? AND type = 'Check-In'",
        [employeeId, date]
      );

      const timestampStr = `${date} ${checkInTime}:00`;
      
      let [employees] = await pool.query(
        'SELECT id, nombre, hora_entrada, dias_laborables, tolerancia_minutos FROM staff_records WHERE id = ?', 
        [employeeId]
      );
      if (employees.length === 0) {
        const [users] = await pool.query(
          'SELECT id, nombre, hora_entrada, dias_laborables, tolerancia_minutos FROM users WHERE id = ?',
          [employeeId]
        );
        employees = users;
      }
      const emp = employees[0];
      
      const [overrides] = await pool.query(
        "SELECT new_hora_entrada FROM schedule_overrides WHERE employee_id = ? AND date = ? AND status = 'Activo'",
        [employeeId, date]
      );
      
      let expectedEntrada = emp ? emp.hora_entrada : '09:00:00';
      if (overrides.length > 0) {
        expectedEntrada = overrides[0].new_hora_entrada;
      } else if (emp && emp.dias_laborables && emp.dias_laborables.trim().startsWith('{')) {
        try {
          const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
          const dateObj = new Date(`${date}T12:00:00`);
          const dayName = dayNames[dateObj.getDay()];
          const parsed = JSON.parse(emp.dias_laborables);
          const daySched = parsed[dayName];
          if (daySched && daySched.entrada) {
            expectedEntrada = daySched.entrada;
          }
        } catch(e) {}
      }
      
      let status = 'Normal';
      let latenessMinutes = 0;
      if (expectedEntrada) {
        try {
          const [expH, expM] = expectedEntrada.split(':').map(Number);
          const [actH, actM] = checkInTime.split(':').map(Number);
          
          const scheduledMinutes = expH * 60 + expM;
          const actualMinutes = actH * 60 + actM;
          const diff = actualMinutes - scheduledMinutes;
          const grace = emp && emp.tolerancia_minutos !== null && emp.tolerancia_minutos !== undefined ? emp.tolerancia_minutos : 15;
          
          if (diff > grace) {
            status = 'Tardanza';
            latenessMinutes = diff;
          }
        } catch(e) {}
      }

      if (existingIn.length > 0) {
        await pool.query(
          `UPDATE attendance 
           SET timestamp = ?, status = ?, lateness_minutes = ?, is_manual = 1, modified_by = ?, modified_at = NOW(), modification_reason = ? 
           WHERE id = ?`,
          [timestampStr, status, latenessMinutes, modifiedBy, reason, existingIn[0].id]
        );
      } else {
        const punchId = `MANUAL-IN-${Date.now()}-${employeeId}-${date}`;
        await pool.query(
          `INSERT INTO attendance (id, employee_id, type, photo, geolocation, device_info, timestamp, status, lateness_minutes, is_manual, modified_by, modified_at, modification_reason) 
           VALUES (?, ?, 'Check-In', NULL, NULL, 'Ajuste Manual por Administrador', ?, ?, ?, 1, ?, NOW(), ?)`,
          [punchId, employeeId, timestampStr, status, latenessMinutes, modifiedBy, reason]
        );
      }
    }

    // 3. Adjust Check-Out
    if (checkOutTime) {
      const [existingOut] = await pool.query(
        "SELECT id FROM attendance WHERE employee_id = ? AND DATE(timestamp) = ? AND type = 'Check-Out'",
        [employeeId, date]
      );

      const timestampStr = `${date} ${checkOutTime}:00`;
      
      let [employees] = await pool.query(
        'SELECT id, nombre, hora_salida, dias_laborables FROM staff_records WHERE id = ?', 
        [employeeId]
      );
      if (employees.length === 0) {
        const [users] = await pool.query(
          'SELECT id, nombre, hora_salida, dias_laborables FROM users WHERE id = ?',
          [employeeId]
        );
        employees = users;
      }
      const emp = employees[0];
      
      const [overrides] = await pool.query(
        "SELECT new_hora_salida FROM schedule_overrides WHERE employee_id = ? AND date = ? AND status = 'Activo'",
        [employeeId, date]
      );
      
      let expectedSalida = emp ? emp.hora_salida : '18:00:00';
      if (overrides.length > 0) {
        expectedSalida = overrides[0].new_hora_salida;
      } else if (emp && emp.dias_laborables && emp.dias_laborables.trim().startsWith('{')) {
        try {
          const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
          const dateObj = new Date(`${date}T12:00:00`);
          const dayName = dayNames[dateObj.getDay()];
          const parsed = JSON.parse(emp.dias_laborables);
          const daySched = parsed[dayName];
          if (daySched && daySched.salida) {
            expectedSalida = daySched.salida;
          }
        } catch(e) {}
      }
      
      let extraMinutes = 0;
      if (expectedSalida) {
        try {
          const [expH, expM] = expectedSalida.split(':').map(Number);
          const [actH, actM] = checkOutTime.split(':').map(Number);
          
          const scheduledMinutes = expH * 60 + expM;
          const actualMinutes = actH * 60 + actM;
          const diff = actualMinutes - scheduledMinutes;
          
          if (diff > 0) {
            extraMinutes = diff;
          }
        } catch(e) {}
      }

      if (existingOut.length > 0) {
        await pool.query(
          `UPDATE attendance 
           SET timestamp = ?, extra_minutes = ?, is_manual = 1, modified_by = ?, modified_at = NOW(), modification_reason = ? 
           WHERE id = ?`,
          [timestampStr, extraMinutes, modifiedBy, reason, existingOut[0].id]
        );
      } else {
        const punchId = `MANUAL-OUT-${Date.now()}-${employeeId}-${date}`;
        await pool.query(
          `INSERT INTO attendance (id, employee_id, type, photo, geolocation, device_info, timestamp, status, extra_minutes, is_manual, modified_by, modified_at, modification_reason) 
           VALUES (?, ?, 'Check-Out', NULL, NULL, 'Ajuste Manual por Administrador', ?, 'Normal', ?, 1, ?, NOW(), ?)`,
          [punchId, employeeId, timestampStr, extraMinutes, modifiedBy, reason]
        );
      }
    }

    res.json({ success: true, message: 'Registro de asistencia regularizado con éxito.' });
  } catch (err) {
    console.error('[ATTENDANCE ADJUST ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/attendance/notify-pending - Send feedback email to employee regarding missing punch
app.post('/api/attendance/notify-pending', async (req, res) => {
  try {
    const { employeeId, date, incidentType } = req.body;

    if (!employeeId || !date || !incidentType) {
      return res.status(400).json({ error: 'Faltan datos obligatorios (empleado, fecha o tipo de incidencia).' });
    }

    // 1. Find employee name and email
    let [employees] = await pool.query(
      'SELECT id, nombre, email FROM staff_records WHERE id = ?', 
      [employeeId]
    );
    
    let empName = '';
    let empEmail = '';
    let empId = employeeId;
    
    if (employees.length > 0) {
      empName = employees[0].nombre;
      empEmail = employees[0].email;
      
      // If staff record has no email, check users table by name
      if (!empEmail) {
        const [userEmailRows] = await pool.query(
          'SELECT email FROM users WHERE nombre = ? AND email IS NOT NULL AND email != ""',
          [empName]
        );
        if (userEmailRows.length > 0) {
          empEmail = userEmailRows[0].email;
        }
      }
    } else {
      // If not in staff_records, check users table directly by ID
      const [users] = await pool.query(
        'SELECT id, nombre, email FROM users WHERE id = ?',
        [employeeId]
      );
      if (users.length > 0) {
        empName = users[0].nombre;
        empEmail = users[0].email;
        empId = users[0].id;
      }
    }

    if (!empName) {
      return res.status(404).json({ error: 'Empleado no encontrado.' });
    }

    // Fallback email if still no email configured
    if (!empEmail) {
      const firstName = empName.trim().split(/\s+/)[0].toLowerCase();
      empEmail = `${firstName}@abatte.com`;
    }

    const emp = { id: empId, nombre: empName, email: empEmail };
    const incidentLabel = incidentType === 'missing_checkin' 
      ? 'Falta registro de Entrada (Check-In)' 
      : incidentType === 'missing_checkout' 
      ? 'Falta registro de Salida (Check-Out)' 
      : 'Falta registro completo (Entrada y Salida)';

    // 2. Load SMTP config
    const [smtpRows] = await pool.query('SELECT * FROM email_settings WHERE id = 1');
    const smtp = smtpRows[0] || {};
    const transporter = nodemailer.createTransport({
      host: smtp.smtp_host || process.env.SMTP_HOST,
      port: parseInt(smtp.smtp_port || process.env.SMTP_PORT || '587'),
      secure: smtp.smtp_secure === 1,
      auth: {
        user: smtp.smtp_user || process.env.SMTP_USER,
        pass: smtp.smtp_pass || process.env.SMTP_PASS
      }
    });

    const smtpFrom = smtp.smtp_from || process.env.SMTP_FROM || 'hola@planbeautyrd.com';
    const smtpUser = smtp.smtp_user || process.env.SMTP_USER;

    // 3. Send email
    await transporter.sendMail({
      from: `"${smtpFrom}" <${smtpUser}>`,
      to: emp.email,
      subject: `⚠️ Aviso de Registro de Asistencia Omitido - ${date}`,
      text: `Hola ${emp.nombre},\n\nSe ha detectado una omisión en tu registro de asistencia para el día ${date}.\nIncidencia detectada: ${incidentLabel}.\n\nPor favor, recuerda registrar tus ponches correctamente. Las regularizaciones manuales generan una carga administrativa adicional e innecesaria para el equipo de supervisión.\n\nAgradecemos tu colaboración para mantener un registro puntual.\n\nAtentamente,\nGestión de Asistencia - Etereas SRL`,
      html: `
        <div style="font-family: 'Plus Jakarta Sans', sans-serif; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
          <h2 style="color: #dc2626; margin-top: 0;">⚠️ Registro de Asistencia Omitido</h2>
          <p>Hola <strong>${emp.nombre}</strong>,</p>
          <p>Se ha detectado que omitiste registrar tu ponche de asistencia del día <strong>${date}</strong>.</p>
          
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0; font-size: 0.9rem;"><strong>Incidencia:</strong> ${incidentLabel}</p>
          </div>

          <p style="color: #475569; line-height: 1.5;">
            Por favor, recuerda registrar tus marcas de entrada y salida a tiempo. Las regularizaciones manuales posteriores requieren la intervención de las encargadas y generan una carga administrativa adicional en el sistema.
          </p>

          <p style="font-weight: bold; color: #0f172a;">Agradecemos tu disciplina y colaboración para evitar futuras omisiones.</p>
          
          <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
          <p style="font-size: 0.8rem; color: #94a3b8; margin: 0;">Este es un mensaje automático de control interno de Etereas SRL.</p>
        </div>
      `
    });

    // Log the email event
    await pool.query(
      `INSERT INTO email_logs (client_id, email_type, recipient_email, subject, sent_at) 
       VALUES (?, 'attendance_warning', ?, ?, NOW())`,
      [emp.id, emp.email, `Aviso de Registro de Asistencia Omitido - ${date}`]
    );

    res.json({ success: true, message: `Correo de advertencia enviado a ${emp.email}.` });
  } catch (err) {
    console.error('[ATTENDANCE NOTIFY ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = 5005;

// === SEO Engine & Pre-rendering Fallback for React Router ===
function getSeoContentForPath(reqPath) {
  const defaults = {
    title: 'Plan Beauty RD | Plan mensual de lavados y peinados',
    description: 'Disfruta lavados y peinados mensuales en salones afiliados de República Dominicana por RD$1,950 al mes. Cuida tu cabello de forma premium.',
    canonical: 'https://planbeautyrd.com' + reqPath,
    robots: 'index, follow',
    schema: null,
    htmlContent: ''
  };

  // Base Organization Schema
  const orgSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "Plan Beauty RD",
    "url": "https://planbeautyrd.com/",
    "logo": "https://planbeautyrd.com/logo.png"
  };

  // 1. Home "/"
  if (reqPath === '/' || reqPath === '') {
    return {
      ...defaults,
      canonical: 'https://planbeautyrd.com/',
      schema: {
        "@graph": [
          orgSchema,
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            "name": "Plan Beauty RD",
            "url": "https://planbeautyrd.com/"
          }
        ]
      },
      htmlContent: `
        <div style="padding: 20px; font-family: sans-serif;">
          <h1>Plan mensual de lavados y peinados en República Dominicana</h1>
          <p>Disfruta cuatro lavados profesionales al mes en salones afiliados por RD$1,950 mensuales.</p>
          <a href="/plan-de-belleza">Conoce el Plan</a> | 
          <a href="/como-funciona">¿Cómo funciona?</a> | 
          <a href="/salones">Ver salones disponibles</a> | 
          <a href="/registro">Suscribirme</a>
        </div>
      `
    };
  }

  // 2. Plan "/plan-de-belleza"
  if (reqPath === '/plan-de-belleza') {
    return {
      ...defaults,
      title: 'Plan de lavados por RD$1,950 al mes | Plan Beauty RD',
      description: 'Conoce nuestro plan único de belleza mensual. Incluye 4 lavados profesionales, secado y atención premium en salones afiliados por RD$1,950.',
      schema: {
        "@context": "https://schema.org",
        "@type": "Service",
        "name": "Plan Beauty mensual",
        "description": "Plan mensual de lavados y peinados en salones afiliados en RD.",
        "provider": orgSchema,
        "offers": {
          "@type": "Offer",
          "price": "1950",
          "priceCurrency": "DOP",
          "url": "https://planbeautyrd.com/plan-de-belleza",
          "availability": "https://schema.org/InStock"
        },
        "areaServed": {
          "@type": "Country",
          "name": "República Dominicana"
        }
      },
      htmlContent: `
        <div style="padding: 20px; font-family: sans-serif;">
          <h1>Plan de belleza mensual - RD$1,950</h1>
          <p>Suscripción de lavado y peinado profesional que incluye 4 lavados al mes sin importar el largo natural del cabello. Válido en salones afiliados.</p>
          <a href="/registro">Suscribirme al Plan</a>
        </div>
      `
    };
  }

  // 3. Como funciona "/como-funciona"
  if (reqPath === '/como-funciona') {
    return {
      ...defaults,
      title: '¿Cómo funciona Plan Beauty? Suscripción, citas y beneficios',
      description: 'Descubre el funcionamiento de Plan Beauty. Elige tu plan, suscríbete online, asiste a tu salón sin necesidad de cita previa y disfruta de tu lavado profesional.',
      htmlContent: `
        <div style="padding: 20px; font-family: sans-serif;">
          <h1>¿Cómo funciona la membresía Plan Beauty?</h1>
          <p>1. Crea tu cuenta en línea. 2. Selecciona tu sucursal. 3. Realiza tu pago mensual de RD$1,950 de forma segura. 4. Visita el salón por orden de llegada sin agendar citas previas.</p>
        </div>
      `
    };
  }

  // 4. Beneficios "/beneficios"
  if (reqPath === '/beneficios') {
    return {
      ...defaults,
      title: 'Beneficios de tu membresía de belleza | Plan Beauty RD',
      description: 'Conoce las ventajas de afiliarte a Plan Beauty. Disfruta de un ahorro constante, atención profesional en salones certificados, bebidas de cortesía y ofertas exclusivas.',
      htmlContent: `
        <div style="padding: 20px; font-family: sans-serif;">
          <h1>Beneficios de Plan Beauty RD</h1>
          <p>Ahorro superior al 40% mensual en peluquería, atención premium en salones afiliados certificados, bebidas de cortesía en cada visita y promociones exclusivas para miembros.</p>
        </div>
      `
    };
  }

  // 5. Salones "/salones"
  if (reqPath === '/salones') {
    return {
      ...defaults,
      title: 'Salones afiliados a Plan Beauty en República Dominicana',
      description: 'Encuentra las sucursales y salones de belleza asociados a Plan Beauty. Consulta direcciones, teléfonos, horarios de atención y disponibilidad.',
      htmlContent: `
        <div style="padding: 20px; font-family: sans-serif;">
          <h1>Salones Afiliados - Plan Beauty RD</h1>
          <p>Contamos con centros afiliados de alta calidad en República Dominicana. Visita cualquiera de nuestras sucursales activas.</p>
          <ul>
            <li><a href="/salones/abatte-san-vicente">Abatte Peluquería San Vicente</a></li>
            <li><a href="/salones/abatte-sirena-villa-mella">Abatte Peluquería Sirena Villa Mella</a></li>
          </ul>
        </div>
      `
    };
  }

  // 6. Salon Detalle "/salones/:slug"
  if (reqPath.startsWith('/salones/')) {
    const slug = reqPath.split('/').pop();
    let name = 'Abatte Peluquería San Vicente';
    let address = 'Av. San Vicente de Paul esq. Puerto Rico, Plaza El Poder Local 1F, Santo Domingo Este';
    let phone = '(809) 561-5000';
    let hours = 'Lunes a Sábado: 8:00 AM - 8:00 PM | Domingos: 9:00 AM - 3:00 PM';

    if (slug === 'abatte-villa-mella' || slug === 'abatte-sirena-villa-mella' || slug === 'abatte-peluqueria-sirena-villa-mella') {
      name = 'Abatte Peluquería Sirena Villa Mella';
      address = 'Av. Hermanas Mirabal, Villa Mella, dentro del Multicentro La Sirena, Santo Domingo Norte';
      phone = '809-235-5555';
    }

    return {
      ...defaults,
      title: `Plan Beauty en ${name} | Lavados mensuales`,
      description: `Utiliza tu Plan Beauty en ${name}. Ubicado en ${address}. Lavados y peinados profesionales incluidos en tu suscripción mensual.`,
      schema: {
        "@context": "https://schema.org",
        "@type": "BeautySalon",
        "name": `${name} - Plan Beauty`,
        "image": "https://planbeautyrd.com/abatte_salon_interior_1777874331934.png",
        "address": {
          "@type": "PostalAddress",
          "streetAddress": address,
          "addressLocality": slug === 'abatte-villa-mella' ? 'Santo Domingo Norte' : 'Santo Domingo Este',
          "addressRegion": "Santo Domingo",
          "addressCountry": "DO"
        },
        "telephone": phone,
        "priceRange": "$$",
        "openingHours": "Mo-Sa 08:00-20:00, Su 09:00-15:00"
      },
      htmlContent: `
        <div style="padding: 20px; font-family: sans-serif;">
          <h1>Utiliza tu Plan Beauty en ${name}</h1>
          <p>Disfruta de tus lavados y peinados profesionales en la dirección: ${address}. Teléfono: ${phone}. Horario: ${hours}.</p>
          <a href="/registro">Registrarme en esta sucursal</a>
        </div>
      `
    };
  }

  // 7. Preguntas frecuentes "/preguntas-frecuentes"
  if (reqPath === '/preguntas-frecuentes') {
    return {
      ...defaults,
      title: 'Preguntas Frecuentes | Plan Beauty RD',
      description: 'Encuentra respuestas a tus dudas sobre el plan de belleza, cobro de suscripción mensual, políticas de acumulación de lavados, cancelación y cambio de salón.',
      schema: {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "¿Qué es Plan Beauty RD?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Plan Beauty es una membresía de suscripción mensual que te permite disfrutar de lavados y peinados profesionales en salones afiliados de República Dominicana por una tarifa plana fija."
            }
          },
          {
            "@type": "Question",
            "name": "¿Qué incluye Plan Beauty?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Plan Beauty incluye hasta 4 lavados profesionales con secado a blower (o rolos/plancha de tu elección) durante cada ciclo de 30 días."
            }
          },
          {
            "@type": "Question",
            "name": "¿Los lavados se acumulan si no los utilizo?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "No. Cada membresía tiene un ciclo de 30 días, contado a partir de la fecha en que se activa o renueva tu plan. Los lavados deben utilizarse dentro de ese período y no son acumulables para el siguiente ciclo."
            }
          },
          {
            "@type": "Question",
            "name": "¿El plan cubre cualquier largo o tipo de cabello?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Sí. Nuestra tarifa plana de RD$1,950 al mes cubre cualquier largo de cabello natural de la cliente suscrita. No se realizarán cargos adicionales por cabello largo en los lavados y secados estándar."
            }
          },
          {
            "@type": "Question",
            "name": "¿Necesito hacer cita para utilizar mi plan?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "No. Solo debes visitar la sucursal donde te afiliaste, dentro del horario de atención, y serás atendida por orden de llegada."
            }
          },
          {
            "@type": "Question",
            "name": "¿Puedo utilizar mi membresía en cualquier sucursal?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "No. Tu membresía es válida únicamente en la sucursal donde realizaste tu afiliación."
            }
          },
          {
            "@type": "Question",
            "name": "¿Cómo se realiza el pago?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "El pago de la membresía (RD$1,950 al mes) se procesa automáticamente cada 30 días mediante la tarjeta de crédito o débito registrada al momento de tu suscripción (bajo el sistema seguro y cifrado de CardNet)."
            }
          },
          {
            "@type": "Question",
            "name": "¿La membresía tiene contrato?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Sí. Antes de completar tu suscripción deberás aceptar un contrato digital con los términos y condiciones del servicio. La membresía tiene una duración mínima de doce (12) meses, conforme a las condiciones establecidas en el contrato."
            }
          },
          {
            "@type": "Question",
            "name": "¿Puedo cancelar mi membresía?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Sí. Puedes solicitar la cancelación de tu membresía conforme a las condiciones de tu contrato de servicio, debiendo asistir de forma presencial a la sucursal y solicitarlo en recepción antes de tu próxima fecha de facturación."
            }
          }
        ]
      },
      htmlContent: `
        <div style="padding: 20px; font-family: sans-serif;">
          <h1>Preguntas Frecuentes - Plan Beauty</h1>
          <h3>¿Qué es Plan Beauty RD?</h3>
          <p>Plan Beauty es una membresía de suscripción mensual que te permite disfrutar de lavados y peinados profesionales en salones afiliados de República Dominicana por una tarifa plana fija.</p>
          <h3>¿Qué incluye Plan Beauty?</h3>
          <p>Plan Beauty incluye hasta 4 lavados profesionales con secado a blower (o rolos/plancha de tu elección) durante cada ciclo de 30 días.</p>
          <h3>¿Los lavados se acumulan si no los utilizo?</h3>
          <p>No. Cada membresía tiene un ciclo de 30 días, y los lavados no son acumulables para el siguiente ciclo.</p>
          <h3>¿El plan cubre cualquier largo o tipo de cabello?</h3>
          <p>Sí. Nuestra tarifa plana de RD$1,950 al mes cubre cualquier largo de cabello natural de la cliente suscrita.</p>
          <h3>¿Necesito hacer cita para utilizar mi plan?</h3>
          <p>No. Solo debes visitar la sucursal donde te afiliaste, dentro del horario de atención, y serás atendida por orden de llegada.</p>
          <h3>¿Puedo utilizar mi membresía en cualquier sucursal?</h3>
          <p>No. Tu membresía es válida únicamente en la sucursal donde realizaste tu afiliación.</p>
          <h3>¿La membresía tiene contrato?</h3>
          <p>Sí. La membresía tiene una duración mínima de doce (12) meses, conforme a las condiciones establecidas en el contrato.</p>
        </div>
      `
    };
  }

  // 8. Contacto "/contacto"
  if (reqPath === '/contacto') {
    return {
      ...defaults,
      title: 'Contacto | Plan Beauty RD',
      description: 'Ponte en contacto con el soporte de Plan Beauty RD. Formulario de mensajes, enlaces directos a WhatsApp, teléfono y dirección física de oficinas en Santo Domingo.',
      htmlContent: `
        <div style="padding: 20px; font-family: sans-serif;">
          <h1>Contacto - Plan Beauty RD</h1>
          <p>Escríbenos a hola@planbeautyrd.com o llámanos al (809) 561-5000. Oficina principal en Av. San Vicente de Paul esq. Puerto Rico.</p>
        </div>
      `
    };
  }

  // 9. Terminos, Privacidad, Cancelaciones
  if (reqPath === '/terminos-y-condiciones') {
    return {
      ...defaults,
      title: 'Términos y Condiciones | Plan Beauty RD',
      description: 'Condiciones de uso de la plataforma de Plan Beauty y reglas de la suscripción mensual de lavados de cabello en República Dominicana.',
      htmlContent: `<h1>Términos y Condiciones de Uso</h1><p>Las suscripciones de Plan Beauty son personales e intransferibles, requieren validación de cédula y los lavados no son acumulables.</p>`
    };
  }
  if (reqPath === '/politica-de-privacidad') {
    return {
      ...defaults,
      title: 'Política de Privacidad | Plan Beauty RD',
      description: 'Consulta cómo protegemos y administramos tus datos personales y de facturación en la plataforma de Plan Beauty RD.',
      htmlContent: `<h1>Política de Privacidad</h1><p>Nos comprometemos a proteger tus datos personales y bancarios de manera cifrada a través de CardNet.</p>`
    };
  }
  if (reqPath === '/cancelacion-y-reembolsos') {
    return {
      ...defaults,
      title: 'Política de Cancelación y Reembolsos | Plan Beauty RD',
      description: 'Información sobre cómo cancelar tu suscripción mensual de lavados y nuestra política de devoluciones y cargos recurrentes.',
      htmlContent: `<h1>Política de Cancelación y Reembolsos</h1><p>Para cancelar tu membresía, debes asistir de forma presencial a cualquiera de nuestras sucursales y solicitar la cancelación directamente en recepción antes de tu próxima fecha de facturación.</p>`
    };
  }

  // Private, internal, or non-marketing routes (default to noindex)
  const noIndexPaths = ['/login', '/registro', '/registro-cliente', '/lista-clientes', '/visitas', '/mis-servicios', '/dashboard', '/pagos', '/planes', '/equipo', '/sucursales', '/configuracion', '/regalos', '/encuesta', '/activar'];
  const shouldNoIndex = noIndexPaths.some(p => reqPath.startsWith(p));

  return {
    ...defaults,
    title: reqPath === '/login' ? 'Iniciar sesión | Plan Beauty RD' : defaults.title,
    description: reqPath === '/login' ? 'Accede a tu cuenta de cliente o administración de Plan Beauty.' : defaults.description,
    robots: shouldNoIndex ? 'noindex, nofollow' : 'index, follow'
  };
}

// SPA fallback for React Router - MUST BE AFTER ALL API ROUTES
app.get(/.*/, (req, res) => {
  if (req.path.includes('.')) {
    return res.status(404).send('Not Found');
  }
  
  const fs = require('fs');
  const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
  
  fs.readFile(indexPath, 'utf8', (err, html) => {
    if (err) {
      return res.sendFile(indexPath);
    }
    
    try {
      const seo = getSeoContentForPath(req.path);
      let modifiedHtml = html;
      
      // Replace Title
      modifiedHtml = modifiedHtml.replace(/<title>.*?<\/title>/, `<title>${seo.title}</title>`);
      
      // Replace Description Meta
      modifiedHtml = modifiedHtml.replace(
        /<meta name="description" content=".*?" \/>/,
        `<meta name="description" content="${seo.description}" />`
      );
      
      // Replace Canonical Link
      modifiedHtml = modifiedHtml.replace(
        /<link id="canonical-link" rel="canonical" href=".*?" \/>/,
        `<link id="canonical-link" rel="canonical" href="${seo.canonical}" />`
      );
      
      // Replace Robots Meta
      modifiedHtml = modifiedHtml.replace(
        /<meta id="robots-meta" name="robots" content=".*?">/,
        `<meta id="robots-meta" name="robots" content="${seo.robots}">`
      );
      
      // Replace Open Graph and Twitter values too
      modifiedHtml = modifiedHtml.replace(/id="og-title" content=".*?"/, `id="og-title" content="${seo.title}"`);
      modifiedHtml = modifiedHtml.replace(/id="og-description" content=".*?"/, `id="og-description" content="${seo.description}"`);
      modifiedHtml = modifiedHtml.replace(/id="og-url" content=".*?"/, `id="og-url" content="${seo.canonical}"`);
      modifiedHtml = modifiedHtml.replace(/id="twitter-title" content=".*?"/, `id="twitter-title" content="${seo.title}"`);
      modifiedHtml = modifiedHtml.replace(/id="twitter-description" content=".*?"/, `id="twitter-description" content="${seo.description}"`);
      modifiedHtml = modifiedHtml.replace(/id="twitter-url" content=".*?"/, `id="twitter-url" content="${seo.canonical}"`);

      // Inject Schema JSON-LD before </head>
      if (seo.schema) {
        const schemaScript = `\n    <script type="application/ld+json">\n${JSON.stringify(seo.schema, null, 2)}\n    </script>\n  </head>`;
        modifiedHtml = modifiedHtml.replace('</head>', schemaScript);
      }

      // Inject Pre-rendered HTML inside <div id="root"></div>
      if (seo.htmlContent) {
        modifiedHtml = modifiedHtml.replace(
          '<div id="root"></div>',
          `<div id="root">\n      <!-- PRE-RENDERED SEO CONTENT -->\n      ${seo.htmlContent.trim()}\n    </div>`
        );
      }
      
      res.send(modifiedHtml);
    } catch (seoErr) {
      console.error('[SEO INJECTION ERROR]:', seoErr.message);
      res.send(html);
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Salon API Server running securely on http://127.0.0.1:${PORT}`);
  startInternalScheduler();
});
