const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../db');

async function bootstrapSuperAdmin() {
  const args = process.argv.slice(2);
  let customPassword = null;
  let outputFile = null;

  for (const arg of args) {
    if (arg.startsWith('--password=')) {
      customPassword = arg.split('=')[1];
    } else if (arg.startsWith('--out=')) {
      outputFile = arg.split('=')[1];
    }
  }

  // Si no se suministra password por argumento seguro, generar secreto criptográfico de 32 bytes
  const securePassword = customPassword || crypto.randomBytes(24).toString('base64url');
  const saltRounds = 12;
  const passwordHash = await bcrypt.hash(securePassword, saltRounds);

  const targetEmail = process.env.SUPERADMIN_EMAIL || 'superadmin@salonsaas.com';

  console.log(`[BOOTSTRAP] Rotando credenciales de SuperAdmin para: ${targetEmail}`);

  try {
    const [existing] = await pool.query(
      "SELECT id, email, role FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1",
      [targetEmail]
    );

    let userId;
    if (existing && existing.length > 0) {
      userId = existing[0].id;
      await pool.query(
        `UPDATE users SET 
          password_hash = ?, 
          password = NULL, 
          role = 'superadmin', 
          is_active = TRUE, 
          estado = 'Activo',
          tenant_id = NULL,
          branch_id = NULL
        WHERE id = ?`,
        [passwordHash, userId]
      );
      console.log(`[BOOTSTRAP] Contraseña de SuperAdmin rotada exitosamente.`);
    } else {
      userId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO users (id, name, nombre, email, password_hash, role, is_active, estado, tenant_id, branch_id)
         VALUES (?, 'Super Administrador', 'Super Administrador', ?, ?, 'superadmin', TRUE, 'Activo', NULL, NULL)`,
        [userId, targetEmail, passwordHash]
      );
      console.log(`[BOOTSTRAP] Cuenta SuperAdmin inicializada exitosamente.`);
    }

    // Invalida todas las sesiones previas de este SuperAdmin para forzar re-autenticación
    await pool.query(
      "UPDATE user_sessions SET is_active = 0 WHERE user_id = ?",
      [String(userId)]
    );

    // Guardar en archivo protegido opcional (para suites de testing locales aisladas)
    const secureOutPath = outputFile || path.join(__dirname, '..', '.superadmin_credential.json');
    fs.writeFileSync(
      secureOutPath,
      JSON.stringify({
        email: targetEmail,
        password: securePassword,
        rotatedAt: new Date().toISOString()
      }, null, 2),
      { mode: 0o600 }
    );

    console.log(`[BOOTSTRAP] Credenciales seguras guardadas en archivo protegido (permisos 0600).`);
    console.log(`[BOOTSTRAP] Por seguridad, la contraseña NO se muestra en consola.`);
    return { success: true, email: targetEmail, credentialFile: secureOutPath };
  } catch (error) {
    console.error('❌ Error durante bootstrap de SuperAdmin:', error.message);
    throw error;
  } finally {
    pool.rawPool?.end?.();
  }
}

bootstrapSuperAdmin();

