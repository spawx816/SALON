'use strict';

/**
 * Catálogo Canónico de Permisos, Alias de Roles, Plantillas Predefinidas y Políticas RBAC — Etereas
 *
 * Principios de diseño:
 * 1. Separación estricta: Rol de Sistema (users.role) vs Permisos Personalizados (roles.permisos)
 *    vs Alcance de Sucursales (authorized_branch_ids / all_branches_access) vs Add-ons (entitlements).
 * 2. Fail-closed: cualquier permiso desconocido o estructura inválida se ignora / deniega.
 * 3. Ningún permiso personalizado concede SuperAdmin, propiedad de empresa (Owner),
 *    gestión comercial SaaS ni activación de add-ons o integraciones electrónicas no contratadas.
 * 4. Consultar (*.view) NUNCA concede crear, editar, pagar, aprobar, anular, configurar ni exportar.
 */

const KIOSK_SYSTEM_ROLE = 'kiosco_asistencia';
const NON_BILLABLE_SYSTEM_ROLES = Object.freeze(['superadmin', 'cliente_b2c', KIOSK_SYSTEM_ROLE]);

const RESERVED_ROLE_NAMES = Object.freeze([
  'superadmin',
  'super_admin',
  'super admin',
  'propietario',
  'owner',
  'cliente_b2c',
  'cliente b2c',
  'client',
  'cliente',
  'kiosco_asistencia',
  'kiosco de asistencia',
  'kiosco',
  'attendance_kiosk',
  'system',
  'sistema',
  'root',
]);

/**
 * Equivalencias verificadas de roles de sistema.
 * No incluye aproximaciones peligrosas (ej: 'contador' o nombres arbitrarios NO se mapean a 'admin').
 */
const VERIFIED_ROLE_ALIASES = Object.freeze({
  superadmin: 'superadmin',
  super_admin: 'superadmin',
  owner: 'propietario',
  propietario: 'propietario',
  propietaria: 'propietario',
  admin: 'admin',
  administrador: 'admin',
  administradora: 'admin',
  cajero: 'cajero',
  cajera: 'cajero',
  recepcionista: 'recepcionista',
  receptionist: 'recepcionista',
  recepcion: 'recepcionista',
  estilista: 'estilista',
  stylist: 'estilista',
  contador: 'contador',
  accountant: 'contador',
  empleado: 'empleado',
  staff: 'empleado',
  kiosco_asistencia: KIOSK_SYSTEM_ROLE,
  attendance_kiosk: KIOSK_SYSTEM_ROLE,
  client: 'cliente_b2c',
  cliente: 'cliente_b2c',
  cliente_b2c: 'cliente_b2c',
});

const ROLE_HIERARCHY = Object.freeze({
  superadmin: 100,
  propietario: 80,
  admin: 60,
  cajero: 40,
  recepcionista: 30,
  contador: 25,
  estilista: 20,
  empleado: 10,
  [KIOSK_SYSTEM_ROLE]: 5,
  cliente_b2c: 0,
});

function isNonBillableSystemRole(role) {
  const norm = String(role || '').trim().toLowerCase();
  return NON_BILLABLE_SYSTEM_ROLES.includes(norm);
}

/**
 * Catálogo canónico agrupado por módulo y acción.
 * Incluye `legacyKey` para compatibilidad estricta sin ampliar permisos existentes al migrar.
 */
const PERMISSION_MODULES = Object.freeze([
  {
    module: 'pos',
    label: 'Punto de Venta, Cajas y Facturación',
    permissions: [
      { key: 'pos.visits.view', action: 'view', label: 'Consultar Visitas y Pre-cuentas', legacyKey: 'record_visits' },
      { key: 'pos.visits.create', action: 'create', label: 'Facturar y Registrar Visitas', legacyKey: 'record_visits', dependsOn: ['pos.visits.view'] },
      { key: 'pos.cash_registers.view', action: 'view', label: 'Consultar Cajas Registradoras', legacyKey: 'process_payments' },
      { key: 'pos.cash_registers.manage', action: 'create', label: 'Abrir, Cerrar y Mover Cajas', legacyKey: 'process_payments', dependsOn: ['pos.cash_registers.view'] },
      { key: 'pos.discounts.apply', action: 'approve', label: 'Aplicar Descuentos en POS', legacyKey: 'manage_discounts', dependsOn: ['pos.visits.create'] },
      { key: 'pos.invoices.view', action: 'view', label: 'Consultar Historial de Facturas', legacyKey: 'view_invoices' },
      { key: 'pos.invoices.void', action: 'delete', label: 'Anular Facturas y Eliminar Visitas', legacyKey: null, sensitive: true, dependsOn: ['pos.invoices.view'] },
    ],
  },
  {
    module: 'clients',
    label: 'Clientes, Contratos y Membresías',
    permissions: [
      { key: 'clients.view', action: 'view', label: 'Consultar Directorio de Clientes', legacyKey: 'manage_clients' },
      { key: 'clients.create', action: 'create', label: 'Registrar Clientes', legacyKey: 'manage_clients', dependsOn: ['clients.view'] },
      { key: 'clients.edit', action: 'edit', label: 'Editar Perfil de Clientes', legacyKey: 'manage_clients', dependsOn: ['clients.view'] },
      { key: 'memberships.plans.manage', action: 'edit', label: 'Administrar Planes y Membresías (Add-on)', legacyKey: 'manage_plans', requiresAddon: 'memberships' },
      { key: 'memberships.contracts.view', action: 'view', label: 'Visualizar Contratos Digitales (Add-on)', legacyKey: 'view_contracts', requiresAddon: 'memberships' },
      { key: 'surveys.manage', action: 'edit', label: 'Ver y Gestionar Encuestas', legacyKey: 'manage_surveys' },
    ],
  },
  {
    module: 'catalog_inventory',
    label: 'Catálogo, Inventario y Marketing',
    permissions: [
      { key: 'services.view', action: 'view', label: 'Consultar Catálogo de Servicios', legacyKey: 'manage_services' },
      { key: 'services.manage', action: 'edit', label: 'Crear, Editar y Eliminar Servicios', legacyKey: 'manage_services', dependsOn: ['services.view'] },
      { key: 'inventory.view', action: 'view', label: 'Consultar Inventario y Stock', legacyKey: 'manage_inventory' },
      { key: 'inventory.manage', action: 'edit', label: 'Movimientos, Compras y Transferencias de Inventario', legacyKey: 'manage_inventory', dependsOn: ['inventory.view'] },
      { key: 'marketing.view', action: 'view', label: 'Consultar Campañas de Marketing', legacyKey: 'manage_marketing', includedInPlan: 'Plan Principal' },
      { key: 'marketing.manage', action: 'edit', label: 'Crear y Enviar Campañas de Marketing', legacyKey: 'manage_marketing', includedInPlan: 'Plan Principal', dependsOn: ['marketing.view'] },
    ],
  },
  {
    module: 'hr_payroll',
    label: 'Personal, Comisiones, Nómina y Asistencia',
    permissions: [
      { key: 'staff.view', action: 'view', label: 'Consultar Colaboradores / RRHH', legacyKey: 'manage_staff' },
      { key: 'staff.manage', action: 'edit', label: 'Crear y Editar Colaboradores', legacyKey: 'manage_staff', dependsOn: ['staff.view'] },
      { key: 'commissions.view', action: 'view', label: 'Consultar Comisiones', legacyKey: 'manage_commissions' },
      { key: 'commissions.approve', action: 'approve', label: 'Gestionar y Pagar Comisiones', legacyKey: 'manage_commissions', dependsOn: ['commissions.view'] },
      { key: 'payroll.view', action: 'view', label: 'Consultar Nómina e Historial', legacyKey: 'manage_payroll' },
      { key: 'payroll.generate', action: 'create', label: 'Generar, Recalcular y Editar Borradores de Nómina', legacyKey: 'manage_payroll', dependsOn: ['payroll.view'] },
      { key: 'payroll.approve', action: 'approve', label: 'Aprobar Nómina (Inmutable)', legacyKey: 'manage_payroll', sensitive: true, dependsOn: ['payroll.view'] },
      { key: 'payroll.pay', action: 'approve', label: 'Registrar Pago Administrativo de Nómina', legacyKey: null, sensitive: true, dependsOn: ['payroll.view'] },
      { key: 'attendance.view', action: 'view', label: 'Consultar Asistencia', legacyKey: 'manage_attendance' },
      { key: 'attendance.manage', action: 'edit', label: 'Ajustar y Gestionar Asistencia', legacyKey: 'manage_attendance', dependsOn: ['attendance.view'] },
    ],
  },
  {
    module: 'accounting',
    label: 'Contabilidad',
    description: 'Consultar solo permite visualización; crear, editar, pagar, anular, configurar y exportar requieren permisos explícitos independientes.',
    permissions: [
      { key: 'accounting.view', action: 'view', label: 'Consultar Contabilidad (Egresos, Bancos, Préstamos, Notas de Crédito, Secuencias y Reportes 606/607/IT-1)', legacyKey: null },
      { key: 'accounting.expenses.manage', action: 'edit', label: 'Crear y Editar Egresos, Conceptos, Bancos, Cuentas y Préstamos', legacyKey: null, dependsOn: ['accounting.view'] },
      { key: 'accounting.expenses.pay', action: 'approve', label: 'Aprobar y Registrar Pagos de Egresos y Préstamos', legacyKey: null, sensitive: true, dependsOn: ['accounting.view'] },
      { key: 'accounting.expenses.void', action: 'delete', label: 'Anular Egresos y Eliminar Registros de Compras 606', legacyKey: null, sensitive: true, dependsOn: ['accounting.view'] },
      { key: 'accounting.purchases_606.manage', action: 'edit', label: 'Registrar y Editar Compras y Proveedores (Reporte 606)', legacyKey: null, dependsOn: ['accounting.view'] },
      { key: 'accounting.credit_notes.manage', action: 'create', label: 'Gestionar Notas de Crédito (sin transmisión electrónica DGII)', legacyKey: null, sensitive: true, dependsOn: ['accounting.view'] },
      { key: 'accounting.sequences.manage', action: 'configure', label: 'Configurar Secuencias de Comprobantes (NCF)', legacyKey: null, sensitive: true, dependsOn: ['accounting.view'] },
      { key: 'accounting.it1.manage', action: 'configure', label: 'Configurar Parámetros y Guardar Borradores IT-1', legacyKey: null, dependsOn: ['accounting.view'] },
      { key: 'accounting.export', action: 'export', label: 'Exportar Reportes Contables y Fiscales (606, 607, IT-1, CSV/TXT/PDF)', legacyKey: null, sensitive: true, dependsOn: ['accounting.view'] },
    ],
  },
  {
    module: 'admin_analytics',
    label: 'Reportes, Sucursales y Seguridad',
    permissions: [
      { key: 'analytics.view', action: 'view', label: 'Consultar Reportes e Inteligencia de Negocios (BI)', legacyKey: 'view_analytics' },
      { key: 'analytics.export', action: 'export', label: 'Exportar Reportes y Datos Operativos', legacyKey: 'view_analytics', sensitive: true, dependsOn: ['analytics.view'] },
      { key: 'branches.manage', action: 'edit', label: 'Configurar Sucursales (no contrata licencias SaaS)', legacyKey: 'manage_salons' },
      { key: 'security.view', action: 'view', label: 'Consultar Usuarios, Auditoría y Sesiones', legacyKey: 'manage_security', sensitive: true },
      { key: 'security.manage', action: 'edit', label: 'Administrar Usuarios, Políticas de Seguridad y Config.', legacyKey: 'manage_security', sensitive: true, dependsOn: ['security.view'] },
    ],
  },
]);

/**
 * Plantillas Canónicas de Roles Predefinidos por Empresa (Principio de Mínimo Privilegio).
 * - Identificador estable `template_key` y versión `template_version`.
 * - Nunca incluyen gestión de roles/seguridad crítica ni facturación SaaS.
 * - Separan la generación de nómina (RRHH) de su aprobación y pago (Contabilidad / Propietario).
 */
const PREDEFINED_ROLE_TEMPLATES = Object.freeze([
  {
    template_key: 'operational_admin',
    template_version: 1,
    nombre: 'Administrador operativo',
    description: 'Supervisión operativa diaria de ventas, clientes, inventario, personal y reportes sin gestión de roles, seguridad crítica ni facturación SaaS.',
    permissions: {
      'pos.visits.view': true,
      'pos.visits.create': true,
      'pos.cash_registers.view': true,
      'pos.cash_registers.manage': true,
      'pos.discounts.apply': true,
      'pos.invoices.view': true,
      'pos.invoices.void': true,
      'clients.view': true,
      'clients.create': true,
      'clients.edit': true,
      'surveys.manage': true,
      'services.view': true,
      'services.manage': true,
      'inventory.view': true,
      'inventory.manage': true,
      'marketing.view': true,
      'marketing.manage': true,
      'staff.view': true,
      'staff.manage': true,
      'commissions.view': true,
      'commissions.approve': true,
      'payroll.view': true,
      'payroll.generate': true,
      'attendance.view': true,
      'attendance.manage': true,
      'accounting.view': true,
      'accounting.expenses.manage': true,
      'accounting.purchases_606.manage': true,
      'accounting.export': true,
      'analytics.view': true,
      'analytics.export': true,
      'branches.manage': true,
    },
  },
  {
    template_key: 'reception_cashier',
    template_version: 1,
    nombre: 'Recepción/Cajero',
    description: 'Cobro en POS, apertura/cierre de caja asignada, registro de clientes y consulta de catálogo e inventario sin anulaciones ni contabilidad.',
    permissions: {
      'pos.visits.view': true,
      'pos.visits.create': true,
      'pos.cash_registers.view': true,
      'pos.cash_registers.manage': true,
      'pos.invoices.view': true,
      'clients.view': true,
      'clients.create': true,
      'clients.edit': true,
      'services.view': true,
      'inventory.view': true,
      'attendance.view': true,
    },
  },
  {
    template_key: 'inventory_manager',
    template_version: 1,
    nombre: 'Encargado de inventario',
    description: 'Gestión de stock, movimientos, compras, transferencias y catálogo de productos/servicios sin acceso a caja, nómina ni seguridad.',
    permissions: {
      'inventory.view': true,
      'inventory.manage': true,
      'services.view': true,
      'services.manage': true,
      'accounting.view': true,
      'accounting.purchases_606.manage': true,
    },
  },
  {
    template_key: 'human_resources',
    template_version: 1,
    nombre: 'Recursos humanos',
    description: 'Administración de colaboradores, asistencia, consulta de comisiones y generación de borradores de nómina (sin aprobar ni registrar pagos de nómina).',
    permissions: {
      'staff.view': true,
      'staff.manage': true,
      'attendance.view': true,
      'attendance.manage': true,
      'commissions.view': true,
      'payroll.view': true,
      'payroll.generate': true,
    },
  },
  {
    template_key: 'accounting',
    template_version: 1,
    nombre: 'Contabilidad',
    description: 'Gestión contable y fiscal completa (egresos, compras 606, 607, IT-1, secuencias NCF, notas de crédito, exportaciones y aprobación/pago de nómina) sin gestión de seguridad ni SaaS.',
    permissions: {
      'accounting.view': true,
      'accounting.expenses.manage': true,
      'accounting.expenses.pay': true,
      'accounting.expenses.void': true,
      'accounting.purchases_606.manage': true,
      'accounting.credit_notes.manage': true,
      'accounting.sequences.manage': true,
      'accounting.it1.manage': true,
      'accounting.export': true,
      'pos.invoices.view': true,
      'pos.cash_registers.view': true,
      'payroll.view': true,
      'payroll.approve': true,
      'payroll.pay': true,
      'commissions.view': true,
      'commissions.approve': true,
      'analytics.view': true,
      'analytics.export': true,
    },
  },
  {
    template_key: 'reports_viewer',
    template_version: 1,
    nombre: 'Consulta de reportes',
    description: 'Solo lectura de tableros BI, contabilidad, facturas, inventario y nómina. No permite crear, editar, aprobar, pagar, anular ni exportar.',
    permissions: {
      'analytics.view': true,
      'accounting.view': true,
      'pos.invoices.view': true,
      'pos.visits.view': true,
      'pos.cash_registers.view': true,
      'inventory.view': true,
      'services.view': true,
      'clients.view': true,
      'payroll.view': true,
      'commissions.view': true,
      'staff.view': true,
      'attendance.view': true,
    },
  },
]);

const PREDEFINED_TEMPLATE_MAP = new Map(
  PREDEFINED_ROLE_TEMPLATES.map((tpl) => [tpl.template_key, tpl])
);

const ALL_CANONICAL_PERMISSIONS = Object.freeze(
  PERMISSION_MODULES.flatMap((m) => m.permissions)
);

const VALID_CANONICAL_KEYS = new Set(ALL_CANONICAL_PERMISSIONS.map((p) => p.key));

const LEGACY_TO_CANONICAL_MAP = ALL_CANONICAL_PERMISSIONS.reduce((acc, p) => {
  if (p.legacyKey) {
    if (!acc[p.legacyKey]) acc[p.legacyKey] = [];
    acc[p.legacyKey].push(p.key);
  }
  return acc;
}, {});

const VALID_LEGACY_KEYS = new Set(Object.keys(LEGACY_TO_CANONICAL_MAP));

function isReservedRoleName(name) {
  const normalized = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return RESERVED_ROLE_NAMES.includes(normalized);
}

/**
 * Normaliza un objeto de permisos de forma fail-closed:
 * - Solo acepta claves booleanas `true` del catálogo canónico o claves legacy conocidas.
 * - Descarta cualquier clave desconocida o manipulada.
 * - No amplía permisos existentes: solo refleja lo explícitamente concedido.
 */
function sanitizePermissionsPayload(rawPermissions) {
  let obj = rawPermissions;
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
    } catch {
      return {};
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return {};
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== true) continue;
    if (VALID_CANONICAL_KEYS.has(key) || VALID_LEGACY_KEYS.has(key)) {
      sanitized[key] = true;
    }
  }
  return sanitized;
}

/**
 * Resuelve si un mapa de permisos concede una clave canónica específica
 * (considerando tanto clave canónica directa como su legacyKey equivalente).
 */
function permissionMapGrants(permissionsMap, requiredPermission) {
  if (!permissionsMap || typeof permissionsMap !== 'object' || Array.isArray(permissionsMap)) {
    return false;
  }
  if (!VALID_CANONICAL_KEYS.has(requiredPermission) && !VALID_LEGACY_KEYS.has(requiredPermission)) {
    // Fail-closed ante permisos desconocidos
    return false;
  }
  if (permissionsMap[requiredPermission] === true) {
    return true;
  }
  const meta = ALL_CANONICAL_PERMISSIONS.find((p) => p.key === requiredPermission);
  if (meta?.legacyKey && permissionsMap[meta.legacyKey] === true) {
    return true;
  }
  if (VALID_LEGACY_KEYS.has(requiredPermission)) {
    const canonicalList = LEGACY_TO_CANONICAL_MAP[requiredPermission] || [];
    return canonicalList.some((cKey) => permissionsMap[cKey] === true);
  }
  return false;
}

/**
 * Expande un mapa de permisos (con claves legacy o canónicas) a todas las claves efectivas,
 * útil para serializar hacia frontend sin perder compatibilidad.
 */
function expandEffectivePermissions(rawPermissions) {
  const clean = sanitizePermissionsPayload(rawPermissions);
  const expanded = { ...clean };
  for (const [legacyKey, canonicalKeys] of Object.entries(LEGACY_TO_CANONICAL_MAP)) {
    if (clean[legacyKey] === true) {
      for (const ck of canonicalKeys) {
        expanded[ck] = true;
      }
    }
    // Solo marcar la clave legacy si TODAS las acciones canónicas equivalentes están concedidas;
    // nunca escalar un permiso granular de solo lectura (*.view) a *.manage / *.approve / *.export.
    if (canonicalKeys.length > 0 && canonicalKeys.every((ck) => expanded[ck] === true)) {
      expanded[legacyKey] = true;
    }
  }
  return expanded;
}

function getPredefinedTemplate(templateKey) {
  if (!templateKey) return null;
  return PREDEFINED_TEMPLATE_MAP.get(String(templateKey).trim()) || null;
}

function arePermissionMapsEqual(a, b) {
  const cleanA = sanitizePermissionsPayload(a);
  const cleanB = sanitizePermissionsPayload(b);
  const keysA = Object.keys(cleanA).sort();
  const keysB = Object.keys(cleanB).sort();
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k, idx) => k === keysB[idx] && cleanA[k] === cleanB[k]);
}

function computePermissionDiff(currentPerms, targetPerms) {
  const cur = sanitizePermissionsPayload(currentPerms);
  const tgt = sanitizePermissionsPayload(targetPerms);
  const curSet = new Set(Object.keys(cur));
  const tgtSet = new Set(Object.keys(tgt));
  const added = [...tgtSet].filter((k) => !curSet.has(k)).sort();
  const removed = [...curSet].filter((k) => !tgtSet.has(k)).sort();
  const unchanged = [...tgtSet].filter((k) => curSet.has(k)).sort();
  return { added, removed, unchanged, hasChanges: added.length > 0 || removed.length > 0 };
}

module.exports = {
  KIOSK_SYSTEM_ROLE,
  NON_BILLABLE_SYSTEM_ROLES,
  RESERVED_ROLE_NAMES,
  VERIFIED_ROLE_ALIASES,
  ROLE_HIERARCHY,
  PERMISSION_MODULES,
  PREDEFINED_ROLE_TEMPLATES,
  ALL_CANONICAL_PERMISSIONS,
  VALID_CANONICAL_KEYS,
  VALID_LEGACY_KEYS,
  LEGACY_TO_CANONICAL_MAP,
  isNonBillableSystemRole,
  isReservedRoleName,
  sanitizePermissionsPayload,
  permissionMapGrants,
  expandEffectivePermissions,
  getPredefinedTemplate,
  arePermissionMapsEqual,
  computePermissionDiff,
};
