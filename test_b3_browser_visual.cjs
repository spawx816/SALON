/**
 * Script de Verificación Visual Real en Navegador (Headless Chrome) para Fase B3
 * Captura:
 * 1. Escritorio (1280x3200): KPIs, gráficos, y Tabla Principal completa (B3.1).
 * 2. Detalle Expandido de Intentos (1280x2000): Fila expandida con acordeón de reintentos y subpaginación (B3.2).
 * 3. Pagos Pendientes de Conciliación (1280x1400): Sección independiente informativa de pagos sin atribución (B3.4).
 * 4. Móvil Responsivo (390x5600): Vista móvil 390px con scroll horizontal y tabla adaptable (B3.7).
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
<head><meta charset="utf-8"><title>B3 Visual Test</title></head>
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

async function runB3BrowserVisual() {
  console.log('--- Iniciando Servidor API y Frontend para Verificación Visual B3 ---');

  const baseReportUrl = '/analitica?tab=bi_executive&category=memberships&report=recurring_charges_result&period=custom&start=2026-10-01&end=2026-10-31';

  // 1. Desktop Redirect HTML
  const testDesktopHtml = path.join(__dirname, '../dist/test_b3_desktop.html');
  fs.writeFileSync(testDesktopHtml, makeRedirectHtml(baseReportUrl), 'utf8');

  // 2. Expanded Row HTML
  const testExpandedHtml = path.join(__dirname, '../dist/test_b3_expanded.html');
  fs.writeFileSync(testExpandedHtml, makeRedirectHtml(`${baseReportUrl}&expand_first=1`), 'utf8');

  // 3. Unmatched Payments HTML
  const testUnmatchedHtml = path.join(__dirname, '../dist/test_b3_unmatched.html');
  fs.writeFileSync(testUnmatchedHtml, makeRedirectHtml(`${baseReportUrl}&scroll_to=unmatched`), 'utf8');

  const serverProc = spawn('node', [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: '5010', DISABLE_SCHEDULER: 'true' },
    stdio: 'ignore'
  });

  try {
    console.log('Esperando que el servidor esté listo en http://127.0.0.1:5010...');
    await waitForHttp('http://127.0.0.1:5010/api/salons');
    console.log('✅ Servidor listo.');

    const tmpUserData = path.join(__dirname, '../tmp_chrome_b3');
    if (!fs.existsSync(tmpUserData)) fs.mkdirSync(tmpUserData, { recursive: true });

    // 1. Captura Desktop Completa (1280x3200)
    console.log('1/4 Capturando vista de escritorio B3: Tabla Principal y KPIs (1280x3200)...');
    const desktopImgPath = path.join(ARTIFACT_DIR, 'b3_visual_desktop.png');
    execSync(`"${CHROME_PATH}" --headless=new --no-sandbox --disable-gpu --user-data-dir="${tmpUserData}" --window-size=1280,3200 --screenshot="${desktopImgPath}" --virtual-time-budget=9000 "http://127.0.0.1:5010/test_b3_desktop.html"`);
    console.log('✅ [1/4] Captura de escritorio guardada:', desktopImgPath);

    // 2. Captura Detalle Expandido de Intentos (1280x2000)
    console.log('2/4 Capturando vista de Detalle Expandido de Intentos (1280x2000)...');
    const expandedImgPath = path.join(ARTIFACT_DIR, 'b3_visual_expanded_attempts.png');
    execSync(`"${CHROME_PATH}" --headless=new --no-sandbox --disable-gpu --user-data-dir="${tmpUserData}" --window-size=1280,2000 --screenshot="${expandedImgPath}" --virtual-time-budget=9000 "http://127.0.0.1:5010/test_b3_expanded.html"`);
    console.log('✅ [2/4] Captura de intentos expandidos guardada:', expandedImgPath);

    // 3. Captura Sección Pagos Pendientes de Conciliación Contractual (1280x1400)
    console.log('3/4 Capturando vista de Pagos Pendientes de Conciliación Contractual (1280x1400)...');
    const unmatchedImgPath = path.join(ARTIFACT_DIR, 'b3_visual_unmatched_payments.png');
    execSync(`"${CHROME_PATH}" --headless=new --no-sandbox --disable-gpu --user-data-dir="${tmpUserData}" --window-size=1280,1400 --screenshot="${unmatchedImgPath}" --virtual-time-budget=9000 "http://127.0.0.1:5010/test_b3_unmatched.html"`);
    console.log('✅ [3/4] Captura de pagos sin atribución guardada:', unmatchedImgPath);

    // 4. Captura Móvil Responsiva (390x5600)
    console.log('4/4 Capturando vista móvil responsiva B3 (390x5600)...');
    const mobileImgPath = path.join(ARTIFACT_DIR, 'b3_visual_mobile.png');
    execSync(`"${CHROME_PATH}" --headless=new --no-sandbox --disable-gpu --user-data-dir="${tmpUserData}" --window-size=390,5600 --screenshot="${mobileImgPath}" --virtual-time-budget=9000 "http://127.0.0.1:5010/test_b3_desktop.html"`);
    console.log('✅ [4/4] Captura móvil guardada:', mobileImgPath);

    console.log('=====================================================');
    console.log('VERIFICACIÓN VISUAL B3 COMPLETADA CON ÉXITO');
    console.log('=====================================================');
  } catch (err) {
    console.error('Error durante la verificación visual B3:', err);
    throw err;
  } finally {
    try {
      serverProc.kill('SIGINT');
    } catch (e) {}
  }
}

runB3BrowserVisual().then(() => {
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
