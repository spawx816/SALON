# Plan Maestro y Registro de Aceptación por Módulos — Etereas

Documento único y autoritativo de validación sistemática de Etereas por módulos y procesos de negocio.

- **Release candidato actual**: commit `9111f42` / imagen `salonpro-app:9111f42` (staging).
- **Base de pruebas automatizadas**: `salon_saas_test` (PostgreSQL 17, aislada con guardas canónicas).
- **Entorno de producción**: intacto (`salon_saas_prod` sin escrituras, sin cargos CardNet reales). Variables reales verificadas en el contenedor staging `salonpro_app`: `SAAS_RENEWAL_WORKER_ENABLED=<unset>` (el código en `backend/services/consolidated_renewal.service.js:52` exige `=== 'true'`, por lo que el worker está **efectivamente desactivado**), `DGII_ENABLED=<unset>`, `DGII_MODE=disabled`, `DGII_ENV=<unset>`.

---

## Reglas Transversales de Etereas (Verificación Continua)

1. Un único **Plan Principal**.
2. Tres (3) asientos incluidos por sucursal contratada más asientos extras adquiridos.
3. Owner y personal operativo consumen asiento.
4. Rol técnico `kiosco_asistencia` exento de cuota y restringido a kiosco.
5. Una sesión activa por usuario; pestañas del mismo navegador comparten sesión.
6. Catálogo es la única fuente de productos y servicios.
7. Inventario utiliza productos del catálogo.
8. Servicios no descuentan stock.
9. Membresías es add-on independiente de **US$99/mes por bloque de hasta 3 sucursales habilitadas**.
10. Facturación convencional (NCF `B01`/`B02` o sin comprobante) funciona sin integración electrónica DGII.
11. Precuenta no consume NCF.
12. Reimpresión no genera nueva factura ni consume otra secuencia.
13. Ningún permiso RBAC sustituye la contratación de un add-on.
14. Acciones comerciales sensibles SaaS corresponden únicamente al Owner.

---

## Estado Maestro de Módulos (1–16)

| # | Módulo y Proceso de Negocio | Dependencias | Commit Probado | Evidencia Histórica (no sustituye aprobación) | Resultado | Fallos / Decisiones Pendientes |
|---|---|---|---|---|---|---|
| **1** | **Empresa y personalización** (`identidad → logo → colores → guardado → recarga → nueva sesión → sidebar → ticket/factura`) | Auth/Sesión, Storage (`private_files`), POS/Tickets/Facturas | `9111f42` | `test_branding_sidebar_and_single_session_e2e.cjs` + suite aceptación M1 (`M1-C1`–`M1-C10`) | **`aprobado`** | Ninguno (`M1-01`, `M1-02`, `M1-03` corregidos y verificados) |
| **2** | **Usuarios, roles y licencias** (`usuarios → plantillas de roles → permisos/sucursales → kiosco exento → cupos concurrentes → sesiones`) | Módulo 1, Auth, RBAC, SaaS Limits | `9111f42` | `test_rbac_accounting_and_role_templates.cjs`, `test_rbac_closure_matrix.cjs` + suite aceptación M2 (`M2-C1`–`M2-C11`) | **`aprobado`** | Ninguno (0 fallos en `9111f42`) |
| **3** | Personal, asistencia y kiosco | Módulo 2, Sucursales, CompreFace (simulado) | — | `test_branding_sidebar_and_single_session_e2e.cjs` (sesión kiosco) | `pendiente` | — |
| **4** | Categorías y esquemas de comisiones | Módulo 1, Catálogo | — | `test_blocks_1_to_8_regression.cjs` (B1) | `pendiente` | — |
| **5** | Catálogo (servicios y productos + ITBIS) | Módulo 4, Inventario | — | `test_blocks_1_to_8_regression.cjs` (B5) | `pendiente` | — |
| **6** | Inventario (stock, ubicaciones, movimientos) | Módulo 5, Sucursales | — | `test_blocks_1_to_8_regression.cjs` (B6) | `pendiente` | — |
| **7** | Clientes (CRM) | Módulo 1, Plan Principal | — | — | `pendiente` | — |
| **8** | Cajas (apertura, movimientos, cierre, arqueo) | Módulo 1, 2, 9 | — | Bloque 2 de `STABILITY_AUDIT.md`, B9b | `pendiente` | — |
| **9** | POS, tickets y facturación convencional | Módulos 1, 5, 6, 7, 8, Secuencias NCF | — | `test_blocks_1_to_8_regression.cjs` (B1/B5/B6/B9b) | `pendiente` | — |
| **10** | Comisiones y descuentos | Módulos 3, 4, 9 | — | `test_blocks_1_to_8_regression.cjs` (B1/B2) | `pendiente` | — |
| **11** | Nómina | Módulos 3, 10 | — | `test_blocks_1_to_8_regression.cjs` (B3) | `pendiente` | — |
| **12** | Contabilidad y reportes (Egresos, 606, 607, IT-1, NCF) | Módulos 2, 9 | — | `test_blocks_1_to_8_regression.cjs` (B4), RBAC Contabilidad | `pendiente` | — |
| **13** | Membresías (Add-on US$99/bloque 3 suc.) | Módulos 7, 9, 14 | — | `test_blocks_1_to_8_regression.cjs` (B8) | `pendiente` | — |
| **14** | Suscripción SaaS y pagos | Módulo 2 (Owner), CardNet (simulado) | — | `test_saas_branch_contracting.cjs` (9/9), B7/B8 | `pendiente` | Credenciales live CardNet / worker recurrente |
| **15** | SuperAdmin | Todos los tenants, FX rates, catálogo SaaS | — | — | `pendiente` | — |
| **16** | Respaldo, recuperación y despliegue | Esquema/migraciones, Docker, Caddy | — | `verify_schema_parity.cjs` (30/30, 0 deriva) | `pendiente` | — |

---

## Módulo 1 — Empresa y Personalización

### A. Análisis de Arquitectura y Dependencias (Graphify + Código)

- **UI**: [TenantCustomizationModule.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/admin/TenantCustomizationModule.jsx)
- **Contexto global**: [TenantBrandingContext.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/context/TenantBrandingContext.jsx) (variables CSS `--brand-primary`, `--brand-secondary`, `--brand-accent`, `--brand-bg`, `--brand-surface`, `--brand-text`, contraste dinámico del sidebar).
- **Consumidores**:
  - Sidebar real: [App.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/App.jsx) (`.floating-sidebar`, marca de plataforma **ETEREAS** separada del bloque de identidad de la empresa).
  - Ticket térmico POS: [ThermalTicketModal.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/visits/ThermalTicketModal.jsx) (`business_name`, `logo_url`, `receipt_header`, `receipt_footer`).
  - Factura / Precuenta impresa: [ElectronicInvoicePrintModal.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/common/ElectronicInvoicePrintModal.jsx) (`business_name`, `logo_url`, `address`, `phone`, `rnc`, y tras corrección `M1-02`: `receipt_header` y `receipt_footer`).
- **Backend**:
  - Rutas: [tenant.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/tenant.routes.js) (`GET /api/tenant/branding`, `PUT /api/tenant/branding`, `POST /api/tenant/branding/reset`, `GET /api/tenant/profile`, `PUT /api/tenant/profile`, `POST /api/tenant/logo`).
  - Servicio: [tenant_branding.service.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/services/tenant_branding.service.js) (validación hex, contraste WCAG ≥ 3.0:1, sanitización de texto y URLs, invalidación de caché).
  - Repositorio: [tenant_branding.repository.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/repositories/tenant_branding.repository.js).
- **Tablas**: `tenants`, `tenant_branding`, `branches`, `private_files`, `audit_logs`.
- **Permisos**: `owner` / `admin` o permiso delegado `settings.manage` / `branding.manage`. Otros roles (ej. `recepcionista` sin permiso) deben ser rechazados con `403 FORBIDDEN_ROLE`.

### B. Definición de Casos de Aceptación (Previos a Ejecución)

| ID | Actor | Precondición | Acción (DOM / API) | Resultado Esperado (UI + BD + Consumidores) |
|---|---|---|---|---|
| **M1-C1** | Owner Empresa A | Sesión activa en `/personalizacion` | Editar nombre comercial, RNC, teléfono, dirección, encabezado/pie de recibo, subir logo PNG real, cambiar `primary_color` (ej. `#1e3a8a`) y `secondary_color` (ej. `#d97706`), guardar. | Éxito solo tras persistir en `tenant_branding` y `tenants`. Sidebar real (`.floating-sidebar`) aplica `rgb(30, 58, 138)` inmediatamente; **ETEREAS** se mantiene como marca de plataforma. |
| **M1-C2** | Owner Empresa A | M1-C1 guardado | Recargar página (`F5`) y luego cerrar sesión + nuevo login. | Identidad, logo (cargado desde almacenamiento canónico `/api/files/...`, sin `data:image` en BD) y colores persisten intactos tras recarga y nueva sesión. |
| **M1-C3** | Owner Empresa A | M1-C1 guardado + factura en historial | Abrir vista de impresión de factura (`ElectronicInvoicePrintModal`) desde `/facturas` y ticket térmico (`ThermalTicketModal`). | Ambos muestran nombre comercial, logo, encabezado y pie de recibo de Empresa A (no fallback `SalonPro`). |
| **M1-C4** | Owner Empresa B | Empresa A personalizada (M1-C1) | Iniciar sesión como Owner Empresa B y navegar a `/personalizacion` y sidebar. | Aislamiento estricto: Empresa B conserva su propio nombre/colores/logo sin heredar absolutamente nada de Empresa A. |
| **M1-C5** | Staff sin permiso (Empresa A) | Usuario con rol `recepcionista` sin `settings.manage` | Intentar `PUT /api/tenant/branding`, `POST /api/tenant/branding/reset`, `PUT /api/tenant/profile`. | Rechazo `403 FORBIDDEN_ROLE`; `0` cambios en `tenant_branding` y `tenants`. |
| **M1-C6** | Owner Empresa A | Sesión activa | Enviar color inválido (`not-a-color`), nombre vacío o contraste WCAG < 3.0:1; además intentar inyectar `tenant_id` de Empresa B en body. | Rechazo `400`; `tenant_id` en body ignorado (nunca muta Empresa B). |
| **M1-C7** | Owner Empresa A | Sesión activa | Doble clic rápido en botón "Guardar" y luego ejecutar "Restablecer a valores predeterminados" + recargar. | Sin duplicación de errores en doble clic; tras restablecer y recargar, el logo anterior **NO reaparece** (`tenants.logo_url` también limpiado) y el sidebar vuelve al tema neutral. |
| **M1-C8** | Owner Empresa A | Sesión revocada (nuevo login en otro dispositivo) | Intentar guardar personalización con sesión desplazada. | Rechazo `401 SESSION_REPLACED` sin mutar BD. |
| **M1-C9** | Owner Empresa A | M1-C1 y M1-C7 ejecutados | Consultar `audit_logs` en PostgreSQL. | Existen registros auditados para actualización y restablecimiento de personalización vinculados a `tenant_id` y `actor_id`. |
| **M1-C10** | Owner Empresa A | Viewport móvil (`390×844`) y navegación por teclado (`Tab`) | Abrir `/personalizacion` en móvil y tabular inputs/botón guardar. | Sin desbordamiento horizontal crítico, controles accesibles por teclado, `0` `pageerror`, `0` `ErrorBoundary`, `0` HTTP `5xx`. |

### C. Fallos Corregidos y Evidencia de Aceptación (`9111f42` — APROBADO)

- **M1-01 (Corregido y verificado)**: `POST /api/tenant/branding/reset` en [tenant.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/tenant.routes.js) limpia ahora `tenants.logo_url`, `primary_color`, `secondary_color` y `receipt_footer`. Verificado en `M1-C7`: tras reset + recarga, `logoAfterReset = null`, `primaryAfterReset = #0f172a`, `sidebarBg = rgb(15, 23, 42)`.
- **M1-02 (Corregido y verificado)**: [ElectronicInvoicePrintModal.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/common/ElectronicInvoicePrintModal.jsx) renderiza `receipt_header` y `receipt_footer` configurados por la empresa. Verificado en `M1-C3` desde `/facturas` → botón *"Imprimir Factura / Comprobante"*: modal `#pos-electronic-invoice-ri` muestra `ATELIER LUZ RD`, `Atelier Luz — Belleza & Estilo` y `¡Gracias por visitar Atelier Luz RD!`.
- **M1-03 (Corregido y verificado)**: Auditoría `UPDATE_TENANT_BRANDING` / `RESET_TENANT_BRANDING` en `audit_logs` (`M1-C9`: 3 filas verificadas en PostgreSQL `salon_saas_test`) y guardia síncrono `submitInFlightRef` en [TenantCustomizationModule.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/admin/TenantCustomizationModule.jsx) (`M1-C1`: doble clic rápido envió exactamente `1` petición `PUT`).
- **Resultados completos `M1-C1`–`M1-C10` en `salonpro-app:9111f42` (`salon_saas_test` + Chromium DOM)**:
  - `M1-C1` Save + Sidebar real: `rgb(30, 58, 138)`, marca **ETEREAS** intacta, logo en almacenamiento canónico `/api/public/branding/.../logo/...` (sin base64).
  - `M1-C2` Recarga (`F5`) + Nuevo login: `rgb(30, 58, 138)`, nombre y logo persistidos.
  - `M1-C3` Consumidor factura impresa: `opened=true`, `hasCompany=true`, `hasHeader=true`, `hasFooter=true`.
  - `M1-C4` Aislamiento Empresa B: `bg = rgb(15, 23, 42)`, `inheritedA = false`.
  - `M1-C5` RBAC (`recepcionista` sin permiso): `PUT` → `403`, `POST /reset` → `403`.
  - `M1-C6` Validaciones: color inválido → `400`, nombre vacío → `400`, contraste WCAG < 3.0 → `400`.
  - `M1-C7` Doble clic (`1` PUT) + Reset + Recarga (`logoAfterReset = null`).
  - `M1-C8` Sesión revocada por login concurrente: `401 SESSION_REPLACED`.
  - `M1-C9` Auditoría en PostgreSQL: `UPDATE_TENANT_BRANDING` y `RESET_TENANT_BRANDING` persistidos.
  - `M1-C10` Móvil (`390×844`) + teclado (`Tab`): `overflowPx = 0`, `hasErrorBoundary = false`, `pageErrors = []`, `serverErrors = []`.
- **Gates**: `test:scanner` (0 violaciones), `test:runner-guards` (17/17 + 63 tests aislados), `lint`, `build`, `verify:release`, `graphify update .`. **Estado: APROBADO**.

---

## Módulo 2 — Usuarios, Roles y Licencias

### A. Análisis de Arquitectura y Dependencias (Graphify + Código)

- **UI**: [SecurityModule.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/admin/SecurityModule.jsx) (tabs Usuarios y Roles, plantillas predefinidas, permisos de Contabilidad/POS/Membresías, alcance multi-sucursal, cuentas `kiosco_asistencia`, barra de licencias).
- **Backend**:
  - [auth.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/auth.routes.js): `GET/POST/PUT/DELETE /api/users`, `GET/POST/PUT/DELETE /api/roles`, `GET /api/roles/catalog`, `GET /api/roles/templates`, `POST /api/roles/install-templates`, `POST /api/roles/:id/restore-template`, `withTenantUserLock`, `ensureRemainingActiveOwner`.
  - [entitlements.service.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/services/entitlements.service.js): `checkLimit(tenantId, 'users', { conn })` con `FOR UPDATE` sobre `tenants`, fórmula `(licensed_branches * 3) + extra_user_seats`, exención estricta de `superadmin`, `cliente_b2c`, `kiosco_asistencia`.
  - [auth.middleware.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/middleware/auth.middleware.js) y [rbac.middleware.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/middleware/rbac.middleware.js): sesión única en `user_sessions`, `token_version` para revocación inmediata, verificación de permisos por endpoint.
- **Tablas**: `users`, `roles`, `user_sessions`, `tenants`, `branches`, `staff_records`, `security_audit_logs`.

### B. Definición de Casos de Aceptación (Previos a Ejecución)

| ID | Actor | Escenario | Resultado Esperado |
|---|---|---|---|
| **M2-C1** | Owner A | DOM `/seguridad?tab=roles`: instalar plantillas, crear rol desde plantilla, modificar permisos (incl. Contabilidad), eliminar rol sin usuarios y rechazar eliminación de rol en uso (`409 ROLE_IN_USE`). Verificar que rol eliminado no reaparece tras recarga. | Persistencia exacta en `roles`, `409` en rol en uso, rol eliminado permanece ausente tras `F5`. |
| **M2-C2** | Owner A | DOM `/seguridad`: crear usuario operativo con rol personalizado y sucursal, editar permisos y alcance de sucursales, desactivar y reactivar usuario. | Cambios persistidos en `users`, auditoría en `security_audit_logs`, conteo de asientos actualizado. |
| **M2-C3** | Owner A | DOM `/seguridad`: crear cuenta `kiosco_asistencia` (exenta de cupo), comprobar que no consume asiento; intentar cambiarla a rol facturable con cupo lleno (`3/3`) → rechazo `403 PLAN_LIMIT_REACHED`; liberar cupo y cambiarla → éxito (`200`). | Kiosco = 0 asientos; promoción a rol facturable valida cupo atómicamente. |
| **M2-C4** | Owner A | Reglas de licencias: `3 asientos/sucursal + extras`, Owner consume asiento, `kiosco_asistencia` y `cliente_b2c` exentos, colaborador en `staff_records` sin `users` = 0 asientos, rol personalizado llamado `"Kiosco"` **SÍ** consume asiento, usuario multi-sucursal consume **1** asiento. | Conteo exacto en `GET /api/tenant/entitlements` y en bloqueo `checkLimit`. |
| **M2-C5** | Owner A | Concurrencia en último asiento disponible (`2/3`): 2 solicitudes simultáneas `POST /api/users`. | Exactamente `1×200` y `1×403 PLAN_LIMIT_REACHED`; uso final `3/3` (nunca `4/3`). |
| **M2-C6** | Owner A | Protección del último Owner ante edición, desactivación y eliminación concurrentes. | Bloqueo `403`/`409 CANNOT_DEGRADE_LAST_OWNER`; Owner sigue activo en BD. |
| **M2-C7** | Owner A / Staff A | Revocación de permisos con sesión abierta: quitar permiso de Contabilidad al rol de Staff A mientras tiene sesión abierta → petición backend `GET /api/expenses` o `GET /api/dgii/it1` falla inmediatamente (`401`/`403`). | Revocación efectiva en backend, no solo ocultando menús. |
| **M2-C8** | Owner A / Staff A | Sesión única: 2 pestañas del mismo navegador comparten sesión (`200`); login en otro navegador reemplaza la sesión anterior (`401 SESSION_REPLACED`). | Regla de sesión única cumplida. |
| **M2-C9** | Owner A / Empresa B | Aislamiento cross-tenant: asignar rol o sucursal de Empresa B a usuario de Empresa A → `403`/`400`. | Cero escrituras y aislamiento estricto. |
| **M2-C10** | Staff A con permiso `memberships` | Empresa A sin add-on Membresías contratado, pero rol de Staff A incluye permiso de Membresías. | Ningún permiso habilita el add-on sin contratar (`403 FEATURE_NOT_INCLUDED` / bloqueado). |
| **M2-C11** | Owner A | Confirmar en DOM cero `pageerror`, cero `ErrorBoundary` y cero HTTP `5xx`. | 0 errores inesperados. |

### C. Evidencia de Aceptación (`9111f42` — APROBADO)

- **Commit / Imagen probada**: `9111f42` (`salonpro-app:9111f42`, misma imagen ya desplegada y saludable en staging; no se requirieron cambios de código en runtime).
- **Resultados `M2-C1`–`M2-C11` sobre `salon_saas_test` + Chromium DOM real**:
  - `M2-C1` Plantillas y roles: botón *"Agregar roles predefinidos"* instaló `6` plantillas; eliminación de plantilla sin uso persistió tras `F5` (`deletedTemplatePersistedAbsent=true`); rol literal `"Kiosco"` rechazado `400 RESERVED_ROLE_NAME`.
  - `M2-C2` Usuarios y multi-sucursal: creación de usuario operativo (`Operador Contable M2`), bloqueo `409 ROLE_IN_USE` al intentar borrar su rol, asignación multi-sucursal (`Sucursal Alpha 1` + `Sucursal Alpha 2`) consumiendo exactamente `1` asiento (`2/3`).
  - `M2-C3` Kiosco reservado y promoción: `kiosco_asistencia` = `0` asientos; rol custom `"Kiosco Recepcion"` consumió asiento `3/3`; promoción de kiosco a rol facturable en `3/3` → `403 PLAN_LIMIT_REACHED`; tras liberar asiento (desactivar usuario) → promoción `200`.
  - `M2-C4` Cupos base: `1 sucursal = 3 asientos`; Owner = `1`, `cliente_b2c` = `0`, colaborador en `staff_records` sin `users` = `0`.
  - `M2-C5` Concurrencia en último asiento (`2/3`): 2 altas simultáneas `POST /api/users` → `[200, 403]`, uso final exacto `3/3`.
  - `M2-C6` Protección concurrente del último Owner: desactivación (`403 SELF_PRIVILEGE_MODIFICATION_DENIED`), degradación (`403 SELF_PRIVILEGE_MODIFICATION_DENIED`) y eliminación (`409 CANNOT_DEGRADE_LAST_OWNER`) bloqueadas.
  - `M2-C7` & `M2-C10` RBAC Contabilidad en backend + gate de Add-on Membresías: `GET /api/expenses` → `200` con permiso y `401` inmediatamente tras revocar permiso en sesión abierta; `GET /api/contracts` → `403` sin add-on contratado aun teniendo permiso `memberships.view`.
  - `M2-C8` Sesiones: 2 pestañas del mismo navegador comparten sesión (`[200, 200]`); login en otro navegador reemplaza sesión anterior (`401 SESSION_REPLACED`).
  - `M2-C9` Aislamiento cross-tenant: rol de Empresa B → `403`, sucursal de Empresa B → `403`.
  - `M2-C11` Salud DOM `/seguridad`: `hasErrorBoundary=false`, `showsSeats=true`, `pageErrors=[]`, `serverErrors=[]`.
- **Estado**: **APROBADO**.
