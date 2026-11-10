/**
 * Quality Gate: Dependency Security & Pinned Versions Audit (REM-P1-14)
 * Verifies that all known high/critical CVEs are remediated and secure versions are enforced.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function runAudit() {
  console.log('========================================================================');
  console.log('🛡️ QUALITY GATE: AUDITORÍA DE DEPENDENCIAS Y VERSIONES SEGURAS (REM-P1-14)');
  console.log('========================================================================\n');

  const rootPkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
  const backendPkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));

  // 1. Verify xlsx is completely absent
  console.log('--- TEST 1: Verificación de eliminación completa de "xlsx" ---');
  if (rootPkg.dependencies?.xlsx || rootPkg.devDependencies?.xlsx) {
    throw new Error('FAIL: "xlsx" encontrado en package.json de la raíz.');
  }
  if (backendPkg.dependencies?.xlsx || backendPkg.devDependencies?.xlsx) {
    throw new Error('FAIL: "xlsx" encontrado en backend/package.json.');
  }
  console.log('  ✅ [PASS 1] "xlsx" no existe en dependencias ni devDependencies.');

  // 2. Verify secure pinned versions in backend
  console.log('\n--- TEST 2: Verificación de versiones aseguradas en backend ---');
  const backendDeps = backendPkg.dependencies || {};
  const backendOverrides = backendPkg.overrides || {};

  // Axios check
  console.log(`  Verificando axios: ${backendDeps.axios}`);
  if (!backendDeps.axios || !backendDeps.axios.match(/\^?1\.(2[1-9]|[3-9]\d|\d{3,})\./)) {
    throw new Error(`FAIL: axios version ${backendDeps.axios} no cumple con parche >= 1.21.1`);
  }
  console.log('  ✅ axios version segura (>= 1.21.1)');

  // Nodemailer check
  console.log(`  Verificando nodemailer: ${backendDeps.nodemailer}`);
  if (!backendDeps.nodemailer || !backendDeps.nodemailer.match(/\^?(1[0-9]|[2-9]\d)\./)) {
    throw new Error(`FAIL: nodemailer version ${backendDeps.nodemailer} no cumple con parche >= 10.5.0`);
  }
  console.log('  ✅ nodemailer version segura (>= 10.5.0)');

  // Proxy-addr check
  const proxyAddr = backendOverrides['proxy-addr'] || backendDeps['proxy-addr'];
  console.log(`  Verificando proxy-addr override: ${proxyAddr}`);
  if (!proxyAddr || !proxyAddr.match(/\^?2\.0\.[8-9]/)) {
    throw new Error(`FAIL: proxy-addr override ${proxyAddr} no cumple con parche >= 2.0.8`);
  }
  console.log('  ✅ proxy-addr override seguro (>= 2.0.8)');

  // 3. Verify npm audit results in root and backend
  console.log('\n--- TEST 3: Verificación de npm audit (0 vulnerabilidades críticas/altas) ---');
  try {
    const rootAuditRaw = execSync('npm audit --json', { cwd: path.join(__dirname, '../..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const rootAudit = JSON.parse(rootAuditRaw);
    const rootVulnerabilities = rootAudit.metadata?.vulnerabilities || {};
    console.log(`  Root audit: ${JSON.stringify(rootVulnerabilities)}`);
    if ((rootVulnerabilities.critical || 0) > 0 || (rootVulnerabilities.high || 0) > 0) {
      throw new Error(`FAIL: Root repo contiene ${rootVulnerabilities.critical || 0} críticas y ${rootVulnerabilities.high || 0} altas.`);
    }
    console.log('  ✅ Root repo: 0 vulnerabilidades críticas ni altas.');
  } catch (err) {
    if (err.stdout) {
      try {
        const audit = JSON.parse(err.stdout);
        const vulns = audit.metadata?.vulnerabilities || {};
        if ((vulns.critical || 0) > 0 || (vulns.high || 0) > 0) {
          throw new Error(`FAIL: Root repo contiene vulnerabilidades críticas/altas: ${JSON.stringify(vulns)}`);
        }
      } catch (pe) {
        throw err;
      }
    } else {
      throw err;
    }
  }

  try {
    const backendAuditRaw = execSync('npm audit --json', { cwd: path.join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const backendAudit = JSON.parse(backendAuditRaw);
    const backendVulns = backendAudit.metadata?.vulnerabilities || {};
    console.log(`  Backend audit: ${JSON.stringify(backendVulns)}`);
    if ((backendVulns.critical || 0) > 0 || (backendVulns.high || 0) > 0) {
      throw new Error(`FAIL: Backend repo contiene ${backendVulns.critical || 0} críticas y ${backendVulns.high || 0} altas.`);
    }
    console.log('  ✅ Backend repo: 0 vulnerabilidades críticas ni altas.');
  } catch (err) {
    if (err.stdout) {
      try {
        const audit = JSON.parse(err.stdout);
        const vulns = audit.metadata?.vulnerabilities || {};
        if ((vulns.critical || 0) > 0 || (vulns.high || 0) > 0) {
          throw new Error(`FAIL: Backend repo contiene vulnerabilidades críticas/altas: ${JSON.stringify(vulns)}`);
        }
      } catch (pe) {
        throw err;
      }
    } else {
      throw err;
    }
  }

  console.log('\n========================================================================');
  console.log('🎉 AUDITORÍA DE DEPENDENCIAS Y VERSIONES APROBADA (PASS)');
  console.log('========================================================================\n');
}

runAudit();

