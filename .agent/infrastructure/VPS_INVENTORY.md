# Inventario de Solo Lectura de la VPS (Fase 3B.0.2)

**Host:** `179.66.139.67` (`srv2145352`)  
**Fecha de Inspección:** 10 de Noviembre de 2026 (Reconciliado Fase 3B.0.2)  
**Metodología:** Inspección no intrusiva de solo lectura mediante SSH y Docker CLI  
**Estado:** `SSH HARDENED / POSTGRES PRIVADO 17.11 / TEST MIGRADO (95 TABLAS / 15 MIGRACIONES) / STAGING Y PROD LIMPIAS (0 TABLAS) / SWAP DIFERIDO`

---

## 1. Sistema Operativo y Núcleo

| Parámetro | Valor Detectado |
| :--- | :--- |
| **Distribución** | Ubuntu 26.04.1 LTS (Resolute Raccoon) |
| **ID / Codename** | `ubuntu` / `resolute` |
| **Versión del Kernel** | `Linux 7.0.0-38-generic #38-Ubuntu SMP PREEMPT_DYNAMIC` |
| **Arquitectura** | `x86_64` (64-bit) |
| **Hostname Estático** | `srv2145352` |
| **Virtualización** | KVM (Hardware Vendor: QEMU pc-i440fx) |

---

## 2. Recursos de Hardware

| Recurso | Capacidad Total | En Uso | Disponible | Observaciones |
| :--- | :--- | :--- | :--- | :--- |
| **vCPU** | 1 núcleo (AMD EPYC 9354P) | ~0.5% | ~99.5% | Procesador moderno de alto rendimiento |
| **RAM** | 3.8 GiB (3910 MB) | ~744 MB (19.0%) | ~3165 MB | Memoria controlada y verificada < 75% |
| **Swap** | **0 B** | 0 B | 0 B | **DIFERIDO POR EL OPERADOR / NO BLOQUEA STAGING / REEVALUAR ANTES DE PRODUCCIÓN** |
| **Almacenamiento (`/`)** | 48.9 GiB (`/dev/sda1`) | ~5.8 GiB | ~41.7 GiB (12%) | Espacio abundante |

---

## 3. Zona Horaria y Sincronización de Tiempo

| Parámetro | Estado |
| :--- | :--- |
| **Zona Horaria Local** | `Etc/UTC (UTC, +0000)` |
| **Hora del Sistema** | Sincronizada (`System clock synchronized: yes`) |
| **Servicio NTP** | `chronyd` activo y en ejecución |
| **Cumplimiento** | ✅ UTC obligatorio para consistencia de auditoría, facturación SaaS y DGII |

---

## 4. Identidad, Acceso y Privilegios

| Parámetro | Estado |
| :--- | :--- |
| **Usuario de Operación** | `deployer` (con `sudo`, miembro de `docker`) |
| **Login SSH root directo** | ❌ DESHABILITADO (`PermitRootLogin no`) |
| **Autenticación por Contraseña** | ❌ DESHABILITADA (`PasswordAuthentication no`, `KbdInteractiveAuthentication no`) |
| **Acceso SSH** | Clave pública Ed25519 en puerto 22 |

---

## 5. Red, Docker Engine y Bases de Datos

### 5.1 Docker y Compose
- **Docker Engine:** Community `29.9.3` (API version `1.56`, containerd `v2.4.2`, runc `1.5.2`)
- **Docker Compose:** `v5.7.0`
- **Docker Data Root:** `/opt/salonpro/docker-data` (aislado)

### 5.2 Contenedor PostgreSQL
- **Imagen:** `postgres:17.11-bookworm` (digest verificado)
- **Contenedor:** `salonpro_db` (healthcheck activo, healthy)
- **Red:** `salon_infra_net` (`driver: bridge`, `internal: true`)
- **Puertos al Host:** **NINGUNO (CERO PUERTOS EXPUESTOS AL HOST O INTERNET)**

### 5.3 Estado Canónico de Bases de Datos
| Base de Datos | Tablas | Migraciones | Estado |
| :--- | :---: | :---: | :--- |
| `salon_saas_test` | **95** | **15** | Migrada y validada al 100% |
| `salon_saas_staging` | **0** | **0** | **INTACTA / VACÍA** |
| `salon_saas_prod` | **0** | **0** | **INTACTA / VACÍA** |

### 5.4 Desglose Canónico del Esquema (95 Tablas)
- **Tablas Globales / Sistema (12):** `account_lockouts`, `billing_codes`, `blocked_ips`, `contact_messages`, `job_request_nonces`, `login_attempts`, `pending_tenant_reconciliations`, `saas_features`, `saas_plan_features`, `saas_plans`, `schema_migrations`, `tenants`.
- **Tablas Tenant-Owned (83):** 100% auditadas con `tenant_id UUID NOT NULL` y FK hacia `tenants(id) ON DELETE CASCADE`.
- **Secuencias Canónicas (44):** 43 históricas + `job_request_nonces_id_seq`.
- **Triggers de Cuarentena (4):** Activos e inmutables contra registros en cuarentena.

---

## 6. Estado de Servicios Web y Aplicación

- **Caddy:** No instalado / no en ejecución.
- **Node.js / App:** Sin proceso activo de backend ni frontend en ejecución.
- **CardNet / DGII:** En pausa / mock mode estricto.
- **DNS:** `staging.etereasapp.com` configurado hacia la IP de la VPS con TTL 300.
