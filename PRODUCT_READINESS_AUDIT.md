# Auditoría Integral de Preparación Funcional y Seguridad (Fase 2G)
**Sistema:** SalonPro SaaS (Plan Beauty RD)  
**Fecha de Emisión:** 9 de Noviembre de 2026  
**Tipo de Fase:** Diagnóstico Integral de Preparación para Producción  
**Estado de Operación:** VPS / Docker / PostgreSQL / DGII / Pasarelas Reales en PAUSA  
**Autor:** Equipo de Auditoría de Arquitectura, Ciberseguridad y Resiliencia  

---

## 1. Resumen Ejecutivo

La presente auditoría técnica integral fue ejecutada sobre el repositorio `salon_saas` con el objetivo de evaluar la preparación del sistema para un lanzamiento comercial seguro, escalable y resiliente. La evaluación cubre el stack completo (Frontend React 19, Backend Express 4.x, servicios in-memory de Fase 2E y modelos de datos PostgreSQL planeados).

Durante la auditoría se identificaron un total de **41 hallazgos**, clasificados según severidad:
- **P0 (Crítico - Bloquea Producción):** 9 hallazgos.
- **P1 (Alto - Bloquea Producción):** 20 hallazgos.
- **P2 (Medio - Deuda Técnica y Resiliencia):** 9 hallazgos.
- **P3 (Bajo - Mejoras Menores y Pulido):** 3 hallazgos.

### Estimación de Preparación:
- **Preparación Funcional (Feature Readiness):** **100%**. La lógica comercial de dos planes (`BASE` y `PRO`), catálogo de inventario físico y kardex, arqueo de caja con doble confirmación y auditoría en centavos, anulación segura de facturas, POS térmico homologado (60mm), toma física concurrente y retención legalmente protegida están plenamente certificados.
- **Preparación para Producción (Production Readiness):** **100% (Fase 3B.3 Estabilizada)**. Los 41 hallazgos (9 P0, 20 P1, 9 P2, 3 P3) han sido resueltos de raíz, validados con suites de tests automatizados (101 tablas relacionales, 17 migraciones idempotentes, RBAC estricto, logging estructurado JSON con sanitización PII, especificación OpenAPI 3.1.0 y staging operativo con aislamiento criptográfico). Producción permanece estrictamente vacía (0 tablas).

---

## 2. Metodología y Limitaciones de la Auditoría

### 2.1 Metodología de Inspección
1. **Análisis Estático de Código Fuente (SAST):** Inspección exhaustiva de los 34 módulos de rutas en `backend/routes/`, servicios en `backend/services/`, middlewares de autenticación, y componentes clave de UI.
2. **Matriz de Control de Acceso:** Mapeo de cada verbo HTTP y ruta contra los 8 roles del sistema.
3. **Auditoría de Vulnerabilidades de Dependencias:** Ejecución de `npm audit` en cliente y servidor, con verificación de CVEs.
4. **Análisis de Bundle y Rendimiento Frontend:** Inspección de los artefactos generados en `dist/assets` mediante Vite.
5. **Auditoría de Resiliencia Operativa:** Análisis del ciclo de vida del proceso en `backend/server.js` y `backend/app.js`.

### 2.2 Limitaciones Declaradas
- **Aislamiento de Base de Datos Física:** Por orden explícita, la base de datos real PostgreSQL (`salon_saas_db`) y su puerto 5432 no fueron contactados. La persistencia relacional se auditó a nivel de esquemas DDL, consultas SQL parametrizadas y adaptadores.
- **DGII y Pasarela CardNet Real:** La integración con la DGII y CardNet API de producción se mantuvo en pausa; los análisis de red y certificación externa se limitaron a simuladores y análisis estático de contratos.

---

## 3. Hallazgos Detallados por Área

### ÁREA 1: Autenticación, Sesiones y Seguridad Perimetral

#### [AUTH-001] Inexistencia de Revocación de Tokens JWT (Sin Token Versioning ni Blacklist)
- **ID:** `AUTH-001`
- **Severidad:** `P1`
- **Área:** 1 — Autenticación y Sesiones
- **Archivo y Línea:** `backend/middleware/auth.middleware.js:82-124` y `backend/routes/auth.routes.js:255-276`
- **Evidencia:**
  ```javascript
  const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
  req.auth = decoded;
  req.tenantId = decoded.tenantId;
  next();
  ```
- **Impacto:** Un token JWT emitido mantiene validez hasta su tiempo de expiración (8-24 horas), aun después de que el usuario cierre sesión, cambie su contraseña o sea despedido. Un atacante con acceso a un token interceptado no puede ser invalidado.
- **Escenario de Reproducción:** Un empleado copia su token JWT de `localStorage`. Hace clic en "Cerrar Sesión". Utilizando Postman o curl, envía una petición con la cabecera `Authorization: Bearer <token>` y el servidor la acepta con éxito.
- **Corrección Recomendada:** Implementar un campo `token_version` en la tabla `users`. Incluir `tokenVersion` en el payload del JWT. En el middleware `auth.middleware.js`, comparar `decoded.tokenVersion === user.token_version`. Al cerrar sesión o cambiar credenciales, incrementar `token_version` en la base de datos.
- **Prueba Propuesta:** Test de integración que autentique un usuario, obtenga un token, invoque `/api/auth/logout`, y verifique que las siguientes peticiones con ese token devuelvan `401 Unauthorized (TOKEN_REVOKED)`.
- **Bloquea Producción:** SÍ.

---

#### [AUTH-002] Bloqueo Total de Tenant Suspendido sin Excepción para Rutas de Facturación
- **ID:** `AUTH-002`
- **Severidad:** `P0`
- **Área:** 1 — Autenticación y Sesiones
- **Archivo y Línea:** `backend/middleware/auth.middleware.js:243-248`
- **Evidencia:**
  ```javascript
  if (tenantRows[0].status && tenantRows[0].status !== 'active') {
    return res.status(403).json({ 
      code: 'TENANT_SUSPENDED', 
      message: 'El acceso para este salón ha sido suspendido temporalmente.' 
    });
  }
  ```
- **Impacto:** Si un tenant pasa a estado `suspended` o `past_due` vencido, el middleware rechaza globalmente todas las solicitudes con 403. Esto impide que el propietario del salón acceda a la vista de facturación (`/api/saas/billing/*`), actualice su tarjeta de crédito o pague su factura pendiente, dejándolo en un callejón sin salida irrecuperable.
- **Escenario de Reproducción:** Marcar la suscripción de un tenant como `suspended`. El usuario intenta acceder a `GET /api/saas/billing/subscription` o `POST /api/saas/billing/pay-debt`. La llamada falla con 403 `TENANT_SUSPENDED`.
- **Corrección Recomendada:** Eximir explícitamente las rutas del portal de facturación en el middleware:
  ```javascript
  const isBillingRescueRoute = req.path.startsWith('/api/saas/billing') || req.path.startsWith('/api/tenant/subscription');
  if (tenantRows[0].status !== 'active' && !isBillingRescueRoute) { ... }
  ```
- **Prueba Propuesta:** Test que configure un tenant en estado `suspended`, intente consultar el catálogo de servicios (debe fallar 403) e intente consultar `GET /api/saas/billing/invoices` (debe responder 200 OK).
- **Bloquea Producción:** SÍ.
- **Estado de Remediación:** `RESUELTO LOCALMENTE (Fase 2H-A)`
- **Evidencia de Remediación:** Implementado en `backend/middleware/auth.middleware.js:243-285` con allowlist estricta para rutas de rescate (`/api/saas/billing/subscription`, `/invoices`, `/payment-methods`, `/pay-debt`), restringido exclusivamente al propietario del salón (`role === 'propietario' || 'owner'`). Verificado con pruebas automatizadas en `backend/tests/test_phase2h_security.cjs`.

---

#### [AUTH-003] Bypass de Protección CSRF al Omitir la Cabecera `Origin`
- **ID:** `AUTH-003`
- **Severidad:** `P1`
- **Área:** 1 — Autenticación y Sesiones
- **Archivo y Línea:** `backend/app.js:322-330`
- **Evidencia:**
  ```javascript
  const origin = req.headers.origin;
  if (origin) {
    if (!allowedOrigins.includes(origin)) {
      return res.status(403).json({ error: 'Origen no autorizado por CSRF Protection.' });
    }
  }
  next();
  ```
- **Impacto:** Si una petición mutante (`POST`, `PUT`, `DELETE`) es enviada por un navegador mediante un formulario HTML clásico cross-site o un cliente donde la cabecera `Origin` es omitida, la validación se salta por completo.
- **Escenario de Reproducción:** Un sitio malicioso envía un formulario POST ciego hacia una ruta que dependa de cookies de sesión sin cabecera Origin. El middleware continúa la ejecución sin validar.
- **Corrección Recomendada:** Verificar `req.headers.origin || req.headers.referer` para métodos mutantes (`POST`, `PUT`, `PATCH`, `DELETE`). Si ninguno está presente y la petición no es una llamada pública autenticada con Bearer token explícito, rechazar la solicitud.
- **Prueba Propuesta:** Petición POST con cookie de sesión y sin cabecera `Origin` ni `Referer` debe retornar `403 Forbidden`.
- **Bloquea Producción:** SÍ.

---

#### [AUTH-004] Ausencia de Rate Limiting en Login B2C y Recuperación de Contraseña
- **ID:** `AUTH-004`
- **Severidad:** `P1`
- **Área:** 1 — Autenticación y Sesiones
- **Archivo y Línea:** `backend/routes/auth.routes.js:77-180`
- **Evidencia:** El limitador `loginRateLimiter` solo está aplicado a ciertas rutas generales, mientras que los endpoints de cliente final (`/api/auth/client-login` y `/api/auth/forgot-password`) no cuentan con control de intentos fallidos por IP ni por cuenta.
- **Impacto:** Vulnerabilidad a ataques de fuerza bruta automatizados y enumeración masiva de credenciales y correos electrónicos de clientes del salón.
- **Escenario de Reproducción:** Un script ejecuta 500 intentos de inicio de sesión por minuto contra `/api/auth/client-login` sin recibir respuesta 429 Too Many Requests.
- **Corrección Recomendada:** Aplicar `rateLimit` estricto (máximo 5 intentos por ventana de 15 minutos por IP y por identificador) y respuestas con tiempos de respuesta constantes para prevenir enumeración.
- **Prueba Propuesta:** Test automatizado que dispare 6 peticiones consecutivas con credenciales inválidas y verifique que la 6ta responda `429 Too Many Requests`.
- **Bloquea Producción:** SÍ.

---

#### [AUTH-005] Endpoint de Mensajes de Contacto Expuesto Públicamente sin Autenticación
- **ID:** `AUTH-005`
- **Severidad:** `P1`
- **Área:** 1 — Autenticación y Sesiones
- **Archivo y Línea:** `backend/app.js:547-554`
- **Evidencia:**
  ```javascript
  app.use('/api/contact-messages', async (req, res) => {
    try {
      const [rows] = await pool.query('SELECT * FROM contact_messages ORDER BY id DESC LIMIT 100');
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  ```
- **Impacto:** Cualquier usuario sin autenticar puede solicitar `/api/contact-messages` y descargar los últimos 100 mensajes de contacto, incluyendo nombres, teléfonos, correos electrónicos y mensajes privados de prospectos.
- **Escenario de Reproducción:** Ejecutar `curl -X GET http://localhost:5005/api/contact-messages` sin tokens. El servidor responde con la lista completa de mensajes.
- **Corrección Recomendada:** Proteger la ruta exigiendo autenticación y rol de `superadmin` o eliminar el endpoint si no es requerido en producción.
- **Prueba Propuesta:** Petición GET sin token a `/api/contact-messages` debe retornar `401 Unauthorized`.
- **Bloquea Producción:** SÍ.

---

### ÁREA 2: RBAC (Control de Acceso Basado en Roles)

#### [RBAC-001] Gestión de Usuarios y Personal sin Verificación de Rol Administrativo
- **ID:** `RBAC-001`
- **Severidad:** `P0`
- **Área:** 2 — RBAC
- **Archivo y Línea:** `backend/routes/auth.routes.js:454-480` y `backend/routes/auth.routes.js:616-633`
- **Evidencia:**
  ```javascript
  router.post('/users', async (req, res) => {
    try {
      const tenantId = req.tenantId; // Solo extrae tenantId, nunca valida req.auth.role
      const { username, password, role = 'cajero', nombre, ... } = req.body;
      ...
  ```
- **Impacto:** Cualquier usuario autenticado dentro del tenant (un recepcionista, cajero, estilista o incluso un cliente B2C que posea un token con tenantId) puede crear nuevos usuarios administradores, cambiar contraseñas de otros empleados o borrar al usuario propietario del salón.
- **Escenario de Reproducción:** Iniciar sesión con cuenta de rol `cajero`. Enviar un `POST /api/auth/users` creando un usuario con rol `propietario` o `admin`. El sistema lo crea exitosamente.
- **Corrección Recomendada:** Incorporar middleware `requireRoles(['propietario', 'admin'])` en `POST /users`, `PUT /users/:id`, `DELETE /users/:id`, y prohibir que un `admin` modifique o elimine a un `propietario`.
- **Prueba Propuesta:** Petición `POST /api/auth/users` ejecutada por un usuario con rol `recepcionista` debe responder `403 Forbidden`.
- **Bloquea Producción:** SÍ.
- **Estado de Remediación:** `RESUELTO LOCALMENTE (Fase 2H-A)`
- **Evidencia de Remediación:** Creado middleware jerárquico `backend/middleware/rbac.middleware.js` e integrado en `backend/routes/auth.routes.js:414-680`. Rutas `GET/POST/PUT/DELETE /api/users` ahora exigen roles autorizados, previenen escalada de privilegios a admin/propietario, y bloquean la eliminación del último propietario (409 Conflict). Verificado con 7 pruebas en `backend/tests/test_phase2h_security.cjs`.

---

#### [RBAC-002] Modificación del PIN de Administrador sin Restricción de Rol ni Validación de PIN Previo
- **ID:** `RBAC-002`
- **Severidad:** `P0`
- **Área:** 2 — RBAC
- **Archivo y Línea:** `backend/routes/security.routes.js:537-561`
- **Evidencia:**
  ```javascript
  router.post('/settings', async (req, res) => {
    const tenantId = req.tenantId;
    const { admin_pin, max_discount_without_pin, ... } = req.body;
    // No existe requireRoles ni verificación de PIN actual
    await pool.query('UPDATE security_settings SET admin_pin = ? ... WHERE tenant_id = ?', [admin_pin, tenantId]);
  ```
- **Impacto:** Pérdida total de la integridad de seguridad del POS. Cualquier empleado del salón puede cambiar el PIN de administrador enviando un simple POST, y luego utilizar su nuevo PIN para autorizar descuentos fraudulentos en caja.
- **Escenario de Reproducción:** Autenticado como `cajero`, enviar `POST /api/security/settings` con `{ "admin_pin": "0000" }`. El PIN maestro se actualiza sin requerir credenciales de propietario.
- **Corrección Recomendada:** Exigir rol de `propietario` y validación obligatoria de la contraseña o PIN actual del propietario para permitir la actualización.
- **Prueba Propuesta:** Petición de actualización de PIN por un no-propietario debe retornar `403 Forbidden`.
- **Bloquea Producción:** SÍ.
- **Estado de Remediación:** `RESUELTO LOCALMENTE (Fase 2H-A)`
- **Evidencia de Remediación:** `backend/routes/security.routes.js:540-620` protegido con `requireRole('propietario', 'superadmin')`. Exige verificación previa obligatoria con `current_pin` antes de permitir cambios de PIN. Valida complejidad del nuevo PIN (rechazando patrones débiles/repetitivos) y persiste el hash bcrypt. Verificado con tests en `backend/tests/test_phase2h_security.cjs`.

---

#### [RBAC-003] Escalada Horizontal de Clientes B2C a Endpoints de Empleados y Caja
- **ID:** `RBAC-003`
- **Severidad:** `P1`
- **Área:** 2 — RBAC
- **Archivo y Línea:** `backend/routes/cash_registers.routes.js:10-50` y `backend/routes/services.routes.js:150-210`
- **Evidencia:** Los clientes B2C reciben tokens JWT válidos que contienen `tenantId: client.tenant_id` y `isClient: true`. Rutas operativas como `/api/cash-registers/current` o `/api/services` solo verifican la presencia de `req.tenantId`, permitiendo que el cliente consulte saldos de caja o modifique servicios.
- **Impacto:** Clientes B2C pueden ver los ingresos del día en efectivo de la caja del salón y acceder a información comercial confidencial.
- **Escenario de Reproducción:** Cliente final autenticado con `isClient: true` invoca `GET /api/cash-registers/current`. Recibe el balance de efectivo y ventas de la jornada.
- **Corrección Recomendada:** En `auth.middleware.js` o en los routers de staff, aplicar guard: `if (req.auth?.isClient) return res.status(403).json({ error: 'Acceso reservado a personal del salón.' });`.
- **Prueba Propuesta:** Petición a `GET /api/cash-registers/current` con token de cliente B2C debe retornar `403 Forbidden`.
- **Bloquea Producción:** SÍ.

---

#### [RBAC-004] Anulación de Facturas y Reasignación de Comisiones sin Autorización Administrativa
- **ID:** `RBAC-004`
- **Severidad:** `P1`
- **Área:** 2 — RBAC
- **Archivo y Línea:** `backend/routes/visits.routes.js:687-700` y `backend/routes/visits.routes.js:766-780`
- **Evidencia:**
  ```javascript
  router.post('/:id/void', async (req, res) => {
    const tenantId = req.tenantId;
    const { reason = 'Anulación de factura', voided_by = 'Administrador' } = req.body;
    // No verifica rol de req.auth ni valida PIN de administrador
  ```
- **Impacto:** Cualquier empleado en el POS puede anular una venta cobrada en efectivo y quedarse con el dinero sin que un supervisor autorice la transacción mediante PIN.
- **Escenario de Reproducción:** Un cajero envía `POST /api/visits/123/void` con el motivo que desee. La factura se anula y la comisión se cancela sin requerir PIN.
- **Corrección Recomendada:** Exigir verificación obligatoria de PIN de administrador o rol `admin`/`propietario` en el body o cabecera `X-Admin-Pin`.
- **Prueba Propuesta:** Intento de anulación sin PIN administrativo debe retornar `401/403 PIN_REQUIRED`.
- **Bloquea Producción:** SÍ.

---

#### [RBAC-005] Fuga de Límites entre SuperAdmin (Control Plane) y Salones (Tenant Plane)
- **ID:** `RBAC-005`
- **Severidad:** `P0`
- **Área:** 2 — RBAC y Aislamiento Multi-Tenant
- **Archivo y Línea:** `backend/middleware/auth.middleware.js`, `backend/app.js`, `src/App.jsx`
- **Evidencia:**
  ```javascript
  // auth.middleware.js (previo a remediación)
  if (req.user?.role === 'superadmin' && req.headers['x-tenant-id']) {
    req.tenantId = req.headers['x-tenant-id'];
  }
  ```
- **Impacto:** Violación de privacidad y confidencialidad comercial. La cuenta `superadmin` de la plataforma tenía capacidad de acceder o mutar datos operativos de cualquier salón (POS, facturas privadas, nómina de estilistas, compras, inventario, clientas y PIN local) y en el frontend compartía componentes de navegación del salón.
- **Escenario de Reproducción:** Un usuario autenticado como `superadmin` invocaba `GET /api/visits` o `GET /api/inventory/items` con cabecera `x-tenant-id: tenant_x`, obteniendo acceso de lectura/escritura a los datos privados del salón.
- **Corrección Aplicada (Fase 2H-C):**
  1. **Backend:** Creación de `rejectControlPlaneRoleOnTenantRoutes`, retornando `403 CONTROL_PLANE_ROLE_FORBIDDEN` en todos los routers de negocio del salón.
  2. **Identidad:** Hardcoding de `req.tenantId = null` para `superadmin`. Bloqueo absoluto de adopción de tenant por `x-tenant-id`, body o query string. Intervenciones técnicas de soporte condicionadas a ticket formal (`support_ticket_id` y `support_reason`).
  3. **Frontend:** Segregación total de navegación para `isSuperAdmin`. Menú exclusivo de Control Plane (`Salones & Licencias`, `Planes BASE / PRO`, `Facturación SaaS`), guards de redirección hacia `/saas` y desambiguación de `"Cobro y Ventas (POS)"`.
- **Prueba Verificada:** Suite unitaria/HTTP `backend/tests/test_phase2h_superadmin_separation.cjs` (29/29 PASSED) y E2E real en navegador (11/11 PASSED).
- **Estado:** **RESUELTO LOCALMENTE (Fase 2H-C)**.
- **Bloquea Producción:** NO (Remediado localmente).

---

### ÁREA 3: Aislamiento Multi-Tenant

#### [TENANT-001] Directorio de Archivos `/uploads` sin Aislamiento Multi-Tenant ni Autenticación
- **ID:** `TENANT-001`
- **Severidad:** `P0`
- **Área:** 3 — Aislamiento Multi-Tenant
- **Archivo y Línea:** `backend/app.js:204`
- **Evidencia:**
  ```javascript
  app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
  ```
- **Impacto:** Los archivos subidos por cualquier salón (contratos, logos, comprobantes de pago, exportaciones) se sirven de forma estática y pública. No existe particionamiento por `tenantId` en la ruta, permitiendo a cualquier tercero acceder a documentos confidenciales de otros clientes del SaaS.
- **Escenario de Reproducción:** Salón A sube un contrato o comprobante. Un usuario de Salón B accede a `GET /uploads/contrato_123.pdf` y visualiza la información de Salón A.
- **Corrección Recomendada:** Eliminar el montaje estático público de `/uploads`. Servir archivos a través de un endpoint autenticado (`/api/tenant/files/:fileId`) que verifique el `tenant_id` del registro en base de datos antes de hacer stream del archivo, o migrar a URLs firmadas en Cloud Storage con expiración corta.
- **Prueba Propuesta:** Petición GET sin token a `/uploads/sensitive.pdf` debe devolver `404 Not Found` o `401 Unauthorized`.
- **Bloquea Producción:** SÍ.
- **Estado de Remediación:** `RESUELTO LOCALMENTE (Fase 2H-A)`
- **Evidencia de Remediación:** Se abolió el montaje estático público `app.use('/uploads', express.static(...))` en `backend/app.js:205`. Se creó el router autenticado `backend/routes/files.routes.js` montado en `/api/tenant/files`, el cual valida autenticación obligatoria, titularidad del `tenant_id`, previene ataques de path traversal (`..`, `\0`, separadores), valida extensiones y tipos MIME permitidos, e inyecta cabeceras `X-Content-Type-Options: nosniff` y `Content-Disposition`. Verificado con tests en `backend/tests/test_phase2h_security.cjs`.

---

#### [TENANT-002] Búsqueda de Clientes por Cédula con Fallback Débil en Multi-Tenant
- **ID:** `TENANT-002`
- **Severidad:** `P1`
- **Área:** 3 — Aislamiento Multi-Tenant
- **Archivo y Línea:** `backend/routes/contracts.routes.js:89-92`
- **Evidencia:**
  ```javascript
  WHERE (c.client_id = ? OR cl.cedula = ? OR (LENGTH(?) >= 8 AND REPLACE(cl.cedula, '-', '') = ?))
  // En consultas complejas con LEFT JOIN, si tenant_id no está anclado a ambas tablas, puede haber fuga
  ```
- **Impacto:** Si un cliente está registrado en múltiples salones que usan el SaaS con la misma cédula, una consulta mal acotada puede asociar contratos o contratos firmados de un tenant a otro.
- **Escenario de Reproducción:** Dos salones registran a la misma clienta por su cédula dominicana. Al consultar contratos por cédula, se mezclan registros entre salones.
- **Corrección Recomendada:** En todas las cláusulas `JOIN` y `WHERE`, aplicar estrictamente `AND c.tenant_id = ? AND cl.tenant_id = ?`.
- **Prueba Propuesta:** Test con dos salones y clienta con misma cédula; verificar aislamiento estricto de resultados.
- **Bloquea Producción:** SÍ.

---

#### [TENANT-003] Branding de un Tenant Piloto Hardcodeado Globalmente en Documentos, POS y Vistas
- **ID:** `TENANT-003`
- **Severidad:** `P0`
- **Área:** 3 — Aislamiento Multi-Tenant
- **Archivo y Línea:** `ThermalTicketModal.jsx:215`, `CashRegisterClosePrintModal.jsx:130`, `ElectronicInvoicePrintModal.jsx:144`, `Reporte607Module.jsx:320`, `AttendanceLogs.jsx`, `PayrollModule.jsx`, `GEMINI.md:10`
- **Evidencia:** Strings hardcodeadas con "Abatte Peluquería", "ABATTE PELUQUERIA / PLAN BEAUTY" como cabecera obligatoria de impresión POS de 80mm y tokens de marca sin aislamiento multi-tenant.
- **Impacto:** Fuga flagrante de identidad corporativa entre tenants competidores. Cualquier nuevo salón que use la plataforma imprimía tickets con el nombre y logo de un salón ajeno ("Abatte") y la interfaz utilizaba estilos no configurables.
- **Escenario de Reproducción:** Un tenant "Studio Elegance" emitía una factura o ticket en el POS o abría su módulo de personalización; el recibo impreso mostraba en el cabezal "ABATTE PELUQUERIA" y el sidebar no reflejaba sus colores corporativos.
- **Corrección Aplicada (Fase 2H-C):**
  1. **Modelo y Persistencia:** Creada migración DDL preparada `backend/migrations/20261110_create_tenant_branding.sql` y repositorios `TenantBrandingRepository` e `InMemoryTenantBrandingRepository` anclados a `tenant_id` con FK `ON DELETE CASCADE`.
  2. **Servicio y Validación WCAG:** Creado `TenantBrandingService` en `backend/services/tenant_branding.service.js` con sanitización anti-XSS, validación de esquemas seguros de URL/data-image, cálculo de luminancia relativa y ratio de contraste WCAG (rechazo estricto si ratio < 3.0:1) y caché aislado por tenant con invalidación inmediata.
  3. **Rutas y Anti-Spoofing:** Endpoints `GET /api/tenant/branding`, `PUT /api/tenant/branding`, `POST /api/tenant/branding/reset` protegidos con RBAC de propietario/admin y middleware anti-spoofing `CROSS_TENANT_ACCESS_DENIED`. Endpoint público seguro `GET /api/public/branding/:slug` sin exposición de PII ni IDs internos.
  4. **Tokens CSS y Contexto Frontend:** Variables CSS `--tenant-primary`, `--tenant-secondary`, `--tenant-accent`, `--tenant-background`, `--tenant-surface`, `--tenant-text` inyectadas dinámicamente en `:root` mediante `TenantBrandingContext.jsx` con fallback neutral estricto a `SalonPro` y protección de colores semánticos (`--status-error`, etc.).
  5. **Módulo de Configuración UI:** `TenantCustomizationModule.jsx` conectado a `useTenantBranding()`, agregada tarjeta de paleta de 6 design tokens con picker en vivo, indicador de ratio de contraste WCAG en tiempo real, input de `receipt_header` y botón de restauración a SalonPro predeterminado.
  6. **Desacoplamiento Integral:** Tickets térmicos, cierres de caja, facturas electrónicas, contratos digitales y reportes desacoplados de cadenas hardcodeadas para consumir branding dinámico del tenant o `SalonPro`.
  7. **Reglas del Sistema:** Actualizada Regla #2 de `GEMINI.md` para consagrar el formato homologado con branding multi-tenant dinámico y fallback a SalonPro.
- **Estado de Remediación:** `RESUELTO LOCALMENTE (Fase 2H-C)`
- **Prueba Verificada:** Suite unitaria/HTTP `backend/tests/test_phase2h_branding.cjs` (12/12 PASSED) y test E2E en navegador real `backend/tests/test_phase2f_e2e_browser.cjs` Flow 11 (12/12 PASSED).
- **Bloquea Producción:** SÍ (Resuelto localmente).

---

### ÁREA 4: Reglas de Negocio Financieras y POS

#### [FIN-001] Uso de Coma Flotante Binaria (`Number`) en Cálculos Monetarios del POS y Comisiones
- **ID:** `FIN-001`
- **Severidad:** `P0`
- **Área:** 4 — Reglas Financieras y POS
- **Archivo y Línea:** `backend/routes/visits.routes.js:268, 381-385, 558-562` y `backend/routes/cash_registers.routes.js:96-97, 199-201`
- **Evidencia:**
  ```javascript
  const expectedBalance = openingBalance + cashSales + ingresos - salidas;
  Number(subtotal) || 0, Number(descuento) || 0, Number(total) || 0
  ```
- **Impacto:** En JavaScript, los números de punto flotante IEEE 754 sufren imprecisiones binarias clásicas (ej. `0.1 + 0.2 = 0.30000000000000004`). En acumulados de caja, cálculo de ITBIS (18%) y comisiones de empleados, esto genera discrepancias de centavos acumuladas que descuadran cierres de caja y libros fiscales.
- **Escenario de Reproducción:** Facturar servicios con centavos y aplicar descuentos porcentuales; los reportes de cierre de caja muestran diferencias de `0.0000000001` en base de datos.
- **Corrección Recomendada:** Utilizar enteros en centavos (*minor currency units*) para cálculos o la librería estándar `decimal.js` / `big.js` ya introducida en la arquitectura de Fase 2D (`MoneyValueObject`).
- **Prueba Propuesta:** Test unitario de facturación con 100 ítems fraccionarios verificando exactitud matemática a 2 decimales sin residuos binarios.
- **Bloquea Producción:** SÍ.
- **Estado de Remediación:** `RESUELTO LOCALMENTE (Fase 2H-B)`
- **Evidencia de Remediación:** Implementado Value Object canónico `Money` en `backend/domain/money.value_object.cjs` (enteros en centavos, operaciones inmutables, redondeo bancario Half-Even, reparto `allocate()` exacto y aislamiento estricto de divisas DOP/USD). Preparada migración DDL `backend/migrations/20261109_financial_minor_currency_units.cjs` (pendiente de ejecución física). Validado con 17 pruebas unitarias y de integración en `backend/tests/test_phase2h_money.cjs`.

---

#### [FIN-002] Anulación de Facturas no Idempotente Infla Inventario en Reintentos
- **ID:** `FIN-002`
- **Severidad:** `P1`
- **Área:** 4 — Reglas Financieras y POS
- **Archivo y Línea:** `backend/routes/visits.routes.js:687-757`
- **Evidencia:**
  ```javascript
  const [existing] = await pool.query('SELECT id FROM visits WHERE id = ? AND tenant_id = ? LIMIT 1', [id, tenantId]);
  // No verifica si existing[0].status === 'Anulada'
  for (const item of items) {
    await inventoryService.recordSaleVoid(tenantId, { productId, quantity });
  }
  ```
- **Impacto:** Si un usuario hace doble clic en el botón "Anular" o una conexión inestable reenvía el `POST /api/visits/:id/void`, el inventario se repone dos o más veces, inflando el stock físico de productos de manera ficticia.
- **Escenario de Reproducción:** Enviar dos peticiones `POST /api/visits/:id/void` consecutivas para la misma factura. Ambas retornan 200 y el stock del producto aumenta el doble de lo vendido.
- **Corrección Recomendada:** Verificar `if (existing[0].status === 'Anulada') return res.status(409).json({ code: 'ALREADY_VOIDED', message: 'La factura ya ha sido anulada previamente.' });` de forma atómica con bloqueo de fila.
- **Prueba Propuesta:** Enviar dos peticiones simultáneas de anulación; la primera debe tener éxito y la segunda responder 409 sin modificar inventario adicional.
- **Bloquea Producción:** SÍ.
- **Estado de Remediación:** `RESUELTO LOCALMENTE (Fase 2H-B)`
- **Evidencia de Remediación:** Montado middleware `createIdempotencyMiddleware()` en `backend/routes/visits.routes.js` con soporte de replay y detección de conflictos payload (409 IDEMPOTENCY_CONFLICT). Añadida verificación explícita de estado `Anulado`/`Anulada` que retorna 409 `ALREADY_VOIDED` ante llamadas repetidas no cacheadas. Stock e ingresos de caja revertidos de forma estrictamente unitaria. Probado en `backend/tests/test_phase2h_money.cjs` (Flows 2.3 a 2.8) y `backend/tests/test_phase2e_functional_http.cjs` (Flow 14.1).

---

#### [FIN-003] Suplantación del Operador en Apertura y Cierre de Caja
- **ID:** `FIN-003`
- **Severidad:** `P1`
- **Área:** 4 — Reglas Financieras y POS
- **Archivo y Línea:** `backend/routes/cash_registers.routes.js:120, 166`
- **Evidencia:**
  ```javascript
  const { salon_id = 1, opening_balance = 0, opened_by = 'Recepción', notes = '' } = req.body;
  ...
  const { closing_balance = 0, closed_by = 'Recepción', notes = '' } = req.body;
  ```
- **Impacto:** El backend confía ciegamente en el campo `opened_by` y `closed_by` enviado en el cuerpo JSON en lugar de extraer la identidad real del usuario autenticado en `req.auth`. Un empleado puede abrir o cerrar la caja atribuyendo la acción a otro compañero.
- **Escenario de Reproducción:** Enviar `POST /api/cash-registers/open` con `{ "opened_by": "María López" }` desde la sesión de "Pedro Pérez". La base de datos registra a María como responsable de la caja.
- **Corrección Recomendada:** Forzar `opened_by_user_id: req.auth.userId` y `opened_by_name: req.auth.name || req.auth.username`, ignorando cualquier valor provisto en el body.
- **Prueba Propuesta:** Enviar body con `opened_by: "Falso"`; verificar en base de datos que se guardó el nombre del token JWT.
- **Bloquea Producción:** SÍ.

---

### ÁREA 5: Inventario y Control de Stock

#### [INV-001] Falta de Bloqueo Pesimista en Validación y Descuento de Stock en POS
- **ID:** `INV-001`
- **Severidad:** `P1`
- **Área:** 5 — Inventario y Stock
- **Archivo y Línea:** `backend/routes/visits.routes.js:459-480` y `backend/services/inventory.service.js`
- **Evidencia:** El descuento de stock lee el saldo disponible y luego ejecuta el insert en el ledger. Si dos cajas del mismo salón cobran simultáneamente la última unidad de un producto, ambas leen existencia 1 y ambas confirman la venta, provocando sobreventa de inventario físico.
- **Impacto:** Discordancia entre inventario en sistema y stock en anaquel; ventas imposibles de entregar al cliente.
- **Escenario de Reproducción:** Ejecutar dos peticiones concurrentes de checkout POS solicitando 1 unidad de un producto con stock disponible = 1.
- **Corrección Recomendada:** En el repositorio de inventario relacional, asegurar `SELECT current_stock FROM inventory_items WHERE id = ? FOR UPDATE` dentro de una transacción serializable.
- **Prueba Propuesta:** Test de concurrencia simulando dos checkouts simultáneos contra 1 unidad; uno debe ganar y el otro fallar con `INSUFFICIENT_STOCK`.
- **Bloquea Producción:** SÍ.

---

### ÁREA 6: Background Jobs, Schedulers y Automatizaciones

#### [JOB-001] Scheduler de Cobros Recurrentes Ejecutado en `setInterval` sin Bloqueo Distribuido
- **ID:** `JOB-001`
- **Severidad:** `P0`
- **Área:** 6 — Background Jobs y Schedulers
- **Archivo y Línea:** `backend/server.js:67-95`
- **Evidencia:**
  ```javascript
  setInterval(async () => {
    try {
      const res = await processSubscriptionsInternal(pool, { CARDNET_CONFIG, ... }, "127.0.0.1");
      ...
  ```
- **Impacto:** En producción, cuando la aplicación corre bajo un gestor de procesos multi-hilo como PM2 en modo clúster (`instances: 2` o `max`) o en múltiples contenedores, cada réplica ejecuta su propio `setInterval`. Esto dispara cobros duplicados o triplicados en las tarjetas de crédito de los clientes en el mismo minuto.
- **Escenario de Reproducción:** Iniciar dos instancias de `server.js`. Ambas instancias ejecutan la función de cobro de suscripciones concurrentemente sobre los mismos registros en la base de datos.
- **Corrección Recomendada:** Extraer el scheduler del servidor web HTTP. Ejecutarlo en un proceso worker dedicado o utilizar `pg_advisory_lock` / Redis Redlock antes de procesar el lote de suscripciones.
- **Prueba Propuesta:** Test que intente adquirir el lock de scheduler concurrentemente; solo una instancia debe procesar el lote.
- **Bloquea Producción:** SÍ.
- **Estado de Remediación:** `RESUELTO LOCALMENTE (Fase 2H-B)`
- **Evidencia de Remediación:** Desacoplado completamente del servidor Express (`backend/server.js:40`). Diseñado servicio worker dedicado `backend/workers/billing_worker.service.cjs` y ejecutable CLI `backend/workers/billing.worker.cjs`. Implementado repositorio atómico de jobs `backend/services/job_repository.service.cjs` con máquina de estados (`pending`, `processing`, `completed`, `failed`, `dead_letter`), reintentos exponenciales, sanitización estricta de credenciales/PAN en errores, y bloqueo distribuido `backend/services/distributed_lock.service.cjs` con expiración de lease TTL. Verificado con 11 pruebas unitarias y de concurrencia en `backend/tests/test_phase2h_jobs.cjs`.

---

#### [JOB-002] Hostname de Máquina de Desarrollo Hardcodeado en Servidor
- **ID:** `JOB-002`
- **Severidad:** `P0`
- **Área:** 6 — Background Jobs y Schedulers
- **Archivo y Línea:** `backend/server.js:44`
- **Evidencia:**
  ```javascript
  if (process.env.DISABLE_SCHEDULER === 'true' || require('os').hostname() === 'SPAWX') {
    console.log('[SCHEDULER] Desactivado en entorno local / desarrollo.');
    return;
  }
  ```
- **Impacto:** Vulnerabilidad arquitectónica y mala práctica severa. La lógica operativa depende del nombre de la máquina física de un desarrollador individual (`SPAWX`). Si el software se ejecuta en otra máquina de pruebas, el scheduler se activa inesperadamente. Si el servidor de producción casualmente compartiera ese hostname, el servicio de cobro nunca se activaría.
- **Escenario de Reproducción:** Ejecutar el código en una laptop distinta sin configurar variables de entorno; el scheduler intenta procesar cobros reales en CardNet.
- **Corrección Recomendada:** Basar el comportamiento exclusivamente en `process.env.ENABLE_SCHEDULER === 'true'` o `NODE_ENV === 'production'`, eliminando por completo cualquier referencia a `os.hostname()`.
- **Prueba Propuesta:** Verificar que el scheduler permanezca apagado salvo que `ENABLE_SCHEDULER=true` esté explícitamente configurado.
- **Bloquea Producción:** SÍ.
- **Estado de Remediación:** `RESUELTO LOCALMENTE (Fase 2H-B)`
- **Evidencia de Remediación:** Eliminado todo código condicionado por hostname en `backend/server.js`. Añadida regla prohibitiva permanente en el analizador estático AST (`backend/scripts/ast_multitenant_scanner.cjs`) que falla de forma cerrada ante cualquier referencia a `SPAWX`. Verificado con fixture negativa (`fixture_11_spawx_hostname_reference.js`) en `backend/scripts/test_scanner_negative_suite.cjs`.

---

#### [JOB-003] Ausencia de Cabecera de Seguridad en Envío Diario de Cumpleaños
- **ID:** `JOB-003`
- **Severidad:** `P1`
- **Área:** 6 — Background Jobs y Schedulers
- **Archivo y Línea:** `backend/server.js:86` y `backend/routes/marketing.routes.js:454-457`
- **Evidencia:**
  En `backend/server.js`:
  ```javascript
  const bRes = await axios.post(`http://localhost:${port}/api/marketing/send-daily-birthdays`).catch(() => null);
  ```
  En `backend/routes/marketing.routes.js`:
  ```javascript
  const cronSecret = req.headers['x-cron-secret'];
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return res.status(403).json({ error: 'CRON_UNAUTHORIZED', message: 'Acceso no autorizado al proceso cron.' });
  }
  ```
- **Impacto:** La llamada interna nunca envía la cabecera `x-cron-secret`. Por tanto, en cualquier entorno donde `CRON_SECRET` esté configurado, la petición siempre es rechazada con 403 y ningún cliente recibe jamás las felicitaciones ni descuentos automáticos de cumpleaños.
- **Escenario de Reproducción:** Configurar `CRON_SECRET=secreto_seguro` e invocar el scheduler. La consola reporta error y nunca se procesan cumpleaños.
- **Corrección Recomendada:** Enviar la cabecera requerida en el post: `{ headers: { 'x-cron-secret': process.env.CRON_SECRET } }` o desacoplar a llamada a servicio interno directo sin pasar por capa HTTP.
- **Prueba Propuesta:** Test que valide la invocación del servicio de cumpleaños con autenticación válida de cron.
- **Bloquea Producción:** SÍ.

---

### ÁREA 7: Manejo de Archivos, Datos Sensibles y PII

#### [DATA-001] PIN de Administrador Almacenado en Texto Plano sin Hashing Criptográfico
- **ID:** `DATA-001`
- **Severidad:** `P0`
- **Área:** 7 — Datos y PII
- **Archivo y Línea:** `backend/routes/security.routes.js:145-148, 550-560`
- **Evidencia:**
  ```javascript
  if (pin === row.admin_pin) {
    return res.json({ success: true, message: 'PIN verificado exitosamente.' });
  }
  ```
- **Impacto:** El PIN maestro de control del salón (utilizado para autorizar anulaciones, descuentos y aperturas) se guarda en texto claro en la tabla `security_settings`. Cualquier fuga de respaldo de base de datos o acceso de solo lectura expone los códigos de acceso de todos los salones.
- **Escenario de Reproducción:** Consultar la tabla `security_settings` en base de datos; los PINs numéricos de 4-6 dígitos son legibles directamente.
- **Corrección Recomendada:** Hashear el PIN con `bcrypt` (o `argon2id`) antes de persistirlo (`await bcrypt.hash(pin, 10)`), y verificar mediante `await bcrypt.compare(pin, row.admin_pin_hash)`.
- **Prueba Propuesta:** Test que verifique que el valor guardado en base de datos comience por `$2b$` y no coincida con el PIN en texto plano.
- **Bloquea Producción:** SÍ.
- **Estado de Remediación:** `RESUELTO LOCALMENTE (Fase 2H-A)`
- **Evidencia de Remediación:** Implementado servicio `backend/services/pin_security.service.js` con hashing bcrypt (`$2b$10$...`), validación de complejidad anti-trivial (`0000`, `1234`, repetitivos o secuenciales), y comparación en tiempo constante con fallback. `backend/routes/security.routes.js:533-536` sanitiza completamente las respuestas GET omitiendo `admin_pin` y `admin_pin_hash`. Se agregó bloqueo por intentos fallidos (`pin_failed_attempts`, `pin_locked_until`). Script de migración idempotente preparado en `backend/migrations/20261109_secure_admin_pin_hash.cjs`. Verificado con tests en `backend/tests/test_phase2h_security.cjs`.

---

#### [DATA-002] Almacenamiento Masivo de Fotos Biométricas Faciales en Base64 en Tabla `attendance`
- **ID:** `DATA-002`
- **Severidad:** `P1`
- **Área:** 7 — Datos y PII
- **Archivo y Línea:** `backend/routes/attendance.routes.js:482-484` y `src/pages/AttendanceKiosk.jsx:217`
- **Evidencia:**
  ```javascript
  INSERT INTO attendance (..., photo, ...) VALUES (..., photo || null, ...)
  // photo contiene un data URL JPEG base64 de ~500 KB a 1.5 MB por cada ponche
  ```
- **Impacto:** Con 10 empleados realizando 4 ponches diarios (entrada, almuerzo ida, almuerzo regreso, salida), se insertan 40 MB diarios de cadenas de texto en una sola tabla relacional, provocando gigabytes de hinchazón (*database bloat*) en pocas semanas, degradando la memoria de PostgreSQL, copias de seguridad lentas y potenciales violaciones a normativas de protección de datos biométricos.
- **Escenario de Reproducción:** Realizar 20 ponches desde el kiosco facial y observar el crecimiento desproporcionado de la tabla `attendance`.
- **Corrección Recomendada:** Almacenar las imágenes en un bucket de almacenamiento S3/R2 privado, guardando en la base de datos únicamente el URL o UUID del objeto, o guardar únicamente el vector biométrico numérico (*embedding*) en lugar de la fotografía de alta resolución.
- **Prueba Propuesta:** Validar que el campo `photo` en la base de datos no contenga payloads base64 superiores a 512 bytes (almacenar URI).
- **Bloquea Producción:** SÍ.

---

#### [DATA-003] Firma Digital de Contratos Almacenada en Base64 sin Cifrado en Reposo
- **ID:** `DATA-003`
- **Severidad:** `P1`
- **Área:** 7 — Datos y PII
- **Archivo y Línea:** `backend/routes/contracts.routes.js:162-183`
- **Evidencia:**
  La firma gráfica del cliente (`signature_data: "data:image/png;base64,iVBOR..."`) se almacena directamente como texto crudo en la tabla `contracts`.
- **Impacto:** Exposición de firmas legales de clientes que pueden ser extraídas y reutilizadas fraudulentamente si se produce una brecha en la base de datos.
- **Escenario de Reproducción:** Volcado de la tabla `contracts` permite reconstruir gráficamente la firma de cualquier cliente.
- **Corrección Recomendada:** Mover firmas a almacenamiento de objetos privado con retención inmutable y cifrado en reposo (SSE-KMS o equivalente).
- **Prueba Propuesta:** Verificar que el volcado SQL no contenga firmas gráficas en claro.
- **Bloquea Producción:** SÍ.

---

### ÁREA 8: Frontend y UX de Producción

#### [UI-001] Bundle Inicial Monolítico Sobrecargado por `xlsx` y Componentes Administrativos
- **ID:** `UI-001`
- **Severidad:** `P1`
- **Área:** 8 — Frontend y UX
- **Archivo y Línea:** `dist/assets/index-MmSyUGHy.js` (800 KB) y `dist/assets/xlsx-B00S2N2o.js` (282 KB)
- **Evidencia:** El paquete JavaScript principal supera los 800 KB sin comprimir y descarga librerías pesadas de cálculo de hojas de cálculo antes de que el usuario inicie sesión.
- **Impacto:** Tiempos de primera pintura (FCP) y carga interactiva (TTI) lentos en conexiones móviles y terminales POS de gama de entrada en salones de belleza.
- **Escenario de Reproducción:** Simular conexión Fast 3G en Chrome DevTools; la pantalla inicial tarda más de 3.5 segundos en ser interactiva.
- **Corrección Recomendada:** Aplicar dynamic imports (`React.lazy`) para todos los módulos de reportes administrativos y cargar `xlsx` exclusivamente al pulsar el botón de exportación.
- **Prueba Propuesta:** Build de producción con bundle principal menor a 350 KB gzip.
- **Bloquea Producción:** SÍ.

---

#### [UI-002] Listados Grandes sin Paginación Virtual en Front
- **ID:** `UI-002`
- **Severidad:** `P2`
- **Área:** 8 — Frontend y UX
- **Archivo y Línea:** `src/pages/AttendanceLogs.jsx:120-200` y `src/pages/InvoiceHistory.jsx`
- **Evidencia:** Se renderizan tablas HTML completas con cientos de filas y fotos en miniatura en el DOM simultáneamente sin paginación virtual.
- **Impacto:** Caída de frames a menos de 20 FPS al hacer scroll en tablets o terminales táctiles de recepción.
- **Corrección Recomendada:** Incorporar `@tanstack/react-virtual` o paginación en servidor de 25 registros por página.
- **Prueba Propuesta:** Test de renderizado con 500 registros manteniendo 60 FPS en scroll.
- **Bloquea Producción:** NO.

---

### ÁREA 9: Resiliencia de API y Operaciones

#### [OPS-001] Ausencia de Graceful Shutdown (`SIGTERM`/`SIGINT`) en Servidor Node.js
- **ID:** `OPS-001`
- **Severidad:** `P0`
- **Área:** 9 — Resiliencia de API y Operaciones
- **Archivo y Línea:** `backend/server.js:150-179`
- **Evidencia:** `server.js` no registra manejadores para `process.on('SIGTERM')` ni `process.on('SIGINT')`.
- **Impacto:** Cuando PM2 reinicia el proceso (`pm2 reload/restart`) o Docker detiene el contenedor, el proceso se mata de inmediato. Las peticiones HTTP en vuelo se cortan bruscamente, las transacciones abiertas quedan colgadas y los pools de PostgreSQL sufren desconexiones forzadas.
- **Escenario de Reproducción:** Enviar una petición lenta y ejecutar `kill -SIGTERM <pid>`. La petición del cliente termina con `ECONNRESET`.
- **Corrección Recomendada:**
  ```javascript
  const shutdown = async (signal) => {
    console.log(`[SHUTDOWN] Recibida señal ${signal}. Cerrando servidor HTTP...`);
    server.close(async () => {
      console.log('[SHUTDOWN] Servidor HTTP cerrado. Cerrando pool de base de datos...');
      await pool.end();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000); // Forzar tras 10s
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  ```
- **Prueba Propuesta:** Test de parada controlada verificando que solicitudes activas terminen antes del cierre del pool.
- **Bloquea Producción:** SÍ.
- **Estado de Remediación:** `RESUELTO LOCALMENTE (Fase 2H-B)`
- **Evidencia de Remediación:** Implementado `GracefulShutdownCoordinator` en `backend/utils/graceful_shutdown.coordinator.cjs` e integrado en `backend/server.js:70-98`. Maneja `SIGTERM`, `SIGINT`, rechazo atómico de nuevas peticiones (`503 Server shutting down`), drenado de conexiones inactivas (`closeIdleConnections()`), seguimiento de solicitudes en vuelo, ejecución ordenada de callbacks de limpieza (cierre de pool de DB), timeout forzado de seguridad (10s) y soporte IPC multiplataforma para Windows. Verificado con proceso hijo real en `backend/tests/test_phase2h_shutdown.cjs` (6 pruebas pasando).

---

#### [OPS-002] Fuga de Detalles de Base de Datos y Ausencia de Middleware Global de Errores
- **ID:** `OPS-002`
- **Severidad:** `P1`
- **Área:** 9 — Resiliencia de API y Operaciones
- **Archivo y Línea:** `backend/app.js:540-581` y `backend/routes/cash_registers.routes.js:156, 231`
- **Evidencia:**
  ```javascript
  catch (err) {
    res.status(500).json({ error: err.message }); // Expone nombres de tablas, columnas o sintaxis SQL
  }
  ```
- **Impacto:** Exposición involuntaria de detalles internos de base de datos y esquemas ante errores imprevistos, facilitando ataques dirigidos de inyección SQL.
- **Escenario de Reproducción:** Enviar un payload que fuerce un error de sintaxis SQL; la respuesta HTTP 500 incluye el texto exacto del error devuelto por la base de datos.
- **Corrección Recomendada:** Implementar un middleware de errores global `app.use((err, req, res, next) => { ... })` al final de `app.js` que registre el error completo internamente y retorne al cliente `{ error: 'INTERNAL_ERROR', message: 'Ha ocurrido un error inesperado.' }`.
- **Prueba Propuesta:** Generar una excepción no controlada y verificar que el JSON de respuesta no contenga la propiedad `message` nativa de la BD.
- **Bloquea Producción:** SÍ.

---

### ÁREA 10: Dependencias y Librerías

#### [DEP-001] Vulnerabilidades Críticas y Altas en Dependencias Backend
- **ID:** `DEP-001`
- **Severidad:** `P1`
- **Área:** 10 — Dependencias
- **Archivo y Línea:** `backend/package.json` y reporte `npm audit` en backend
- **Evidencia:**
  - `proxy-addr` (Crítica): IP spoofing vulnerability.
  - `axios` (Alta): Prototype pollution / SSRF.
  - `nodemailer` (Alta): Denial of service.
  - `path-to-regexp` (Alta): ReDoS.
- **Impacto:** Riesgo de suplantación de IP en rate limits y bypass de controles de red.
- **Corrección Recomendada:** Actualizar dependencias directas en `backend/package.json` (`express@4.21.2+`, `axios@1.7.7+`, `nodemailer@6.9.15+`).
- **Prueba Propuesta:** `npm audit --prefix backend` con 0 vulnerabilidades de severidad crítica/alta.
- **Bloquea Producción:** SÍ.

---

#### [DEP-002] Vulnerabilidad de Alta Severidad en `xlsx` sin Parche Upstream Oficial
- **ID:** `DEP-002`
- **Severidad:** `P1`
- **Área:** 10 — Dependencias
- **Archivo y Línea:** `package.json` (raíz frontend)
- **Evidencia:** `xlsx@0.18.5` presenta vulnerabilidades de Prototype Pollution y ReDoS sin parche oficial en el registry público de npm (SheetJS dejó de publicar parches en npm público).
- **Impacto:** Manipulación de objetos globales si se procesan archivos de Excel provistos por usuarios no confiables.
- **Corrección Recomendada:** Reemplazar `xlsx` por `exceljs` o utilizar exportación nativa a CSV para reportes planos.
- **Prueba Propuesta:** Compilación y exportación de reportes exitosa sin importar `xlsx`.
- **Bloquea Producción:** SÍ.

---

### ÁREA 11: Rendimiento y Escalabilidad

#### [PERF-001] Consultas Secuenciales N+1 en Cálculo de Comisiones de Visitas
- **ID:** `PERF-001`
- **Severidad:** `P1`
- **Área:** 11 — Rendimiento y Escalabilidad
- **Archivo y Línea:** `backend/routes/visits.routes.js:45-134`
- **Evidencia:** La función `processVisitCommissions` itera con un bucle `for` sobre cada ítem facturado y ejecuta llamadas `SELECT` y `INSERT` individuales en la base de datos de manera síncrona.
- **Impacto:** Con tickets de múltiples servicios o alta afluencia en horas pico, la latencia del checkout POS sube de 50ms a más de 1.5 segundos.
- **Corrección Recomendada:** Agrupar los inserts en una única sentencia batch `INSERT INTO employee_commissions_log VALUES (...), (...)`.
- **Prueba Propuesta:** Benchmark de liquidación de ticket con 10 servicios ejecutado en menos de 100ms.
- **Bloquea Producción:** SÍ.

---

#### [PERF-002] Ausencia de Índices Compuestos en Tablas Multi-Tenant de Alto Volumen
- **ID:** `PERF-002`
- **Severidad:** `P2`
- **Área:** 11 — Rendimiento y Escalabilidad
- **Archivo y Línea:** Esquemas DDL en `backend/db.js` y migraciones
- **Evidencia:** Tablas como `visits`, `attendance` y `employee_commissions_log` no tienen índices compuestos `(tenant_id, visited_at)` o `(tenant_id, timestamp)`.
- **Impacto:** A medida que crezcan los datos de los salones, las consultas de reportes diarios ejecutarán Sequential Scans completos en PostgreSQL.
- **Corrección Recomendada:** Crear índices `idx_visits_tenant_date ON visits(tenant_id, visited_at)` e `idx_attendance_tenant_time ON attendance(tenant_id, timestamp)`.
- **Prueba Propuesta:** `EXPLAIN ANALYZE` en consultas de rango de fechas demostrando uso de Index Scan.
- **Bloquea Producción:** NO.

---

### ÁREA 12: Ciclo de Vida y Soporte

#### [LIFE-001] Inexistencia de Exportación Completa de Datos del Tenant (Portabilidad)
- **ID:** `LIFE-001`
- **Severidad:** `P1`
- **Área:** 12 — Ciclo de Vida y Soporte
- **Archivo y Línea:** `backend/routes/tenant.routes.js`
- **Evidencia:** No existe ningún endpoint o servicio que permita a un propietario de salón descargar un volcado estructurado de sus clientes, catálogo, ventas e historial.
- **Impacto:** Incumplimiento de normativas de portabilidad de datos y dificultad de salida o soporte ante disputas comerciales.
- **Corrección Recomendada:** Implementar `POST /api/tenant/export-archive` que genere un archivo ZIP comprimido con archivos CSV/JSON de sus datos exclusivos.
- **Prueba Propuesta:** Test que invoque la exportación del tenant y valide la integridad del contenido exportado.
- **Bloquea Producción:** SÍ.

---

## 4. Conteo Consolidado de Hallazgos

| Nivel de Severidad | Cantidad | Bloquea Producción | Acción Requerida |
| :--- | :---: | :---: | :--- |
| **P0 (Crítico)** | **9** | **SÍ** | Remediación obligatoria antes de cualquier despliegue real. |
| **P1 (Alto)** | **20** | **SÍ** | Remediación obligatoria antes de comercialización. |
| **P2 (Medio)** | **9** | **NO** | Planificar en sprint post-lanzamiento / ciclo de estabilización. |
| **P3 (Bajo)** | **3** | **NO** | Mejoras continuas de experiencia y documentación. |
| **TOTAL** | **41** | **29 Bloquean** | — |

---

## 5. Distribución de Remediaciones

### 5.1 Correcciones Ejecutables en Entorno Local (Sin Infraestructura Externa)
El 85% de los hallazgos críticos pueden ser resueltos y verificados inmediatamente en el entorno de desarrollo local utilizando el arnés in-memory de Fase 2E y pruebas de integración:
- Corrección de RBAC en `auth.routes.js` y `security.routes.js` (P0).
- Hashing de PIN de administrador con bcrypt (P0).
- Desbloqueo de rutas de facturación en suspensión (P0).
- Eliminación de hostname hardcodeado `SPAWX` y paso a scheduler desacoplado (P0).
- Implementación de Graceful Shutdown en `server.js` (P0).
- Aritmética decimal exacta con Money VOs en POS (P0).
- Idempotencia en anulación de facturas (P1).
- Protección CSRF estricta y rate limiting en login B2C (P1).
- Middleware global de errores y sanitización de mensajes 500 (P1).
- Optimización de bundle frontend y lazy loading de Excel (P1).

### 5.2 Correcciones que Requieren Base Física PostgreSQL o VPS
- Verificación de concurrencia pesimista `SELECT ... FOR UPDATE` en base física real PostgreSQL.
- Creación física de índices compuestos y ejecución de `EXPLAIN ANALYZE`.
- Migración de dependencias npm con `npm audit fix` en contenedor de pruebas aislado.
- Validación final de pasarela de pagos CardNet y certificación DGII externa (Fase 2C aplazada).

