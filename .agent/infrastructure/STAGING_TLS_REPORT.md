# REPORTE DE CONFIGURACIÓN Y VERIFICACIÓN TLS / EDGE — FASE 3B.1

**Fecha:** 10 de Noviembre de 2026  
**Dominio:** `staging.etereasapp.com`  
**Proveedor TLS:** Let's Encrypt (ACME v2 vía Caddy 2.9.1)  
**Estado:** ✅ **Aprobado / Emisión Exitosa**

---

## 1. Verificación de Emisión Automática ACME

Caddy gestionó la orden ACME mediante el desafío `tls-alpn-01` en el puerto 443:

```text
{"level":"info","logger":"tls.issuance.acme","msg":"new ACME account registered","contact":["mailto:admin@etereasapp.com"],"status":"valid"}
{"level":"info","msg":"trying to solve challenge","identifier":"staging.etereasapp.com","challenge_type":"tls-alpn-01"}
{"level":"info","logger":"tls","msg":"served key authentication certificate","server_name":"staging.etereasapp.com"}
{"level":"info","msg":"authorization finalized","identifier":"staging.etereasapp.com","authz_status":"valid"}
{"level":"info","msg":"validations succeeded; finalizing order"}
{"level":"info","msg":"successfully downloaded available certificate chains"}
{"level":"info","logger":"tls.obtain","msg":"certificate obtained successfully","identifier":"staging.etereasapp.com"}
```

- **Emisor:** Let's Encrypt Authority (`acme-v02.api.letsencrypt.org`)
- **Protocolo Negociado:** TLSv1.3 con soporte HTTP/2 y HTTP/3 (`Alt-Svc: h3=":443"; ma=2592000`).
- **Almacenamiento de Certificados:** Volumen Docker persistente `caddy_data` montado en `/data` dentro del contenedor.

---

## 2. Comportamiento de Redirección HTTP -> HTTPS

Petición no cifrada hacia `http://staging.etereasapp.com`:
```http
HTTP/1.1 308 Permanent Redirect
Connection: close
Location: https://staging.etereasapp.com/
Server: Caddy
```
- **Resultado:** Redirección automática 308 forzada sin exponer tráfico sensible en texto plano.

---

## 3. Barrera Perimetral Edge (HTTP Basic Auth)

Petición HTTPS sin credenciales:
```http
HTTP/1.1 401 Unauthorized
Alt-Svc: h3=":443"; ma=2592000
Server: Caddy
Www-Authenticate: Basic realm="restricted"
```
- **Resultado:** Rechazo perimetral inmediato a nivel Caddy antes de tocar Node.js.

Petición HTTPS con credenciales válidas (`staging_operator`):
```http
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
Strict-Transport-Security: max-age=31536000
X-Robots-Tag: noindex, nofollow, noarchive
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

---

## 4. Aislamiento de Dominios No Servidos

Se comprobó que las peticiones hacia dominios no configurados en Caddy son rechazadas de inmediato:
- `https://etereasapp.com` -> Handshake TLS cerrado/rechazado (cero certificados o rutas hacia staging).
- `https://app.etereasapp.com` -> Handshake TLS cerrado/rechazado.
- `https://www.etereasapp.com` -> Handshake TLS cerrado/rechazado.

Ningún dominio público enruta hacia el entorno de Staging.

