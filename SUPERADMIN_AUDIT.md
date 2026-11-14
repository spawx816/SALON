# Auditoría y Remediación Integral — Perfil SuperAdmin (Etereas)

**Fecha de auditoría:** 2026-11-14  
**Fecha de remediación:** 2026-11-14  
**Alcance:** Panel de Control Global del SaaS (`SuperAdminDashboard`, rutas `/saas*`, `backend/routes/saas.routes.js`, `backend/routes/saas_billing.routes.js`, `backend/middleware/auth.middleware.js`, `backend/app.js`, `backend/routes/security.routes.js`, `src/utils/dataService.js`) y verificación en staging (`179.66.139.67`, `salon_saas_staging`, contenedor `salonpro_app` con imagen `salonpro-app:496b5d5`).

---

## 1. Veredicto Actualizado Post-Remediación

Se completaron los **7 bloques de remediación** sobre el perfil SuperAdmin y el aislamiento Control Plane vs. Tenant Plane:

- **Bloque 1 — Seguridad y Separación Control Plane:** `/api/security/*` bloquea `superadmin` vía `rejectControlPlaneRoleOnTenantRoutes`, restringe `/api/security/login-attempts`, `/unblock-account` y `/audit-logs` a `req.verifiedTenantId` (`propietario`/`admin`), bloquea `/api/security/unblock-ip` para tenants (`403 CONTROL_PLANE_ONLY`), y mueve la operación global de plataforma a `/api/saas/security/*` con auditoría (`tenant_id = NULL`). `/api/test` queda deshabilitado salvo `NODE_ENV === 'test' && ENABLE_TEST_ROUTES === 'true'`.
- **Bloque 2 — Facturación y Suscripciones SaaS:** Corregido `t.business_name` en `GET /api/saas/subscriptions`, implementada la vista `/saas/facturacion` (`activeTab === 'invoices'`) con filtros, paginación, estados vacíos, separación de facturas SaaS respecto a facturas comerciales de salones, y modal para `POST /api/saas/billing/admin/extend-grace` (`1..90` días con `reason` obligatorio).
- **Bloque 3 — Creación y Estado de Tenants:** Alineado el contrato de `POST /api/saas/tenants` en una sola transacción (tenant + branch + salon + owner + `tenant_subscriptions` `PRINCIPAL` + `tenant_subscription_events`) sin siembra automática de planes B2C ni exposición de `error.message`. `PUT /api/saas/tenants/:id/status` implementa máquina de estados explícita, sincroniza `tenant_subscriptions.status`, invalida caché de entitlements y audita.
- **Bloque 4 — Licenciamiento y Módulos:** `PUT /api/saas/tenants/:id/modules` aplica merge parcial validado (rechazando `memberships` para mantener el add-on separado) y `PUT /api/saas/tenants/:id/licensing` actualiza `licensed_branches`/`extra_user_seats` preservando `plan_id`, `modules_config` y `has_memberships`, ambos en transacción (`FOR UPDATE`), auditados y con invalidación de caché.
- **Bloque 5 — Métricas y Tabla de Salones:** Cálculo exacto de MRR en centavos agrupado por moneda (`mrr_by_currency`), excluyendo cuentas de prueba, estados no activos y cargos únicos; DTOs de `GET /api/saas/metrics` y `GET /api/saas/tenants` alineados con `SuperAdminDashboard.jsx` y tooltip dinámico con `plan_extra_user_price`.
- **Bloque 6 — UX y Limpieza Legacy:** Tarjeta "Sedes Físicas" abre la pestaña Control Plane `branches` (`GET /api/saas/branches`); agregada bandeja `contacts` (`GET /api/contact-messages`); reemplazados `alert()` y `.catch(() => {})` por estados `errorMessage`/`loadError` + reintentar + modales de confirmación + paginación; unificado `saasFetch` en `dataService.js`; retirados `BASE`/`PRO` de la oferta activa/pública mediante migración idempotente (`backend/migrations/20261114_retire_legacy_base_pro_public.cjs`) preservando filas históricas.
- **Bloque 7 — Pruebas y Despliegue a Staging:** Respaldo previo de `salon_saas_staging` (`/tmp/backup_staging_pre_superadmin_remediation.dump`), pruebas de integración PostgreSQL en `salon_saas_test`, verificación en vivo contra `salonpro_app` (`salonpro-app:496b5d5`) y verificación de UI en Chrome headless. `salon_saas_prod` permanece intacto (`0` tablas).

---

## 2. Detalle por Hallazgo (Hallazgo -> Corrección -> Prueba y Resultado -> Pendientes Reales)

### P0 — Críticos

#### [P0-1] Vista `/saas/facturacion` en blanco y `GET /api/saas/subscriptions` con HTTP 500
- **Hallazgo:** `SuperAdminDashboard.jsx` no tenía JSX para `activeTab === 'invoices'` y `GET /api/saas/subscriptions` fallaba con `HTTP 500` (`column t.name does not exist` en `backend/routes/saas.routes.js`).
- **Corrección:** Se corrigió la consulta SQL usando `t.business_name as salon_name, t.status as tenant_status` en `backend/routes/saas.routes.js`, se endureció `POST /api/saas/billing/admin/extend-grace` (`additionalDays` entero `1..90`, `reason >= 3` caracteres, `actorId` desde `req.auth`), y se implementó la pestaña `invoices` en `SuperAdminDashboard.jsx` con suscripciones SaaS, facturas SaaS de plataforma, filtros, paginación, estados vacíos y modal de extensión de gracia.
- **Prueba y resultado:**
  - `node backend/tests/test_phase2d_saas_billing_unit.cjs`: `35/35 PASS`.
  - `node backend/tests/test_superadmin_remediation_pg.cjs` (`salon_saas_test`): PASS para `/api/saas/subscriptions` y `/api/saas/billing/admin/extend-grace`.
  - Probe live en staging (`salonpro-app:496b5d5`): `GET /api/saas/subscriptions` -> `HTTP 200` (`COUNT: 8`).
  - Chrome headless (`https://127.0.0.1:4179/saas/facturacion` con mocks de API): `SAAS_FACTURACION_OK: true`, `PAGE_ERRORS: 0`.
- **Pendientes reales:** No existen facturas SaaS generadas aún en `salon_saas_staging` (`0` filas en `saas_invoices`), por lo que en staging la tabla de facturas muestra su estado vacío hasta que se ejecute un ciclo de facturación o prueba controlada.

#### [P0-2] Desajuste de contrato en `POST /api/saas/tenants` y siembra forzada de planes B2C
- **Hallazgo:** La UI enviaba `email`, `owner_name`, `owner_password` mientras el backend exigía `owner_email`, `admin_password` (HTTP 400); además, el backend sembraba 3 planes B2C por defecto sin tener add-on `memberships`, no creaba `tenant_subscriptions` y exponía `error.message` en errores 500.
- **Corrección:** Se alineó el contrato entre `SuperAdminDashboard.jsx` y `backend/routes/saas.routes.js`, ejecutando creación de tenant + branch + salon + owner + `tenant_subscriptions` (`PRINCIPAL`) + `tenant_subscription_events` dentro de una única transacción con rollback, eliminando la siembra automática de `plans` B2C y sanitizando respuestas 500.
- **Prueba y resultado:** `test_superadmin_remediation_pg.cjs` en `salon_saas_test` verificó creación atómica con `tenant_subscriptions` `PRINCIPAL` y `0` planes B2C creados por defecto (PASS).
- **Pendientes reales:** Ninguno en código.

#### [P0-3] `/api/security` permitía acceso a SuperAdmin y exponía `login_attempts` globales a tenants
- **Hallazgo:** `/api/security` carecía de `rejectControlPlaneRoleOnTenantRoutes` en `backend/app.js`; `GET /api/security/audit-logs` y `GET /api/security/login-attempts` devolvían datos globales tanto a `superadmin` como a `owner`.
- **Corrección:**
  - `backend/app.js`: agregado `rejectControlPlaneRoleOnTenantRoutes` al montaje de `/api/security`.
  - `backend/routes/security.routes.js`: eliminada la excepción `!isSuperAdmin` en `requireTenant`; `GET /audit-logs`, `GET /login-attempts` y `POST /unblock-account` filtrados estrictamente por `req.verifiedTenantId` y restringidos a `requireRole('propietario', 'admin')`; `POST /unblock-ip` bloqueado para tenants (`403 CONTROL_PLANE_ONLY`); removido `superadmin` de `POST /settings`.
  - `backend/routes/saas.routes.js`: agregados endpoints Control Plane `GET /api/saas/security/login-attempts`, `POST /api/saas/security/unblock-ip`, `POST /api/saas/security/unblock-account` y `GET /api/saas/security/audit-logs` con registro de auditoría (`tenant_id = NULL`).
- **Prueba y resultado:**
  - `test_phase2h_superadmin_separation.cjs`, `test_phase2h_p1_security.cjs` (`22/22` con `ENABLE_TEST_ROUTES='true'`) y `test_superadmin_remediation_pg.cjs` (`[PASS] 4`).
  - Probe live en staging (`salonpro-app:496b5d5`):
    - `/api/security/audit-logs` y `/api/security/login-attempts`: `anon:401`, `owner:200`, `client:401`, `superadmin:403`.
    - `/api/saas/security/*`: `superadmin:200`, `owner:403`.
- **Pendientes reales:** Ninguno en código.

---

### P1 — Altos

#### [P1-1] KPIs mostraban `0` y cálculo backend de `mrr` devolvía `0`
- **Hallazgo:** Desajuste de nombres (`totalTenants` vs `total_tenants`, `estimatedMrr` vs `mrr`) y suma backend basada en `tenants.plan_id` (`1`/`2` con `price_monthly = NULL`).
- **Corrección:** `GET /api/saas/metrics` calcula MRR exacto en centavos agrupado por moneda (`mrr_by_currency`), excluyendo cuentas de prueba, estados no activos y cargos únicos; `SuperAdminDashboard.jsx` consume los campos canónicos y `mrr_by_currency`.
- **Prueba y resultado:**
  - `test_superadmin_remediation_pg.cjs`: cálculo multi-sucursal + add-on + asientos extra verificado (PASS).
  - Probe live en staging: `GET /api/saas/metrics` -> `{"total_tenants":8,"active_tenants":3,"suspended_tenants":0,"total_branches":10,"total_users":8,"mrr":297,"mrr_by_currency":{"DOP":297}}`.
  - Chrome headless (`/saas`): `SAAS_KPIS_OK: true` (`US$297.00`).
- **Pendientes reales:** En `salon_saas_staging`, las suscripciones/tenants históricos devuelven moneda `DOP` en `mrr_by_currency` (`{"DOP": 297}`), aunque los precios del plan `PRINCIPAL` están expresados comercialmente en `USD` (`US$99`). Conviene revisar la moneda almacenada en `tenant_subscriptions.currency` / `tenants.currency` de los registros históricos de staging (ver sección 3).

#### [P1-2] Ajuste de licencias y toggle de módulos sobrescribían `plan_id` y `modules_config`
- **Hallazgo:** `PUT /api/saas/tenants/:id/licensing` reseteaba `plan_id = 1` y sobrescribía `modules_config`; `PUT /api/saas/tenants/:id/modules` reemplazaba todo el JSONB con 1 clave.
- **Corrección:** Ambos endpoints ejecutan dentro de transacción con `FOR UPDATE`, auditoría e invalidación de caché: `PUT /modules` hace merge parcial validado y rechaza `memberships` (para mantener el add-on separado); `PUT /licensing` actualiza licencias preservando `plan_id`, `modules_config` y `has_memberships`.
- **Prueba y resultado:** `test_superadmin_remediation_pg.cjs` en `salon_saas_test` confirmó preservación de `plan_id`, `modules_config` y `has_memberships` tras ajustes parciales (PASS).
- **Pendientes reales:** Ninguno.

#### [P1-3] `PUT /api/saas/tenants/:id/status` desincronizaba `tenants` vs `tenant_subscriptions` y no auditaba
- **Hallazgo:** Solo actualizaba `tenants.status` sin máquina de estados, sin sincronizar `tenant_subscriptions.status` ni registrar auditoría.
- **Corrección:** Se implementó máquina de estados explícita, sincronización transaccional con `tenant_subscriptions.status`, invalidación de caché de entitlements y auditoría en `PUT /api/saas/tenants/:id/status`.
- **Prueba y resultado:** `test_superadmin_remediation_pg.cjs` confirmó sincronización bidireccional y bloqueo de `EntitlementsService.hasFeature` al suspender (PASS).
- **Pendientes reales:** Existen discrepancias históricas preexistentes en `salon_saas_staging` que **no fueron modificadas automáticamente** (ver sección 3).

#### [P1-4] Tabla de salones leía propiedades inexistentes y hardcodeaba `($15/mes)`
- **Hallazgo:** La UI leía `branch_count`, `user_count`, `max_allowed_users` y mostraba `"($15/mes)"` fijo.
- **Corrección:** Alineado el DTO de `GET /api/saas/tenants` y `SuperAdminDashboard.jsx` usando `branches_count`, `users_count`, `max_users` y `plan_extra_user_price` dinámico.
- **Prueba y resultado:** Chrome headless (`/saas`): renderiza `Salon Alpha`, conteos y límites sin errores (`SAAS_KPIS_OK: true`, `PAGE_ERRORS: 0`).
- **Pendientes reales:** Ninguno.

---

### P2 — Medios

#### [P2-1] Tarjeta KPI "Sedes Físicas" rebotaba a `/saas` vía `/sucursales`
- **Hallazgo:** `onClick={() => navigate('/sucursales')}` redirigía de vuelta a `/saas` para SuperAdmin.
- **Corrección:** La tarjeta abre la pestaña Control Plane `branches` alimentada por `GET /api/saas/branches`.
- **Prueba y resultado:** Probe live staging `GET /api/saas/branches` -> `HTTP 200` (`COUNT: 10`); Chrome headless clic en "Sedes Físicas" -> `SAAS_BRANCHES_TAB_OK: true`.
- **Pendientes reales:** Ninguno.

#### [P2-2] `/api/contact-messages` y `/api/saas/billing/admin/extend-grace` sin UI
- **Hallazgo:** Endpoints existían sin interfaz en `SuperAdminDashboard.jsx`.
- **Corrección:** Agregada pestaña `contacts` (`GET /api/contact-messages`) y modal de extensión de gracia en `invoices`.
- **Prueba y resultado:** Chrome headless verificó `SAAS_CONTACTS_TAB_OK: true` y `SAAS_FACTURACION_OK: true`.
- **Pendientes reales:** Ninguno.

#### [P2-3] Errores silenciados, `alert()`, falta de confirmación y paginación
- **Hallazgo:** `.catch(() => {})` y `alert()` en handlers críticos, sin paginación en tabla de salones.
- **Corrección:** Estados `errorMessage` / `loadError` con botón Reintentar, modal `confirmModal` para acciones críticas y paginación (`PAGE_SIZE = 10`).
- **Prueba y resultado:** `npx eslint src backend --quiet` (0 errores), `npm run build` OK y verificación Chrome headless con 0 `pageerror`.
- **Pendientes reales:** Ninguno.

#### [P2-4] Deuda legacy en `PATCH /api/saas/tenants/:tenantId/subscription` y tabla `saas_plans`
- **Hallazgo:** Mensaje obsoleto `'Solo se permite BASE o PRO'`, fallback `req.headers['x-user-id']`, y filas `BASE`/`PRO` con `is_public = true, is_active = true` en DB.
- **Corrección:** Limpiado `PATCH /api/saas/tenants/:tenantId/subscription` en `backend/routes/saas.routes.js`; creada migración idempotente `backend/migrations/20261114_retire_legacy_base_pro_public.cjs` y ejecutado el retiro en `salon_saas_staging` (`UPDATE 2`, manteniendo filas históricas y dejando `PRINCIPAL` con `is_public = true, is_active = true`).
- **Prueba y resultado:** En `salon_saas_staging`, `BASE` y `PRO` quedaron con `is_public = false, is_active = false`; `PRINCIPAL` permanece activo y público.
- **Pendientes reales:** Ninguno.

#### [P2-5] `/api/test` sin bloqueo estricto fuera de entorno test
- **Hallazgo:** `/api/test` carecía de compuerta por entorno + middlewares de separación de rol.
- **Corrección:** En `backend/app.js`, `/api/test` solo se monta cuando `process.env.NODE_ENV === 'test' && process.env.ENABLE_TEST_ROUTES === 'true'`, protegido además con `rejectControlPlaneRoleOnTenantRoutes` y `rejectClientRoleOnStaffRoutes`.
- **Prueba y resultado:** Probe live en staging (`NODE_ENV=production`): `/api/test/simulate-500` devolvió `HTTP 403` para todos los roles.
- **Pendientes reales:** Ninguno.

---

### P3 — Bajos / Pendientes de Validación

#### [P3-1] Unificación de `fetch` en `src/utils/dataService.js`
- **Hallazgo:** Llamadas SaaS usaban `fetch(...)` directo sin wrapper consistente.
- **Corrección:** Se creó `saasFetch` (`credentials: 'include'`) y se unificaron todos los métodos SuperAdmin en `src/utils/dataService.js`, eliminando además el método duplicado `getContactMessages`.
- **Prueba y resultado:** `npx eslint src backend --quiet` y `npm run build` sin errores; probado con sesión SuperAdmin en Chrome headless.
- **Pendientes reales:** Ninguno.

#### [P3-2] Mecanismo de soporte temporal controlado (impersonación)
- **Hallazgo:** No existe flujo de soporte temporal con autorización explícita del tenant, TTL y auditoría.
- **Corrección:** Fuera del alcance de remediación actual; se mantiene el aislamiento estricto (SuperAdmin sin acceso operativo a salones).
- **Prueba y resultado:** Verificado que SuperAdmin recibe `403` en rutas operativas (`/api/clients`, `/api/cash-registers`, `/api/security/*`).
- **Pendientes reales:** Evaluar en fase futura solo si negocio requiere soporte guiado con consentimiento explícito del propietario y expiración automática.

---

## 3. Discrepancias Históricas Detectadas en `salon_saas_staging` (No Auto-Reconciliadas)

Por seguridad de datos, **no se modificaron automáticamente** registros históricos ambiguos en `salon_saas_staging`. Se documentan aquí junto con la propuesta de resolución manual:

1. **5 tenants con estado divergente (`tenants.status = 'pending'` vs `tenant_subscriptions.status = 'active'`):**
   - Slugs/nombres observados: `DVAASC`, `1d23dc`, `123123`, `cvsvsar`, `vadasd`.
   - **Propuesta de resolución:** Confirmar con producto/soporte cuáles corresponden a pruebas descartables vs salones reales en onboarding, y luego ejecutar el cambio vía UI (`PUT /api/saas/tenants/:id/status`) o SQL controlado en transacción:
     ```sql
     -- Si son pruebas por suspender/archivar:
     UPDATE tenants SET status = 'suspended' WHERE business_name IN ('DVAASC', '1d23dc', '123123', 'cvsvsar', 'vadasd') AND status = 'pending';
     UPDATE tenant_subscriptions ts SET status = 'suspended'
     FROM tenants t WHERE ts.tenant_id = t.id AND t.business_name IN ('DVAASC', '1d23dc', '123123', 'cvsvsar', 'vadasd');
     ```
2. **8 tenants con `tenants.plan_id` legado (`1` o `2`) mientras `tenant_subscriptions.plan_code = 'PRINCIPAL'`:**
   - Todos los 8 tenants actuales en `salon_saas_staging` conservan `plan_id` apuntando a `BASE`/`PRO` en la tabla `tenants`, aunque su suscripción en `tenant_subscriptions` ya es `PRINCIPAL`.
   - **Propuesta de resolución:** Alinear `tenants.plan_id` al `id` de `PRINCIPAL` en `saas_plans` tras revisar si alguno debe permanecer en legado histórico:
     ```sql
     UPDATE tenants t
     SET plan_id = sp.id
     FROM saas_plans sp, tenant_subscriptions ts
     WHERE sp.code = 'PRINCIPAL'
       AND ts.tenant_id = t.id
       AND ts.plan_code = 'PRINCIPAL'
       AND t.plan_id IN (1, 2);
     ```
3. **Moneda en `tenant_subscriptions` de staging (`DOP` vs `USD`):**
   - `GET /api/saas/metrics` en staging reportó `"mrr_by_currency":{"DOP":297}` porque `ts.currency` está guardado como `'DOP'` en los registros históricos de staging aunque los montos (`99 * sucursal`) corresponden a tarifas en `USD`.
   - **Propuesta de resolución:** Validar si los registros de prueba en staging deben actualizar `tenant_subscriptions.currency = 'USD'` para reflejar la moneda real del plan `PRINCIPAL`.
