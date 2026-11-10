# INFORME DE DESPLIEGUE PROTEGIDO DE STAGING — FASE 3B.1

**Fecha de Ejecución:** 10 de Noviembre de 2026  
**Estado Final Certificado:** `STAGING PRIVADO DESPLOEGADO / TLS VÁLIDO / 95 TABLAS Y 15 MIGRACIONES / E2E APROBADO / BACKUP RESTAURABLE / PROD VACÍA / WORKER, CARDNET Y DGII DESACTIVADOS`

---

## 1. Resumen Ejecutivo de la Fase

Se ha completado de forma integral y sin incidentes el despliegue del entorno privado de Staging para **SalonPro SaaS** en la infraestructura de producción/VPS (`179.66.139.67`), cumpliendo con todos los quality gates perimetrales, criptográficos, arquitectónicos y de datos.

### Métricas Clave de Staging
- **Dominio Publicado:** `https://staging.etereasapp.com` (Exclusivo, cerrado con HTTP Basic Auth a nivel Edge).
- **Dominios No Servidos (Sin Virtual Host / Handshake rechazado):** `etereasapp.com`, `app.etereasapp.com`, `www.etereasapp.com`.
- **Contenedores Activos:**
  - `salonpro_caddy` (`caddy:2.9.1`): Reverse proxy y terminación TLS automática via Let's Encrypt (`Up (healthy)`).
  - `salonpro_app` (`salonpro-app:8fbe4ae`): Runtime Node 22 slim no-root (`Up (healthy)`).
  - `salonpro_db` (`postgres:17.11-bookworm`): Base de datos privada en `salon_infra_net` (`Up (healthy)`).
- **Consumo de Memoria Total Host:** 956 MiB / 3.8 GiB (**24.6%**, límite estricto < 75%).
- **Almacenamiento en Disco:** 13 GB / 48 GB (**28%**, 35 GB libres).

---

## 2. Inventario de Componentes y Redes

```mermaid
graph TD
    Client["Cliente / Operador Staging"] -->|HTTPS :443| Caddy["salonpro_caddy (Edge Reverse Proxy)<br/>Basic Auth: staging_operator<br/>TLS Let's Encrypt ALPN"]
    Caddy -->|HTTP :5005 (Internal)| App["salonpro_app (Node 22 Non-Root)<br/>read_only: true, tmpfs /tmp<br/>salon_edge_net + salon_infra_net"]
    App -->|TCP :5432 (Internal Private)| DB[("salonpro_db (PostgreSQL 17.11)<br/>salon_infra_net (internal: true)<br/>NO HOST PORTS")]

    subgraph EdgeNetwork ["salon_edge_net (bridge)"]
        Caddy
        App
    end

    subgraph InfraNetwork ["salon_infra_net (internal: true)"]
        App
        DB
    end
```

### Aislamiento de Redes Docker
1. **`salon_edge_net`**: Red bridge que conecta exclusivamente a Caddy con la aplicación en el puerto `5005`.
2. **`salon_infra_net`**: Red bridge declarada con `internal: true`. Conecta exclusivamente la aplicación con PostgreSQL. PostgreSQL no tiene ningún puerto expuesto al host ni salida a Internet.

---

## 3. Estado de Bases de Datos y Migraciones

| Base de Datos | Usuario Activo | Conexión Host | Tablas | Migraciones | Estado |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `salon_saas_staging` | `salon_saas_staging_user` | Privada | **95** | **15 / 15** | Activa (Seed sintético verificado) |
| `salon_saas_test` | `salon_saas_test_user` | Privada | **95** | **15 / 15** | Aprobada en suite preflight |
| `salon_saas_prod` | `salon_saas_prod_user` | Privada | **0** | **0 / 15** | **Estrictamente vacía / Intacta** |

---

## 4. Estado de los Quality Gates Previos

Todos los comandos de verificación previa fueron ejecutados con **Exit Code 0**:
1. `npm run test:matrix` -> 95/95 tablas y 15 migraciones idempotentes (Exit 0).
2. `npm run test:phase2h:p1-security` -> 13/13 controles de hardening aprobados (Exit 0).
3. `npm run test:phase2h:all` -> 18/18 pruebas financieras, control plane y branding (Exit 0).
4. `npm run test:scanner` -> Cero referencias indebidas a secrets o hostnames (Exit 0).
5. `npm run lint` -> Cero errores ESLint (Exit 0).
6. `npm run build` -> Bundle Vite para producción generado limpiamente (Exit 0).

---

## 5. Certificación Final de Cumplimiento

Se certifica que:
- No se crearon ni modificaron registros DNS durante esta fase.
- La base de datos de producción (`salon_saas_prod`) permanece con cero tablas y cero registros.
- Los módulos de cobro con tarjeta real (`CardNet`) y facturación fiscal (`DGII`) están completamente desactivados o configurados en modo fail-closed sintético.
- El worker en segundo plano se encuentra inactivo (`WORKER_ENABLED=false`).

