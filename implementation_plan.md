# Plan de Implementación y Remediación: Aislamiento Físico y Contención del Test Runner

**Estado Formal**: `INCIDENTE CONTENIDO / FASE 1 PENDIENTE DE VALIDACIÓN DE INTEGRACIÓN / FASE 2 BLOQUEADA`  
**Incidente Asociado**: `INC-2026-11-08-test-runner-production-db` (P1 - Crítico)

**Objetivo:** Eliminar de forma absoluta cualquier lectura, conversión o fallback hacia `backend/.env` o la base de datos operativa en los scripts de prueba, garantizando que ninguna suite pueda ejecutarse a menos que se inyecte externamente una configuración de base de datos física independiente (`salon_saas_test`).

**Arquitectura:** Desacoplamiento total del entorno de pruebas frente a los archivos `.env` de producción/operativos. Modificación de `test_env_guard.cjs`, `run_all_phase1_tests.cjs`, y todas las suites de prueba para exigir variables de entorno provistas exclusivamente por el operador o por un archivo `.env.test` dedicado. Prohibición tajante de colisión entre `TEST_DB_NAME` y `PRODUCTION_DB_NAME`.

---

## Global Constraints
- Prohibido ejecutar cualquier prueba de integración contra `salon_saas_db` (base operativa).
- Prohibido cargar o leer `backend/.env` desde suites de prueba o el runner maestro.
- Prohibido auto-asignar `ALLOW_INTEGRATION_TESTS="true"` en archivos o código (debe provenir del shell/CI).
- Prohibido convertir automáticamente `DB_*` en `TEST_DB_*`.
- Prohibido permitir `TEST_DB_NAME === PRODUCTION_DB_NAME`, aún con `ALLOW_DISPOSABLE_SCHEMA=true`.
- Si `DB_NAME` está presente en el entorno, debe coincidir exactamente con `TEST_DB_NAME` (fail-closed ante discrepancia).
- Prohibida cualquier modificación de credenciales o hash de cuentas reales durante pruebas.
- Prohibido el uso de las 7 filas ambiguas en cuarentena como fixtures (usar IDs puramente sintéticos `synth-*`).
- Fase 2 estrictamente fuera de alcance.

---

## Resumen de Tareas de Remediación Ejecutadas

- [x] **Tarea 1: Reconciliación de Variables y Validación en `test_env_guard.cjs`**
  - `PRODUCTION_DB_NAME` obligatorio.
  - Comparación de `TEST_DB_NAME` contra `PRODUCTION_DB_NAME`.
  - Exigir `DB_NAME === TEST_DB_NAME` si `DB_NAME` existe en el entorno.
  - Retirar `NODE_OPTIONS` y `NODE_PATH` del allowlist.

- [x] **Tarea 2: Endurecimiento de Allowlists en `run_all_phase1_tests.cjs`**
  - Purgar `NODE_OPTIONS`, `NODE_PATH`, `DATABASE_URL`, `PGSERVICE`, `PGPASSFILE` y variables arbitrarias.
  - Inyectar `ENABLE_TEST_ENDPOINTS="true"`.
  - Reestructurar runner: `Gate 0` -> `try { Gate 0.5 .. 11 } finally { Teardown }`.
  - Marcar operaciones destructivas antes de `Gate 0.5` y ejecutar teardown incondicionalmente.

- [x] **Tarea 3: Invariantes Estrictas en `teardown_test_db.cjs`**
  - Validar `current_database() === TEST_DB_NAME`.
  - Validar `current_database() !== PRODUCTION_DB_NAME`.
  - Validar `current_user === TEST_DB_USER`.

- [x] **Tarea 4: Protección de Endpoint `/api/health/db-check` en `backend/server.js`**
  - Montar únicamente con `NODE_ENV=test` y `ENABLE_TEST_ENDPOINTS=true`.
  - Retornar HTTP 404 en producción y desarrollo no autorizado.

- [x] **Tarea 5: Cuarentena Canónica con Sesión y Limpieza Segura (`test_synthetic_quarantine_all7.cjs`)**
  - Subproceso hijo desacoplado de Node con entorno allowlist.
  - Creación de sesión sintética en `user_sessions` e inclusión de `sessionId` en JWT.
  - Limpieza de fixtures reubicada en bloque `finally` con verificación de 0 registros residuales.
  - Espera efectiva de terminación de proceso hijo (`terminateProcess`).

- [x] **Tarea 6: Preflight con Lógica de Clúster Separado (`infrastructure_preflight.cjs`)**
  - Inspeccionar `pg_database` antes de evaluar privilegios.
  - Distinguir producción en mismo clúster (`CONNECT=false`) de clúster separado (`ISOLATED_CLUSTER_AUDIT="true"` o host/puerto distinto).

- [x] **Tarea 7: Matriz Estricta de Catálogo (`verify_strict_matrix.cjs`)**
  - Validar B-Tree pos1 en `tenant_id`, FKs específicas a `tenants(id)`, reglas `ON DELETE CASCADE`.
  - Validar 4 triggers de cuarentena exactos, tablas y función `fn_enforce_quarantine_block`.
  - Validar conjunto canónico de secuencias seriales y 7 versiones registradas en `schema_migrations`.

- [x] **Tarea 8: Verificación Estática sin Conexión a Base de Datos**
  - `npm run test:runner-guards`: 17/17 casos negativos mock aprobados (Exit Code 0).
  - `npm run test:scanner`: 7/7 casos negativos + escaneo AST de 36 archivos aprobado (Exit Code 0).
  - `npm run lint`: 0 errores de sintaxis (Exit Code 0).

---

## Gates Pendientes de Ejecución Físicamente
1. `Gate 0`: Preflight físico contra `salon_saas_test` (`infrastructure_preflight.cjs`).
2. `Gate 0.5`: Reset físico determinista (`prepare_test_db.cjs`).
3. `Gate 0.6`: Migración secuencial sobre esquema limpio (`migrate_all.cjs`).
4. `Gate 0.7`: Verificación física de la matriz estricta de 61 tablas (`verify_strict_matrix.cjs`).
5. `Gates 1 a 11`: Suites de integración (`test_phase1_multitenant_security.cjs`, `test_synthetic_quarantine_all7.cjs`, etc.).
6. `Teardown`: Limpieza física post-ejecución contra PostgreSQL (`teardown_test_db.cjs`).
