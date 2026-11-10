const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ARTIFACT_DIR = 'C:\\Users\\spawx\\.gemini\\antigravity\\brain\\b4624a5a-0b28-4372-b4bb-61ca67ed7ef1';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

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
  const testHtml = path.join(distDir, 'test_cf_sample.html');
  fs.writeFileSync(
    testHtml,
    makeRedirectHtml('/analitica?tab=bi_executive&category=team&report=cash_flow&sample=1&start=2026-10-01&end=2026-10-31'),
    'utf8'
  );

  const tmpUserData = path.join(__dirname, '../tmp_chrome_cf_sample');
  if (!fs.existsSync(tmpUserData)) fs.mkdirSync(tmpUserData, { recursive: true });

  const sampleImg = path.join(ARTIFACT_DIR, 'cash_flow_visual_sample.png');

  console.log('Capturando vista con Datos de Ejemplo en 1280x1400...');
  execSync(`"${CHROME_PATH}" --headless=new --no-sandbox --disable-gpu --user-data-dir="${tmpUserData}" --window-size=1280,1400 --screenshot="${sampleImg}" --virtual-time-budget=9000 "http://127.0.0.1:5005/test_cf_sample.html"`);
  console.log('✅ Vista con Datos de Ejemplo guardada en:', sampleImg);

  if (fs.existsSync(testHtml)) fs.unlinkSync(testHtml);
  if (fs.existsSync(tmpUserData)) fs.rmSync(tmpUserData, { recursive: true, force: true });
}

capture().catch(err => {
  console.error('Error durante la captura:', err);
  process.exit(1);
});

