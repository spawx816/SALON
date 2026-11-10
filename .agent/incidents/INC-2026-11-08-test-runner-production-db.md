# INC-2026-11-08: Ejecución Insegura de Test Runner sobre Base de Datos Operativa

**Severidad**: P1 - Crítico (Riesgo de contaminación de datos operativos por test runner)  
**Fecha de Apertura**: 2026-11-08T15:45:00-04:00  
**Fecha de Contención Verificada**: 2026-11-08T17:45:00-04:00  
**Estado Formal**: `INCIDENTE CONTENIDO / FASE 1 PENDIENTE DE VALIDACIÓN DE INTEGRACIÓN / FASE 2 BLOQUEADA`  
**Roles Asignados**: Principal SaaS Architect, Security Architect, DevOps Lead

---

## 1. Resumen del Incidente

Durante la ejecución de las suites de prueba de la Fase 1, el runner maestro (`backend/scripts/run_all_phase1_tests.cjs`) y las suites subsidiarias recurrieron a la lectura de `backend/.env` para mapear los parámetros `DB_*` operativos hacia las variables `TEST_DB_*` bajo la autorización de schemas desechables (`ALLOW_DISPOSABLE_SCHEMA="true"`).

Aunque las operaciones se aislaron mediante transacciones y schemas desechables (`disposable_restore_*`, `quarantine_test_*`, `disposable_matrix_test_*`), el uso de la misma base de datos operativa (`salon_saas_db`) violó el principio de separación física entre entornos de prueba y producción.

**Impacto Potencial**: Riesgo de contención de transacciones en producción, saturación de conexiones del pool, y riesgo de ejecución accidental de DDL/DML contra tablas compartidas si falla un prefijo de schema.

---

## 2. Medidas de Contención y Endurecimiento Estático Aplicadas

1. **Reconciliación y Reglas Estrictas en `test_env_guard.cjs`**:
   - `PRODUCTION_DB_NAME` es un parámetro obligatorio y validado explícitamente.
   - `TEST_DB_NAME` se compara directamente contra `PRODUCTION_DB_NAME`.
   - Si `DB_NAME` existe en el entorno, se exige que coincida exactamente con `TEST_DB_NAME` (evitando contradicciones en procesos hijos y abortando ante contaminación operativa).

2. **Purga Rigurosa de Allowlists de Entorno**:
   - Eliminados `NODE_OPTIONS` y `NODE_PATH` de ambos allowlists (`run_all_phase1_tests.cjs` y `test_env_guard.cjs`) para impedir inyección de módulos precargados en subprocesos.
   - Purgadas de forma incondicional `DATABASE_URL`, `PGSERVICE`, `PGPASSFILE` y cualquier variable no permitida.
   - Eliminado cualquier fallback automático a `'salon_saas_db'`.

3. **Teardown Incondicional en Runner Maestro**:
   - Estructura `Gate 0` -> `try { Gate 0.5 .. 11 } finally { Teardown }`.
   - Se marca el inicio destructivo antes de `Gate 0.5` y el teardown se ejecuta sin importar fallos intermedios.
   - Si tanto un gate como el teardown fallan, se reportan ambos y se preserva el código del gate principal.
   - `teardown_test_db.cjs` valida las tres condiciones fail-closed: `current_database() === TEST_DB_NAME`, `current_database() !== PRODUCTION_DB_NAME`, y `current_user === TEST_DB_USER`.

4. **Endpoint `/api/health/db-check` Restringido a Pruebas**:
   - Montado exclusivamente cuando `NODE_ENV=test` y `ENABLE_TEST_ENDPOINTS=true`.
   - En producción y desarrollo no autorizado retorna HTTP 404 (evitando revelación de datos o usuario).

5. **Prueba Canónica de Cuarentena con Sesión Real y Limpieza Segura**:
   - `test_synthetic_quarantine_all7.cjs` crea una sesión sintética en `user_sessions`, vinculando `sessionId` en el JWT.
   - Limpieza completa ubicada en bloque `finally`, confirmando que 0 registros sintéticos queden en base de datos.
   - Espera efectiva de terminación del subproceso (`terminateProcess`).
   - Aborto seguro con detención del subproceso si el handshake falla.

6. **Preflight con Distinción de Clúster Separado**:
   - Si `PRODUCTION_DB_NAME` está en el clúster: valida `has_database_privilege('CONNECT') === false`.
   - Si `PRODUCTION_DB_NAME` no está en el clúster: requiere metadatos auditables (`ISOLATED_CLUSTER_AUDIT="true"` o host/puerto distinto), previniendo falsos positivos por nombres mal escritos.

---

## 3. Estado Actual y Próximos Pasos

- **Estado Actual**: Contenido. Ningún script conecta a la base operativa.
- **Validaciones Permitidas Verificadas**:
  - `npm run test:runner-guards`: 17 pruebas negativas mock aprobadas (Exit Code 0).
  - `npm run test:scanner`: 7 pruebas negativas AST + escaneo de 36 archivos aprobado (Exit Code 0).
  - `npm run lint`: 0 errores de sintaxis o estilo.
- **Bloqueo Vigente**: Las suites de integración física (`test_phase1_multitenant_security.cjs`, `prepare_test_db.cjs`, `migrate_all.cjs`, etc.) permanecen **detenidas y no ejecutadas** hasta que el DBA provea la base física dedicada `salon_saas_test` y su usuario con privilegios mínimos.
- **Fase 2**: Estrictamente bloqueada.
