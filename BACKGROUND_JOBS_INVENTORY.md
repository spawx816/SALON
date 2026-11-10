# Inventario de Tareas en Segundo Plano, Schedulers y Automatizaciones
**Sistema:** SalonPro SaaS (Plan Beauty RD)  
**Fecha:** 9 de Noviembre de 2026  
**Propósito:** Mapeo exhaustivo de procesos asíncronos, riesgos de concurrencia, mecanismos de bloqueo e idempotencia  

---

## 1. Visión General del Subsistema Asíncrono

En aplicaciones SaaS con modelos de facturación recurrente (membresías B2C Plan Beauty y suscripciones B2B de salones) y gestión de personal (asistencia, ausencias automáticas), la robustez de los procesos en segundo plano es crítica. La ejecución concurrente descontrolada puede causar cargos bancarios duplicados o inconsistencias contables graves.

---

## 2. Inventario Detallado de Tareas

### TAREA 1: Cobro Recurrente de Membresías B2C (Plan Beauty CardNet Billing)
- **Identificador:** `JOB-BILLING-B2C`
- **Propósito:** Identificar membresías activas cuya fecha `next_billing_date <= NOW()` y procesar el cobro recurrente con el token de tarjeta CardNet asociado.
- **Frecuencia Actual:** `setInterval` cada 15 minutos en producción (cada 2 minutos en pruebas).
- **Ubicación en Código:** `backend/server.js:67-79` y `backend/services/billing_job_scheduler.port.js`
- **Modelo de Ejecución:** In-process en el mismo proceso de la API HTTP de Express.
- **Mecanismo de Bloqueo (Locking):** **Implementado en Fase 2H-B.** Bloqueo distribuido con leases y expiración TTL (`backend/services/distributed_lock.service.cjs`).
- **Idempotencia:** **Alta (Implementada en Fase 2H-B).** Máquina de estados atómica (`pending` -> `processing` -> `completed`/`failed`/`dead_letter`) en `backend/services/job_repository.service.cjs`. Reintentos exponenciales y cola de error no reprocesable.
- **Manejo de Fallos y Reintentos:** Reintentos exponenciales con límite (`max_retries`). Al superar el límite pasa a `dead_letter`. Sanitización automática de datos sensibles (PAN/CVV) en mensajes de error.
- **Estado de Remediación:** `RESUELTO LOCALMENTE (Fase 2H-B)`. Desacoplado de `backend/server.js`. Ejecución mediante CLI dedicado `npm run worker:billing` (`backend/workers/billing.worker.cjs`) con validación de bandera explícita `ENABLE_BILLING_WORKER=true`. Probado exhaustivamente en `backend/tests/test_phase2h_jobs.cjs`.

---

### TAREA 2: Transición de Ciclo de Facturación SaaS B2B (Dunning & Grace Expiration)
- **Identificador:** `JOB-SAAS-LIFECYCLE`
- **Propósito:** Evaluar suscripciones B2B en estado `past_due` cuyo `grace_period_until < NOW()`, transicionándolas automáticamente a `suspended`, o de `cancelled` vencido a `expired`.
- **Frecuencia Actual:** Evaluado bajo demanda en cada verificación de entitlements y disponible vía endpoint `/api/cron/billing/tick`.
- **Ubicación en Código:** `backend/services/saas_lifecycle.service.js` y `backend/services/billing_job_scheduler.port.js`
- **Modelo de Ejecución:** Servicio de dominio invocado vía eventos o cron HTTP.
- **Mecanismo de Bloqueo:** Fail-closed en base a reloj inmutable.
- **Idempotencia:** **Alta.** La máquina de estados (`active -> past_due -> suspended -> cancelled -> expired`) es determinista y no sufre reentradas dañinas.
- **Manejo de Fallos:** Registra auditoría y bloquea acceso a funcionalidades comerciales no exentas.
- **Riesgo Identificado:** Si el cron HTTP no se dispara externamente, los tenants morosos solo son degradados cuando realizan una petición activa al servidor.
- **Recomendación:** Configurar un cron job del sistema operativo (o Cloud Scheduler) que invoque `/api/cron/billing/tick` cada 1 hora con `CRON_SECRET`.

---

### TAREA 3: Felicitaciones y Descuentos Automáticos de Cumpleaños
- **Identificador:** `JOB-MARKETING-BIRTHDAYS`
- **Propósito:** Detectar clientes cuyo cumpleaños sea en la fecha actual (`fecha_nacimiento` coincide con día y mes), enviar correo de felicitación y habilitar el 15% de descuento en el POS para la semana de su cumpleaños.
- **Frecuencia Actual:** Diariamente (evaluado dentro del `setInterval` de `server.js`).
- **Ubicación en Código:** `backend/server.js:80-95` y `backend/routes/marketing.routes.js:452-475`
- **Modelo de Ejecución:** `axios.post` local desde `server.js` hacia su propio puerto HTTP.
- **Mecanismo de Bloqueo:** Variable en memoria `lastBirthdaySentDate !== todayStr`.
- **Idempotencia:** **Nula si se reinicia el servidor.** Si PM2 reinicia el proceso al mediodía, `lastBirthdaySentDate` vuelve a ser `null` y el lote de felicitaciones se reenvía a las mismas clientas.
- **Manejo de Fallos:** Silencia errores con `.catch(() => null)`.
- **Riesgo Identificado (P1):** La llamada interna en `server.js:86` no envía la cabecera `x-cron-secret` exigida por `marketing.routes.js:454`, provocando que en producción **siempre falle con 403 Forbidden** y ninguna clienta reciba felicitaciones.
- **Recomendación:** Reemplazar el `axios.post` por una llamada interna a la función de negocio y persistir la fecha de último procesamiento en una tabla de control en base de datos (`system_job_executions`).

---

### TAREA 4: Generación Automática de Ausencias de Personal
- **Identificador:** `JOB-ATTENDANCE-AUTO-ABSENCE`
- **Propósito:** A las 23:59:59 de cada día laborable, verificar qué empleados asignados a turnos no registraron ponche de entrada y generar un registro de `Ausencia` automático en la tabla `attendance`.
- **Frecuencia Actual:** Evaluado al consultar los logs de asistencia o vía cron interno.
- **Ubicación en Código:** `backend/routes/attendance.routes.js:605-620`
- **Modelo de Ejecución:** Invocado en línea durante peticiones de visualización de asistencia.
- **Mecanismo de Bloqueo:** `ON CONFLICT (id) DO NOTHING` a nivel de base de datos.
- **Idempotencia:** **Alta.** La clave de ausencia se construye determinísticamente (`absent_${empId}_${dateStr}`).
- **Manejo de Fallos:** Registra warning y continúa con el siguiente empleado.
- **Riesgo Identificado:** Si el salón no abre el panel de asistencia durante el fin de semana, las ausencias del viernes no se generan en tiempo real hasta el lunes.
- **Recomendación:** Mover a la rutina nocturna del worker de cron diario.

---

### TAREA 5: Limpieza de Sesiones Expiradas y Auditoría
- **Identificador:** `JOB-SESSION-CLEANUP`
- **Propósito:** Eliminar registros antiguos de `user_sessions` inactivas o con más de 30 días de antigüedad para mantener la base de datos ligera.
- **Frecuencia Actual:** **Inexistente (No implementado).**
- **Ubicación en Código:** N/A
- **Modelo de Ejecución:** N/A
- **Mecanismo de Bloqueo:** N/A
- **Idempotencia:** N/A
- **Riesgo Identificado (P2):** La tabla `user_sessions` acumula filas indefinidamente con cada inicio de sesión, degradando el rendimiento de las consultas de autenticación a largo plazo.
- **Recomendación:** Crear tarea semanal `DELETE FROM user_sessions WHERE last_activity < NOW() - INTERVAL '30 days'`.

---

## 3. Matriz Resumen de Tareas Asíncronas

| Tarea | Frecuencia | Modelo Actual | Locking Actual | Idempotencia | Severidad de Riesgo |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Cobro Recurrente B2C** | 15 min | `setInterval` en API | **Ninguno** | Débil | **P0 (Cargos Duplicados)** |
| **Ciclo Vida SaaS B2B** | On-demand / 1h | Evento / HTTP Cron | Reloj Inmutable | Alta | P1 (Retraso de suspensión) |
| **Cumpleaños Automáticos** | 24 horas | `axios` local en API | Variable memoria | Nula en reinicio | **P1 (Falla 403 por falta de token)** |
| **Ausencias de Personal** | 24 horas | Lazy load en GET | SQL Conflict | Alta | P2 (Generación retrasada) |
| **Limpieza de Sesiones** | Ausente | No existe | N/A | N/A | P2 (Hinchazón de tablas) |

---

## 4. Arquitectura de Fondo Recomendada para Producción

```
+-------------------------------------------------------------+
|                 SERVIDORES HTTP (API EXPRESS)               |
|  - Recibe peticiones de usuarios y terminales POS           |
|  - DISABLE_SCHEDULER=true (Sin setInterval en servidor web) |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|                POSTGRESQL (Advisory Locks)                  |
|  - pg_try_advisory_lock(42001) para Billing                 |
|  - pg_try_advisory_lock(42002) para Marketing / Cumpleaños  |
+-------------------------------------------------------------+
                              ^
                              |
+-------------------------------------------------------------+
|               BACKGROUND WORKER DEDICADO                    |
|  - Proceso único node backend/workers/cron_worker.cjs       |
|  - Ejecuta lotes con reintentos controlados y logging       |
+-------------------------------------------------------------+
```

