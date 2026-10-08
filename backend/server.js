const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const axios = require('axios');
const nodemailer = require('nodemailer');
const fs = require('fs');
const crypto = require('crypto');
let QRCode = null;
try { QRCode = require('qrcode'); } catch(e) { console.warn('qrcode optional require notice in server:', e.message); }

// Modular Routers & Services
const { dgiiReceptionRouter } = require('./dgii_reception_router');
const { createDgiiService } = require('./services/dgii.service');
const { createDashboardRouter } = require('./routes/dashboard.routes');
const { createSecurityRouter } = require('./routes/security.routes');
const { createPayrollRouter } = require('./routes/payroll.routes');
const { createHolidaysRouter } = require('./routes/holidays.routes');
const { createContactRouter } = require('./routes/contact.routes');
const { createServicesRouter } = require('./routes/services.routes');
const { createCommissionsRouter } = require('./routes/commissions.routes');
const { createMarketingRouter } = require('./routes/marketing.routes');
const { createAttendanceRouter } = require('./routes/attendance.routes');
const { createDgiiRouter } = require('./routes/dgii.routes');
const { createEmployeeSecurityRouter } = require('./routes/employee_security.routes');
const { createGiftsSurveysRouter, sendSurveyEmail: sendSurveyEmailHelper } = require('./routes/gifts_surveys.routes');
const { createCardnetRouter } = require('./routes/cardnet.routes');
const { createPaymentsRouter } = require('./routes/payments.routes');
const { createCashRegistersRouter } = require('./routes/cash_registers.routes');
const { createSalonsRouter } = require('./routes/salons.routes');
const { createClientsRouter } = require('./routes/clients.routes');
const { createVisitsRouter } = require('./routes/visits.routes');
const { createContractsRouter, processSubscriptionsInternal } = require('./routes/contracts.routes');
const { createPlansRouter } = require('./routes/plans.routes');
const { createEmployeesRouter } = require('./routes/employees.routes');
const { createReportsRouter } = require('./routes/reports.routes');
const { createAppointmentsRouter } = require('./routes/appointments.routes');
const { createSettingsRouter } = require('./routes/settings.routes');
const { createAuthRouter } = require('./routes/auth.routes');
const { createInvoicesRouter } = require('./routes/invoices.routes');
const { createTestRouter } = require('./routes/test.routes');

const app = express();
app.set('trust proxy', true);

const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://127.0.0.1:5173', 'https://planbeautyrd.com', 'https://www.planbeautyrd.com'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      callback(new Error('Acceso no permitido por política CORS'));
    }
  },
  credentials: true
}));

// Protection middleware for /api/cron and /api/test endpoints
app.use((req, res, next) => {
  if (req.path.startsWith('/api/cron')) {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const providedSecret = req.headers['x-cron-secret'] || req.query.cron_secret;
      if (providedSecret !== cronSecret) {
        return res.status(401).json({ error: 'Acceso no autorizado al servicio de cron.' });
      }
    }
  }
  if (req.path.startsWith('/api/test')) {
    if (process.env.NODE_ENV === 'production' && process.env.ENABLE_TEST_ENDPOINTS !== 'true') {
      return res.status(403).json({ error: 'Endpoints de prueba deshabilitados en entorno de producción.' });
    }
  }
  next();
});

// === RBAC ANTI-TAMPERING SECURITY SHIELD ===
const ADMIN_PROTECTED_ROUTES = [
  '/api/payroll',
  '/api/security',
  '/api/users',
  '/api/roles',
  '/api/rrhh',
  '/api/dgii-sequences',
  '/api/credit-notes',
  '/api/reports/607',
  '/api/email-settings'
];

app.use((req, res, next) => {
  const isProtected = ADMIN_PROTECTED_ROUTES.some(route => req.path.startsWith(route));
  if (isProtected) {
    const userRole = req.headers['x-user-role'];
    if (userRole && (userRole.toLowerCase() === 'client' || userRole.toLowerCase() === 'cliente')) {
      const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || req.ip || '127.0.0.1';
      console.warn(`[SECURITY ALERT] Intento no autorizado bloqueado desde IP ${clientIp} con rol cliente intentando acceder a ${req.method} ${req.path}`);
      return res.status(403).json({ error: 'Acceso estrictamente denegado: Esta operación requiere privilegios de administración del sistema.' });
    }
  }
  next();
});

// Raw body handler for DGII e-CF reception endpoints (captures multipart/form-data, XML, binary)
app.use(['/fe', '/api/fe'], (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return next();
  }
  let chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const rawBuffer = Buffer.concat(chunks);
    req.rawBody = rawBuffer.toString('utf8');
    if (!req.body || (typeof req.body === 'object' && Object.keys(req.body).length === 0)) {
      req.body = req.rawBody;
    }
    next();
  });
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health & Status check endpoints
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});
app.get('/api/ping', (req, res) => {
  res.status(200).send('pong');
});
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

// === DGII FACTURACIÓN ELECTRÓNICA (e-CF) RECEPCIÓN & AUTENTICACIÓN (PASO 8) ===
if (dgiiReceptionRouter) {
  app.use('/fe', dgiiReceptionRouter);
  app.use('/api/fe', dgiiReceptionRouter);
}

// === SEO & CANONICAL REDIRECTS ===
app.use((req, res, next) => {
  const host = req.get('host');
  if (!host) return next();

  const isProduction = host.includes('planbeautyrd.com');
  const isWww = host.startsWith('www.');
  const forwardedProto = req.headers['x-forwarded-proto'];

  if (isProduction) {
    if (isWww) {
      const cleanHost = host.replace(/^www\./, '');
      return res.redirect(301, `https://${cleanHost}${req.originalUrl}`);
    }
    if (forwardedProto === 'http') {
      return res.redirect(301, `https://${host}${req.originalUrl}`);
    }
  }
  next();
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.static(path.join(__dirname, '..', 'dist')));

// CardNet Configuration
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

pool.on('connection', (connection) => {
  connection.query("SET time_zone = '-04:00'");
});

// Initialize DGII Service with DB pool
const dgiiService = createDgiiService(pool);

// GLOBAL LOGGER
app.use((req, res, next) => {
  console.log(`[GLOBAL LOG] ${req.method} ${req.url}`);
  next();
});

// SECURITY HEADERS MIDDLEWARE
app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), interest-cohort=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://servicios.cardnet.com.do https://labservicios.cardnet.com.do; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: *; frame-src 'self' https://servicios.cardnet.com.do https://labservicios.cardnet.com.do; connect-src 'self' https://servicios.cardnet.com.do https://labservicios.cardnet.com.do;");
  next();
});

// === PAYMENT EMAIL HELPERS WITH DGII ELECTRONIC INVOICING (e-CF) ===
async function sendPaymentReceiptEmail(clientId, clientName, clientEmail, amount, description, reference, explicitDgii = null) {
  try {
    const [settings] = await pool.query('SELECT * FROM email_settings WHERE id = 1');
    if (settings.length === 0 || !settings[0].smtp_host) return;

    const s = settings[0];
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
    const nowIsoDate = new Date().toISOString().slice(0, 10);

    // DGII Fiscal Electronic Invoice (e-CF) Allocation
    let dgii = explicitDgii;
    if (!dgii && dgiiService && dgiiService.allocateNextDgiiSequence) {
      try {
        let clientRnc = null;
        let clientCedula = null;
        if (clientId) {
          const [cRows] = await pool.query('SELECT cedula, rnc FROM clients WHERE id = ? OR cedula = ? LIMIT 1', [clientId, clientId]);
          if (cRows.length > 0) {
            clientRnc = cRows[0].rnc || null;
            clientCedula = cRows[0].cedula || null;
          }
        }
        const targetType = clientRnc ? 'E31' : 'E32';
        const encf = await dgiiService.allocateNextDgiiSequence(targetType);
        if (encf) {
          const securityCode = crypto.randomBytes(3).toString('hex').toUpperCase();
          const emisorRnc = '131917038';
          const totalFormatted = Number(amount || 0).toFixed(2);
          const qrUrl = encf.startsWith('E32')
            ? `https://fc.dgii.gov.do/eCF/ConsultaTimbreFC?RncEmisor=${emisorRnc}&ENCF=${encf}&MontoTotal=${totalFormatted}&CodigoSeguridad=${securityCode}`
            : `https://fc.dgii.gov.do/eCF/ConsultaTimbre?RncEmisor=${emisorRnc}&RncComprador=${clientRnc || ''}&ENCF=${encf}&MontoTotal=${totalFormatted}&FechaEmision=${nowIsoDate}&FechaFirma=${nowIsoDate}&CodigoSeguridad=${securityCode}`;

          dgii = {
            ncf: encf,
            ncfType: targetType,
            ncfName: targetType === 'E31' ? 'Factura de Crédito Fiscal Electrónica (e-CF)' : 'Factura de Consumo Electrónica (e-CF)',
            codigoSeguridad: securityCode,
            qrUrl: qrUrl,
            emisorRnc: emisorRnc,
            clientRncOrCedula: clientRnc || clientCedula || 'Consumidor Final'
          };
        }
      } catch (dgiiAllocErr) {
        console.warn('[DGII EMAIL ALLOC NOTICE]:', dgiiAllocErr.message);
      }
    }

    let qrImageHtml = '';
    if (dgii && dgii.qrUrl && QRCode) {
      try {
        const qrDataUri = await QRCode.toDataURL(dgii.qrUrl, { margin: 1, width: 130 });
        qrImageHtml = `<img src="${qrDataUri}" alt="Timbre DGII" style="width: 120px; height: 120px; display: block; margin: 0 auto; border-radius: 8px; border: 1px solid #e2e8f0; background: #ffffff; padding: 4px;" />`;
      } catch (qrErr) {
        console.warn('[QR CODE GENERATION ERROR]:', qrErr.message);
      }
    }

    const ncfSubject = dgii?.ncf ? ` (${dgii.ncf})` : '';

    await transporter.sendMail({
      from: `"${s.smtp_from || 'PLAN BEAUTY'}" <${s.smtp_user}>`,
      to: clientEmail,
      subject: `🧾 Factura Electrónica DGII${ncfSubject} - PLAN BEAUTY`,
      html: `
        <div style="font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif; max-width: 620px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; background-color: #ffffff;">
          
          <!-- Header Fiscal Emisor -->
          <div style="background-color: #0f172a; padding: 30px 24px; text-align: center; color: #ffffff;">
            <p style="margin: 0 0 6px 0; font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase; color: #94a3b8; font-weight: 700;">REPÚBLICA DOMINICANA • DIRECCIÓN GENERAL DE IMPUESTOS INTERNOS (DGII)</p>
            <h1 style="margin: 0; font-size: 22px; font-weight: 800; color: #ffffff !important; letter-spacing: 0.05em;">ABATTE PELUQUERÍA • PLAN BEAUTY</h1>
            <p style="margin: 6px 0 0 0; font-size: 13px; color: #cbd5e1;"><strong>ETEREAS SRL</strong> | RNC: <strong>131917038</strong></p>
            <p style="margin: 4px 0 0 0; font-size: 11px; color: #94a3b8;">Plaza Bravo, Los Palmeros #3, Santo Domingo Este | Tel: (809) 561-5000</p>
          </div>

          <!-- Cuerpo Principal -->
          <div style="padding: 28px 24px; color: #1e293b; line-height: 1.5;">
            <p style="margin-top: 0; font-size: 15px;">Hola <strong>${clientName}</strong>,</p>
            <p style="font-size: 14px; color: #334155;">Tu pago con tarjeta ha sido procesado exitosamente y a continuación te compartimos tu <strong>Factura Electrónica Oficial (e-CF)</strong> con validez fiscal ante la DGII ✨</p>
            
            <!-- Recuadro Comprobante Fiscal DGII -->
            ${dgii ? `
            <div style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border: 1.5px solid #cbd5e1; border-radius: 12px; padding: 18px; margin: 20px 0;">
              <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed #94a3b8; padding-bottom: 10px; margin-bottom: 12px;">
                <span style="font-size: 11px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.05em;">COMPROBANTE FISCAL ELECTRÓNICO (e-CF)</span>
                <span style="background: #10b981; color: white; font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 99px;">VÁLIDO DGII</span>
              </div>
              <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
                <tr>
                  <td style="padding: 4px 0; color: #64748b; font-weight: 600;">e-NCF:</td>
                  <td style="padding: 4px 0; text-align: right; font-weight: 800; font-family: monospace; font-size: 15px; color: #0f172a;">${dgii.ncf}</td>
                </tr>
                <tr>
                  <td style="padding: 4px 0; color: #64748b;">Tipo de Factura:</td>
                  <td style="padding: 4px 0; text-align: right; color: #334155; font-weight: 600;">${dgii.ncfName}</td>
                </tr>
                <tr>
                  <td style="padding: 4px 0; color: #64748b;">Código Seguridad e-CF:</td>
                  <td style="padding: 4px 0; text-align: right; font-family: monospace; font-weight: 700; color: #334155;">${dgii.codigoSeguridad}</td>
                </tr>
                <tr>
                  <td style="padding: 4px 0; color: #64748b;">Comprador / Cédula / RNC:</td>
                  <td style="padding: 4px 0; text-align: right; color: #334155; font-weight: 600;">${dgii.clientRncOrCedula}</td>
                </tr>
              </table>
            </div>
            ` : ''}

            <!-- Desglose de Transacción -->
            <div style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin: 20px 0;">
              <h3 style="margin: 0 0 12px 0; font-size: 13px; text-transform: uppercase; color: #0f172a; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px;">Detalle del Pago:</h3>
              <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
                <tr>
                  <td style="padding: 6px 0; color: #64748b;">Concepto:</td>
                  <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #1e293b;">${description}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;">Método de Pago:</td>
                  <td style="padding: 6px 0; text-align: right; color: #334155;">Tarjeta (CardNet Dominicana)</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;">Autorización / Ref:</td>
                  <td style="padding: 6px 0; text-align: right; font-family: monospace; color: #334155;">${reference}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;">Fecha y Hora:</td>
                  <td style="padding: 6px 0; text-align: right; color: #334155;">${date}</td>
                </tr>
                <tr style="border-top: 1px solid #e2e8f0;">
                  <td style="padding: 10px 0 0 0; font-size: 15px; font-weight: 800; color: #0f172a;">TOTAL PAGADO:</td>
                  <td style="padding: 10px 0 0 0; text-align: right; font-size: 17px; font-weight: 900; color: #059669;">RD$ ${parseFloat(amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                </tr>
              </table>
            </div>

            <!-- Timbre Digital y Consulta DGII -->
            ${dgii && dgii.qrUrl ? `
            <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0;">
              <p style="margin: 0 0 12px 0; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase;">TIMBRE DIGITAL OFICIAL DGII</p>
              ${qrImageHtml}
              <div style="margin-top: 14px;">
                <a href="${dgii.qrUrl}" target="_blank" style="display: inline-block; background-color: #0f172a; color: #ffffff !important; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-size: 12px; font-weight: 700; letter-spacing: 0.03em;">
                  🔍 Verificar Factura en el Portal DGII
                </a>
              </div>
              <p style="margin: 10px 0 0 0; font-size: 10px; color: #94a3b8; line-height: 1.4;">
                Escanea el código QR o haz clic en el botón superior para consultar la autenticidad de este e-CF directamente en los servidores de la DGII.
              </p>
            </div>
            ` : ''}

            <p style="color: #334155; text-align: center; font-weight: 700; margin: 25px 0 10px 0; font-size: 14px;">¡Gracias por preferir ABATTE PELUQUERÍA & PLAN BEAUTY!</p>
            
            <div style="margin-top: 30px; border-top: 1px solid #f1f5f9; padding-top: 16px; font-size: 11px; color: #94a3b8; text-align: center; line-height: 1.5;">
              Documento tributario electrónico emitido conforme a la <strong>Ley 32-23</strong> de Facturación Electrónica de la República Dominicana.<br>
              <strong>ABATTE PELUQUERÍA • Santo Domingo Este, R.D.</strong>
            </div>
          </div>
        </div>
      `
    });
    console.log(`[PAYMENT EMAIL] Factura Electrónica DGII sent to ${clientEmail} for ref: ${reference} (e-NCF: ${dgii?.ncf || 'N/A'})`);
  } catch (err) {
    console.error('[PAYMENT EMAIL ERROR]', err.message);
  }
}

async function sendPaymentFailedEmail(clientId, clientName, clientEmail, amount, errorMsg) {
  try {
    const [settings] = await pool.query('SELECT * FROM email_settings WHERE id = 1');
    if (settings.length === 0 || !settings[0].smtp_host) return;

    const s = settings[0];
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

// Survey Email Helper
const sendSurveyEmail = (clientId, name, email) => sendSurveyEmailHelper(pool, clientId, name, email);

// Setup Database Schema & Synchronizations
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
      CREATE TABLE IF NOT EXISTS contract_settings (
        id INT PRIMARY KEY DEFAULT 1,
        title VARCHAR(255) DEFAULT 'CONTRATO DE SUSCRIPCIÓN DE SERVICIOS DE BELLEZA',
        company_name VARCHAR(255) DEFAULT 'ETEREAS S. R. L.',
        company_rnc VARCHAR(50) DEFAULT '1-31-91703-8',
        company_address VARCHAR(255) DEFAULT 'Av. San Vicente De Paul esquina Calle Puerto Rico, Alma Rosa I, Plaza El Poder, Local 1F, Santo Domingo Este, Municipio De La Provincia Santo Domingo',
        renewal_fee VARCHAR(50) DEFAULT '800.00',
        min_duration_months VARCHAR(50) DEFAULT '12',
        notice_cancellation_days VARCHAR(50) DEFAULT '30',
        content LONGTEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS security_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        client_id VARCHAR(50),
        client_name VARCHAR(255),
        service_name VARCHAR(255),
        staff_name VARCHAR(100),
        auth_code VARCHAR(20),
        type VARCHAR(50) DEFAULT 'discount_price',
        status VARCHAR(20) DEFAULT 'pending',
        expires_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cash_registers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        register_number VARCHAR(50) UNIQUE NOT NULL,
        employee_id VARCHAR(50),
        employee_name VARCHAR(255),
        salon_id INT DEFAULT 1,
        monto_inicial DECIMAL(10,2) DEFAULT 0.00,
        monto_esperado DECIMAL(10,2) DEFAULT 0.00,
        monto_final DECIMAL(10,2) DEFAULT 0.00,
        gastos_turno DECIMAL(10,2) DEFAULT 0.00,
        diferencia DECIMAL(10,2) DEFAULT 0.00,
        observaciones TEXT,
        opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        closed_at TIMESTAMP NULL,
        status VARCHAR(20) DEFAULT 'Abierta'
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS services (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        descripcion TEXT,
        categoria VARCHAR(100) DEFAULT 'General',
        precio DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        activo TINYINT DEFAULT 1,
        genera_comision TINYINT DEFAULT 1,
        tipo_comision VARCHAR(50) DEFAULT 'Porcentaje',
        comision_valor DECIMAL(10,2) DEFAULT 0.00,
        aplica_itbis TINYINT DEFAULT 0,
        orden_visualizacion INT DEFAULT 0,
        imagen_url VARCHAR(255) DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS employee_commissions_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        visit_id VARCHAR(50) NOT NULL,
        ticket_number VARCHAR(50),
        employee_id VARCHAR(50) NOT NULL,
        employee_name VARCHAR(255) NOT NULL,
        service_name VARCHAR(255) NOT NULL,
        precio_servicio DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        cantidad INT DEFAULT 1,
        descuento_aplicado DECIMAL(10,2) DEFAULT 0.00,
        monto_base DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        tipo_comision VARCHAR(50) DEFAULT 'Porcentaje',
        comision_valor DECIMAL(10,2) DEFAULT 0.00,
        monto_comision DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        status VARCHAR(20) DEFAULT 'Pendiente',
        payout_id INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cash_register_movements (
        id INT AUTO_INCREMENT PRIMARY KEY,
        cash_register_id INT NOT NULL,
        type VARCHAR(50) NOT NULL,
        payment_method VARCHAR(50) DEFAULT 'Efectivo',
        amount DECIMAL(10,2) NOT NULL,
        concept TEXT,
        user_id VARCHAR(50),
        user_name VARCHAR(255),
        employee_id VARCHAR(50),
        employee_name VARCHAR(255),
        visit_id VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (cash_register_id) REFERENCES cash_registers(id) ON DELETE CASCADE
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ticket_sequences (
        salon_id INT PRIMARY KEY,
        prefix VARCHAR(10) NOT NULL DEFAULT 'SD',
        last_sequence INT NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id VARCHAR(100) PRIMARY KEY,
        user_id VARCHAR(100) NOT NULL,
        user_name VARCHAR(150),
        role VARCHAR(50),
        salon_id INT NULL,
        ip_address VARCHAR(50),
        user_agent TEXT,
        device_info VARCHAR(100),
        is_active TINYINT(1) DEFAULT 1,
        last_activity DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_id),
        INDEX (is_active),
        INDEX (last_activity)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS security_audit_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(100) NULL,
        user_name VARCHAR(150) NULL,
        action VARCHAR(100) NOT NULL,
        details TEXT NULL,
        ip_address VARCHAR(50) NULL,
        user_agent TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_id),
        INDEX (action),
        INDEX (created_at)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS login_attempts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email_or_cedula VARCHAR(150) NOT NULL,
        ip_address VARCHAR(50) NOT NULL,
        status VARCHAR(20) NOT NULL,
        attempt_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX (ip_address),
        INDEX (attempt_time)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS blocked_ips (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ip_address VARCHAR(50) UNIQUE NOT NULL,
        reason VARCHAR(255) DEFAULT 'Exceso de intentos fallidos de inicio de sesión',
        attempts_count INT DEFAULT 5,
        blocked_until DATETIME NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS security_settings (
        id INT PRIMARY KEY DEFAULT 1,
        admin_pin VARCHAR(20) DEFAULT '1234',
        require_pin_for_settings TINYINT(1) DEFAULT 1,
        pin_notification_emails TEXT NULL,
        max_failed_attempts INT DEFAULT 5,
        lockout_minutes INT DEFAULT 30,
        active_otp_pin VARCHAR(10) NULL,
        otp_expires_at DATETIME NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS account_lockouts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        account_identifier VARCHAR(150) UNIQUE NOT NULL,
        reason VARCHAR(255) DEFAULT 'Exceso de intentos fallidos',
        attempts_count INT DEFAULT 5,
        blocked_until DATETIME NULL,
        strike_count INT DEFAULT 1,
        last_ip VARCHAR(50),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX (account_identifier),
        INDEX (blocked_until)
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS employee_consumptions (
        id VARCHAR(50) PRIMARY KEY,
        employee_id VARCHAR(50) NOT NULL,
        employee_name VARCHAR(255) NOT NULL,
        monto DECIMAL(10,2) NOT NULL,
        servicios LONGTEXT,
        visit_id VARCHAR(50),
        salon_id INT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(50) DEFAULT 'Pendiente_Nomina'
      )
    `);

    console.log('[DB] Core tables & security initialized successfully.');
  } catch (err) {
    console.error('Database connection failed:', err.message);
  }
};
setupDB();

// === MOUNT MODULAR ROUTERS ===
app.use('/api/security', createSecurityRouter(pool));
app.use('/api/salons', createSalonsRouter(pool));
app.use('/api/clients', createClientsRouter(pool, { CARDNET_CONFIG, getCardNetAuthHeaders }));
app.use('/api/cash-registers', createCashRegistersRouter(pool));
app.use('/api/dashboard', createDashboardRouter(pool));
app.use('/api/payments', createPaymentsRouter(pool, { sendPaymentReceiptEmail }));
app.use('/api/plans', createPlansRouter(pool));
app.use('/api/reports', createReportsRouter(pool));
app.use('/api/appointments', createAppointmentsRouter(pool));
app.use('/api/settings', createSettingsRouter(pool));
app.use('/api/marketing', createMarketingRouter(pool));
app.use('/api/holidays', createHolidaysRouter(pool));
app.use('/api/payroll', createPayrollRouter(pool));
app.use('/api/services', createServicesRouter(pool));
app.use('/api', createEmployeeSecurityRouter(pool));
app.use('/api', createGiftsSurveysRouter(pool));

app.use('/api', createEmployeesRouter(pool));

const { router: visitsRouter, processVisitCommissions } = createVisitsRouter(pool, {
  transmitInvoiceDirectlyToDgii: dgiiService.transmitInvoiceDirectlyToDgii,
  generateAndTransmitNotaCredito: dgiiService.generateAndTransmitNotaCredito,
  sendSurveyEmail
});
app.use('/api/visits', visitsRouter);

app.use('/api/commissions', createCommissionsRouter(pool, processVisitCommissions));

app.use('/api/contracts', createContractsRouter(pool, { 
  CARDNET_CONFIG, 
  getCardNetAuthHeaders, 
  sendPaymentReceiptEmail, 
  sendPaymentFailedEmail 
}));
app.use('/api', createContractsRouter(pool, { 
  CARDNET_CONFIG, 
  getCardNetAuthHeaders, 
  sendPaymentReceiptEmail, 
  sendPaymentFailedEmail 
}));

app.use('/api/cardnet', createCardnetRouter(pool, { 
  CARDNET_CONFIG, 
  getCardNetAuthHeaders, 
  sendPaymentReceiptEmail, 
  dgiiService 
}));

app.use('/api/dgii', createDgiiRouter(pool, {
  allocateNextDgiiSequence: dgiiService.allocateNextDgiiSequence,
  buildAndSignNotaCreditoXml: dgiiService.buildAndSignNotaCreditoXml,
  generateAndTransmitNotaCredito: dgiiService.generateAndTransmitNotaCredito
}));

const { router: invoicesRouter } = createInvoicesRouter(pool);
app.use('/api/invoices', invoicesRouter);

const { router: authRouter } = createAuthRouter(pool, { sendSurveyEmail });
app.use('/api', authRouter);

const contactRouter = createContactRouter(pool);
app.use('/api/contact', contactRouter);
app.use('/api/contact-messages', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM contact_messages ORDER BY id DESC LIMIT 100');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const attendanceRouter = createAttendanceRouter(pool);
app.use('/api/attendance', attendanceRouter);
app.use('/api', attendanceRouter);

app.use('/api/test', createTestRouter(pool, { CARDNET_CONFIG, getCardNetAuthHeaders }));

// === AUTOMATED SCHEDULER (Internal Cron) ===
let lastBirthdaySentDate = null;

const startInternalScheduler = () => {
  if (process.env.DISABLE_SCHEDULER === 'true' || require('os').hostname() === 'SPAWX') {
    console.log('[SCHEDULER] Desactivado en entorno local / desarrollo.');
    return;
  }

  setTimeout(async () => {
    console.log('[SCHEDULER] Verificación inicial de suscripciones al iniciar servidor...');
    try {
      const res = await processSubscriptionsInternal(pool, { 
        CARDNET_CONFIG, 
        getCardNetAuthHeaders, 
        sendPaymentReceiptEmail, 
        sendPaymentFailedEmail 
      }, "127.0.0.1");
      console.log(`[SCHEDULER] Verificación inicial completada. Procesados: ${res.processed}, Éxitos: ${res.successful}, Fallidos: ${res.failed}`);
    } catch (e) {
      console.error('[SCHEDULER] Error en verificación inicial:', e.message);
    }
  }, 5000);

  const checkInterval = CARDNET_CONFIG.ENV === 'PRODUCTION' ? 1000 * 60 * 15 : 1000 * 60 * 2;
  console.log(`[SCHEDULER] Iniciando ciclo cada ${checkInterval / 1000 / 60} minutos (Modo: ${CARDNET_CONFIG.ENV})`);
  
  setInterval(async () => {
    try {
      const res = await processSubscriptionsInternal(pool, { 
        CARDNET_CONFIG, 
        getCardNetAuthHeaders, 
        sendPaymentReceiptEmail, 
        sendPaymentFailedEmail 
      }, "127.0.0.1");
      console.log(`[SCHEDULER] Billing process completed. Procesados: ${res.processed}, Éxitos: ${res.successful}, Fallidos: ${res.failed}`);
    } catch (err) {
      console.error('[SCHEDULER] Billing process failed:', err.message);
    }

    try {
      const drTime = new Date(new Date().getTime() - (4 * 60 * 60 * 1000));
      const todayStr = drTime.toISOString().split('T')[0];
      
      if (lastBirthdaySentDate !== todayStr) {
        const port = process.env.PORT || 5005;
        const bRes = await axios.post(`http://localhost:${port}/api/marketing/send-daily-birthdays`).catch(() => null);
        if (bRes?.data?.success) {
          lastBirthdaySentDate = todayStr;
          console.log(`[SCHEDULER] Daily automated birthdays processed. Sent: ${bRes.data.sent}`);
        }
      }
    } catch (err) {
      console.error('[SCHEDULER] Daily automated birthdays failed:', err.message);
    }
  }, checkInterval); 
};

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

  const noIndexPaths = ['/login', '/registro', '/registro-cliente', '/lista-clientes', '/visitas', '/mis-servicios', '/dashboard', '/pagos', '/planes', '/equipo', '/sucursales', '/configuracion', '/regalos', '/encuesta', '/activar'];
  const shouldNoIndex = noIndexPaths.some(p => reqPath.startsWith(p));

  return {
    ...defaults,
    title: reqPath === '/login' ? 'Iniciar sesión | Plan Beauty RD' : defaults.title,
    description: reqPath === '/login' ? 'Accede a tu cuenta de cliente o administración de Plan Beauty.' : defaults.description,
    robots: shouldNoIndex ? 'noindex, nofollow' : 'index, follow'
  };
}

// SPA Fallback for React Router - MUST BE AFTER ALL API ROUTES
app.get(/.*/, (req, res) => {
  if (req.path.includes('.')) {
    return res.status(404).send('Not Found');
  }
  
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
  fs.readFile(indexPath, 'utf8', (err, html) => {
    if (err) {
      return res.sendFile(indexPath);
    }
    
    try {
      const seo = getSeoContentForPath(req.path);
      let modifiedHtml = html;
      modifiedHtml = modifiedHtml.replace(/<title>.*?<\/title>/, `<title>${seo.title}</title>`);
      modifiedHtml = modifiedHtml.replace(/<meta name="description" content=".*?" \/>/, `<meta name="description" content="${seo.description}" />`);
      modifiedHtml = modifiedHtml.replace(/<link id="canonical-link" rel="canonical" href=".*?" \/>/, `<link id="canonical-link" rel="canonical" href="${seo.canonical}" />`);
      modifiedHtml = modifiedHtml.replace(/<meta id="robots-meta" name="robots" content=".*?">/, `<meta id="robots-meta" name="robots" content="${seo.robots}">`);
      res.send(modifiedHtml);
    } catch (seoErr) {
      console.error('[SEO INJECTION ERROR]:', seoErr.message);
      res.send(html);
    }
  });
});

const PORT = process.env.PORT || 5005;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Salon Pro & Plan Beauty API Server running securely on http://127.0.0.1:${PORT}`);
  startInternalScheduler();
});
