# Resultados de Suites de Integración sobre PostgreSQL 17.11 — Fase 3B.0

## 1. Contexto de Ejecución

- **Host**: `179.66.139.67` (Ubuntu 26.04.1 LTS).
- **Contenedor BD**: `salonpro_db` (`postgres:17.11-bookworm` en `salon_infra_net`, red `internal: true`).
- **Base de Datos**: `salon_saas_test` (aislada).
- **Rol de Runtime de Aplicación**: `salon_saas_test_user` (privilegios restringidos, sin superuser, sin bypassrls).
- **Variables de Entorno**: Inyectadas vía `/opt/salonpro/secrets/test.env` (0600 root:root).
- **Secuencia**: Ejecución estrictamente secuencial para proteger los recursos de la VPS sin swap.

---

## 2. Resultados Consolidados por Suite

| Suite | Comando Ejecutado | Total Tests | Resultado | Exit Code |
|---|---|---|---|---|
| **Preflight de Infraestructura** | `node backend/scripts/infrastructure_preflight.cjs` | 10 verificaciones físicas | **PASS (10/10)** | `0` |
| **Seguridad y Aislamiento Multi-Tenant (Fase 1)** | `node backend/test_phase1_multitenant_security.cjs` | 69 pruebas integrales | **PASS (69/69)** | `0` |
| **Seguridad y Remediación (Fase 2H-A)** | `node backend/tests/test_phase2h_security.cjs` | 32 pruebas RBAC y PIN | **PASS (32/32)** | `0` |
| **Moneda en Centavos e Idempotencia (Fase 2H-B)** | `node backend/tests/test_phase2h_money.cjs` | Múltiples flujos monetarios | **PASS (ALL)** | `0` |
| **Jobs Financieros y Worker CLI (Fase 2H-B)** | `node backend/tests/test_phase2h_jobs.cjs` | 11 flujos de resiliencia | **PASS (11/11)** | `0` |
| **Graceful Shutdown (Fase 2H-B)** | `node backend/tests/test_phase2h_shutdown.cjs` | Parada limpia de procesos | **PASS (ALL)** | `0` |
| **Separación Control Plane vs Tenant Plane (Fase 2H-C)** | `node backend/tests/test_phase2h_superadmin_separation.cjs` | 4 secciones de aislamiento | **PASS (ALL)** | `0` |
| **Personalización de Marca Multi-Tenant (Fase 2H-C)** | `node backend/tests/test_phase2h_branding.cjs` | 12 pruebas de sanitización y WCAG | **PASS (12/12)** | `0` |

---

## 3. Monitoreo de Recursos y Memoria RAM

Durante toda la ejecución secuencial de las pruebas, el consumo de memoria se mantuvo dentro de los parámetros de seguridad para un host sin swap:

- **Memoria Total del Host**: 3,910 MiB
- **Memoria Inicial Usada**: 672 MiB
- **Memoria Pico Usada durante Tests**: 766 MiB
- **Porcentaje de Uso Máximo**: **19.5% de RAM** (Límite operativo máximo: 75.0%)
- **Memoria Disponible en Host**: > 3,140 MiB en todo momento
- **Uso de Swap**: 0 / 0 (Sin thrashing, sin OOM killer)

---

## 4. Estado de las Bases de Datos Protegidas

Al finalizar todas las suites:
- `salon_saas_staging`: **0 tablas / 0 registros**.
- `salon_saas_prod`: **0 tablas / 0 registros**.
- Ninguna prueba tocó ni conectó con staging ni producción.

---

## 5. Auditoría de Gates Faltantes para Staging (Fase 3B.1 - Bloque 0)

Evaluación de los gates previos al despliegue de Staging:

| Gate | Comando | Estado | Observación |
|---|---|---|---|
| **P1 Security Suite** | `npm run test:phase2h:p1-security` | **DETENIDO (MISSING SCRIPT)** | `Missing script: "test:phase2h:p1-security"`. Se activó la condición obligatoria de parada: la Fase 2H-C no está finalizada respecto a los entregables P1. |
| **Linters** | `npm run lint` | **FAIL (Exit 1)** | 3 errores en `test_phase2f_e2e_browser.cjs`: `'getComputedStyle' is not defined` (no-undef). |
| **Protección de Staging** | Bases de Staging y Prod | **100% INTACTAS** | `salon_saas_staging` y `salon_saas_prod` permanecen estrictamente vacías (0 tablas). Cero modificaciones aplicadas. |


