/**
 * Automated Security Test: Comprehensive PII & Sensitive Data Audit in Project & Fixtures
 *
 * Requirements:
 * 1. Prohibits non-empty sensitive values in test fixtures:
 *    - password, password_hash, token, secret, cedula, rnc, ip, user_agent, profile_photo, certificados, claves.
 * 2. Enforces synthetic markers (@test-fixtures.local, @example.com) for all email fields.
 * 3. Prohibits real phone numbers, real cédulas, and base64 images in fixtures.
 * 4. Recursively audits the project to assert 0 plaintext backup files or unencrypted dumps exist on disk.
 * 5. Fails closed (exit code 1) on any violation.
 */

const fs = require('fs');
const path = require('path');

console.log('=== START TEST: COMPREHENSIVE PII & SENSITIVE DATA AUDIT ===\n');

const projectRoot = path.resolve(__dirname, '..', '..');
let totalViolations = 0;

// 1. Audit Test Snapshot & Restore Manifest
const fixtureFiles = [
  path.resolve(__dirname, '..', 'backups', 'sanitized_test_snapshot.json'),
  path.resolve(__dirname, '..', 'backups', 'restore_manifest.json')
];

const PROHIBITED_FIELDS = [
  'password',
  'password_hash',
  'token',
  'secret',
  'cedula',
  'rnc',
  'ip',
  'user_agent',
  'profile_photo',
  'certificados',
  'claves'
];

const ALLOWED_EMAIL_DOMAINS = ['test-fixtures.local', 'example.com', 'test.local'];
const PROHIBITED_EMAIL_DOMAINS = ['gmail.com', 'hotmail.com', 'yahoo.com', 'outlook.com', 'claro.com.do', 'tricom.net', 'live.com'];
const FORBIDDEN_PASSWORDS = ['admin123', 'password123', 'admin', '123456', 'superadmin123', 'salonpro123'];

for (const filePath of fixtureFiles) {
  if (!fs.existsSync(filePath)) continue;

  const relName = path.relative(projectRoot, filePath);
  console.log(`[FIXTURE AUDIT] Analizando archivo: ${relName}...`);
  const rawContent = fs.readFileSync(filePath, 'utf8');

  // Check known plain passwords
  for (const pw of FORBIDDEN_PASSWORDS) {
    const pwRegex = new RegExp(`"(?:password|password_hash)":\\s*"${pw}"`, 'i');
    if (pwRegex.test(rawContent)) {
      console.error(`  ❌ [VIOLACIÓN PII] Contraseña conocida insegura "${pw}" detectada en ${relName}`);
      totalViolations++;
    }
  }

  // Check base64 image data
  if (/data:image\/(?:jpeg|png|webp);base64,/i.test(rawContent)) {
    console.error(`  ❌ [VIOLACIÓN PII] Imagen base64 detectada en ${relName}`);
    totalViolations++;
  }

  // Check real phone numbers (Dominican prefixes 809/829/849 without dummy exchange 555/000)
  const realPhoneRegex = /\b(?:809|829|849)[ -]?(?!(?:555|000))[0-9]{3}[ -]?[0-9]{4}\b/g;
  const phoneMatches = rawContent.match(realPhoneRegex);
  if (phoneMatches && phoneMatches.length > 0) {
    console.error(`  ❌ [VIOLACIÓN PII] Patrón de teléfono real detectado en ${relName}: ${phoneMatches.slice(0, 3).join(', ')}`);
    totalViolations += phoneMatches.length;
  }

  // Deep inspection if JSON
  try {
    const parsed = JSON.parse(rawContent);

    function inspectObject(obj, currentPath) {
      if (!obj || typeof obj !== 'object') return;

      if (Array.isArray(obj)) {
        obj.forEach((item, idx) => inspectObject(item, `${currentPath}[${idx}]`));
        return;
      }

      for (const [key, value] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase();
        const fieldPath = currentPath ? `${currentPath}.${key}` : key;

        // Check prohibited sensitive fields
        if (PROHIBITED_FIELDS.some(f => lowerKey === f || lowerKey.endsWith(`_${f}`))) {
          if (value !== null && value !== undefined && value !== '' && value !== false) {
            // Check if it's a dummy placeholder or synthetic hash
            const valStr = String(value).trim();
            const isSynthetic = valStr.startsWith('$synthetic_') || valStr === 'dummy' || valStr === 'test' || valStr === 'none';
            if (!isSynthetic && valStr.length > 0) {
              console.error(`  ❌ [VIOLACIÓN PII] Campo sensible "${fieldPath}" contiene valor no vacío en ${relName}`);
              totalViolations++;
            }
          }
        }

        // Check email domains
        if (lowerKey === 'email' || lowerKey.endsWith('_email')) {
          if (typeof value === 'string' && value.includes('@')) {
            const domain = value.split('@')[1]?.toLowerCase();
            if (domain) {
              const isAllowed = ALLOWED_EMAIL_DOMAINS.some(ad => domain === ad || domain.endsWith(`.${ad}`));
              const isProhibited = PROHIBITED_EMAIL_DOMAINS.some(pd => domain === pd || domain.endsWith(`.${pd}`));
              if (isProhibited || !isAllowed) {
                console.error(`  ❌ [VIOLACIÓN PII] Email "${value}" en "${fieldPath}" no utiliza dominio sintético permitido (${ALLOWED_EMAIL_DOMAINS.join(', ')})`);
                totalViolations++;
              }
            }
          }
        }

        if (typeof value === 'object' && value !== null) {
          inspectObject(value, fieldPath);
        }
      }
    }

    inspectObject(parsed, '');
  } catch (parseErr) {
    console.error(`  ❌ Error al parsear JSON ${relName}:`, parseErr.message);
  }
}

// 2. Project-Wide Plaintext Backup Audit
console.log('\n[DISK AUDIT] Auditando disco del proyecto por backups en texto plano o volcados no cifrados...');

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'archive',
  '.gemini',
  '.vscode'
]);

const FORBIDDEN_FILE_PATTERNS = [
  /^backup_.*\.json$/i,
  /^dump_.*\.sql$/i,
  /^dgii_.*_output$/i,
  /^db_dump.*\.sql$/i
];

let plaintextsFound = 0;

function scanDirectory(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (IGNORED_DIRS.has(ent.name)) continue;

      const fullPath = path.join(dir, ent.name);
      const relPath = path.relative(projectRoot, fullPath);

      if (ent.isDirectory()) {
        if (FORBIDDEN_FILE_PATTERNS.some(p => p.test(ent.name))) {
          console.error(`  ❌ [BACKUP EXPUESTO] Directorio sensible no cifrado encontrado: ${relPath}`);
          plaintextsFound++;
          totalViolations++;
        }
        scanDirectory(fullPath);
      } else if (ent.isFile()) {
        if (FORBIDDEN_FILE_PATTERNS.some(p => p.test(ent.name))) {
          console.error(`  ❌ [BACKUP EXPUESTO] Archivo de backup en texto plano encontrado: ${relPath}`);
          plaintextsFound++;
          totalViolations++;
        }
      }
    }
  } catch (err) {
    console.warn(`  ⚠️ No se pudo leer directorio: ${dir} (${err.message})`);
  }
}

scanDirectory(projectRoot);

if (plaintextsFound === 0) {
  console.log('  ✅ 0 backups o volcados en texto plano encontrados en el proyecto.');
}

// Summary
if (totalViolations > 0) {
  console.error(`\n🚨 PRUEBA FALLIDA: ${totalViolations} violación(es) de PII o backup sin cifrar detectada(s).`);
  process.exit(1);
} else {
  console.log('\n✅ PRUEBA SUPERADA: Cero datos personales o backups sensibles sin cifrar detectados.\n');
  process.exit(0);
}
