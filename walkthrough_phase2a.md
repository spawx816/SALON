# Walkthrough Técnico: Fase 2A — Modelo Comercial SaaS y Entitlements

## 1. Resumen Ejecutivo y Estado Formal

> **ESTADO FORMAL**:  
> **`FASE 2A IMPLEMENTADA EN CÓDIGO Y PRUEBAS UNITARIAS / SOLO PLAN BASE Y PLAN PRO / INTEGRACIÓN POSTGRESQL PENDIENTE`**

Se implementó el modelo comercial SaaS B2B canónico de **exactamente dos planes (`BASE` y `PRO`)** junto con el motor de autorización por funcionalidades (*Entitlements*), desvinculando la lógica de negocio de la base de datos física mediante repositorios desacoplados y probados mediante una suite unitaria TDD de 28 casos en memoria.

---

## 2. Invariantes de Seguridad y Modelo Comercial Implementados

### 2.1 Catálogo Canónico B2B Exclusivo (2 Planes)
- **Planes autorizados**: `BASE` (Plan Esencial de Operación) y `PRO` (Plan Crecimiento & Fidelización).
- **Prohibición estricta**: No existen planes `ENTERPRISE`, `PREMIUM`, `BUSINESS`, `FREE` ni `TRIAL` como tiers independientes.
- **Transiciones autorizadas**: Únicamente `BASE -> PRO` (upgrade) y `PRO -> BASE` (downgrade).
- **Onboarding forzado**: Todo nuevo tenant registrado inicia obligatoriamente en `BASE` (cualquier payload que intente forzar `PRO` es neutralizado).

### 2.2 Separación Estricta B2B vs B2C
- **Planes SaaS B2B (`BASE` / `PRO`)**: Gobiernan qué módulos del software y límites de recursos (`users`, `branches`) tiene habilitados la empresa suscriptora (salón).
- **Planes B2C (`plans`, membresías Plan Beauty)**: Planes de lealtad vendidos por los salones a sus clientas finales (Silver, Gold, Black). Están encapsulados bajo el tenant y requieren que el tenant cuente con la funcionalidad `memberships` (exclusiva de `PRO`).

### 2.3 Matriz Canónica de Funcionalidades y Límites

| Módulo / Capacidad | Clave de Entitlement | Plan BASE | Plan PRO |
| :--- | :--- | :---: | :---: |
| Punto de Venta (POS) | `pos` | ✅ Incluido | ✅ Incluido |
| Apertura y Cierre de Cajas | `cash_registers` | ✅ Incluido | ✅ Incluido |
| Catálogo de Servicios | `services_catalog` | ✅ Incluido | ✅ Incluido |
| Comisiones de Personal | `commissions` | ✅ Incluido | ✅ Incluido |
| Nómina de Empleados | `payroll` | ✅ Incluido | ✅ Incluido |
| Control de Asistencia | `attendance` | ✅ Incluido | ✅ Incluido |
| Registro de Gastos | `expenses` | ✅ Incluido | ✅ Incluido |
| Facturación DGII / e-CF | `dgii_ecf` | ✅ Incluido | ✅ Incluido |
| Reportes Operativos | `reports` | ✅ Incluido | ✅ Incluido |
| Seguridad y PIN Admin | `security` | ✅ Incluido | ✅ Incluido |
| **Gestión de Clientes** | `clients` | ❌ Bloqueado (403) | ✅ Incluido |
| **Membresías Plan Beauty** | `memberships` | ❌ Bloqueado (403) | ✅ Incluido |
| **Límite de Usuarios** | `users` | **Máximo 3** | **Máximo 15** |
| **Límite de Sucursales** | `branches` | **Máximo 1** | **Máximo 5** |

---

## 3. Arquitectura y Componentes Desarrollados

### 3.1 Constantes Canónicas
- `backend/services/saas_catalog.constants.js`:
  - `SAAS_PLANS`: `BASE`, `PRO`.
  - `SUBSCRIPTION_STATUSES`: `active`, `suspended`, `cancelled`, `expired`.
  - `CANONICAL_PLAN_FEATURES`, `DEFAULT_PLAN_LIMITS`, `CANONICAL_PLANS_CATALOG`.
  - Funciones puras: `normalizePlanCode()`, `isValidPlanCode()`, `isTransitionAllowed()`.

### 3.2 Migración Idempotente Creada (NO Ejecutada)
- `backend/migrations/20261109_phase2a_saas_commercial_and_entitlements.cjs`:
  - Crea tablas de catálogo global: `saas_features`, `saas_plans`, `saas_plan_features`.
  - Crea tablas tenant-scoped: `tenant_subscriptions`, `tenant_feature_overrides`, `tenant_subscription_events`.
  - **Invariante FK**: Cada tabla tenant-scoped incluye `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE` con índices B-Tree dedicados.

### 3.3 Repositorios y Fake In-Memory
- `backend/repositories/saas_plan.repository.js`: Catálogo de planes y features.
- `backend/repositories/tenant_subscription.repository.js`: Suscripción y retrocompatibilidad con `tenants.plan_id`.
- `backend/repositories/entitlements.repository.js`: Overrides y conteo de recursos (`users`, `branches`).
- `backend/repositories/subscription_audit.repository.js`: Registro inmutable de transiciones y auditoría.
- `backend/repositories/fakes/in_memory_saas.repository.js`: Mock en memoria para ejecución de pruebas unitarias sin dependencias externas.

### 3.4 Entitlements Service & Middleware (Fail-Closed)
- `backend/services/entitlements.service.js`:
  - `getTenantEntitlements(tenantId)`: Resuelve features base, overrides y límites. Ante error en repositorio o período expirado, aplica **Fail-Closed** inmediato.
  - `hasFeature(tenantId, featureKey)`: Valida permisos devolviendo `{ allowed, reason, code, currentPlan }`.
  - `checkLimit(tenantId, limitKey)`: Evalúa cupos de usuarios y sucursales.
  - `changeTenantPlan(tenantId, newPlanCode, options)`: Valida transición `BASE <-> PRO` y genera evento de auditoría.
- `backend/middleware/entitlements.middleware.js`:
  - `requirePlanFeature(featureKey)`: Extrae el tenant estrictamente de `req.tenantId` validado en autenticación. Rechaza intentos de inyección por headers (`x-tenant-id`), query o body. Retorna HTTP 403 con códigos semánticos (`FEATURE_NOT_INCLUDED`, `SUBSCRIPTION_SUSPENDED`, etc.).
  - `requireTenantLimit(limitKey)`: Bloquea operaciones cuando se alcanza el límite del plan (`PLAN_LIMIT_REACHED`).

### 3.5 Rutas Protegidas en Servidor Canónico
- `backend/server.js`:
  - Monta `/api/clients` con `requirePlanFeature('clients')`.
  - Monta `/api/plans` y `/api/contracts` con `requirePlanFeature('memberships')`.
  - Inyecta `entitlementsService` en routers de `tenant` y `saas`.
- `backend/routes/tenant.routes.js`:
  - `GET /api/tenant/entitlements`: Retorna el estado comercial, funcionalidades y límites del tenant autenticado.
- `backend/routes/saas.routes.js`:
  - `GET /api/saas/plans`: Retorna únicamente `BASE` y `PRO`.
  - `PATCH /api/saas/tenants/:tenantId/subscription`: Restringido exclusivamente al SuperAdmin; valida planes canónicos y registra auditoría.
- `backend/routes/auth.routes.js`:
  - Creación de usuarios evalúa `checkLimit(tenantId, 'users')`.
- `backend/routes/salons.routes.js`:
  - Creación de sucursales evalúa `checkLimit(tenantId, 'branches')`.
- `backend/routes/public.routes.js`:
  - Onboarding fuerza siempre el plan `BASE`.

### 3.6 Frontend Context
- `src/context/EntitlementsContext.jsx`:
  - Provee `EntitlementsProvider` y hook `useEntitlements()`.
  - Expone helpers `canAccess(featureKey)`, `isPro`, `isBase`, `checkLimit(limitKey)`.

---

## 4. Evidencia de Verificación

Todas las verificaciones se ejecutaron en el entorno local sin conexión a bases operativas:

### 4.1 Suite Unitaria de Entitlements TDD (28/28 Casos Aprobados)
Comando: `npm run test:phase2a:unit`
```
=== STARTING SUITE: PHASE 2A ENTITLEMENTS & 2-PLAN MODEL UNIT TESTS ===

  [PASS 1/28] Test 1: New tenant receives BASE plan by default
  [PASS 2/28] Test 2: Onboarding payload cannot force PRO without authorization
  [PASS 3/28] Test 3: Base allows included features (pos, cajas, dgii_ecf, etc.)
  [PASS 4/28] Test 4: Base blocks Pro features (clients, memberships)
  [PASS 5/28] Test 5: Pro allows all Base features
  [PASS 6/28] Test 6: Pro allows additional Pro features (clients, memberships)
  [PASS 7/28] Test 7: No Enterprise, Premium, or 3rd-tier plan exists in constants
  [PASS 8/28] Test 8: Catalog returns exactly 2 plans (BASE, PRO)
  [PASS 9/28] Test 9: Unknown plan fails closed during check and change
  [PASS 10/28] Test 10: Suspended subscription blocks protected features
  [PASS 11/28] Test 11: Cancelled subscription blocks protected features
  [PASS 12/28] Test 12: Expired subscription blocks protected features
  [PASS 13/28] Test 13: Valid non-expired override grants a feature to BASE tenant
  [PASS 14/28] Test 14: Revocation override (is_enabled: false) blocks feature even in PRO
  [PASS 15/28] Test 15: Expired override is ignored
  [PASS 16/28] Test 16: Tenant A cannot query Tenant B entitlements (anti-IDOR)
  [PASS 17/28] Test 17: x-tenant-id header does not override authenticated req.tenantId
  [PASS 18/28] Test 18: Query string ?tenant_id= does not override authenticated req.tenantId
  [PASS 19/28] Test 19: Body payload tenant_id does not override authenticated req.tenantId
  [PASS 20/28] Test 20: User limit is enforced per tenant
  [PASS 21/28] Test 21: Branch limit is enforced per tenant
  [PASS 22/28] Test 22: Tenant A does not consume Tenant B limits
  [PASS 23/28] Test 23: Salon admin cannot change their own plan (role check in route)
  [PASS 24/28] Test 24: SuperAdmin can change Base <-> Pro both ways
  [PASS 25/28] Test 25: Plan transitions generate immutable audit event
  [PASS 26/28] Test 26: Frontend is not sole barrier (middleware rejects direct API calls without token/entitlement)
  [PASS 27/28] Test 27: Repository errors fail closed (403 with error code)
  [PASS 28/28] Test 28: Migration contains tenant_id FK pointing specifically to tenants(id) with ON DELETE CASCADE

=== TEST RESULTS SUMMARY ===
Passed: 28 / 28
🎉 ALL 28 PHASE 2A ENTITLEMENTS & 2-PLAN TESTS PASSED SUCCESSFULLY (PASS)
```

### 4.2 Escáner AST Multi-Tenant (44 Archivos Auditados / 0 Violaciones)
Comando: `npm run test:scanner`
- Audita todos los repositorios, middleware, rutas, servicios y launcher canónico.
- 7/7 casos negativos de inyección y bypass validados.
- Resultado: `✅ AST STATIC SCAN PASSED: 0 multi-tenant violations found across 44 audited files.`

### 4.3 Pruebas Negativas del Runner Maestro y Preflight (17/17 Aprobadas)
Comando: `npm run test:runner-guards`
- Valida contención estricta: aborta si no existe `ALLOW_INTEGRATION_TESTS`, rechaza conexión a producción, rechaza contaminaciones operativas.
- Resultado: `🎉 TODAS LAS 17 PRUEBAS NEGATIVAS Y DE SEGURIDAD APROBADAS (EXIT 0)`.

### 4.4 Linter y Compilación Frontend
- `npm run lint`: **0 errores** (aprobado).
- `npm run build`: **Vite compiló en 1.32s sin errores** (aprobado).

