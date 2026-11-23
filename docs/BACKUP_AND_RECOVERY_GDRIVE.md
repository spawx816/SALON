# Backups Automáticos Cifrados Off-Site (Google Drive) — Etereas

Guía operativa y de recuperación ante desastres (DR) para **Etereas** ante pérdida total de la VPS.

---

## 1. Inventario: Qué se respalda y qué queda excluido

### Incluido en cada backup (`--env staging` o `--env production`)
1. **PostgreSQL de Etereas** (`salon_saas_staging` o `salon_saas_prod`): volcado lógico consistente (`pg_dump --format=custom --compress=6 --no-owner --no-acl`). Nunca se copian archivos PG en ejecución.
2. **Archivos privados cifrados** (volumen Docker `salonpro_storage_<env>`): fotos de referencia, logos, firmas y documentos de contratos, con **verificación automática de consistencia BD↔disco** (`private_files.storage_path WHERE deleted_at IS NULL` contra el paquete respaldado; falla si falta cualquier archivo referenciado).
3. **CompreFace**: volcado lógico consistente (`pg_dump -Fc`) de la BD `frs` (`compreface_postgres_db`) + configuración de `/opt/compreface/` (`docker-compose.yml` y `.env`).
4. **Configuración de infraestructura**: `/opt/salonpro/compose/` (`docker-compose.infra.yml`, `docker-compose.staging.yml`, `Caddyfile`, `init-dbs.sh`).
5. **Secretos del entorno** (`secrets_<env>.tar.gz.age`, cifrado en artefacto separado con `age`): `<env>.env` (incluye `STORAGE_ENCRYPTION_KEY`), `caddy.env`, `jwt_secret_<env>`, contraseñas PG del entorno y claves de respaldo.
6. **Metadatos y verificación**: `manifest.json` (fecha UTC, entorno, `release_commit`, `app_image`, lista de `schema_migrations`, conteos de consistencia, tamaños y SHA-256 de cada artefacto) + `RESTORE_QUICKSTART.txt`.

### Excluido explícitamente
- Base de pruebas `salon_saas_test` y secretos `test.*`.
- Secretos de producción dentro de backups de staging (y viceversa).
- Archivos binarios en ejecución de `/var/lib/postgresql/data`, cachés, `node_modules`, logs históricos y copias locales antiguas de `/opt/salonpro/backups/`.
- Código fuente completo (recuperable por `git clone` en el `release_commit` registrado en `manifest.json` + `docker build`).

---

## 2. Destino Google Drive, Horario y Retención

- **Destino dedicado**: `gdrive:ETEREAS_BACKUPS/<entorno>/<tier>/<YYYYMMDDTHHMMSSZ>/`
  - Separación estricta entre `ETEREAS_BACKUPS/staging/` y `ETEREAS_BACKUPS/production/`.
  - Transferencia vía `rclone copy` + verificación `rclone check --one-way` (nunca `rclone sync` destructivo).
- **Cifrado autenticado**: `age` (X25519 + ChaCha20-Poly1305) usando **únicamente la clave pública** (`backup_age_<env>.pub`) en la VPS. La clave privada de recuperación (`AGE-SECRET-KEY-1...`) debe custodiarse **fuera de la VPS** (gestor de contraseñas / bóveda offline) y eliminarse de la VPS tras su resguardo.
- **Horario (`systemd` timer)**: diario a las **03:00 `America/Santo_Domingo`** (`Persistent=true` ejecuta copias pendientes si la VPS estuvo apagada).
- **Retención GFS** (aplicada únicamente dentro de `ETEREAS_BACKUPS/<entorno>/<tier>/` y solo después de verificar la nueva copia):
  - **7** copias diarias (`daily/`)
  - **4** copias semanales (`weekly/`, domingos)
  - **6** copias mensuales (`monthly/`, día 1 de mes)
- **RPO**: La frecuencia diaria implica una pérdida potencial máxima de hasta **24 horas**. Si el negocio requiere RPO menor:
  - **RPO 6h / 1h**: ajustar `OnCalendar` del timer a `00/6:00:00` o `*:00:00` (aumenta uso de cuota Drive).
  - **RPO ~minutos (PITR)**: habilitar archivado continuo WAL de PostgreSQL (`pgBackRest` / `wal-g`) hacia almacenamiento objeto S3/B2/R2.

---

## 3. Pasos que debe completar personalmente el operador

> **Nota de seguridad**: Los timers de `systemd` quedan instalados pero **deshabilitados** hasta completar estos 3 pasos. Nunca pegues tokens OAuth ni claves privadas en el chat.

### Paso A — Custodiar la clave privada `age` fuera de la VPS
1. Conéctate por SSH a `staging-salon` y muestra la clave privada generada:
   ```bash
   sudo cat /opt/salonpro/secrets/backup_age_staging.key
   ```
2. Guarda la línea `AGE-SECRET-KEY-1...` en tu gestor de contraseñas (ej. 1Password / Bitwarden) bajo *"Etereas Recovery Key — Staging"*.
3. **Elimina la clave privada de la VPS** (la VPS solo necesita el archivo `.pub` para cifrar):
   ```bash
   sudo shred -u /opt/salonpro/secrets/backup_age_staging.key
   ```

### Paso B — Autorizar Google Drive vía OAuth oficial de `rclone`
Se recomienda una cuenta de Google dedicada para backups. En tu PC local (con navegador) o con túnel SSH:
1. En tu PC local (con `rclone` instalado), ejecuta:
   ```bash
   rclone authorize "drive"
   ```
   (Alternativa directa en la VPS si prefieres el asistente interactivo: `sudo rclone --config /opt/salonpro/secrets/rclone.conf config` → nuevo remoto `gdrive`, tipo `drive`, scope `drive.file` o `drive`, root folder vacío o dedicado, y sigue las instrucciones de `rclone authorize`.)
2. Asegura permisos restrictivos en la VPS:
   ```bash
   sudo chmod 600 /opt/salonpro/secrets/rclone.conf
   sudo chown root:root /opt/salonpro/secrets/rclone.conf
   sudo rclone --config /opt/salonpro/secrets/rclone.conf about gdrive:
   sudo rclone --config /opt/salonpro/secrets/rclone.conf mkdir gdrive:ETEREAS_BACKUPS/staging
   ```

### Paso C — Ejecutar primer backup real, prueba de restauración desde Drive y activar timers
1. Ejecutar backup manual a Google Drive:
   ```bash
   sudo /opt/salonpro/ops/backups/etereas_backup.sh --env staging
   ```
2. Ejecutar simulacro de restauración **descargando desde Google Drive** (colocando temporalmente tu clave privada en `/tmp/rec.key` con `chmod 600` y borrándola al finalizar con `shred -u /tmp/rec.key`):
   ```bash
   sudo /opt/salonpro/ops/backups/etereas_restore_drill.sh --env staging --age-key /tmp/rec.key --tier daily
   sudo shred -u /tmp/rec.key
   ```
3. Habilitar los timers automáticos solo tras verificar los dos pasos anteriores:
   ```bash
   sudo systemctl enable --now etereas-backup@staging.timer etereas-backup-healthcheck@staging.timer
   ```

---

## 4. Logs, Estado y Comandos de Verificación

- **Estado de última copia** (diferencia `created_at`, `uploaded_at`, `verified_at` y `last_restore_verified_at`):
  ```bash
  sudo cat /var/lib/etereas-backups/last_status_staging.json
  ```
- **Logs** (sin secretos):
  - `/opt/salonpro/logs/backups/backup_staging.log`
  - `/opt/salonpro/logs/backups/healthcheck_staging.log`
  - `/opt/salonpro/logs/backups/alert_failures.log`
- **Estado de timers y ejecuciones**:
  ```bash
  systemctl list-timers 'etereas-backup*'
  systemctl status etereas-backup@staging.service
  ```

---

## 5. Procedimiento de Recuperación Completa en una VPS Nueva

1. **Preparar VPS nueva**: instalar Docker Engine, Docker Compose plugin, `git`, `rclone`, `age`, `jq`.
2. **Descargar backup desde Google Drive**:
   ```bash
   rclone copy gdrive:ETEREAS_BACKUPS/<env>/daily/<TIMESTAMP> /root/recovery/
   ```
3. **Verificar checksums SHA-256** contra `/root/recovery/manifest.json`:
   ```bash
   cd /root/recovery && jq -r '.artifacts[] | "\(.sha256)  \(.name)"' manifest.json | sha256sum -c -
   ```
4. **Descifrar con la clave privada `age` recuperada del gestor de contraseñas**:
   ```bash
   mkdir -p /root/recovery/payload /root/recovery/secrets
   age --decrypt -i /root/age_recovery.key /root/recovery/etereas_payload.tar.gz.age | tar -xzf - -C /root/recovery/payload
   age --decrypt -i /root/age_recovery.key /root/recovery/secrets_<env>.tar.gz.age | tar -xzf - -C /root/recovery/secrets
   shred -u /root/age_recovery.key
   ```
5. **Restaurar infraestructura y secretos**:
   ```bash
   mkdir -p /opt/salonpro/compose /opt/salonpro/secrets /opt/compreface
   tar -xzf /root/recovery/payload/infra/compose_and_caddy.tar.gz -C /opt/salonpro/compose
   cp /root/recovery/secrets/* /opt/salonpro/secrets/ && chmod 700 /opt/salonpro/secrets && chmod 600 /opt/salonpro/secrets/*
   tar -xzf /root/recovery/payload/compreface/compreface_config.tar.gz -C /opt/compreface
   ```
6. **Reconstruir la imagen exacta del release** (`release_commit` de `manifest.json`):
   ```bash
   COMMIT=$(jq -r '.release_commit' /root/recovery/manifest.json)
   git clone https://github.com/spawx816/SALON.git /opt/salonpro/releases/$COMMIT
   cd /opt/salonpro/releases/$COMMIT && git checkout $COMMIT && docker build -t salonpro-app:$COMMIT .
   ```
7. **Levantar bases de datos y restaurar dumps + archivos privados**:
   ```bash
   docker compose -f /opt/salonpro/compose/docker-compose.infra.yml up -d
   docker exec -i salonpro_db pg_restore -U postgres --clean --if-exists --no-owner --no-acl -d salon_saas_<env> < /root/recovery/payload/db/salon_saas_<env>.dump
   docker compose -f /opt/compreface/docker-compose.yml up -d compreface-postgres-db
   docker exec -i compreface_postgres_db pg_restore -U postgres --clean --if-exists --no-owner --no-acl -d frs < /root/recovery/payload/compreface/compreface_frs.dump
   docker compose -f /opt/compreface/docker-compose.yml up -d
   tar -xzf /root/recovery/payload/storage/private_storage.tar.gz -C /var/lib/docker/volumes/salonpro_storage_<env>/_data
   ```
8. **Levantar aplicación y verificar salud** (con `SAAS_RENEWAL_WORKER_ENABLED` desactivado y `DGII_MODE=disabled` hasta validar):
   ```bash
   docker compose -f /opt/salonpro/compose/docker-compose.staging.yml up -d
   curl -sf http://127.0.0.1:5005/api/health
   ```
