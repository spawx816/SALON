# Fase 2D — Facturación del SaaS y Ciclo de Suscripción Base/Pro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar de forma desacoplada y robusta el sistema de facturación recurrente B2B, máquina de estados de suscripción (`TRIALING`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`, `CANCELLED`, `EXPIRED`), cálculo de prorrateo para upgrades `BASE` <-> `PRO`, ciclo de dunning (reintentos de cobro y gracia), adaptadores de pasarela de pago (con `FakePaymentGatewayAdapter` para pruebas unitarias) y control estricto de acceso basado en estado de facturación, sin dependencias externas ni conexión a PostgreSQL.

**Architecture:** Arquitectura hexagonal / modular basada en puertos y adaptadores. Los servicios de dominio (`SaasBillingService`, `SubscriptionLifecycleService`, `ProrationEngine`) interactúan con repositorios abstractos (`SaasBillingRepository`) y con un puerto de pagos (`PaymentGatewayPort`). Para pruebas y desarrollo local se provee un `FakePaymentGatewayAdapter` con simulación determinista de cobros, rechazos, reembolsos y webhooks idempotentes. Los eventos de facturación actualizan el estado de la suscripción (`tenant_subscriptions`), lo que se refleja de forma inmediata y automática en el motor de entitlements de Fase 2A.

**Tech Stack:** Node.js (CommonJS / ES Modules híbrido), Express.js, React 19 + Vite (UI de facturación y checkout del SaaS), suite de pruebas unitarias TDD en memoria (Node `assert`).

**Spec:** Especificación de Fase 2D: Facturación SaaS multi-tenant, exactamente dos planes B2B (`BASE` y `PRO`), ciclo de vida de suscripción, dunning, adaptadores desacoplados de pasarelas, prorrateo matemático exacto, anti-IDOR estricto y cero conexiones a PostgreSQL operativo.

---

## Global Constraints

- **Modelo Comercial B2B Inalterable**: Exclusivamente planes `BASE` y `PRO`. Prohibido crear Enterprise, Premium u otros tiers.
- **Aislamiento Físico y Cero Conexiones**: PROHIBIDO conectar o consultar `salon_saas_db`, ejecutar migraciones o alterar la base operativa. Toda persistencia para pruebas debe residir en repositorios en memoria (fakes).
- **Independencia de Pasarelas**: Cero dependencias de APIs en vivo de Stripe, CardNet u otras pasarelas. Toda interacción monetaria se canaliza a través de la interfaz `PaymentGatewayPort` con `FakePaymentGatewayAdapter`.
- **Aislamiento Multi-Tenant**: Toda tabla tenant-scoped debe incluir `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE` con índices B-Tree primarios.
- **Protección Anti-IDOR**: Las rutas deben resolver `tenantId` exclusivamente desde el JWT autenticado (`req.tenantId`), ignorando cualquier valor provisto en headers, query string o payload.
- **Idempotencia Estricta**: Cada cobro, reintento o evento de webhook debe poseer una `idempotency_key` única. Operaciones repetidas deben devolver el resultado existente sin duplicar cobros ni facturas.
- **Fail-Closed**: Ante fallos de pago que excedan el período de gracia o estados `SUSPENDED`/`EXPIRED`, el motor de entitlements debe revocar inmediatamente el acceso a funcionalidades protegidas.

---

## Review Focus

1. **Doble cobro por reintentos de red o webhooks duplicados**: Un fallo de conexión o la entrega múltiple del mismo webhook de pasarela genera cargos duplicados si no se valida la clave de idempotencia antes de procesar el pago.
2. **Desviación en cálculo de prorrateo mid-month**: En transiciones `BASE -> PRO` a mitad de mes, el cálculo de crédito no consumido de Base y nuevo cargo de Pro debe prorratearse matemáticamente por días exactos y redondearse a 2 decimales sin dar saldos negativos.
3. **Bloqueo prematuro vs uso no remunerado en dunning**: El primer fallo de cobro no debe suspender al cliente inmediatamente (debe entrar a `PAST_DUE` con ventana de gracia de 5 días); sin embargo, una vez vencida la gracia sin regularización, el sistema debe bloquear el acceso de inmediato (`SUSPENDED`).
4. **Downgrade `PRO -> BASE` con recursos excedidos**: Si un salón con Plan Pro tiene 4 sucursales o 10 usuarios intenta bajar a Base (que permite máx 1 sucursal y 3 usuarios), el downgrade debe bloquearse informando los recursos que debe desprovisionar antes del cambio.
5. **Anti-IDOR en consulta o pago de facturas SaaS**: Un Tenant A malicioso no debe poder consultar, descargar ni pagar la factura SaaS del Tenant B mediante manipulación de parámetros en `/api/saas/invoices/:id`.

---

## File Structure

```text
backend/
├── migrations/
│   └── 20261109_phase2d_saas_billing.cjs                 # Migración DDL idempotente (NO ejecutada)
├── services/
│   ├── saas_billing.constants.js                         # Constantes: precios, ciclos, estados, errores
│   ├── payment_gateway.port.js                           # Contrato de puerto para pasarelas de pago
│   ├── fakes/
│   │   └── fake_payment_gateway.adapter.js               # Adaptador simulado en memoria determinista
│   ├── proration_engine.js                               # Motor matemático de prorrateo
│   ├── saas_billing.service.js                           # Gestión de facturas SaaS, cobros y recibos
│   └── subscription_lifecycle.service.js                 # Máquina de estados, dunning y sincronización
├── repositories/
│   ├── saas_billing.repository.js                        # Contrato de repositorio de facturación SaaS
│   └── fakes/
│       └── in_memory_saas_billing.repository.js          # Fake in-memory con Maps por tenant
├── routes/
│   └── saas_billing.routes.js                            # Endpoints REST de facturación y webhook
└── tests/
    └── test_phase2d_saas_billing_unit.cjs                # Suite unitaria TDD exhaustiva (30+ tests)

src/
├── components/
│   └── saas/
│       ├── SaasBillingModule.jsx                         # Portal de facturación del salón (Base y Pro)
│       └── SaasUpgradeModal.jsx                          # Modal de cambio de plan con desglose de prorrateo
└── utils/
    └── dataService.js                                    # Métodos cliente API de facturación SaaS
```

---

## Task Breakdown

### Task 1: DDL Migration (Idempotente, NO Ejecutada)

**Files:**
- Create: `backend/migrations/20261109_phase2d_saas_billing.cjs`

**Requirements:**
- Definir tablas:
  - `saas_payment_methods`: `id`, `tenant_id`, `gateway_type`, `token_reference`, `last4`, `brand`, `exp_month`, `exp_year`, `is_default`, `created_at`.
  - `saas_invoices`: `id`, `tenant_id`, `invoice_number`, `subscription_id`, `plan_code`, `billing_cycle`, `period_start`, `period_end`, `subtotal`, `tax`, `total`, `amount_paid`, `amount_due`, `currency`, `status` (`DRAFT`, `OPEN`, `PAID`, `VOID`, `UNCOLLECTIBLE`), `due_date`, `paid_at`, `created_at`.
  - `saas_invoice_items`: `id`, `tenant_id`, `invoice_id`, `description`, `item_type` (`PLAN_FEE`, `PRORATION_CHARGE`, `PRORATION_CREDIT`, `OVERAGE`), `amount`, `created_at`.
  - `saas_payments`: `id`, `tenant_id`, `invoice_id`, `amount`, `currency`, `gateway_reference`, `status` (`PENDING`, `SUCCESS`, `FAILED`, `REFUNDED`), `failure_code`, `failure_message`, `idempotency_key`, `created_at`.
  - `saas_billing_events`: `id`, `tenant_id`, `event_type`, `payload`, `idempotency_key`, `created_at`.
- Restricciones:
  - Cada tabla con `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`.
  - Índices B-Tree con `tenant_id` en primera posición.
  - Clave UNIQUE en `(tenant_id, invoice_number)` y `(tenant_id, idempotency_key)`.

- [ ] Crear archivo de migración DDL con estructura completa y cláusulas idempotentes `CREATE TABLE IF NOT EXISTS`.
- [ ] Verificar sintaxis JavaScript con `node -c backend/migrations/20261109_phase2d_saas_billing.cjs`.

---

### Task 2: Constantes Canónicas y Precios de Suscripción

**Files:**
- Create: `backend/services/saas_billing.constants.js`

**Requirements:**
- Definir:
  - `BILLING_CYCLES`: `MONTHLY: 'monthly'`, `ANNUAL: 'annual'`.
  - `INVOICE_STATUS`: `DRAFT: 'draft'`, `OPEN: 'open'`, `PAID: 'paid'`, `VOID: 'void'`, `UNCOLLECTIBLE: 'uncollectible'`.
  - `PAYMENT_STATUS`: `PENDING: 'pending'`, `SUCCESS: 'success'`, `FAILED: 'failed'`, `REFUNDED: 'refunded'`.
  - `SAAS_PLAN_PRICING`:
    - `BASE`: `{ monthly: { DOP: 2900, USD: 49 }, annual: { DOP: 29000, USD: 490 } }` (2 meses bonificados en anual).
    - `PRO`: `{ monthly: { DOP: 5900, USD: 99 }, annual: { DOP: 59000, USD: 990 } }` (2 meses bonificados en anual).
  - `DUNNING_POLICY`:
    - `GRACE_PERIOD_DAYS`: 5.
    - `MAX_RETRY_ATTEMPTS`: 3.
    - `RETRY_INTERVALS_DAYS`: `[1, 3, 5]`.
  - Funciones puras de validación de moneda (`DOP`, `USD`), ciclos y cálculo de fechas de período.

- [ ] Escribir `saas_billing.constants.js` exportando enumeraciones y matrices de precios congeladas con `Object.freeze`.
- [ ] Validar sintaxis con `node -c backend/services/saas_billing.constants.js`.

---

### Task 3: Puerto de Pasarela de Pagos y Adaptador Simulado (Fake)

**Files:**
- Create: `backend/services/payment_gateway.port.js`
- Create: `backend/services/fakes/fake_payment_gateway.adapter.js`

**Requirements:**
- `PaymentGatewayPort`: Interface abstracta con métodos obligatorios:
  - `tokenizePaymentMethod({ tenantId, cardNumber, expMonth, expYear, cvc, brand })`
  - `charge({ tenantId, amount, currency, customerId, paymentMethodId, idempotencyKey, description })`
  - `refund({ tenantId, chargeId, amount, reason, idempotencyKey })`
  - `verifyWebhookSignature(payload, signature, secret)`
- `FakePaymentGatewayAdapter`:
  - Almacena tarjetas simuladas en memoria (tokens tipo `tok_fake_...`).
  - Simula cobros exitosos y escenarios de prueba configurables (e.g. tarjeta terminada en `0002` rechaza fondos insuficientes, `0003` error de red, `0004` tarjeta expirada).
  - Verificación de idempotencia estricta por `idempotencyKey`: si se envía la misma clave dos veces, devuelve la respuesta previa idéntica sin crear un nuevo cobro.
  - Cero dependencias de librerías externas o conexión a Internet.

- [ ] Implementar `payment_gateway.port.js` con validaciones de interfaz.
- [ ] Implementar `fake_payment_gateway.adapter.js` con soporte para escenarios de éxito, rechazo determinista e idempotencia.
- [ ] Verificar sintaxis con `node -c`.

---

### Task 4: Repositorio de Facturación SaaS y Fake In-Memory

**Files:**
- Create: `backend/repositories/saas_billing.repository.js`
- Create: `backend/repositories/fakes/in_memory_saas_billing.repository.js`

**Requirements:**
- Repositorio abstracto con métodos:
  - Métodos de pago: `savePaymentMethod`, `getPaymentMethodsByTenant`, `getDefaultPaymentMethod`, `setDefaultPaymentMethod`, `deletePaymentMethod`.
  - Facturas: `createInvoice`, `getInvoiceById`, `listInvoicesByTenant`, `updateInvoiceStatus`, `getNextInvoiceNumber`.
  - Pagos: `recordPayment`, `getPaymentById`, `listPaymentsByInvoice`, `updatePaymentStatus`.
  - Eventos de auditoría de facturación: `recordBillingEvent`, `getBillingEventByIdempotencyKey`.
- `InMemorySaasBillingRepository`:
  - Contenedores Map aislados estrictamente por `tenantId`.
  - Generación de secuencias consecutivas de facturas (`INV-2026-0001`, etc.) por tenant.
  - Fail-closed ante accesos cruzados de tenant (retorna null / 404).

- [ ] Crear contrato `saas_billing.repository.js`.
- [ ] Crear implementación `in_memory_saas_billing.repository.js` asegurando aislamiento multi-tenant en memoria.
- [ ] Verificar sintaxis con `node -c`.

---

### Task 5: Motor de Prorrateo, Ciclo de Suscripción y Facturación

**Files:**
- Create: `backend/services/proration_engine.js`
- Create: `backend/services/subscription_lifecycle.service.js`
- Create: `backend/services/saas_billing.service.js`

**Requirements:**
- `ProrationEngine`:
  - Función matemática pura: `calculateProration({ currentPlan, newPlan, billingCycle, periodStart, periodEnd, effectiveDate, currency })`.
  - Días totales del período vs días consumidos vs días restantes.
  - Crédito proporcional no utilizado del plan anterior:
    $$\text{Crédito} = \frac{\text{Días Restantes}}{\text{Días Totales}} \times \text{Precio Plan Actual}$$
  - Cargo proporcional del nuevo plan:
    $$\text{Cargo} = \frac{\text{Días Restantes}}{\text{Días Totales}} \times \text{Precio Nuevo Plan}$$
  - Importe neto a pagar: $\max(0, \text{Cargo} - \text{Crédito})$, redondeado a 2 decimales.
- `SubscriptionLifecycleService`:
  - Máquina de estados: `TRIALING`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`, `CANCELLED`, `EXPIRED`.
  - Manejo de fallos de cobro: transición a `PAST_DUE`, registro de fecha de vencimiento de gracia (`grace_period_until = now + 5 days`).
  - Evaluación de gracia: si `now > grace_period_until`, transiciona automáticamente a `SUSPENDED` y sincroniza con `tenant_subscriptions` para revocar features en el motor de Entitlements de Fase 2A.
  - Downgrade con guardia de recursos: comprueba que el tenant no exceda 1 sucursal y 3 usuarios antes de permitir `PRO -> BASE`. Si excede, rechaza con `RESOURCE_LIMIT_EXCEEDED` detallando el exceso.
- `SaasBillingService`:
  - Emisión de facturas recurrentes y prorrateadas.
  - Procesamiento de cobro con `PaymentGatewayPort`: en caso de éxito marca factura como `PAID`, registra `saas_payments`, y reactiva la suscripción a `ACTIVE`.
  - Procesamiento de webhooks con firma criptográfica y guard de idempotencia.

- [ ] Escribir `proration_engine.js` con pruebas unitarias de casos de borde (fin de mes, bisiestos).
- [ ] Escribir `subscription_lifecycle.service.js` integrando máquina de estados y sincronización con Phase 2A.
- [ ] Escribir `saas_billing.service.js` orquestando facturación, cobros e idempotencia.
- [ ] Verificar sintaxis con `node -c`.

---

### Task 6: Rutas REST de Facturación SaaS y Servidor

**Files:**
- Create: `backend/routes/saas_billing.routes.js`
- Modify: `backend/server.js` (montar `/api/saas/billing`)

**Requirements:**
- Endpoints del Tenant:
  - `GET /api/saas/billing/subscription`: Estado actual de suscripción, plan, ciclo, fecha de renovación, días de gracia.
  - `POST /api/saas/billing/subscription/upgrade`: Solicitar upgrade `BASE -> PRO` con cálculo de prorrateo y cobro inmediato.
  - `POST /api/saas/billing/subscription/downgrade`: Solicitar downgrade `PRO -> BASE` con validación previa de límites de sucursales y usuarios.
  - `POST /api/saas/billing/subscription/cancel`: Cancelación al final del período contratado.
  - `GET /api/saas/billing/invoices`: Historial de facturas SaaS del tenant autenticado.
  - `GET /api/saas/billing/invoices/:id`: Detalle y descarga de factura específica (con guard Anti-IDOR: `tenant_id === req.tenantId`).
  - `POST /api/saas/billing/invoices/:id/pay`: Intentar cobro manual de factura vencida con tarjeta predeterminada.
  - `POST /api/saas/billing/payment-methods`: Tokenizar y asociar tarjeta de crédito/débito.
- Endpoints de SuperAdmin:
  - `POST /api/superadmin/subscriptions/:tenantId/extend-grace`: Conceder prórroga de gracia extraordinaria con motivo justificado.
  - `POST /api/superadmin/subscriptions/:tenantId/record-manual-payment`: Asentar pago offline por transferencia bancaria o efectivo y reactivar suscripción.
- Endpoint Webhook:
  - `POST /api/saas/billing/webhooks`: Recepción de eventos de pasarela con verificación de firma e idempotencia estricta.

- [ ] Implementar `backend/routes/saas_billing.routes.js` con protecciones anti-IDOR y middleware de roles.
- [ ] Montar la ruta en `backend/server.js`.
- [ ] Verificar sintaxis con `node -c backend/routes/saas_billing.routes.js`.

---

### Task 7: Frontend UI — Módulo de Facturación SaaS

**Files:**
- Create: `src/components/saas/SaasBillingModule.jsx`
- Create: `src/components/saas/SaasUpgradeModal.jsx`
- Modify: `src/App.jsx` (registrar ruta `/billing` y navegación en menú)
- Modify: `src/utils/dataService.js` (añadir llamadas API de facturación SaaS)

**Requirements:**
- `SaasBillingModule.jsx`:
  - Panel visual de estado de suscripción: Badge con estado (`Activo`, `En período de gracia`, `Suspendido`, `Cancelado`).
  - Detalles del Plan: Nombre (`BASE` o `PRO`), ciclo (`Mensual` o `Anual`), costo y fecha de próxima facturación.
  - Alerta destacada en estado `PAST_DUE` mostrando los días restantes de gracia y botón de "Actualizar Método de Pago".
  - Bloqueo informativo en estado `SUSPENDED` indicando que las operaciones comerciales están congeladas hasta regularizar pago.
  - Gestión de Tarjeta Registrada (muestra últimos 4 dígitos, marca, vencimiento, botón de cambiar).
  - Tabla de Facturas Históricas con estado, número, fecha, monto y botón para ver detalle / imprimir recibo.
  - Botón de Cambio de Plan (`Upgrade a Pro` o `Downgrade a Base`).
- `SaasUpgradeModal.jsx`:
  - Desglose transparente del cálculo de prorrateo antes de confirmar:
    - Cargo proporcional del nuevo plan.
    - Crédito deducido del plan actual.
    - Total neto a pagar en el momento.
  - Confirmación con indicador de progreso y manejo de errores.

- [ ] Implementar componentes React accesibles y responsivos adaptados al diseño SaaS.
- [ ] Agregar métodos en `src/utils/dataService.js`.
- [ ] Registrar rutas en `src/App.jsx`.

---

### Task 8: Suite Unitaria TDD Exhaustiva en Memoria (30+ Casos)

**Files:**
- Create: `backend/tests/test_phase2d_saas_billing_unit.cjs`

**Requirements:**
- Desarrollar suite de 30 casos de prueba unitarios en memoria verificando:
  1. Emisión correcta de factura mensual para Plan BASE (DOP 2,900 / USD 49).
  2. Emisión correcta de factura mensual para Plan PRO (DOP 5,900 / USD 99).
  3. Descuento aplicado en ciclo anual Base y Pro (2 meses bonificados).
  4. Cálculo de prorrateo matemático exacto en upgrade `BASE -> PRO` a mitad de ciclo.
  5. Cálculo de prorrateo sin saldos negativos ni inconsistencias de centavos.
  6. Downgrade `PRO -> BASE` bloqueado si el tenant tiene más de 1 sucursal (`RESOURCE_LIMIT_EXCEEDED`).
  7. Downgrade `PRO -> BASE` bloqueado si el tenant tiene más de 3 usuarios (`RESOURCE_LIMIT_EXCEEDED`).
  8. Downgrade `PRO -> BASE` exitoso a fin de ciclo si el tenant cumple los límites.
  9. Transición a `PAST_DUE` tras fallo de cobro simulado.
  10. Concesión de período de gracia (5 días) en `PAST_DUE` con acceso operativo habilitado.
  11. Transición automática a `SUSPENDED` tras expirar período de gracia y agotarse los 3 reintentos.
  12. Estado `SUSPENDED` bloquea funcionalidades en el motor de Entitlements (fail-closed).
  13. Cancelación voluntaria mantiene estado activo hasta `current_period_end`.
  14. Llegada de `current_period_end` en suscripción cancelada transiciona a `EXPIRED`.
  15. Idempotencia en cobro: misma `idempotency_key` no genera doble cargo en pasarela.
  16. Idempotencia en webhook: repetición de webhook de cobro no duplica pago ni asienta doble factura.
  17. Tokenización y almacenamiento seguro de método de pago simulado.
  18. Reintento manual de pago de factura vencida reactiva suscripción a `ACTIVE`.
  19. Reembolso total de factura SaaS actualiza estado a `REFUNDED`.
  20. Reembolso parcial de factura SaaS registra importe reembolsado.
  21. SuperAdmin registra pago manual (transferencia bancaria) y levanta suspensión.
  22. SuperAdmin extiende período de gracia extraordinario registrando justificación de auditoría.
  23. Anti-IDOR: Tenant A no puede consultar ni descargar factura de Tenant B (HTTP 404).
  24. Anti-IDOR: Tenant A no puede pagar factura de Tenant B.
  25. `req.tenantId` inmune a inyección vía `x-tenant-id`, query params o body.
  26. Errores de pasarela no controlados fallan cerrado (fail-closed).
  27. Migración DDL contiene FK `tenant_id -> tenants(id) ON DELETE CASCADE`.
  28. Índices B-Tree de facturación tienen `tenant_id` en posición primaria.
  29. No existen planes Enterprise, Premium u otros tiers en constantes ni precios.
  30. Transiciones no permitidas en la máquina de estados fallan de forma estricta.

- [ ] Escribir la suite completa en `backend/tests/test_phase2d_saas_billing_unit.cjs`.
- [ ] Configurar script npm `"test:phase2d:unit": "node backend/tests/test_phase2d_saas_billing_unit.cjs"` en `package.json`.

---

### Task 9: Actualización del Scanner AST, Verificación y Build

**Files:**
- Modify: `backend/scripts/ast_multitenant_scanner.cjs` (agregar tablas de facturación SaaS a `TENANT_OWNED_TABLES`)
- Modify: `backend/tests/fixtures_scanner/fixture_9_unscoped_billing.js` (fixture negativa para facturación)
- Modify: `backend/scripts/test_scanner_negative_suite.cjs` (verificar fixture 9)

**Requirements:**
- Ejecutar suite de verificación completa:
  - `npm run test:phase2d:unit` -> 30/30 aprobadas.
  - `npm run test:phase2b:unit` -> 40/40 aprobadas.
  - `npm run test:phase2a:unit` -> 28/28 aprobadas.
  - `npm run test:scanner` -> 9/9 fixtures negativas + todos los archivos runtime sin violaciones.
  - `npm run test:runner-guards` -> 17/17 aprobadas.
  - `npm run lint` -> 0 errores.
  - `npm run build` -> compilación exitosa.

- [ ] Añadir fixture 9 negativa y actualizar suite de escaneo AST.
- [ ] Ejecutar verificaciones estáticas completas sin tocar PostgreSQL.

