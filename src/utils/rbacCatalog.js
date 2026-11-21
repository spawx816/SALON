/**
 * Catálogo Canónico de Permisos y Utilidades RBAC (Frontend) — Etereas
 * Sincronizado con backend/domain/rbac_catalog.js
 */

export const RESERVED_ROLE_NAMES = [
  'superadmin',
  'super_admin',
  'super admin',
  'propietario',
  'owner',
  'cliente_b2c',
  'cliente b2c',
  'client',
  'cliente',
  'system',
  'sistema',
  'root',
];

export const ACTION_LABELS = {
  view: 'Consultar',
  create: 'Crear',
  edit: 'Editar',
  delete: 'Eliminar / Anular',
  approve: 'Aprobar / Autorizar',
  export: 'Exportar',
};

export const PERMISSION_MODULES = [
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
      { key: 'memberships.plans.manage', action: 'edit', label: 'Administrar Planes y Membresías', legacyKey: 'manage_plans', requiresAddon: 'memberships' },
      { key: 'memberships.contracts.view', action: 'view', label: 'Visualizar Contratos Digitales', legacyKey: 'view_contracts', requiresAddon: 'memberships' },
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
      { key: 'inventory.manage', action: 'edit', label: 'Movimientos, Compras y Transferencias', legacyKey: 'manage_inventory', dependsOn: ['inventory.view'] },
      { key: 'marketing.view', action: 'view', label: 'Consultar Campañas de Marketing', legacyKey: 'manage_marketing', requiresAddon: 'marketing' },
      { key: 'marketing.manage', action: 'edit', label: 'Crear y Enviar Campañas', legacyKey: 'manage_marketing', requiresAddon: 'marketing', dependsOn: ['marketing.view'] },
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
    module: 'admin_analytics',
    label: 'Reportes, Sucursales y Seguridad',
    permissions: [
      { key: 'analytics.view', action: 'view', label: 'Consultar Reportes e Inteligencia de Negocios', legacyKey: 'view_analytics' },
      { key: 'analytics.export', action: 'export', label: 'Exportar Reportes y Datos Operativos', legacyKey: 'view_analytics', sensitive: true, dependsOn: ['analytics.view'] },
      { key: 'branches.manage', action: 'edit', label: 'Configurar Sucursales (no contrata licencias)', legacyKey: 'manage_salons' },
      { key: 'security.view', action: 'view', label: 'Consultar Usuarios, Auditoría y Sesiones', legacyKey: 'manage_security', sensitive: true },
      { key: 'security.manage', action: 'edit', label: 'Administrar Usuarios, Seguridad y Config.', legacyKey: 'manage_security', sensitive: true, dependsOn: ['security.view'] },
    ],
  },
];

export const ALL_PERMISSIONS = PERMISSION_MODULES.flatMap((m) => m.permissions);

export function hasUiPermission(user, ...keys) {
  if (!user) return false;
  const rawRole = String(user.role || '').trim().toLowerCase();
  if (rawRole === 'propietario' || rawRole === 'owner') return true;
  const perms = user.permissions;
  if (Array.isArray(perms) && perms.includes('all')) return true;
  if (!perms || typeof perms !== 'object') return false;

  return keys.flat().some((k) => {
    if (perms[k] === true) return true;
    const meta = ALL_PERMISSIONS.find((p) => p.key === k);
    if (meta?.legacyKey && perms[meta.legacyKey] === true) return true;
    const byLegacy = ALL_PERMISSIONS.filter((p) => p.legacyKey === k);
    return byLegacy.some((p) => perms[p.key] === true);
  });
}

export function isReservedRoleName(name) {
  return RESERVED_ROLE_NAMES.includes(String(name || '').trim().toLowerCase().replace(/\s+/g, ' '));
}
