# Plan Maestro y Registro de Aceptación por Módulos — Etereas

Documento único y autoritativo de validación sistemática de Etereas por módulos y procesos de negocio.

- **Release candidato actual**: commit `b9ec72e` / imagen `salonpro-app:b9ec72e` (staging).
- **Base de pruebas automatizadas**: `salon_saas_test` (PostgreSQL 17, aislada con guardas canónicas).
- **Entorno de producción**: intacto (`salon_saas_prod` sin escrituras, sin cargos CardNet reales, `SAAS_RENEWAL_WORKER_ENABLED` deshabilitado, `DGII_MODE=disabled` / `DGII_ENABLED` deshabilitado).

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
| **2** | **Usuarios, roles y licencias** (`usuario operativo → roles/plantillas → asientos 3×sucursal → kiosco exento → concurrencia → último Owner → sesión única`) | Módulo 1, Auth, RBAC, SaaS Limits | `9111f42` | `test_rbac_accounting_and_role_templates.cjs`, `test_rbac_closure_matrix.cjs` + suite aceptación M2 (`M2-C1`–`M2-C11`) | **`aprobado`** | Ninguno (`0` defectos de código; 11/11 casos DOM + PG aprobados) |
| **3** | **Personal, asistencia y kiosco** (`personal → horarios/novedades → kiosco → ponches/autoservicio → CompreFace real → aislamiento`) | Módulo 2, Sucursales, CompreFace (`compreface_api`) | `b9ec72e` | `test_kiosk_dedicated_user.cjs`, `test_kiosk_security_and_isolation.cjs`, `test_rbac_closure_matrix.cjs` + suite DOM M3 + CompreFace real (`M3-C1`–`M3-C6`) | **`aprobado`** | `M3-01`, `M3-02`, `M3-03` corregidos y desplegados en staging (`b9ec72e`). Pendiente solo verificación física de hardware de cámara (`M3-C7`, guía abajo). |
| **4** | **Categorías y esquemas de comisiones** (`categorías → esquemas → reglas → empleados → catálogo → POS → comisión → liquidación/nómina`) | Módulo 1, 2, 3, Catálogo, POS, Nómina | En validación | `test_blocks_1_to_8_regression.cjs` (B1/B2) | `en curso` | 4 hallazgos corregidos (`M4-01` anti doble pago entre `/payout` y nómina, `M4-02` `/payout` atómico `FOR UPDATE` + auditoría, `M4-03` vigencia `scheme_effective_date`, `M4-04` validación dependencias al borrar y reglas contradictorias); en validación DOM + PG |
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
