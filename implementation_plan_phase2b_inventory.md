# Plan de Implementación: Fase 2B — Inventario Multi-Tenant Real

## 1. Contexto y Objetivos

- **Proyecto**: SalonPro SaaS Multi-Tenant (`C:\Users\spawx\.gemini\antigravity-ide\scratch\salon_saas`)
- **Alcance Autorizado**: `FASE 2B — INVENTARIO MULTI-TENANT REAL`
- **Planes Comerciales**: Estrictamente `BASE` y `PRO`.
  - `BASE`: `inventory` (catálogo de productos, control de stock, entradas/salidas/ajustes, alertas stock mínimo, descuento/anulación POS, inventario de sucursal).
  - `PRO`: `inventory` + `inventory_advanced` (multisucursal, almacenes/ubicaciones, transferencias entre sucursales, proveedores, órdenes de compra y recepción parcial, costo promedio ponderado, valorización e informes).
- **Invariante Crítico**: **Cero conexiones a PostgreSQL**. `salon_saas_db` no debe ser contactada; no ejecutar migraciones ni tests de integración contra base física.

---

## 2. Auditoría del Proyecto y Hallazgos (Paso 1)

1. **Catálogo Canónico SaaS (`backend/services/saas_catalog.constants.js`)**:
   - Actualmente contiene `SAAS_PLANS.BASE` y `SAAS_PLANS.PRO`.
   - Incorporaremos `SAAS_FEATURES.INVENTORY: 'inventory'` y `SAAS_FEATURES.INVENTORY_ADVANCED: 'inventory_advanced'`.
   - `BASE` incluye `inventory: true` e `inventory_advanced: false`.
   - `PRO` incluye ambos en `true`.
2. **Servicios vs Productos**:
   - Actualmente `services.routes.js` gestiona la tabla `services`. Algunos registros tenían un campo no normalizado `tipo_item` ('Servicio' o 'Producto').
   - Separaremos limpiamente el dominio: los **Servicios** permanecen en `services` (intangibles, sin existencias físicas, no mueven stock). Los **Productos** residirán en el nuevo modelo `inventory_products` y sus tablas asociadas.
3. **Flujo de Ventas y POS (`visits.routes.js`)**:
   - Las ventas se finalizan en `POST /api/visits/:id/checkout` y se anulan en `POST /api/visits/:id/void`.
   - En el checkout, las líneas de producto se validan contra el stock de la sucursal/ubicación por defecto del tenant. Si hay stock suficiente, se descuenta de forma atómica con clave de idempotencia (`sale:${visitId}:${productId}`). Si no hay stock, se rechaza la venta antes de asentar el ticket.
   - En la anulación (`void`), se emite un movimiento compensatorio `SALE_VOID` idempotente (`void:${visitId}:${productId}`) que repone las existencias.
4. **Seguridad y Scoping Multi-Tenant**:
   - En `server.js`, todo `/api/*` privado pasa por `authenticate(req, res, next)` que asienta `req.tenantId`.
   - Se aplicará `requirePlanFeature('inventory')` para las rutas Base y `requirePlanFeature('inventory_advanced')` para las rutas Pro.
   - Todo query incluye `WHERE tenant_id = ?`. Intentos de acceso a recursos de otro tenant responden `404 Not Found`.

---

## 3. Modelo de Datos y Migración Idempotente No Ejecutada (Paso 3)

Archivo: `backend/migrations/20261109_phase2b_inventory_multitenant.cjs`

Tablas diseñadas con `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE` e índice B-Tree primario en `tenant_id`:
1. `inventory_products`: Catálogo físico de productos.
   - `id UUID PRIMARY KEY`, `tenant_id UUID NOT NULL`, `sku VARCHAR(100) NOT NULL`, `barcode VARCHAR(100)`, `name VARCHAR(255) NOT NULL`, `description TEXT`, `category VARCHAR(100)`, `unit_of_measure VARCHAR(50)`, `sale_price NUMERIC(14,4)`, `cost NUMERIC(14,4)`, `tax_rate NUMERIC(6,4)`, `min_stock NUMERIC(14,4)`, `track_stock BOOLEAN`, `is_active BOOLEAN`.
   - Constraints: `UNIQUE (tenant_id, sku)`, `UNIQUE (tenant_id, barcode) WHERE barcode IS NOT NULL`, `CHECK (sale_price >= 0)`, `CHECK (cost >= 0)`, `CHECK (min_stock >= 0)`.
2. `inventory_locations`: Almacenes o ubicaciones de stock por sucursal.
   - `id UUID PRIMARY KEY`, `tenant_id UUID NOT NULL`, `salon_id INT REFERENCES salons(id)`, `name VARCHAR(150)`, `code VARCHAR(50)`, `type VARCHAR(50)`, `is_default BOOLEAN`, `is_active BOOLEAN`.
   - Constraints: `UNIQUE (tenant_id, code)` o `UNIQUE (tenant_id, name)`.
3. `inventory_stock`: Balance actual por producto y ubicación.
   - `id UUID PRIMARY KEY`, `tenant_id UUID NOT NULL`, `product_id UUID NOT NULL REFERENCES inventory_products(id)`, `location_id UUID NOT NULL REFERENCES inventory_locations(id)`, `quantity NUMERIC(14,4) NOT NULL DEFAULT 0.0000`, `average_cost NUMERIC(14,4) NOT NULL DEFAULT 0.0000`, `last_movement_at TIMESTAMP`.
   - Constraints: `UNIQUE (tenant_id, product_id, location_id)`, `CHECK (quantity >= 0)`.
4. `inventory_movements`: Ledger inmutable de movimientos.
   - `id UUID PRIMARY KEY`, `tenant_id UUID NOT NULL`, `product_id UUID NOT NULL`, `location_id UUID NOT NULL`, `movement_type VARCHAR(50) NOT NULL`, `quantity NUMERIC(14,4) NOT NULL`, `unit_cost NUMERIC(14,4)`, `total_cost NUMERIC(14,4)`, `balance_after NUMERIC(14,4)`, `reference_type VARCHAR(50)`, `reference_id VARCHAR(100)`, `idempotency_key VARCHAR(150)`, `reason TEXT`, `user_id VARCHAR(100)`, `user_name VARCHAR(150)`, `created_at TIMESTAMP`.
   - Tipos: `INITIAL`, `PURCHASE_RECEIPT`, `SALE`, `SALE_VOID`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`, `TRANSFER_OUT`, `TRANSFER_IN`, `RETURN_IN`, `RETURN_OUT`.
   - Constraints: `CHECK (quantity != 0)`, `UNIQUE (tenant_id, idempotency_key)` (no nulos).
5. `inventory_suppliers`: Directorio de proveedores (Pro).
   - `id UUID PRIMARY KEY`, `tenant_id UUID NOT NULL`, `name VARCHAR(200) NOT NULL`, `rnc_tax_id VARCHAR(50)`, `contact_name VARCHAR(150)`, `phone VARCHAR(50)`, `email VARCHAR(150)`, `address TEXT`, `is_active BOOLEAN`.
6. `inventory_purchase_orders`: Órdenes de compra (Pro).
   - `id UUID PRIMARY KEY`, `tenant_id UUID NOT NULL`, `supplier_id UUID NOT NULL`, `location_id UUID NOT NULL`, `order_number VARCHAR(100) NOT NULL`, `status VARCHAR(50) NOT NULL` (`DRAFT`, `APPROVED`, `PARTIALLY_RECEIVED`, `COMPLETED`, `CANCELLED`), `total_amount NUMERIC(14,4)`, `notes TEXT`, `created_by VARCHAR(100)`.
7. `inventory_purchase_order_items`: Renglones de compra (Pro).
   - `id UUID PRIMARY KEY`, `tenant_id UUID NOT NULL`, `purchase_order_id UUID NOT NULL`, `product_id UUID NOT NULL`, `quantity_ordered NUMERIC(14,4)`, `quantity_received NUMERIC(14,4)`, `unit_cost NUMERIC(14,4)`, `total_cost NUMERIC(14,4)`.
8. `inventory_transfers`: Transferencias entre sucursales/ubicaciones (Pro).
   - `id UUID PRIMARY KEY`, `tenant_id UUID NOT NULL`, `transfer_number VARCHAR(100) NOT NULL`, `source_location_id UUID NOT NULL`, `destination_location_id UUID NOT NULL`, `status VARCHAR(50) NOT NULL` (`REQUESTED`, `APPROVED`, `DISPATCHED`, `RECEIVED`, `CANCELLED`), `notes TEXT`.
   - Constraint: `CHECK (source_location_id != destination_location_id)`.
9. `inventory_transfer_items`: Renglones de transferencia (Pro).
   - `id UUID PRIMARY KEY`, `tenant_id UUID NOT NULL`, `transfer_id UUID NOT NULL`, `product_id UUID NOT NULL`, `quantity_requested NUMERIC(14,4)`, `quantity_transferred NUMERIC(14,4)`.

---

## 4. Ledger Inmutable, Idempotencia y Costo Promedio (Pasos 4, 5 y 12)

1. **Inmutabilidad y Movimientos Compensatorios**:
   - Nunca se ejecuta `UPDATE` o `DELETE` sobre registros en `inventory_movements`.
   - Cualquier corrección de saldo se asienta mediante `ADJUSTMENT_IN` o `ADJUSTMENT_OUT`.
2. **Idempotencia**:
   - Cada operación clave (`checkout`, `void`, `purchase_receive`, `transfer_dispatch`, `transfer_receive`) genera un `idempotency_key` determinista. Si la clave ya fue registrada para ese tenant, la operación retorna el estado existente sin duplicar cantidades ni alterar el stock.
3. **Cálculo de Costo Promedio Ponderado**:
   $$\text{nuevo\_costo} = \frac{(\text{stock\_actual} \times \text{costo\_promedio\_actual}) + (\text{cantidad\_recibida} \times \text{costo\_nuevo})}{\text{stock\_actual} + \text{cantidad\_recibida}}$$
   - Las salidas (`SALE`, `TRANSFER_OUT`, `ADJUSTMENT_OUT`) registran el costo promedio vigente sin alterarlo.

---

## 5. Arquitectura de Código Limpio (Paso 6)

1. `backend/repositories/inventory.repository.js`:
   - Operaciones sobre productos, ubicaciones, stock y ledger de movimientos con `WHERE tenant_id = ?`.
2. `backend/repositories/inventory_purchase.repository.js`:
   - Operaciones sobre proveedores y órdenes de compra con scoping tenant estricto.
3. `backend/repositories/inventory_transfer.repository.js`:
   - Operaciones sobre transferencias entre almacenes con scoping tenant estricto.
4. `backend/repositories/fakes/in_memory_inventory.repository.js`:
   - Implementación en memoria completa y reactiva que valida atomicidad, unicidad por tenant, bloqueos de stock negativo y cálculo de costo promedio para los tests unitarios.
5. `backend/services/inventory.service.js`:
   - Lógica de negocio de productos, movimientos, balance, ajustes y costo promedio.
6. `backend/services/inventory_purchase.service.js` & `inventory_transfer.service.js`:
   - Flujos de compra, recepción parcial y transferencias multisucursal.
7. `backend/routes/inventory.routes.js`:
   - Endpoints Base protegidos con `requirePlanFeature('inventory')`.
   - Endpoints Pro protegidos con `requirePlanFeature('inventory_advanced')`.

---

## 6. Pruebas Unitarias TDD (Paso 14 — Mínimo 40 Casos)

Archivo: `backend/tests/test_phase2b_inventory_unit.cjs`
Cubrirá exhaustivamente los 40 escenarios solicitados:
1. Crear producto con tenant autenticado.
2. Rechazar tenant del body (ignorar/anular spoofing).
3. SKU único por tenant.
4. Mismo SKU permitido en tenants distintos.
5. Producto de otro tenant retorna 404 (anti-IDOR).
6. Entrada inicial aumenta stock.
7. Compra aumenta stock.
8. Venta reduce stock.
9. Servicio no reduce stock.
10. Venta sin stock suficiente falla.
11. Stock nunca queda negativo.
12. Venta repetida (idempotencia) no duplica descuento.
13. Anulación repone stock.
14. Anulación repetida no duplica reposición.
15. Ajuste requiere rol autorizado.
16. Movimiento confirmado es inmutable.
17. Movimiento compensatorio corrige stock.
18. Stock de Tenant A no afecta Tenant B.
19. Ubicación ajena es rechazada (404).
20. Plan Base puede usar inventario básico.
21. Plan Base no puede usar inventario avanzado (403).
22. Plan Pro puede usar inventario básico.
23. Plan Pro puede usar inventario avanzado.
24. Transferencia origen = destino falla (400).
25. Transferencia sin stock falla.
26. Despacho genera salida de inventario.
27. Recepción genera entrada de inventario.
28. Transferencia repetida es idempotente.
29. Orden de compra soporta recepción parcial.
30. Recepción repetida no duplica stock.
31. Costo promedio ponderado se calcula correctamente.
32. Precio o costo negativo se rechaza.
33. Código de barras respeta unicidad por tenant.
34. Alertas identifican productos bajo stock mínimo.
35. Productos con `track_stock = false` no generan movimientos.
36. Error de repositorio falla cerrado (Fail-Closed).
37. Query / header / body no alteran `req.tenantId`.
38. Migración define FK `tenant_id -> tenants(id) ON DELETE CASCADE`.
39. Índices B-Tree tienen `tenant_id` en primera posición.
40. Rutas avanzadas devuelven 403 `FEATURE_NOT_INCLUDED` en Plan Base.

---

## 7. Módulo Frontend Funcional (Paso 13)

- Componente: `src/components/inventory/InventoryModule.jsx`.
- Pestañas Base: Productos, Existencias y Alertas, Movimientos y Ajustes.
- Pestañas Pro: Proveedores, Órdenes de Compra, Transferencias entre Sucursales, Valorización.
- Integración con `useEntitlements()`: deshabilita/oculta tabs avanzadas si `canAccess('inventory_advanced')` es falso con badges informativos ("Exclusivo Plan PRO").
- Integración en `src/App.jsx` bajo la ruta `/inventario` o sección en Dashboard.

---

## 8. Verificación y Cierre

Comandos de verificación que deben ejecutarse en local:
```bash
npm run test:phase2b:unit
npm run test:phase2a:unit
npm run test:runner-guards
npm run test:scanner
npm run lint
npm run build
```
Resultado final documentado en:
`walkthrough_phase2b_inventory.md`
Estado formal:
`FASE 2B INVENTARIO IMPLEMENTADA EN CÓDIGO Y PRUEBAS UNITARIAS / BASE + PRO / INTEGRACIÓN POSTGRESQL PENDIENTE`

