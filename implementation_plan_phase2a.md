# Plan de Implementación: Fase 2A — Modelo Comercial SaaS de Dos Planes y Autorización por Funcionalidades

> **Estado**: Plan de diseño y ejecución técnica para Fase 2A.
> **Regla Innegociable**: Cero conexiones a PostgreSQL (`salon_saas_db` no se toca). Pruebas 100% unitarias con repositorios in-memory desacoplados.

---

## 1. Visión General y Fuente de Verdad Canónica

SalonPro adopta exclusivamente **dos planes comerciales SaaS B2B**:
1. `BASE` (Operación esencial: POS, Facturación e-CF DGII, Cajas, Catálogo, Comisiones, Nómina, Asistencia y Egresos).
2. `PRO` (Todo lo de Base + CRM de Clientas, Membresías B2C tipo Plan Beauty, Contratos Digitales, Validaciones automáticas en POS, Marketing, Encuestas y Gift Cards).

### Separación B2B vs B2C
- **SaaS B2B (`BASE` / `PRO`)**: Catálogo global que rige las capacidades del tenant dentro del software.
- **Membresías B2C (`plans`, `contracts`)**: Programas de lealtad (Silver, Gold, Black) que cada salón vende a sus clientas finales. Siempre pertenecen a un `tenant_id` y jamás modifican el plan SaaS del tenant.

---

## 2. Matriz Canónica de Funcionalidades (Base vs Pro)

| Funcionalidad / Módulo | Clave Técnica (`featureKey`) | Plan BASE | Plan PRO | Justificación / Ubicación en Producto |
| :--- | :--- | :---: | :---: | :--- |
| **POS de Recepción** | `pos` | ✅ | ✅ | Emisión de pre-cuentas térmicas 60mm/80mm y cobro |
| **Cajas Registradoras** | `cash_registers` | ✅ | ✅ | Apertura, arqueo y cierre de turnos |
| **Catálogo de Servicios/Prod.** | `services_catalog` | ✅ | ✅ | Precios, duraciones y categorías |
| **Comisiones de Empleados** | `commissions` | ✅ | ✅ | Liquidación por estilista, lavapelo y manicurista |
| **Nómina de Personal** | `payroll` | ✅ | ✅ | Generación y cálculo de quincenas |
| **Control de Asistencia** | `attendance` | ✅ | ✅ | Quiosco de ponches de empleados |
| **Control de Egresos** | `expenses` | ✅ | ✅ | Registro de gastos operativos de sucursal |
| **Facturación Fiscal DGII** | `dgii_ecf` | ✅ | ✅ | Comprobantes e-CF, 606, 607 e IT-1 |
| **Reportes Operativos** | `reports` | ✅ | ✅ | Ventas diarias, cobros y métodos de pago |
| **Seguridad y PIN Admin** | `security` | ✅ | ✅ | Bloqueo de descuentos y autorizaciones de caja |
| **CRM de Clientes** | `clients` | ❌ | ✅ | Directorio de clientas, fichas técnicas e historial |
| **Membresías B2C (Plan Beauty)** | `memberships` | ❌ | ✅ | Ciclos de 30 días, 4 lavados/mes, contratos |
| **Marketing y Encuestas** | `marketing` | ❌ | ✅ | Encuestas de satisfacción, Gift Cards y avisos |

### Límites por Defecto
- `users`: Base = 3 usuarios incluidos. Pro = 3 usuarios incluidos (asientos extra ampliables por SuperAdmin).
- `branches`: Base = 1 sucursal incluida. Pro = 1 sucursal incluida (sucursales ampliables por SuperAdmin).

---

## 3. Modelo de Datos (Migración Idempotente Creada, NO Ejecutada)

Archivo: `backend/migrations/20261109_phase2a_saas_commercial_and_entitlements.cjs`
- `saas_plans`: Catálogo canónico global (`code VARCHAR(50) UNIQUE` para `BASE` y `PRO`).
- `saas_features`: Catálogo global de funcionalidades.
- `saas_plan_features`: Matriz de asignación plan-funcionalidad.
- `tenant_subscriptions`: Suscripción activa por tenant (`tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`).
- `tenant_feature_overrides`: Sobrescrituras auditadas con expiración opcional por tenant.
- `tenant_subscription_events`: Registro de auditoría inmutable de transiciones de plan (`BASE <-> PRO`).

---

## 4. Arquitectura de Código Desacoplada (Clean Architecture)

```text
backend/
├── services/
│   ├── saas_catalog.constants.js       # Fuente canónica de BASE, PRO, features y límites
│   └── entitlements.service.js         # Resolución de permisos, estados y límites
├── repositories/
│   ├── saas_plan.repository.js         # Interfaz / Implementación SQL para saas_plans
│   ├── tenant_subscription.repository.js # Interfaz / Implementación SQL para suscripciones
│   ├── entitlements.repository.js      # Interfaz / Implementación SQL para overrides y features
│   ├── subscription_audit.repository.js# Interfaz / Implementación SQL para eventos de cambio
│   └── fakes/
│       └── in_memory_saas.repository.js# Implementación en memoria para pruebas unitarias TDD
├── middleware/
│   └── entitlements.middleware.js      # requirePlanFeature() y requireTenantLimit()
└── routes/
    ├── tenant.routes.js                # GET /api/tenant/entitlements
    └── saas.routes.js                  # PATCH /api/saas/tenants/:tenantId/subscription, GET /api/saas/plans
```

---

## 5. Plan de Ejecución TDD Paso a Paso

- [ ] **Paso 1: Constantes y Catálogo Canónico** (`backend/services/saas_catalog.constants.js`)
- [ ] **Paso 2: Migración Estructural Idempotente** (`backend/migrations/20261109_phase2a_saas_commercial_and_entitlements.cjs`)
- [ ] **Paso 3: Repositorios Desacoplados y Fakes In-Memory** (`backend/repositories/`)
- [ ] **Paso 4: Servicio de Entitlements** (`backend/services/entitlements.service.js`)
- [ ] **Paso 5: Middleware de Autorización por Funcionalidad y Límites** (`backend/middleware/entitlements.middleware.js`)
- [ ] **Paso 6: Endpoints Backend** (`GET /api/tenant/entitlements`, `PATCH /api/saas/tenants/:tenantId/subscription`, `GET /api/saas/plans`)
- [ ] **Paso 7: Adaptación de Onboarding** (Nuevo tenant siempre inicia en `BASE`)
- [ ] **Paso 8: Protección de Rutas Existentes** (`/api/clients`, `/api/plans`, etc.)
- [ ] **Paso 9: Suite de Pruebas Unitarias TDD (28 Casos Mínimos)** (`backend/tests/test_phase2a_entitlements_unit.cjs`)
- [ ] **Paso 10: Frontend Hook y Contexto** (`src/context/EntitlementsContext.jsx`, `src/hooks/useEntitlements.js`)
- [ ] **Paso 11: Actualización de AST Scanner** (`backend/scripts/ast_multitenant_scanner.cjs`)
- [ ] **Paso 12: Verificación Completa** (Pruebas unitarias, runner guards, scanner, lint y build)

