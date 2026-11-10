# Inventario de Solo Lectura de la VPS (Fase 3A.0)

**Host:** `179.66.139.67` (`srv2145352`)  
**Fecha de Inspección:** 10 de Noviembre de 2026 00:48:34 UTC  
**Metodología:** Inspección no intrusiva de solo lectura mediante SSH  
**Estado:** `VPS NUEVA DISPONIBLE / 100% LIMPIA / LISTA PARA PROVISIONAMIENTO`

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
| **vCPU** | 1 núcleo (AMD EPYC 9354P) | ~0.2% | ~99.8% | Procesador moderno de alto rendimiento |
| **RAM** | 3.8 GiB | 463 MiB | 3.4 GiB | Memoria suficiente para Staging y Docker Compose |
| **Swap** | **0 B** | 0 B | 0 B | **DIFERIDO POR EL OPERADOR / NO BLOQUEA STAGING / REEVALUAR ANTES DE PRODUCCIÓN** (Riesgo residual: La VPS no dispone de swap; un pico de memoria puede activar el OOM Killer. Se mitiga en Fase 3B con límites de memoria en Docker y build local) |
| **Almacenamiento (`/`)** | 48.9 GiB (`/dev/sda1`) | 1.5 GiB | 46.0 GiB (4%) | Espacio abundante para imágenes Docker y volúmenes |
| **Partición `/boot`** | 989 MiB (`/dev/sda13`) | 81 MiB | 841 MiB (9%) | Normal |
| **Partición EFI** | 105 MiB (`/dev/sda15`) | 6.3 MiB | 99 MiB (7%) | Normal |

---

## 3. Zona Horaria y Sincronización de Tiempo

| Parámetro | Estado |
| :--- | :--- |
| **Zona Horaria Local** | `Etc/UTC (UTC, +0000)` |
| **Hora del Sistema** | Sincronizada (`System clock synchronized: yes`) |
| **Servicio NTP** | `chronyd` activo y en ejecución |
| **Cumplimiento** | ✅ UTC obligatorio para consistencia de auditoría, facturación SaaS y DGII |

---

## 4. Identidad, Acceso y Privilegios Actuales

| Parámetro | Estado |
| :--- | :--- |
| **Usuario Conectado** | `root` (UID=0, GID=0) |
| **Directorio `/root`** | Solo archivos base del sistema (`.bashrc`, `.profile`, `.ssh`) |
| **Usuarios en `/home`** | Directorio vacío (no existen usuarios nominales aún) |
| **Acceso SSH** | Puerto 22 escuchando globalmente (`0.0.0.0:22`, `[::]:22`) |

---

## 5. Red, DNS y Puertos en Escucha

### 5.1 Direcciones IP
- **IPv4 Pública:** `179.66.139.67/24` (interfaz `eth0`)
- **IPv6:** `2a02:4780:95:ade6::1/48`
- **Loopback:** `127.0.0.1/8`, `::1/128` (`lo`)

### 5.2 Puertos Escuchando (`ss -tulpn`)
| Protocolo | Dirección Local | Proceso | Exposición Externa |
| :--- | :--- | :--- | :---: |
| **TCP** | `0.0.0.0:22` / `[::]:22` | `sshd` (OpenSSH 9.5) | **SÍ (Pública)** |
| **TCP** | `127.0.0.53:53` / `127.0.0.54:53` | `systemd-resolved` | NO (Solo Loopback) |
| **TCP** | `127.0.0.1:65529` | `monarx-agent` | NO (Solo Loopback) |
| **UDP** | `127.0.0.1:323` / `[::1]:323` | `chronyd` | NO (Solo Loopback) |
| **UDP** | `127.0.0.1:1721` | `monarx-agent` | NO (Solo Loopback) |
| **UDP** | `127.0.0.53:53` / `127.0.0.54:53` | `systemd-resolved` | NO (Solo Loopback) |

> [!NOTE]
> No hay servidores web (Apache/Nginx/Caddy), bases de datos (PostgreSQL/MySQL/Redis) ni puertos no autorizados expuestos a Internet.

### 5.3 Resolución DNS y Conectividad
- **Servidores DNS Activos:** `153.92.2.6`, `1.1.1.1`, `8.8.4.4` (administrados por `systemd-resolved`).
- **Latencia de Salida:** 5.5 ms hacia `8.8.8.8` y `google.com` (conectividad limpia y sin pérdidas de paquetes).

---

## 6. Estado del Firewall y Seguridad de Red

| Componente | Estado Actual | Observaciones |
| :--- | :--- | :--- |
| **UFW (Uncomplicated Firewall)** | `inactive` | **Requerido:** Activar permitiendo solo SSH (22), HTTP (80) y HTTPS (443) |
| **iptables** | Reglas base con política `ACCEPT` | Sin bloqueos personalizados preexistentes |
| **Fail2ban / CrowdSec** | No instalado | **Requerido:** Configurar protección contra ataques de fuerza bruta SSH |
| **Agente de Seguridad Host** | `monarx-agent` en ejecución | Agente de escaneo del proveedor Hostinger |

---

## 7. Paquetes y Binarios Existentes

| Binario | ¿Instalado? | Versión |
| :--- | :---: | :--- |
| **git** | ✅ SÍ | `2.53.0` |
| **python3** | ✅ SÍ | `Python 3.12.x` |
| **docker** | ❌ NO | *not found* |
| **docker-compose** | ❌ NO | *not found* |
| **node** | ❌ NO | *not found* |
| **npm** | ❌ NO | *not found* |
| **psql / postgres** | ❌ NO | *not found* |
| **nginx** | ❌ NO | *not found* |
| **caddy** | ❌ NO | *not found* |

---

## 8. Estado de Actualizaciones del Sistema (`apt`)

- Existen **22 paquetes del sistema operativo** con actualizaciones menores pendientes (`apt`, `ca-certificates`, `bind9`, `linux-image-virtual`, `tmux`, `vim`, etc.).
- Ningún paquete retenido o roto.

---

## 9. Veredicto de Limpieza del Servidor

> **VEREDICTO:** ✅ **VPS 100% LIMPIA Y VERIFICADA.**  
> No existen contenedores Docker huérfanos, instancias de bases de datos preexistentes, carpetas web contaminadas ni archivos `.env` residuales. El entorno es apto para proceder con la arquitectura de Staging de Fase 3A.

