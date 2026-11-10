# Plan de Implementación de Infraestructura — Fase 3A

**Sistema:** SalonPro SaaS  
**Servidor Objetivo:** `179.66.139.67` (`srv2145352`)  
**Estado:** `PROVISIONAMIENTO EN STAGING / DESPLIEGUE DESDE CERO / DGII Y CARDNET EN PAUSA`  
**Estrategia:** Guiada por bloques pequeños, verificación previa en dos sesiones SSH y cero publicación de PostgreSQL en Internet.

---

## 1. Diagrama de Arquitectura de Red y Contenedores

```text
                               INTERNET (Público)
                                       │
                      [Puertos 80, 443 TCP Públicos]
                                       ▼
                  ┌────────────────────────────────────────┐
                  │          UFW FIREWALL DEL HOST         │
                  │   (Permite solo: SSH:22, HTTP:80,      │
                  │    HTTPS:443; Deniega todo lo demás)   │
                  └────────────────────┬───────────────────┘
                                       │
                                       ▼
                  ┌────────────────────────────────────────┐
                  │       REVERSE PROXY (CADDY / TLS)      │
                  │  - Terminación HTTPS automática        │
                  │  - Cabeceras de Seguridad (HSTS, etc.) │
                  │  - Reverse Proxy hacia red interna     │
                  └────────────────────┬───────────────────┘
                                       │
                    RED PRIVADA INTERNA DOCKER (salon_net)
         (Sin acceso directo desde Internet, 100% aislada)
                   │                                   │
                   ▼                                   ▼
    ┌─────────────────────────────┐     ┌─────────────────────────────┐
    │     APP: SALONPRO STAGING   │     │      WORKER SEPARADO        │
    │  - Node.js Express API      │     │  - BillingSchedulerWorker   │
    │  - Frontend Vite compilado  │     │  - Inactivo en Fase Inicial │
    │  - Zero PAN / CVC en memoria│     │  - Ejecución controlada     │
    └──────────────┬──────────────┘     └──────────────┬──────────────┘
                   │                                   │
                   └─────────────────┬─────────────────┘
                                     │
                                     ▼
                  ┌────────────────────────────────────────┐
                  │           POSTGRESQL 17 PRIVADO        │
                  │     (Puerto 5432 NO expuesto a host    │
                  │      ni a Internet; solo en salon_net) │
                  ├────────────────────────────────────────┤
                  │  Bases de datos aisladas:              │
                  │  - salon_saas_test                     │
                  │  - salon_saas_staging                  │
                  │  - salon_saas_prod (Inactiva/Vacía)    │
                  ├────────────────────────────────────────┤
                  │  Roles con Privilegios Mínimos:        │
                  │  - salon_saas_test_user                │
                  │  - salon_saas_staging_user             │
                  │  - salon_saas_prod_user                │
                  └────────────────────┬───────────────────┘
                                       │
                                       ▼
                  ┌────────────────────────────────────────┐
                  │         VOLÚMENES Y BACKUPS            │
                  │  - pg_data (persistencia segura)       │
                  │  - Script de backup periódico          │
                  │  - Prueba de restauración desechable   │
                  └────────────────────────────────────────┘
```

---

## 2. Fases de Ejecución Guiadas (Bloques de Trabajo)

### Bloque 1: Hardening del Host (Fase 3A.1) — ✅ COMPLETADO
1. **Swap:** `DIFERIDO POR EL OPERADOR / NO BLOQUEA STAGING / REEVALUAR ANTES DE PRODUCCIÓN`.
   - *Riesgo residual registrado:* `La VPS no dispone de swap; un pico de memoria puede activar el OOM Killer.`
   - *Mitigaciones:* Límites de memoria por contenedor en compose (`mem_limit`), rotación estricta de logs, healthchecks periódicos, alertas al superar 75%, 85% y 95% de RAM.
2. **Usuario Administrativo Nominal:** `deployer` con privilegios `sudo` y llave ED25519 verificado.
3. **Firewall UFW:** `active` con política `default deny incoming`, puertos `22`, `80`, `443` permitidos. Puerto `5432` cerrado.
4. **Fail2ban:** Operativo con jail `sshd` activa (`systemd` backend).
5. **Actualizaciones de Seguridad:** `unattended-upgrades` activo sin reinicio automático imprevisto (`Automatic-Reboot "false"`).

### Bloque 2: Instalación de Docker y Herramientas (Fase 3A.2) — ✅ COMPLETADO
1. **Docker Engine:** `29.9.3` y **Compose V2:** `v5.7.0` instalados desde el repositorio oficial para Ubuntu 26.04 (`resolute`).
2. **Seguridad de Grupo:** `deployer` fuera del grupo `docker`.
3. **Daemon Seguro:** Rotación de logs configurada (10m / 3 archivos), `live-restore: true`, `no-new-privileges: true`, sin API TCP.
4. **Directorios de Despliegue:** Creada estructura `/opt/salonpro/{app,compose,secrets,backups,logs,releases}` con permisos estrictos.

### Bloque 3: Gestión Segura de Secretos Fuera de Git (Fase 3A.3) — ✅ COMPLETADO
1. Secretos generados con 256 bits de entropía en `/opt/salonpro/secrets/` con permisos `0600 root:root` y directorio `0700 root:root`.
2. Cero secretos en repositorios o historial.

### Bloque 4: Despliegue de PostgreSQL 17 y Bootstrap Idempotente (Fase 3A.3) — ✅ COMPLETADO
1. Contenedor `salonpro_db` con imagen fijada `postgres:17.4-bookworm@sha256:304ab813518754228f9f792f79d6da36359b82d8ecf418096c636725f8c930ad`.
2. Red aislada `salon_infra_net`, volumen persistente `salonpro_pg_data`, cero puertos publicados al host (`ports` omitido).
3. Bases creadas: `salon_saas_prod`, `salon_saas_staging`, `salon_saas_test`.
4. Matriz de roles certificada en `.agent/infrastructure/POSTGRES_ROLE_CERTIFICATION.md`.

### Bloque 5: Preflight de Infraestructura Física (Fase 3A.3) — ✅ COMPLETADO
1. Ejecución mediante contenedor efímero `node:20-bookworm-slim` montando backend de solo lectura.
2. Comando ejecutado: `ALLOW_INTEGRATION_TESTS=true npm run test:infrastructure-preflight` con **Exit Code 0** (Aislamiento físico 100% certificado en `.agent/infrastructure/PHASE3A3_PREFLIGHT_REPORT.md`).

### Bloque 6: Migraciones de Esquema en Test y Staging (Fase 3B — Pendiente)
   - `JWT_SECRET_STAGING`
   - `INTERNAL_HMAC_SECRET_STAGING`
3. Archivos `.env.staging` y `.env.test` con permisos `chmod 600`.
4. **Regla de Oro:** Ningún secreto se sube a Git ni se incluye en el repositorio.

### Bloque 4: Base de Datos PostgreSQL Aislada (Fase 3A.3)
1. Definición de `docker-compose.yml` con servicio `db` en red `salon_net`:
   - Sin mapeo `ports: - "5432:5432"` hacia el host; el puerto 5432 solo es accesible internamente entre contenedores.
2. Script de inicialización de roles y bases:
   ```sql
   -- Base de Test
   CREATE DATABASE salon_saas_test;
   CREATE USER salon_saas_test_user WITH PASSWORD '...';
   ALTER USER salon_saas_test_user WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
   GRANT ALL PRIVILEGES ON DATABASE salon_saas_test TO salon_saas_test_user;

   -- Base de Staging
   CREATE DATABASE salon_saas_staging;
   CREATE USER salon_saas_staging_user WITH PASSWORD '...';
   ALTER USER salon_saas_staging_user WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
   GRANT ALL PRIVILEGES ON DATABASE salon_saas_staging TO salon_saas_staging_user;

   -- Base de Producción (Aislada e Inactiva)
   CREATE DATABASE salon_saas_prod;
   CREATE USER salon_saas_prod_user WITH PASSWORD '...';
   ALTER USER salon_saas_prod_user WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
   GRANT ALL PRIVILEGES ON DATABASE salon_saas_prod TO salon_saas_prod_user;
   ```
3. Revocación de privilegios `PUBLIC` para garantizar aislamiento cruzado.

### Bloque 5: Gate de Infraestructura Preflight (Fase 3A.4)
Ejecución del runner de verificación de seguridad:
```bash
ALLOW_INTEGRATION_TESTS=true npm run test:infrastructure-preflight
```
**Criterio de Aprobación:**
- Base conectada = `salon_saas_test`.
- Usuario conectado = `salon_saas_test_user`.
- Cero privilegios de superusuario ni bypass RLS.
- Acceso DENEGADO a `salon_saas_prod`.
- Creación y eliminación de esquemas temporales aprobada.

### Bloque 6: Migraciones de Esquema en Base de Pruebas (Fase 3A.6)
1. Aplicación secuencial de todas las migraciones preparadas en `salon_saas_test`:
   - `20261109_security_and_roles.sql`
   - `20261109_financial_minor_currency_units.cjs`
   - `20261110_create_tenant_branding.sql`
   - Migraciones base de inventario, entitlements y facturación SaaS.
2. Auditoría automatizada de claves foráneas: todas las FK `tenant_id` deben apuntar estrictamente a `tenants(id)`.
3. Verificación de índices B-tree y constraints.

### Bloque 7: Ejecución de Suites de Pruebas Reales (Fase 3A.7)
Ejecución contra `salon_saas_test`:
- `npm run test:phase1:all`
- `npm run test:phase2h:all`
- `npm run test:scanner`
- `npm run lint`
- `npm run build`

### Bloque 8: Despliegue de la Aplicación en Staging (Fase 3A.5)
1. Configuración de `docker-compose.staging.yml`:
   - Servicio `app`: Node.js Express con `NODE_ENV=staging`.
   - Servicio `proxy`: Caddy con configuración de dominio de staging y certificados Let's Encrypt / TLS.
   - Headers HTTP de seguridad (`Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`).
   - Cookies `Secure; HttpOnly; SameSite=Lax`.
2. Worker de facturación definido pero detenido/desactivado hasta validación de la API.
3. Modo simulado para CardNet (`FakePaymentGateway`) y DGII (`DGII_MODE=sandbox_internal`).

### Bloque 9: Backups y Observabilidad (Fase 3A.8 & 3A.9)
1. Script `backup_postgres.sh` con rotación a 7 días y compresión cifrada.
2. Prueba obligatoria de restauración en base temporal desechable (`salon_saas_restore_test`).
3. Healthcheck endpoint `/api/health` verificado a través del proxy inverso.

---

## 3. Matriz de Parada y Control de Riesgos

| Punto de Control | Condición Obligatoria | Acción ante Fallo |
| :--- | :--- | :--- |
| **Acceso SSH** | Segunda sesión SSH con usuario nominal y llave verificada | **DETENERSE INMEDIATAMENTE.** Prohibido cerrar la sesión actual de root. |
| **Puerto 5432** | `nmap` o `ss` confirma que 5432 NO está abierto en la IP pública | **DETENERSE.** Ajustar Docker Compose para no publicar puertos de base de datos. |
| **Preflight DB** | 100% de chequeos de preflight aprobados | **DETENERSE.** No ejecutar migraciones hasta corregir permisos de rol. |
| **Pruebas Unit/HTTP** | Cero fallos en `test:phase2h:all` y `test:scanner` | **DETENERSE.** No desplegar contenedor de aplicación. |
| **Restauración Backup** | Backup restaurado y validado en base desechable | **DETENERSE.** Un backup no comprobado no es válido para Staging. |

