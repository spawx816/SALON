'use strict';

/**
 * Pre-Migration RBAC Audit Report (Read-Only)
 * Reports:
 * - Current roles & aliases in users and roles tables
 * - Cross-tenant role_id or branch_id references
 * - Users without valid role
 * - Tenants without active Owner
 * - Ambiguous permissions or branch assignments
 */

const { pool } = require('../db');
const { VERIFIED_ROLE_ALIASES, sanitizePermissionsPayload, isReservedRoleName } = require('../domain/rbac_catalog');

async function generateRbacMigrationReport(targetPool = pool) {
  const report = {
    generatedAt: new Date().toISOString(),
    rolesAndAliases: [],
    reservedCustomRoleNames: [],
    crossTenantReferences: [],
    usersWithoutValidRole: [],
    tenantsWithoutActiveOwner: [],
    ambiguousPermissionsOrBranches: [],
  };

  const [tenants] = await targetPool.query('SELECT id, business_name, status FROM tenants');
  const [users] = await targetPool.query('SELECT id, tenant_id, email, role, role_id, branch_id, salon_id, is_active, estado FROM users');
  const [roles] = await targetPool.query('SELECT id, tenant_id, nombre, permisos FROM roles');
  const [branches] = await targetPool.query('SELECT id, tenant_id, name FROM branches');

  const roleMap = new Map(roles.map((r) => [String(r.id), r]));
  const branchMap = new Map(branches.map((b) => [`${b.tenant_id}:${b.id}`, b]));

  // 1. Roles & aliases summary
  const aliasCounts = {};
  for (const u of users) {
    const raw = String(u.role || '(null)').trim().toLowerCase();
    const mapped = VERIFIED_ROLE_ALIASES[raw] || '(unrecognized)';
    const key = `${raw} -> ${mapped}`;
    aliasCounts[key] = (aliasCounts[key] || 0) + 1;

    if (!VERIFIED_ROLE_ALIASES[raw]) {
      report.usersWithoutValidRole.push({ id: u.id, tenant_id: u.tenant_id, email: u.email, raw_role: u.role });
    }

    if (u.role_id !== null && u.role_id !== undefined) {
      const rObj = roleMap.get(String(u.role_id));
      if (!rObj || String(rObj.tenant_id) !== String(u.tenant_id)) {
        report.crossTenantReferences.push({
          type: 'role_id',
          user_id: u.id,
          user_tenant_id: u.tenant_id,
          role_id: u.role_id,
          role_tenant_id: rObj ? rObj.tenant_id : null,
        });
      }
    }

    if (u.branch_id !== null && u.branch_id !== undefined && String(u.role || '').toLowerCase() !== 'superadmin') {
      if (!branchMap.has(`${u.tenant_id}:${u.branch_id}`)) {
        report.crossTenantReferences.push({
          type: 'branch_id',
          user_id: u.id,
          user_tenant_id: u.tenant_id,
          branch_id: u.branch_id,
        });
      }
    } else if (String(u.role || '').toLowerCase() !== 'superadmin' && !['owner', 'propietario'].includes(String(u.role || '').toLowerCase())) {
      report.ambiguousPermissionsOrBranches.push({
        type: 'missing_branch_id',
        user_id: u.id,
        tenant_id: u.tenant_id,
        role: u.role,
      });
    }
  }
  report.rolesAndAliases = Object.entries(aliasCounts).map(([mapping, count]) => ({ mapping, count }));

  // 2. Check custom roles for reserved names & unknown permission keys
  for (const r of roles) {
    if (isReservedRoleName(r.nombre)) {
      report.reservedCustomRoleNames.push({ id: r.id, tenant_id: r.tenant_id, nombre: r.nombre });
    }
    let rawObj = {};
    try {
      rawObj = typeof r.permisos === 'string' ? JSON.parse(r.permisos || '{}') : (r.permisos || {});
    } catch {
      report.ambiguousPermissionsOrBranches.push({ type: 'invalid_role_json', role_id: r.id, tenant_id: r.tenant_id });
      continue;
    }
    if (rawObj && typeof rawObj === 'object' && !Array.isArray(rawObj)) {
      const clean = sanitizePermissionsPayload(rawObj);
      const unknownKeys = Object.keys(rawObj).filter((k) => rawObj[k] === true && !clean[k]);
      if (unknownKeys.length > 0) {
        report.ambiguousPermissionsOrBranches.push({
          type: 'unknown_permission_keys',
          role_id: r.id,
          tenant_id: r.tenant_id,
          unknownKeys,
        });
      }
    }
  }

  // 3. Tenants without active Owner
  for (const t of tenants) {
    const activeOwners = users.filter((u) => {
      if (String(u.tenant_id) !== String(t.id)) return false;
      const mapped = VERIFIED_ROLE_ALIASES[String(u.role || '').trim().toLowerCase()];
      const isAct = u.is_active === true || u.is_active === 1 || String(u.estado || '').toLowerCase() === 'activo';
      return mapped === 'propietario' && isAct;
    });
    if (activeOwners.length === 0) {
      report.tenantsWithoutActiveOwner.push({ tenant_id: t.id, business_name: t.business_name, status: t.status });
    }
  }

  return report;
}

if (require.main === module) {
  generateRbacMigrationReport()
    .then((rep) => {
      console.log(JSON.stringify(rep, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('[RBAC REPORT ERROR]:', err);
      process.exit(1);
    });
}

module.exports = { generateRbacMigrationReport };
