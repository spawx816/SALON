# Plan Maestro y Registro de Aceptación por Módulos — Etereas

Documento único y autoritativo de validación sistemática de Etereas por módulos y procesos de negocio.

- **Release candidato actual**: commit `db69d1c` / imagen `salonpro-app:db69d1c` (desplegado y `Up (healthy)` en staging).
- **Base de pruebas automatizadas**: `salon_saas_test` (PostgreSQL 17, aislada con guardas canónicas).
- **Entorno de producción**: intacto (`salon_saas_prod` sin escrituras, sin cargos CardNet reales, `SAAS_RENEWAL_WORKER_ENABLED=<UNSET>` → `ConsolidatedRenewalService.isWorkerEnabled() === false`, `DGII_MODE=disabled` / `DGII_ENABLED=<UNSET>` — facturación electrónica DGII fuera del lanzamiento).
- **Taxonomía estricta de evidencia** (no se denomina "flujo DOM" a una mera carga de página):
  - **Interacción DOM completa**: acciones reales sobre controles UI (crear/editar/guardar/buscar/recargar y verificar persistencia visible).
  - **Solo renderizado**: navegación autenticada a ruta verificando carga sin `pageerror`, `5xx` ni `ErrorBoundary`, sin mutación DOM.
  - **API/PostgreSQL**: pruebas de integración y concurrencia contra routers canónicos y `salon_saas_test`.
  - **Proveedor real**: validación contra servicio externo real (ej. CompreFace real; CardNet live permanece separado como pendiente externo).

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

| # | Módulo y Proceso de Negocio | Nivel de Evidencia Verificado | Commit Probado | Evidencia Clave | Resultado | Fallos / Pendientes Reales |
|---|---|---|---|---|---|---|
| **1** | **Empresa y personalización** | **Interacción DOM completa** + **API/PostgreSQL** | `9111f42` | `test_branding_sidebar_and_single_session_e2e.cjs` + `M1-C1`–`M1-C10` | **`aprobado`** | Ninguno (`M1-01`–`M1-03` corregidos) |
| **2** | **Usuarios, roles y licencias** | **Interacción DOM completa** + **API/PostgreSQL** | `9111f42` | `test_rbac_accounting_and_role_templates.cjs`, `test_rbac_closure_matrix.cjs` + `M2-C1`–`M2-C11` | **`aprobado`** | Ninguno |
| **3** | **Personal, asistencia y kiosco** | **Interacción DOM completa** + **API/PostgreSQL** + **Proveedor real (CompreFace)** | `b9ec72e` | `test_kiosk_dedicated_user.cjs`, `test_kiosk_security_and_isolation.cjs` + CompreFace real (`M3-C1`–`M3-C6`) | **`aprobado`** | Pendiente prueba física en cámara hardware real (`M3-C7`) |
| **4** | **Categorías y esquemas de comisiones** | **Interacción DOM completa** + **API/PostgreSQL** | `e439cc8` | `test_module4_commissions_acceptance.cjs` (6/6), `test_blocks_1_to_8_regression.cjs` (`db69d1c`) | **`aprobado`** | **Decisión operador**: política definitiva para servicios sin regla (fallback temporal visible `15%`) |
| **5** | **Catálogo (servicios y productos + ITBIS)** | **Interacción DOM completa** + **API/PostgreSQL** | `e439cc8` / `db69d1c` | `test_module5_catalog_acceptance.cjs`, `test_blocks_1_to_8_regression.cjs` (`db69d1c`) + DOM `/servicios`, `/inventario` | **`aprobado`** | Ninguno (`M5-01`–`M5-04` corregidos) |
| **6** | **Inventario (stock, compras, transferencias, toma física)** | **Interacción DOM completa** + **API/PostgreSQL** | `687940a` / `db69d1c` | `test_module6_inventory_acceptance.cjs`, `test_inventory_concurrency.cjs`, regresión B6 (`db69d1c`) | **`aprobado`** | Ninguno (`M6-01`–`M6-07` corregidos) |
| **7** | **Clientes (CRM)** | **Interacción DOM completa** + **API/PostgreSQL** | `74ec5d5` (`5c19b33`) | `test_module7_clients_acceptance.cjs` (8/8), `test_pagination_cursors.cjs` (6/6) + DOM `/registro-cliente`, `/clientes` | **`aprobado`** | Ninguno (`M7-01`–`M7-06` corregidos) |
| **8** | **Cajas (apertura, movimientos, cierre, arqueo)** | **Interacción DOM completa** + **API/PostgreSQL** | `bcb4cf1` (`01d365a`) | `test_module8_cash_registers_acceptance.cjs` (6/6), `test_cash_reconciliation.cjs` (7/7) + DOM `/cajas` | **`aprobado`** | Ninguno (`M8-01`–`M8-04` corregidos) |
| **9** | **POS, tickets y facturación convencional** | **Interacción DOM completa** + **API/PostgreSQL** | `fa15f28` / `db69d1c` | `test_module9_pos_invoicing_acceptance.cjs` (6/6), regresión B1/B5/B6/B9b (`db69d1c`) + DOM `/visitas`, `/facturas` | **`aprobado`** | Ninguno (`M9-01`–`M9-03` corregidos; DGII live fuera del lanzamiento) |
| **10** | **Comisiones y descuentos** | **Interacción DOM completa** + **API/PostgreSQL** | `4610b28` | `test_module10_commissions_discounts_acceptance.cjs` (5/5) + DOM `/descuentos-empleados`, `/comisiones` | **`aprobado`** | Ninguno (`M10-01`–`M10-04` corregidos) |
| **11** | **Nómina** | **Interacción DOM completa** + **API/PostgreSQL** | `8e5483d` (`885e574`) | `test_module11_payroll_acceptance.cjs` (6/6), regresión B3 (`db69d1c`) + DOM `/nomina` | **`aprobado`** | Ninguno (`M11-01`–`M11-02` corregidos) |
| **12** | **Contabilidad y reportes (Egresos, 606, 607, IT-1, NCF)** | **Interacción DOM completa** (`/egresos` alta+guardado `200`+BD) + **Solo renderizado** (`/reporte-606`, `/reporte-607`, `/reporte-it1`, `/secuencias-ncf`) + **API/PostgreSQL** | `7689c87` → revalidado en `db69d1c` | `test_module12_accounting_reports_acceptance.cjs` (5/5 en `db69d1c`), `test_rbac_accounting_and_role_templates.cjs` (10/10) | **`aprobado`** | Ninguno (`M12-01`–`M12-02` corregidos; DGII electrónica fuera del lanzamiento) |
| **13** | **Membresías (Add-on US$99/bloque 3 suc.)** | **Interacción DOM completa** (`/planes` editar+guardar+recargar persistido) + **Solo renderizado** (`/pagos`) + **API/PostgreSQL** | `db69d1c` | `test_module13_memberships_acceptance.cjs` (5/5 en `db69d1c`), `test_memberships_addon_sync_pg.cjs` (`db69d1c`), regresión B8 | **`aprobado`** | Ninguno (`M13-01`–`M13-05` corregidos; `M13-05` detectado por interacción DOM real) |
| **14** | **Suscripción SaaS y pagos** | **Solo renderizado + inspección de controles** (`/billing`) + **API/PostgreSQL (adaptador/simulado)**; **Proveedor real CardNet: PENDIENTE** | `db69d1c` | `test_module14_saas_billing_acceptance.cjs` (4/4 en `db69d1c`), `test_saas_branch_contracting.cjs` (9/9), `test_phase2a_entitlements_unit.cjs` (28/28) | **`aprobado` (adaptador)** | **Pendiente externo CardNet live**: credenciales, homologación tokenización/recurrencia y autorización explícita de `SAAS_RENEWAL_WORKER_ENABLED` |
| **15** | **SuperAdmin (Control Plane)** | **Interacción DOM completa** (`/saas` búsqueda real + cambio de pestaña) + **API/PostgreSQL** | `2ba1c99` / `db69d1c` | `test_module15_superadmin_acceptance.cjs` (3/3 en `db69d1c`: 2 bloques con 2 suc. = `+$198` estable tras reasignación) | **`aprobado`** | Ninguno (`M15-01` corregido por bloques contratados vigentes) |
| **16** | **Respaldo, recuperación y despliegue** | **API/PostgreSQL + Infraestructura/Storage/CompreFace reales en VPS** | `db69d1c` | `verify_schema_parity.cjs` (30/30, 0 deriva), restore profundo (10 tablas + valores + 4/4 archivos AES-256-GCM descifrados + CompreFace `407KB`/22 subjects) | **`aprobado con condición operativa`** | **Brecha operativa real**: falta copia automatizada **fuera de la VPS (off-site)** y custodia externa de `STORAGE_ENCRYPTION_KEY` antes de go-live |

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

## Módulo 3 — Personal, Asistencia y Kiosco

### A. Análisis de Arquitectura y Dependencias (Graphify + Código)

- **UI**: [StaffModule.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/admin/StaffModule.jsx), [AttendanceKiosk.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/pages/AttendanceKiosk.jsx), [AttendanceLogs.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/admin/AttendanceLogs.jsx).
- **Backend**:
  - [attendance.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/attendance.routes.js): fotos privadas, `schedule-overrides`, `schedule-swap`, `punch`, `history`, `pending`, `adjust`.
  - [kiosk.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/kiosk.routes.js) + [kiosk_device.service.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/services/kiosk_device.service.js): vinculación opaca de dispositivo, listado acotado por sucursal (incl. multi-sucursal), PIN obligatorio + cámara/CompreFace (`verifyFacesWithCompreFaceStrict`), sesiones breves `kiosk_employee_sessions`, ponches con hora servidor, autoservicio comisiones/volante, revocación remota y rate limiting aislado por dispositivo+empleado.
  - [payroll.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/payroll.routes.js): CRUD `staff_records` (colaboradores con y sin cuenta `users`, estado activo/inactivo).
- **Tablas**: `staff_records`, `users`, `attendance`, `schedule_overrides`, `kiosk_devices`, `kiosk_employee_sessions`, `private_files`, `audit_logs`.

### B. Definición de Casos de Aceptación (Previos a Ejecución)

| ID | Área | Escenario | Resultado Esperado |
|---|---|---|---|
| **M3-C1** | Personal (DOM + BD) | Crear colaborador en `staff_records` sin cuenta `users` (fecha ingreso, sucursal, salario, horario), editar, recargar, guardar foto de referencia en almacenamiento privado (`private_files`), desactivar preservando historial. Comprobar 0 asientos consumidos e inclusión/exclusión en nómina/asistencia. | Persistencia exacta, `profile_photo_file_id` privado, `0` asientos consumidos, historial intacto tras baja. |
| **M3-C2** | Horarios y Novedades | Probar jornada normal, tolerancia/tardanza, salida temprana, override temporal + anulación, turno que cruza medianoche (`22:00→02:00`, salida `23:30` = Salida Temprana, `02:15` = +15 min extra), ajuste manual autorizado con motivo y auditoría en `audit_logs`, zona horaria `America/Santo_Domingo`. | Cálculos exactos, trazabilidad en `audit_logs` y `attendance.modification_reason`. |
| **M3-C3** | Kiosco (DOM + BD) | Login real con cuenta `kiosco_asistencia`: redirección exclusiva a `/asistencia`, empresa/sucursal correctas, 0 asientos, bloqueo `403` a módulos administrativos/operativos, lista limitada a empleados autorizados (incl. multi-sucursal). | Aislamiento estricto y redirección exclusiva a `/asistencia`. |
| **M3-C4** | Ponches y Autoservicio | Flujo obligatorio empleado → PIN → cámara → ponche (con hora servidor); sin foto de referencia permite PIN + foto evidencial sin verificación facial; doble clic sin duplicados; verificar A y marcar por B rechazado (`403`); autoservicio exclusivo de comisiones/volante; expiración/inactividad en backend; revocación remota/desactivación invalida acceso; 2do login reemplaza sesión kiosco anterior. | 100% verificado en `test_kiosk_dedicated_user.cjs`, `test_kiosk_security_and_isolation.cjs` y suite DOM M3. |
| **M3-C5** | Aislamiento y RBAC | Dos empresas y varias sucursales: rechazar `employee_id`/`device_id`/override ajeno (`403`/`404`), rechazar `POST /api/attendance/adjust` y `DELETE /api/attendance/schedule-override/:id` sin permiso `attendance.manage` (`403`), rate limiting aislado sin bloquear toda la empresa. | Bloqueos exactos (`M3-01` corregido) y 0 contaminación cross-tenant. |
| **M3-C6** | CompreFace Real (separado) | Pruebas directas contra `compreface_api` real usando únicamente rostros sintéticos generados (`person_a_1`, `person_a_2`, `person_b_1`, sin biometría real): rostro coincidente, rostro diferente, imagen sin rostro, y timeout/indisponibilidad (`503 BIOMETRIC_PROVIDER_UNAVAILABLE`, fail-closed). | Coincidente ≥ threshold, diferente rechazado, sin rostro rechazado, indisponibilidad fail-closed `503`. |
| **M3-C7** | Operador (Físico) | Prueba guiada de cámara física en tablet/PC real. | Documentada para el operador (cámara simulada no acredita hardware físico). |

### C. Fallos Corregidos y Evidencia de Aceptación (`b9ec72e` — APROBADO)

- **M3-01 (Corregido y verificado)**: Aislamiento multi-tenant (`AND tenant_id = ?`) agregado en `DELETE /api/attendance/schedule-override/:id` y guardas RBAC (`requirePermission('attendance.manage' | 'attendance.view' | 'staff.manage')`) en [attendance.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/attendance.routes.js). Verificado en `M3-C5`: `DELETE` cross-tenant sobre override ajeno (Empresa B, `id=27`) devuelve `404` y conserva `status='Activo'` en PostgreSQL; usuario sin permiso recibe `403` en `/adjust`, `/schedule-override/:id` y `/users/:id/profile-photo`.
- **M3-02 (Corregido y verificado)**: Corrección de cálculo de turnos nocturnos que cruzan medianoche (`22:00 → 02:00`) en `POST /api/attendance/adjust` ([attendance.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/attendance.routes.js)). Verificado en PostgreSQL (`salon_saas_test`, `employee_id='341'`): salida temprana `23:30` registra `status='Salida Temprana'`, `extra_minutes=0` (antes `+1290`); salida `02:15` registra `status='Normal'`, `extra_minutes=15`.
- **M3-03 (Corregido y verificado)**: Auditoría persistida en `audit_logs` (`ATTENDANCE_ADJUST`, `SCHEDULE_OVERRIDE_VOID`) verificada en PostgreSQL (`7` registros en `salon_saas_test`).
- **Resultados completos `M3-C1`–`M3-C6` en `salonpro-app:b9ec72e` (`salon_saas_test` + Chromium DOM + CompreFace real)**:
  - **Suites PG dentro de `salonpro-app:b9ec72e`**: `test_kiosk_dedicated_user.cjs` (PASS), `test_kiosk_security_and_isolation.cjs` (PASS), `test_rbac_closure_matrix.cjs` (PASS).
  - **`M3-C1` Personal + Foto Privada (DOM `/equipo` + PG)**: Creación y edición (`salario_base=28500.00`), foto en almacenamiento privado (`has_private_photo=true`, `raw_base64_null=true`), `0` asientos consumidos (`2/6`), persistencia tras recarga y baja (`status='Inactivo'`, `fecha_salida='2026-11-22'`) conservando historial de asistencia.
  - **`M3-C2` Horarios y Novedades (DOM `/admin/asistencia` + PG)**: Jornada normal con tardanza (`09:30 → Tardanza`) y salida temprana (`17:15 → Salida Temprana`), turno nocturno `22:00→02:00`, creación y anulación de override temporal, auditoría en `audit_logs`.
  - **`M3-C3` / `M3-C4` Kiosco y Sesión Única (DOM `/asistencia`)**: Login real de `kiosco_asistencia` redirige exclusivamente a `/asistencia`, `GET /api/expenses` → `403`, lista limitada a empleados activos autorizados (`authorizedEmployeesCount=1`, excluye inactivos y Empresa B), 2do login desplaza sesión anterior (`401 SESSION_REPLACED`). `pageErrors=[]`, `serverErrors=[]`.
  - **`M3-C6` CompreFace Real (`compreface_api`, rostros sintéticos sin biometría real)**: mismo sujeto (`person_a_1` vs `person_a_2`) → `HTTP 200`, `similarity=0.9995`, `matched=true`; distinto sujeto (`person_a_1` vs `person_b_1`) → `HTTP 200`, `similarity=0.048`, `matched=false`; imagen sin rostro → rechazado `HTTP 400` (código CompreFace `28`); proveedor inaccesible → fail-closed (`ECONNABORTED` / `503 BIOMETRIC_PROVIDER_UNAVAILABLE`).
- **Despliegue en staging**: Respaldo previo `/opt/salonpro/backups/salon_saas_staging_pre_b9ec72e_20261122_154124.sql.gz` (`83K`) + contenedor `salonpro_app` actualizado a `salonpro-app:b9ec72e` (`Up (healthy)`, `GET /api/health` → `200`). **Estado: APROBADO**.

### D. Guía Corta de Prueba de Cámara Física en Dispositivo Real (`M3-C7` — Operador)

> La cámara simulada/sintética valida el backend y CompreFace, pero **no certifica el hardware físico** de la tablet/PC ni los permisos del navegador. Ejecutar esta lista de 5 minutos en el equipo real del salón:
> 1. Abrir la URL de staging en HTTPS desde Chrome/Safari en la tablet o PC de recepción e iniciar sesión con la cuenta `kiosco_asistencia` (verificar redirección automática a `/asistencia`).
> 2. Conceder permiso de cámara al navegador cuando aparezca el diálogo del sistema operativo y confirmar vista previa fluida sin congelamiento ni espejo invertido ilegible.
> 3. Seleccionar un colaborador con foto de referencia cargada, ingresar su PIN y capturar rostro con iluminación real del mostrador → confirmar `Check-In` aprobado y hora del servidor.
> 4. Repetir con otra persona frente a la cámara usando el PIN del primer colaborador → confirmar rechazo biométrico en pantalla sin registrar ponche.
> 5. Tapar el lente (sin rostro) o revocar temporalmente el permiso de cámara → confirmar mensaje claro en UI y que no se registra ningún ponche ni se cuelga la pantalla.

---

## Módulo 4 — Categorías y Esquemas de Comisiones

### A. Análisis de Arquitectura y Reglas Reales Confirmadas en Código (Graphify + Código)

- **UI**: [CommissionManagement.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/commissions/CommissionManagement.jsx) (`/comisiones`), consumidor Catálogo: [ServiceManagement.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/services/ServiceManagement.jsx) (`/servicios`, evento `commissionCategoriesUpdated` + `commission_category_id`), consumidor POS/Historial: [VisitRecorder.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/visits/VisitRecorder.jsx) / [InvoiceHistory.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/admin/InvoiceHistory.jsx), consumidor Nómina: [PayrollModule.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/payroll/PayrollModule.jsx).
- **Backend**:
  - [commissions.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/commissions.routes.js) (`/api/commissions/*`): categorías, esquemas, asignación de colaboradores, reglas por esquema, liquidación (`/payout`, `/payouts`), sincronización (`/sync`). Montado en [app.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/app.js#L727) con `requireMethodPermission(['commissions.view', 'commissions.approve'], 'commissions.approve')`.
  - [visits.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/visits.routes.js) (`processBatchVisitCommissions`, `PUT /api/visits/:id/commission-recipient`, `POST /api/visits/:id/void`).
  - [payroll.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/payroll.routes.js) (cálculo de borrador de nómina, bonos `Contar` y aprobación definitiva).
- **Tablas**: `commission_categories`, `commission_schemes`, `commission_scheme_rules`, `employee_commission_rules`, `employee_commissions_log`, `commission_payouts`, `staff_records`, `services`, `visits`, `audit_logs`.
- **Reglas exactas confirmadas en código (sin inventar valores)**:
  1. **Prioridad real de evaluación** (`visits.routes.js:325-518`):
     - `0)` Canje de lavado de membresía con bruto `≤ 0` → `0%`, `RD$ 0.00`.
     - `1)` **Regla Especial del esquema** (`rule_type = 'especial'` para `service_name`): operaciones `Restar`/`Sumar` ajustan `montoBase` por `monto_ajuste × cantidad` antes de aplicar `porcentaje_comision`; operación `Contar` acumula meta para bono en nómina (`montoComision = 0` por línea).
     - `2)` **Excepción por Servicio del esquema** (`rule_type = 'servicio'` para `service_name`): `Porcentaje` sobre `montoBase` o `Monto_Fijo` (`valor × cantidad`).
     - `3)` **Regla Individual del empleado** (`employee_commission_rules` por `employee_id::service_name`).
     - `4)` **Regla por Categoría del esquema** (`rule_type = 'categoria'` para `category_name`): `Porcentaje` o `Monto_Fijo` (con ajuste opcional `monto_ajuste`).
     - `5)` **Catálogo / Esquema general / Fallback** (si ninguna regla 1–4 aplicó):
       - Si `services.genera_comision = 0` → `0%`, `RD$ 0.00` (sin fallback).
       - Si existe categoría activa (`commission_categories` por `commission_category_id` o nombre) → aplica su `porcentaje`/`tipo` (`0%` explícito da `RD$ 0.00`, sin fallback).
       - Si `services.comision_valor` está definido (`> 0` o servicio con `0`) → aplica `comision_valor` (`0%` explícito no dispara fallback).
       - Si `activeScheme.percentage > 0` y no es producto → aplica porcentaje general del esquema.
       - Ausencia total de regla: producto → `0%` (`RD$ 0.00`), servicio → `15%` (`Comisión base por defecto (15%)`).
  2. **Base de cálculo (descuentos e ITBIS)**:
     - `grossLine = baseUnit × qty`; se resta el descuento por línea + descuento global proporcional → `netAfterCommercialDisc` (**después de descuento**).
     - **Sin ITBIS**: si el ítem es gravado `exclusive`, el precio base ya excluye ITBIS; si es gravado `inclusive` (`tax_rate > 0`), se divide `netAfterCommercialDisc / (1 + tax_rate)` antes de calcular comisión. Moneda: `DOP` (`RD$`), redondeo a 2 decimales y persistencia en centavos (`commission_cents = Math.round(montoComision * 100)`).
  3. **Vigencia y alcance**:
     - Esquemas y categorías se aíslan por `tenant_id`; solo esquemas `Activo` y categorías `Activa` se cargan.
     - `staff_records.scheme_effective_date` rige la vigencia: si `fecha_visita < scheme_effective_date`, el esquema aún no aplica (`M4-03`).
     - Modificar o desactivar una regla/esquema **no recalcula ni altera** comisiones históricas (`POST /api/commissions/sync` omite visitas que ya tienen log salvo `force_recalculate=true`, y `processBatchVisitCommissions` protege siempre filas `Pagado`/`Pagada`/`payout_id IS NOT NULL`).
  4. **Anulaciones y reasignación**:
     - Al anular factura (`POST /api/visits/:id/void`), todas sus comisiones pasan a `status = 'Anulada'` y quedan excluidas de listado, liquidación y nómina.
     - Reasignar colaborador (`PUT /api/visits/:id/commission-recipient`) requiere motivo, audita en `audit_logs` (`REASSIGN_COMMISSION`), recalcula solo comisiones pendientes y bloquea (`409`) si la factura está anulada o tiene comisiones ya liquidadas/pagadas.
  5. **Liquidación y Nómina**:
     - Separación de permisos: `commissions.view` (solo consulta `GET`) vs `commissions.approve` (configurar y liquidar `POST`/`PUT`/`DELETE`).
     - Liquidación directa (`POST /api/commissions/payout`) ejecuta en transacción `FOR UPDATE` sobre filas `Pendiente` con `payout_id IS NULL`, evita duplicación por reintentos/concurrencia y registra `COMMISSION_PAYOUT` en `audit_logs` (`M4-02`).
     - Nómina (`payroll.routes.js`) excluye estrictamente `'Anulada'`, `'Pagada'`, `'Pagado'` y `payout_id IS NOT NULL`, garantizando que una misma comisión **nunca** pueda pagarse por dos vías (`M4-01`).

### B. Definición de Casos de Aceptación (Previos a Ejecución)

| ID | Área | Escenario | Resultado Esperado |
|---|---|---|---|
| **M4-C1** | Categorías + Catálogo (DOM) | Crear, editar y desactivar categoría en `/comisiones`; comprobar en `/servicios` que el formulario del Catálogo usa las categorías; intentar eliminar categoría en uso → `409 CATEGORY_IN_USE` con mensaje claro. | Persistencia tras recarga, vínculo real con Catálogo, bloqueo claro al borrar en uso. |
| **M4-C2** | Esquemas, Reglas y Dependencias (DOM) | Crear esquema, agregar regla por categoría y regla específica por servicio, intentar regla duplicada/contradictoria → `409 DUPLICATE_SCHEME_RULE`, asignar colaborador, intentar borrar esquema en uso → `409 SCHEME_IN_USE`, desactivar esquema conservando historial. | Validaciones claras en backend/UI, historial intacto tras desactivar. |
| **M4-C3** | Cálculos Verificables (POS → BD) | Emitir ventas reales cubriendo: (a) servicio porcentual (`30%` de `1000` = `300.00`), (b) comisión fija (`RD$ 250 × 2` = `500.00`), (c) regla específica sobre general (`40%` servicio vs `20%` categoría), (d) producto con `0%` (`0.00`, sin fallback), (e) ítem sin regla (`15%` servicio / `0%` producto), (f) descuento (`10%`) + ITBIS inclusivo (`1180 → base 1000`, `10%` desc → `900`), (g) varios colaboradores en líneas distintas de la misma factura, (h) regla fuera de vigencia (`scheme_effective_date` futuro). | Exactitud numérica al centavo, `rule_applied_description` y `scheme_id` persistidos; `0%` no dispara fallback; cambiar regla posterior no altera histórico. |
| **M4-C4** | Anulación y Reasignación | Anular factura → `employee_commissions_log.status = 'Anulada'`; reasignar colaborador con motivo → auditoría `REASSIGN_COMMISSION` y nuevo monto calculado; intentar reasignar comisión liquidada → `409`. | Trazabilidad completa e inmutabilidad de comisiones liquidadas. |
| **M4-C5** | Liquidación, Concurrencia y Anti Doble Pago | Liquidar comisión vía `POST /api/commissions/payout` con dos solicitudes concurrentes (solo `1` prospera, la 2da `409`), verificar `audit_logs` (`COMMISSION_PAYOUT`), generar borrador de nómina y comprobar que la comisión ya liquidada (`Pagado` + `payout_id`) **NO** se incluye en nómina, mientras una pendiente del mismo período **SÍ** entra en el borrador y al aprobar nómina pasa a `Pagada` (bloqueando cualquier `/payout` posterior). | Cero doble pago por dos vías, cero duplicación en concurrencia, integración exacta con nómina. |
| **M4-C6** | RBAC y Aislamiento Multi-Tenant | Usuario con solo `commissions.view` consulta (`200`) pero es rechazado (`403`) al crear categoría/esquema/regla o liquidar (`/payout`); Empresa A no ve ni modifica/elimina/liquida categorías, esquemas ni comisiones de Empresa B (`404`/`409`). | Aislamiento estricto por empresa y separación de permisos confirmados. |

### C. Fallos Corregidos y Evidencia de Aceptación (`b75f436` — APROBADO)

- **M4-01 (Anti doble pago entre `/payout` y Nómina — Corregido y verificado)**: [payroll.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/payroll.routes.js) ahora excluye estrictamente `status IN ('Anulada', 'Pagada', 'Pagado')` y `payout_id IS NOT NULL` en el cálculo de comisiones, metas `Contar` y aprobación de nómina. Verificado en `M4-C5`: `Ana Estilista M4` tenía `RD$ 400.00` liquidados por `/payout` (`Pagado` + `payout_id`) y `RD$ 500.00` pendientes → borrador de nómina incluyó exactamente `RD$ 500.00` (`0` doble pago); tras aprobar nómina, `RD$ 500.00` pasó a `Pagada` y un intento posterior de `/payout` fue rechazado con `409`.
- **M4-02 (Liquidación atómica `FOR UPDATE` + Auditoría — Corregido y verificado)**: `POST /api/commissions/payout` en [commissions.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/commissions.routes.js) ahora ejecuta en transacción con `FOR UPDATE`, valida pertenencia al empleado/tenant, actualiza únicamente filas `Pendiente` con `payout_id IS NULL` y registra `COMMISSION_PAYOUT` en `audit_logs`. Verificado en `M4-C5`: 2 liquidaciones concurrentes sobre el mismo ID devolvieron `[200, 409]` con `1` solo `COMMISSION_PAYOUT` en `audit_logs`.
- **M4-03 (Vigencia `scheme_effective_date` — Corregido y verificado)**: [visits.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/visits.routes.js) evalúa `visitDay < effectiveDay` (`America/Santo_Domingo`). Verificado en `M4-C3`: `Carla Futura M4` con `scheme_effective_date = '2099-01-01'` no recibió `40%` del esquema sino `20%` del catálogo (`RD$ 200.00`, `scheme_id = null`).
- **M4-04 (Dependencias al borrar y reglas contradictorias — Corregido y verificado)**: [commissions.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/commissions.routes.js) + [CommissionManagement.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/commissions/CommissionManagement.jsx) bloquean con mensajes claros: `409 CATEGORY_IN_USE`, `409 SCHEME_IN_USE`, `409 DUPLICATE_SCHEME_RULE`, y `404` ante esquema/categoría de otro tenant.
- **Matriz Caso → Esperado → Observado (`salonpro-app:b75f436`, `salon_saas_test`)**:
  - **M4-C1 (Categorías + Catálogo)**: Esperado: crear/editar/desactivar, vínculo con `/servicios`, `409 CATEGORY_IN_USE` al borrar en uso. Observado: PASS en `test_module4_commissions_acceptance.cjs` y DOM real (`Estilismo DOM M4` persistida tras recarga y listada en `<select>` de `/servicios`).
  - **M4-C2 (Esquemas y Reglas)**: Esperado: crear esquema + reglas, `409 DUPLICATE_SCHEME_RULE`, `409 SCHEME_IN_USE`, desactivar sin perder historial. Observado: PASS en PG y DOM real (`Esquema DOM M4` persistido tras recarga).
  - **M4-C3 (Cálculos Verificables)**: Esperado/Observado exactos al centavo: específica `40%` (`1000 → RD$ 400.00 / 40000c`), fija (`RD$ 250 × 2 → RD$ 500.00 / 50000c`), ITBIS inclusivo `1180` + `10%` desc (`base RD$ 900.00 → 20% = RD$ 180.00`), producto `0%` (`RD$ 0.00` sin fallback), servicio sin regla (`15%` de `400 = RD$ 60.00`), vigencia futura (`RD$ 200.00`, `scheme_id=null`), histórico inmutable tras desactivar esquema (`RD$ 400.00`).
  - **M4-C4 (Anulación y Reasignación)**: Esperado/Observado: anulación → `status='Anulada'`; reasignación con motivo → `emp2` (`RD$ 400.00`) + `audit_logs` `REASSIGN_COMMISSION`; reasignación sobre liquidada → `409`.
  - **M4-C5 (Liquidación y Nómina)**: Esperado/Observado: concurrencia `[200, 409]`, `COMMISSION_PAYOUT` auditado, nómina excluye `Pagado` (`RD$ 500.00` exactos), aprobación marca `Pagada` y bloquea `/payout` (`409`).
  - **M4-C6 (RBAC y Aislamiento)**: Esperado/Observado: `commissions.view` → `200` en `GET`, `403` en `POST /categories` y `POST /payout`; cross-tenant → `404` al borrar categoría ajena y `409` al liquidar comisión ajena.
  - **Regresión consumidores**: `test_blocks_1_to_8_regression.cjs` (`B1`–`B9b`) → **PASS 100%**; DOM `/comisiones`, `/servicios`, `/nomina` → `pageErrors=[]`, `serverErrors=[]`, `hasErrorBoundary=false`.
- **Gates y Despliegue**: `test:scanner` (0 violaciones), `test:runner-guards` (17/17 + 63 tests), `lint`, `build`, `graphify update .`, respaldo previo de `salon_saas_staging` y despliegue de `salonpro-app:b75f436` (`Up (healthy)`, `/api/health` → `200`). **Estado: APROBADO**.
- **Ampliación Previa (`e439cc8`)**:
  - **RBAC 3 niveles**: `commissions.view` (consultar), `commissions.configure` (categorías, esquemas, reglas, asignaciones y sync) y `commissions.approve` (liquidar `/payout`). Mapeo conservador: solo `operational_admin` recibió `commissions.configure`; `accounting` mantiene `commissions.view` + `commissions.approve`; roles de consulta no ganan privilegios. Verificado en `test_module5_catalog_acceptance.cjs` (`M4-PREV`).
  - **Decisión pendiente del operador — Fallback 15%**: Se conserva temporalmente el fallback `15%` para servicios sin regla configurada (sin alterar históricos ni porcentajes), ahora identificado visiblemente como `⚠️ Fallback temporal (15%) — Sin regla configurada (pendiente decisión operador)` en backend (`visits.routes.js`) y con distintivo ámbar en `CommissionManagement.jsx`.

---

## Módulo 5 — Catálogo (Servicios y Productos + ITBIS)

### A. Arquitectura, Reglas y Fallos Corregidos (`e439cc8`)

- **UI**: [ServiceManagement.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/services/ServiceManagement.jsx) (`/servicios`), consumidores: [VisitRecorder.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/visits/VisitRecorder.jsx) (POS), [InventoryModule.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/inventory/InventoryModule.jsx) (`/inventario`).
- **Backend**: [services.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/services.routes.js) (`/api/services/*`), [visits.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/visits.routes.js).
- **Fallos corregidos y verificados**:
  - **M5-01 (Validaciones numéricas estrictas)** en [services.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/services.routes.js): `POST /api/services` y `PUT /api/services/:id` rechazan precios/costos negativos o no numéricos (`400 INVALID_PRICE` / `INVALID_COST`) y comisiones inválidas (`400 INVALID_COMMISSION_VALUE`); precio `0` permitido explícitamente.
  - **M5-02 (Importación masiva canónica con reporte por fila)** en [services.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/services.routes.js): `POST /api/services/bulk-import` valida cada fila con `resolveCommissionCategory`, precio `>= 0`, SKU único y retorna `{ imported, updated, skipped, errors: [{ row, nombre, code, error }] }`.
  - **M5-03 (Bloqueo de ítems archivados en nuevas ventas + preservación histórica en `DELETE`)**: [visits.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/visits.routes.js) rechaza con `400 ITEM_ARCHIVED` cualquier servicio/producto archivado en `POST /api/visits/:id/checkout`; `DELETE /api/services/:id` valida UUID (`404` si inválido) y archiva automáticamente (`archived: true`) si el ítem tiene historial en `visits`, `invoice_items`, `inventory_stock` o `inventory_movements`.
  - **M5-04 (Doble clic y permisos UI)** en [ServiceManagement.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/services/ServiceManagement.jsx): guardia síncrono `submitInFlightRef` en `handleSaveService` (conserva el formulario abierto ante error HTTP) y uso de `hasUiPermission(user, 'commissions.configure')`.

### B. Matriz de Aceptación (`e439cc8` — APROBADO)

| Caso | Esperado | Observado (`salon_saas_test` + DOM `salonpro-app:e439cc8`) | Evidencia | Resultado |
|---|---|---|---|---|
| **M5-C1** | Crear categoría en `/comisiones` → crear servicio y producto físico en `/servicios`, validar precio negativo/texto/SKU duplicado/categoría inactiva/UUID inválido, hidratar dato legacy, archivar/reactivar, borrar sin historial (hard-delete) y con historial (archivado). | Categoría `Catálogo DOM M5` reflejada en `<select>` de `/servicios`; `Balayage DOM M5` creado con doble clic sin duplicado y persistido tras recarga/búsqueda; precio `-50`/`"abc"`/`catInactiva`/`SKU dup` → `400`; `precio=0` → `201`; legacy hidratado limpio; borrado sin historial `archived=false`, con historial `archived=true`. | `test_module5_catalog_acceptance.cjs` + DOM real (`verify_module5_catalog_dom.mjs`) | **`aprobado`** |
| **M5-C2** | Precios/ITBIS/descuentos/cantidad > 1: gravado exclusivo `1000×2` `-10%` (`ITBIS 324`), inclusivo `1180` (`base 1000`, `ITBIS 180`), exento `500`, tasa 0 `300`, producto `750` exc (`ITBIS 135`) → `ITBIS = 639.00 (63900c)`, `Total = 4989.00`; edición posterior del catálogo no altera factura emitida. | `visits.itbis = 639.00`, `itbis_cents = 63900`, `total = 4989.00`; tras editar precio a `2500`, `visits.total` permaneció `4989.00`. | `test_module5_catalog_acceptance.cjs` + `test_blocks_1_to_8_regression.cjs` (`B5`/`B9b`) | **`aprobado`** |
| **M5-C3** | Servicios no descuentan stock; producto comparte UUID canónico con Inventario (`stock 5→4`); stock `0` → `400 INSUFFICIENT_STOCK`; ítem archivado → `400 ITEM_ARCHIVED`; producto `0%` comisión permanece `0.00`. | Todos los contratos verificados exactamente en PostgreSQL; `/inventario` cargó sin `ErrorBoundary`. | `test_module5_catalog_acceptance.cjs` + DOM `/inventario` | **`aprobado`** |
| **M5-C4** | `POST /bulk-import` reporta errores por fila; `services.view` consulta (`200`) y rechaza escritura/borrado (`403`); cross-tenant rechazado (`404`/`400`). | `bulk-import`: `imported=1, skipped=4, errors.length=4`; `services.view` `200`/`403`; Empresa B sobre Empresa A `404`. | `test_module5_catalog_acceptance.cjs` | **`aprobado`** |

- **Gates y Despliegue**: `test:scanner` (0 violaciones), `test:runner-guards` (17/17 + 63 tests), `lint`, `build`, `verify:release` (54 chunks JS, 248 imports), `graphify update .`, respaldo previo de `salon_saas_staging` y despliegue verificado de `salonpro-app:e439cc8` (`Up (healthy)`, `/api/health` → `200`). `pageErrors=[]`, `serverErrors=[]`. **Estado: APROBADO**.

---

## Módulo 6 — Inventario (Stock, Ubicaciones, Movimientos, Compras, Transferencias y Toma Física)

### A. Arquitectura y Fallos Corregidos (`687940a`)

- **UI**: [InventoryModule.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/inventory/InventoryModule.jsx) (`/inventario`).
- **Backend**: [inventory.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/inventory.routes.js), [inventory.service.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/services/inventory.service.js), [inventory.repository.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/repositories/inventory.repository.js), [inventory_purchase.service.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/services/inventory_purchase.service.js), [inventory_transfer.service.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/services/inventory_transfer.service.js), [inventory_physical_session.service.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/services/inventory_physical_session.service.js).
- **Fallos corregidos y verificados**:
  - **M6-01 (RBAC `inventory.manage` en ajustes y alertas)** en [inventory.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/inventory.routes.js) + [inventory.service.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/services/inventory.service.js): el rol predefinido `Encargado de inventario` (`inventory.manage`) era bloqueado con `403 UNAUTHORIZED_ROLE` en ajustes y alertas por leer `req.user` en lugar de `req.auth`. Corregido para respetar `inventory.manage` y `req.auth`.
  - **M6-02 / M6-03 (Validación cantidad `<= 0` y UUID inválido)** en [inventory.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/inventory.routes.js): rechazo `400 VALIDATION_ERROR` ante cantidad `<= 0` o tipo inválido; validación UUID en `/products/:id`, `/stock/:productId` y `/adjustments` (`404`/`400` sin `500`).
  - **M6-04 (Doble clic en UI)** en [InventoryModule.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/inventory/InventoryModule.jsx): guardas síncronos `adjInFlightRef` y `trfInFlightRef`.
  - **M6-05 (Alineación ubicación por defecto de sucursal entre Ajustes y POS)** en [inventory.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/inventory.routes.js) + [inventory.service.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/services/inventory.service.js): ajustes y consultas de stock sin `locationId` explícito resuelven ahora a la ubicación de la sucursal del usuario (`req.auth.branchId`), alineado con `POST /api/visits/:id/checkout`.
  - **M6-06 / M6-07 (Bug crítico en Toma Física multi-sucursal)** en [inventory_physical_session.service.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/services/inventory_physical_session.service.js): (1) reemplazado `p.cost` inexistente (`42703`) por `COALESCE(p.costo, 0)`; (2) acotados estrictamente por `AND location_id = ?` el snapshot inicial, `SELECT ... FOR UPDATE`, el cálculo de movimientos posteriores y el `UPDATE inventory_stock` en `postSession`, evitando corrupción de stock de otras sucursales.

### B. Matriz de Aceptación (`687940a` — APROBADO)

| Caso | Esperado | Observado (`salon_saas_test` + DOM `salonpro-app:687940a`) | Evidencia | Resultado |
|---|---|---|---|---|
| **M6-C1** | Fuente única Catálogo (`POST`/`PUT /api/inventory/products` → `403 CATALOG_SINGLE_SOURCE`), mismo UUID canónico, rechazo UUID inválido (`404`), cantidad `<= 0` (`400`) y servicio en ajuste (`400`/`404`). | Todos los bloqueos exactos; producto del Catálogo visible en `/inventario` con su UUID canónico. | `test_module6_inventory_acceptance.cjs` + DOM `/inventario` | **`aprobado`** |
| **M6-C2** | Ajustes `IN +10` / `OUT -3` (`=7`), exceso `OUT -20` → `400 INSUFFICIENT_STOCK`, venta POS `-2` (`=5`), alerta bajo stock (`≤6`), anulación POS revierte a `7`, libro mayor completo. | Balances exactos (`10 → 7 → 5 → 7`), alerta disparada en `5 ≤ 6`, `≥4` movimientos auditados en `/movements`. | `test_module6_inventory_acceptance.cjs` + DOM (`Existencias` + `Ledger`) | **`aprobado`** |
| **M6-C3** | Compra (`+10` con reintento idempotente → `17`), transferencia `loc1 → loc2` (`5` uds → `12 / 5`, misma ubicación `400 SAME_LOCATION_TRANSFER`), toma física en `loc2` (`5 → 4`) sin tocar `loc1` (`=12`), concurrencia última unidad. | `loc1=12` intacto, `loc2=4` exacto tras publicación atómica; concurrencia `test_inventory_concurrency.cjs` PASS. | `test_module6_inventory_acceptance.cjs` + `test_inventory_concurrency.cjs` | **`aprobado`** |
| **M6-C4** | `inventory.view` consulta (`200`) y rechaza ajustes/alertas (`403`); `Encargado de inventario` (`inventory.manage`) opera ajustes y alertas (`200`); Empresa B sobre Empresa A → `404`. | Permisos y aislamiento multi-tenant verificados al 100%. | `test_module6_inventory_acceptance.cjs` | **`aprobado`** |

- **Gates y Despliegue**: `test:scanner` (0 violaciones), `test:runner-guards` (17/17 + 66 tests), `lint`, `build`, `verify:release`, `graphify update .`, `test_blocks_1_to_8_regression.cjs` (PASS), respaldo previo de `salon_saas_staging` y despliegue verificado de `salonpro-app:687940a` (`Up (healthy)`, `/api/health` → `200`). `pageErrors=[]`, `serverErrors=[]`. **Estado: APROBADO**.

---

## Módulo 7 — Clientes (CRM)

### A. Análisis de Arquitectura y Dependencias (Graphify + Código)

- **UI**: [ClientRegistration.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/clients/ClientRegistration.jsx) (`/registro-cliente`), [ClientProfile.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/clients/ClientProfile.jsx) (`/clientes`, `/lista-clientes`), [ClientDashboard.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/clients/ClientDashboard.jsx) (portal B2C).
- **Backend**: [clients.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/clients.routes.js) (`/api/clients`, `/api/clients/search`, `/api/clients/cedula/:cedula`, `/api/clients/:id`), montado con `rejectControlPlaneRoleOnTenantRoutes` y `requirePlanFeature('clients')` en [app.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/app.js).
- **Tablas**: `clients`, `visits`, `contracts`, `branches`, `salons`.
- **Reglas confirmadas**:
  - Incluido en **Plan Principal** (`clients`); sin add-on `memberships`, campos de contrato/membresía se omiten en lectura y cualquier payload de membresía (`plan_id`, `contract_status`, `washes_used`, `wash_Quota`) se rechaza con `403 FEATURE_NOT_INCLUDED`.
  - Aislamiento estricto por `tenant_id` (una misma cédula puede existir en empresas distintas, nunca duplicada dentro de la misma empresa).
  - Clientes B2C (`cliente_b2c`) solo pueden consultar `GET /api/clients/:id` de su propio `id`; personal requiere `clients.view` / `clients.create` / `clients.edit`.
  - Integridad histórica: eliminar un cliente con historial de `visits` lo archiva (`status = 'Inactive'`, `archived: true`) sin borrar sus ventas; sin historial se elimina físicamente.

### B. Fallos Corregidos (`74ec5d5` / `5c19b33`)

- **M7-01**: `POST /api/clients` descartaba `fechaNacimiento` y dirección estructurada (`calle`/`numero`/`sector`/`ciudad`) enviados por `/registro-cliente` y aceptaba `nombre` con solo espacios o `salon_id` de otro tenant (cayendo silenciosamente a la sucursal principal) → corregido con `buildAddressFallback`, soporte de `fechaNacimiento`, trim obligatorio (`400`) y rechazo `400` de `salon_id` ajeno.
- **M7-02**: `PUT /api/clients/:id` y `DELETE /api/clients/:id` arrojaban `500` PostgreSQL (`22P02`) ante `:id` no-UUID → ahora validan `UUID_RE` y devuelven `404`.
- **M7-03**: `PUT /api/clients/:id` no sincronizaba columnas espejo (`name`, `phone`, `address`, `cedula_rnc`) ni validaba colisión de `cedula` contra otro cliente de la misma empresa → corregido (sincroniza todas las columnas espejo y rechaza duplicado con `400`).
- **M7-04**: `DELETE /api/clients/:id` borraba físicamente clientes con historial en `visits` → corregido para archivar (`status = 'Inactive'`, `archived: true`) preservando historial comercial/contable.
- **M7-05**: [ClientRegistration.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/clients/ClientRegistration.jsx) invocaba `onClientSaved` incluso en el bloque `catch` de error de servidor y carecía de guardia anti-doble clic → corregido (`submitInFlightRef` + `submitting` y formulario permanece abierto ante error).
- **M7-06**: [ClientProfile.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/clients/ClientProfile.jsx) agregó guardia `saveEditInFlightRef` + `savingEdit` en edición de perfil.

### C. Evidencia de Aceptación (`74ec5d5` / `5c19b33` — APROBADO)

| Caso | Esperado | Observado | Evidencia | Resultado |
|---|---|---|---|---|
| **M7-C1** | Alta con `fechaNacimiento`, dirección estructurada, columnas espejo y sin exponer `password` | `nombre`/`name`, `direccion`/`address`, `fecha_nacimiento` persistidos; `password` y campos membresía omitidos en Plan Principal | `test_module7_clients_acceptance.cjs` | **PASS** |
| **M7-C2** | Rechazo `400` nombre vacío, cédula duplicada (con/sin guiones), `salon_id` ajeno; `404` en UUID inválido (`PUT`/`DELETE`) | Todos rechazados con `400`/`404` exactos (`0` errores `500`) | `test_module7_clients_acceptance.cjs` | **PASS** |
| **M7-C3** | `PUT /:id` actualiza espejo, bloquea cédula duplicada (`400`) y sucursal ajena (`400`) | Columnas espejo sincronizadas; colisión y sucursal ajena rechazadas `400` | `test_module7_clients_acceptance.cjs` | **PASS** |
| **M7-C4** | Aislamiento multi-tenant (2 empresas): misma cédula permitida en Empresa B, `404` cruzado y `0` fugas en `/search` | Empresa B crea misma cédula (`200`), `GET`/`PUT`/`DELETE` cruzados → `404`, `/search` → `0` fugas | `test_module7_clients_acceptance.cjs` | **PASS** |
| **M7-C5** | Borrado con historial de `visits` archiva (`Inactive`); sin historial elimina físicamente | Cliente con visita → `archived: true` (`status = 'Inactive'`); sin visita → `archived: false` (eliminado) | `test_module7_clients_acceptance.cjs` | **PASS** |
| **M7-C6** | Plan Principal rechaza payload de membresía en `POST`/`PUT` con `403 FEATURE_NOT_INCLUDED` | `POST` y `PUT` con `plan_id` → `403 FEATURE_NOT_INCLUDED` | `test_module7_clients_acceptance.cjs` | **PASS** |
| **M7-C7** | RBAC granular (`clients.view` vs `clients.create` vs `clients.edit`) y B2C solo consulta su propio `/:id` | Viewer (`GET` 200, `POST`/`PUT`/`DELETE` 403), Creator (`POST` 200, `PUT`/`DELETE` 403), B2C (propio `/:id` 200, resto `403`) | `test_module7_clients_acceptance.cjs` | **PASS** |
| **M7-C8** | Paginación cursor HMAC sin duplicados y búsqueda aislada (`<2` chars → `400`, cross-tenant cursor → `400`) | 6/6 en `test_pagination_cursors.cjs` + `M7-C8` PASS | `test_pagination_cursors.cjs` + `test_module7_clients_acceptance.cjs` | **PASS** |
| **M7-DOM** | Flujo real Chromium: login → `/registro-cliente` (2 pasos, fecha nac., sucursal, dirección) → `/clientes?id=...` → editar teléfono → recargar | `clientId=2c14a912-...`, `persistedPhone=8295558802` tras recarga, `pageErrors=0`, `serverErrors=0`, `0` ErrorBoundary | Chromium DOM (`salonpro-app:74ec5d5`) | **PASS** |

- **Gates y Despliegue**: `test:scanner` (0 violaciones), `test:runner-guards` (PASS), `lint`, `build`, `verify:release`, `graphify update .`, `test_blocks_1_to_8_regression.cjs` (PASS), limpieza de `salon_saas_test`, respaldo previo `/opt/salonpro/backups/salon_saas_staging_pre_74ec5d5_20261122_204850.sql.gz` y despliegue verificado de `salonpro-app:74ec5d5` (`Up (healthy)`, `/api/health` → `200`). **Estado: APROBADO**.

---

## Módulo 8 — Cajas (Apertura, Movimientos, Cierre y Arqueo)

### A. Análisis de Arquitectura y Dependencias (Graphify + Código)

- **UI**: [CashRegistersModule.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/admin/CashRegistersModule.jsx) (`/cajas`), [CashRegisterClosePrintModal.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/visits/CashRegisterClosePrintModal.jsx), apertura/cierre operativo desde [VisitRecorder.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/visits/VisitRecorder.jsx).
- **Backend**: [cash_registers.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/cash_registers.routes.js) (`/api/cash-registers`, `/active`, `/open`, `/:id/close`, `/:id/close-report`, `/:id/movements`, `/history`, `/:id/invoices`) + motor canónico [cash_register_aggregation.service.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/services/cash_register_aggregation.service.js) (cálculo en centavos enteros).
- **Tablas**: `cash_registers`, `cash_register_movements`, `visits`, `branches`, `security_settings`.
- **Reglas confirmadas**:
  - Saldo esperado en caja = `fondo inicial + ventas efectivo + ingresos manuales efectivo - devoluciones efectivo - gastos efectivo - retiros efectivo` (pagos con tarjeta/transferencia y visitas anuladas se excluyen del efectivo esperado).
  - Máximo una caja abierta por empresa y sucursal, garantizado incluso ante aperturas concurrentes.
  - Discrepancias de arqueo exigen motivo (≥ 5 caracteres) y confirmación doble (`double_confirmed: true`); si `|diferencia| >= RD$ 100.00` (10,000 centavos), exigen obligatoriamente `supervisor_pin` validado contra `security_settings.admin_pin_hash`.
  - Cajas cerradas preservan su instantánea de cierre y rechazan cualquier movimiento posterior.

### B. Fallos Corregidos (`bcb4cf1` / `01d365a`)

- **M8-01**: `POST /api/cash-registers/:id/movements` permitía registrar movimientos en cajas ya cerradas, carecía de control de alcance por sucursal (`isBranchAuthorized`) y no validaba el tipo ni montos finitos → corregido (`409 REGISTER_CLOSED`, `403 BRANCH_ACCESS_DENIED`, `400 INVALID_MOVEMENT_TYPE`, `400 INVALID_MOVEMENT_AMOUNT`).
- **M8-02**: `GET /api/cash-registers/history` no filtraba por alcance de sucursal (`getBranchScope`) → corregido para restringir resultados a las sucursales autorizadas y rechazar `salon_id` no autorizado con `403 BRANCH_ACCESS_DENIED`.
- **M8-03**: `POST /api/cash-registers/open` caía silenciosamente a la sucursal principal si recibía un `branch_id` de otra empresa y no serializaba aperturas concurrentes → corregido (`400 INVALID_BRANCH` para sucursal ajena y transacción con `pg_advisory_xact_lock(hashtext(...))` por `tenant_id:branch_id`).
- **M8-04**: `POST /api/cash-registers/:id/close` carecía de condición atómica en el `UPDATE` frente a cierres concurrentes → corregido con `AND LOWER(COALESCE(status, '')) != 'cerrada' RETURNING id` (el segundo cierre concurrente recibe `409 ALREADY_CLOSED` sin duplicar correo ni mutar el arqueo).

### C. Evidencia de Aceptación (`bcb4cf1` / `01d365a` — APROBADO)

| Caso | Esperado | Observado | Evidencia | Resultado |
|---|---|---|---|---|
| **M8-C1** | Rechazo `400` monto negativo, campos contradictorios y `branch_id` de otra empresa (`INVALID_BRANCH`) | Todos rechazados con `400` y códigos canónicos | `test_module8_cash_registers_acceptance.cjs` | **PASS** |
| **M8-C2** | Dos `POST /open` concurrentes en misma sucursal: solo 1 prospera (`200`), 1 `400 REGISTER_ALREADY_OPEN`; otra sucursal abre independiente | `[200, 400]` exacto; sucursal A2 abre independiente | `test_module8_cash_registers_acceptance.cjs` | **PASS** |
| **M8-C3** | `2000 + 1200 (efectivo) + 500 (ingreso) - 250 (gasto) - 100 (retiro) = 3350`; tarjeta (`800`) y anulada (`400`) excluidas; tipo/monto inválido `400` | `expected_cash = 3350`, `tarjeta_total = 800`, `count_invoices = 2` | `test_module8_cash_registers_acceptance.cjs` | **PASS** |
| **M8-C4** | Dos `POST /:id/close` concurrentes: solo 1 `200` (`difference = 0`), 1 `409 ALREADY_CLOSED`; movimiento post-cierre `409 REGISTER_CLOSED` | `[200, 409]`, post-cierre `409 REGISTER_CLOSED`, `close-report` preserva `3350` | `test_module8_cash_registers_acceptance.cjs` | **PASS** |
| **M8-C5** | Discrepancia ≥ umbral sin PIN `403`, PIN erróneo `401`, PIN válido `200` con auditoría de supervisor y correlación | 7/7 en `test_cash_reconciliation.cjs` + `M8-C5` PASS | `test_cash_reconciliation.cjs` + `test_module8_cash_registers_acceptance.cjs` | **PASS** |
| **M8-C6** | Alcance sucursal en `/history`, `/close-report`, `/movements` (`403`) y aislamiento multi-tenant (`404` / lista vacía) | Operador limitado a A1 bloqueado en A2 (`403`); Empresa B recibe `404` / `0` filas | `test_module8_cash_registers_acceptance.cjs` | **PASS** |
| **M8-DOM** | Flujo real Chromium en `/cajas`: tabla con cajas abierta y cerrada, apertura de modal de detalles y pestaña Movimientos | `hasOpenAndClosed=true`, `detailModalOpened=true`, `pageErrors=0`, `serverErrors=0`, `0` ErrorBoundary | Chromium DOM (`salonpro-app:bcb4cf1`) | **PASS** |

- **Gates y Despliegue**: `test:scanner` (0 violaciones), `test:runner-guards` (PASS), `lint`, `build`, `verify:release`, `graphify update .`, `test_blocks_1_to_8_regression.cjs` (PASS), limpieza de `salon_saas_test`, respaldo previo de `salon_saas_staging` y despliegue verificado de `salonpro-app:bcb4cf1` (`Up (healthy)`, `/api/health` → `200`). **Estado: APROBADO**.

---

## Módulo 9 — POS, Tickets y Facturación Convencional

### A. Análisis de Arquitectura y Dependencias (Graphify + Código)

- **UI**: [VisitRecorder.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/visits/VisitRecorder.jsx) (`/visitas`), [ThermalTicketModal.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/visits/ThermalTicketModal.jsx) (ticket térmico 80mm / `60mm` seguro, `window.print()` a 250ms), [InvoiceHistory.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/admin/InvoiceHistory.jsx) (`/facturas`), [ElectronicInvoicePrintModal.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/common/ElectronicInvoicePrintModal.jsx) (reimpresión sin consumir secuencia).
- **Backend**: [visits.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/visits.routes.js) (`/api/visits/ticket`, `/:id/draft`, `/precuenta`, `/:id/checkout`, `/:id/void`, `/:id/cancel`, `DELETE /:id`) + `InventoryService` + `dgii_ncf_sequences`.
- **Tablas**: `visits`, `ticket_sequences`, `dgii_ncf_sequences`, `inventory_stock`, `inventory_movements`, `cash_registers`, `cash_register_movements`, `employee_commissions_log`, `audit_logs`.
- **Reglas confirmadas**:
  - Facturación convencional (`B01`/`B02` o `NONE` sin comprobante) opera sin integración electrónica DGII (`DGII_MODE=disabled`), mientras los e-CF (`E31`, etc.) se bloquean explícitamente con `409 NCF_ECF_INTEGRATION_REQUIRED`.
  - Precuenta **no** consume NCF, **no** descuenta stock y **no** suma a caja.
  - Servicios no descuentan inventario; productos físicos descuentan atómicamente en checkout y se revierten exactamente una vez al anular.
  - Doble clic en checkout es idempotente (no consume segundo NCF ni vuelve a descontar stock). Reimpresión en `/facturas` no crea nueva factura ni consume secuencia.

### B. Fallos Corregidos (`fa15f28`)

- **M9-01 (Crítico fiscal)**: `DELETE /api/visits/:id` y `POST /api/visits/:id/delete` permitían eliminar físicamente facturas ya emitidas (`Facturado`) o anuladas (`Anulado`) y carecían de validación de sucursal → corregido para bloquear el borrado de facturas emitidas/anuladas con `409 INVOICE_CANNOT_BE_DELETED` y exigir `isBranchAuthorized`.
- **M9-02 (Concurrencia y sucursal)**: `POST /api/visits/:id/void` carecía de condición atómica en el `UPDATE` (dos anulaciones concurrentes podían revertir inventario dos veces y duplicar `anulacion_venta`), permitía anular tickets no facturados y no validaba alcance de sucursal → corregido (`WHERE ... AND status = 'Facturado' RETURNING id`, rechazo `409 NOT_INVOICED` / `409 ALREADY_VOIDED` y `403 BRANCH_ACCESS_DENIED`).
- **M9-03 (Inmutabilidad)**: `POST /api/visits/precuenta` permitía sobrescribir `servicios`, `items_detail` y `total` de una visita ya `Facturado` y no verificaba sucursal → corregido (`409 TICKET_NOT_EDITABLE` fuera de estados editables y `403 BRANCH_ACCESS_DENIED`).

### C. Evidencia de Aceptación (`fa15f28` — APROBADO)

| Caso | Esperado | Observado | Evidencia | Resultado |
|---|---|---|---|---|
| **M9-C1** | Ticket pendiente (`201`) → borrador → precuenta: `0` NCF consumidos, `0` stock descontado, `0` efectivo en caja | `secuencia_actual` sin cambios (`1`), stock intacto (`10`), `expected_cash = 1000` | `test_module9_pos_invoicing_acceptance.cjs` | **PASS** |
| **M9-C2** | Checkout convencional `B02` (`DGII_MODE=disabled`), servicio (`0` stock) + producto (`-2`), efectivo entregado `1500` sobre `1200` (neto `1200`, cambio `300`), doble clic idempotente | `ncf = B0200000001`, secuencia avanzó `1 → 2` una sola vez, stock `10 → 8`, servicio `0` movimientos, `expected_cash = 2200` | `test_module9_pos_invoicing_acceptance.cjs` + `B9b` | **PASS** |
| **M9-C3** | Inmutabilidad post-facturación: `/precuenta`, `/draft`, `/cancel`, `DELETE /:id` bloqueados con `409` | Todos rechazados con `409` (`INVOICE_CANNOT_BE_DELETED`, `TICKET_NOT_EDITABLE`, `ALREADY_INVOICED`) | `test_module9_pos_invoicing_acceptance.cjs` | **PASS** |
| **M9-C4** | Dos `POST /:id/void` concurrentes: solo 1 `200`, 1 `409`; stock restaurado exactamente 1× (`8 → 10`); caja excluye anulada (`1000`); `DELETE` sigue bloqueado (`409`) | `[200, 409]`, stock exacto `10`, `expected_cash = 1000`, `DELETE` → `409` | `test_module9_pos_invoicing_acceptance.cjs` | **PASS** |
| **M9-C5** | `/void` en pendiente rechazado (`409 NOT_INVOICED`), `DELETE` en pendiente permitido (`200`), `E31` bloqueado (`409 NCF_ECF_INTEGRATION_REQUIRED`), `NONE` factura sin consumir `B02` | Todos los códigos y estados exactos; `secuencia_actual` sigue en `2` | `test_module9_pos_invoicing_acceptance.cjs` | **PASS** |
| **M9-C6** | Aislamiento por sucursal (`403 BRANCH_ACCESS_DENIED`) y multi-tenant (`404`) en `/draft`, `/precuenta`, `/cancel`, `/void`, `DELETE` | Operador de A1 bloqueado en A2 (`403`); Empresa B recibe `404` | `test_module9_pos_invoicing_acceptance.cjs` | **PASS** |
| **M9-DOM** | Flujo real Chromium: login → `/visitas` (POS con caja abierta y catálogo) → `/facturas` (factura `B0200000001` visible y reimpresión) | `posLoaded=true`, `invoiceVisible=true`, `reprintClicked=true`, `pageErrors=0`, `serverErrors=0`, `0` ErrorBoundary | Chromium DOM (`salonpro-app:fa15f28`) | **PASS** |

- **Gates y Despliegue**: `test:scanner` (0 violaciones), `test:runner-guards` (PASS), `lint`, `build`, `verify:release`, `graphify update .`, `test_blocks_1_to_8_regression.cjs` (PASS), limpieza de `salon_saas_test`, respaldo previo de `salon_saas_staging` y despliegue verificado de `salonpro-app:fa15f28` (`Up (healthy)`, `/api/health` → `200`). **Estado: APROBADO**.

---

## Módulo 10 — Comisiones y Descuentos

### A. Análisis de Arquitectura y Dependencias (Graphify + Código)

- **UI**: [EmployeeDiscountsModule.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/admin/EmployeeDiscountsModule.jsx) (`/descuentos-empleados`), [CommissionManagement.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/commissions/CommissionManagement.jsx) (`/comisiones`).
- **Backend**: [employee_security.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/employee_security.routes.js) (`/api/employee-discounts`, `/api/employee-security/employee-discounts`), [visits.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/visits.routes.js) (`PUT /api/visits/:id/commission-recipient`, cascada en `POST /api/visits/:id/void`), [commissions.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/commissions.routes.js).
- **Tablas**: `employee_discounts`, `employee_commissions_log`, `visits`, `staff_records`, `audit_logs`.
- **Reglas confirmadas**:
  - Descuentos ya `Saldado` en nómina o `Anulado` por anulación de factura son inmutables (`409`).
  - Reasignación de beneficiario de comisión en factura emitida exige motivo obligatorio (`400 REASON_REQUIRED`), permiso autorizado (`403 COMMISSION_EDIT_FORBIDDEN`) y se bloquea en facturas anuladas (`409 INVOICE_VOIDED`).
  - Anular una factura cascada automáticamente `status = 'Anulada'` en `employee_commissions_log` y `status = 'Anulado'` en `employee_discounts`.

### B. Fallos Corregidos (`4610b28`)

- **M10-01 (PostgreSQL)**: `GET /employee-discounts` usaba `DATE_FORMAT(ed.date, '%Y-%m-%d')` (sintaxis MySQL) provocando `500` en PostgreSQL nativo → reemplazado por `TO_CHAR(ed.date, 'YYYY-MM-DD')`.
- **M10-02 (PostgreSQL)**: `POST /employee-discounts` omitía `RETURNING id`, devolviendo `id: undefined` en PostgreSQL → corregido con `RETURNING id`.
- **M10-03 (Validación e inmutabilidad)**: `POST`/`PUT`/`DELETE /employee-discounts` aceptaban montos negativos/no finitos, estatus arbitrarios (`Saldado` directo al crear), IDs no enteros (`500` PG) y permitían modificar/borrar registros `Anulado` → corregido (`400` validaciones, `404` IDs inválidos o colaborador ajeno, `409 DISCOUNT_ALREADY_SETTLED` / `409 DISCOUNT_VOIDED`).
- **M10-04 (UI)**: [EmployeeDiscountsModule.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/admin/EmployeeDiscountsModule.jsx) agregó guardia `saveInFlightRef` anti-doble clic al guardar descuentos.

### C. Evidencia de Aceptación (`4610b28` — APROBADO)

| Caso | Esperado | Observado | Evidencia | Resultado |
|---|---|---|---|---|
| **M10-C1** | Alta devuelve `id` numérico (`RETURNING id`); rechaza `amount <= 0` (`400`), `status = 'Saldado'` (`400`), `employee_id` ajeno (`404`) e ID no entero (`404`) | Todos validados exactamente (`id > 0` devuelto) | `test_module10_commissions_discounts_acceptance.cjs` | **PASS** |
| **M10-C2** | Edición valida monto y colaborador; registros `Saldado` bloquean `PUT`/`DELETE` con `409 DISCOUNT_ALREADY_SETTLED` | `PUT` y `DELETE` sobre `Saldado` → `409 DISCOUNT_ALREADY_SETTLED` | `test_module10_commissions_discounts_acceptance.cjs` | **PASS** |
| **M10-C3** | `PUT /api/visits/:id/commission-recipient` exige motivo (`400`), bloquea rol sin permiso (`403`) y reasigna con auditoría para Owner (`200`) | `400`, `403` y `200` verificados | `test_module10_commissions_discounts_acceptance.cjs` | **PASS** |
| **M10-C4** | Anulación de factura cascada `Anulado` a `employee_discounts`, bloquea `PUT`/`DELETE` (`409`) y bloquea reasignación (`409 INVOICE_VOIDED`) | Cascada automática verificada; `PUT`/`DELETE`/`commission-recipient` → `409` | `test_module10_commissions_discounts_acceptance.cjs` | **PASS** |
| **M10-C5** | Aislamiento multi-tenant: Empresa B recibe `0` filas en `GET /employee-discounts` (`TO_CHAR` PG) y `404` en `PUT`/`DELETE` cruzados | `200` (`[]`) y `404` cruzados | `test_module10_commissions_discounts_acceptance.cjs` | **PASS** |
| **M10-DOM** | Flujo real Chromium en `/descuentos-empleados` y `/comisiones` | `discountsLoaded=true`, `commissionsLoaded=true`, `pageErrors=0`, `serverErrors=0`, `0` ErrorBoundary | Chromium DOM (`salonpro-app:4610b28`) | **PASS** |

- **Gates y Despliegue**: `test:scanner` (0 violaciones), `test:runner-guards` (PASS), `lint`, `build`, `verify:release`, `graphify update .`, `test_module4_commissions_acceptance.cjs` (6/6 PASS), `test_blocks_1_to_8_regression.cjs` (PASS), limpieza de `salon_saas_test`, respaldo previo de `salon_saas_staging` y despliegue verificado de `salonpro-app:4610b28` (`Up (healthy)`, `/api/health` → `200`). **Estado: APROBADO**.

---

## Módulo 11 — Nómina

### A. Análisis de Arquitectura y Dependencias (Graphify + Código)

- **UI**: [PayrollModule.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/payroll/PayrollModule.jsx) (`/nomina`), [PayrollHistoryView.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/payroll/PayrollHistoryView.jsx), [PayrollCalculationSettingsModal.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/payroll/PayrollCalculationSettingsModal.jsx), [PayrollComparisonModal.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/payroll/PayrollComparisonModal.jsx).
- **Backend**: [payroll.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/payroll.routes.js) (`/api/payroll/periods`, `/generate`, `/save-draft`, `/bulk-apply`, `/approve`, `/periods/:id/register-payment`, `/periods/:id/sync-real-data`, `/audit-logs/:payroll_id`, `DELETE /periods/:id`, `/regalias/:year`).
- **Tablas**: `payroll_periods`, `payroll_items`, `payroll_audit_logs`, `staff_records`, `employee_commissions_log`, `employee_discounts`, `attendance_logs`.
- **Reglas confirmadas**:
  - Separación RBAC de 3 niveles de escritura: `payroll.generate` (generar/editar borrador/eliminar borrador), `payroll.approve` (aprobar y sellar snapshot inmutable), `payroll.pay` (registrar pago administrativo interno sin transferencia bancaria automática).
  - Aprobación transaccional con `FOR UPDATE` que marca `is_immutable = 1`, guarda `snapshot_json`, liquida `employee_discounts` como `Saldado` y comisiones con `payout_id IS NULL` como `Pagada` (evitando doble pago).
  - Novedades pendientes (`PAYROLL_PENDING_REVIEW`) bloquean la aprobación hasta su resolución individual.

### B. Fallos Corregidos (`8e5483d` / `885e574`)

- **M11-01 (Seguridad RBAC / Escalamiento de estado)**: `POST /api/payroll/save-draft` aceptaba cualquier valor de `status` desde `req.body` (permitiendo a un usuario con solo `payroll.generate` escribir `status = 'Aprobada'` o `'Pagada'` saltándose `payroll.approve`, `payroll.pay`, `snapshot_json` e `is_immutable`) y no validaba alcance de sucursal → corregido (`400 INVALID_DRAFT_STATUS` fuera de `['En preparación', 'En revisión', 'Borrador']` y `403 FORBIDDEN_BRANCH_SCOPE`).
- **M11-02 (Robustez PostgreSQL)**: `/periods/:id`, `/save-draft`, `/approve`, `/periods/:id/register-payment` y `DELETE /periods/:id` fallaban con `500` (`22P02`) ante IDs no enteros → validados con `isPositiveIntId` devolviendo `404`.

### C. Evidencia de Aceptación (`8e5483d` / `885e574` — APROBADO)

| Caso | Esperado | Observado | Evidencia | Resultado |
|---|---|---|---|---|
| **M11-C1** | Generación de quincena integra salario base, comisiones pendientes (`500`) y descuentos (`200`) | Período e ítem creados con `comisiones = 500` exactos | `test_module11_payroll_acceptance.cjs` | **PASS** |
| **M11-C2** | `save-draft` bloquea `status = 'Aprobada'`/`'Pagada'` (`400 INVALID_DRAFT_STATUS`), IDs no enteros → `404`, edición válida persiste y audita | Todos los bloqueos y edición legítima verificados | `test_module11_payroll_acceptance.cjs` | **PASS** |
| **M11-C3** | RBAC 3 niveles: `generate` no aprueba ni paga (`403`); `approve` no paga ni borra (`403`); pago previo a aprobación → `409 PAYROLL_NOT_APPROVED` | Todos los códigos `403`/`409` exactos | `test_module11_payroll_acceptance.cjs` | **PASS** |
| **M11-C4** | Dos `/approve` concurrentes: solo 1 `200`, 1 `409 PAYROLL_ALREADY_APPROVED`; comisiones → `Pagada`, descuentos → `Saldado`; edición/borrado posterior → `403 PAYROLL_IMMUTABLE` | `[200, 409]`, liquidación automática e inmutabilidad verificadas | `test_module11_payroll_acceptance.cjs` | **PASS** |
| **M11-C5** | Dos `/register-payment` concurrentes: solo 1 `200` (`Pagada`), 1 `409 PAYROLL_ALREADY_PAID` | `[200, 409]` exactos | `test_module11_payroll_acceptance.cjs` | **PASS** |
| **M11-C6** | Aislamiento multi-tenant: Empresa B recibe `0` períodos y `404` en consultas/borrados cruzados | `200` (`[]`) y `404` cruzados | `test_module11_payroll_acceptance.cjs` | **PASS** |
| **M11-DOM** | Flujo real Chromium en `/nomina` | `payrollLoaded=true`, `pageErrors=0`, `serverErrors=0`, `0` ErrorBoundary | Chromium DOM (`salonpro-app:8e5483d`) | **PASS** |

- **Gates y Despliegue**: `test:scanner` (0 violaciones), `test:runner-guards` (PASS), `lint`, `build`, `verify:release`, `graphify update .`, `test_blocks_1_to_8_regression.cjs` (PASS), limpieza de `salon_saas_test`, respaldo previo de `salon_saas_staging` y despliegue verificado de `salonpro-app:8e5483d` (`Up (healthy)`, `/api/health` → `200`). **Estado: APROBADO**.

---

## Módulo 12 — Contabilidad y Reportes (Egresos, 606, 607, IT-1, NCF)

### A. Análisis de Arquitectura y Dependencias (Graphify + Código)

- **UI**: [ExpensesModule.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/admin/ExpensesModule.jsx) (`/egresos`), [Reporte606Module.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/admin/Reporte606Module.jsx) (`/reporte-606`), [Reporte607Module.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/admin/Reporte607Module.jsx) (`/reporte-607`), [ReporteIT1Module.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/admin/ReporteIT1Module.jsx) (`/reporte-it1`), [DgiiSequencesModule.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/admin/DgiiSequencesModule.jsx) (`/secuencias-ncf`).
- **Backend**: [expenses.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/expenses.routes.js), [dgii_606.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/dgii_606.routes.js), [dgii.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/dgii.routes.js), [reports.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/reports.routes.js).
- **Tablas**: `expenses`, `dgii_606_purchases`, `dgii_ncf_sequences`, `visits`, `tenants`.
- **Reglas confirmadas**:
  - RBAC granular contable: `accounting.view`, `accounting.expenses.manage`, `accounting.expenses.pay` (pagos y préstamos), `accounting.expenses.void`, `accounting.purchases_606.manage`, `accounting.export`, `accounting.sequences.manage`, `accounting.it1.manage`.
  - Reportes 606 (TXT oficial pipe-delimited), 607 e IT-1 operan completamente con `DGII_MODE=disabled` sin emisión electrónica live.
  - Egresos anulados se excluyen automáticamente del resumen `totalAmount` y no pueden editarse ni anularse dos veces.

### B. Fallos Corregidos (`7689c87` / `547e1b5`)

- **M12-01 (`expenses.routes.js`)**: `PUT /api/expenses/:id` permitía mutar egresos anulados, aceptar `status: 'Anulado'` saltándose `accounting.expenses.void` y aceptar montos ≤ 0; `PUT`/`DELETE` devolvían `200` en IDs inexistentes/ajenos y `/void` permitía doble anulación → corregido (`400 USE_VOID_ENDPOINT`, `409 EXPENSE_VOIDED`, `409 ALREADY_VOIDED`, `404` explícito).
- **M12-02 (`dgii_606.routes.js`)**: `POST`/`PUT`/`DELETE /api/dgii/report-606` aceptaban montos negativos, fallaban con `500` PostgreSQL en IDs no enteros y devolvían `200` ante registros inexistentes/ajenos → corregido (`400` montos negativos, `404` IDs no enteros o ajenos).

### C. Evidencia de Aceptación (`7689c87` / `547e1b5` — APROBADO)

| Caso | Esperado | Observado | Evidencia | Resultado |
|---|---|---|---|---|
| **M12-C1** | Egresos CRUD, rechazo `amount <= 0` (`400`), bloqueo bypass `PUT status='Anulado'` (`400 USE_VOID_ENDPOINT`), doble `/void` (`409`), edición post-anulación (`409`) y exclusión de `totalAmount` | Todos los códigos exactos; `totalAmount = 0`, `voidedCount = 1` | `test_module12_accounting_reports_acceptance.cjs` | **PASS** |
| **M12-C2** | Compras 606 CRUD, rechazo montos negativos (`400`), IDs no enteros (`404`), totales ITBIS y exportación TXT oficial (`606\|RNC\|PERIODO\|N`) | Totales exactos (`1800`) y encabezado `606\|131000123\|202611\|1` | `test_module12_accounting_reports_acceptance.cjs` | **PASS** |
| **M12-C3** | Reportes 607 (`/api/dgii/report-607`) e IT-1 (`/api/dgii/it1`) con factura convencional `B02` y `DGII_MODE=disabled` | Ambos responden `200` con agregación correcta sin DGII live | `test_module12_accounting_reports_acceptance.cjs` | **PASS** |
| **M12-C4** | RBAC granular contable (`view` vs `expenses.manage` vs `expenses.pay` vs `expenses.void` vs `export`) + suite 10/10 RBAC Contabilidad | Todos los `403`/`200` exactos; `test_rbac_accounting_and_role_templates.cjs` 10/10 PASS | `test_module12_accounting_reports_acceptance.cjs` + `test_rbac_accounting_and_role_templates.cjs` | **PASS** |
| **M12-C5** | Aislamiento multi-tenant: Empresa B recibe `0` filas y `404` en `PUT`/`DELETE` cruzados de egresos y 606 | `0` filas y `404` exactos | `test_module12_accounting_reports_acceptance.cjs` | **PASS** |
| **M12-DOM** | Flujo real Chromium en `/egresos`, `/reporte-606`, `/reporte-607`, `/reporte-it1` y `/secuencias-ncf` | Las 5 rutas renderizan limpias: `pageErrors=0`, `serverErrors=0`, `0` ErrorBoundary | Chromium DOM (`salonpro-app:7689c87`) | **PASS** |

- **Gates y Despliegue**: `test:scanner` (0 violaciones), `test:runner-guards` (PASS), `lint`, `build`, `verify:release`, `graphify update .`, `test_blocks_1_to_8_regression.cjs` (PASS), limpieza de `salon_saas_test`, respaldo previo de `salon_saas_staging` y despliegue verificado de `salonpro-app:7689c87` (`Up (healthy)`, `/api/health` → `200`). **Estado: APROBADO**.

---

## Módulo 13 — Membresías (Add-on US$99/bloque 3 sucursales)

- **Versión / Commit**: `8b0452c` (imagen `salonpro-app:8b0452c`).
- **Hallazgos corregidos**:
  - `M13-01` ([visits.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/visits.routes.js)): En `POST /api/visits/:id/checkout`, el descuento de lavados Plan Beauty ahora valida atómicamente con `FOR UPDATE` que la clienta tenga contrato activo con cupo disponible (`available >= washesToDeduct`); cuando los lavados disponibles son `0` o no existe contrato activo, hace `ROLLBACK` y rechaza con `409 PLAN_WASH_QUOTA_EXHAUSTED` (nunca permite colar lavado gratis `RD$0` sin cupo).
  - `M13-02` ([payments.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/payments.routes.js)): Validación estricta de monto finito `> 0` (`400 INVALID_AMOUNT`) en todos los endpoints de pago y verificación de pertenencia de `clientId` al tenant autenticado (`404 CLIENT_NOT_FOUND`) en `/verify-token` y `/charge-saved-card`.
  - `M13-03` ([contracts.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/contracts.routes.js)): Validación de valores numéricos `>= 0` para `wash_Quota`, `washes_used` y `precio_mensual` (`400 INVALID_CONTRACT_VALUES`) en `POST` y `PUT`.
  - `M13-04` ([plans.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/plans.routes.js)): Validación de nombre no vacío y precio finito `>= 0` (`400 INVALID_PLAN_PAYLOAD`) en `POST /api/plans`.

| Caso | Esperado | Observado | Evidencia | Resultado |
|---|---|---|---|---|
| **M13-C1** | Add-on no contratado bloquea `/plans`, `/contracts`, `/payments` (`403 FEATURE_NOT_INCLUDED`) incluso si RBAC concede `memberships.*` | `403 FEATURE_NOT_INCLUDED` en las 3 rutas | `test_module13_memberships_acceptance.cjs` | **PASS** |
| **M13-C2** | Activación de 1 bloque (`acquiredBlocks=1`, capacidad `3`) en `branchA1` permite `branchA1`, bloquea `branchA2` y `tenantB` | `200` en `branchA1`, `403` en `branchA2` y `tenantB`; sincronización PG completa | `test_module13_memberships_acceptance.cjs` + `test_memberships_addon_sync_pg.cjs` | **PASS** |
| **M13-C3** | Validaciones de payloads inválidos (precio negativo, cuota negativa, monto `0`) rechazadas con `400` | Todos los `400` exactos | `test_module13_memberships_acceptance.cjs` | **PASS** |
| **M13-C4** | Aislamiento cross-tenant: `clientB` rechazado (`404`) en contratos y pagos (`/verify-token`, `/charge-saved-card`) | `404` exacto en todos los casos cruzados | `test_module13_memberships_acceptance.cjs` | **PASS** |
| **M13-C5** | Cupo Plan Beauty (4 lavados/ciclo): 4to lavado descuenta (`3→4`), 5to lavado con `0` disponibles rechazado con `409 PLAN_WASH_QUOTA_EXHAUSTED`, renovación manual resetea `washes_used=0` | `200` (4to), `409` (5to), `washes_used=0` tras renovación | `test_module13_memberships_acceptance.cjs` | **PASS** |
| **M13-DOM** | Flujo real Chromium en `/planes` y `/pagos` con badge `PLAN PRINCIPAL + MEMBRESÍAS` | `pageErrors=0`, `serverErrors=0`, `0` ErrorBoundary | Chromium DOM (`salonpro-app:8b0452c`) | **PASS** |

- **Estado: APROBADO**.

---

## Módulo 14 — Suscripción SaaS y Pagos

- **Versión / Commit**: `8b0452c` (`f32054b` tests, imagen `salonpro-app:8b0452c`).
- **Reglas verificadas**: Guard exclusivo de Owner (`OWNER_ONLY_SAAS_BILLING`), prorrateo y conversión FX entera, contratación de sucursales/asientos/bloques sin cargos CardNet reales, `SAAS_RENEWAL_WORKER_ENABLED` deshabilitado (`workerEnabled=false`), y consentimiento explícito requerido para renovación automática.

| Caso | Esperado | Observado | Evidencia | Resultado |
|---|---|---|---|---|
| **M14-C1** | Roles no-owner (`recepcion`, `gerente`, `admin`, `cajero`) bloqueados en `/api/saas/billing/*` con `403 OWNER_ONLY_SAAS_BILLING` | `403 OWNER_ONLY_SAAS_BILLING` para los 4 roles | `test_module14_saas_billing_acceptance.cjs` | **PASS** |
| **M14-C2** | Owner consulta `/subscription` con plan `PRINCIPAL` activo, pricing vigente y lista de sucursales | `200` con `plan_code='PRINCIPAL'` y sucursal activa | `test_module14_saas_billing_acceptance.cjs` | **PASS** |
| **M14-C3** | `/renewal/quote` retorna cotización consolidada DOP con `workerEnabled=false` y estado `missing_consent` | `200`, `workerEnabled=false`, `effectiveStatus='missing_consent'` | `test_module14_saas_billing_acceptance.cjs` | **PASS** |
| **M14-C4** | `POST /renewal/authorize` sin consentimiento expreso rechazado con `400 RECURRING_CONSENT_REQUIRED` | `400 RECURRING_CONSENT_REQUIRED` | `test_module14_saas_billing_acceptance.cjs` | **PASS** |
| **M14-C5** | Contratación de sucursales, prorrateo, método guardado, declinado, doble-clic idempotente y entitlements 28/28 | 9/9 branch contracting + 28/28 entitlements PASS | `test_saas_branch_contracting.cjs` + `test_phase2a_entitlements_unit.cjs` | **PASS** |
| **M14-DOM** | Flujo real Chromium en `/suscripcion` como Owner | `pageErrors=0`, `serverErrors=0`, `0` ErrorBoundary | Chromium DOM (`salonpro-app:8b0452c`) | **PASS** |

- **Estado: APROBADO**.

---

## Módulo 15 — SuperAdmin (Control Plane)

- **Versión / Commit**: `8b0452c` (`c6899a5` tests, imagen `salonpro-app:8b0452c`).
- **Hallazgo corregido**:
  - `M15-01` ([saas.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/saas.routes.js)): En `GET /api/saas/metrics`, el cálculo de MRR del add-on Membresías multiplicaba `US$99 × sucursales habilitadas` en lugar de `US$99 × bloques adquiridos (hasta 3 sucursales/bloque)`. Corregido para usar `acquiredBlocks = Math.ceil(enabledBranchCount / 3)`.

| Caso | Esperado | Observado | Evidencia | Resultado |
|---|---|---|---|---|
| **M15-C1** | Usuario tenant (`propietario`) bloqueado (`403`) en `/api/saas/metrics` y `/api/saas/tenants` | `403` en ambos endpoints | `test_module15_superadmin_acceptance.cjs` | **PASS** |
| **M15-C2** | Rol `superadmin` bloqueado (`403`) en rutas operativas de tenant vía `rejectControlPlaneRoleOnTenantRoutes` | `403` exacto | `test_module15_superadmin_acceptance.cjs` | **PASS** |
| **M15-C3** | `/api/saas/metrics` suma exactamente `+US$99` al MRR al habilitar 2 sucursales en 1 bloque de Membresías, y `/api/saas/tenants` refleja el estado enriquecido | Delta MRR exacto `+$99.00 USD`, `has_memberships=true`, `enabledBranchCount=2` | `test_module15_superadmin_acceptance.cjs` | **PASS** |
| **M15-DOM** | Flujo real Chromium en `/saas` (`ETEREAS CONTROL PLANE`) con login real SuperAdmin | `pageErrors=0`, `serverErrors=0`, `0` ErrorBoundary (`len=3881`) | Chromium DOM (`salonpro-app:8b0452c`) | **PASS** |

- **Estado: APROBADO**.

---

## Módulo 16 — Respaldo, Recuperación y Despliegue

- **Versión / Commit**: `8b0452c` (imagen `salonpro-app:8b0452c` desplegada en staging).
- **Alcance verificado**: Integridad y paridad de esquema (fresh vs upgrade vs public), simulacro real de respaldo y restauración (`pg_dump` + `psql -v ON_ERROR_STOP=1` en BD desechable `salon_saas_restore_check`), salud de contenedores y banderas de seguridad, sin tocar `salon_saas_prod`.

| Caso | Esperado | Observado | Evidencia | Resultado |
|---|---|---|---|---|
| **M16-C1** | Gate de paridad de esquema: 30/30 migraciones SHA-256 válidas, rechazo fail-closed de alteración histórica, backfills seguros y 0 deriva entre `fresh`, `upgrade` y `public` | `30/30` migraciones válidas, `117` tablas, `1618` columnas, `176` FKs, **0 deriva** | `backend/scripts/verify_schema_parity.cjs` | **PASS** |
| **M16-C2** | Simulacro real de respaldo y restauración en BD temporal desechable (`salon_saas_restore_check`) con `ON_ERROR_STOP=1` | Dump `1,024,852 bytes`, restauración limpia sin errores (`src=117` tablas → `dst=117` tablas), BD temporal eliminada | `pg_dump` / `psql` en `salonpro_db` | **PASS** |
| **M16-C3** | Salud de infraestructura y banderas de seguridad en staging | `salonpro_app` (`8b0452c`), `salonpro_caddy` (`2.11.9`), `salonpro_db` (`17.11`), `compreface_*` todos `Up (healthy)`; `DGII_MODE=disabled`, `WORKER_ENABLED=false`; `salon_saas_prod` intacto | `docker ps`, `/opt/salonpro/secrets/staging.env`, `/api/health` (`200`) | **PASS** |
| **M16-C4** | Respaldo previo de `salon_saas_staging` y despliegue verificado del release final `salonpro-app:8b0452c` | Backup `/opt/salonpro/backups/salon_saas_staging_pre_8b0452c_20261123_001301.sql.gz` (`87,791 bytes`), `salonpro_app` en `salonpro-app:8b0452c` (`Up (healthy)`, `HEALTH 200`) | `staging-salon` deploy log | **PASS** |

- **Estado: APROBADO**.

---

## Revisión de Alcance y Veredicto Final sobre Candidato `db69d1c`

### Hallazgos adicionales corregidos durante el endurecimiento final
- **`M13-05` ([plans.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/plans.routes.js), commit `db69d1c`)**: Detectado al ejecutar interacción DOM real en `/planes`. `PlansModule.jsx` (`dataService.savePlans`) envía `{ plans, applyToExisting }` a `POST /api/plans`, pero el endpoint exigía un arreglo plano y devolvía `400`. Corregido para soportar ambos formatos respetando `applyToExisting` y validando `title`/`name` + `price >= 0`. Verificado en DOM real (editar plan → `"Guardar y Sincronizar Plan"` → `POST /api/plans 200` → recarga → persistencia visible confirmada) y en `test_module13_memberships_acceptance.cjs` (`5/5 PASS` sobre `db69d1c`).
- **`M15-01` reforzado ([saas.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/saas.routes.js), commit `2ba1c99` / `db69d1c`)**: `GET /api/saas/metrics` factura el MRR de Membresías tomando los **bloques contratados vigentes** (`Math.max(acquiredBlocks, tenant_subscriptions.addon_blocks_count)`), nunca infiriendo únicamente por `ceil(sucursales_habilitadas / 3)`. Probado en `test_module15_superadmin_acceptance.cjs` sobre `db69d1c`: 2 bloques contratados con 2 sucursales asignadas suman `+$198.00 USD`, y reducir la asignación a 1 sucursal conserva los 2 bloques contratados y el MRR en `+$198.00 USD`.

### Verificación de Restauración Profunda (Módulo 16 en `2ba1c99` / `db69d1c`)
- **Conteos, valores e integridad de datos**: Restauración de `salon_saas_test` → `salon_saas_restore_check` con `ON_ERROR_STOP=1`. Coincidencia exacta de filas en 10 tablas críticas (`tenants=13`, `users=7`, `branches=9`, `clients=4`, `services=11`, `visits=0`, `contracts=0`, `payments=0`, `private_files=5`, `schema_migrations=30`) y verificación de valor exacto de fila (`business_name='M16 Restore Check'`).
- **Archivos privados y descifrado con claves recuperadas**: 4 artefactos cifrados con AES-256-GCM (`staff_reference_photo`, `tenant_logo`, `contract_signature`, `contract_document`) respaldados en `.tar.gz`, restaurados en ruta aislada y descifrados vía `PrivateStorageAdapter.readFile` usando `STORAGE_ENCRYPTION_KEY`: **4/4 SHA-256 byte-a-byte idénticos**, y rechazo fail-closed comprobado al intentar descifrar con clave incorrecta (`wrongKeyRejected=true`).
- **CompreFace persistente**: `pg_dump` de solo lectura sobre `compreface_postgres_db` (volumen `compreface_postgres_data`): `407,528 bytes` comprimidos, `16` tablas y `22` subjects persistidos.
- **Copia recuperable fuera de la VPS (BRECHA OPERATIVA REAL)**: Inspección en `staging-salon` confirmó `NO_ROOT_CRONTAB`, ausencia de herramientas off-site (`rclone`/`aws`/`s3cmd`/`restic`/`borg`) y que `/opt/salonpro/daily_backup.sh` es un script legacy de MySQL no programado. Todos los dumps actuales (`/opt/salonpro/backups/`) residen **únicamente en la misma VPS**.

### Separación CardNet y Estado Efectivo de Variables (`salonpro-app:db69d1c`)
- **CardNet — Probado con adaptador/simulado**: Flujos de prorrateo, órdenes, método guardado, declinado, doble clic idempotente y bloqueo Owner-only (`test_saas_branch_contracting.cjs` 9/9 + `test_module14_saas_billing_acceptance.cjs` 4/4 sobre `db69d1c`).
- **CardNet — Validado con proveedor real**: **PENDIENTE** (requiere credenciales live/homologación, validación de tokenización/recurrencia en ambiente CardNet y autorización explícita del operador antes de habilitar cobros).
- **Verificación efectiva en contenedor `salonpro_app` (`salonpro-app:db69d1c`, `Up (healthy)`, `HEALTH 200`)**:
  - `SAAS_RENEWAL_WORKER_ENABLED`: `<UNSET>` → `ConsolidatedRenewalService.isWorkerEnabled() === false`.
  - `DGII_MODE`: `'disabled'`, `DGII_ENABLED`: `<UNSET>` (emisión electrónica DGII fuera del lanzamiento).
  - Respaldo previo a despliegue staging: `/opt/salonpro/backups/salon_saas_staging_pre_db69d1c_20261123_002932.sql.gz` (`87,785 bytes`). `salon_saas_prod` intacto.

### Veredicto Final Honesto (Release `db69d1c`)
- **Alcance aprobado en código/staging**: **15 módulos aprobados** (M1–M15, con M14 aprobado en modo adaptador/simulado) + **Módulo 16 aprobado con condición operativa**.
- **Pendientes reales antes de go-live en producción**:
  1. **M16 (Operativo / Bloqueante para DR en producción)**: Configurar respaldo automatizado **fuera de la VPS (off-site)** para PostgreSQL (`salon_saas_prod`), volumen de storage cifrado (`salonpro_storage_*`), `compreface_postgres_data` y custodia externa segura de `STORAGE_ENCRYPTION_KEY`.
  2. **M14 (Externo CardNet)**: Credenciales y homologación con proveedor CardNet real + autorización explícita del operador para activar `SAAS_RENEWAL_WORKER_ENABLED`.
  3. **M3-C7 (Operador / Hardware)**: Prueba física guiada de cámara en tablet/PC real.
  4. **M4 (Decisión de negocio)**: Política definitiva para servicios sin regla de comisión (actualmente fallback temporal visible `15%`).
  5. **Fuera de alcance del lanzamiento**: Emisión electrónica DGII (`DGII_MODE=disabled`).
