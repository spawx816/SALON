# ADR-001: Estructura de 2 Planes Comerciales SaaS Multi-Tenant (Plan Base vs Plan Pro)

## Regla de Negocio Confirmada
El SaaS tendrá **únicamente 2 planes comerciales**:

1. **Plan Base (`base`)**:
   - **Incluye:** Facturación, POS (`VisitRecorder` facturando a Consumidor Final / Invitado), Catálogo de Productos y Servicios, Cajas Registradoras, Creación de Usuarios y gestión operativa del salón.
   - **Restricciones:** **NO permite registrar clientes** (`clients: false`) ni incluye nada del ecosistema de **Suscripciones / Membresías tipo Plan Beauty** (`memberships: false`).

2. **Plan Pro (`pro`)**:
   - **Incluye:** Todo lo del Plan Base + **Registro y Directorio de Clientes + Todo el módulo de Suscripciones / Membresías (Plan Beauty, Contratos Digitales, Pagos Recurrentes, Planes de Membresía, Cupo de Lavados, Cumpleaños, Encuestas y Gift Cards)** (`clients: true`, `memberships: true`).
