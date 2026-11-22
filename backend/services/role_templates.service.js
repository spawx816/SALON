'use strict';

/**
 * Servicio Canónico de Plantillas de Roles Predefinidos por Empresa
 * (backend/services/role_templates.service.js)
 *
 * Garantías:
 * - Idempotente: reintentar la instalación nunca duplica ni sobrescribe roles existentes o personalizados.
 * - Aislamiento multi-tenant estricto.
 * - Respeta borrados manuales: un rol predefinido eliminado NO se recrea automáticamente al iniciar sesión
 *   ni en despliegues; solo se reinstala cuando el Propietario invoca explícitamente "Agregar roles predefinidos".
 */

const {
  PREDEFINED_ROLE_TEMPLATES,
  sanitizePermissionsPayload,
} = require('../domain/rbac_catalog');

function normalizeRoleName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Instala roles predefinidos faltantes para un tenant.
 * @param {object} dbConnOrPool - Pool o conexión transaccional con método `.query(sql, params)`
 * @param {string} tenantId
 * @param {object} [options]
 * @param {string[]} [options.templateKeys] - Lista opcional de claves de plantilla a instalar (por defecto todas)
 * @param {boolean} [options.explicitInstall=false] - True cuando se dispara explícitamente desde "Agregar roles predefinidos"
 * @returns {Promise<{ installed: Array, skipped: Array }>}
 */
async function installPredefinedRolesForTenant(dbConnOrPool, tenantId, options = {}) {
  if (!tenantId) {
    throw new Error('tenantId es requerido para instalar roles predefinidos.');
  }
  const requestedKeys = Array.isArray(options.templateKeys) && options.templateKeys.length > 0
    ? new Set(options.templateKeys.map((k) => String(k).trim()))
    : null;

  const templatesToProcess = requestedKeys
    ? PREDEFINED_ROLE_TEMPLATES.filter((t) => requestedKeys.has(t.template_key))
    : PREDEFINED_ROLE_TEMPLATES;

  const [existingRows] = await dbConnOrPool.query(
    'SELECT id, nombre, template_key, template_version, is_customized FROM roles WHERE tenant_id = ?',
    [tenantId]
  );

  const existingByTemplateKey = new Map();
  const existingByName = new Map();
  for (const row of (existingRows || [])) {
    if (row.template_key) {
      existingByTemplateKey.set(String(row.template_key).trim(), row);
    }
    if (row.nombre) {
      existingByName.set(normalizeRoleName(row.nombre), row);
    }
  }

  const installed = [];
  const skipped = [];

  for (const tpl of templatesToProcess) {
    const byKey = existingByTemplateKey.get(tpl.template_key);
    if (byKey) {
      skipped.push({
        template_key: tpl.template_key,
        nombre: byKey.nombre,
        reason: 'ALREADY_EXISTS_BY_TEMPLATE_KEY',
      });
      continue;
    }

    const byName = existingByName.get(normalizeRoleName(tpl.nombre));
    if (byName) {
      skipped.push({
        template_key: tpl.template_key,
        nombre: byName.nombre,
        reason: 'ALREADY_EXISTS_BY_NAME',
      });
      continue;
    }

    const cleanPerms = sanitizePermissionsPayload(tpl.permissions);
    const [ins] = await dbConnOrPool.query(
      `INSERT INTO roles (nombre, description, permisos, tenant_id, template_key, template_version, is_customized)
       VALUES (?, ?, ?, ?, ?, ?, FALSE)
       RETURNING id, nombre, description, template_key, template_version, is_customized`,
      [
        tpl.nombre,
        tpl.description,
        JSON.stringify(cleanPerms),
        tenantId,
        tpl.template_key,
        tpl.template_version || 1,
      ]
    );

    const created = ins?.[0] || {
      id: ins?.insertId,
      nombre: tpl.nombre,
      template_key: tpl.template_key,
      template_version: tpl.template_version || 1,
      is_customized: false,
    };
    installed.push(created);
  }

  return { installed, skipped };
}

module.exports = {
  installPredefinedRolesForTenant,
};
