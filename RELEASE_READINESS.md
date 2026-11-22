# Informe de Validación Final para Producción (`RELEASE_READINESS.md`) — Etereas

- **Fecha de evaluación**: `2026-11-21`
- **Entorno de pruebas automatizadas**: `salon_saas_test` (PostgreSQL 15 aislado con guardas fail-closed `_test_db_guard.cjs` / `test_env_guard.cjs`)
- **Entorno de pre-producción (Staging)**: `staging.etereasapp.com` (`179.66.139.67`, contenedor `salonpro_app`, base `salon_saas_staging`)
- **Entorno de producción**: `salon_saas_prod` (**intacto, 0 mutaciones realizadas**)
- **Versión base auditada al inicio**: commit `e39b0e3` (`salonpro-app:e39b0e3`)
- **Versión candidata final validada**: commit candidato de cierre (`HEAD` en `main`, desplegado en `salon_saas_staging`)
- **Veredicto final**: **`APTO CON ALCANCE EXPLÍCITO`**

---

## 1. Tabla Maestra de Validación por Bloque

| Bloque | Evidencia | Versión | Aprobado / Fallido / Pendiente | Responsable del pendiente |
| :--- | :--- | :--- | :--- | :--- |
| **PREPARACIÓN** — Base, Graphify, Paridad de Esquema, Checksums, Personalización y Sesión Única | `verify_schema_parity.cjs` (`28/28` migraciones con checksum SHA-256 válido, `0` deriva entre instalación limpia, upgrade y `public`: `117` tablas, `1584` columnas, `176` FKs); `test_branding_sidebar_and_single_session_e2e.cjs` (`6/6 PASS`: sidebar real con tokens dinámicos + revocación inmediata `SESSION_SUPERSEDED` en HTTP y WebSocket); `test_stability_remediation_e2e.cjs` (`4/4 PASS`). | Candidato final (`HEAD`) | **Aprobado** | N/A (0 pendientes) |
| **SIMPLIFICACIÓN UI** — Renovación en “Mi suscripción” (`/facturacion-saas`) | `test_saas_subscription_renewal_ui_simplification.cjs` (`5/5 PASS`): eliminados tarjeta “Renovación Mensual Consolidada (DOP)”, checkbox repetido, botón “Confirmar autorización automática”, selector de migración 30 días → mes calendario e info técnica; todo integrado en “Próximo cobro” con desglose desplegable, nota de tasa aplicable, método enmascarado, estado efectivo real (`active`, `authorized_service_inactive`, `missing_payment_method`, `missing_consent`, `condition_change_pending`, `cancelled`), consentimiento separado en Landing y acción contextual única para cuentas sin consentimiento. | Candidato final (`HEAD`) | **Aprobado** | N/A (0 pendientes) |
| **BLOQUE 1** — Reportes (11 reportes de Ventas y Cobros) y Regresión Operativa POS/Caja/NCF/Stock | `test_release_block1_reports_and_operational_regression.cjs` (`3/3 PASS`, `11/11` reportes `Pantalla == API == BD` con 2 sucursales y 2 empresas, `0` contaminación cross-tenant, `0 pageerrors`, `0 5xx`) + `test_analytics_ui_views.cjs` (`PASS`). Recorrido completo: catálogo → stock (`20` Central, `10` Norte) → apertura de caja → ticket → precuenta (`0` NCF consumidos) → factura B02 (`B0200000001` único, `0` conexión DGII) → comisión (`RD$ 400`) → ticket cancelado (`RD$ 1,500`) → factura anulada (`B0200000002` con reversión de stock a `19` y exclusión en caja/reportes) → cierre de caja con diferencia `0`. | Candidato final (`HEAD`) | **Aprobado** | N/A (0 pendientes) |
| **BLOQUE 2** — Alta, Contratación y Pago Inicial | `test_acceptance_onboarding_and_payment.cjs` (`5/5 PASS`: cálculo comercial exacto 1..N sucursales + asientos extra + add-on Membresías parcial/total, conversión USD→DOP congelada, términos `v2026.1` + SHA-256, matriz de fallos rechazo/cancelación/timeout `409 RECONCILIATION_REQUIRED`/reconciliación post-caída sin doble cobro, recibo descargable, `0` datos ficticios). Evidencia real en `salon_saas_staging`: 3 órdenes aprobadas en CardNet producción (`ETWIC2JYU81F2A7` auth `029270` `VISA ****9892`, `ETWIAZS1FF3F217` auth `017913` `VISA ****3481`, `ETWIAGLY8FF99BC` auth `295000` `VISA ****3481`) y factura `INV-2026-00001` pagada. | Candidato final (`HEAD`) | **Aprobado** | N/A (0 pendientes) |
| **BLOQUE 3** — Recurrencia Consolidada, Prorrateo de Ampliación y Cancelación | `test_consolidated_monthly_renewal.cjs` (`9/9 PASS`: aniversario mes calendario y fin de mes `31→28/29→31`, preservación de ciclos de 30 días sin migración forzada, concurrencia de workers con lock optimista, deuda y tasa congeladas, caída post-cobro conciliada sin recobro, clasificación de códigos CardNet y parada tras rechazos duros) + `test_release_blocks_3_4_5_6_7_readiness.cjs` (`BLOQUE 3 PASS`: prorrateo exacto a mitad de ciclo `US$49.50` por 15 días, siguiente ciclo consolidado `US$357.00 -> RD$21,598.50`, cancelación accesible en cuenta suspendida/pendiente y `SAAS_RENEWAL_WORKER_ENABLED=false`). *Nota de alcance*: los cobros recurrentes automáticos no presenciales (MIT / Card-on-File) requieren certificación comercial explícita con CardNet antes de activar el worker global. | Candidato final (`HEAD`) | **Aprobado con alcance explícito** (Worker global desactivado hasta certificación MIT CardNet) | **Dependencia Externa (CardNet / Adquirente)** y **Operador** (mantener `SAAS_RENEWAL_WORKER_ENABLED=false` hasta habilitación MIT) |
| **BLOQUE 4** — Correo Transaccional y Documentos | `test_account_recovery_security.cjs` (`9/9 PASS`: anti-enumeración, hash SHA-256 de códigos sin texto plano, aislamiento cross-tenant, expiración, bloqueo brute-force a 5 intentos, revocación de sesiones al restablecer contraseña y recuperación para propietario de cuenta suspendida) + `test_release_blocks_3_4_5_6_7_readiness.cjs` (`BLOQUE 4 PASS`: cola `tenant_welcome_email_queue`, descarga `/api/public/terms/v2026.1/download` con SHA-256 `d5bc5be9930d6c1d167a47a5d32c6e216568d6f42fb95d6a11b719cc0fdcadf1`, recibo comercial HTML/JSON con USD, tasa FX y DOP sin NCF inventado ni secretos/PAN/CVC, y correo de confirmación de cancelación). | Candidato final (`HEAD`) | **Aprobado** (Verificación de entrega física en bandeja externa sujeta a monitoreo continuo de reputación SMTP) | **Operador** (verificación periódica de entregabilidad SPF/DKIM/DMARC en buzón externo) |
| **BLOQUE 5** — Restauración Completa (PostgreSQL + Archivos Privados Cifrados + CompreFace) | `test_backup_restoration_current.cjs` (`PASS`: cifrado in-stream AES-256-GCM + manifiesto HMAC-SHA256, rechazo de payload corrupto, reconstrucción de `117` tablas, `50` secuencias y `4` triggers en esquema desechable, restauración topológica, bloqueo `QUARANTINE_VIOLATION` y FK `23503`) + `test_release_blocks_3_4_5_6_7_readiness.cjs` (`BLOQUE 5 PASS`: restauración en esquema desechable + descifrado íntegro de archivo privado en `private_files` con `STORAGE_ENCRYPTION_KEY`, SHA-256 idéntico, `RTO = 101.4s`). En VPS existen dumps locales en `/opt/salonpro/backups/` (`17` archivos privados cifrados en staging y `23` embeddings en `compreface_postgres_db`), pero **no existe replicación automatizada fuera de la VPS** (`NO_ROOT_CRONTAB`). | Candidato final (`HEAD`) | **Pendiente de réplica off-VPS** (Mecanismo técnico de respaldo y restauración local **Aprobado**; copia externa fuera de la VPS **Pendiente**) | **Operador / Infraestructura** (configurar bucket externo S3/R2/B2 y cron diario off-VPS) |
| **BLOQUE 6** — Carga Concurrente, Recursos VPS y Monitoreo | `test_inventory_concurrency.cjs` (`5/5 PASS`) + `test_release_blocks_3_4_5_6_7_readiness.cjs` (`BLOQUE 6 PASS`: `12` ventas/descuentos de stock concurrentes en `3.06s` sin stock negativo; `22` peticiones HTTP concurrentes a los 11 reportes BI, caja activa y healthcheck con `0%` error, `p50 = 521.7ms`, `p95 = 586.5ms`, `p99 = 647.98ms`, `RSS = 136.8MB`). Estado real VPS (`16 GB` RAM total, `10.5 GB` disponibles; disco `51G / 193G` = `27%`; `RestartCount = 0` y `OOMKilled = false` en los 7 contenedores). No hay servicio externo de alertas configurado aún; se incluye propuesta concreta de umbrales en la Sección 4. | Candidato final (`HEAD`) | **Aprobado con propuesta de alertas** (Desempeño y estabilidad bajo carga **Aprobados**; activación de canal externo de alertas **Pendiente de aprobación del operador**) | **Operador** (aprobar y activar webhook/servicio externo de monitoreo según umbrales propuestos en Sección 4) |
| **BLOQUE 7** — Ensayo de Producción en Entorno Desechable y Promoción a Staging | `test_release_blocks_3_4_5_6_7_readiness.cjs` (`BLOQUE 7 PASS`: ensayo completo desde cero en esquema desechable `prod_rehearsal_*` en `102.35s` con `28/28` migraciones y checksums verificados, `117` tablas, `50` secuencias, `4` triggers), `verify:release` (`25/25` chunks críticos verificados, `syncDistAssetsCache` activo para retención de assets entre despliegues), `test:scanner` (`PASS`), `test:runner-guards` (`7/7 PASS`), aislamiento de roles PostgreSQL verificado (`salon_saas_prod_*` vs `salon_saas_staging_*` vs `salon_saas_test_*`), respaldo previo y despliegue del candidato en `salon_saas_staging` con smoke test posterior aprobado y `salon_saas_prod` intacto. | Candidato final (`HEAD`) | **Aprobado** | **Operador** (autorizar ventana de corte hacia `salon_saas_prod`) |

---

## 2. Clasificación Clara de Hallazgos y Alcance

### 2.1 Fallos Técnicos del Sistema (Corregidos y Verificados en este Release: `0` pendientes)
Durante la ejecución de las pruebas reproducibles de esta validación final se detectaron, corrigieron y verificaron en `salon_saas_test` cuatro defectos técnicos reales:

1. **Reportes Ejecutivos de Ventas y Cobros (`GET /api/reports/bi` y UI de Inteligencia de Negocios)**:
   - **Causa**: El endpoint `GET /api/reports/bi` en [reports.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/reports.routes.js) solo implementaba `cash_flow` y `sales_summary`, devolviendo el resumen general para los otros 10 reportes del selector (`sales_by_product`, `sales_by_client`, `payment_methods`, `accounts_receivable`, `cancelled_tickets`, `voided_invoices`, `applied_discounts`, `cash_membership_payments`, `sales_itbis`, `joint_purchases`), y el frontend ([BusinessIntelligence.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/bi/BusinessIntelligence.jsx) y [BIChart.jsx](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/src/components/bi/BIChart.jsx)) tenía fallbacks a datos simulados cuando la respuesta estaba vacía. Además, `classifyMethodBucket` en [cash_register_aggregation.service.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/services/cash_register_aggregation.service.js) clasificaba `"Crédito (Cuenta por cobrar)"` como `"tarjeta"` por coincidencia parcial de la subcadena `"crédito"`.
   - **Corrección**: Se implementaron los 11 reportes en `GET /api/reports/bi` a partir de datos reales de PostgreSQL, se eliminaron los fallbacks mock del frontend, se añadió `POST /api/visits/:id/cancel` en [visits.routes.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/routes/visits.routes.js) para cancelar tickets abiertos antes de facturar, y se separó estrictamente `Facturación` vs `Total cobrado` vs `Cuentas por cobrar`.
   - **Verificación**: `test_release_block1_reports_and_operational_regression.cjs` (`11/11` reportes `Pantalla == API == BD` PASS) y `test_analytics_ui_views.cjs` (`PASS`).

2. **Consultas de Confirmación de Cancelación y Bienvenida (`tenants.name` / `tenants.nombre` inexistentes)**:
   - **Causa**: `cancelSubscription` en [subscription_lifecycle.service.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/services/subscription_lifecycle.service.js) consultaba `SELECT business_name, name, owner_email, email FROM tenants`, y `recordAcceptance` en [terms_and_welcome_email.service.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/services/terms_and_welcome_email.service.js) consultaba `SELECT nombre, business_name, status FROM tenants`. Como la tabla `tenants` utiliza `business_name` y `legal_name` (sin columnas `name` ni `nombre`), PostgreSQL arrojaba `column "name" does not exist` al intentar construir el correo de cancelación.
   - **Corrección**: Se actualizaron ambas consultas a `SELECT business_name, legal_name, ... FROM tenants`.
   - **Verificación**: `test_release_blocks_3_4_5_6_7_readiness.cjs` (`BLOQUE 3` y `BLOQUE 4` PASS sin advertencias SQL).

3. **Cálculo de Sucursales Facturables y Usuarios Extra en `ConsolidatedRenewalService` + `fx_snapshot` en Facturas Directas**:
   - **Causa**: En [consolidated_renewal.service.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/services/consolidated_renewal.service.js), `COALESCE(t.extra_user_seats, 0)` eclipsaba `ts.extra_users_count` cuando `t.extra_user_seats` tenía el default `0`, y `t.licensed_branches` (`1`) no consideraba el conteo real de sucursales activas en `branches`. Asimismo, [pg_saas_billing.repository.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/repositories/pg_saas_billing.repository.js) solo leía `fx_snapshot` desde `saas_checkout_orders.metadata` e ignoraba `saas_invoices.metadata`.
   - **Corrección**: Se actualizó `calculateConsolidatedQuote` para tomar `Math.max` entre la capacidad licenciada en `tenants`, `tenant_subscriptions` y las sucursales activas en `branches`, y se actualizó `PgSaasBillingRepository` para persistir y recuperar `fx_snapshot` desde `saas_invoices.metadata`.
   - **Verificación**: `test_consolidated_monthly_renewal.cjs` (`9/9 PASS`) y `test_release_blocks_3_4_5_6_7_readiness.cjs` (`PASS`).

4. **Restablecimiento de `search_path` en el Runner Canónico de Migraciones (`migrate_all.cjs`)**:
   - **Causa**: Al ejecutar `migrateAll({ pool, targetSchema })` sobre un esquema desechable, las conexiones liberadas al pool conservaban `search_path` apuntando al esquema temporal.
   - **Corrección**: Se envolvió `c.release` y el bloque `finally` en [migrate_all.cjs](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/migrations/migrate_all.cjs) para restablecer siempre `SET search_path TO public;` antes de devolver la conexión al pool.
   - **Verificación**: `verify_schema_parity.cjs` (`PASS`), `test_backup_restoration_current.cjs` (`PASS`) y `test_release_blocks_3_4_5_6_7_readiness.cjs` (`PASS`).

---

### 2.2 Limitaciones de Alcance de Producto (Por Diseño Comercial)
1. **Facturación Electrónica e-CF DGII fuera del Plan Principal**:
   - El Plan Principal de Etereas incluye facturas comerciales, tickets de precuenta, configuración de secuencias de comprobantes convencionales por empresa (`B01`, `B02`, `B04`, `B14`, `B15`), asignación atómica del NCF al finalizar factura e impresión térmica de `60mm`.
   - La emisión electrónica e-CF, firma digital X.509, envío, seguimiento y aceptación ante la DGII constituyen una integración adicional independiente (`DGII_ENV=disabled` por defecto en el plan principal).
2. **Comprobantes de Suscripción SaaS**:
   - Los cobros de suscripción a Etereas emiten un **Comprobante Comercial de Suscripción SaaS** (`COMMERCIAL_SAAS_RECEIPT`) con importe original en USD, tasa aplicada y monto cobrado en DOP, indicando expresamente que no constituye un comprobante fiscal e-CF/NCF.
3. **Renovación Automática Gobernada por Estado Efectivo**:
   - La interfaz de `/facturacion-saas` (“Próximo cobro”) ya no muestra `"Renovación automática activa"` únicamente por la preferencia del usuario: distingue entre consentimiento del cliente (`customerAuthorized`), método tokenizado apto (`hasEligiblePaymentMethod`) y disponibilidad real del servicio de cobro (`workerEnabled && gatewayConfigured`). Cuando el worker global está apagado (`SAAS_RENEWAL_WORKER_ENABLED=false`), informa con transparencia: *"Autorizada por el cliente (cobro automático pendiente de activación del servicio)"*.

---

### 2.3 Dependencias Externas
1. **Habilitación Comercial MIT / Card-on-File en CardNet para Renovaciones No Presenciales**:
   - Aunque la integración técnica con CardNet Tokenization (`PWCheckout`) ya crea perfiles de cliente (`CustomerId`) y perfiles de pago (`PaymentProfileId` / `Token`) en producción y registra `recurringSupported=true` en la validación de capacidades, la ejecución comercial de cargos recurrentes automáticos iniciados por el comercio (**MIT — Merchant-Initiated Transactions**) requiere confirmación contractual/operativa con CardNet para el MID de producción. Mientras tanto, `SAAS_RENEWAL_WORKER_ENABLED` debe mantenerse en `false` y las renovaciones se procesan mediante checkout iniciado por el usuario.
2. **Almacenamiento Externo (Off-VPS) para Copias de Seguridad**:
   - Actualmente los respaldos de PostgreSQL (`/opt/salonpro/backups/*.dump`) residen en el mismo volumen de la VPS (`/dev/sda1`). Se requiere un bucket externo (AWS S3, Cloudflare R2 o Backblaze B2) para cumplir con recuperación ante pérdida catastrófica del nodo.

---

### 2.4 Acciones Pendientes del Operador
1. **Configurar destino off-VPS y tarea programada de respaldo externo**:
   - Proveer credenciales de un bucket externo (S3/R2/B2) y activar el cron diario que replique el dump cifrado de PostgreSQL (`salon_saas_prod` + `compreface_postgres_db`) y el directorio de archivos privados cifrados (`backend/data/storage`) fuera de la VPS.
2. **Aprobar y activar canal externo de monitoreo y alertas**:
   - Configurar las alertas externas según los umbrales propuestos en la Sección 4 de este documento.
3. **Mantener `SAAS_RENEWAL_WORKER_ENABLED=false` en el lanzamiento inicial**:
   - Activar `SAAS_RENEWAL_WORKER_ENABLED=true` únicamente después de recibir confirmación formal de habilitación MIT/Card-on-File por parte de CardNet.

---

## 3. Evidencia Detallada de los Bloques 2, 5, 6 y 7

### 3.1 Bloque 2 — Distinción entre Pruebas con Adaptador y Evidencia Real en CardNet (`salon_saas_staging`)
- **Pruebas automatizadas con adaptador determinista (`salon_saas_test`)**:
  - `backend/tests/test_acceptance_onboarding_and_payment.cjs` ejercita el flujo completo en navegador headless real (`/` → selección de plan/sucursales/usuarios/add-on → registro con términos `v2026.1` y consentimiento recurrente separado → pago → activación → recibo descargable) y toda la matriz de fallos (rechazo `51`, cancelación, timeout `504 -> 409 RECONCILIATION_REQUIRED`, caída post-aprobación reconciliada sin doble cobro, webhook con HMAC inválido `401` y bloqueo IDOR cross-tenant `404`).
- **Evidencia real verificada en CardNet (`salon_saas_staging`)**:
  - Configuración efectiva en staging: `CARDNET_ENV=PRODUCTION`, `CARDNET_ENABLE_LIVE_CHARGES=true`.
  - Órdenes reales aprobadas (`cardnet_response_code = '00'`):
    - Orden `ETWIC2JYU81F2A7`: `status = approved`, `total_minor = 990` (`RD$ 9.90`), código de autorización `029270`, tarjeta enmascarada `VISA ****9892`, `2026-11-18T19:48:23Z`.
    - Orden `ETWIAZS1FF3F217`: `status = approved`, `total_minor = 990` (`RD$ 9.90`), código de autorización `017913`, tarjeta enmascarada `VISA ****3481`, `2026-11-18T19:03:06Z`.
    - Orden `ETWIAGLY8FF99BC`: `status = approved`, `total_minor = 990` (`RD$ 9.90`), código de autorización `295000`, tarjeta enmascarada `VISA ****3481`, `2026-11-18T18:49:18Z`.
  - Factura SaaS emitida y pagada en staging: `INV-2026-00001` (`status = paid`, `total_minor = 990`, `amount_paid_minor = 990`).
  - Métodos de pago tokenizados en `saas_payment_methods` (0 PAN, 0 CVC): 3 registros `cardnet` (`VISA ****3481`, `VISA ****9892`).

### 3.2 Bloque 5 — Medición de RTO / RPO y Estado de Respaldos
- **Componentes cubiertos en la prueba de restauración**:
  1. **Base de datos principal PostgreSQL**: reconstrucción íntegra de las `117` tablas, `50` secuencias, `176` FKs y `4` triggers de cuarentena + restauración topológica de entidades multi-tenant desde snapshot cifrado en stream (`AES-256-GCM` + manifiesto `HMAC-SHA256`).
  2. **Archivos privados cifrados (`private_files` + `STORAGE_ENCRYPTION_KEY`)**: verificación de cifrado `AES-256-GCM` con AAD (`tenantId:fileId:category`) y descifrado post-restauración verificando hash `SHA-256` idéntico byte a byte. En staging existen `17` archivos privados cifrados registrados en `private_files`.
  3. **Base biométrica CompreFace (`compreface_postgres_db`, DB `frs`)**: verificada activa con `23` embeddings faciales persistidos.
- **Métricas medidas**:
  - **RTO (Recovery Time Objective) medido**: **`101.4 segundos`** (~`1.7 minutos`) para reconstruir el esquema completo desde cero, verificar integridad de `28` migraciones, restaurar datos relacionales y verificar lectura de archivos privados cifrados.
  - **RPO (Recovery Point Objective) actual**: **Por despliegue** (se genera un dump completo `pg_dump -Fc` en `/opt/salonpro/backups/pre_deploy_*.dump` antes de cada promoción; existen `8` dumps verificados de ~`927 KB` cada uno en `/opt/salonpro/backups/`).
  - **Brecha identificada (Off-VPS)**: No existe crontab activo (`NO_ROOT_CRONTAB`) ni replicación hacia almacenamiento externo fuera de la VPS. Si se configura un cron diario con replicación a S3/R2/B2, el RPO programado pasará a `<= 24 horas` (o `<= 6 horas` con cron cada 6h).

### 3.3 Bloque 6 — Resultados de Carga Concurrente y Estado de Recursos en la VPS
- **Resultados en entorno aislado (`salon_saas_test`)**:
  - **Ventas y descuentos de stock concurrentes**: `12` deducciones atómicas simultáneas sobre el mismo producto completadas en `3,061.5 ms` (`~255 ms/op` a través del túnel remoto), stock final exacto (`50 - 12 = 38`), `0` condiciones de carrera, `0` saldos negativos.
  - **Peticiones HTTP concurrentes (`22` solicitudes simultáneas: los `11` reportes BI + `10` healthchecks/kiosco + consulta de caja activa)**:
    - Tasa de error: **`0.00%`** (`0` respuestas 5xx / 4xx inesperadas).
    - Latencias: **`p50 = 521.70 ms`**, **`p95 = 586.50 ms`**, **`p99 = 647.98 ms`**.
    - Memoria del proceso Node (`salonpro-api`): **`RSS = 136.8 MB`** (muy por debajo del límite de contenedor de `768 MiB`).
- **Estado real medido en la VPS (`179.66.139.67`)**:
  - **RAM del host**: `15,987 MiB` totales (`16 GB`), `5,473 MiB` usados, **`10,513 MiB` (`10.5 GB`) disponibles**.
  - **Disco (`/dev/sda1`)**: `193 GB` totales, `51 GB` usados (**`27%`**), **`143 GB` disponibles**.
  - **Uso por contenedor y eventos OOM**:
    - `salonpro_app`: `65.57 MiB / 768 MiB (8.54%)` — `RestartCount=0`, `OOMKilled=false`
    - `salonpro_db`: `121.60 MiB / 1.25 GiB (9.50%)` — `RestartCount=0`, `OOMKilled=false`
    - `salonpro_caddy`: `68.86 MiB / 256 MiB (26.90%)` — `RestartCount=0`, `OOMKilled=false`
    - `compreface_core`: `3.05 GiB / 4.00 GiB (76.26%)` — `RestartCount=0`, `OOMKilled=false`
    - `compreface_api`: `693.20 MiB / 1.50 GiB (45.13%)` — `RestartCount=0`, `OOMKilled=false`
    - `compreface_admin`: `538.20 MiB / 1.00 GiB (52.56%)` — `RestartCount=0`, `OOMKilled=false`
    - `compreface_postgres_db`: `38.96 MiB / 512 MiB (7.61%)` — `RestartCount=0`, `OOMKilled=false`

---

## 4. Propuesta Concreta de Umbrales y Alertas de Monitoreo (Bloque 6)

Conforme a las instrucciones de no activar servicios externos sin presentar antes una propuesta concreta, se propone el siguiente esquema de monitoreo y alertas para aprobación del operador:

| Métrica / Control | Fuente de Medición | Umbral de Advertencia (Warning) | Umbral Crítico (Critical) | Ventana / Frecuencia | Acción Automática / Notificación |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Disponibilidad HTTP (`/api/health`)** | Monitor externo HTTPS (`GET /api/health`) | Latencia `> 1,500 ms` en 2 chequeos seguidos | Status `!= 200` o timeout `> 5s` en 2 chequeos seguidos | Cada `60 segundos` | Alerta inmediata por Webhook (Slack/Telegram/Email) + healthcheck Docker reinicia contenedor tras 3 fallos |
| **Tasa de Errores HTTP `5xx`** | Logs JSON de Caddy (`/var/log/caddy/*.log`) y `salonpro_app` (`HTTP_REQUEST_COMPLETED`) | `>= 3` errores `5xx` en 5 minutos | `>= 10` errores `5xx` o `> 2%` del tráfico en 5 minutos | Ventana móvil de `5 min` | Alerta con `correlation_id`, ruta y `tenant_id` afectado |
| **Memoria de Contenedores (`salonpro_app` / `compreface_core`)** | `docker stats` / cAdvisor | `salonpro_app > 550 MiB` (`71%`) o `compreface_core > 3.5 GiB` (`87%`) | `> 90%` del límite del contenedor o `OOMKilled == true` | Cada `2 minutos` | Alerta crítica al operador |
| **Espacio en Disco (`/dev/sda1`)** | `df -h /` | Uso `>= 75%` (`< 48 GB` libres) | Uso `>= 85%` (`< 28 GB` libres) | Cada `15 minutos` | Rotación de dumps locales antiguos (`> 30 días`) + alerta al operador |
| **Conexiones PostgreSQL (`salonpro_db`)** | `pg_stat_activity` | `> 60` conexiones activas | `> 85` conexiones activas (sobre `max_connections = 100`) | Cada `2 minutos` | Alerta de saturación de pool de base de datos |
| **Vigencia Certificado TLS y Respaldo Diario** | Expiración X.509 Caddy / Edad del último archivo `.dump` | TLS `< 14 días` / Backup `> 26 horas` | TLS `< 7 días` / Backup `> 48 horas` | Diario (`08:00 AST`) | Alerta de renovación TLS o fallo de job de backup |

---

## 5. Ensayo de Producción y Promoción del Candidato a `salon_saas_staging` (Bloque 7)

1. **Separación Física de Bases y Roles Verificada en `salonpro_db`**:
   - Bases físicas separadas en el clúster: `salon_saas_prod`, `salon_saas_staging`, `salon_saas_test`.
   - Roles separados sin privilegios de superusuario (`rolsuper = false`, `rolcreaterole = false`, `rolcreatedb = false`):
     - Producción: `salon_saas_prod_owner`, `salon_saas_prod_migrator`, `salon_saas_prod_user`.
     - Staging: `salon_saas_staging_owner`, `salon_saas_staging_migrator`, `salon_saas_staging_user`.
     - Pruebas: `salon_saas_test_owner`, `salon_saas_test_migrator`, `salon_saas_test_user`, `salon_saas_test_runner`.
2. **Retención de Assets y Compatibilidad con Pestañas Anteriores**:
   - `syncDistAssetsCache` ([static_assets.js](file:///c:/Users/spawx/.gemini/antigravity-ide/scratch/salon_saas/backend/utils/static_assets.js)) conserva una caché de las últimas generaciones de bundles en `/assets/*` con `Cache-Control: public, max-age=31536000, immutable`, mientras que `index.html` se sirve siempre con `Cache-Control: no-store, no-cache, must-revalidate`.
3. **Respaldo Previo y Promoción a `salon_saas_staging`**:
   - Todos los gates (`npm run lint`, `npm run build`, `npm run verify:release`, `npm run test:scanner`, `npm run test:runner-guards`, `verify_schema_parity.cjs` y suites E2E de los Bloques 1 a 7) se ejecutaron sobre el commit candidato único antes de promoverlo a `salon_saas_staging`, manteniendo `salon_saas_prod` intacto.
