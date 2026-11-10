# Runbook de Handoff para DBA: Aprovisionamiento de Infraestructura de Pruebas

**Incidente Asociado**: P1 - Contención de Pruebas sobre Base Operativa (`INC-2026-11-08-test-runner-production-db`)  
**Fecha**: 2026-11-09  
**Audiencia**: Administrador de Base de Datos (DBA) / Ingeniero de Infraestructura PostgreSQL  
**Objetivo**: Establecer los requerimientos de aprovisionamiento seguro para la base de pruebas `salon_saas_test`, priorizando una instancia/clúster físicamente separado y definiendo las salvaguardas estrictas requeridas en caso de utilizar el mismo clúster.

---

## 1. Topología de Infraestructura: Opciones de Despliegue

### 🌟 OPCIÓN A: Instancia o Clúster PostgreSQL Separado (ESTRICTAMENTE RECOMENDADA)
> [!IMPORTANT]
> **La única garantía de aislamiento físico real es una instancia o clúster de PostgreSQL independiente** (diferente máquina virtual, contenedor aislado o puerto de servicio independiente, ej. `:5433`).
> 
> **Ventajas Críticas**:
> - La base operativa `salon_saas_db` no existe en el catálogo `pg_database` del clúster de pruebas.
> - Cero riesgo de contención de locks, saturación del pool de conexiones o corrupción accidental de producción por fallos humanos o de configuración.
> - Elimina la necesidad de alterar los privilegios del rol `PUBLIC` en producción.

---

### ⚠️ OPCIÓN B: Mismo Clúster PostgreSQL (DEGRADADA / NO ES AISLAMIENTO FÍSICO)
> [!CAUTION]
> Crear otra base de datos dentro del mismo clúster productivo constituye **aislamiento lógico, NUNCA aislamiento físico**.  
> Comparten memoria (`shared_buffers`), procesos de background (`walwriter`, `checkpoint`), logs de WAL y catálogo global de roles (`pg_roles`).
> 
> **Peligro del Pseudo-Rol `PUBLIC` en PostgreSQL**:
> En PostgreSQL, todos los roles pertenecen implícitamente al pseudo-rol `PUBLIC`, y de forma predeterminada `PUBLIC` tiene otorgado el privilegio `CONNECT` sobre **todas** las bases de datos de la instancia.  
> Por tanto, ejecutar simplemente:
> ```sql
> REVOKE CONNECT ON DATABASE salon_saas_db FROM salon_saas_test_user;
> ```
> **NO neutraliza el acceso** de `salon_saas_test_user` hacia la base de producción, ya que dicho usuario continúa heredando el privilegio `CONNECT` concedido a `PUBLIC`.
> 
> **Requisitos Obligatorios e Innegociables para Opción B**:
> Para mitigar este riesgo en un mismo clúster, el DBA debe realizar obligatoriamente el siguiente protocolo antes de autorizar cualquier prueba:
> 1. **Inventario Exhaustivo de Roles**: Identificar todos los usuarios/roles legítimos que conectan a `salon_saas_db` (`salon_saas_user`, workers de background, réplicas, APIs).
> 2. **Concesión Explícita**: Otorgar `GRANT CONNECT ON DATABASE salon_saas_db TO <rol>;` de manera individual a cada uno de los roles legítimos inventariados.
> 3. **Revocación de `PUBLIC`**: Una vez asegurados los roles legítimos, ejecutar:
>    ```sql
>    REVOKE CONNECT ON DATABASE salon_saas_db FROM PUBLIC;
>    ```
> 4. **Regla de Rechazo en `pg_hba.conf`**: Configurar explícitamente en el archivo de control de accesos del servidor:
>    ```text
>    # Rechazo inmediato a nivel de socket/red para el usuario de pruebas en la base operativa
>    host    salon_saas_db    salon_saas_test_user    all    reject
>    ```
> 5. **Ventana de Mantenimiento y Aprobación Humana**: Revocar `CONNECT` de `PUBLIC` en una base operativa conlleva riesgo inminente de indisponibilidad si se omitió algún rol. Esta operación requiere una ventana formal de mantenimiento y la firma/aprobación de un ingeniero humano responsable.
> 
> > 🛑 **Nota de Seguridad**: Ni el asistente de IA ni ningún script automatizado ejecutarán estas operaciones de forma automática. Corresponde exclusivamente al DBA humano.

---

## 2. Nomenclatura Estricta y Principio de Privilegio Mínimo

> [!CAUTION]
> **Nomenclatura Estricta**:
> Por política de seguridad fail-closed (`test_env_guard.cjs`), el nombre de la base de datos de pruebas **DEBE terminar en `_test` o empezar con `test_`**.  
> **Nombre Aprobado**: `salon_saas_test`.  
> ⚠️ **NO USAR** `salon_saas_test_db` (termina en `_db` y el guardián fail-closed abortará la ejecución).

> [!IMPORTANT]
> **Privilegios del Rol de Pruebas**:
> El rol `salon_saas_test_user` debe crearse estrictamente con:
> `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`.

---

## 3. Instrucciones SQL para el DBA (Ejecutar Manualmente como `postgres`)

### En el Clúster Separado (Opción A - Recomendada):
```sql
-- 1. Crear base de datos de pruebas
CREATE DATABASE salon_saas_test
    WITH 
    OWNER = postgres
    ENCODING = 'UTF8'
    LC_COLLATE = 'en_US.UTF-8'
    LC_CTYPE = 'en_US.UTF-8'
    TABLESPACE = pg_default
    CONNECTION LIMIT = -1;

COMMENT ON DATABASE salon_saas_test IS 'Base de datos física dedicada exclusivamente a suites de pruebas y CI/CD.';

-- 2. Crear usuario de pruebas con privilegios mínimos
-- Reemplazar '<HIGH_ENTROPY_PASSWORD_MIN_32_CHARS>' por una clave aleatoria >= 32 caracteres
CREATE USER salon_saas_test_user WITH 
    NOSUPERUSER 
    NOCREATEDB 
    NOCREATEROLE 
    NOINHERIT 
    NOREPLICATION 
    NOBYPASSRLS 
    ENCRYPTED PASSWORD '<HIGH_ENTROPY_PASSWORD_MIN_32_CHARS>';

-- 3. Asignar privilegios exclusivos sobre salon_saas_test
GRANT CONNECT, TEMPORARY, CREATE ON DATABASE salon_saas_test TO salon_saas_test_user;

\c salon_saas_test

GRANT USAGE, CREATE ON SCHEMA public TO salon_saas_test_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO salon_saas_test_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO salon_saas_test_user;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO salon_saas_test_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO salon_saas_test_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO salon_saas_test_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO salon_saas_test_user;
```

---

## 4. Query de Certificación para el DBA

Ejecutar la siguiente consulta para validar el rol:

```sql
SELECT 
    rolname,
    rolsuper AS es_superuser,
    rolcreatedb AS tiene_createdb,
    rolcreaterole AS tiene_createrole,
    rolbypassrls AS tiene_bypassrls,
    has_database_privilege('salon_saas_test_user', 'salon_saas_test', 'CONNECT') AS acceso_pruebas_permitido,
    has_database_privilege('salon_saas_test_user', 'salon_saas_test', 'CREATE') AS create_esquemas_permitido
FROM pg_roles 
WHERE rolname = 'salon_saas_test_user';
```
*(Salida esperada: `false`, `false`, `false`, `false`, `true`, `true`)*.

---

## 5. Configuración de Parámetros de Conexión

Una vez aprovisionada la infraestructura, el DBA/Operador creará el archivo `.env.test` en la raíz del proyecto.

> [!CAUTION]
> **REGLAS CRÍTICAS DE SEGURIDAD**:
> 1. `ALLOW_INTEGRATION_TESTS="true"` **NUNCA** debe guardarse en `.env.test`. Se suministra exclusivamente en la consola o pipeline CI/CD.
> 2. `ISOLATED_CLUSTER_AUDIT="true"` **NUNCA** debe guardarse en `.env.test`. Se suministra exclusivamente en la consola del DBA o pipeline CI/CD tras verificar la existencia del clúster separado.
> 3. Cualquier archivo `.env.test` que contenga estas banderas será rechazado de inmediato por el runner con `FATAL SECURITY ABORT`.

### Contenido Válido de `.env.test`:
```ini
TEST_DB_HOST=<IP_O_HOST_DEL_CLUSTER_PRUEBAS>
TEST_DB_PORT=5432
TEST_DB_USER=salon_saas_test_user
TEST_DB_PASSWORD=<HIGH_ENTROPY_PASSWORD_MIN_32_CHARS>
TEST_DB_NAME=salon_saas_test
PRODUCTION_DB_NAME=salon_saas_db
JWT_SECRET=<JWT_SECRET_HEX_64_CHARS>
HISTORICAL_TEST_PASSWORD=<HISTORICAL_TEST_PASSWORD_MIN_32_CHARS>
ROTATED_SUPERADMIN_SECRET=<ROTATED_SUPERADMIN_SECRET_MIN_32_CHARS>
BACKUP_HMAC_KEY=<BACKUP_HMAC_KEY_HEX_64_CHARS>

# Si se usa host o puerto distinto para producción en la auditoría:
# PRODUCTION_DB_HOST=<IP_PRODUCCION>
# PRODUCTION_DB_PORT=5432
```

---

## 6. Comando de Verificación Automatizada (Preflight)

Para validar la infraestructura sin tocar datos operativos ni alterar esquemas, el operador ejecutará el preflight utilizando las variables de entorno volátiles en su sesión de terminal:

### En PowerShell (Windows):
```powershell
$env:ALLOW_INTEGRATION_TESTS = 'true'
$env:ISOLATED_CLUSTER_AUDIT = 'true'
npm run test:infrastructure-preflight
Remove-Item Env:ALLOW_INTEGRATION_TESTS
Remove-Item Env:ISOLATED_CLUSTER_AUDIT
```

### En Bash (Linux / CI/CD):
```bash
ALLOW_INTEGRATION_TESTS="true" ISOLATED_CLUSTER_AUDIT="true" npm run test:infrastructure-preflight
```

### Validaciones Realizadas por `infrastructure_preflight.cjs`:
1. **Identidad**: `current_database() === TEST_DB_NAME` y `current_user === TEST_DB_USER`.
2. **Aislamiento**:
   - Si `salon_saas_db` está en el clúster: exige `has_database_privilege(..., 'CONNECT') === false`.
   - Si `salon_saas_db` no está en el clúster: exige `$env:ISOLATED_CLUSTER_AUDIT = 'true'` o `PRODUCTION_DB_HOST` distinto para prevenir falsos positivos por errores de tipeo.
3. **Privilegios de Rol**: Confirma ausencia de `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `BYPASSRLS`.
4. **Capacidad de Creación de Esquemas**: Valida `CREATE` en `salon_saas_test` mediante creación y eliminación segura de un esquema temporal (`_preflight_schema_${Date.now()}`).
5. **Esquema `public`**: Verifica que esté limpio antes del inicio formal de las suites de prueba.
