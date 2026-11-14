#!/usr/bin/env node
/**
 * Release Chunks & Static Cache Verification Gate
 *
 * Local mode:  node backend/scripts/verify_release_chunks.cjs
 * Live mode:   node backend/scripts/verify_release_chunks.cjs --url https://staging.etereasapp.com --basic user:pass
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const distDir = path.resolve(__dirname, '../../dist');
const indexPath = path.join(distDir, 'index.html');

function verifyLocalDist() {
  assert(fs.existsSync(indexPath), `Missing dist/index.html at ${indexPath}. Run npm run build first.`);
  const html = fs.readFileSync(indexPath, 'utf8');
  const assetRefs = [];
  const refRegex = /(?:src|href)=["'](\/assets\/[^"']+)["']/g;
  let m;
  while ((m = refRegex.exec(html)) !== null) {
    assetRefs.push(m[1]);
  }
  assert(assetRefs.length > 0, 'dist/index.html does not reference any /assets/* files');

  const entryJsRefs = assetRefs.filter((r) => /\.js$/i.test(r));
  assert(entryJsRefs.length > 0, 'dist/index.html does not reference a module entrypoint .js in /assets/');

  for (const ref of assetRefs) {
    const filePath = path.join(distDir, ref.replace(/^\//, ''));
    assert(fs.existsSync(filePath), `Referenced asset in index.html missing on disk: ${ref}`);
  }

  // Verify relative chunk imports inside every built JS file resolve inside dist/assets
  const assetsDir = path.join(distDir, 'assets');
  const jsFiles = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
  assert(jsFiles.some((f) => f.startsWith('CashRegistersModule-')), 'Missing CashRegistersModule chunk in dist/assets');

  let checkedImports = 0;
  const relImportRegex = /["']\.\/([A-Za-z0-9_.-]+\.(?:js|css))["']/g;
  for (const jsFile of jsFiles) {
    const content = fs.readFileSync(path.join(assetsDir, jsFile), 'utf8');
    let im;
    while ((im = relImportRegex.exec(content)) !== null) {
      const target = path.join(assetsDir, im[1]);
      assert(fs.existsSync(target), `Broken relative import ./${im[1]} inside ${jsFile}`);
      checkedImports += 1;
    }
  }

  console.log(`PASS [LOCAL DIST]: ${assetRefs.length} index.html assets, ${jsFiles.length} JS chunks, ${checkedImports} internal imports verified.`);
  return { assetRefs, entryJsRefs };
}

async function verifyLiveUrl(baseUrl, basicCreds) {
  const headers = {};
  if (basicCreds) {
    headers.Authorization = 'Basic ' + Buffer.from(basicCreds).toString('base64');
  }

  const rootRes = await fetch(`${baseUrl}/`, { headers });
  const rootHtml = await rootRes.text();
  assert.strictEqual(rootRes.status, 200, `GET / expected 200, got ${rootRes.status}`);
  assert((rootRes.headers.get('content-type') || '').includes('text/html'), 'GET / must return text/html');
  const rootCc = (rootRes.headers.get('cache-control') || '').toLowerCase();
  assert(rootCc.includes('no-store'), `GET / Cache-Control must include no-store, got "${rootCc}"`);

  const refRegex = /(?:src|href)=["'](\/assets\/[^"']+)["']/g;
  const liveRefs = [];
  let m;
  while ((m = refRegex.exec(rootHtml)) !== null) {
    liveRefs.push(m[1]);
  }
  assert(liveRefs.length > 0, 'Live index.html contains no /assets/* references');

  for (const ref of liveRefs) {
    const r = await fetch(`${baseUrl}${ref}`, { headers });
    assert.strictEqual(r.status, 200, `GET ${ref} expected 200, got ${r.status}`);
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (ref.endsWith('.js')) {
      assert(ct.includes('javascript'), `${ref} must be JavaScript, got ${ct}`);
    } else if (ref.endsWith('.css')) {
      assert(ct.includes('text/css'), `${ref} must be text/css, got ${ct}`);
    }
    const cc = (r.headers.get('cache-control') || '').toLowerCase();
    assert(cc.includes('immutable'), `${ref} Cache-Control must include immutable, got "${cc}"`);
  }

  const probe404 = await fetch(`${baseUrl}/assets/nonexistent-release-probe-999.js`, { headers });
  const probeText = await probe404.text();
  assert.strictEqual(probe404.status, 404, `Missing asset must return 404, got ${probe404.status}`);
  assert(!probeText.includes('<!doctype html'), 'Missing asset must NEVER return index.html');

  console.log(`PASS [LIVE ${baseUrl}]: index.html no-store, ${liveRefs.length} hashed assets 200+immutable, missing asset 404.`);
}

(async () => {
  const args = process.argv.slice(2);
  const urlIdx = args.indexOf('--url');
  const basicIdx = args.indexOf('--basic');

  verifyLocalDist();
  if (urlIdx !== -1 && args[urlIdx + 1]) {
    const baseUrl = args[urlIdx + 1].replace(/\/$/, '');
    const basicCreds = basicIdx !== -1 ? args[basicIdx + 1] : null;
    await verifyLiveUrl(baseUrl, basicCreds);
  }
})().catch((err) => {
  console.error('FAIL [RELEASE CHUNKS]:', err.message);
  process.exit(1);
});
