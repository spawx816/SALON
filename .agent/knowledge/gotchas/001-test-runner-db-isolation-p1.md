# Gotcha: Aislamiento Físico Innegociable en Test Runners y Rechazo de Schemas Compartidos

**Fecha**: 2026-11-08  
**Clasificación**: Seguridad / Infraestructura / Testing Multi-Tenant  
**Incidente de Referencia**: `INC-2026-11-08-test-runner-production-db`

---

## 1. El Problema / Trampa (Gotcha)
Es una trampa común asumir que el uso de esquemas temporales (`CREATE SCHEMA disposable_...` con `DROP SCHEMA ... CASCADE`) o transacciones aisladas dentro de una base de datos operativa proporciona aislamiento suficiente para pruebas de integración.

### Consecuencias Críticas Identificadas:
1. **Contención y Bloqueos**: DDL en PostgreSQL (`ALTER TABLE`, creaciones de funciones, etc.) puede adquirir locks exclusivos temporales en el catálogo compartido (`pg_catalog`), degradando el rendimiento operativo.
2. **Falla en el Prefijo de Schema**: Si cualquier consulta en una suite o middleware carece del prefijo de esquema o falla el `search_path`, la operación se desvía inmediatamente al esquema `public`, arriesgando lecturas o mutaciones contra datos operativos.
3. **Falsa Sensación de Seguridad**: El runner puede auto-completar variables de prueba (`TEST_DB_*`) a partir del archivo de configuración operativo (`backend/.env`), borrando el límite entre entornos.

---

## 2. La Regla de Oro
> **NUNCA ejecutar suites de prueba contra la misma base de datos física donde residen los datos operativos.**
> La existencia de un schema diferente dentro de producción NO cuenta como aislamiento.
> `TEST_DB_NAME` debe ser estrictamente diferente de `DB_NAME` y apuntar a un cluster o base física independiente (ej. `salon_saas_test_db`).

---

## 3. Patrón Defensivo Implementado
En `backend/utils/test_env_guard.cjs`:
1. **Sin Excepciones para `TEST_DB_NAME === DB_NAME`**:
   Cualquier intento de ejecutar pruebas donde el nombre coincida con la base operativa aborta inmediatamente con `process.exit(1)`, sin importar si se han provisto banderas como `ALLOW_DISPOSABLE_SCHEMA="true"`.
2. **Prohibición de Lectura de `.env` Operativo**:
   Los runners y suites de prueba tienen terminantemente prohibido leer `backend/.env`. Las credenciales de prueba deben suministrarse externamente a través de variables de entorno de CI/CD o un archivo `.env.test` dedicado.
3. **Sanitización de Procesos Hijos (`getSanitizedChildEnv`)**:
   Antes de spawnear el servidor de pruebas en procesos hijos, se purgan (`delete`) activamente todas las variables operativas `DB_*` para evitar herencias accidentales.

