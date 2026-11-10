# Informe de Preflight de Infraestructura y Aislamiento Físico (Fase 3A.3)

**Servidor Objetivo:** `179.66.139.67` (`srv2145352`)  
**Fecha de Ejecución:** 10 de Noviembre de 2026 01:23:10 UTC  
**Comando Ejecutado:** `ALLOW_INTEGRATION_TESTS=true npm run test:infrastructure-preflight`  
**Entorno de Ejecución:** Contenedor efímero `node:20-bookworm-slim` en red `salon_infra_net` con montaje `-v /opt/salonpro/app/backend:/app:ro`  
**Resultado:** **EXIT CODE 0 — 100% PASS**

---

## 1. Verificación de Seguridad y Guardas de Entorno

- **`ALLOW_INTEGRATION_TESTS` en archivos de configuración:** 🛑 **NO DETECTADO (PASS)**.  
  Se verificó estrictamente que `.env.test` no contuviese esta variable para prevenir auto-autorizaciones no supervisadas.
- **`ALLOW_DISPOSABLE_SCHEMA`:** `false` (Aislamiento físico exigido).
- **Nombre de Producción Canónico:** `PRODUCTION_DB_NAME=salon_saas_prod`.
- **Nombre de Base de Pruebas:** `TEST_DB_NAME=salon_saas_test`.
- **Diferenciación de Bases:** `salon_saas_test !== salon_saas_prod` ✅ **PASS**.
- **Regla de Nomenclatura Segura:** `salon_saas_test` cumple con el sufijo obligatorio `_test` ✅ **PASS**.

---

## 2. Salida de Ejecución del Preflight (`infrastructure_preflight.cjs`)

```text
========================================================================
🛡️ PREFLIGHT REAL DE INFRAESTRUCTURA Y AISLAMIENTO FÍSICO (FASE 1)
========================================================================

[CONEXIÓN] Conectado exitosamente a host "salonpro_db:5432".
[IDENTIDAD] Base de datos activa: "salon_saas_test" | Usuario activo: "salon_saas_test_user"
  ✅ [PASS] current_database() coincide exactamente con TEST_DB_NAME.
  ✅ [PASS] current_user coincide con TEST_DB_USER.
  ✅ [PASS] Base de datos conectada es distinta de PRODUCTION_DB_NAME ("salon_saas_prod").
[PRIVILEGIOS DE ROL] Superuser: false | CreateDB: false | CreateRole: false | BypassRLS: false
  ✅ [PASS] El rol de pruebas NO es superusuario (rolsuper = false).
  ✅ [PASS] El rol de pruebas NO tiene permiso CREATEDB (rolcreatedb = false).
  ✅ [PASS] El rol de pruebas NO tiene permiso CREATEROLE (rolcreaterole = false).
  ✅ [PASS] El rol de pruebas NO tiene permiso BYPASSRLS (rolbypassrls = false).
[PRIVILEGIO PRODUCCIÓN] has_database_privilege('salon_saas_test_user', 'salon_saas_prod', 'CONNECT') = false
  ✅ [PASS] Base de producción "salon_saas_prod" presente en el clúster: Acceso DENEGADO a "salon_saas_test_user".
  ✅ [PASS] has_database_privilege('salon_saas_test_user', 'salon_saas_test', 'CREATE') = true.
  ✅ [PASS] Creación y eliminación de esquema sintético de prueba ("_preflight_schema_1794273794682") verificada.
  ✅ [PASS] El rol de pruebas puede crear y eliminar objetos temporales en la base de prueba.
  ✅ [PASS] Esquema public inicialmente limpio.
  ✅ [PASS] El esquema public de la base de prueba está listo para el ciclo de calidad.

========================================================================
🎉 PREFLIGHT EXITOSO: Infraestructura de prueba física y aislada verificada.
========================================================================
```

---

## 3. Certificación de Infraestructura y Red

1. **Puerto 5432 no expuesto:**  
   La directiva `ports:` se omitió en `docker-compose.infra.yml`.  
   Sonda externa desde Internet: `Port 5432 -> CLOSED/FILTERED`.
2. **Aislamiento de Red:**  
   El contenedor `salonpro_db` opera exclusivamente sobre el bridge interno `salon_infra_net`.
3. **Persistencia Garantizada:**  
   Volumen persistente Docker `salonpro_pg_data` montado en `/var/lib/postgresql/data`.
4. **Consumo de Recursos en Reposo:**  
   - Memoria RAM total en uso: `684 MiB` de `3.8 GiB` (**18% de uso / 3.2 GiB disponibles**).  
   - Límite asignado al contenedor de PostgreSQL: `1280M` RAM / `0.80 vCPU`.
5. **Estado de Aplicación y Migraciones:**  
   - Ninguna aplicación Node.js, Caddy ni worker desplegado en ejecución.  
   - **0 migraciones aplicadas** (Bases de datos en estado limpio).

