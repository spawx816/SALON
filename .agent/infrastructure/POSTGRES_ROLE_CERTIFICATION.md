# Certificación de Aislamiento de Roles y Bases de Datos (Fase 3A.3)

**Servidor Objetivo:** `179.66.139.67` (`srv2145352`)  
**Motor:** PostgreSQL 17.4 (`postgres:17.4-bookworm`) en contenedor Docker privado `salonpro_db`  
**Red:** `salon_infra_net` (Aislada, sin puertos públicos expuestos)  
**Fecha de Certificación:** 10 de Noviembre de 2026 01:21:00 UTC  
**Estado:** `100% CERTIFICADO / AISLAMIENTO FÍSICO Y LÓGICO VERIFICADO`

---

## 1. Convención Canónica de Bases de Datos

| Ambiente | Nombre de Base de Datos | Rol Propietario (`NOLOGIN`) | Rol Migrador (`LOGIN`) | Rol de Runtime (`LOGIN`) |
| :--- | :--- | :--- | :--- | :--- |
| **Producción** | `salon_saas_prod` | `salon_saas_prod_owner` | `salon_saas_prod_migrator` | `salon_saas_prod_user` |
| **Staging** | `salon_saas_staging` | `salon_saas_staging_owner` | `salon_saas_staging_migrator` | `salon_saas_staging_user` |
| **Pruebas** | `salon_saas_test` | `salon_saas_test_owner` | `salon_saas_test_migrator` | `salon_saas_test_user` |

> **Metadato canónico obligatorio:**  
> `PRODUCTION_DB_NAME=salon_saas_prod`  
> *(Las menciones históricas a `salon_saas_db` en incidentes y runbooks pasados quedan archivadas como antecedentes).*

---

## 2. Matriz de Pruebas de Certificación de Aislamiento

Se ejecutaron las 16 verificaciones automatizadas de seguridad con los siguientes resultados exactos:

| ID | Rol Evaluado | Base Objetivo | Operación / Verificación | Resultado Esperado | Resultado Real | Estado |
| :---: | :--- | :--- | :--- | :--- | :--- | :---: |
| **ISO-01** | `salon_saas_prod_user` | `salon_saas_prod` | Conexión con password de producción | Exit 0 (Permitido) | Exit 0 | ✅ PASS |
| **ISO-02** | `salon_saas_prod_user` | `salon_saas_staging` | Intento de conexión a staging | Permission denied | FATAL: permission denied | ✅ PASS |
| **ISO-03** | `salon_saas_prod_user` | `salon_saas_test` | Intento de conexión a test | Permission denied | FATAL: permission denied | ✅ PASS |
| **ISO-04** | `salon_saas_prod_user` | `salon_saas_prod` | `rolsuper, rolcreatedb, rolcreaterole, rolbypassrls` | `f \| f \| f \| f` | `f \| f \| f \| f` | ✅ PASS |
| **ISO-05** | `salon_saas_prod_user` | `salon_saas_prod` | `CREATE SCHEMA _test` (Runtime no crea schemas) | Permission denied | ERROR: permission denied | ✅ PASS |
| **ISO-06** | `salon_saas_staging_user`| `salon_saas_staging`| Conexión con password de staging | Exit 0 (Permitido) | Exit 0 | ✅ PASS |
| **ISO-07** | `salon_saas_staging_user`| `salon_saas_prod` | Intento de conexión a producción | Permission denied | FATAL: permission denied | ✅ PASS |
| **ISO-08** | `salon_saas_staging_user`| `salon_saas_test` | Intento de conexión a test | Permission denied | FATAL: permission denied | ✅ PASS |
| **ISO-09** | `salon_saas_staging_user`| `salon_saas_staging`| `rolsuper, rolcreatedb, rolcreaterole, rolbypassrls` | `f \| f \| f \| f` | `f \| f \| f \| f` | ✅ PASS |
| **ISO-10** | `salon_saas_staging_user`| `salon_saas_staging`| `CREATE SCHEMA _test` (Runtime no crea schemas) | Permission denied | ERROR: permission denied | ✅ PASS |
| **ISO-11** | `salon_saas_test_user` | `salon_saas_test` | Conexión con password de pruebas | Exit 0 (Permitido) | Exit 0 | ✅ PASS |
| **ISO-12** | `salon_saas_test_user` | `salon_saas_prod` | Intento de conexión a producción | Permission denied | FATAL: permission denied | ✅ PASS |
| **ISO-13** | `salon_saas_test_user` | `salon_saas_staging` | Intento de conexión a staging | Permission denied | FATAL: permission denied | ✅ PASS |
| **ISO-14** | `salon_saas_test_user` | `salon_saas_test` | `rolsuper, rolcreatedb, rolcreaterole, rolbypassrls` | `f \| f \| f \| f` | `f \| f \| f \| f` | ✅ PASS |
| **ISO-15** | `salon_saas_test_user` | `salon_saas_test` | `CREATE SCHEMA _synth; DROP SCHEMA _synth;` | Exit 0 (Autorizado para QA) | Exit 0 | ✅ PASS |
| **ISO-16** | `PUBLIC` | Todas las bases | `has_database_privilege('public', db, 'CONNECT')` | `f` en todas las bases | `f \| f \| f` | ✅ PASS |

---

## 3. Certificación de Privilegios Mínimos
- **Superusuario:** Ningún rol de runtime ni migrador es superusuario.
- **Creación de bases y roles:** Ningún rol de runtime ni migrador posee `CREATEDB` ni `CREATEROLE`.
- **Row Level Security (RLS):** Ningún rol posee `BYPASSRLS`.
- **Esquema `public`:** `REVOKE ALL ON SCHEMA public FROM PUBLIC` ejecutado en las tres bases de datos.
- **Search Path:** Configurado explícitamente a `public` para cada usuario.

