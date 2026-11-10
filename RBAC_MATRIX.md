# Matriz Exhaustiva de Control de Acceso Basado en Roles (RBAC)
**Sistema:** SalonPro SaaS (Plan Beauty RD)  
**Fecha:** 9 de Noviembre de 2026  
**Roles Evaluados:** 
1. `superadmin` (Administrador de la Plataforma SaaS)
2. `propietario` (Dueño del Salón / Tenant Owner)
3. `admin` (Administrador o Gerente del Salón)
4. `recepcionista` (Personal de Recepción y Citas)
5. `cajero` (Operador de Cobros y Caja)
6. `estilista` (Profesional de Belleza / Peluquera / Manicurista)
7. `empleado` (Personal General)
8. `cliente_b2c` (Clienta Final / Usuario B2C con suscripción Plan Beauty)

---

## 1. Convenciones y Estados de Auditoría
- **Protegido:** El endpoint cuenta con middleware de rol o validación explícita que restringe adecuadamente el acceso.
- **Vulnerable:** El endpoint solo valida autenticación genérica o tenant, permitiendo que roles no autorizados ejecuten la acción.
- **Ausente:** La regla de control de acceso no existe en código y cualquiera puede acceder.

---

## 2. Matriz de Endpoints por Módulo de Negocio

### 2.1 Autenticación y Gestión de Usuarios

| Endpoint HTTP | Método | Roles Permitidos | Roles Bloqueados | Requiere Tenant Scoping | Feature Flag | Requiere Auditoría | Estado Actual |
| :--- | :---: | :--- | :--- | :---: | :---: | :---: | :---: |
| `/api/auth/login` | `POST` | *Público* | Ninguno | NO | Ninguno | SÍ | Protegido |
| `/api/auth/client-login` | `POST` | *Público* | Ninguno | NO | Ninguno | SÍ | Vulnerable (sin rate limit) |
| `/api/auth/users` | `GET` | `propietario`, `admin` | `recepcionista`, `cajero`, `estilista`, `empleado`, `cliente_b2c` | SÍ | Ninguno | NO | Protegido (Local - Fase 2H-A) |
| `/api/auth/users` | `POST` | `propietario`, `admin` | `recepcionista`, `cajero`, `estilista`, `empleado`, `cliente_b2c` | SÍ | Ninguno | SÍ | Protegido (Local - Fase 2H-A) |
| `/api/auth/users/:id` | `PUT` | `propietario`, `admin` | `recepcionista`, `cajero`, `estilista`, `empleado`, `cliente_b2c` | SÍ | Ninguno | SÍ | Protegido (Local - Fase 2H-A) |
| `/api/auth/users/:id` | `DELETE` | `propietario` | `admin`, `recepcionista`, `cajero`, `estilista`, `empleado`, `cliente_b2c` | SÍ | Ninguno | SÍ | Protegido (Local - Fase 2H-A) |
| `/api/auth/logout` | `POST` | Todos los autenticados | Ninguno | SÍ | Ninguno | SÍ | Protegido |

---

### 2.2 Seguridad del Salón y PIN Administrativo

| Endpoint HTTP | Método | Roles Permitidos | Roles Bloqueados | Requiere Tenant Scoping | Feature Flag | Requiere Auditoría | Estado Actual |
| :--- | :---: | :--- | :--- | :---: | :---: | :---: | :---: |
| `/api/security/settings` | `GET` | `propietario`, `admin` | `recepcionista`, `cajero`, `estilista`, `empleado`, `cliente_b2c` | SÍ | Ninguno | NO | Protegido (Local - Sanitizado sin hash/PIN) |
| `/api/security/settings` | `POST` | `propietario` | `admin`, `recepcionista`, `cajero`, `estilista`, `empleado`, `cliente_b2c` | SÍ | Ninguno | SÍ | Protegido (Local - Fase 2H-A) |
| `/api/security/verify-pin` | `POST` | `propietario`, `admin`, `cajero`, `recepcionista` | `estilista`, `empleado`, `cliente_b2c` | SÍ | Ninguno | SÍ | Protegido (Local - Bcrypt + Lockout) |
| `/api/security/audit-logs` | `GET` | `propietario` | Todos los demás | SÍ | `PRO` | SÍ | Protegido |

---

### 2.3 POS, Ventas y Facturación

| Endpoint HTTP | Método | Roles Permitidos | Roles Bloqueados | Requiere Tenant Scoping | Feature Flag | Requiere Auditoría | Estado Actual |
| :--- | :---: | :--- | :--- | :---: | :---: | :---: | :---: |
| `/api/visits` | `GET` | `propietario`, `admin`, `recepcionista`, `cajero` | `estilista`, `empleado`, `cliente_b2c` | SÍ | Ninguno | NO | Vulnerable (cliente_b2c puede leer) |
| `/api/visits` | `POST` | `propietario`, `admin`, `recepcionista`, `cajero` | `estilista`, `empleado`, `cliente_b2c` | SÍ | Ninguno | SÍ | Protegido |
| `/api/visits/:id/checkout` | `POST` | `propietario`, `admin`, `recepcionista`, `cajero` | `estilista`, `empleado`, `cliente_b2c` | SÍ | Ninguno | SÍ | Protegido |
| `/api/visits/:id/void` | `POST` | `propietario`, `admin` (con PIN) | `recepcionista`, `cajero`, `estilista`, `empleado`, `cliente_b2c` | SÍ | Ninguno | SÍ | **Vulnerable (P1)** |
| `/api/visits/:id/commission-recipient` | `PUT` | `propietario`, `admin` (con PIN) | `recepcionista`, `cajero`, `estilista`, `empleado`, `cliente_b2c` | SÍ | Ninguno | SÍ | **Vulnerable (P1)** |

---

### 2.4 Control de Caja de Jornada (Cash Registers)

| Endpoint HTTP | Método | Roles Permitidos | Roles Bloqueados | Requiere Tenant Scoping | Feature Flag | Requiere Auditoría | Estado Actual |
| :--- | :---: | :--- | :--- | :---: | :---: | :---: | :---: |
| `/api/cash-registers/current` | `GET` | `propietario`, `admin`, `cajero`, `recepcionista` | `estilista`, `empleado`, `cliente_b2c` | SÍ | Ninguno | NO | **Vulnerable (P1)** |
| `/api/cash-registers/open` | `POST` | `propietario`, `admin`, `cajero`, `recepcionista` | `estilista`, `empleado`, `cliente_b2c` | SÍ | Ninguno | SÍ | Vulnerable (suplantación de operador) |
| `/api/cash-registers/:id/close` | `POST` | `propietario`, `admin`, `cajero` | `recepcionista`, `estilista`, `empleado`, `cliente_b2c` | SÍ | Ninguno | SÍ | Vulnerable (suplantación de operador) |
| `/api/cash-registers/:id/movements` | `POST` | `propietario`, `admin`, `cajero` | `recepcionista`, `estilista`, `empleado`, `cliente_b2c` | SÍ | Ninguno | SÍ | Protegido |
| `/api/cash-registers/:id/close-report` | `GET` | `propietario`, `admin` | `cajero`, `recepcionista`, `estilista`, `empleado`, `cliente_b2c` | SÍ | Ninguno | SÍ | Vulnerable |

---

### 2.5 Inventario Multi-Tenant

| Endpoint HTTP | Método | Roles Permitidos | Roles Bloqueados | Requiere Tenant Scoping | Feature Flag | Requiere Auditoría | Estado Actual |
| :--- | :---: | :--- | :--- | :---: | :---: | :---: | :---: |
| `/api/inventory/items` | `GET` | `propietario`, `admin`, `recepcionista`, `cajero` | `estilista`, `empleado`, `cliente_b2c` | SÍ | `inventory` | NO | Protegido |
| `/api/inventory/items` | `POST` | `propietario`, `admin` | `recepcionista`, `cajero`, `estilista`, `empleado`, `cliente_b2c` | SÍ | `inventory` | SÍ | Protegido |
| `/api/inventory/items/:id` | `PUT` | `propietario`, `admin` | `recepcionista`, `cajero`, `estilista`, `empleado`, `cliente_b2c` | SÍ | `inventory` | SÍ | Protegido |
| `/api/inventory/movements` | `POST` | `propietario`, `admin` | `recepcionista`, `cajero`, `estilista`, `empleado`, `cliente_b2c` | SÍ | `inventory` | SÍ | Protegido |
| `/api/inventory/alerts` | `GET` | `propietario`, `admin` | `recepcionista`, `cajero`, `estilista`, `empleado`, `cliente_b2c` | SÍ | `inventory` | NO | Protegido |
| `/api/inventory/valuation` | `GET` | `propietario`, `admin` | `recepcionista`, `cajero`, `estilista`, `empleado`, `cliente_b2c` | SÍ | `inventory_cost_valuation` (`PRO`) | SÍ | Protegido |

---

### 2.6 Suscripción y Facturación SaaS B2B

| Endpoint HTTP | Método | Roles Permitidos | Roles Bloqueados | Requiere Tenant Scoping | Feature Flag | Requiere Auditoría | Estado Actual |
| :--- | :---: | :--- | :--- | :---: | :---: | :---: | :---: |
| `/api/saas/plans` | `GET` | *Público / Todos* | Ninguno | NO | Ninguno | NO | Protegido |
| `/api/saas/billing/subscription` | `GET` | `propietario` | `admin`, `recepcionista`, `cajero`, `estilista`, `empleado`, `cliente_b2c` | SÍ | Ninguno | NO | Protegido |
| `/api/saas/billing/upgrade` | `POST` | `propietario` | `admin`, `recepcionista`, `cajero`, `estilista`, `empleado`, `cliente_b2c` | SÍ | Ninguno | SÍ | Protegido |
| `/api/saas/billing/downgrade` | `POST` | `propietario` | `admin`, `recepcionista`, `cajero`, `estilista`, `empleado`, `cliente_b2c` | SÍ | Ninguno | SÍ | Protegido |
| `/api/saas/billing/cancel` | `POST` | `propietario` | `admin`, `recepcionista`, `cajero`, `estilista`, `empleado`, `cliente_b2c` | SÍ | Ninguno | SÍ | Protegido |
| `/api/saas/billing/pay-debt` | `POST` | `propietario` | `admin`, `recepcionista`, `cajero`, `estilista`, `empleado`, `cliente_b2c` | SÍ | Ninguno | SÍ | Protegido (Local - Allowlist Rescate) |
| `/api/saas/billing/invoices` | `GET` | `propietario` | `admin`, `recepcionista`, `cajero`, `estilista`, `empleado`, `cliente_b2c` | SÍ | Ninguno | NO | Protegido |

---

### 2.7 Archivos y Documentos del Tenant

| Endpoint HTTP | Método | Roles Permitidos | Roles Bloqueados | Requiere Tenant Scoping | Feature Flag | Requiere Auditoría | Estado Actual |
| :--- | :---: | :--- | :--- | :---: | :---: | :---: | :---: |
| `/uploads/*` (estático) | `GET` | *Ninguno (Eliminado)* | Público | NO | Ninguno | NO | **Abolido (TENANT-001)** |
| `/api/tenant/files/:fileId` | `GET` | Autenticados del tenant | Usuarios externos o de otro tenant | SÍ | Ninguno | SÍ | Protegido (Local - Fase 2H-A) |

---

### 2.8 Portal SuperAdmin

| Endpoint HTTP | Método | Roles Permitidos | Roles Bloqueados | Requiere Tenant Scoping | Feature Flag | Requiere Auditoría | Estado Actual |
| :--- | :---: | :--- | :--- | :---: | :---: | :---: | :---: |
| `/api/saas/superadmin/tenants` | `GET` | `superadmin` | Todos los demás | NO (Cross-Tenant) | Ninguno | SÍ | Protegido |
| `/api/saas/superadmin/tenants/:id/suspend` | `POST` | `superadmin` | Todos los demás | NO (Cross-Tenant) | Ninguno | SÍ | Protegido |
| `/api/saas/superadmin/tenants/:id/reactivate` | `POST` | `superadmin` | Todos los demás | NO (Cross-Tenant) | Ninguno | SÍ | Protegido |
| `/api/saas/superadmin/metrics` | `GET` | `superadmin` | Todos los demás | NO (Cross-Tenant) | Ninguno | SÍ | Protegido |

---

### 2.9 Branding e Identidad Visual del Salón (Tenant Plane)

| Endpoint HTTP | Método | Roles Permitidos | Roles Bloqueados | Requiere Tenant Scoping | Feature Flag | Requiere Auditoría | Estado Actual |
| :--- | :---: | :--- | :--- | :---: | :---: | :---: | :---: |
| `/api/tenant/branding` | `GET` | Autenticados del salón | `superadmin`, usuarios externos | SÍ | Ninguno | NO | Protegido (Fase 2H-C) |
| `/api/tenant/branding` | `PUT` | `propietario`, `admin` | `superadmin`, `recepcionista`, `cajero`, `estilista`, `empleado`, `cliente_b2c` | SÍ | Ninguno | SÍ | Protegido (Fase 2H-C) |
| `/api/tenant/branding/reset` | `POST` | `propietario`, `admin` | `superadmin`, `recepcionista`, `cajero`, `estilista`, `empleado`, `cliente_b2c` | SÍ | Ninguno | SÍ | Protegido (Fase 2H-C) |
| `/api/public/branding/:slug` | `GET` | *Público / Todos* | Ninguno (Sin datos internos ni PII) | SÍ (Por slug público) | Ninguno | NO | Protegido (Fase 2H-C) |

---

## 3. Principio de Menor Privilegio: Resumen de Asignaciones

1. **SuperAdmin:** Administrador de la plataforma SaaS (Control Plane). Acceso irrestricto a la gestión de salones (tenants), activación, suspensión, métricas globales de plataforma, planes BASE/PRO y facturación SaaS de la plataforma. **Estrictamente bloqueado de toda operación interna de cualquier salón (POS, facturación interna, inventario, clientes, empleados, nómina, asistencia, comisiones, egresos, reportes privados, PIN de salón y archivos privados)**.

---

## 4. Separación Estricta: Control Plane vs Tenant Plane (Fase 2H-C)

### 4.1 Principio de Aislamiento
El rol `superadmin` gobierna la infraestructura y la relación SaaS con los salones, pero **no tiene acceso operativo a los datos privados del salón**.
- El middleware `rejectControlPlaneRoleOnTenantRoutes` intercepta y rechaza con `403 CONTROL_PLANE_ROLE_FORBIDDEN` cualquier petición de `superadmin` hacia rutas del Tenant Plane.
- El contexto `req.tenantId` es permanentemente `null` para `superadmin`. Se prohíbe adoptar contexto de tenant mediante cabeceras `x-tenant-id`, query string `?tenant_id=` o cuerpo JSON.
- Las intervenciones de soporte técnico requieren obligatoriamente un ticket formal (`support_ticket_id` y `support_reason`), restringidas exclusivamente a auditorías autorizadas en endpoints de seguridad específicos.

### 4.2 Matriz de Límites Plan de Control vs Plan del Tenant

| Ámbito | Módulo / Ruta | Rol `superadmin` (Control Plane) | Roles del Tenant (`propietario`, `admin`, `cajero`, etc.) | Código de Error en Infracción |
| :--- | :--- | :---: | :---: | :---: |
| **Control Plane** | `/api/saas/metrics` | **PERMITIDO** | BLOQUEADO | `403 CONTROL_PLANE_ROLE_REQUIRED` |
| **Control Plane** | `/api/saas/tenants` | **PERMITIDO** | BLOQUEADO | `403 CONTROL_PLANE_ROLE_REQUIRED` |
| **Control Plane** | `/api/saas/subscriptions` | **PERMITIDO** | BLOQUEADO | `403 CONTROL_PLANE_ROLE_REQUIRED` |
| **Control Plane** | `/api/saas/invoices` | **PERMITIDO** | BLOQUEADO | `403 CONTROL_PLANE_ROLE_REQUIRED` |
| **Tenant Plane** | `/api/visits` (POS) | **BLOQUEADO** | Según rol tenant | `403 CONTROL_PLANE_ROLE_FORBIDDEN` |
| **Tenant Plane** | `/api/invoices` | **BLOQUEADO** | Según rol tenant | `403 CONTROL_PLANE_ROLE_FORBIDDEN` |
| **Tenant Plane** | `/api/cash-registers` | **BLOQUEADO** | Según rol tenant | `403 CONTROL_PLANE_ROLE_FORBIDDEN` |
| **Tenant Plane** | `/api/clients` | **BLOQUEADO** | Según rol tenant | `403 CONTROL_PLANE_ROLE_FORBIDDEN` |
| **Tenant Plane** | `/api/inventory` | **BLOQUEADO** | Según rol tenant | `403 CONTROL_PLANE_ROLE_FORBIDDEN` |
| **Tenant Plane** | `/api/payroll` | **BLOQUEADO** | Según rol tenant | `403 CONTROL_PLANE_ROLE_FORBIDDEN` |
| **Tenant Plane** | `/api/attendance` | **BLOQUEADO** | Según rol tenant | `403 CONTROL_PLANE_ROLE_FORBIDDEN` |
| **Tenant Plane** | `/api/commissions` | **BLOQUEADO** | Según rol tenant | `403 CONTROL_PLANE_ROLE_FORBIDDEN` |
| **Tenant Plane** | `/api/expenses` | **BLOQUEADO** | Según rol tenant | `403 CONTROL_PLANE_ROLE_FORBIDDEN` |
| **Tenant Plane** | `/api/reports` | **BLOQUEADO** | Según rol tenant | `403 CONTROL_PLANE_ROLE_FORBIDDEN` |
| **Tenant Plane** | `/api/dgii` / `/api/fe` | **BLOQUEADO** | Según rol tenant | `403 CONTROL_PLANE_ROLE_FORBIDDEN` |
| **Tenant Plane** | `/api/contracts` | **BLOQUEADO** | Según rol tenant | `403 CONTROL_PLANE_ROLE_FORBIDDEN` |
| **Tenant Plane** | `/api/plans` (B2C) | **BLOQUEADO** | Según rol tenant | `403 CONTROL_PLANE_ROLE_FORBIDDEN` |
| **Tenant Plane** | `/api/tenant/files` | **BLOQUEADO** | Según rol tenant | `403 CONTROL_PLANE_ROLE_FORBIDDEN` |
| **Tenant Plane** | `/api/security/verify-pin` | **BLOQUEADO** | Según rol tenant | `403 CONTROL_PLANE_ROLE_FORBIDDEN` |
| **Tenant Plane** | `/api/security/settings` | **BLOQUEADO** (Salvo soporte formal) | `propietario` | `403 CONTROL_PLANE_ROLE_FORBIDDEN` |
| **Tenant Plane** | `/api/users` | **BLOQUEADO** | `propietario`, `admin` | `403 CONTROL_PLANE_ROLE_FORBIDDEN` |

2. **Propietario:** Administrador supremo del salón. Acceso único a facturación SaaS de SalonPro, eliminación de usuarios, configuración del PIN de administrador, auditoría y exportación de datos.
3. **Administrador:** Gestión operativa del salón (servicios, empleados, inventario, asistencia, arqueos de caja). Bloqueado para ver suscripción SaaS del salón y cambiar la propiedad del salón.
4. **Recepcionista:** Registro de visitas, asignación de citas, clientes B2C, pre-cuenta y tickets térmicos de 60mm. Bloqueada para anulación de facturas sin autorización o ajustes de inventario.
5. **Cajero:** Cobro de visitas en POS, apertura y cierre de caja, registro de gastos e ingresos manuales. Bloqueado para modificar precios de catálogo o ver salarios de empleados.
6. **Estilista / Empleado:** Consulta de comisiones personales y registro de asistencia facial en kiosco. Bloqueado para cualquier módulo administrativo, POS o configuración.
7. **Cliente B2C:** Consulta de sus lavados Plan Beauty disponibles, historial personal de visitas, estado de su membresía y descarga de su contrato digital. Bloqueado terminantemente de cualquier ruta operativa del salón.

