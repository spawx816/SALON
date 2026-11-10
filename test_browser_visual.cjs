/**
 * Script de Verificación Visual Real en Navegador (Headless Chrome)
 * Inicia el servidor temporalmente y captura:
 * 1. Escritorio (next_365_days con 64 contratos y RD$ 51,200)
 * 2. Móvil (390x1600 con KPIs y tabla apilada)
 * 3. Mayo 2027 (8 contratos y RD$ 6,400)
 * 4. Período vacío (mensaje formal de no registros)
 * 5. Error del servidor y botón "Reintentar"
 */
const { spawn, execSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ARTIFACT_DIR = 'C:\\Users\\spawx\\.gemini\\antigravity\\brain\\b4624a5a-0b28-4372-b4bb-61ca67ed7ef1';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function waitForHttp(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          if (res.statusCode >= 200 && res.statusCode < 400) resolve(true);
          else reject(new Error(`Status ${res.statusCode}`));
        });
        req.on('error', reject);
        req.setTimeout(1000, () => req.destroy(new Error('timeout')));
      });
      return true;
    } catch (e) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw new Error(`Timeout esperando a ${url}`);
}

function makeRedirectHtml(destUrl) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>RF07 Visual Test</title></head>
<body>
  <script>
    try {
      localStorage.setItem('salon_pro_user', JSON.stringify({
        id: 1,
        nombre: 'Administrador General',
        email: 'admin@salonpro.com',
        role: 'admin',
        permissions: { view_analytics: true }
      }));
      window.location.replace('${destUrl}');
    } catch (err) {
      document.body.innerHTML = 'Error: ' + err.message;
    }
  </script>
</body>
</html>`;
}

async function runBrowserVisual() {
  console.log('--- Iniciando Servidor API y Frontend para Verificación Visual ---');

  // Escribir páginas puente en dist/
  fs.writeFileSync(path.join(__dirname, '../dist/test_auth_desktop.html'), 
    makeRedirectHtml('/analitica?tab=bi_executive&category=memberships&report=contracts_upcoming_renewal'), 'utf8');

  fs.writeFileSync(path.join(__dirname, '../dist/test_auth_may.html'), 
    makeRedirectHtml('/analitica?tab=bi_executive&category=memberships&report=contracts_upcoming_renewal&period=custom&start=2027-05-01&end=2027-05-31'), 'utf8');

  fs.writeFileSync(path.join(__dirname, '../dist/test_auth_empty.html'), 
    makeRedirectHtml('/analitica?tab=bi_executive&category=memberships&report=contracts_upcoming_renewal&period=custom&start=2026-11-04&end=2026-11-05'), 'utf8');

  fs.writeFileSync(path.join(__dirname, '../dist/test_auth_error.html'), 
    makeRedirectHtml('/analitica?tab=bi_executive&category=memberships&report=contracts_upcoming_renewal&simulate_error=1'), 'utf8');

  const serverProc = spawn('node', [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: '5005', DISABLE_SCHEDULER: 'true' },
    stdio: 'ignore'
  });

  try {
    console.log('Esperando que el servidor esté listo en http://127.0.0.1:5005...');
    await waitForHttp('http://127.0.0.1:5005/api/salons');
    console.log('✅ Servidor listo.');

    const tmpUserData = path.join(__dirname, '../tmp_chrome_profile');
    if (!fs.existsSync(tmpUserData)) fs.mkdirSync(tmpUserData, { recursive: true });

    // 1. Captura Desktop (1280x950)
    console.log('1/5 Capturando vista de escritorio inicial (1280x950)...');
    const desktopImgPath = path.join(ARTIFACT_DIR, 'rf07_visual_desktop.png');
    execSync(`"${CHROME_PATH}" --headless=new --no-sandbox --disable-gpu --user-data-dir="${tmpUserData}" --window-size=1280,950 --screenshot="${desktopImgPath}" --virtual-time-budget=6000 "http://127.0.0.1:5005/test_auth_desktop.html"`);
    console.log('✅ [1/5] Captura de escritorio guardada:', desktopImgPath);

    // 2. Captura Móvil (390x1600)
    console.log('2/5 Capturando vista móvil responsiva (390x1600)...');
    const mobileImgPath = path.join(ARTIFACT_DIR, 'rf07_visual_mobile.png');
    execSync(`"${CHROME_PATH}" --headless=new --no-sandbox --disable-gpu --user-data-dir="${tmpUserData}" --window-size=390,1600 --screenshot="${mobileImgPath}" --virtual-time-budget=6000 "http://127.0.0.1:5005/test_auth_desktop.html"`);
    console.log('✅ [2/5] Captura móvil guardada:', mobileImgPath);

    // 3. Captura Mayo 2027 (1280x1600)
    console.log('3/5 Capturando consulta de Mayo 2027 (1280x1600)...');
    const mayImgPath = path.join(ARTIFACT_DIR, 'rf07_visual_may2027.png');
    execSync(`"${CHROME_PATH}" --headless=new --no-sandbox --disable-gpu --user-data-dir="${tmpUserData}" --window-size=1280,1600 --screenshot="${mayImgPath}" --virtual-time-budget=6000 "http://127.0.0.1:5005/test_auth_may.html"`);
    console.log('✅ [3/5] Captura de Mayo 2027 guardada:', mayImgPath);

    // 4. Captura Resultados Vacíos (1280x950)
    console.log('4/5 Capturando resultados vacíos (1280x950)...');
    const emptyImgPath = path.join(ARTIFACT_DIR, 'rf07_visual_empty.png');
    execSync(`"${CHROME_PATH}" --headless=new --no-sandbox --disable-gpu --user-data-dir="${tmpUserData}" --window-size=1280,950 --screenshot="${emptyImgPath}" --virtual-time-budget=6000 "http://127.0.0.1:5005/test_auth_empty.html"`);
    console.log('✅ [4/5] Captura de resultados vacíos guardada:', emptyImgPath);

    // 5. Captura Error del Servidor y Botón Reintentar (1280x950)
    console.log('5/5 Capturando banner de error del servidor (1280x950)...');
    const errorImgPath = path.join(ARTIFACT_DIR, 'rf07_visual_error.png');
    execSync(`"${CHROME_PATH}" --headless=new --no-sandbox --disable-gpu --user-data-dir="${tmpUserData}" --window-size=1280,950 --screenshot="${errorImgPath}" --virtual-time-budget=6000 "http://127.0.0.1:5005/test_auth_error.html"`);
    console.log('✅ [5/5] Captura de error del servidor guardada:', errorImgPath);

    console.log('\n--- VERIFICACIÓN VISUAL EN CHROMIUM COMPLETADA CON ÉXITO ---');

  } catch (err) {
    console.error('Error durante verificación visual:', err.message);
  } finally {
    serverProc.kill();
    const tempFiles = ['test_auth_desktop.html', 'test_auth_may.html', 'test_auth_empty.html', 'test_auth_error.html'];
    for (const f of tempFiles) {
      try {
        const p = path.join(__dirname, '../dist', f);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch (_) {}
    }
    try {
      const tmpP = path.join(__dirname, '../tmp_chrome_profile');
      if (fs.existsSync(tmpP)) fs.rmSync(tmpP, { recursive: true, force: true });
    } catch (_) {}
  }
}

runBrowserVisual();
