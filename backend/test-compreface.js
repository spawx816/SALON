require('dotenv').config();
const axios = require('axios');

async function testCompreFace() {
  const endpoint = (process.env.COMPREFACE_ENDPOINT || 'http://localhost:8000').replace(/\/$/, '');
  const apiKey = process.env.COMPREFACE_API_KEY;

  console.log('=========================================');
  console.log(' Probando conexión con CompreFace...     ');
  console.log('=========================================');
  console.log('Endpoint:', endpoint);
  console.log('API Key:', apiKey === 'YOUR_COMPREFACE_API_KEY' ? '⚠️ VALOR POR DEFECTO (REEMPLAZAR EN .ENV)' : apiKey);
  console.log('=========================================\n');

  if (!apiKey || apiKey === 'YOUR_COMPREFACE_API_KEY') {
    console.error('❌ Error: COMPREFACE_API_KEY no está definida en backend/.env');
    console.error('👉 Por favor, crea una cuenta en el panel de CompreFace, crea un "Face Verification Service" y copia su API Key.');
    return;
  }

  const url = `${endpoint}/api/v1/verification/verify`;

  // Descargamos dos fotos públicas de rostros para simular la comparación
  const image1Url = 'https://raw.githubusercontent.com/Azure-Samples/cognitive-services-sample-data-files/master/Face/images/Family1-Dad1.jpg';
  const image2Url = 'https://raw.githubusercontent.com/Azure-Samples/cognitive-services-sample-data-files/master/Face/images/Family1-Dad1.jpg'; // Misma persona

  try {
    console.log('1. Descargando imágenes de prueba...');
    const [img1Res, img2Res] = await Promise.all([
      axios.get(image1Url, { responseType: 'arraybuffer' }),
      axios.get(image2Url, { responseType: 'arraybuffer' })
    ]);

    const webcamBuffer = Buffer.from(img1Res.data);
    const referenceBuffer = Buffer.from(img2Res.data);

    console.log('2. Enviando imágenes a CompreFace local...');
    const formData = new FormData();
    formData.append('source_image', new Blob([webcamBuffer], { type: 'image/jpeg' }), 'webcam.jpg');
    formData.append('target_image', new Blob([referenceBuffer], { type: 'image/jpeg' }), 'reference.jpg');

    const res = await axios.post(url, formData, {
      headers: {
        'x-api-key': apiKey
      }
    });

    console.log('🟢 CONEXIÓN COMPREFACE OK! Status HTTP:', res.status);
    console.log('Respuesta recibida:', JSON.stringify(res.data, null, 2));

    const match = res.data.result?.[0]?.face_matches?.[0];
    const similarity = match ? match.similarity : 0;

    console.log(`\n📊 Análisis del resultado:`);
    console.log(`   - Similitud calculada: ${(similarity * 100).toFixed(2)}%`);
    if (similarity >= 0.90) {
      console.log('   - 🎉 ¡ROSTROS COINCIDEN! (La validación es exitosa).');
    } else {
      console.log('   - ⚠️ Rostros no coinciden o la similitud es baja.');
    }
  } catch (err) {
    console.error('\n❌ ERROR EN LA CONEXIÓN:');
    if (err.response) {
      console.error('   Código HTTP:', err.response.status);
      console.error('   Respuesta del servidor:', JSON.stringify(err.response.data, null, 2));
      if (err.response.status === 401) {
        console.error('   👉 Consejo: La API Key de CompreFace en .env es inválida o incorrecta.');
      }
    } else {
      console.error('   Detalle del error:', err.message);
      console.error('   👉 Consejo: Asegúrate de que el contenedor de Docker de CompreFace esté encendido y respondiendo en el puerto 8000.');
    }
  }
}

testCompreFace();
