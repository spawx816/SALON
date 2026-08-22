require('dotenv').config();
const axios = require('axios');

async function testEndpoint(name, url, key) {
  console.log(`Probando endpoint [${name}]: ${url}`);
  const sampleImageUrl = 'https://raw.githubusercontent.com/Azure-Samples/cognitive-services-sample-data-files/master/Face/images/Family1-Dad1.jpg';

  try {
    const res = await axios.post(url, { url: sampleImageUrl }, {
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/json'
      }
    });

    console.log(`🟢 ÉXITO [${name}]: Status ${res.status}`);
    if (res.data && res.data.length > 0) {
      console.log(`   Rostro detectado con éxito! faceId: ${res.data[0].faceId}\n`);
      return true;
    } else {
      console.log('   Respuesta recibida pero no se detectaron rostros.\n');
      return false;
    }
  } catch (err) {
    console.log(`🔴 FALLO [${name}]:`);
    if (err.response) {
      console.log(`   Status HTTP: ${err.response.status}`);
      console.log(`   Error: ${JSON.stringify(err.response.data.error || err.response.data)}\n`);
    } else {
      console.log(`   Mensaje: ${err.message}\n`);
    }
    return false;
  }
}

async function testAzure() {
  const customEndpoint = (process.env.AZURE_FACE_ENDPOINT || '').replace(/\/$/, '');
  const key = process.env.AZURE_FACE_KEY;

  console.log('=========================================');
  console.log(' Probando conexión con Azure Face API... ');
  console.log('=========================================');
  console.log('Endpoint en .env:', customEndpoint);
  console.log('Key en .env (primeros 8 caracteres):', key ? key.substring(0, 8) + '...' : 'No definida');
  console.log('Key en .env (longitud total):', key ? key.length : 0);
  console.log('=========================================\n');

  if (!key || !customEndpoint) {
    console.error('❌ Error: AZURE_FACE_KEY o AZURE_FACE_ENDPOINT no están definidos en backend/.env');
    return;
  }

  // 1. Probar con custom subdomain del .env
  const urlCustom = `${customEndpoint}/face/v1.0/detect?returnFaceId=true&recognitionModel=recognition_04&detectionModel=detection_03`;
  await testEndpoint('Custom Subdomain (.env)', urlCustom, key);

  // 2. Probar con regional endpoint (eastus)
  const urlRegional = `https://eastus.api.cognitive.microsoft.com/face/v1.0/detect?returnFaceId=true&recognitionModel=recognition_04&detectionModel=detection_03`;
  await testEndpoint('Regional East US (Respaldo)', urlRegional, key);
}

testAzure();
