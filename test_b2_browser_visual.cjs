/**
 * Script de Verificación Visual Real en Navegador (Headless Chrome) para Fase B2
 * Captura:
 * 1. Escritorio (1280x1600): KPIs, conciliación y los 4 gráficos financieros reales.
 * 2. Móvil (390x2800): Adaptación responsiva completa en smartphone.
 * 3. Enfoque / Zoom de los 4 gráficos (1280x1050).
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
<head><meta charset="utf-8"><title>B2 Visual Test</title></head>
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

async function runB2BrowserVisual() {
  console.log('--- Iniciando Servidor API y Frontend para Verificación Visual B2 ---');

  const testDesktopHtml = path.join(__dirname, '../dist/test_b2_desktop.html');
  fs.writeFileSync(testDesktopHtml, 
    makeRedirectHtml('/analitica?tab=bi_executive&category=memberships&report=recurring_charges_result&period=custom&start=2026-10-01&end=2026-10-31'), 'utf8');

  const serverProc = spawn('node', [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: '5007', DISABLE_SCHEDULER: 'true' },
    stdio: 'ignore'
  });

  try {
    console.log('Esperando que el servidor esté listo en http://127.0.0.1:5007...');
    await waitForHttp('http://127.0.0.1:5007/api/salons');
    console.log('✅ Servidor listo.');

    const tmpUserData = path.join(__dirname, '../tmp_chrome_b2');
    if (!fs.existsSync(tmpUserData)) fs.mkdirSync(tmpUserData, { recursive: true });

    // 1. Captura Desktop Completa (1280x1650)
    console.log('1/3 Capturando vista completa de escritorio B2 (1280x1650)...');
    const desktopImgPath = path.join(ARTIFACT_DIR, 'b2_visual_desktop.png');
    execSync(`"${CHROME_PATH}" --headless=new --no-sandbox --disable-gpu --user-data-dir="${tmpUserData}" --window-size=1280,1650 --screenshot="${desktopImgPath}" --virtual-time-budget=9000 "http://127.0.0.1:5007/test_b2_desktop.html"`);
    console.log('✅ [1/3] Captura de escritorio guardada:', desktopImgPath);

    // 2. Captura Móvil Responsiva (390x2900)
    console.log('2/3 Capturando vista móvil responsiva B2 (390x2900)...');
    const mobileImgPath = path.join(ARTIFACT_DIR, 'b2_visual_mobile.png');
    execSync(`"${CHROME_PATH}" --headless=new --no-sandbox --disable-gpu --user-data-dir="${tmpUserData}" --window-size=390,2900 --screenshot="${mobileImgPath}" --virtual-time-budget=9000 "http://127.0.0.1:5007/test_b2_desktop.html"`);
    console.log('✅ [2/3] Captura móvil guardada:', mobileImgPath);

    // 3. Captura Detallada Enfoque Gráficos (1280x1050)
    console.log('3/4 Capturando enfoque de los cuatro gráficos B2...');
    const chartsZoomPath = path.join(ARTIFACT_DIR, 'b2_visual_charts_zoom.png');
    execSync(`"${CHROME_PATH}" --headless=new --no-sandbox --disable-gpu --user-data-dir="${tmpUserData}" --window-size=1280,1050 --screenshot="${chartsZoomPath}" --virtual-time-budget=9000 "http://127.0.0.1:5007/test_b2_desktop.html"`);
    console.log('✅ [3/4] Captura de enfoque de gráficos guardada:', chartsZoomPath);

    // 4. Captura con Datos de Ejemplo de Maqueta (1280x1100 con demo=1)
    console.log('4/4 Capturando vista idéntica con Datos de Ejemplo (1280x1100)...');
    const testDemoHtml = path.join(__dirname, '../dist/test_b2_demo.html');
    fs.writeFileSync(testDemoHtml, 
      makeRedirectHtml('/analitica?tab=bi_executive&category=memberships&report=recurring_charges_result&period=custom&start=2026-10-01&end=2026-10-31&demo=1'), 'utf8');
    const demoImgPath = path.join(ARTIFACT_DIR, 'b2_visual_mockup_demo.png');
    execSync(`"${CHROME_PATH}" --headless=new --no-sandbox --disable-gpu --user-data-dir="${tmpUserData}" --window-size=1280,1100 --screenshot="${demoImgPath}" --virtual-time-budget=9000 "http://127.0.0.1:5007/test_b2_demo.html"`);
    console.log('✅ [4/4] Captura de datos de ejemplo guardada:', demoImgPath);
    try { if (fs.existsSync(testDemoHtml)) fs.unlinkSync(testDemoHtml); } catch (_) {}

    console.log('=====================================================');
    console.log('VERIFICACIÓN VISUAL B2 COMPLETADA CON ÉXITO');
    console.log('=====================================================');
  } catch (err) {
    console.error('Error durante captura visual:', err);
    throw err;
  } finally {
    serverProc.kill();
    try {
      if (fs.existsSync(testDesktopHtml)) fs.unlinkSync(testDesktopHtml);
    } catch (_) {}
    try {
      if (fs.existsSync(tmpUserData)) fs.rmSync(tmpUserData, { recursive: true, force: true });
    } catch (_) {}
  }
}

runB2BrowserVisual().catch(e => {
  console.error(e);
  process.exit(1);
});

