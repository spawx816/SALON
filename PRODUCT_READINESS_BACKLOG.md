# Backlog Priorizado de Remediación para Producción
**Sistema:** SalonPro SaaS (Plan Beauty RD)  
**Fecha:** 9 de Noviembre de 2026  
**Estrategia:** Enfoque por Severidad (P0 -> P1 -> P2 -> P3) y Viabilidad Local (Sin Infraestructura Externa)  

---

## 1. Visión General de la Remediación

Este backlog organiza las 41 incidencias y oportunidades de mejora identificadas en la auditoría `PRODUCT_READINESS_AUDIT.md`. La remediación se divide en tres fases lógicas:
1. **Fase R1 — Cierre de Brechas Críticas Locales (P0 & P1 In-Memory):** Solución inmediata de fallos de autorización, RBAC, PIN administrativo, suspensión de tenants, aritmética monetaria, scheduler y graceful shutdown utilizando la arquitectura in-memory y suite de tests.
2. **Fase R2 — Resiliencia, Sanitización y Rendimiento (P1 & P2):** Optimización de bundles frontend, idempotencia en anulación, protección CSRF/Rate-limit, y mitigación de CVEs en dependencias.
3. **Fase R3 — Estabilización con Infraestructura (PostgreSQL & Despliegue):** Locks de concurrencia en base física, índices de alto rendimiento y orquestación de workers.

---

## 2. Matriz Consolidada de Tareas de Remediación

| ID Tarea | Título de la Tarea | Severidad | Esfuerzo | Prerrequisitos | Infra Externa Requerida | Estado |
| :--- | :--- | :---: | :---: | :--- | :---: | :---: |
| **REM-P0-01** | Proteger rutas de creación/edición de usuarios con RBAC estricto | `P0` | **S** | Ninguno | **NO (Local)** | **RESUELTO LOCALMENTE (Fase 2H-A)** |
| **REM-P0-02** | Hashear PIN administrativo con bcrypt y restringir endpoint a propietarios | `P0` | **M** | Ninguno | **NO (Local)** | **RESUELTO LOCALMENTE (Fase 2H-A)** |
| **REM-P0-03** | Permitir acceso a facturación y rescate de cuenta en tenants suspendidos | `P0` | **S** | Ninguno | **NO (Local)** | **RESUELTO LOCALMENTE (Fase 2H-A)** |
| **REM-P0-04** | Migrar cálculos del POS y caja de coma flotante (`Number`) a Minor Currency Units | `P0` | **M** | MoneyValueObject (Fase 2D) | **NO (Local)** | **RESUELTO LOCALMENTE (Fase 2H-B)** |
| **REM-P0-05** | Desacoplar scheduler de cobros recurrentes de `setInterval` en Express y eliminar hostname 'SPAWX' | `P0` | **M** | `billing_job_scheduler.port.js` | **NO (Local)** | **RESUELTO LOCALMENTE (Fase 2H-B)** |
| **REM-P0-06** | Implementar parada controlada (*Graceful Shutdown* `SIGTERM`/`SIGINT`) en `server.js` | `P0` | **S** | Ninguno | **NO (Local)** | **RESUELTO LOCALMENTE (Fase 2H-B)** |
| **REM-P0-07** | Proteger directorio estático `/uploads` con autorización por tenant | `P0` | **M** | Ninguno | **NO (Local)** | **RESUELTO LOCALMENTE (Fase 2H-A)** |
| **REM-P0-08** | Separación estricta SuperAdmin Control Plane vs Tenant Plane (Bloqueo backend y frontend) | `P0` | **M** | RBAC-005 | **NO (Local)** | **RESUELTO LOCALMENTE (Fase 2H-C)** |
| **REM-P0-09** | Branding multi-tenant personalizable y eliminación de marca global 'Abatte' (Tokens CSS, WCAG) | `P0` | **M** | TENANT-003 | **NO (Local)** | **RESUELTO LOCALMENTE (Fase 2H-C)** |
| **REM-P1-01** | Implementar revocación de tokens JWT mediante `token_version` en usuarios | `P1` | **M** | REM-P0-01 | **NO (Local)** | **RESUELTO (Fase 2H-C / test:phase2h:p1-security)** |
| **REM-P1-02** | Robustecer validación CSRF para requerir Origin/Referer en métodos mutantes | `P1` | **S** | Ninguno | **NO (Local)** | **RESUELTO (Fase 2H-C / test:phase2h:p1-security)** |
| **REM-P1-03** | Aplicar Rate Limiting estricto en login de clientes B2C y recuperación de contraseñas | `P1` | **S** | Ninguno | **NO (Local)** | **RESUELTO (Fase 2H-C / test:phase2h:p1-security)** |
| **REM-P1-04** | Proteger o eliminar endpoint público no autenticado `/api/contact-messages` | `P1` | **S** | Ninguno | **NO (Local)** | **RESUELTO (Fase 2H-C / test:phase2h:p1-security)** |
| **REM-P1-05** | Bloquear acceso de tokens de clientes B2C (`isClient: true`) a rutas de personal y cajas | `P1` | **S** | Ninguno | **NO (Local)** | **RESUELTO (Fase 2H-C / test:phase2h:p1-security)** |
| **REM-P1-06** | Exigir PIN de supervisor o rol administrativo en anulación de facturas | `P1` | **S** | REM-P0-02 | **NO (Local)** | **RESUELTO (Fase 2H-C / test:phase2h:p1-security)** |
| **REM-P1-07** | Garantizar idempotencia en anulación de facturas (prevenir duplicación de stock) | `P1` | **S** | Ninguno | **NO (Local)** | **RESUELTO (Fase 2H-B / test:phase2h:p1-security)** |
| **REM-P1-08** | Asignar operador de caja (`opened_by`/`closed_by`) exclusivamente desde `req.auth` | `P1` | **S** | Ninguno | **NO (Local)** | **RESUELTO (Fase 2H-C / test:phase2h:p1-security)** |
| **REM-P1-09** | Disparador de cumpleaños seguro: firma HMAC (`x-job-signature`), timestamp, nonce de un solo uso, protección anti-replay y persistencia fail-closed en `job_request_nonces` | `P1` | **M** | Ninguno | **NO (Local)** | **RESUELTO (Fase 3B.0.1 / test:jobs:hmac)** |
| **REM-P1-10** | Migrar almacenamiento de fotos biométricas en `attendance` a URLs o referencias externas (AES-256-GCM Private Storage) | `P1` | **L** | Storage adapter | **SÍ (PostgreSQL)** | **RESUELTO (Fase 3B.2B / test:phase3b:p1-remaining)** |
| **REM-P1-11** | Cifrar o desacoplar almacenamiento de firmas digitales en contratos (AES-256-GCM Private Storage) | `P1` | **M** | Storage adapter | **SÍ (PostgreSQL)** | **RESUELTO (Fase 3B.2B / test:phase3b:p1-remaining)** |
| **REM-P1-12** | Optimizar bundle frontend: code-splitting y eliminación total de `xlsx` vulnerable | `P1` | **M** | Ninguno | **NO (Local)** | **RESUELTO (Fase 3B.2B / test:phase3b:p1-remaining)** |
| **REM-P1-13** | Crear middleware global de captura de errores y sanitización de respuestas 500 (sin fuga de stack traces) | `P1` | **S** | Ninguno | **NO (Local)** | **RESUELTO (Fase 2H-C / test:phase2h:p1-security)** |
| **REM-P1-14** | Actualizar dependencias vulnerables en backend (`proxy-addr`, `axios`, `nodemailer`, 0 CVEs) | `P1` | **M** | Tests de regresión | **NO (Local)** | **RESUELTO (Fase 3B.2B / test:phase3b:p1-remaining)** |
| **REM-P1-15** | Reemplazar librería vulnerable `xlsx` por alternativa segura (CSV RFC 4180 streaming con saneamiento de inyección de fórmulas) | `P1` | **M** | REM-P1-12 | **NO (Local)** | **RESUELTO (Fase 3B.2B / test:phase3b:p1-remaining)** |
| **REM-P1-16** | Optimizar cálculo de comisiones eliminando consultas N+1 con inserts en batch y complejidad O(1) | `P1` | **M** | Ninguno | **SÍ (PostgreSQL)** | **RESUELTO (Fase 3B.2B / test:phase3b:p1-remaining)** |
| **REM-P1-17** | Implementar exportación completa de datos de tenant (`tenant data portability` / GDPR con cifrado y re-auth) | `P1` | **L** | Ninguno | **SÍ (PostgreSQL)** | **RESUELTO (Fase 3B.2B / test:phase3b:p1-remaining)** |
| **REM-P1-18** | Agregar bloqueo pesimista (`FOR UPDATE`) en descuento de inventario en base relacional con reversión atómica | `P1` | **M** | Requiere PostgreSQL | **SÍ (PostgreSQL)** | **RESUELTO (Fase 3B.2B / test:phase3b:p1-remaining)** |
| **REM-P2-01** | Filtrar nombres de salones ajenos en autocompletados globales multi-tenant | `P2` | **S** | Ninguno | **NO (Local)** | Pendiente |
| **REM-P2-02** | Incorporar alerta y confirmación doble ante discrepancias de arqueo de caja | `P2` | **S** | Ninguno | **NO (Local)** | Pendiente |
| **REM-P2-03** | Crear módulo de toma física periódica y ajuste masivo de inventario | `P2` | **M** | Ninguno | **NO (Local)** | Pendiente |
| **REM-P2-04** | Sanitizar logs de auditoría para evitar imprimir correos o teléfonos en texto plano | `P2` | **S** | Ninguno | **NO (Local)** | Pendiente |
| **REM-P2-05** | Implementar virtualización de tablas DOM para historial de asistencia y ventas | `P2` | **M** | Ninguno | **NO (Local)** | Pendiente |
| **REM-P2-06** | Corregir accesibilidad WCAG en modales de cobro POS (trampa de foco y aria-live) | `P2` | **S** | Ninguno | **NO (Local)** | Pendiente |
| **REM-P2-07** | Configurar timeouts explícitos en servidor HTTP Express y clientes externos | `P2` | **S** | Ninguno | **NO (Local)** | Pendiente |
| **REM-P2-08** | Crear índices compuestos en tablas relacionales (`visits`, `attendance`, `commissions`) | `P2` | **S** | Requiere PostgreSQL | **SÍ (PostgreSQL)** | En pausa |
| **REM-P2-09** | Diseñar política automatizada de purga y retención de datos tras cancelación | `P2` | **M** | Ninguno | **NO (Local)** | Pendiente |
| **REM-P3-01** | Armonizar espaciados tipográficos en vistas de reportes secundarios | `P3` | **S** | Ninguno | **NO (Local)** | Pendiente |
| **REM-P3-02** | Sincronizar esquemas Swagger / OpenAPI con endpoints de Fase 2E | `P3` | **S** | Ninguno | **NO (Local)** | Pendiente |
| **REM-P3-03** | Estandarizar logging estructurado en formato JSON para CloudWatch / Datadog | `P3` | **S** | Ninguno | **NO (Local)** | Pendiente |

---

## 3. Plan de Ejecución Recomendado

### Sprint 1: Blindaje de Seguridad y Control de Acceso (Local)
- **Objetivo:** Erradicar todos los bloqueadores P0 de autenticación, RBAC y administración.
- **Entregables:** `REM-P0-01`, `REM-P0-02`, `REM-P0-03`, `REM-P0-08` (Separación Control Plane), `REM-P1-05`, `REM-P1-06`, `REM-P1-08`.
- **Verificación:** Tests unitarios e integración HTTP en `tests/`.

### Sprint 2: Integridad Financiera y Automatizaciones (Local)
- **Objetivo:** Resolver riesgos de sobrecobro, pérdida de dinero por redondeo y fallos en tareas de fondo.
- **Entregables:** `REM-P0-04`, `REM-P0-05`, `REM-P0-06`, `REM-P1-07`, `REM-P1-09`, `REM-P1-13`.
- **Verificación:** Simulaciones de facturación con decimales y pruebas de parada controlada.

### Sprint 3: Limpieza de Dependencias, PII y Performance Frontend (Local)
- **Objetivo:** Eliminar vulnerabilidades CVE, reducir tamaño de bundle y proteger privacidad.
- **Entregables:** `REM-P0-07`, `REM-P1-01`, `REM-P1-02`, `REM-P1-03`, `REM-P1-04`, `REM-P1-10`, `REM-P1-11`, `REM-P1-12`, `REM-P1-14`, `REM-P1-15`, `REM-P1-16`.
- **Verificación:** `npm audit` limpio, bundle analyzer y tests de frontend con Vite.

### Sprint 4: Estabilización de Base de Datos y Despliegue (Requiere Infraestructura)
- **Objetivo:** Ejecutar migraciones en PostgreSQL físico, índices y locks de concurrencia.
- **Entregables:** `REM-P1-18`, `REM-P2-08`, validación con CardNet real y preflight de producción.
- **Prerrequisito:** Levantamiento de la pausa de infraestructura autorizada por el usuario.

