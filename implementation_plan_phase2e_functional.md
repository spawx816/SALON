# Implementation Plan — Fase 2E: Consolidación Funcional HTTP sin PostgreSQL

## Estado Formal del Sistema
**Estado:**
`FASE 2E CONSOLIDACIÓN FUNCIONAL HTTP COMPLETADA / INFRAESTRUCTURA EN PAUSA`

**Directiva de Infraestructura:**
`VPS / DOCKER / POSTGRESQL / DESPLIEGUE: EN PAUSA HASTA NUEVA AUTORIZACIÓN DEL USUARIO`

> [!IMPORTANT]
> **Restricciones de Pausa Activa:**
> Queda terminantemente prohibido ejecutar:
> - Conexiones SSH
> - Configuración de servidores y hosts remotos
> - Creación de contenedores Docker
> - Conexiones a PostgreSQL (`salon_saas_db` o redes externas)
> - Ejecución de migraciones en bases productivas
> - Preflight contra infraestructura no autorizada
> - Cambios de DNS o dominios
> - Despliegues automatizados (PM2 / CI/CD)
> - Conexión con pasarelas de pago reales
> - Llamadas a servicios web externos de la DGII

---

## 1. Alcance y Arquitectura de la Solución

La **Fase 2E** implementa la consolidación y validación funcional integral del sistema SaaS sin requerir infraestructura externa ni conexiones PostgreSQL, mediante:

1. **Composition Root Desacoplado (`backend/app.js`):**
   - Factoría `createApp({ repositories, paymentGateway, billingScheduler, clock, idGenerator, pool })`.
   - Inyección de dependencias pura; no requiere ni importa `backend/db.js` ni `pg`.
   - Desacople completo entre lógica de negocio, middlewares de seguridad Express y almacenamiento.
2. **Arnés de Pruebas In-Memory (`InMemoryDbMock` & `createInMemoryTestApp`):**
   - Emulación de API relacional con transacciones (`BEGIN`, `COMMIT`, `ROLLBACK`).
   - Servidor HTTP Express real montado sobre un puerto TCP efímero (`server.listen(0)`).
   - Generación de usuarios sintéticos, tokens JWT, sesiones y suscripciones en memoria.
3. **Guardias de Seguridad en Tiempo de Ejecución (Fail-Closed):**
   - Intercepción de `require.cache` para asegurar que `backend/db.js` no se importe.
   - Intercepción de `net.Socket.prototype.connect` para rechazar el puerto PostgreSQL 5432 y cualquier host no local (loopback).
   - Intercepción de `fs.readFileSync` y `fs.readFile` para bloquear lecturas a archivos `.env`.
   - Neutralización y bloqueo de `process.env.DATABASE_URL`.

---

## 2. Los 18 Flujos Funcionales Obligatorios

| # | Flujo Obligatorio | Rutas HTTP Reales | Método | Middleware & Aislamiento | Resultado Esperado |
| :---: | :--- | :--- | :---: | :--- | :---: |
| **1** | Onboarding crea tenant Base y neutraliza intento de forzar Pro | `/api/public/onboarding` | `POST` | Transacción atómica, saneamiento a Plan BASE | `201 Created` / `plan_code = 'BASE'` |
| **2** | Base consulta entitlements correctos | `/api/tenant/entitlements` | `GET` | Autenticación JWT, motor de entitlements | `200 OK` / Límites: 1 sucursal, 3 usuarios |
| **3** | Base utiliza inventario básico | `/api/inventory/products`<br>`/api/inventory/adjustments` | `POST`<br>`POST` | Aislamiento multi-tenant, rol admin/owner | `201 Created`<br>`200 OK` / Stock reflejado |
| **4** | Base recibe 403 al intentar CRM, membresías o inventario avanzado | `/api/clients`<br>`/api/plans`<br>`/api/inventory/transfers` | `GET`<br>`GET`<br>`POST` | `requirePlanFeature('clients')`<br>`requirePlanFeature('memberships')`<br>`requirePlanFeature('inventory_advanced')` | `403 Forbidden` (`FEATURE_NOT_INCLUDED`) |
| **5** | Upgrade Base → Pro con pago fake habilita funciones Pro | `/api/saas/billing/payment-methods`<br>`/api/saas/billing/subscription/upgrade` | `POST`<br>`POST` | Prorrateo determinista UTC, gateway fake | `201 Created`<br>`200 OK` / Entitlements Pro activos |
| **6** | Repetir upgrade no duplica factura ni cobro | `/api/saas/billing/subscription/upgrade` | `POST` | Encabezado `Idempotency-Key` | `200 OK` / Sin duplicar cobro ni factura |
| **7** | Downgrade se bloquea si excede usuarios o sucursales | `/api/saas/billing/subscription/downgrade` | `POST` | Validación estricta de límites de recursos | `409 Conflict` (`RESOURCE_LIMIT_EXCEEDED`) |
| **8** | Pago fallido cambia a `past_due` | Simulación ciclo de cobro | Interno | Transición de estado de suscripción | Estado `past_due` con 5 días de gracia |
| **9** | Durante gracia conserva acceso | `/api/tenant/entitlements` | `GET` | Verificación de `grace_period_until > now` | `200 OK` / `isSuspended: false` |
| **10** | Gracia vencida cambia a `suspended` | `/api/tenant/entitlements` | `GET` | Reloj simulado tras vencimiento de gracia | `200 OK` / `isSuspended: true` |
| **11** | Suspensión bloquea módulos comerciales, pero conserva login y facturación | `/api/clients`<br>`/api/saas/billing/subscription` | `GET`<br>`GET` | Entitlements fail-closed | Comercial: `403 Forbidden`<br>Facturación: `200 OK` |
| **12** | Pago exitoso reactiva el tenant | `/api/saas/billing/invoices/:id/pay` | `POST` | Registro de pago, resolución de deuda | `200 OK` / Estado restaurado a `active` |
| **13** | Venta POS descuenta stock una sola vez | `/api/visits/:id/checkout` | `POST` | Idempotency key en movimiento de inventario | `200 OK` / Stock deducido exactamente 1 vez |
| **14** | Anulación repone stock una sola vez | `/api/visits/:id/void` | `POST` | Idempotency key en reposición de anulación | `200 OK` / Stock repuesto exactamente 1 vez |
| **15** | Tenant A no consulta ni modifica recursos de Tenant B | `/api/saas/billing/invoices/:id`<br>`/api/inventory/products/:id` | `GET`<br>`PUT` | Anti-IDOR estricto (`WHERE tenant_id = ?`) | `404 Not Found` / Spoofing: `403 Forbidden` |
| **16** | Webhook firmado se procesa una sola vez | `/api/saas/billing/webhooks/fake` | `POST` | Verificación HMAC SHA-256 e idempotencia | Sin firma: `401`<br>Con firma: `200 OK` idempotente |
| **17** | SuperAdmin puede realizar operaciones autorizadas y auditadas | `/api/saas/metrics`<br>`/api/saas/billing/admin/extend-grace` | `GET`<br>`POST` | `requireSuperAdmin`, registro de auditoría | `200 OK` / Auditoría en base de datos |
| **18** | Administrador de salón no puede modificar su plan directamente | `/api/saas/tenants/:id/subscription` | `PATCH` | RBAC: Exclusivo para SuperAdmin | `403 Forbidden` |

---

## 3. Plan de Verificación y Criterios de Aceptación

1. **Cero Conexiones Externas y Cero PostgreSQL:** Las guardias activas verifican que ninguna llamada salga del loopback y que el pool PostgreSQL no sea importado ni instanciado.
2. **Suite Unificada:** Ejecución de `backend/tests/test_phase2e_functional_http.cjs` con 35/35 pruebas aprobadas.
3. **No Regresión:** Todas las suites unitarias de fases previas (`test:phase2a:unit`, `test:phase2b:unit`, `test:phase2d:unit`, `test:runner-guards`, `test:scanner`) deben permanecer en 100% PASS.
4. **Calidad de Código y Compilación:** Cero errores en `npm run lint` y compilación limpia en `npm run build`.
