const nodemailer = require('nodemailer');

async function testSmtp() {
  const transporter = nodemailer.createTransport({
    host: 'smtp.hostinger.com',
    port: 465,
    secure: true,
    auth: {
      user: 'hola@planbeautyrd.com',
      pass: 'z5!CIiplZ'
    }
  });

  try {
    console.log('Verificando conexión SMTP con Hostinger...');
    await transporter.verify();
    console.log('✅ Conexión SMTP verificada con éxito!');
  } catch (err) {
    console.error('❌ Error de conexión / autenticación SMTP:', err);
  }
}

testSmtp();
