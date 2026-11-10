# REPORTE DE SEGURIDAD Y HARDENING DE STAGING — FASE 3B.1

**Fecha:** 10 de Noviembre de 2026  
**Auditoría:** Staging Environment Hardening & Penetration Verification  
**Estado:** ✅ **Certificado / Sin Vulnerabilidades Críticas**

---

## 1. Defensa en Profundidad: HTTP Basic Auth vs Cookies de Sesión

Para prevenir colisiones entre el HTTP Basic Auth del Edge (Caddy) y los tokens JWT del backend:
1. **En Caddy (`Caddyfile`):**
   ```caddy
   reverse_proxy salonpro_app:5005 {
       header_up -Authorization
       header_up Host {host}
       header_up X-Real-IP {remote_host}
   }
   ```
   Caddy elimina la cabecera `Authorization` antes de enviar la solicitud a Node.js.
2. **En Node.js (`auth.middleware.js`):**
   ```javascript
   if (authHeader.toLowerCase().startsWith('basic ')) {
     // Edge HTTP Basic Auth - ignore and fall through to HttpOnly cookie
   }
   ```
   Si por alguna razón la cabecera `Authorization: Basic ...` alcanzara el backend, este la ignora y busca exclusivamente la cookie HttpOnly `auth_token`.

---

## 2. Hardening del Contenedor de Aplicación (`salonpro_app`)

- **Usuario de Ejecución:** `user: "1000:1000"` (`node`), sin permisos de root dentro del contenedor.
- **Sistema de Archivos de Solo Lectura:** `read_only: true`. Ningún atacante puede escribir archivos ejecutables o modificar el código fuente en tiempo de ejecución.
- **Partición Temporal Efímera:** `tmpfs: /tmp:rw,noexec,nosuid,size=64m`. Los scripts no pueden ejecutarse desde `/tmp`.
- **Capacidades de Linux:** `cap_drop: ALL`, `security_opt: no-new-privileges:true`. Eliminación total de privilegios de escalamiento kernel.
- **Límites de Memoria y CPU:** `mem_limit: 768m`.
- **Healthcheck Local:** Comprobación interna cada 15 segundos vía `http://127.0.0.1:5005/api/health`.

---

## 3. Aislamiento Criptográfico de Secretos

Los secretos en el host residen exclusivamente en `/opt/salonpro/secrets/` con permisos estrictos `0600 root:root`:
- `staging.env`: Variables de runtime de staging (Database Pass, JWT Secret, Session Secrets).
- `migrator_staging.env`: Variables exclusivas de migración DDL.
- `caddy.env`: Variables de autenticación perimetral y ACME email.
- `staging_credentials.txt`: Credenciales sintéticas generadas aleatoriamente (SuperAdmin, Tenant A, Tenant B).

### Claves y Permisos
- Las claves criptográficas de backup (`BACKUP_ENCRYPTION_KEY` y `BACKUP_HMAC_KEY`) son de 32 bytes independientes de `JWT_SECRET`.
- El usuario `salon_saas_staging_user` posee `can_create_public: f`, impidiendo operaciones DDL arbitrarias a nivel de base de datos desde la API.
- El usuario `salon_saas_staging_user` tiene denegado el acceso (`CONNECT`) a `salon_saas_prod` (Error PostgreSQL 42501).

---

## 4. Prevención de Indexación en Motores de Búsqueda

1. **Cabecera HTTP:** `X-Robots-Tag: noindex, nofollow, noarchive` inyectada por Caddy y Express en todas las respuestas.
2. **Endpoint `robots.txt`:** Caddy responde estáticamente:
   ```text
   User-agent: *
   Disallow: /
   ```
3. **HTML Meta Tags:** Express inyecta `<meta id="robots-meta" name="robots" content="noindex, nofollow" />` en todas las rutas SPA de React.

