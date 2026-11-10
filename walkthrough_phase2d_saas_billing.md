# Walkthrough Técnico: Fase 2D — Facturación del SaaS y Ciclo de Suscripción Base/Pro

## 1. Resumen Ejecutivo y Estado Formal

> **ESTADO FORMAL**:  
> **`FASE 2D IMPLEMENTADA EN CÓDIGO Y PRUEBAS UNITARIAS / BASE + PRO / SIN PAN/CVC / SIN PASARELA REAL / SIN POSTGRESQL`**

Se implementó de extremo a extremo la **Fase 2D: Facturación del SaaS y Ciclo de Suscripción Base/Pro**, gobernando el ciclo de vida de cobro B2B, la máquina de estados canónica de suscripción, el cálculo de prorrateo determinista para upgrades y downgrades, el ciclo de dunning con reintentos y períodos de gracia, la emisión de facturas con snapshot de precios y la arquitectura desacoplada de pagos mediante el puerto `PaymentGatewayPort` con `FakePaymentGatewayAdapter`.

La persistencia y lógica de dominio residen en repositorios y fakes en memoria aislados por tenant, respaldados por una suite TDD de **35 pruebas unitarias automatizadas con cobertura del 100%** de los casos exigidos. La base operativa `salon_saas_db` se mantuvo **100% intacta, no contactada ni consultada**, y ninguna migración física ha sido ejecutada.

---

## 2. Invariantes y Reglas Canónicas Implementadas

### 2.1 Estados de Suscripción Unificados con Fase 2A
Se reutiliza la suscripción de `tenant_subscriptions` creada en Fase 2A como **única fuente de verdad**:
- **`active`**: Acceso comercial normal a todas las funcionalidades del plan.
- **`past_due`**: Acceso comercial temporal permitido **únicamente mientras `grace_period_until` sea una fecha futura** (5 días de gracia tras fallo de cobro). Si la gracia expira sin saldarse la deuda, el acceso se bloquea de inmediato.
- **`suspended`**: Acceso a módulos comerciales congelado (fail-closed en Entitlements). Las rutas del portal de facturación ([`backend/routes/saas_billing.routes.js`](backend/routes/saas_billing.routes.js)), actualización de tarjeta y pago de facturas pendientes permanecen **siempre accesibles** para permitir la regularización.
- **`cancelled`**: Acceso comercial mantenido hasta el final del período contratado (`current_period_end`).
- **`expired`**: Período finalizado sin renovación; acceso comercial bloqueado.
- **SuperAdmin y Recuperación de Cuenta**: Inmunes a bloqueos de entitlements o suspensión de tenant.
- **Prohibición de `trialing`**: No existe en el código ni puede forzarse; salon_saas no cuenta con política de prueba gratuita aprobada.

### 2.2 Dinero y Monedas en Unidades Menores
- Cero uso de `Number`, floats o decimales binarios para cálculos monetarios.
- Almacenamiento en `amount_minor BIGINT` (centavos enteros) y `currency CHAR(3)`.
- **Listas de Precios Independientes (Sin Conversión DOP/USD)**:
  - **Plan BASE**:
    - Mensual DOP: `290000` (RD$ 2,900.00) | Mensual USD: `4900` (US$ 49.00)
    - Anual DOP: `2900000` (RD$ 29,000.00) | Anual USD: `49000` (US$ 490.00)
  - **Plan PRO**:
    - Mensual DOP: `590000` (RD$ 5,900.00) | Mensual USD: `9900` (US$ 99.00)
    - Anual DOP: `5900000` (RD$ 59,000.00) | Anual USD: `99000` (US$ 990.00)
- **Snapshot de Versión**: Cada factura almacena `price_book_version: 'v1_2026'`, `unit_price_minor` y `currency` para preservar la inmutabilidad histórica frente a futuros aumentos de precio.

### 2.3 Política Fiscal Abstracta
- Interfaz `BillingTaxPolicy` e implementación de pruebas [`backend/services/tax_policy.js`](backend/services/tax_policy.js) (`ZeroTaxPolicy`).
- No se asume ni hardcodea ITBIS hasta contar con el dictamen contable/legal definitivo.

### 2.4 Cumplimiento PCI DSS: Cero PAN / CVC
- Eliminación total de `cardNumber` y `cvc` en [`backend/services/payment_gateway.port.js`](backend/services/payment_gateway.port.js) y en todo el backend.
- El backend procesa exclusivamente tokens opacos (`paymentMethodToken` e.g. `pm_fake_...`) y referencias de cliente (`providerCustomerReference`).
- Se verificó mediante prueba automatizada de escaneo regex la **ausencia total de patrones PAN de 16 dígitos y CVC** en todo el estado en memoria, eventos y código fuente.

### 2.5 Reembolsos Parciales y Totales ([`backend/migrations/20261109_phase2d_saas_billing.cjs`](backend/migrations/20261109_phase2d_saas_billing.cjs))
- Entidad `saas_refunds` auditada por tenant.
- Regla: Un reembolso parcial **no marca el pago como `REFUNDED`**, sino como **`PARTIALLY_REFUNDED`**. Solo cuando el acumulado de reembolsos iguala el monto total pagado, se marca como `REFUNDED`.
- Rechazo estricto si el reembolso excede el saldo pagado disponible (`REFUND_EXCEEDS_PAYMENT`).

### 2.6 Webhooks Seguros y Anti-Tamper
- Verificación criptográfica de firma HMAC-SHA256 sobre el raw body de la petición HTTP.
- **Resolución Interna del Tenant**: Se rechaza o ignora cualquier `tenant_id` enviado en el payload del webhook. El tenant se resuelve internamente mediante el `provider_customer_id` registrado previamente.
- **Idempotencia**: Detección y respuesta inmediata 200 ante reintentos del mismo `eventId` sin reprocesar.
- Persistencia de eventos sanitizados (cero tokens sensibles o firmas completas).

### 2.7 Prorrateo Matemático UTC Determinista
- Período semi-abierto `[period_start, period_end)` con timestamps UTC.
- `effective_at` incluido en el nuevo plan.
- Cálculo de crédito no consumido (floor) y cargo del nuevo plan (ceil) en unidades menores.
- Cero facturas con montos negativos (créditos excedentes se acreditan al saldo del tenant).
- Cero facturas con monedas mixtas.
- Pruebas superadas en febrero bisiesto (29 días), febrero estándar (28 días), meses de 30/31 días, primer día ($R = D$) y último día ($R = 0$).

### 2.8 Numeración Atómica de Facturas por Tenant
- Contador secuencial por tenant y año (`saas_invoice_counters`), generando `INV-2026-00001`, `INV-2026-00002` correlativamente. Prohibido el uso de `MAX(invoice_number) + 1`.

### 2.9 Guardia de Recursos en Downgrade
- El intento de downgrade `PRO -> BASE` valida el consumo real de recursos mediante `entitlementsRepo`. Si el salón posee más de 1 sucursal o más de 3 usuarios, se aborta con error **`RESOURCE_LIMIT_EXCEEDED`** detallando los recursos que deben desprovisionarse.
- Si cumple los límites, el downgrade se programa para entrar en vigencia al final del ciclo actual (`current_period_end`).

---

## 3. Arquitectura y Componentes Desarrollados

### 3.1 Servicios de Dominio y Constantes
- [`backend/services/saas_billing.constants.js`](backend/services/saas_billing.constants.js): Libro canónico de precios en centavos, estados, ciclos y políticas de dunning.
- [`backend/services/tax_policy.js`](backend/services/tax_policy.js): Interfaz `BillingTaxPolicy` y clase `ZeroTaxPolicy`.
- [`backend/services/proration_engine.js`](backend/services/proration_engine.js): Motor matemático puro con redondeo determinista.
- [`backend/services/subscription_lifecycle.service.js`](backend/services/subscription_lifecycle.service.js): Máquina de estados, dunning, cálculo de gracia, downgrade con límites y sincronización con Phase 2A.
- [`backend/services/saas_billing.service.js`](backend/services/saas_billing.service.js): Emisión de facturas con snapshot, cobro con idempotencia, upgrades con prorrateo, reembolsos y webhooks seguros.

### 3.2 Puertos y Adaptadores (Hexagonal)
- **Pasarela de Pago**:
  - Puerto: [`backend/services/payment_gateway.port.js`](backend/services/payment_gateway.port.js)
  - Fake: [`backend/services/fakes/fake_payment_gateway.adapter.js`](backend/services/fakes/fake_payment_gateway.adapter.js)
- **Planificador de Tareas**:
  - Puerto: [`backend/services/billing_job_scheduler.port.js`](backend/services/billing_job_scheduler.port.js)
  - Fake: [`backend/services/fakes/fake_billing_job_scheduler.adapter.js`](backend/services/fakes/fake_billing_job_scheduler.adapter.js)
- **Persistencia**:
  - Contrato: [`backend/repositories/saas_billing.repository.js`](backend/repositories/saas_billing.repository.js)
  - Fake en memoria: [`backend/repositories/fakes/in_memory_saas_billing.repository.js`](backend/repositories/fakes/in_memory_saas_billing.repository.js)

### 3.3 Rutas y Servidor
- [`backend/routes/saas_billing.routes.js`](backend/routes/saas_billing.routes.js): Montado en `/api/saas/billing` en [`backend/server.js`](backend/server.js).
- Serialización segura de `BigInt` a `String` en respuestas JSON.

### 3.4 Migración DDL Idempotente (Creada, NO Ejecutada)
- [`backend/migrations/20261109_phase2d_saas_billing.cjs`](backend/migrations/20261109_phase2d_saas_billing.cjs):
  - Extensión de `tenant_subscriptions` (`currency`, `billing_cycle`, `grace_period_until`, `scheduled_downgrade_plan`, `price_book_version`).
  - 9 tablas tenant-owned creadas con `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE` e índices B-Tree primarios.

### 3.5 Frontend SaaS de Facturación
- [`src/components/saas/SaasBillingModule.jsx`](src/components/saas/SaasBillingModule.jsx): Vista de facturación, estado de gracia/suspensión, tarjeta registrada y tabla de facturas.
- [`src/components/saas/SaasUpgradeModal.jsx`](src/components/saas/SaasUpgradeModal.jsx): Modal transparente de upgrade/downgrade con desglose de prorrateo.
- Métodos agregados en [`src/utils/dataService.js`](src/utils/dataService.js).
- Lazy routes `/billing` y `/facturacion-saas` registradas en [`src/App.jsx`](src/App.jsx).

---

## 4. Evidencia de Verificación y Pruebas Unitarias

```powershell
# 1. Suite Unitaria Fase 2D (Facturación SaaS y Ciclo de Suscripción)
npm run test:phase2d:unit
# Resultado: 35 / 35 casos aprobados (EXIT 0)

# 2. Suite Unitaria Fase 2B (Inventario Multi-Tenant)
npm run test:phase2b:unit
# Resultado: 40 / 40 casos aprobados (EXIT 0)

# 3. Suite Unitaria Fase 2A (Entitlements y 2 Planes)
npm run test:phase2a:unit
# Resultado: 28 / 28 casos aprobados (EXIT 0)

# 4. Scanner AST Multi-Tenant y Verificación Negativa
npm run test:scanner
# Resultado: 9 / 9 fixtures negativas verificadas + 64 archivos auditados sin violaciones (EXIT 0)

# 5. Runner Guards y Aislamiento de Entorno
npm run test:runner-guards
# Resultado: 17 / 17 checks mock de seguridad y fail-closed aprobados (EXIT 0)

# 6. Linting Estático (Frontend y Backend)
npm run lint
# Resultado: 0 errores (EXIT 0)

# 7. Compilación de Producción (Vite)
npm run build
# Resultado: Exitoso, bundle dist/assets/SaasBillingModule-XvTXgJtM.js generado (EXIT 0)
```

---

## 5. Pendientes de Integración

1. **Infraestructura DBA (PostgreSQL)**: La ejecución de las migraciones físicas de Fase 1, Fase 2A, Fase 2B y Fase 2D permanece bloqueada hasta la provisión de la base de pruebas `salon_saas_test` en clúster aislado por parte del DBA.
2. **Pasarela de Pago Real**: La integración con proveedores reales (ej. Stripe, CardNet) se realizará en una fase posterior mediante la implementación de adaptadores concretos sobre `PaymentGatewayPort`, manteniendo la pasarela desacoplada del dominio.
3. **Fase 2C DGII**: Permanece en estado `PENDIENTE — REQUIERE AUTORIZACIÓN, CERTIFICADO DIGITAL Y PROCESO DE CERTIFICACIÓN EXTERNO`.

