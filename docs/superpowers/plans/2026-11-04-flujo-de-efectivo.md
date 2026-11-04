# Flujo de Efectivo & Productividad y Rentabilidad Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrar el nuevo reporte "Flujo de efectivo" y renombrar la pestaña "Equipo y nómina" a "Productividad y rentabilidad" en el módulo de Inteligencia de Negocios (BI), reproduciendo con total fidelidad la maqueta gráfica corporativa.

**Architecture:** Modificar el catálogo de BI en `src/components/bi/biConfig.js` para renombrar la categoría e incorporar el reporte `cash_flow`. Extender el motor analítico `backend/routes/bi_engine.js` para consolidar cobros y pagos por conceptos normalizados (soportando modo demostración fiel a la maqueta). Desarrollar la vista ejecutiva en `src/components/bi/BusinessIntelligence.jsx` con el grid 2x2 de KPIs y las barras rankeadas de salidas de dinero.

**Tech Stack:** React, Vite, Tailwind/CSS inline styling, Node.js + Express, MySQL2.

**Spec:** `design_flujo_de_efectivo.md`

## Global Constraints

- La pestaña de categoría con id `team` debe llamarse textualmente `Productividad y rentabilidad`.
- El reporte debe llamarse textualmente `Flujo de efectivo` y tener identificador `cash_flow`.
- Los 4 KPIs del encabezado deben mostrar: Total cobrado, Total pagado, Excedente del período y Excedente sobre lo cobrado (%).
- La lista de salidas de dinero debe mostrar los 7 conceptos consolidados con barras horizontales rankeadas de mayor a menor con Monto en RD$ y % del total pagado.
- Debe incluir las notas al pie de fuentes y el aviso metodológico sobre utilidad contable.
- Compilación limpia con `npm run build` sin errores de JSX o tipos.

## Review Focus

1. El selector de categorías debe mostrar `Productividad y rentabilidad` sin romper los enlaces previos ni la selección por URL (`?cat=team`).
2. Al ingresar a `cash_flow`, los KPIs deben calcularse en tiempo real o mostrar los datos de demostración si se activa el modo de prueba o no hay movimientos en el período.
3. El cálculo de porcentaje `Excedente sobre lo cobrado` debe manejar división por cero (`total_cobrado = 0`) retornando `0%` sin error `NaN`.
4. Las barras horizontales deben ser proporcionales al total pagado (100% de la barra = el ítem mayor o 100% relativo), manteniendo el orden decreciente.
5. Los filtros de `Desde`, `Hasta` y `Sucursal` deben actualizar dinámicamente las cifras del flujo de caja.

---

### Task 1: Actualización de Configuración y Catálogo BI

**Files:**
- Modify: `src/components/bi/biConfig.js:30-40` y `src/components/bi/biConfig.js:201-240`
- Test: `scratch/test_bi_config_cashflow.cjs`

**Interfaces:**
- Consumes: Configuración actual de `BI_CATEGORIES` y `BI_REPORTS_BY_CATEGORY`.
- Produces: `BI_CATEGORIES` con `name: 'Productividad y rentabilidad'` y `BI_REPORTS_BY_CATEGORY.team` conteniendo `cash_flow` en primer lugar.

- [x] **Step 1: Escribir el test que valida la existencia y nombre de la categoría y reporte**
- [x] **Step 2: Ejecutar el test para comprobar que falla inicialmente**
- [x] **Step 3: Modificar `src/components/bi/biConfig.js`**
- [x] **Step 4: Ejecutar el test para verificar que pasa**
- [x] **Step 5: Compilar para verificar sintaxis**

---

### Task 2: Motor Backend para el Reporte `cash_flow` en `bi_engine.js`

**Files:**
- Modify: `backend/routes/bi_engine.js`
- Test: `backend/test_bi_cash_flow.cjs`

**Interfaces:**
- Consumes: Parámetros del request `{ reportId, period, startDate, endDate, salonId }`.
- Produces: Objeto con `{ title, periodText, is_sample, kpis, total_cobrado, total_pagado, excedente_periodo, excedente_pct, retencion_desc, delta_vs_anterior, concepts_breakdown, badges, footnote }`.

- [x] **Step 1: Escribir el test para el reporte `cash_flow`**
- [x] **Step 2: Ejecutar el test para comprobar que falla o no tiene la estructura especializada**
- [x] **Step 3: Implementar el manejador `reportId === 'cash_flow'` en `backend/routes/bi_engine.js`**
- [x] **Step 4: Ejecutar el test para comprobar que pasa**

---

### Task 3: Componente Especializado de Visualización en `BusinessIntelligence.jsx`

**Files:**
- Modify: `src/components/bi/BusinessIntelligence.jsx`
- Test: `npm run build` y captura visual.

**Interfaces:**
- Consumes: `reportData` con la estructura generada en Task 2.
- Produces: Renderizado del tablero ejecutivo idéntico a la maqueta cuando `selectedReportId === 'cash_flow'`.

- [x] **Step 1: Escribir el bloque de renderizado para `cash_flow` en `BusinessIntelligence.jsx`**
- [x] **Step 2: Compilar el frontend**
- [x] **Step 3: Ejecutar script de verificación y captura visual**

---

### Task 4: Verificación Integral, Cierre y Despliegue

**Files:**
- Modify: `docs/superpowers/plans/2026-11-04-flujo-de-efectivo.md` (Checkboxes completos)

- [x] **Step 1: Ejecutar suite de pruebas de regresión**
- [x] **Step 2: Compilación de producción**
- [x] **Step 3: Commit y Push a origin main**
```bash
git add src/components/bi/biConfig.js backend/routes/bi_engine.js src/components/bi/BusinessIntelligence.jsx
git commit -m "feat(bi): incorporar reporte flujo de efectivo y renombrar pestana productividad y rentabilidad"
git push origin main
```
