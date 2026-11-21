# Auditoría Integral de Estabilidad — Etereas (`salon_saas`)

**Fecha de auditoría:** 2026-11-21  
**Alcance:** Diagnóstico integral de código, contratos Frontend ↔ Backend ↔ PostgreSQL, esquema efectivo (`salon_saas_staging` vs `salon_saas_test`), logs reales de ejecución y cobertura real de la suite de pruebas.  
**Modo de ejecución:** **100% Solo Lectura** (sin parches, sin migraciones, sin modificar registros reales ni desplegar durante esta etapa).

---

## 1. Base Auditada y Entorno Efectivo

| Componente | Valor Verificado |
| --- | --- |
| **Commit Git (`HEAD` / `origin/main`)** | `d10c24b` (`fix(pos): separate precuenta, conventional NCF and e-CF print documents, hydrate tenant branding and expose explicit comprobante selector`) |
| **Contenedor Staging (`salonpro_app`)** | ID `8676a0614479` · Imagen `salonpro-app:d10c24b` (`sha256:ffbe707c49d29a0faf41234ce55c03f4909b0dac1cf43793ca7fc38f15cd425f`) · Estado `Up (healthy)` |
| **Motor de Base de Datos** | PostgreSQL (`salonpro_db` en `172.18.0.2:5432`) · `DB_TYPE=postgres` · `NODE_ENV=staging` |
| **Integraciones en Staging** | `DGII_MODE=disabled`, `CARDNET_ENV=disabled`, `CARDNET_ENABLE_LIVE_CHARGES` inactivo, `WORKER_ENABLED` controlado |
| **Grafo Graphify (`graphify-out/graph.json`)** | `9,312` nodos · `17,754` aristas · `686` comunidades (sincronizado con commit `d10c24b`; 8 archivos `.sql` sin cobertura AST por ausencia de `tree_sitter_sql`) |
| **Migraciones registradas (`schema_migrations`)** | **26 migraciones** con estado `applied` tanto en `salon_saas_staging` como en `salon_saas_test` (`20261100_canonical_baseline_schema` → `20261116_print_templates_and_turn_tickets`) |

### 1.1 Diferencia crítica de esquema efectivo: `salon_saas_staging` vs `salon_saas_test`
A pesar de que ambas bases reportan exactamente las mismas 26 filas en `schema_migrations`, la comparación directa de `information_schema.columns` (`diff -u cols_staging.txt cols_test.txt`) reveló **deriva estructural (Schema Drift)** en 3 tablas y 1 tabla ausente en `salon_saas_staging`:

- **Tabla ausente en `salon_saas_staging`**:
  - `public.saas_renewal_runs` (presente en `salon_saas_test`, **no existe** en `salon_saas_staging`).
- **Columnas ausentes en `salon_saas_staging`**:
  - `public.saas_invoices`: faltan `fx_rate_formatted`, `fx_rate_scaled`, `idempotency_key`, `metadata`.
  - `public.saas_payments`: faltan `attempt_number`, `is_retriable`, `requires_reconciliation`.
  - `public.tenant_subscriptions`: faltan `addon_branches_count`, `auto_renew`, `billing_anchor_day`, `extra_users_count`, `periodicity_mode`, `recurring_consent_at`, `recurring_consent_version`.

**Causa de la deriva:** Se agregaron columnas/tablas retrospectivamente dentro de archivos de migración ya marcados como `applied` en staging (como `20261100_canonical_baseline_schema.cjs` / `20261110_phase2d_saas_billing.cjs`) en vez de crear una nueva migración incremental `20261121_*.cjs`. Como `salon_saas_test` se recrea desde cero o aplica el baseline actualizado, las pruebas pasan en `salon_saas_test` pero fallan en `salon_saas_staging` cuando un flujo consulta esas columnas.

---

## 2. Matriz de Recorridos Funcionales

| # | Recorrido / Módulo | Estado | Evidencia y Observaciones |
| --- | --- | --- | --- |
| 1 | **Caja: apertura → movimientos → resumen → arqueo → cierre → impresión** | **FALLIDO (P0)** | `POST /api/cash-registers/undefined/close` → HTTP 500 (`22P02: invalid input syntax for type uuid: "undefined"`). Además, desalineación de nombres de campo (`monto_inicial` vs `opening_balance` y `monto_final` vs `closing_balance`) entre `VisitRecorder.jsx` y `cash_registers.routes.js`. |
| 2 | **Branding, perfil de empresa y documentos (`TenantCustomizationModule`)** | **FALLIDO (P0)** | `PUT /api/tenant/profile` rechaza al rol canónico `'propietario'` con HTTP 403 (solo acepta `'owner'`, `'admin'`, `'administrador'`). `TenantCustomizationModule.jsx` oculta el 403 en un `catch` y muestra éxito falso. Además, `POST /api/tenant/upload-logo` no existe (`404` silenciado). |
| 3 | **Alta SaaS, términos, orden, pago, conciliación y Mi Suscripción** | **FALLIDO EN STAGING / APROBADO EN TEST (P0)** | Pasa 6/6 en `salon_saas_test`, pero `salon_saas_staging` carece de 14 columnas en `tenant_subscriptions`, `saas_invoices`, `saas_payments` y de la tabla `saas_renewal_runs` requeridas por `PgSaasBillingRepository` y `SaasCheckoutService`. |
| 4 | **Tickets pendientes POS (creación, borrador, recarga, concurrencia)** | **APROBADO** | Corregido en `306bbee` y verificado con `test_pos_pending_tickets_persistence.cjs` (4/4 bloques PASS) y en `salon_saas_staging`. |
| 5 | **Facturación convencional, secuencias NCF (`B02`/`B01`), precuenta e impresión** | **APROBADO** | Corregido en `82e2af5`, `ffffce6` y `d10c24b`. Selector explícito en POS, `availability` con `success: true`, bloqueo `e-CF` (`409`) sin integración y plantillas térmicas separadas. |
| 6 | **Pagos mixtos, desglose de caja activa y anulaciones** | **APROBADO** | Corregido en `5711471` mediante `cash_register_aggregation.service.js`. Verificado con `test_cash_register_consistency.cjs` (5/5 bloques PASS). |
| 7 | **Login, sesiones, recuperación de contraseña y RBAC** | **APROBADO CON RIESGO P1** | Login y sesiones operan; sin embargo, existen chequeos de rol ad-hoc en rutas (`['admin', 'owner']` sin `'propietario'`) fuera del catálogo RBAC canónico. |
| 8 | **Usuarios, roles, licencias y sucursales** | **APROBADO** | Alcance de sucursal (`getBranchScope`, `isBranchAuthorized`) y límites de asientos verificados. |
| 9 | **Categorías, catálogo de servicios/productos e inventario** | **APROBADO** | Unificación catálogo-inventario (`item_type: 'SERVICIO' | 'PRODUCTO'`), ajustes y kardex verificados en `test_acceptance_full_operation_ui.cjs`. |
| 10 | **Clientes y contratos (`contract_settings`)** | **FALLIDO PARCIAL (P1)** | Clientes CRUD opera, pero `POST /api/contracts/settings` ejecuta `INSERT INTO contract_settings (id, tenant_id, content) VALUES (1, ?, ?) ON DUPLICATE KEY UPDATE...` con `id = 1` fijo, colisionando entre empresas. |
| 11 | **Comisiones y Nómina** | **APROBADO** | Resoluciones individuales de novedades, invalidación al recalcular, RBAC granular (`payroll.view`/`generate`/`approve`/`pay`) y advertencia de alcance legal verificados. |
| 12 | **Kiosco de asistencia y CompreFace** | **APROBADO CONOBSERVACIÓN** | Degradación controlada cuando CompreFace no está disponible y usuario dedicado de kiosco aislado. |
| 13 | **SuperAdmin y gestión de plataforma** | **PARCIALMENTE COMPROBADO (P2)** | En `TenantCustomizationModule.jsx:262`, cuando `isSuperAdmin === true`, se omite `updateBranding()` y solo se llama `updateTenantProfile()`, dejando `tenant_branding` desincronizado de `tenants`. |
| 14 | **Correos SMTP y descargas / portabilidad** | **APROBADO** | SMTP fail-closed / configuración global con fallback por tenant y exportación CSV segura verificados. |

---

## 3. Causas Compartidas (Patrones Raíz de Inestabilidad)

Los 5 incidentes reales reportados por el usuario no son errores aislados; provienen de **5 causas arquitectónicas compartidas**:

1. **Causa Compartida A — Desalineación de contratos JSON entre `VisitRecorder.jsx` / `dataService.js` y los routers Express (sin validación de esquema compartido):**
   - El frontend envía o lee nombres en español/camelCase (`monto_inicial`, `monto_final`, `observaciones`, `res.registerId`, `res.success`) mientras el backend espera o devuelve otros nombres (`opening_balance`, `closing_balance`, `notes`, `res.id`), provocando valores `undefined` o `0` silenciosos.
2. **Causa Compartida B — `try/catch` que silencian errores HTTP 4xx/5xx en `dataService.js` y componentes React:**
   - **68 métodos** en [dataService.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/utils/dataService.js) hacen `fetch()` y devuelven `await res.json()` **sin comprobar `if (!res.ok)`**, y **41 métodos** capturan excepciones devolviendo `null`, `[]` o `{}`. Los componentes asumen que la operación tuvo éxito y muestran notificaciones verdes antes o a pesar del rechazo del backend.
3. **Causa Compartida C — Pruebas "UI" que preparan o ejecutan mutaciones por API directa en lugar de accionar los controles reales del DOM:**
   - En [test_acceptance_full_operation_ui.cjs](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/tests/test_acceptance_full_operation_ui.cjs), la apertura y cierre de caja, creación de servicios, ajustes de inventario y ventas se ejecutan mediante `browserApi('/api/...', 'POST', payloadCanónico)` y solo se usa Puppeteer para verificar que el texto aparece en pantalla tras recargar. Por eso los bugs en los manejadores `onClick` de los modales (`handleOpenCashRegister`, `handleCloseCashRegister`, `TenantCustomizationModule.handleSubmit`) nunca se ejecutaron en las pruebas.
4. **Causa Compartida D — Modificación retrospectiva de migraciones ya aplicadas + traductor regex `normalizeSql` en [backend/db.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/db.js):**
   - Editar migraciones históricas generó deriva entre `salon_saas_test` y `salon_saas_staging`. Además, `normalizeSql` traduce `ON DUPLICATE KEY UPDATE` con claves únicas antiguas (`ON CONFLICT (id)` o `ON CONFLICT (salon_id)`) que no coinciden con las restricciones multi-tenant actuales.
5. **Causa Compartida E — Dualidad de fuentes de verdad (`tenants` vs `tenant_branding` y alias de roles `'propietario'` vs `'owner'`):**
   - La identidad visual se lee y escribe parcialmente en dos tablas (`tenants` vía `/api/tenant/profile` y `/api/tenant/settings`, y `tenant_branding` vía `/api/tenant/branding`) con validaciones de rol distintas.

---

## 4. Hallazgos Detallados Priorizados (P0 / P1 / P2)

### [P0-01] Cierre de Caja desde POS falla con HTTP 500 `invalid input syntax for type uuid: "undefined"` y pérdida de montos de apertura/cierre

- **Severidad:** **P0 (Bloqueante operativo en POS)**
- **Evidencia real en logs de staging (`salonpro_app`):**
  ```json
  {"timestamp":"2026-11-21T18:21:29.111Z","level":"error","correlation_id":"f5aeff1e-a971-4017-87fb-5fb81d23e031","actor_id":"ad964432-1573-4000-bbb7-ac8e79df2753","tenant_id":"a1ba3002-d50f-4d1d-91ce-ada0e97f37f8","event":"HTTP_REQUEST_COMPLETED","method":"POST","path":"/api/cash-registers/undefined/close","status":500,"error_code":"HTTP_500"}
  ```
  `[CASH REGISTER CLOSE ERROR]: error: invalid input syntax for type uuid: "undefined" (code: 22P02)`
- **Archivos, endpoints y consultas afectados:**
  - Frontend: [VisitRecorder.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/visits/VisitRecorder.jsx#L2867-L2915) (`handleOpenCashRegister` y `handleCloseCashRegister`) y [dataService.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/utils/dataService.js#L441-L459).
  - Backend: [cash_registers.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/cash_registers.routes.js#L350-L435) (`POST /api/cash-registers/open` y `POST /api/cash-registers/:id/close`) + middleware `createQuarantineGuard(pool, 'cash_registers', 'id')` en línea 140.
- **Causa confirmada (3 defectos encadenados en el mismo flujo):**
  1. **`activeRegister.id` queda `undefined` tras abrir caja desde el POS:**  
     En `VisitRecorder.jsx:2873`:
     ```js
     setActiveRegister(res.register || { id: res.registerId, register_number: res.registerNumber });
     ```
     Pero `POST /api/cash-registers/open` (`cash_registers.routes.js:395`) devuelve la fila directamente en la raíz (`{ id: "<uuid>", status: "Abierta", ... }`), sin `res.register` ni `res.registerId`. El estado en memoria queda `{ id: undefined, register_number: undefined }`. Al pulsar **"Cerrar e Imprimir Cuadre"**, `VisitRecorder.jsx:2901` invoca `dataService.closeCashRegister(activeRegister.id, ...)` → `POST /api/cash-registers/undefined/close`, provocando `22P02` en PostgreSQL al evaluar `WHERE id = 'undefined'` sobre la columna `id uuid`.
  2. **Pérdida del fondo inicial al abrir caja desde el POS:**  
     `VisitRecorder.jsx:2871` envía `{ salon_id, employee_id, employee_name, monto_inicial }`, pero `POST /api/cash-registers/open` (`cash_registers.routes.js:353`) solo desestructura `{ salon_id = 1, opening_balance = 0, notes = '' }`. Resultado: toda caja abierta desde el modal del POS se guarda con `monto_inicial = 0.00`.
  3. **Pérdida del monto contado y notas al cerrar caja desde el POS:**  
     `VisitRecorder.jsx:2901-2904` envía `{ monto_final: declared, observaciones: closeRegisterNotes.trim() }`, pero `POST /api/cash-registers/:id/close` (`cash_registers.routes.js:408`) solo lee `{ closing_balance = 0, notes = '' }` y devuelve `{ difference }` en la raíz (mientras `VisitRecorder.jsx:2905` lee `res.summary?.diferencia`).
- **Impacto en datos:** La caja permanece `Abierta`, no se puede cerrar sin recargar la página, y al recargar e intentar cerrar desde el POS el backend recibe `closing_balance = 0`, provocando error `400 DISCREPANCY_REASON_REQUIRED` si había efectivo esperado > 0, o cerrando con monto final `0` si el efectivo esperado era `0`.
- **Brecha de prueba que lo permitió:** `test_acceptance_full_operation_ui.cjs` (líneas 254 y 306) y `test_cash_register_consistency.cjs` (líneas 176 y 318) invocaron `POST /api/cash-registers/open` y `POST /api/cash-registers/${id}/close` directamente por `fetch` con `{ opening_balance }` y `{ closing_balance }`, sin hacer clic en los modales de apertura y cierre de `VisitRecorder.jsx`.
- **Corrección propuesta:**
  1. En `cash_registers.routes.js`: aceptar `opening_balance ?? monto_inicial` y `notes ?? observaciones` en `/open`, devolver `{ ...row, register: row, registerId: row.id, registerNumber: row.register_number }`; en `/:id/close`, validar formato UUID de `:id` (devolver `400 INVALID_REGISTER_ID` si no es UUID válido), aceptar `closing_balance ?? monto_final` y `notes ?? observaciones`, e incluir `summary: { diferencia: difference }` en la respuesta.
  2. En `VisitRecorder.jsx`: asignar `const createdReg = res?.register || (res?.id ? res : null);` y luego llamar `await fetchActiveRegister()` tras abrir caja; en `handleCloseCashRegister`, resolver `const regId = activeRegister?.id` (si falta, refrescar `fetchActiveRegister()`), enviar tanto `closing_balance: declared` como `monto_final: declared`, y leer `res.difference ?? res.summary?.diferencia ?? 0`.
- **Prueba necesaria:** Prueba E2E en navegador real que abra la caja escribiendo en el `<input>` del modal de `VisitRecorder`, facture una venta en efectivo y cierre la caja pulsando el botón `"🖨️ Cerrar e Imprimir Cuadre (Sobre 80mm)"`, verificando `monto_inicial`, `monto_final` y `status = 'Cerrada'` en PostgreSQL.

---

### [P0-02] “Personalización sin efecto”: `PUT /api/tenant/profile` rechaza al rol `'propietario'` con HTTP 403, el frontend silencia el fallo y sobrescribe los cambios al recargar

- **Severidad:** **P0 (Funcionalidad rota con éxito falso en UI)**
- **Archivos, endpoints y consultas afectados:**
  - Backend: [tenant.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/tenant.routes.js#L244-L321) (`PUT /api/tenant/profile`, `GET /api/tenant/profile`, `PUT /api/tenant/branding`).
  - Frontend: [TenantCustomizationModule.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/admin/TenantCustomizationModule.jsx#L130-L314) y [dataService.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/utils/dataService.js#L3380-L3427).
- **Pasos reproducibles:**
  1. Iniciar sesión como dueño de empresa (`role = 'propietario'`).
  2. Ir a **Personalización de Empresa** (`/personalizacion`), cambiar Nombre Comercial, RNC, Dirección, Teléfono, Colores o Pie de Ticket y pulsar **"Guardar Cambios"**.
  3. La interfaz muestra el mensaje verde: *"¡Personalización y colores de la empresa actualizados exitosamente!"*.
  4. Recargar la página o navegar fuera y volver: los datos del formulario (`rnc`, `address`, `phone`, `legal_name`, `website`, e incluso `business_name` y `primary_color` en `tenants`) vuelven a sus valores anteriores.
- **Causa confirmada (4 defectos combinados):**
  1. **Rol `'propietario'` excluido en `PUT /api/tenant/profile`:**  
     En `backend/routes/tenant.routes.js:247`:
     ```js
     const role = String(req.auth?.role || '').toLowerCase();
     if (!['admin', 'administrador', 'owner'].includes(role)) {
       return res.status(403).json({ error: 'Solo propietarios o administradores pueden modificar el perfil de la empresa' });
     }
     ```
     El rol canónico asignado a todos los dueños de empresa en PostgreSQL es `'propietario'` (que sí está incluido en `PUT /api/tenant/branding` línea 86, pero fue omitido en `PUT /api/tenant/profile` línea 247). Por tanto, `PUT /api/tenant/profile` **siempre falla con HTTP 403** para el propietario.
  2. **Silenciamiento del error 403 y éxito falso en UI:**  
     En `TenantCustomizationModule.jsx:285-289`:
     ```js
     try {
       await dataService.updateTenantProfile(payload, selectedTenantId);
     } catch (profErr) {
       console.warn('Perfil adicional no persistido:', profErr.message);
     }
     ```
     El componente atrapa el HTTP 403 con `console.warn` y ejecuta la línea 306: `showNotification('¡Personalización y colores de la empresa actualizados exitosamente!', 'success')`.
  3. **Sobrescritura al cargar (`loadProfile` pisa `branding`):**  
     Al montar o recargar `TenantCustomizationModule.jsx` (`useEffect` línea 163), `loadProfile()` llama a `GET /api/tenant/profile` (`SELECT t.* FROM tenants`) y sobrescribe `formData` (`business_name`, `rnc`, `address`, `phone`, `logo_url`, `primary_color`, `secondary_color`, `receipt_footer`) con los valores antiguos de la tabla `tenants` (que nunca se actualizaron debido al 403).
  4. **Endpoint `POST /api/tenant/upload-logo` inexistente (`404 Not Found`):**  
     `TenantCustomizationModule.jsx:252` llama a `dataService.uploadTenantLogo()`, que hace `POST /api/tenant/upload-logo`. Ese endpoint **no existe** en `backend/routes/tenant.routes.js`; devuelve 404, es silenciado en `catch` (línea 256) y provoca que se guarde el Data URI base64 crudo de varios megabytes dentro de `tenant_branding.logo_url` (verificado en `salon_saas_staging`: 5 filas en `tenant_branding` acumulan ~9 MB de texto base64).
- **Brecha de prueba que lo permitió:** Las pruebas de branding (`test_phase3a_tenant_branding.cjs`) probaron `PUT /api/tenant/branding` en aislamiento, nunca el flujo completo de `TenantCustomizationModule.jsx` (`PUT /api/tenant/branding` + `PUT /api/tenant/profile` + recarga con usuario `role = 'propietario'`).
- **Corrección propuesta:**
  1. En `backend/routes/tenant.routes.js:247`: incluir `'propietario'` (y `req.auth?.isSuperAdmin`) en la validación de `PUT /api/tenant/profile`, y sincronizar atómicamente `tenants` y `tenant_branding` en ambas rutas (`PUT /branding` y `PUT /profile`) para que no existan dos estados divergentes.
  2. En `GET /api/tenant/profile`: hacer `LEFT JOIN tenant_branding tb ON tb.tenant_id = t.id` y devolver los colores/logos/textos efectivos de `tb` con los datos fiscales (`rnc`, `address`, `phone`, `legal_name`) de `t`.
  3. En `TenantCustomizationModule.jsx`: eliminar el `try/catch` que silencia el fallo de `updateTenantProfile` (si falla, mostrar error real y no notificar éxito) y habilitar también `updateBranding` para SuperAdmin cuando edita un tenant seleccionado.

---

### [P0-03] Deriva de esquema (Schema Drift) en `salon_saas_staging`: faltan 14 columnas y 1 tabla del módulo de facturación y suscripciones SaaS

- **Severidad:** **P0 (Riesgo de caída HTTP 500 `42703` / `42P01` en facturación SaaS, alta con pago y renovaciones en staging/producción)**
- **Archivos, tablas y consultas afectados:**
  - `backend/repositories/pg_saas_billing.repository.js` y `backend/services/saas_checkout.service.js`.
  - Tablas en `salon_saas_staging`:
    - `public.tenant_subscriptions`: faltan `addon_branches_count`, `auto_renew`, `billing_anchor_day`, `extra_users_count`, `periodicity_mode`, `recurring_consent_at`, `recurring_consent_version`.
    - `public.saas_invoices`: faltan `fx_rate_formatted`, `fx_rate_scaled`, `idempotency_key`, `metadata`.
    - `public.saas_payments`: faltan `attempt_number`, `is_retriable`, `requires_reconciliation`.
    - `public.saas_renewal_runs`: tabla completa ausente en `salon_saas_staging`.
- **Causa confirmada:** Las columnas fueron añadidas a migraciones anteriores ya ejecutadas en staging (`20261100` / `20261110_phase2d_saas_billing`) en lugar de una migración nueva. El runner `migrate_all.cjs` omite cualquier versión ya presente en `schema_migrations`.
- **Impacto en datos:** Cualquier operación en staging que invoque `PgSaasBillingRepository` o `SaasCheckoutService` tocando esas columnas fallará con error PostgreSQL `42703` (`column does not exist`) o `42P01` (`relation "saas_renewal_runs" does not exist`).
- **Brecha de prueba que lo permitió:** `test_acceptance_onboarding_and_payment.cjs` corre contra `salon_saas_test` (que sí tiene las columnas) y no existía una compuerta automática que compare `information_schema.columns` de `salon_saas_staging` contra `salon_saas_test`.
- **Corrección propuesta:** Crear una migración idempotente nueva `backend/migrations/20261121_reconcile_saas_billing_schema_drift.cjs` con `ADD COLUMN IF NOT EXISTS` para las 14 columnas y `CREATE TABLE IF NOT EXISTS saas_renewal_runs`, registrarla en `migrate_all.cjs` y `verify_strict_matrix.cjs`, y añadir un script de verificación de paridad de esquema (`verify_schema_parity.cjs`).

---

### [P1-01] 68 métodos en `src/utils/dataService.js` no verifican `res.ok` y 41 métodos silencian errores devolviendo `null`/`[]`/`{}`

- **Severidad:** **P1 (Causa sistémica de falsos éxitos y pérdidas silenciosas de datos en UI)**
- **Archivo afectado:** [src/utils/dataService.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/utils/dataService.js).
- **Evidencia verificada:**
  - Métodos mutadores críticos que hacen `const res = await fetch(...); return await res.json();` **sin verificar `if (!res.ok)`** (68 en total), incluyendo:
    - Catálogo y precios: `createService` (L546), `updateService` (L559), `toggleServiceStatus` (L572), `deleteService` (L583), `bulkImportServices` (L768).
    - Comisiones: `saveCommissionCategory` (L617), `deleteCommissionCategory` (L630), `saveCommissionScheme` (L650), `saveSchemeRule` (L700), `saveCommissionRule` (L722), `processCommissionPayout` (L735).
    - Personal y asistencia: `saveEmployee` (L1393), `deleteEmployee` (L1404), `saveStaffRecord` (L1814), `updateStaffRecord` (L1825), `saveAttendancePunch` (L1973), `createEmployeeDiscount` (L2267), `updateEmployeeDiscount` (L2281), `deleteEmployeeDiscount` (L2295).
    - Secuencias y configuración: `createDgiiSequence` (L2318), `updateDgiiSequence` (L2332), `deleteDgiiSequence` (L2346), `saveContract` (L1301), `savePlans` (L1105), `updateSalon` (L1734), `deleteSalon` (L1745).
  - Cuando el backend devuelve HTTP `400`, `403`, `404`, `409` o `500`, estos métodos no lanzan excepción; si el componente solo envuelve la llamada en `try/catch` sin inspeccionar `res.error`, muestra éxito falso.
  - Además, 41 métodos `get*` capturan cualquier fallo HTTP/red y devuelven `[]` o `null`, haciendo indistinguible un error de servidor (`500`) de una lista legítimamente vacía (`0 registros`).
- **Corrección propuesta:** Centralizar las llamadas de `dataService.js` en un helper `apiJsonFetch(url, options)` que verifique `res.ok`, parsee JSON de forma segura (manejando respuestas HTML 502/504 de proxy sin romper con `SyntaxError: Unexpected token '<'`) y adjunte `err.status`, `err.code` y `err.data`.

---

### [P1-02] Riesgo de aborto de transacción PostgreSQL (`25P02`) en `backend/db.js` por reintento `RETURNING id` sin `SAVEPOINT` y traducciones `ON DUPLICATE KEY UPDATE` obsoletas

- **Severidad:** **P1 (Riesgo de corrupción transaccional y colisión multi-tenant)**
- **Archivos afectados:**
  - [backend/db.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/db.js#L118-L209)
  - [backend/routes/contracts.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/contracts.routes.js#L32)
- **Detalle técnico:**
  1. En `backend/db.js:194-202`, cuando una conexión está dentro de una transacción (`BEGIN`) y ejecuta un `INSERT` en una tabla sin columna `id` que no esté en la lista blanca `isNoIdTable` (línea 191), el primer `client.query(pgSql + ' RETURNING id')` falla en PostgreSQL con `42703: column "id" does not exist`. El bloque `catch` reintenta `await client.query(pgSql, params)` en la misma transacción, pero en PostgreSQL cualquier error invalida toda la transacción activa (`25P02: current transaction is aborted`), haciendo fallar toda la operación.
  2. En `backend/routes/contracts.routes.js:32`:
     ```sql
     INSERT INTO contract_settings (id, tenant_id, content) VALUES (1, ?, ?) ON DUPLICATE KEY UPDATE content = ?
     ```
     `normalizeSql` (`db.js:126-130`) lo traduce a `ON CONFLICT (id) DO UPDATE SET content = $3`. Al fijar `id = 1`, cualquier empresa que guarde la plantilla de contrato sobrescribe la fila `id = 1` o colisiona con otra empresa.
  3. En `backend/db.js:120-122`, la traducción de `ticket_sequences` usa `ON CONFLICT (salon_id)` en lugar de `(tenant_id, salon_id)`.
- **Corrección propuesta:**
  - En `contracts.routes.js`: usar `SELECT id FROM contract_settings WHERE tenant_id = ? LIMIT 1` seguido de `UPDATE ... WHERE tenant_id = ?` o `INSERT INTO contract_settings (tenant_id, content) VALUES (?, ?)` sin fijar `id = 1`.
  - En `db.js`: no inyectar `RETURNING id` a ciegas dentro de transacciones explícitas (`getConnection()`) salvo que el query lo pida o se use la lista conocida de tablas con PK `id`, y actualizar la regla de `ticket_sequences` a `ON CONFLICT (tenant_id, salon_id)`.

---

### [P1-03] Falta de validación previa de formato UUID en parámetros de ruta (`:id`) que consultan columnas `uuid` en PostgreSQL

- **Severidad:** **P1 (Convierte errores de cliente o enlaces rotos en HTTP 500 `22P02`)**
- **Archivos afectados:** `backend/middleware/quarantine.middleware.cjs`, `backend/routes/cash_registers.routes.js`, `backend/routes/tenant.routes.js`, `backend/routes/saas.routes.js`.
- **Detalle:** Cuando un parámetro de ruta como `/api/cash-registers/:id/close` recibe `"undefined"`, `"null"` o un ID numérico antiguo sobre una columna PostgreSQL de tipo `uuid` (`cash_registers.id`, `tenants.id`, `branches.id`, `users.id`), PostgreSQL lanza una excepción no controlada `22P02` que termina en HTTP 500 en lugar de un rechazo controlado `400 Bad Request` o `404 Not Found`.
- **Corrección propuesta:** Validar formato UUID en `quarantine.middleware.cjs` y en los routers de tablas con PK `uuid` antes de consultar PostgreSQL.

---

### [P2-01] `TenantCustomizationModule.jsx` omite `updateBranding` cuando el usuario activo es SuperAdmin

- **Severidad:** **P2 (Inconsistencia en administración multi-empresa)**
- **Archivo afectado:** [src/components/admin/TenantCustomizationModule.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/admin/TenantCustomizationModule.jsx#L261-L277).
- **Detalle:** En la línea 262 (`if (!isSuperAdmin) { await updateBranding(...); }`), cuando un SuperAdmin selecciona una empresa y guarda cambios, nunca se actualiza `tenant_branding`, solo se intenta llamar `updateTenantProfile`.

---

## 5. Auditoría de la Propia Suite de Pruebas (Por qué pasaron suites con fallos reales presentes)

| Brecha Detectada en las Suites Actuales | Ejemplo Concreto | Acción Correctiva en Pruebas |
| --- | --- | --- |
| **1. Bypass de UI mediante `browserApi` / `reqJson`** | `test_acceptance_full_operation_ui.cjs` abre y cierra la caja llamando `browserApi('/api/cash-registers/open', 'POST', { opening_balance: 2000 })` en vez de usar los modales de `VisitRecorder.jsx`. | Prohibir `browserApi` para acciones que tienen botón/modal en la vista bajo prueba: el test debe abrir el modal, llenar los `<input>` y hacer clic en el botón real. |
| **2. Esquema de prueba divergente del de staging** | `salon_saas_test` tenía 14 columnas y 1 tabla más que `salon_saas_staging` porque se editaron migraciones antiguas ya aplicadas en staging. | Añadir una verificación automática de paridad de esquema (`information_schema.columns`) entre el esquema generado por migraciones y `salon_saas_staging` antes de dar por válido un release. |
| **3. Fixtures "perfectos" sin casos legacy ni roles en español** | Muchos tests usan `owner` o llaman endpoints con payloads ideales, sin probar un usuario `role = 'propietario'` guardando `TenantCustomizationModule` y recargando la página. | Incluir en los fixtures obligatorios: usuario con `role = 'propietario'`, visitas legacy con `applied_payments` en cero, IDs de cliente especiales (`INVITADO`, `EMP-*`) y cajas sin recarga previa. |
| **4. Falta de aserción universal sobre `status >= 400` en red del navegador** | `test_acceptance_full_operation_ui.cjs` solo registraba `res.status() >= 500` (`server5xx`), ignorando respuestas `403` o `404` silenciadas por `try/catch` en el frontend (como el `403` de `PUT /api/tenant/profile` y el `404` de `POST /api/tenant/upload-logo`). | Capturar en Puppeteer toda respuesta `/api/*` con `status >= 400` durante los recorridos felices y fallar la prueba si ocurre cualquier `4xx`/`5xx` no esperado. |

---

## 6. Revisión de Integridad y Operación

- **Transacciones e idempotencia:** El checkout (`POST /api/visits/:id/checkout`), creación de tickets (`POST /api/visits/ticket`), cierre de caja y pago de nómina cuentan con `Idempotency-Key` y bloqueo `FOR UPDATE`. El único punto débil transaccional es el fallback `RETURNING id` sin `SAVEPOINT` en `backend/db.js:194-202` (**P1-02**).
- **Aislamiento multi-tenant y por sucursal:** El scanner estático AST (`105` archivos, `0` violaciones) y las pruebas dinámicas confirman aislamiento por `tenant_id` y `isBranchAuthorized`, con la excepción puntual de `contract_settings` con `id = 1` fijo (**P1-02**).
- **Archivos privados y backups:** El acceso público a `/uploads` fue eliminado (`TENANT-001`) y existen respaldos `pg_dump -Fc` previos a cada despliegue en `/opt/salonpro/backups/`. Sin embargo, la caída a base64 crudo en `tenant_branding.logo_url` por ausencia de `/api/tenant/upload-logo` infla la tabla `tenant_branding` (~9 MB en 5 filas).
- **Integraciones reales vs simuladas:** En staging, `DGII_MODE=disabled` y `CARDNET_ENV=disabled` están correctamente aislados y no emiten comprobantes fiscales ni cargos reales.

---

## 7. Orden Concreto de Remediación Propuesto

1. **Fase 1 — Bloqueantes Operativos P0 (Caja, Personalización y Paridad de Esquema Staging):**
   - **Paso 1.1 (P0-01 — Apertura y Cierre de Caja en POS):** Alinear contrato entre `VisitRecorder.jsx` y `cash_registers.routes.js` (`id` en `setActiveRegister`, `opening_balance ?? monto_inicial`, `closing_balance ?? monto_final`, `notes ?? observaciones`, validación UUID en `/:id/*`).
   - **Paso 1.2 (P0-02 — Personalización de Empresa):** Incluir `'propietario'` en `PUT /api/tenant/profile`, sincronizar `tenants` ↔ `tenant_branding` al leer y guardar, implementar o redirigir `POST /api/tenant/upload-logo` al almacenamiento privado canónico y eliminar el `catch` que silencia errores en `TenantCustomizationModule.jsx`.
   - **Paso 1.3 (P0-03 — Paridad de Esquema Staging):** Crear y aplicar la migración incremental `20261121_reconcile_saas_billing_schema_drift.cjs` para alinear las 14 columnas y la tabla `saas_renewal_runs` en `salon_saas_staging`.
2. **Fase 2 — Blindaje de Contratos y Transacciones P1:**
   - **Paso 2.1 (P1-01):** Actualizar los métodos mutadores de `src/utils/dataService.js` para validar `if (!res.ok)` y lanzar error tipado.
   - **Paso 2.2 (P1-02 & P1-03):** Corregir `contract_settings` multi-tenant sin `id = 1` fijo, ajustar `backend/db.js` para no abortar transacciones con `RETURNING id` y validar UUIDs en parámetros `:id`.
3. **Fase 3 — Endurecimiento de Suites E2E (Cierre de Brechas de Prueba):**
   - **Paso 3.1:** Reemplazar llamadas `browserApi` por interacción real con los modales del DOM en `VisitRecorder` (abrir caja → facturar → cerrar caja) y `TenantCustomizationModule` (editar con `role = 'propietario'` → guardar → recargar → verificar persistencia).
   - **Paso 3.2:** Activar fallo automático ante cualquier respuesta `/api/*` con `status >= 400` no esperada durante recorridos UI y añadir chequeo de paridad `information_schema.columns` entre `salon_saas_test` y `salon_saas_staging`.

---

## 8. Ejecución de la Remediación por Bloques Verificables (`Hallazgo → Causa → Cambio → Prueba → Resultado`)

### 8.1 Matriz Consolidada de Remediación

| Bloque | Hallazgo | Causa Raíz | Cambio Aplicado | Prueba Ejecutada | Resultado |
| --- | --- | --- | --- | --- | --- |
| **BLOQUE 1 — Esquema y Migraciones** | **P0-03**: Deriva estructural en `salon_saas_staging` (faltaban 14 columnas en `tenant_subscriptions`, `saas_invoices`, `saas_payments` y la tabla `saas_renewal_runs`) e inexistencia de control de integridad sobre migraciones históricas aplicadas. | Modificación retrospectiva de migraciones ya marcadas como `applied` en `schema_migrations` (`20261100` y `20261110`) sin migración incremental ni verificación de checksum SHA-256. | 1. Creada migración incremental idempotente [20261121_reconcile_saas_billing_schema_drift.cjs](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/migrations/20261121_reconcile_saas_billing_schema_drift.cjs) con backfills seguros (`auto_renew = FALSE` sin consentimiento, `periodicity_mode = 'fixed_30_days'`, `recurring_consent_* = NULL`).<br>2. Actualizado [migrate_all.cjs](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/migrations/migrate_all.cjs) con columna `checksum` SHA-256 en `schema_migrations`, adopción explícita del historial previo (`checksum IS NULL`) y bloqueo fail-closed (`MIGRATION_CHECKSUM_MISMATCH`) ante edición retrospectiva.<br>3. Creado gate [verify_schema_parity.cjs](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/scripts/verify_schema_parity.cjs) y actualizado [test_backup_restoration_current.cjs](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/scripts/test_backup_restoration_current.cjs) (28 migraciones, 117 tablas). | • `node backend/scripts/verify_schema_parity.cjs`<br>• `node backend/scripts/verify_current_matrix.cjs`<br>• `node backend/scripts/test_backup_restoration_current.cjs` | **APROBADO (100% PASS)**: 28/28 migraciones con checksum SHA-256 válido, detección `MIGRATION_CHECKSUM_MISMATCH` comprobada, `0` diferencias entre instalación desde cero (`fresh_install`), actualización desde staging (`staging_upgrade`) y contrato canónico (`117` tablas, `50` secuencias). |
| **BLOQUE 2 — Caja** | **P0-01 & P1-03**: Cierre de caja desde POS fallaba con HTTP 500 `invalid input syntax for type uuid: "undefined"` (`POST /api/cash-registers/undefined/close`) y pérdida silenciosa de `monto_inicial`, `monto_final` y `observaciones`. | Desalineación entre el payload/respuesta de [VisitRecorder.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/visits/VisitRecorder.jsx) (`monto_inicial`, `monto_final`, `observaciones`, `res.register || { id: res.registerId }`) y [cash_registers.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/cash_registers.routes.js) (`opening_balance`, `closing_balance`, `notes`, fila plana sin `register`), más falta de validación UUID en [quarantine.middleware.cjs](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/middleware/quarantine.middleware.cjs). | 1. Definido DTO canónico (`buildCanonicalRegisterDto`) en [cash_registers.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/cash_registers.routes.js) para apertura, consulta activa y cierre.<br>2. Añadido soporte de alias con rechazo explícito (`400 CONTRADICTORY_PAYLOAD_FIELDS`) si `opening_balance !== monto_inicial` o `closing_balance !== monto_final`, y rechazo `400 INVALID_OPENING_BALANCE` / `400 INVALID_CLOSING_BALANCE` si faltan.<br>3. Validación de formato UUID en `:id` (`400 INVALID_RESOURCE_ID` / `400 INVALID_REGISTER_ID`).<br>4. En [VisitRecorder.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/visits/VisitRecorder.jsx), hidratación del estado desde respuesta persistida y refresco de caja activa sin requerir recarga de página. | • `node backend/tests/test_cash_reconciliation.cjs`<br>• `node backend/tests/test_cash_register_consistency.cjs`<br>• `node backend/tests/test_stability_remediation_e2e.cjs` (Bloques 1 y 3) | **APROBADO (100% PASS)**: Apertura y cierre desde controles reales del DOM sin recarga intermedia verificados (`0` llamadas a `/undefined/close`, rechazo `400` ante UUID inválido o montos contradictorios). |
| **BLOQUE 3 — Personalización** | **P0-02 & P2-01**: Personalización sin efecto para `role = 'propietario'` (`403` en `PUT /api/tenant/profile`), `404` en `POST /api/tenant/upload-logo`, `catch` que silenciaba errores mostrando éxito falso y sobrescritura al recargar. | `PUT /api/tenant/profile` omitía `'propietario'` en su lista de roles; `POST /api/tenant/upload-logo` no existía (guardando Base64 crudo en `tenant_branding.logo_url`); `TenantCustomizationModule.jsx` atrapaba los errores 403/404 y notificaba éxito. | 1. Unificada autorización en [tenant.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/tenant.routes.js) y [settings.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/settings.routes.js) mediante `canManageTenantCustomization` (`'propietario'`, `'owner'`, `'admin'`, `'administrador'`, `settings.manage`, `branding.manage`, `isSuperAdmin`).<br>2. Sincronización atómica entre `tenants` (datos fiscales/comerciales) y `tenant_branding` (tokens visuales y textos de ticket) en `GET/PUT /api/tenant/profile` y `PUT /api/tenant/branding`.<br>3. Implementado `POST /api/tenant/upload-logo` respaldado por `PrivateStorageAdapter` (`private_files` cifrado) + `GET /api/public/branding/:tenantId/logo/:fileId` ([public.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/public.routes.js)).<br>4. Eliminados `try/catch` silenciadores en [TenantCustomizationModule.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/admin/TenantCustomizationModule.jsx).<br>5. Creada utilidad verificable [convert_base64_branding_logos.cjs](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/scripts/convert_base64_branding_logos.cjs). | • `npm run test:phase2h:branding` (12/12)<br>• `node backend/tests/test_stability_remediation_e2e.cjs` (Bloque 4) | **APROBADO (100% PASS)**: Guardado con `role = 'propietario'`, subida de logo PNG real a `private_files`, descarga byte-a-byte verificada, persistencia tras `page.reload()` y conversión verificada de logos Base64 legados. |
| **BLOQUE 4 — Contratos HTTP y Transacciones** | **P1-01 & P1-02**: 68 métodos en `dataService.js` no comprobaban `res.ok`; en `backend/db.js`, `RETURNING id` + `catch 42703` abortaba transacciones activas (`25P02`); `contract_settings` fijaba `id = 1` colisionando entre tenants; `ticket_sequences` tenía restricción global `salon_id` legacy. | Falta de helper HTTP centralizado en `dataService.js`; inyección de `RETURNING id` en `getConnection().query()` sobre tablas sin columna `id`; traducciones legacy en `normalizeSql` de [backend/db.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/db.js). | 1. Centralizada validación HTTP y parseo seguro JSON/texto/HTML en `parseApiResponse` dentro de [src/utils/dataService.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/utils/dataService.js), lanzando `Error` con `status`, `code` y `data` ante cualquier `!res.ok`.<br>2. En [backend/db.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/db.js), catálogo completo `NO_ID_TABLES` (13 tablas sin columna `id`), helper `shouldAppendReturningId` y eliminación del `catch (42703)` dentro de conexiones transaccionales (`getConnection()`).<br>3. Corregido `contract_settings` ([contracts.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/contracts.routes.js)) para usar `ON CONFLICT (tenant_id)` sin `id = 1`, y `ticket_sequences` para usar `ON CONFLICT (tenant_id, salon_id)` eliminando `ticket_sequences_salon_id_key` en [20261121_reconcile_saas_billing_schema_drift.cjs](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/migrations/20261121_reconcile_saas_billing_schema_drift.cjs).<br>4. Corregido `LEFT JOIN clients c ON vc.client_id::text = c.id::text` en [security.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/security.routes.js#L293) que causaba `500` al consultar `/api/security/requests`. | • `node backend/tests/test_pos_pending_tickets_persistence.cjs`<br>• `node backend/tests/test_stability_remediation_e2e.cjs` (Bloque 2) | **APROBADO (100% PASS)**: Transacciones explícitas sobre las 13 tablas sin `id` completan sin `42703`/`25P02`; `contract_settings` y `ticket_sequences` aislados por `tenant_id`. |
| **BLOQUE 5 — Pruebas que Representen al Usuario y Despliegue** | Brecha en suites previas que usaban `browserApi` en vez de controles del DOM e ignoraban respuestas `/api/*` con `status >= 400`. | Falta de listener estricto `status >= 400` en Puppeteer y ausencia de recorrido E2E que abriera/cerrara caja sin recarga intermedia y personalizara con `role = 'propietario'`. | 1. Creada suite [test_stability_remediation_e2e.cjs](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/tests/test_stability_remediation_e2e.cjs) con interacción real sobre el DOM en Puppeteer, listener de red que falla ante cualquier `/api/*` con `status >= 400`, `pageerror` o `ErrorBoundary`, y fixtures con rol `'propietario'` y visitas legacy.<br>2. Re-ejecutadas todas las suites de aceptación y aislamiento sobre el commit final. | • `node backend/tests/test_stability_remediation_e2e.cjs`<br>• `node backend/tests/test_acceptance_full_operation_ui.cjs`<br>• `node backend/tests/test_acceptance_onboarding_and_payment.cjs`<br>• `node backend/tests/test_pos_pending_tickets_persistence.cjs`<br>• `node backend/tests/test_cash_register_consistency.cjs`<br>• `npm run verify:release && npm run test:scanner && npm run test:runner-guards` | **APROBADO (100% PASS)**: `0` errores `/api/* >= 400` inesperados, `0` `pageerror`, `0` `ErrorBoundary` y paridad total verificada. |

