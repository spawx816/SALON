const { spawn, execSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ARTIFACT_DIR = 'C:\\Users\\spawx\\.gemini\\antigravity\\brain\\b4624a5a-0b28-4372-b4bb-61ca67ed7ef1';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 5025;

function waitForHttp(url, timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(url, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 400) resolve(true);
        else retry();
      });
      req.on('error', retry);
      req.setTimeout(1000, () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) reject(new Error(`Timeout esperando a ${url}`));
      else setTimeout(check, 500);
    };
    check();
  });
}

function makeRedirectHtml(destUrl) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><script>
localStorage.setItem('salon_pro_user', JSON.stringify({
  id: 1,
  nombre: 'Admin Ejecutivo',
  email: 'admin@salonpro.com',
  role: 'admin',
  permissions: { view_analytics: true }
}));
window.location.replace('${destUrl}');
</script></body></html>`;
}

async function capture() {
  const distDir = path.join(__dirname, '../dist');
  const testRealHtml = path.join(distDir, 'test_cf_real.html');
  const testSampleHtml = path.join(distDir, 'test_cf_sample.html');

  fs.writeFileSync(
    testRealHtml,
    makeRedirectHtml(`/analitica?tab=bi_executive&category=team&report=cash_flow&period=custom&start=2026-10-01&end=2026-10-31`),
    'utf8'
  );

  fs.writeFileSync(
    testSampleHtml,
    makeRedirectHtml(`/analitica?tab=bi_executive&category=team&report=cash_flow&sample=1&period=custom&start=2026-10-01&end=2026-10-31`),
    'utf8'
  );

  console.log(`Iniciando servidor temporal en puerto ${PORT}...`);
  const serverProc = spawn('node', [path.join(__dirname, '../backend/server.js')], {
    env: { ...process.env, PORT: String(PORT), DISABLE_SCHEDULER: 'true' },
    stdio: 'ignore'
  });

  try {
    await waitForHttp(`http://127.0.0.1:${PORT}/api/salons`);
    console.log('✅ Servidor listo.');

    const tmpUserData = path.join(__dirname, '../tmp_chrome_cf');
    if (!fs.existsSync(tmpUserData)) fs.mkdirSync(tmpUserData, { recursive: true });

    const desktopRealImg = path.join(ARTIFACT_DIR, 'cash_flow_visual_desktop.png');
    const mobileRealImg = path.join(ARTIFACT_DIR, 'cash_flow_visual_mobile.png');
    const sampleImg = path.join(ARTIFACT_DIR, 'cash_flow_visual_sample.png');
    const mobileSampleImg = path.join(ARTIFACT_DIR, 'cash_flow_visual_mobile_sample.png');

    console.log('Capturando vista Desktop Real en 1280x1550...');
    execSync(`"${CHROME_PATH}" --headless=new --no-sandbox --disable-gpu --user-data-dir="${tmpUserData}" --window-size=1280,1550 --screenshot="${desktopRealImg}" --virtual-time-budget=9000 "http://127.0.0.1:${PORT}/test_cf_real.html"`);
    console.log('✅ Vista Desktop Real guardada:', desktopRealImg);

    console.log('Capturando vista Mobile Real en 420x2200...');
    execSync(`"${CHROME_PATH}" --headless=new --no-sandbox --disable-gpu --user-data-dir="${tmpUserData}" --window-size=420,2200 --screenshot="${mobileRealImg}" --virtual-time-budget=9000 "http://127.0.0.1:${PORT}/test_cf_real.html"`);
    console.log('✅ Vista Mobile Real guardada:', mobileRealImg);

    console.log('Capturando vista Datos de Ejemplo Desktop en 1280x1550...');
    execSync(`"${CHROME_PATH}" --headless=new --no-sandbox --disable-gpu --user-data-dir="${tmpUserData}" --window-size=1280,1550 --screenshot="${sampleImg}" --virtual-time-budget=9000 "http://127.0.0.1:${PORT}/test_cf_sample.html"`);
    console.log('✅ Vista Datos de Ejemplo Desktop guardada:', sampleImg);

    console.log('Capturando vista Datos de Ejemplo Mobile en 420x2200...');
    execSync(`"${CHROME_PATH}" --headless=new --no-sandbox --disable-gpu --user-data-dir="${tmpUserData}" --window-size=420,2200 --screenshot="${mobileSampleImg}" --virtual-time-budget=9000 "http://127.0.0.1:${PORT}/test_cf_sample.html"`);
    console.log('✅ Vista Datos de Ejemplo Mobile guardada:', mobileSampleImg);

    if (fs.existsSync(tmpUserData)) fs.rmSync(tmpUserData, { recursive: true, force: true });
  } finally {
    if (fs.existsSync(testRealHtml)) fs.unlinkSync(testRealHtml);
    if (fs.existsSync(testSampleHtml)) fs.unlinkSync(testSampleHtml);
    try {
      serverProc.kill();
      process.kill(serverProc.pid);
    } catch (e) {}
  }
}

capture().then(() => {
  console.log('Captura completa.');
  process.exit(0);
}).catch(err => {
  console.error('Error durante la captura:', err);
  process.exit(1);
});
