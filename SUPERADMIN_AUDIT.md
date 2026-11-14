# Auditoría Diagnóstica Integral — Perfil SuperAdmin (Etereas)

**Fecha:** 2026-11-14  
**Alcance:** Panel de Control Global del SaaS (`SuperAdminDashboard`, rutas `/saas*`, `backend/routes/saas.routes.js`, `backend/routes/saas_billing.routes.js`, `backend/middleware/auth.middleware.js`, `backend/app.js`, `backend/routes/security.routes.js`, `src/utils/dataService.js`) y verificación de solo lectura en staging (`179.66.139.67`, `salon_saas_staging`).  
**Modalidad:** Diagnóstico exclusivamente (sin cambios de código, migraciones ni despliegues).

---

## 1. Veredicto General

El perfil **SuperAdmin** cuenta con una **base sólida de aislamiento Control Plane vs. Tenant Plane** en el backend (`authenticate` + `requireControlPlaneRole` + `rejectControlPlaneRoleOnTenantRoutes`), pero su **consola operativa y administrativa está severamente rota o desincronizada** en flujos críticos:

- **Facturación y Suscripciones SaaS inoperantes:** La ruta `/saas/facturacion` renderiza en blanco (`activeTab === 'invoices'` no tiene vista en `SuperAdminDashboard.jsx`), y `GET /api/saas/subscriptions` devuelve **HTTP 500** (`column t.name does not exist`).
- **Métricas y KPIs rotos:** Los 5 KPIs del dashboard siempre muestran `0` por desajuste de nombres de campos entre `GET /api/saas/metrics` (`total_tenants`, `mrr`, etc.) y `SuperAdminDashboard.jsx` (`totalTenants`, `estimatedMrr`, etc.), y el cálculo backend de `mrr` devuelve `0` en staging.
- **Acciones destructivas o con payload incompatible:** Crear tenant desde el panel falla con **HTTP 400** por nombres de campos distintos; ajustar sucursales/asientos resetea `plan_id = 1` y sobrescribe `modules_config`; toggle de módulos borra las demás claves de `modules_config`; el cambio de estado (`PUT /tenants/:id/status`) no sincroniza `tenant_subscriptions` ni audita.
- **Brechas puntuales en `/api/security`:** `SuperAdmin` puede consultar logs de auditoría globales (`GET /api/security/audit-logs`) e intentos de login globales (`GET /api/security/login-attempts`), mientras que `owner` también puede leer `login-attempts` sin filtro de tenant.

---

## 2. Inventario Completo del Perfil SuperAdmin

### 2.1 Rutas Frontend y Navegación (`src/App.jsx` y `SuperAdminDashboard.jsx`)

| Pantalla / Ruta | Acción / Elemento | Endpoint / Servicio | Permiso | Resultado | Evidencia |
|---|---|---|---|---|---|
| Sidebar SuperAdmin | Enlaces `/saas`, `/saas/planes`, `/saas/facturacion` | Navegación SPA | `isSuperAdmin` | **OK** (con redirect de rutas tenant a `/saas`) | `src/App.jsx` |
| `/saas` y `/saas/salones` (`initialTab="tenants"`) | Cargar 5 KPIs superiores | `GET /api/saas/metrics` | `requireControlPlaneRole` | **Fallo confirmado:** Siempre muestran `0` | `SuperAdminDashboard.jsx:20-27,516-568` vs payload live `{"total_tenants":8,"active_tenants":3,"suspended_tenants":0,"total_branches":10,"total_users":8,"mrr":0}` |
| `/saas` KPI "Sedes Físicas" | Clic en tarjeta | `navigate('/sucursales')` | `isSuperAdmin` | **Fallo confirmado:** Redirige inmediatamente de vuelta a `/saas` | `SuperAdminDashboard.jsx:534` + `src/App.jsx` |
| `/saas` Tabla de Salones | Listar tenants, uso, límites, add-ons | `GET /api/saas/tenants` | `requireControlPlaneRole` | **Fallo confirmado (parcial):** Carga lista pero campos de uso/límite leen claves inexistentes (`branch_count`, `user_count`, `max_allowed_users`, `plan_users_per_branch`) | `SuperAdminDashboard.jsx:683-860` vs keys live de `/api/saas/tenants[0]` |
| `/saas` Botón "+ Nuevo Salón" | Crear tenant manualmente | `POST /api/saas/tenants` | `requireControlPlaneRole` | **Fallo confirmado:** UI envía `email`, `owner_name`, `owner_password`; backend exige `owner_email`, `admin_password` (HTTP 400) | `SuperAdminDashboard.jsx:43-58,249-287` vs `saas.routes.js:215` |
| `/saas` Controles `+ / -` Sucursales y Usuarios | Ajustar licencias | `PUT /api/saas/tenants/:id/licensing` | `requireControlPlaneRole` | **Fallo confirmado:** UI envía `{ licensed_branches }` / `{ extra_user_seats }`; backend espera `{ plan_id, max_users, max_branches }`, resetea `plan_id=1` y pisa `modules_config` | `SuperAdminDashboard.jsx:145-174` vs `saas.routes.js` |
| `/saas` Toggle módulos legacy | Activar/desactivar módulo | `PUT /api/saas/tenants/:id/modules` | `requireControlPlaneRole` | **Fallo confirmado:** Envía `{ [moduleName]: val }` y sobrescribe todo `modules_config` JSONB con 1 sola clave | `SuperAdminDashboard.jsx:114-130` |
| `/saas` Toggle add-on Membresías | Habilitar/deshabilitar add-on | `PUT /api/saas/tenants/:tenantId/addons/:addonCode` | `requireControlPlaneRole` | **Riesgo detectado en código:** Funcionalidad base existe vía `EntitlementsService`, pero UI no muestra desglose por sucursal (`US$99/mes por sucursal`) | `dataService.js:3805-3814`, `saas.routes.js` |
| `/saas` Botón Suspender / Reactivar | Cambiar estado del tenant | `PUT /api/saas/tenants/:id/status` | `requireControlPlaneRole` | **Fallo confirmado:** Sin modal de confirmación (usa `alert()`), no valida allowlist de `status`, no sincroniza `tenant_subscriptions.status` ni registra auditoría | `saas.routes.js:325-335`, `SuperAdminDashboard.jsx` |
| `/saas/planes` (`initialTab="plans"`) | Ver y editar plan comercial | `GET /api/saas/plans`, `POST /api/saas/plans`, `PUT /api/saas/plans/:id` | `GET ?public_only=true` público; admin `requireSuperAdmin` | **OK (con deuda):** Devuelve 1 plan (`PRINCIPAL`); `saas_plans` en DB aún conserva `BASE` y `PRO` activos/públicos a nivel tabla | Probe live `COUNT /api/saas/plans: 1 codes: PRINCIPAL`; `psql` `saas_plans` (3 filas) |
| `/saas/facturacion` (`initialTab="invoices"`) | Ver suscripciones, facturas SaaS, extender gracia | `GET /api/saas/subscriptions`, `GET /api/saas/invoices`, `POST /api/saas/billing/admin/extend-grace` | `requireControlPlaneRole` / `superadmin` | **Fallo confirmado:** Pestaña renderiza vacía; `GET /api/saas/subscriptions` da **HTTP 500**; no existe UI para facturas ni `extend-grace` | `SuperAdminDashboard.jsx:13,622,912`; log staging `column t.name does not exist` |
| Sin UI en panel | Bandeja de mensajes de contacto | `GET /api/contact-messages` | `requireControlPlaneRole` | **Fallo confirmado (faltante UI):** Endpoint responde `200`, sin vista en frontend | `backend/app.js:612-619` |
| Sin UI en panel | Cambio de plan legacy admin | `PATCH /api/saas/tenants/:tenantId/subscription` | `requireControlPlaneRole` | **Riesgo detectado en código:** Mensaje obsoleto `'Solo se permite BASE o PRO'` y fallback `req.headers['x-user-id']` | `saas.routes.js:341,345` |

### 2.2 Matriz de Autorización y Separación de Funciones (Probado en Vivo sobre Staging — Solo Lectura)

Pruebas ejecutadas dentro de `salonpro_app` con tokens JWT firmados efímeros para `anon`, `owner` (`role: 'owner'`), `client` (`role: 'client'`) y `superadmin` (`role: 'superadmin', isSuperAdmin: true`):

| Endpoint | `anon` | `owner` | `client` | `superadmin` | Resultado |
|---|---:|---:|---:|---:|---|
| `GET /api/saas/metrics` | `401` | `403` | `401` | `200` | Control de acceso OK; payload incompatible con UI y `mrr: 0` |
| `GET /api/saas/tenants` | `401` | `403` | `401` | `200` | Control de acceso OK; faltan campos que espera UI |
| `GET /api/saas/subscriptions` | `401` | `403` | `401` | **`500`** | **Fallo confirmado** (`column t.name does not exist`) |
| `GET /api/saas/invoices` | `401` | `403` | `401` | `200` | OK (`0` facturas en staging); sin UI |
| `GET /api/saas/plans` | `403` | `403` | `403` | `200` | OK (`SUPERADMIN_REQUIRED` para no-superadmin) |
| `GET /api/saas/plans?public_only=true` | `200` | `200` | `200` | `200` | OK (catálogo público para landing/registro) |
| `GET /api/contact-messages` | `401` | `403` | `401` | `200` | OK; sin UI |
| `GET /api/security/audit-logs` | `401` | `200` | `401` | **`200`** | **Fallo confirmado:** Devuelve 17 logs globales a SuperAdmin; falta `rejectControlPlaneRoleOnTenantRoutes` o separación explícita |
| `GET /api/security/login-attempts` | `401` | **`200`** | `401` | **`200`** | **Fallo confirmado:** Sin filtro por tenant ni rol; expone `login_attempts`, `blocked_ips`, `account_lockouts` globales a cualquier `owner`/staff |
| `GET /api/security/settings` | `401` | `200` | `401` | `403` | Aislamiento OK |
| `GET /api/clients` | `401` | `200` | `401` | `403` | Aislamiento OK (SuperAdmin bloqueado) |
| `GET /api/cash-registers` | `401` | `404` | `401` | `403` | Aislamiento OK (SuperAdmin bloqueado) |

---

## 3. Hallazgos Clasificados por Severidad

### P0 — Críticos (Funcionalidad principal rota o brecha de aislamiento)

#### [P0-1] Vista `/saas/facturacion` renderiza en blanco y `GET /api/saas/subscriptions` devuelve HTTP 500
- **Estado:** **Fallo confirmado**
- **Archivo / Endpoint:** `src/components/admin/SuperAdminDashboard.jsx` (líneas 13, 622, 912); `backend/routes/saas.routes.js` (línea 116, `GET /api/saas/subscriptions`).
- **Pasos para reproducir:**
  1. Iniciar sesión como SuperAdmin y navegar a `/saas/facturacion` (o hacer clic en la pestaña Facturación).
  2. Consultar `GET /api/saas/subscriptions` autenticado como SuperAdmin.
- **Esperado vs. Observado:**
  - *Esperado:* Mostrar tabla de suscripciones SaaS, facturas de plataforma y acción para extender período de gracia (`POST /api/saas/billing/admin/extend-grace`).
  - *Observado:* El frontend no tiene ningún bloque JSX para `activeTab === 'invoices'` y muestra la pantalla vacía debajo de las pestañas. En backend, `GET /api/saas/subscriptions` falla con **HTTP 500** (`error: column t.name does not exist`).
- **Evidencia verificada:** Log de `salonpro_app` en staging (`Error fetching platform subscriptions: error: column t.name does not exist at /app/backend/routes/saas.routes.js:116:31`) y respuesta `STATUS: 500 BODY: {"error":"Error listando suscripciones SaaS"}`.
- **Corrección propuesta:** Corregir la consulta SQL en `saas.routes.js` usando `t.business_name` en lugar de `t.name`; implementar la vista de Facturación en `SuperAdminDashboard.jsx` conectada a `/api/saas/subscriptions`, `/api/saas/invoices` y `/api/saas/billing/admin/extend-grace`.
- **Prueba requerida:** Test de integración para `GET /api/saas/subscriptions` y `GET /api/saas/invoices` en `salon_saas_test`; verificación en Chrome de `/saas/facturacion`.

#### [P0-2] Desajuste de contrato al crear salones desde SuperAdmin (`POST /api/saas/tenants`) y creación forzada de planes B2C
- **Estado:** **Fallo confirmado**
- **Archivo / Endpoint:** `src/components/admin/SuperAdminDashboard.jsx` (líneas 43–58, 249–287); `backend/routes/saas.routes.js` (líneas 215, 290–318).
- **Pasos para reproducir:** Abrir "+ Nuevo Salón" en `/saas`, llenar el formulario y enviarlo.
- **Esperado vs. Observado:**
  - *Esperado:* Crear el tenant en estado consistente con `tenant_subscriptions` (`PRINCIPAL`), sin activar ni sembrar membresías B2C si no tiene el add-on.
  - *Observado:* El frontend envía `{ email, owner_name, owner_password, ... }` mientras el backend exige `owner_email` y `admin_password`, fallando con HTTP 400. Además, cuando el endpoint logra ejecutarse, inserta incondicionalmente 3 planes B2C (`Plan Beauty Pro`, etc.) aunque no tenga el add-on `memberships`, no crea registro en `tenant_subscriptions` y expone `error.message` en el 500.
- **Evidencia verificada:** Lectura directa de `SuperAdminDashboard.jsx` y `saas.routes.js`.
- **Corrección propuesta:** Alinear el payload del formulario con el backend (`owner_email`, `admin_password`), crear la suscripción inicial en `tenant_subscriptions` vía `EntitlementsService.createInitialSubscription`, omitir la siembra de planes B2C salvo que se contrate el add-on `memberships`, y sanitizar errores 500.
- **Prueba requerida:** Test E2E/integración de `POST /api/saas/tenants` en `salon_saas_test` verificando creación de `tenants` + `tenant_subscriptions` sin planes B2C por defecto.

#### [P0-3] `/api/security` permite acceso de SuperAdmin a datos de seguridad y expone `login_attempts` globales a tenants
- **Estado:** **Fallo confirmado**
- **Archivo / Endpoint:** `backend/app.js` (línea 516); `backend/routes/security.routes.js` (líneas 29–38, 413–461, 562).
- **Pasos para reproducir:**
  1. Llamar `GET /api/security/audit-logs` con token `superadmin`.
  2. Llamar `GET /api/security/login-attempts` con token `owner` o `superadmin`.
- **Esperado vs. Observado:**
  - *Esperado:* Aislamiento estricto: `owner`/staff solo ven eventos de su propio tenant; el monitoreo global de plataforma pertenece a endpoints exclusivos de Control Plane.
  - *Observado:* `/api/security` no tiene `rejectControlPlaneRoleOnTenantRoutes` en `app.js`. `GET /api/security/audit-logs` devuelve logs de todos los tenants al SuperAdmin (17 filas en staging), y `GET /api/security/login-attempts` devuelve `attempts`, `blockedIps` y `blockedAccounts` sin filtro de tenant ni control de rol tanto a `owner` (`200`) como a `superadmin` (`200`).
- **Evidencia verificada:** Probe HTTP en vivo sobre staging (`GET /api/security/audit-logs` -> `owner:200, superadmin:200`; `GET /api/security/login-attempts` -> `owner:200, superadmin:200`).
- **Corrección propuesta:** Restringir `/api/security/login-attempts`, `/unblock-ip` y `/unblock-account` a Control Plane (`requireControlPlaneRole`) o moverlos bajo `/api/saas/security/*`, y aplicar `rejectControlPlaneRoleOnTenantRoutes` al resto de `/api/security`.
- **Prueba requerida:** Matriz de autorización automatizada verificando `403` para `owner`/`staff` en endpoints globales de IP/lockouts y `403` para `superadmin` en rutas operativas de seguridad del salón.

---

### P1 — Altos (Corrupción de configuración, métricas falsas y desincronización de estado)

#### [P1-1] KPIs del Dashboard SuperAdmin muestran siempre `0` y `mrr` backend devuelve `0`
- **Estado:** **Fallo confirmado**
- **Archivo / Endpoint:** `src/components/admin/SuperAdminDashboard.jsx` (líneas 20–27, 516–568); `backend/routes/saas.routes.js` (líneas 67–72).
- **Esperado vs. Observado:**
  - *Esperado:* Mostrar conteos reales y MRR calculado según plan principal (`US$99/sucursal`), usuarios adicionales y add-on de membresías (`US$99/sucursal habilitada`).
  - *Observado:* En staging existen 8 tenants (3 activos, 10 sucursales, 8 usuarios), pero la UI lee `metrics.totalTenants`, `metrics.activeTenants`, `metrics.totalBranches`, `metrics.totalUsers`, `metrics.estimatedMrr` mientras el API devuelve `total_tenants`, `active_tenants`, `total_branches`, `total_users`, `mrr`. Además, el backend suma `sp.price_monthly` vía `tenants.plan_id` (que en staging apunta a `plan_id = 1` o `2` donde `price_monthly` es `NULL`), devolviendo `mrr: 0`.
- **Evidencia verificada:** Probe HTTP live `{"total_tenants":8,"active_tenants":3,"suspended_tenants":0,"total_branches":10,"total_users":8,"mrr":0}` y query SQL a `saas_plans` / `tenants` en staging.
- **Corrección propuesta:** Calcular MRR desde `tenant_subscriptions` + sucursales activas + add-ons habilitados + asientos extra usando el catálogo canónico; alinear los nombres de propiedades entre backend y frontend.
- **Prueba requerida:** Test unitario/integración de cálculo de MRR con múltiples sucursales y add-on en `salon_saas_test`.

#### [P1-2] Ajuste de sucursales/usuarios y toggle de módulos sobrescriben `plan_id` y `modules_config`
- **Estado:** **Fallo confirmado**
- **Archivo / Endpoint:** `src/components/admin/SuperAdminDashboard.jsx` (líneas 114–130, 145–174); `backend/routes/saas.routes.js` (`PUT /tenants/:id/licensing`, `PUT /tenants/:id/modules`).
- **Esperado vs. Observado:**
  - *Esperado:* Incrementar/decrementar `max_branches` o `max_users` preservando el plan y los módulos existentes.
  - *Observado:* `handleAdjustBranches` y `handleAdjustSeats` envían `{ licensed_branches }` / `{ extra_user_seats }`, pero el backend espera `{ plan_id, max_users, max_branches }`, por lo que resetea `plan_id = 1` y pisa `modules_config` con claves legacy hardcoded (`cash_register`, `loyalty_plans`, `payroll: false`, `marketing: false`). Por su parte, `handleToggleModule` envía un objeto de 1 clave que reemplaza por completo el JSONB `modules_config`.
- **Evidencia verificada:** Lectura directa de `SuperAdminDashboard.jsx` y `saas.routes.js`.
- **Corrección propuesta:** Unificar los endpoints de licenciamiento con `tenant_subscriptions` y el catálogo canónico, eliminando los overrides legacy sobre `modules_config` o realizando merge parcial validado.
- **Prueba requerida:** Test de integración verificando que cambiar `max_branches`/`max_users` no altera `plan_code` ni borra `modules_config`.

#### [P1-3] `PUT /api/saas/tenants/:id/status` desincroniza `tenants.status` vs `tenant_subscriptions.status` y no audita
- **Estado:** **Fallo confirmado**
- **Archivo / Endpoint:** `backend/routes/saas.routes.js` (líneas 325–335); `backend/services/entitlements.service.js`.
- **Esperado vs. Observado:**
  - *Esperado:* Validar estados permitidos (`active`, `suspended`, `pending`, etc.), sincronizar `tenant_subscriptions.status` (que es la fuente que consulta `EntitlementsService.hasFeature`) y registrar evento en auditoría.
  - *Observado:* `PUT /tenants/:id/status` solo actualiza `tenants.status` sin allowlist ni auditoría. En staging ya se observan 5 tenants con `tenants.status = 'pending'` pero `tenant_subscriptions.status = 'active'`, y todos los tenants conservan `tenants.plan_id` en `1` o `2` aunque `tenant_subscriptions.plan_code` sea `'PRINCIPAL'`.
- **Evidencia verificada:** Consulta `psql` en `salon_saas_staging` mostrando la divergencia entre `tenants` y `tenant_subscriptions`.
- **Corrección propuesta:** Validar allowlist de `status`, actualizar `tenants` y `tenant_subscriptions` en la misma transacción, invalidar caché de entitlements y registrar auditoría.
- **Prueba requerida:** Test de integración confirmando que suspender un tenant bloquea `EntitlementsService.hasFeature`.

#### [P1-4] Tabla de salones lee propiedades inexistentes y hardcodea tarifa `($15/mes)`
- **Estado:** **Fallo confirmado**
- **Archivo / Endpoint:** `src/components/admin/SuperAdminDashboard.jsx` (líneas 683–860, 803); `GET /api/saas/tenants`.
- **Esperado vs. Observado:** La UI lee `branch_count`, `user_count`, `max_allowed_users`, `plan_users_per_branch`, `plan_is_public`, pero el backend devuelve `branches_count`, `users_count`, `plan_max_branches`, `plan_max_users` (sin `max_allowed_users` ni `plan_users_per_branch`). Además, el tooltip de usuario extra hardcodea `"($15/mes)"` en lugar de usar `extra_user_price` (`US$30` en el plan `PRINCIPAL`).
- **Evidencia verificada:** Keys reales de `GET /api/saas/tenants[0]` en staging y lectura de `SuperAdminDashboard.jsx`.
- **Corrección propuesta:** Alinear el DTO de `GET /api/saas/tenants` con la UI y consumir `extra_user_price` del plan canónico.
- **Prueba requerida:** Test de contrato del endpoint `GET /api/saas/tenants` + verificación visual de tabla en `/saas`.

---

### P2 — Medios (UX rota, inconsistencias legacy y faltantes operativos)

#### [P2-1] Tarjeta KPI "Sedes Físicas" navega a `/sucursales` y rebota a `/saas`
- **Estado:** **Fallo confirmado**
- **Archivo / Endpoint:** `src/components/admin/SuperAdminDashboard.jsx` (línea 534); `src/App.jsx`.
- **Corrección propuesta:** Eliminar el `onClick` hacia `/sucursales` o mostrar un desglose Control Plane dentro de `/saas`.

#### [P2-2] Endpoint `/api/contact-messages` y `/api/saas/billing/admin/extend-grace` sin interfaz en SuperAdmin
- **Estado:** **Fallo confirmado**
- **Archivo / Endpoint:** `backend/app.js` (línea 612); `backend/routes/saas_billing.routes.js` (línea 431).
- **Corrección propuesta:** Agregar vista/pestaña de Mensajes de Contacto / Soporte y acción de Extender Gracia dentro de Facturación.

#### [P2-3] Errores de API silenciados, uso de `alert()`, sin paginación ni confirmación de acciones críticas
- **Estado:** **Fallo confirmado**
- **Archivo / Endpoint:** `src/components/admin/SuperAdminDashboard.jsx` (líneas 88–92 y handlers de acciones).
- **Corrección propuesta:** Mostrar estados de error con reintento (en lugar de `.catch(() => {})`), reemplazar `alert()` por notificaciones/modales de confirmación para suspender/reactivar o modificar add-ons, y agregar paginación/búsqueda.

#### [P2-4] Deuda legacy en `PATCH /api/saas/tenants/:tenantId/subscription` y tabla `saas_plans`
- **Estado:** **Riesgo detectado en código**
- **Archivo / Endpoint:** `backend/routes/saas.routes.js` (líneas 341, 345); tabla `saas_plans` en staging.
- **Observado:** El endpoint aún valida con mensaje `'Solo se permite BASE o PRO'` y tiene fallback `req.headers['x-user-id']`. En la tabla `saas_plans` de staging, las filas `BASE` y `PRO` permanecen con `is_public = true, is_active = true` aunque `GET /api/saas/plans` solo devuelva `PRINCIPAL`.
- **Corrección propuesta:** Retirar referencias a `BASE`/`PRO`, eliminar fallback de header `x-user-id` y marcar `BASE`/`PRO` como inactivos/no públicos en migración idempotente cuando corresponda.

#### [P2-5] `/api/test` montado sin `rejectControlPlaneRoleOnTenantRoutes`
- **Estado:** **Riesgo detectado en código**
- **Archivo / Endpoint:** `backend/app.js` (línea 624); `backend/routes/test.routes.js` (líneas 4–60).
- **Observado:** Aunque los handlers verifican `req.tenantId` (por lo que SuperAdmin recibe `403`), `/api/test` debería estar deshabilitado en producción/staging no-test o protegido explícitamente con `rejectControlPlaneRoleOnTenantRoutes`.

---

### P3 — Bajos / Pendientes de validación

#### [P3-1] Comportamiento de `dataService.js` para llamadas SaaS con `fetch` directo vs `fetchWithAuth`
- **Estado:** **Comportamiento pendiente de validación**
- **Archivo / Endpoint:** `src/utils/dataService.js` (líneas 3190–3262, 3805–3814).
- **Observado:** Los métodos `getSaasMetrics`, `getSaasTenants`, `getSaasPlans`, `createSaasPlan`, `updateSaasPlan`, `updateTenantModules`, `updateTenantLicensing`, `updateTenantStatus` y `setTenantAddon` usan `fetch(...)` sin pasar por el wrapper autenticado común (`fetchWithAuth`). En despliegue same-origin la cookie viaja por defecto (`same-origin`), pero en entornos con cabecera CSRF/Bearer explícita o subdominios distintos podría fallar.
- **Prueba requerida:** Validar en navegador real (login SuperAdmin en staging) todas las acciones de escritura del dashboard.

#### [P3-2] Mecanismo de acceso de soporte temporal (impersonación controlada)
- **Estado:** **Comportamiento pendiente de validación** (No existe actualmente)
- **Observado:** No existe flujo de soporte temporal con autorización explícita del tenant, expiración y auditoría; actualmente SuperAdmin no tiene acceso operativo alguno (lo cual protege el aislamiento, pero limita soporte guiado si el negocio lo requiere).

---

## 4. Plan Priorizado de Corrección (Orden Recomendado)

1. **Seguridad y separación Control Plane (`P0-3`, `P2-5`):** Proteger `/api/security/login-attempts`, `/unblock-ip`, `/unblock-account` y `/api/security/audit-logs` para impedir fuga cross-tenant a `owner` y acceso indebido de SuperAdmin a logs operativos de salones; blindar `/api/test`.
2. **Reparar Facturación SaaS y Suscripciones (`P0-1`):** Corregir `t.business_name` en `GET /api/saas/subscriptions` e implementar la UI completa de `/saas/facturacion` (suscripciones, facturas SaaS y extensión de gracia).
3. **Unificar Creación y Estado de Tenants (`P0-2`, `P1-3`):** Corregir contrato de `POST /api/saas/tenants`, sincronizar `tenants` con `tenant_subscriptions`, eliminar siembra automática de planes B2C sin add-on, y validar/auditar `PUT /api/saas/tenants/:id/status`.
4. **Corregir Métricas, Licenciamiento y Tabla de Salones (`P1-1`, `P1-2`, `P1-4`):** Calcular MRR real desde suscripciones/sucursales/add-ons/asientos extra, alinear DTOs de `/api/saas/metrics` y `/api/saas/tenants` con `SuperAdminDashboard.jsx`, y reemplazar `licensed_branches`/`modules` legacy por gestión basada en `EntitlementsService` y tarifa canónica (`extra_user_price`).
5. **Completar Operativa y UX (`P2-1`, `P2-2`, `P2-3`, `P2-4`, `P3-1`):** Agregar bandeja de `/api/contact-messages`, corregir clic en KPI "Sedes Físicas", añadir manejo de errores/confirmaciones/paginación, limpiar referencias `BASE`/`PRO` y unificar `fetchWithAuth` en `dataService.js`.

