# Walkthrough Técnico: Fase 2B — Inventario Multi-Tenant Real (Base y Pro)

## 1. Resumen Ejecutivo y Estado Formal

> **ESTADO FORMAL**:  
> **`FASE 2B INVENTARIO IMPLEMENTADA EN CÓDIGO Y PRUEBAS UNITARIAS / BASE + PRO / INTEGRACIÓN POSTGRESQL PENDIENTE`**

Se implementó de extremo a extremo la **Fase 2B: Inventario Multi-Tenant Real**, abarcando tanto el inventario básico para **Plan BASE** como las capacidades avanzadas de cadena de suministro para **Plan PRO**.

La lógica de negocio reside en servicios de dominio y repositorios completamente desacoplados de la base de datos física, respaldados por una suite TDD en memoria de 40 pruebas unitarias con cobertura del 100% de los casos de negocio, seguridad anti-IDOR, idempotencia y límites comerciales. La base de producción `salon_saas_db` se mantuvo **100% intacta, no contactada ni consultada**, y ninguna migración física ha sido ejecutada.

---

## 2. Invariantes del Modelo Comercial y Permisos (Base vs Pro)

El modelo de dos planes B2B canónicos (`BASE` y `PRO`) gobierna el acceso al inventario de la siguiente forma:

| Funcionalidad / Módulo | Clave de Entitlement | Plan BASE | Plan PRO | Comportamiento en Plan Base |
| :--- | :--- | :---: | :---: | :--- |
| **Catálogo de Productos Físicos** | `inventory` | ✅ Incluido | ✅ Incluido | Alta, edición, SKU, código de barras, categoría, precios y stock mínimo. |
| **Control de Stock y Kardex** | `inventory` | ✅ Incluido | ✅ Incluido | Balance por ubicación, entradas iniciales, ajustes manuales con motivo. |
| **Venta POS con Descuento de Stock** | `inventory` | ✅ Incluido | ✅ Incluido | Descuento automático de productos físicos al cobrar; reincorporación al anular. |
| **Separación de Servicios vs Productos** | `inventory` | ✅ Incluido | ✅ Incluido | Los servicios (`services`) no mueven stock ni exigen inventario. |
| **Alertas de Stock Bajo** | `inventory` | ✅ Incluido | ✅ Incluido | Identificación de productos cuyo `on_hand <= min_stock`. |
| **Transferencias Multi-Sucursal** | `inventory_advanced` | ❌ Bloqueado | ✅ Incluido | Solicitud, aprobación, despacho y recepción entre sucursales. Retorna **HTTP 403 `FEATURE_NOT_INCLUDED`**. |
| **Proveedores y Compras** | `inventory_advanced` | ❌ Bloqueado | ✅ Incluido | Directorio de proveedores, órdenes de compra y recepciones parciales/totales. Retorna **HTTP 403 `FEATURE_NOT_INCLUDED`**. |
| **Costo Promedio Ponderado (WAC)** | `inventory_advanced` | ❌ Bloqueado | ✅ Incluido | Recálculo matemático exacto de costo promedio en recepción de compras. |
| **Valorización Total de Inventario** | `inventory_advanced` | ❌ Bloqueado | ✅ Incluido | Reporte de capital inmovilizado a costo y precio de venta. |

---

## 3. Arquitectura y Componentes Desarrollados

### 3.1 Catálogo Canónico de Features
- **[`backend/services/saas_catalog.constants.js`](backend/services/saas_catalog.constants.js)**:
  - `SAAS_FEATURES.INVENTORY: 'inventory'`
  - `SAAS_FEATURES.INVENTORY_ADVANCED: 'inventory_advanced'`
  - En `CANONICAL_PLAN_FEATURES`:
    - `BASE`: `inventory: true`, `inventory_advanced: false`
    - `PRO`: `inventory: true`, `inventory_advanced: true`

### 3.2 Migración Idempotente DDL (Creada, NO Ejecutada)
- **[`backend/migrations/20261109_phase2b_inventory_multitenant.cjs`](backend/migrations/20261109_phase2b_inventory_multitenant.cjs)**:
  - 9 tablas tenant-owned creadas:
    1. `inventory_products`: Catálogo de ítems físicos con SKU, barcode, unit, track_stock, min_stock, cost_price, retail_price.
    2. `inventory_locations`: Almacenes/sucursales físicas vinculadas a `branches(id)`.
    3. `inventory_stock`: Saldo por tenant, producto y ubicación (`on_hand`, `allocated`, `avg_cost`).
    4. `inventory_movements`: Ledger inmutable de movimientos (`INVENTORY_IN`, `SALE`, `VOID_RETURN`, `TRANSFER_OUT`, `TRANSFER_IN`, `PURCHASE_RECEIPT`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`).
    5. `inventory_suppliers`: Catálogo de proveedores con RNC, contacto, condiciones comerciales.
    6. `inventory_purchase_orders`: Órdenes de compra con ciclo de vida (`DRAFT`, `SUBMITTED`, `APPROVED`, `PARTIALLY_RECEIVED`, `RECEIVED`, `CANCELLED`).
    7. `inventory_purchase_order_items`: Líneas de orden de compra con cantidades ordenadas y recibidas.
    8. `inventory_transfers`: Transferencias entre sucursales con ciclo (`DRAFT`, `REQUESTED`, `APPROVED`, `DISPATCHED`, `RECEIVED`, `CANCELLED`).
    9. `inventory_transfer_items`: Líneas de ítems transferidos.
  - **Invariante de Aislamiento y Cascada**: Cada una de las 9 tablas incluye:
    - `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`.
    - Índice B-Tree dedicado con `tenant_id` como columna primaria para garantizar index scans por tenant.
    - Restricciones UNIQUE compuestas por `(tenant_id, sku)` y `(tenant_id, barcode)`.

### 3.3 Capa de Persistencia y Repositorio en Memoria
- **Interfaces de Repositorio**:
  - [`backend/repositories/inventory.repository.js`](backend/repositories/inventory.repository.js)
  - [`backend/repositories/inventory_purchase.repository.js`](backend/repositories/inventory_purchase.repository.js)
  - [`backend/repositories/inventory_transfer.repository.js`](backend/repositories/inventory_transfer.repository.js)
- **Implementación Simulada en Memoria (Fake)**:
  - [`backend/repositories/fakes/in_memory_inventory.repository.js`](backend/repositories/fakes/in_memory_inventory.repository.js):
    - Almacenamiento aislado en Maps indexados por `tenantId`.
    - Verificación estricta de SKU y código de barras únicos por tenant.
    - Soporte completo para transacciones simuladas, idempotencia por clave y fallos fail-closed.
    - Prevención de saldos negativos y control de inmutabilidad del historial de movimientos.

### 3.4 Lógica de Negocio y Servicios de Dominio
- **[`backend/services/inventory.service.js`](backend/services/inventory.service.js)**:
  - Gestión de catálogo de productos y ubicaciones físicas.
  - Consulta de saldos y alertas de stock mínimo.
  - Descuento de stock en checkout POS (`processPosSaleDeductions`):
    - Itera líneas vendidas: si el producto no tiene `track_stock=true` o no existe en catálogo de inventario, se omite limpiamente.
    - Verifica disponibilidad previa de stock. Si no hay suficiente cantidad, aborta antes de mutar y deja el stock intacto.
    - Emite movimiento `SALE` con clave idempotente `sale:<visitId>:<productId>`.
  - Reposición de stock al anular venta (`processPosVoidReversal`):
    - Emite movimiento `VOID_RETURN` con clave idempotente `void:<visitId>:<productId>`.
  - Ajustes de inventario auditados (`ADJUSTMENT_IN`, `ADJUSTMENT_OUT`) requiriendo rol administrativo.
- **[`backend/services/inventory_purchase.service.js`](backend/services/inventory_purchase.service.js)**:
  - Directorio de proveedores y órdenes de compra multi-línea.
  - Recepción parcial o total de órdenes con actualización de stock.
  - **Cálculo de Costo Promedio Ponderado (WAC)**:
    $$\text{Nuevo Costo} = \frac{(\text{Stock Actual} \times \text{Costo Actual}) + (\text{Cantidad Recibida} \times \text{Costo Recibido})}{\text{Stock Actual} + \text{Cantidad Recibida}}$$
  - Idempotencia en recepción para evitar duplicación de existencias.
- **[`backend/services/inventory_transfer.service.js`](backend/services/inventory_transfer.service.js)**:
  - Guard: Bloquea transferencias donde `origin_location_id === target_location_id` (`SAME_LOCATION_TRANSFER`).
  - Despacho: Valida disponibilidad en origen y genera movimiento `TRANSFER_OUT`.
  - Recepción: Verifica estado `DISPATCHED` y genera movimiento `TRANSFER_IN` en destino.
  - Idempotencia en despacho y recepción.

### 3.5 API Endpoints y Seguridad Anti-IDOR
- **[`backend/routes/inventory.routes.js`](backend/routes/inventory.routes.js)**:
  - Montado en `/api/inventory` en `backend/server.js`.
  - Protegido por `authenticateToken`.
  - **Tenant Injection Protection**: `req.tenantId` es derivado exclusivamente del token JWT de sesión. Se ignora o neutraliza cualquier intento de inyectar `tenant_id` vía body, query parameters (`?tenant_id=`) o headers arbitrarios (`x-tenant-id`).
  - **Entitlements Guards**:
    - Rutas básicas protegidas por `requirePlanFeature('inventory')`.
    - Rutas avanzadas protegidas por `requirePlanFeature('inventory_advanced')`.
- **Integración en POS (`backend/routes/visits.routes.js`)**:
  - En checkout (`POST /api/visits` y `POST /api/visits/:id/pay`): Invoca `processPosSaleDeductions`.
  - En anulación (`POST /api/visits/:id/void`): Invoca `processPosVoidReversal`.

### 3.6 Frontend SaaS de Inventario
- **[`src/components/inventory/InventoryModule.jsx`](src/components/inventory/InventoryModule.jsx)**:
  - Componente de nivel empresarial con pestañas dinámicas según plan:
    - **Pestañas Base**: Productos, Stock y Alertas, Movimientos (Kardex).
    - **Pestañas Pro**: Transferencias entre Sucursales, Proveedores, Órdenes de Compra, Valorización de Inventario.
  - Bloqueo visual con tarjeta de Upgrade a Plan PRO cuando un tenant Base intenta acceder a pestañas avanzadas.
  - Indicadores de badge de stock crítico, modales de nuevo producto y ajuste manual.
- **Ruta e Integración**:
  - Métodos API agregados a [`src/utils/dataService.js`](src/utils/dataService.js).
  - Lazy routes `/inventario` e `/inventory` registradas en [`src/App.jsx`](src/App.jsx).

---

## 4. Resultados de la Verificación y Pruebas Unitarias

### 4.1 Suite Unitaria Fase 2B (40/40 Passing)
Ejecución: `npm run test:phase2b:unit`
- **40 / 40 casos aprobados (EXIT 0)**.

### 4.2 Suite Unitaria Fase 2A (28/28 Passing)
Ejecución: `npm run test:phase2a:unit`
- **28 / 28 casos aprobados (EXIT 0)**.

### 4.3 Scanner Estático AST y Verificación Negativa (8/8 Fixtures + 52 Archivos)
Ejecución: `npm run test:scanner`
- **8 / 8 casos negativos verificados**, auditando 52 archivos runtime con **0 violaciones multi-tenant**.

### 4.4 Runner Guards de Seguridad (17/17 Passing)
Ejecución: `npm run test:runner-guards`
- **17 / 17 checks de aislamiento físico y fail-closed aprobados (EXIT 0)**.

### 4.5 Linting y Compilación de Producción
- `npm run lint`: **0 errores**.
- `npm run build`: **Exitoso**, bundle de producción compilado limpiamente.

