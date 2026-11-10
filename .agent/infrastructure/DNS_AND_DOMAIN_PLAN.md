# Plan de Dominio, DNS y Estrategia de Certificados TLS (Fase 3B)

**Dominio Raíz:** `etereasapp.com`  
**IP Pública VPS (Staging):** `179.66.139.67`  
**Proveedor DNS:** Gestionado externamente por el operador  
**Fecha de Planificación:** 10 de Noviembre de 2026  
**Estado:** `STAGING PLANIFICADO / PRODUCCIÓN RESERVADA / SIN PROXY CDN ACTIVO`

---

## 1. Topología de Subdominios y Ambientes

```
                             DNS EXTERNO
                                  │
          ┌───────────────────────┴───────────────────────┐
          │                                               │
          ▼                                               ▼
  staging.etereasapp.com                         etereasapp.com / www
  (Tipo A -> 179.66.139.67)                      (RESERVADO - CERO TRÁFICO)
  [Ambiente de Staging & QA]                     [Producción Futura Comercial]
```

| Hostname / FQDN | Registro DNS | Destino / Valor | TTL | Estado Actual | Rol en la Plataforma |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **`staging.etereasapp.com`** | **A** | **`179.66.139.67`** | **300s (5m)** | ⏳ **Acción requerida del operador** | Portal de Staging, QA de Tenancy y Certificación |
| `etereasapp.com` | A | `179.66.139.67` | - | ✅ Registrado (Reservado) | Dominio comercial apex (Sin app activa aún) |
| `www.etereasapp.com` | A | `179.66.139.67` | - | ✅ Registrado (Reservado) | Alias canónico de producción |

---

## 2. Instrucciones para el Operador en el Panel DNS

En el panel de gestión de DNS del dominio `etereasapp.com` (Hostinger DNS / Cloudflare / Registrador):

1. **Crear registro tipo `A`:**
   - **Tipo:** `A`
   - **Nombre / Subdominio:** `staging`
   - **Dirección IPv4:** `179.66.139.67`
   - **TTL:** `300` segundos (5 minutos) para rápida propagación.
   - **Proxy de CDN:** Desactivado (DNS Only / Directo), para asegurar emisión de certificados Let's Encrypt sin interferencias de edge.
2. **Registro `AAAA` (IPv6):**
   - 🛑 **NO CREAR REGISTRO AAAA** en esta fase (el VPS tiene IPv6 deshabilitado en firewall para minimizar vector de ataque).
3. **Comprobación de resolución:**
   - Una vez guardado el registro, el sistema verificará periódicamente mediante `socket.gethostbyname('staging.etereasapp.com')`.

---

## 3. Estrategia de Emisión TLS / HTTPS (Caddy)

Cuando se autorice el despliegue del reverse proxy en la Fase 3B.1:
- Caddy se vinculará exclusivamente al subdominio `staging.etereasapp.com`.
- Desafío ACME HTTP-01 automático a través de los puertos públicos `80` y `443` (ya autorizados en UFW).
- Cabeceras de seguridad estrictas:
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
- Aislamiento: Caddy no tendrá acceso directo a la red `salon_infra_net` de PostgreSQL; se comunicará únicamente con la red edge del contenedor `salonpro_app`.
