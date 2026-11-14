# ADR-001: Estructura de 2 Planes Comerciales SaaS Multi-Tenant (Plan Base vs Plan Pro)

## Regla de Negocio Confirmada
El SaaS tendrá **únicamente 2 planes comerciales**:

1. **Plan Base (`base`)**:
   - **Incluye:** Facturación, POS (`VisitRecorder` facturando a Consumidor Final / Invitado o cliente registrado), **Clientes / CRM (`clients: true`)** (crear, consultar, editar, buscar/paginar, fichas técnicas e historial operativo del tenant), Inventario básico (`inventory: true`), Catálogo de Productos y Servicios, Cajas Registradoras, Creación de Usuarios y gestión operativa del salón.
   - **Restricciones:** **NO incluye** el ecosistema de **Suscripciones / Membresías B2C (`memberships: false`)**, **Contratos de membresías**, **Marketing (`marketing: false`)**, ni **Inventario Avanzado (`inventory_advanced: false`)**. Las respuestas y formularios de Clientes en Plan BASE omiten y bloquean campos o acciones de membresías.

2. **Plan Pro (`pro`)**:
   - **Incluye:** Todo lo del Plan Base + **Clientes / CRM (`clients: true`)** + **Todo el módulo de Suscripciones / Membresías B2C (`memberships: true`: Plan Beauty, Contratos Digitales, Pagos Recurrentes, Planes de Membresía, Cupo de Lavados)** + **Marketing (`marketing: true`: Cumpleaños, Encuestas, Gift Cards)** + **Inventario Avanzado (`inventory_advanced: true`)**.
