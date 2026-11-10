/**
 * Script de Verificación Visual Real en Navegador (Headless Chrome) para Fase B1
 * Captura:
 * 1. Escritorio (Octubre 2026: 4 KPIs reales, banner de conciliación independiente con 2 pagos y RD$ 3,900)
 * 2. Móvil (390x1600 responsivo)
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
<head><meta charset="utf-8"><title>B1 Visual Test</title></head>
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

async function runB1BrowserVisual() {
  console.log('--- Iniciando Servidor API y Frontend para Verificación Visual B1 ---');

  // Escribir páginas puente en dist/
  const testDesktopHtml = path.join(__dirname, '../dist/test_b1_desktop.html');
  fs.writeFileSync(testDesktopHtml, 
    makeRedirectHtml('/analitica?tab=bi_executive&category=memberships&report=recurring_charges_result&period=custom&start=2026-10-01&end=2026-10-31'), 'utf8');

  const serverProc = spawn('node', [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: '5006', DISABLE_SCHEDULER: 'true' },
    stdio: 'ignore'
  });

  try {
    console.log('Esperando que el servidor esté listo en http://127.0.0.1:5006...');
    await waitForHttp('http://127.0.0.1:5006/api/salons');
    console.log('✅ Servidor listo.');

    const tmpUserData = path.join(__dirname, '../tmp_chrome_b1');
    if (!fs.existsSync(tmpUserData)) fs.mkdirSync(tmpUserData, { recursive: true });

    // 1. Captura Desktop (1280x1250)
    console.log('1/2 Capturando vista de escritorio B1 (1280x1250)...');
    const desktopImgPath = path.join(ARTIFACT_DIR, 'b1_visual_desktop.png');
    execSync(`"${CHROME_PATH}" --headless=new --no-sandbox --disable-gpu --user-data-dir="${tmpUserData}" --window-size=1280,1250 --screenshot="${desktopImgPath}" --virtual-time-budget=8000 "http://127.0.0.1:5006/test_b1_desktop.html"`);
    console.log('✅ [1/2] Captura de escritorio guardada:', desktopImgPath);

    // 2. Captura Móvil (390x2200)
    console.log('2/2 Capturando vista móvil responsiva B1 (390x2200)...');
    const mobileImgPath = path.join(ARTIFACT_DIR, 'b1_visual_mobile.png');
    execSync(`"${CHROME_PATH}" --headless=new --no-sandbox --disable-gpu --user-data-dir="${tmpUserData}" --window-size=390,2200 --screenshot="${mobileImgPath}" --virtual-time-budget=8000 "http://127.0.0.1:5006/test_b1_desktop.html"`);
    console.log('✅ [2/2] Captura móvil guardada:', mobileImgPath);

    console.log('=====================================================');
    console.log('VERIFICACIÓN VISUAL B1 COMPLETADA CON ÉXITO');
    console.log('=====================================================');
  } catch (err) {
    console.error('Error durante captura visual:', err);
    throw err;
  } finally {
    serverProc.kill();
    try {
      if (fs.existsSync(testDesktopHtml)) fs.unlinkSync(testDesktopHtml);
    } catch (_) {}
  }
}

runB1BrowserVisual().catch(e => {
  console.error(e);
  process.exit(1);
});
