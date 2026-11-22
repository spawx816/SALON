# Plan Maestro y Registro de Aceptación por Módulos — Etereas

Documento único y autoritativo de validación sistemática de Etereas por módulos y procesos de negocio.

- **Release candidato actual**: commit `1dcaa41` / imagen `salonpro-app:1dcaa41` (staging).
- **Base de pruebas automatizadas**: `salon_saas_test` (PostgreSQL 17, aislada con guardas canónicas).
- **Entorno de producción**: intacto (`salon_saas_prod` sin escrituras, sin cargos CardNet reales, `SAAS_RECURRING_WORKER_ENABLED=false`, `DGII_ELECTRONIC_TRANSMISSION_ENABLED=false`).

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
| **1** | **Empresa y personalización** (`identidad → logo → colores → guardado → recarga → nueva sesión → sidebar → ticket/factura`) | Auth/Sesión, Storage (`private_files`), POS/Tickets/Facturas | `1dcaa41` (en validación) | `test_branding_sidebar_and_single_session_e2e.cjs` | `en curso` | 3 hallazgos detectados en análisis estático (`M1-01` reset logo en `tenants`, `M1-02` header/footer en factura impresa, `M1-03` auditoría + guardia doble clic) |
| **2** | Usuarios, roles y licencias | Módulo 1, Auth, RBAC, SaaS Limits | — | `test_rbac_accounting_and_role_templates.cjs`, `test_rbac_closure_matrix.cjs` | `pendiente` | — |
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

### C. Fallos Identificados y Correcciones (En Curso)

- **M1-01**: `POST /api/tenant/branding/reset` borraba `tenant_branding` pero dejaba `tenants.logo_url`, `primary_color`, `secondary_color` y `receipt_footer` con los valores previos, haciendo que el logo reapareciera tras recarga por el fallback de `GET /api/tenant/branding`. **Corrección**: limpiar también dichos campos en `tenants` dentro de `POST /api/tenant/branding/reset`.
- **M1-02**: `ElectronicInvoicePrintModal.jsx` ignoraba `branding.receipt_header` y `branding.receipt_footer`. **Corrección**: renderizar ambos cuando estén configurados en la empresa.
- **M1-03**: Faltaban registros de auditoría en `audit_logs` al actualizar/restablecer branding y guardia síncrono anti-doble clic en `TenantCustomizationModule.jsx`. **Corrección**: registrar `UPDATE_TENANT_BRANDING` / `RESET_TENANT_BRANDING` en `audit_logs` y añadir `submitInFlightRef` en `TenantCustomizationModule.jsx`.
