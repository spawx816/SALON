---
title: SalonPro SaaS & Plan Beauty RD — Design System Documentation
version: 1.0.0
extracted_by: Impeccable v4.8.0 (document capability)
status: Bifurcated (Landing B2C Tokenized vs Internal SaaS Monolithic)
tokens:
  colors:
    landing-bg-cream: "#f8f4ef"
    landing-bg-warm: "#f2ece3"
    landing-bg-surface: "#ffffff"
    landing-bg-dark: "#23251e"
    landing-text-primary: "#1e1f1b"
    landing-text-secondary: "#4f5249"
    landing-text-muted: "#6b6e64"
    landing-brand-olive: "#6c7156"
    landing-brand-olive-dark: "#545942"
    landing-brand-coral: "#e45d75"
    landing-brand-coral-dark: "#c9435b"
    saas-primary: "#111827"
    saas-primary-hover: "#1f2937"
    saas-accent: "#f3f4f6"
    saas-background: "#f8fafc"
    saas-surface: "#ffffff"
    saas-text-main: "#0f172a"
    saas-text-muted: "#64748b"
    saas-border: "#e2e8f0"
    semantic-success: "#10b981"
    semantic-warning: "#f59e0b"
    semantic-error: "#ef4444"
  typography:
    font-sans-saas: "'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif"
    font-display-landing: "'Montserrat', 'Plus Jakarta Sans', sans-serif"
    font-body-landing: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif"
  radii:
    sm: "0.5rem"
    md: "0.75rem"
    lg: "1rem"
    xl: "1.5rem"
    landing-sm: "10px"
    landing-md: "16px"
    landing-lg: "24px"
  shadows:
    sm: "0 1px 2px 0 rgb(0 0 0 / 0.05)"
    md: "0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05)"
    lg: "0 10px 15px -3px rgb(0 0 0 / 0.07), 0 4px 6px -4px rgb(0 0 0 / 0.05)"
    xl: "0 20px 25px -5px rgb(0 0 0 / 0.08), 0 8px 10px -6px rgb(0 0 0 / 0.04)"
---

# SalonPro SaaS & Plan Beauty RD — Sistema Visual Existente (`DESIGN.md`)

> Documento generado mediante la capacidad **`document`** de **Impeccable v4.8.0** durante la auditoría integral del frontend. Refleja el estado real extraído del código fuente (`src/index.css`, `src/pages/Landing.css` y componentes en `src/components/`).

---

## 1. Dirección Estética y Personalidad de Marca

El proyecto presenta actualmente una **arquitectura visual bifurcada** en dos sistemas independientes que no comparten tokens:

1. **Ecosistema Público B2C (`src/pages/Landing.css`)**:
   - **Personalidad**: Editorial, cálida, hospitalaria y orientada a membresías de salón (*Plan Beauty RD by Abatte*).
   - **Superficies**: Tonos crema orgánicos (`#f8f4ef`, `#f2ece3`) con acentos en verde oliva (`#6c7156`) y coral (`#e45d75`).
2. **Ecosistema Interno Administrativo y SaaS Multi-Tenant (`src/index.css` + estilos inline)**:
   - **Personalidad**: Operativa de alto contraste en escala de grises/pizarra (`#0f172a`, `#111827`, `#f8fafc`), con acentos puntuales codificados directamente en los componentes (`#8c9668` oliva heredado de Abatte, `#4f46e5` índigo en selectores SaaS, `#10b981` esmeralda en POS/estados activos).
   - **Deuda de Tokenización**: Entre el **30% y el 58% de los nodos del DOM** en las vistas internas utilizan `style={{ ... }}` en lugar de clases utilitarias o variables CSS de `src/index.css`.

---

## 2. Paleta de Colores y Tokens Semánticos

### 2.1 Tokens Globales del Sistema Interno (`src/index.css:5-31`)

| Token CSS | Valor Hex | Rol declarativo | Uso real observado |
| :--- | :--- | :--- | :--- |
| `--primary` | `#111827` | Color primario de acción | Botones `.btn-primary`, encabezados y sidebar activo |
| `--primary-hover` | `#1f2937` | Hover primario | Hover en botones primarios |
| `--primary-light` | `#f3f4f6` | Superficie secundaria | Fondos suaves de tarjetas y badges |
| `--secondary` | `#374151` | Texto/acción secundaria | Iconografía y controles secundarios |
| `--accent` | `#f3f4f6` | Acento neutro | Fondos de pestañas y cabeceras de tabla (`#f8fafc`) |
| `--background` | `#f8fafc` | Fondo de aplicación | `body` y contenedor `.main-content` |
| `--surface` | `#ffffff` | Superficie de tarjetas | `.card`, `.stat-card`, `.table-container`, modales |
| `--text-main` | `#0f172a` | Texto principal | Títulos y celdas principales |
| `--text-muted` | `#64748b` | Texto secundario | Subtítulos, etiquetas de formulario y metadatos |
| `--border` | `#e2e8f0` | Bordes estructurales | Bordes de `.card`, `.input-field` y divisores de tabla |
| `--success` | `#10b981` | Estado exitoso / Activo | Badges de estado activo y confirmaciones de cobro |
| `--warning` | `#f59e0b` | Advertencia / Pendiente | Alertas de ciclo, estados pendientes y avisos fiscales |
| `--error` | `#ef4444` | Error / Suspendido | Validaciones, bajas y suspensión de salones |

### 2.2 Tokens de la Landing Pública (`src/pages/Landing.css:5-30`)

| Token CSS | Valor Hex | Rol en Landing |
| :--- | :--- | :--- |
| `--lp-bg-cream` | `#f8f4ef` | Fondo principal de página |
| `--lp-bg-warm` | `#f2ece3` | Secciones alternas y tarjetas destacadas |
| `--lp-bg-dark` | `#23251e` | Secciones de contraste oscuro y footer |
| `--lp-text-primary` | `#1e1f1b` | Titulares y cuerpo principal |
| `--lp-text-secondary` | `#4f5249` | Párrafos descriptivos |
| `--lp-brand-olive` | `#6c7156` | Botones primarios, badges e iconos de marca |
| `--lp-brand-coral` | `#e45d75` | Indicadores de precio, pasos y enlaces de énfasis |

### 2.3 Colores Hardcodeados Recurrentes Fuera de Tokens (Deriva Visual)

- **Verde Oliva Abatte (`#8c9668` / `#788254` / `#555843`)**: Codificado inline en `Dashboard.jsx`, `ReceptionDashboard.jsx`, `PlansConfig.jsx` y `CustomizeSystem.jsx`.
- **Índigo/Violeta SaaS (`#4f46e5` / `#6366f1`)**: Codificado inline en `SuperAdminDashboard.jsx` y modales de licenciamiento.

---

## 3. Tipografía y Jerarquía Escalar

- **Fuentes Cargadas (`index.html` / `src/index.css:1`)**:
  - `Plus Jakarta Sans` (pesos 300 a 800) e `Inter` (pesos 300 a 700) desde Google Fonts.
  - `Montserrat` referenciada en `--lp-font-display` (`src/pages/Landing.css:20`), aunque no importada explícitamente en `index.html` (cae en fallback a `Plus Jakarta Sans`).
- **Reglas Base (`src/index.css:49-54`)**:
  - `h1, h2, h3, h4, .brand-font` comparten `font-weight: 700` y `letter-spacing: -0.025em`, sin una escala modular definida en CSS global (cada vista define tamaños inline entre `0.65rem` y `2.25rem`).
- **Tipografía Fluida en Landing (`src/pages/Landing.css`)**:
  - `h1`: `clamp(1.85rem, 4.2vw, 3.15rem)` con `line-height: 1.12`.
  - `h2`: `clamp(1.5rem, 3vw, 2.25rem)`.

---

## 4. Layout, Rejilla y Espaciado

- **Shell de Aplicación (`src/index.css:56-102`)**:
  - `.app-container`: `display: flex; min-height: 100vh;`
  - `.sidebar`: ancho fijo de `260px` (`position: fixed`, `height: 100vh`, `z-index: 50`).
  - `.main-content`: `margin-left: 260px; padding: 2rem 3rem; max-width: 1600px; width: 100%;`
- **Breakpoints Responsivos (`src/index.css:359-462`)**:
  - `@media (max-width: 1024px)`: oculta `.sidebar` mediante `transform: translateX(-100%)`, activa `.mobile-header` (`height: 60px`) y reduce `.main-content` a `padding: 1rem; padding-top: 5rem;`.
  - `@media (max-width: 768px)`: colapsa `.stats-grid` y `.grid-responsive-2 / 3 / 4` a `1fr`.

---

## 5. Catálogo de Componentes Base (`src/index.css`)

1. **Tarjetas (`.card`, `.stat-card`)**:
   - Fondo `--surface`, radio `--radius-lg` (`1rem`), padding `1.5rem`, borde `1px solid var(--border)`, sombra `--shadow-md`.
   - En `.stat-card:hover` aplica `transform: translateY(-2px)` y `--shadow-lg`.
2. **Botones (`.btn`, `.btn-primary`, `.btn-secondary`)**:
   - Padding `0.625rem 1.25rem`, radio `--radius-md` (`0.75rem`), fuente `0.875rem` (`font-weight: 600`).
3. **Campos de Entrada (`.input-field`)**:
   - Padding `0.75rem 1rem`, radio `--radius-md`, borde `1px solid var(--border)`, fondo `#f8fafc`.
   - **Nota de Accesibilidad**: `.input-field:focus` define `outline: none; border-color: var(--primary); box-shadow: 0 0 0 4px var(--accent);`, careciendo de un anillo `:focus-visible` de alto contraste.
4. **Tablas (`.table-container`, `th`, `td`)**:
   - Cabeceras `th` con fondo `#f8fafc`, texto `0.75rem` en mayúsculas (`letter-spacing: 0.05em`).
   - Celdas `td` con padding `1rem 1.5rem` y `font-size: 0.875rem`.
5. **Badges Semánticos (`.badge-success`, `.badge-warning`, `.badge-error`)**:
   - Píldoras con `border-radius: 9999px`, `padding: 0.25rem 0.75rem` y `font-size: 0.75rem`.

---

## 6. Especificación de Impresión Térmica POS 80mm (`src/index.css:464-525`)

- Bajo `@media print`, oculta toda la interfaz excepto `#thermal-receipt-printable`.
- Ancho homologado de **`60mm`** alineado a la izquierda (`left: 0; top: 0; padding: 1mm 1mm 6mm 0.5mm;`) para prevenir recortes en el cabezal derecho de impresoras térmicas de 80mm.

---

## 7. Anti-Patrones Detectados y Reglas de Gobernanza Pendientes

1. **Prohibir estilos inline para layout y color**: Migrar los objetos `style={{...}}` de `VisitRecorder.jsx`, `SuperAdminDashboard.jsx` y `Dashboard.jsx` a clases semánticas en CSS.
2. **White-Label Multi-Tenant Real**: Conectar los colores configurados en `CustomizeSystem.jsx` (`localStorage` / preferencias del tenant) a variables CSS dinámicas (`--brand-primary`, `--brand-surface`) e inyectar el logo propio de cada salón en `.sidebar` en lugar de `/logo-black.png` hardcodeado.
3. **Targets Táctiles Mínimos**: Garantizar `min-height: 44px; min-width: 44px;` en todos los botones de acción de tabla y selectores numéricos.

