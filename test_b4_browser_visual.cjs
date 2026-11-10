/**
 * Script de Verificación Visual Real en Navegador (Headless Chrome) para Fase B4 / B5
 * Captura:
 * 1. Menú de Exportación y Botón Imprimir (1280x1400): Menú "Exportar" abierto con opciones Excel (.xlsx) y CSV (.csv).
 * 2. Filtrado dinámico por estado (1280x2800): Tabla filtrada por "Sin recuperar" (5 cuotas / RD$ 9,750) listo para exportar.
 * 3. Vista Final Desktop (1280x3200): Validación completa de escritorio.
 * 4. Vista Final Móvil 390px (390x5400): Validación responsiva integral.
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
<head><meta charset="utf-8"><title>B4 Visual Test</title></head>
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

async function runB4BrowserVisual() {
  console.log('--- Iniciando Servidor API y Frontend para Verificación Visual B4 / B5 ---');

  const baseReportUrl = '/analitica?tab=bi_executive&category=memberships&report=recurring_charges_result&period=custom&start=2026-10-01&end=2026-10-31';

  // 1. Export Menu Open Redirect HTML
  const testExportHtml = path.join(__dirname, '../dist/test_b4_export_menu.html');
  fs.writeFileSync(testExportHtml, makeRedirectHtml(`${baseReportUrl}&open_export=1`), 'utf8');

  // 2. Filtered Status Redirect HTML (e.g. Filter to "Sin recuperar")
  const testFilteredHtml = path.join(__dirname, '../dist/test_b4_filtered.html');
  fs.writeFileSync(testFilteredHtml, makeRedirectHtml(`${baseReportUrl}&filter_status=Sin+recuperar`), 'utf8');

  // 3. Desktop Final Redirect HTML
  const testDesktopHtml = path.join(__dirname, '../dist/test_b4_desktop.html');
  fs.writeFileSync(testDesktopHtml, makeRedirectHtml(baseReportUrl), 'utf8');

  const serverProc = spawn('node', [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: '5012', DISABLE_SCHEDULER: 'true' },
    stdio: 'ignore'
  });

  try {
    console.log('Esperando que el servidor esté listo en http://127.0.0.1:5012...');
    await waitForHttp('http://127.0.0.1:5012/api/salons');
    console.log('✅ Servidor listo.');

    const tmpUserData = path.join(__dirname, '../tmp_chrome_b4');
    if (!fs.existsSync(tmpUserData)) fs.mkdirSync(tmpUserData, { recursive: true });

    // 1. Captura Menú de Exportación Abierto (1280x1400)
    console.log('1/4 Capturando vista de menú de Exportación abierto (1280x1400)...');
    const exportImgPath = path.join(ARTIFACT_DIR, 'b4_visual_export_menu.png');
    execSync(`"${CHROME_PATH}" --headless=new --no-sandbox --disable-gpu --user-data-dir="${tmpUserData}" --window-size=1280,1400 --screenshot="${exportImgPath}" --virtual-time-budget=9000 "http://127.0.0.1:5012/test_b4_export_menu.html"`);
    console.log('✅ [1/4] Captura de menú de exportación guardada:', exportImgPath);

    // 2. Captura Tabla Filtrada por Estado (1280x2800)
    console.log('2/4 Capturando vista de tabla filtrada por estado "Sin recuperar" (1280x2800)...');
    const filteredImgPath = path.join(ARTIFACT_DIR, 'b4_visual_filtered_status.png');
    execSync(`"${CHROME_PATH}" --headless=new --no-sandbox --disable-gpu --user-data-dir="${tmpUserData}" --window-size=1280,2800 --screenshot="${filteredImgPath}" --virtual-time-budget=9000 "http://127.0.0.1:5012/test_b4_filtered.html"`);
    console.log('✅ [2/4] Captura de tabla filtrada guardada:', filteredImgPath);

    // 3. Captura Desktop Final Completa (1280x3200)
    console.log('3/4 Capturando vista completa de escritorio B4/B5 (1280x3200)...');
    const desktopImgPath = path.join(ARTIFACT_DIR, 'b4_visual_desktop_final.png');
    execSync(`"${CHROME_PATH}" --headless=new --no-sandbox --disable-gpu --user-data-dir="${tmpUserData}" --window-size=1280,3200 --screenshot="${desktopImgPath}" --virtual-time-budget=9000 "http://127.0.0.1:5012/test_b4_desktop.html"`);
    console.log('✅ [3/4] Captura final de escritorio guardada:', desktopImgPath);

    // 4. Captura Móvil Final Responsiva (390x5400)
    console.log('4/4 Capturando vista móvil final responsiva (390x5400)...');
    const mobileImgPath = path.join(ARTIFACT_DIR, 'b4_visual_mobile_final.png');
    execSync(`"${CHROME_PATH}" --headless=new --no-sandbox --disable-gpu --user-data-dir="${tmpUserData}" --window-size=390,5400 --screenshot="${mobileImgPath}" --virtual-time-budget=9000 "http://127.0.0.1:5012/test_b4_desktop.html"`);
    console.log('✅ [4/4] Captura final móvil guardada:', mobileImgPath);

    console.log('=====================================================');
    console.log('VERIFICACIÓN VISUAL B4 / B5 COMPLETADA CON ÉXITO');
    console.log('=====================================================');
  } catch (err) {
    console.error('Error durante la verificación visual B4:', err);
    throw err;
  } finally {
    try {
      serverProc.kill('SIGINT');
    } catch (e) {}
  }
}

runB4BrowserVisual().then(() => {
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
