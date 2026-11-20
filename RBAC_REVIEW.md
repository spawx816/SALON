# Revisión Integral de RBAC: Roles, Permisos, Aislamiento y Seguridad — Etereas

**Fecha:** 2026-11-15  
**Alcance:** Diagnóstico completo de creación de roles, asignación de permisos, middleware backend, controles frontend, aislamiento multi-tenant, alcance por sucursal y acoplamiento con entitlements/add-ons.  
**Naturaleza:** Etapa de diagnóstico puro. No se modificaron permisos reales, no se aplicaron migraciones ni se realizaron despliegues en producción.

---

## 1. Modelo Actual (Arquitectura y Duplicación)

El sistema opera actualmente con **dos modelos paralelos desconectados** entre sí:

### A. Roles de Sistema (`users.role` + `rbac.middleware.js`)
- **Fuente:** Columna `users.role` (string) leída en `backend/middleware/auth.middleware.js` (línea 237) e inyectada en `req.auth.role`.
- **Jerarquía (`backend/middleware/rbac.middleware.js`, líneas 12–22):**
  `superadmin (100)` > `propietario / owner (80)` > `admin (60)` > `cajero (40)` > `recepcionista (30)` > `estilista (20)` > `empleado (10)` > `cliente_b2c (0)`.
- **Normalización (`normalizeRole`, líneas 24–28):** Únicamente mapea `'owner'` → `'propietario'`. Alias usados en el frontend/BD (`administrador`, `administradora`, `receptionist`, `contador`, `accountant`, `stylist`, `staff`, `client`, `super_admin`) **no están mapeados** y caen al fallback `'empleado'` (nivel 10).

### B. Roles Personalizados y Permisos Granulares (`roles` + `users.role_id` + `SecurityModule.jsx`)
- **Fuente:** Tabla `public.roles` (`id`, `nombre`, `description`, `permisos` JSON/TEXT, `tenant_id`) asociada mediante `users.role_id`.
- **Catálogo de Permisos (`src/components/admin/SecurityModule.jsx`, líneas 353–390):** 16 claves booleanas agrupadas en 4 bloques:
  1. *Punto de Venta y Facturación*: `record_visits`, `process_payments`, `manage_discounts`, `view_invoices`.
  2. *Gestión de Clientes y Planes*: `manage_clients`, `manage_plans`, `view_contracts`, `manage_surveys`.
  3. *Personal, Nómina y Asistencia*: `manage_staff`, `manage_payroll`, `manage_commissions`, `manage_attendance`.
  4. *Administración y Seguridad del Sistema*: `view_analytics`, `manage_salons`, `manage_services`, `manage_security`.
  *(Nota: el frontend también consulta `manage_marketing` y `manage_inventory` en `App.jsx`, los cuales **no existen** en la matriz de `SecurityModule.jsx`).*
- **Desconexión Backend ↔ Frontend:**
  - El backend **no posee** ningún middleware `requirePermission(...)`. Todas las rutas protegidas en backend usan exclusivamente `requireRole(...)` (basado en `users.role`) o validaciones ad-hoc de `req.auth.role`.
  - Si un usuario es creado desde `SecurityModule.jsx`, el formulario envía `role_id` pero **no envía `role`**, por lo que `POST /api/users` asigna `role = 'empleado'` (línea 475 de `auth.routes.js`). Como resultado, aunque el rol personalizado tenga permisos administrativos (`manage_security`, `manage_staff`, etc.), el backend rechaza sus peticiones con `403` en endpoints que exigen `requireRole('propietario', 'admin')`, mientras que los endpoints sin `requireRole` quedan abiertos a cualquier rol.

### C. Aislamiento por Empresa (`tenant_id`), Sucursal (`branch_id`) y Add-ons (`entitlements`)
- **Empresa (`tenant_id`):** `auth.middleware.js` deriva `req.tenantId` del usuario en BD (nunca del cliente) y bloquea mismatch en `x-tenant-id` / `query` / `body`. Sin embargo, `POST /api/users` y `PUT /api/users/:id` **no validan** que `role_id` ni `branch_id` pertenezcan a `req.tenantId`.
- **Sucursal (`branch_id` / `salon_id`):** `req.auth.branchId` se carga en el middleware pero **no se impone** en consultas ni mutaciones operativas (`visits`, `cash_registers`, `reports`, `clients`). Los endpoints aceptan `salon_id` / `branch_id` del query/body libremente.
- **Add-ons (`entitlements.middleware.js`):** El plan y add-ons (`memberships`, `clients`, `marketing`, `inventory`) se validan mediante `requirePlanFeature(...)` en `app.js` a nivel de ruta, independiente de los permisos del rol. Un rol con `manage_plans` sigue bloqueado por `requirePlanFeature('memberships')` si la empresa no contrató el add-on (observado en código).

---

## 2. Matriz de Auditoría de Endpoints (Observado en Código)

| Módulo | Acción | Permiso UI Esperado | Endpoint | Control Backend Aplicado | Estado |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Usuarios** | Listar / Crear / Editar | `manage_security` | `GET/POST/PUT /api/users` | `rejectControlPlaneOnTenantUsers` + `requireRole('propietario', 'admin')` | ⚠️ No valida `tenant_id` de `role_id`/`branch_id` ni último Owner en `PUT` |
| **Usuarios** | Eliminar | `manage_security` | `DELETE /api/users/:id` | `requireRole('propietario')` + protege último Owner | ✅ Protegido (solo Owner) |
| **Roles** | Listar | `manage_security` | `GET /api/roles` | Solo `authenticate` (tenant scoped) | ❌ Sin `requireRole` (cualquier empleado/cliente lee roles) |
| **Roles** | Crear / Editar | `manage_security` | `POST /api/roles`, `PUT /api/roles/:id` | Solo `authenticate` (tenant scoped) | ❌ **CRÍTICO**: Cualquier empleado o cliente B2C puede crear/editar roles |
| **Roles** | Eliminar | `manage_security` | *(Inexistente)* | No existe endpoint `DELETE /api/roles/:id` | ❌ No implementada eliminación ni bloqueo por usuarios asignados |
| **Seguridad/PIN** | Logs, intentos, desbloqueos, settings | `manage_security` | `/api/security/audit-logs`, `login-attempts`, `unblock-*`, `settings` | `requireRole('propietario', 'admin')` | ✅ Protegido por `users.role` |
| **Seguridad/PIN** | Establecer / Rotar / Verificar PIN | `manage_security` / `manage_discounts` | `POST /api/security/set-pin`, `rotate-pin`, `verify-pin` | Verificación interna de rol en ruta | ⚠️ Revisar consistencia con roles personalizados |
| **POS / Visitas** | Crear / Cobrar / Listar visitas | `record_visits` | `GET/POST /api/visits`, `POST /:id/checkout` | `rejectControlPlaneRoleOnTenantRoutes` | ❌ Sin `rejectClientRoleOnStaffRoutes` ni `requirePermission`, sin filtro obligatorio de `branch_id` |
| **POS / Visitas** | Anular factura / Eliminar visita | `view_invoices` / Supervisor | `POST /:id/void`, `DELETE /api/visits/:id` | Chequeo inline `actorRole` (`propietario`/`owner`/`admin`) en `void` | ⚠️ `DELETE /:id` sin `requireRole`; `void` ignora permisos granulares |
| **Cajas** | Abrir / Cerrar / Movimientos / Listar | `process_payments` | `/api/cash-registers/*` | `rejectControlPlaneRoleOnTenantRoutes` + `rejectClientRoleOnStaffRoutes` | ❌ Sin `requirePermission` ni restricción por `branch_id` del usuario |
| **Facturas** | Consultar historial | `view_invoices` | `GET /api/invoices/*` | `rejectControlPlaneRoleOnTenantRoutes` | ❌ Sin `rejectClientRoleOnStaffRoutes` ni verificación de permiso |
| **Catálogo** | Crear / Editar / Eliminar servicios | `manage_services` | `POST/PUT/DELETE /api/services/*`, `/bulk-import` | `rejectControlPlaneRoleOnTenantRoutes` | ❌ **CRÍTICO**: Sin `rejectClientRoleOnStaffRoutes` ni control de rol/permiso |
| **Inventario** | Stock, compras, transferencias | `manage_inventory` *(huérfano)* | `/api/inventory/*` | `rejectClientRoleOnStaffRoutes` + chequeo inline admin en ruta puntual | ❌ Sin matriz de permisos ni control por sucursal |
| **Clientes** | CRM de clientas | `manage_clients` | `/api/clients/*` | `requirePlanFeature('clients')` | ❌ Sin validación de permiso granular |
| **Membresías** | Planes, contratos, cobros | `manage_plans`, `view_contracts` | `/api/plans`, `/api/contracts`, `/api/payments` | `requirePlanFeature('memberships')` | ❌ `/api/plans` y `/api/payments` sin `rejectClientRoleOnStaffRoutes`; sin permiso granular |
| **Nómina** | Ver / Procesar / Aprobar nómina | `manage_payroll` | `/api/payroll/*` | `rejectClientRoleOnStaffRoutes` | ❌ **CRÍTICO**: Cualquier empleado autenticado accede a nómina/salarios |
| **Comisiones** | Reglas y pagos de comisiones | `manage_commissions` | `/api/commissions/*` | `rejectClientRoleOnStaffRoutes` | ❌ Sin validación de permiso ni rol |
| **Descuentos Emp.** | Reglas de descuento y PIN | `manage_discounts` | `/api/employee-security/*`, `/api/employee-discounts/*` | `rejectClientRoleOnStaffRoutes` | ❌ Sin validación de permiso ni rol |
| **Reportes / BI** | Reportes operativos y exportación | `view_analytics` | `/api/reports/*`, `/api/tenant/export` | `/reports`: solo `rejectControlPlane...`; `/export`: solo `authenticate` | ❌ **CRÍTICO**: Exportación total de tenant y reportes accesibles sin rol admin ni bloqueo B2C |
| **Suscripción SaaS** | Upgrade, downgrade, cancelar, pagar, términos | Solo Owner | `/api/saas/billing/subscription/*`, `/checkout/*`, `/terms/accept` | `payment-methods/initiate\|confirm-cardnet` validan `isOwnerOrAdmin`; **el resto no valida rol** | ❌ **CRÍTICO**: Cualquier empleado (o cliente) puede cancelar suscripción o aceptar términos |
| **Config. / Branding** | Branding, perfil empresa, retención, correo | `manage_security` / Owner | `/api/tenant/branding`, `/profile`, `/settings`, `/retention/*`, `/api/settings/email` | `branding`/`profile`/`contract` validan `role`; `settings/email` y `retention` **sin rol** | ⚠️ Cobertura parcial |
| **Sucursales** | Cotizar / Contratar / Crear sucursal | `manage_salons` / Owner | `/api/salons/quote-add-branch`, `contract-branch`, `POST /` | `requireOwnerOrAdmin` | ✅ Protegido (`owner`/`propietario`/`admin`), aunque sin permiso granular |

---

## 3. Hallazgos Confirmados en Ejecución vs Observados en Código

### A. Comprobados en Ejecución (Script `rbac_diagnostic_probe.cjs` sobre `InMemoryDbMock` + middlewares reales)
1. **Creación y edición de roles sin autorización (`POST /api/roles`, `PUT /api/roles/:id`):**
   - *Reproducción:* Usuario con `role: 'empleado'` envía `POST /api/roles` con `{ nombre: 'superadmin', permisos: { manage_security: true, manage_payroll: true } }`.
   - *Resultado observado:* `HTTP 200 OK` (`{"id":"mock-...","success":true}`). Luego el mismo empleado ejecutó `PUT /api/roles/10` agregándose `manage_security: true` y recibió `HTTP 200 OK`.
   - *Impacto:* Permite crear roles con nombres reservados (`superadmin`, `propietario`) y otorgarse cualquier permiso.
2. **Inyección cross-tenant de `role_id` (`PUT /api/users/:id`):**
   - *Reproducción:* `Owner A` (`tenant-a`) envía `PUT /api/users/u-emp-a` con `{ role_id: 20 }` (donde `20` pertenece a `tenant-b`).
   - *Resultado observado:* `HTTP 200 OK`. La BD asigna un `role_id` ajeno al tenant.
3. **Degradación del último Propietario (`PUT /api/users/:id`):**
   - *Reproducción:* Único `propietario` activo de `tenant-a` envía `PUT /api/users/u-owner-a` con `{ role: 'empleado' }`.
   - *Resultado observado:* `HTTP 200 OK`. La empresa queda **sin ningún propietario activo**.
4. **Escalada propia por `role_id` (`PUT /api/users/:id`):**
   - *Reproducción:* `Admin A` edita su propio usuario enviando `{ role_id: 20 }` sin incluir `role`.
   - *Resultado observado:* `HTTP 200 OK`. `canManageRole` solo se ejecuta cuando viene `role` en el body, omitiendo `role_id`.
5. **Fallo de normalización de alias en `rbac.middleware.js`:**
   - *Reproducción:* Usuario con `role: 'administrador'` solicita `GET /api/users`.
   - *Resultado observado:* `HTTP 403 Forbidden` con `currentRole: "empleado"` porque `normalizeRole` no contempla `'administrador'`, `'contador'`, `'recepcion'`, etc.

### B. Observados en Código (Pendientes de prueba contra PostgreSQL completo o UI E2E)
6. **Ausencia de eliminación de roles:** No existe `DELETE /api/roles/:id` ni botón en `SecurityModule.jsx`. Tampoco hay validación que impida borrar un rol en uso o exija reasignación.
7. **Persistencia de sesión tras cambio/revocación de permisos:** `PUT /api/users/:id` solo incrementa `token_version` si se cambia la contraseña (`auth.routes.js:655`). Cambiar `role`, `role_id`, `branch_id` o `estado` mantiene válido el JWT y la sesión local (`localStorage: salon_pro_user`) hasta expiración/re-login.
8. **Permisos ausentes o desincronizados en UI:**
   - `App.jsx` evalúa `manage_marketing` y `manage_inventory`, pero `SecurityModule.jsx` no los ofrece en la matriz de checkboxes.
   - `SecurityModule.jsx` no distingue acciones CRUD (`ver`, `crear`, `editar`, `eliminar`, `aprobar`, `exportar`) — solo usa un flag booleano por módulo.
   - No existe botón "Seleccionar todos", indicador de cambios sin guardar ni validación de permisos dependientes.
9. **Asignación de `role_id` por defecto insegura en frontend (`SecurityModule.jsx:161`):** Si el listado `roles` está vacío, envía `role_id: 1` hardcodeado.
10. **Falta de aislamiento por sucursal en backend:** `cash_registers`, `visits`, `reports`, `clients` aceptan `salon_id` / `branch_id` arbitrario de cualquier sucursal de la empresa sin validar contra `req.auth.branchId`.

---

## 4. Riesgos de Escalada y Aislamiento (Prioridad)

1. **Crítico (P0) — Bypass total en endpoints sensibles sin `requireRole` / `requirePermission`:**
   `POST/PUT /api/roles`, `/api/payroll/*`, `/api/tenant/export`, `/api/reports/*`, `/api/services/*`, `/api/saas/billing/subscription/cancel`. Cualquier usuario autenticado (y en varios endpoints incluso un cliente B2C) puede alterar roles, leer nóminas, exportar datos o cancelar la suscripción SaaS.
2. **Crítico (P0) — Cross-tenant `role_id` y `branch_id` en `POST/PUT /api/users`:**
   Permite vincular un usuario a un `role_id` o `branch_id` de otra empresa.
3. **Alto (P1) — Desacople entre `users.role` y `users.role_id` + degradación del último Owner:**
   Un usuario creado desde UI con rol personalizado queda con `users.role = 'empleado'`, y un `PUT /api/users/:id` permite degradar o desactivar al último `propietario`.
4. **Alto (P1) — Falta de validación de delegación y nombres reservados:**
   Falta impedir crear roles llamados `superadmin`, `propietario`, `owner`, etc., y validar que un `admin` no cree/edite roles con permisos superiores a los suyos ni se auto-escale vía `role_id`.
5. **Medio (P2) — Permisos obsoletos en sesión abierta y falta de scoping por sucursal en backend:**
   Al revocar un permiso o cambiar el rol/sucursal, el cambio no invalida `token_version` ni refresca el estado de permisos en vivo en `req.auth`.

---

## 5. Propuesta de Corrección y Orden Recomendado

1. **Fase 1 — Contención Crítica Backend (`P0`):**
   - Proteger `GET/POST/PUT/DELETE /api/roles` con `requireRole('propietario', 'admin')` + `rejectControlPlaneOnTenantUsers` + `rejectClientRoleOnStaffRoutes`.
   - Bloquear nombres reservados (`superadmin`, `propietario`, `owner`, `cliente_b2c`, `system`) al crear/editar roles.
   - Validar en `POST /api/users` y `PUT /api/users/:id` que `role_id` y `branch_id` existan y pertenezcan estrictamente a `req.tenantId`.
   - Proteger al último `propietario` activo en `PUT /api/users/:id` (impedir cambio de rol o desactivación).
   - Aplicar `rejectClientRoleOnStaffRoutes` y guardas de rol/permiso en `/api/payroll`, `/api/commissions`, `/api/reports`, `/api/tenant/export`, `/api/services`, `/api/saas/billing/*` (solo Owner/Admin según corresponda) y `/api/settings/email`.
2. **Fase 2 — Motor Canónico `requirePermission` + Scoping Real (`P1`):**
   - Cargar `role_id`, `role_name` y `permissions` frescos desde BD en `auth.middleware.js` en cada request (o cache invalidada por `token_version`) y unificar `normalizeRole` para todos los alias (`administrador`, `contador`, `recepcion`, etc.).
   - Crear `requirePermission(...perms)` en `rbac.middleware.js` (fail-closed ante permisos desconocidos, respetando `propietario` y bloqueando add-ons no contratados mediante `requirePlanFeature`).
   - Incrementar `token_version` automáticamente en `PUT /api/users/:id` cuando cambien `role`, `role_id`, `branch_id` o `estado`, y al editar un rol (`PUT /api/roles/:id`) para sus usuarios asignados.
   - Imponer filtro obligatorio por `req.auth.branchId` en backend para roles operativos restringidos a una sucursal.
3. **Fase 3 — Ciclo de Vida de Roles y UX (`P2`):**
   - Implementar `DELETE /api/roles/:id` impidiendo eliminar roles reservados o roles con usuarios asignados (exigir reasignación previa).
   - Validar delegación: un actor no puede conceder permisos que no posee ni asignarse un rol superior al suyo.
   - Sincronizar el catálogo de permisos entre `SecurityModule.jsx` y `App.jsx` (incorporar `manage_marketing`, `manage_inventory`, separar acciones de consulta/edición/aprobación/exportación, añadir indicador de cambios sin guardar y auditoría detallada de cambios de permisos).

---

## 6. Decisiones de Producto Pendientes

1. **Alcance de sucursal por rol:** ¿Un usuario operativo (Cajero/Recepción) debe quedar estrictamente limitado a su `branch_id` asignada en backend, o existirá un flag explícito `"multi_branch_access"` en la matriz de permisos?
2. **Granularidad de permisos:** ¿Mantener 1 permiso booleano por módulo (ej. `manage_payroll`) o dividirlos en acciones (`view`, `create`, `edit`, `delete`, `approve`, `export`) como en nómina, inventario y reportes?
3. **Delegación de `admin` vs `propietario`:** ¿Un `admin` podrá crear/editar roles personalizados (limitado a los permisos que él ya posee) o la gestión de roles y seguridad debe ser facultad exclusiva del `propietario`?
4. **Permisos faltantes en UI:** Confirmar si `manage_inventory` y `manage_marketing` deben agregarse a `SecurityModule.jsx` como permisos independientes o integrarse en categorías existentes.

---

## 7. Estado de Remediación y Evidencia

| Hallazgo / Requisito | Estado | Evidencia / Implementación |
| :--- | :--- | :--- |
| **Catálogo canónico por módulo y acción (`view`, `create`, `edit`, `approve`, `delete`, `export`)** | **Corregido y probado** | `backend/domain/rbac_catalog.js` y `src/utils/rbacCatalog.js`. Incluye `inventory.*`, `marketing.*`, mapeo retrocompatible sin ampliar permisos existentes y rechazo fail-closed de claves desconocidas. |
| **Protección de `/api/roles` (`GET/POST/PUT/DELETE`) y nombres reservados** | **Corregido y probado** | `backend/routes/auth.routes.js`: gestión reservada a Owner por defecto (`allow_admin_role_delegation = false`), bloqueo de nombres reservados (`superadmin`, `propietario`, `cliente_b2c`, etc.), validación de delegación y rechazo `409 ROLE_IN_USE` al eliminar roles con usuarios asignados. |
| **Validación estricta de `role_id` y sucursales contra `req.tenantId`** | **Corregido y probado** | `POST/PUT /api/users` valida `roles.tenant_id` y `branches.tenant_id`, eliminando el fallback `role_id || 1`. |
| **Protección transaccional del último Owner y bloqueo de auto-escalada** | **Corregido y probado** | `PUT/DELETE /api/users/:id` ejecuta lock + verificación transaccional (`ensureRemainingActiveOwner`), probado con llamadas concurrentes (`Promise.all`), y bloquea auto-modificación de privilegios (`403 SELF_PRIVILEGE_MODIFICATION_DENIED`). |
| **Motor `requirePermission` y normalización segura de alias** | **Corregido y probado** | `backend/middleware/rbac.middleware.js` y `auth.middleware.js`: resuelve permisos persistidos en BD en cada request. `contador` y alias desconocidos no escalan a `admin`. |
| **Revocación inmediata en sesión abierta** | **Corregido y probado** | Al editar rol o usuario se incrementa `token_version` y se invalidan sesiones (`user_sessions`); probado en ejecución rechazando inmediatamente el token anterior. |
| **Alcance de sucursales en lectura, escritura y transferencias** | **Corregido y probado** | `getBranchScope` / `isBranchAuthorized` aplicado en `cash_registers.routes.js`, `visits.routes.js` y `inventory.routes.js` (validando origen y destino en transferencias). |
| **Contención en rutas operativas y SaaS Billing Owner-only** | **Corregido y probado** | `backend/app.js` y `saas_billing.routes.js`: bloqueo de clientes B2C en rutas de personal, guardas `requirePermission` en nómina, comisiones, reportes, exportación, catálogo, POS, cajas e inventario; acciones comerciales SaaS restringidas a Owner (`403 OWNER_ONLY_SAAS_BILLING`). |
| **Separación Add-ons vs Permisos de Rol** | **Corregido y probado** | `requirePlanFeature('memberships')` y `'marketing'` se mantienen independientes de los permisos del rol (probado `403 FEATURE_LOCKED_UPGRADE_REQUIRED` aunque el rol tenga `memberships.plans.manage`). |
| **Interfaz `SecurityModule.jsx` conectada al catálogo** | **Corregido y probado (build)** | Agrupado por módulo/acción, explicación de dependencias y add-ons, botón "Seleccionar todos (delegables)", indicador de cambios sin guardar, eliminación de roles con validación `ROLE_IN_USE` y errores de persistencia visibles. |
| **Migración idempotente + Reporte previo** | **Corregido (pendiente de aplicar en BD staging)** | `backend/migrations/20261115_rbac_hardening.cjs` registrada en `migrate_all.cjs` y reporte read-only `backend/scripts/rbac_migration_report.cjs`. |
| **Decisión pendiente: multi-sucursal por usuario en UI** | **Decisión requerida** | La columna `authorized_branch_ids` y `all_branches_access` ya están soportadas en BD/backend; queda definir si se habilita un selector múltiple de sucursales en el modal de usuario para roles operativos. |

### Resultados de Pruebas Ejecutadas (2026-11-15)
- `node backend/tests/test_rbac_remediation.cjs`: **11/11 escenarios aprobados**.
- `node backend/tests/test_four_functional_fixes.cjs`: **100% aprobado**.
- `node backend/tests/test_saas_branch_contracting.cjs`: **9/9 escenarios aprobados**.
- `node backend/tests/test_saas_checkout_reconciliation.cjs`: **2/2 pruebas aprobadas**.
- `npm run lint`: **0 errores** (272 warnings preexistentes).
- `npm run build` & `npm run verify:release`: **PASS** (53 chunks JS, 236 imports verificados).

---

## 8. Cierre Pre-Producción de Roles y Aislamiento (2026-11-20)

### A. Hallazgos Adicionales Encontrados y Corregidos

| # | Hallazgo | Severidad | Corrección Aplicada | Prueba Ejecutada y Resultado |
| :--- | :--- | :--- | :--- | :--- |
| 1 | **Escalada implícita `*.view → legacyKey → *.manage`** en `backend/domain/rbac_catalog.js` (`expandEffectivePermissions` activaba la clave legacy con `.some(...)`, promoviendo cualquier permiso de solo lectura como `attendance.view` a `manage_attendance` → `attendance.manage`). | **P0 (Crítico)** | Cambiado a `.every(...)` en `expandEffectivePermissions`: una clave legacy solo se emite si TODAS las acciones canónicas equivalentes están concedidas. | `test_rbac_closure_matrix.cjs` (`Analista B1` con `attendance.view` → `GET /api/attendance/history` `200`, `POST /api/holidays` `403`). **PASS**. |
| 2 | **`/api/clients` sin guard RBAC ni aislamiento B2C**: cualquier empleado sin permisos o cliente B2C podía listar/modificar otros clientes de la empresa. | **P0 (Crítico)** | Guard router-level en `backend/routes/clients.routes.js`: `cliente_b2c` solo puede consultar `GET /:id` propio; personal requiere `clients.view` / `clients.create` / `clients.edit`. | `test_rbac_closure_matrix.cjs` (8 actores en `GET /api/clients`, `C1` lee `C1` `200`, `C1` sobre `C2`/`T2` `403`). **PASS**. |
| 3 | **`/api/appointments` sin RBAC ni aislamiento B2C**: `cliente_b2c` veía todas las citas de la empresa y podía crear citas con `clientId` de otro cliente. | **P0 (Crítico)** | `backend/routes/appointments.routes.js`: `cliente_b2c` filtrado a `client_id = req.auth.id` en `GET` y forzado en `POST` (ignorando `body.clientId`); personal requiere permisos de visitas/clientes. | `test_rbac_closure_matrix.cjs` (verificación HTTP + estado real en BD `appointments.client_id = C1`). **PASS**. |
| 4 | **`/api/attendance`, `/api/holidays`, `/api/dashboard`, `/api/admin/gifts`, `/api/surveys/stats` sin `requirePermission`** en `backend/app.js`. | **P0 (Crítico)** | Agregados `requireMethodPermission` y `requirePermission` explícitos en `backend/app.js` + `rejectClientRoleOnStaffRoutes` en `/api/admin/gifts`, `/api/surveys/stats` y `/api/surveys/send`. | `test_rbac_closure_matrix.cjs` (120 combinaciones actor × endpoint verificadas). **PASS**. |
| 5 | **`/api/reports/bi` y `GET /api/salons` sin alcance por sucursal (`getBranchScope`)**: usuario limitado a Sucursal B1 podía consultar `salonId=B2` o totales globales `salonId=all`. | **P1 (Alto)** | Aplicado `getBranchScope(req)` en `backend/routes/reports.routes.js` (`403 FORBIDDEN_BRANCH_SCOPE` fuera de alcance y filtro SQL `IN (...)` para `salonId=all`) y filtrado de sucursales en `GET /api/salons`. | `test_rbac_closure_matrix.cjs` (`?salonId=B2` → `403`; `?salonId=all` suma solo B1 = 1500, excluyendo B2 = 9000; `/api/salons` devuelve solo B1). **PASS**. |
| 6 | **Contratación comercial de sucursales (`/api/salons/quote-add-branch`, `/contract-branch`) y `defaultPaymentMethod` accesibles por `admin` / sin rol en `/licensing-status`**. | **P1 (Alto)** | Restringidos `quote-add-branch` y `contract-branch` a Owner exclusivo (`403 OWNER_ONLY_SAAS_BILLING`); `/licensing-status` requiere `branches.manage`/`security.view` y oculta `defaultPaymentMethod` a no-Owners. | `test_rbac_closure_matrix.cjs` (`admin` recibe `403` en `quote-add-branch` y `contract-branch`; `owner` autorizado). **PASS**. |
| 7 | **`/api/tenant/private-files/:fileId` excluía `'propietario'` y permitía `'superadmin'`**; **`print_templates.routes.js`** consultaba clave inexistente `'manage_settings'`. | **P1 (Alto)** | Actualizado `private_files.routes.js` usando `getEffectiveRole` (`propietario`, `admin` o `memberships.contracts.view` / `security.manage`, y cliente dueño) y `print_templates.routes.js` a `'security.manage'`. | Verificado en código + suite `test_rbac_closure_matrix.cjs`. **PASS**. |
| 8 | **Compatibilidad PostgreSQL en `/api/attendance/history`, `/api/surveys/stats`, `/api/admin/gifts`** (`TO_CHAR` y cast `::text` en joins `varchar = uuid`). | **P1 (Alto)** | Reemplazado `DATE_FORMAT` por `TO_CHAR` en `attendance.routes.js` y agregado `::text` en `gifts_surveys.routes.js`. | `test_rbac_closure_matrix.cjs` sobre PostgreSQL real (`salon_saas_test`). **PASS**. |

### B. Suites Reales Ejecutadas en `salon_saas_test` (2026-11-20)
- `node backend/tests/test_rbac_closure_matrix.cjs` (2 empresas sintéticas, 3 sucursales, 8 actores, 120 combinaciones + aislamiento B2C + BI por sucursal + revocación de sesión + concurrencia último Owner + exención kiosco + verificación de estado en BD): **PASS (7/7 bloques)**.
- `node backend/tests/test_rbac_remediation.cjs`: **PASS (11/11 escenarios)**.
- `node backend/tests/test_kiosk_dedicated_user.cjs`: **PASS (5/5 escenarios)**.
- `npm run test:runner-guards`: **PASS (17/17 + 46 archivos aislados)**.
- `npm run test:scanner`: **14/14 negative checks PASS**; **0 violaciones** en todos los archivos RBAC/aislamiento tocados; **12 hallazgos preexistentes** fuera de RBAC en `auth.routes.js` (3 en recovery por email/cédula), `consolidated_renewal.service.js` (6 en worker/updates por id), `pg_saas_billing.repository.js` (2 en lookup/update por id) y `platform_email.service.js` (1 falso positivo en `Buffer.from` de salt).

### C. Pendientes / Decisiones Necesarias
1. **Scanner AST (`npm run test:scanner`)**: Resolver o anotar los 12 hallazgos preexistentes en `auth.routes.js`, `consolidated_renewal.service.js`, `pg_saas_billing.repository.js` y `platform_email.service.js` antes de exigir gate verde del scanner en CI de producción.
2. **Alcance multi-sucursal en UI de usuarios**: `authorized_branch_ids` y `all_branches_access` ya están aplicados en backend y BD; definir si se expone el selector múltiple de sucursales en el modal de `SecurityModule.jsx`.
3. **Recursos explícitamente compartidos a nivel empresa**: `clients` (directorio CRM) y `services` (catálogo de servicios) se mantienen compartidos a nivel `tenant_id` por diseño operativo; `visits`, `cash_registers`, `inventory`, `reports/bi` y `salons` aplican alcance estricto por `branch_id`.


