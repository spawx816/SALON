# Plan de Dominio, DNS y Estrategia de Certificados TLS (Fase 3B.2A)

**Dominio Raíz:** `etereasapp.com`  
**IP Pública VPS (Staging):** `179.66.139.67`  
**Proveedor DNS:** Gestionado externamente por el operador  
**Fecha de Actualización:** 10 de Noviembre de 2026  
**Estado:** `TODOS LOS REGISTROS A CONFIGURADOS / STAGING ACTIVO / APP, APEX Y WWW SIN APLICACIÓN / CERO CAMBIOS DNS PENDIENTES`

---

## 1. Topología de Subdominios y Ambientes

```
                             DNS EXTERNO
                                  │
          ┌───────────────────────┴───────────────────────┐
          │                                               │
          ▼                                               ▼
  staging.etereasapp.com                         app / etereasapp.com / www
  (Tipo A -> 179.66.139.67)                      (Tipo A / CNAME -> 179.66.139.67)
  [Ambiente Staging Activo y Operativo]          [Sin aplicación / Handshake Rechazado]
```

| Hostname / FQDN | Registro DNS | Destino / Valor | TTL | Estado Actual | Rol en la Plataforma |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **`staging.etereasapp.com`** | **A** | **`179.66.139.67`** | **14400s** | ✅ **Configurado y Activo** | Entorno Staging Privado con TLS y Basic Auth |
| `app.etereasapp.com` | A | `179.66.139.67` | 14400s | 🛡️ **Configurado (Sin app)** | Futura aplicación de producción (Caddy no lo sirve) |
| `etereasapp.com` | A | `179.66.139.67` | 14400s | 🛡️ **Configurado (Sin app)** | Dominio comercial apex (Caddy no lo sirve) |
| `www.etereasapp.com` | CNAME | `etereasapp.com` | 300s | 🛡️ **Configurado (Sin app)** | Alias canónico de producción (Caddy no lo sirve) |

> **Nota:** Todos los registros DNS tipo A requeridos están configurados y propagados. No hay acciones pendientes del operador en el panel DNS.

---

## 2. Estado de Seguridad DNS & Firewall

1. **Registros A:** Todos apuntan a `179.66.139.67`.
2. **Registros AAAA (IPv6):** Sin registros IPv6 (IPv6 deshabilitado a nivel host/firewall para reducir superficie de ataque).
3. **Aislamiento a nivel Edge:**
   - Caddy atiende exclusivamente `staging.etereasapp.com`.
   - Cualquier petición hacia `app.etereasapp.com`, `etereasapp.com` o `www.etereasapp.com` tiene el handshake TLS cerrado de inmediato sin exponer ningún backend ni responder en nombre de Staging.

---

## 3. Estrategia de Emisión TLS / HTTPS (Caddy)

- Emisor: **Let's Encrypt Authority** (vía ACME ALPN-01).
- Renovación automática gestionada en volumen Docker persistente `caddy_data`.
- Cabeceras de seguridad estrictas centralizadas en Caddy:
  - `Strict-Transport-Security: max-age=31536000` (sin `includeSubDomains` ni `preload` en staging; sin duplicados).
  - `X-Robots-Tag: noindex, nofollow, noarchive`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
- Aislamiento de Red: Caddy reside en `salon_edge_net` y no tiene conectividad hacia `salon_infra_net`.
