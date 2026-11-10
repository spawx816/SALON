# PROCEDIMIENTO Y AUDITORÍA DE ROLLBACK DE STAGING — FASE 3B.1

**Fecha:** 10 de Noviembre de 2026  
**Propósito:** Protocolo estandarizado y probado para la reversión inmediata de imágenes y datos en Staging ante incidentes o regresiones.

---

## 1. Rollback de la Imagen de Aplicación

Si un nuevo release desplegado en Staging presenta anomalías:

1. **Identificar la imagen anterior estable:**
   ```bash
   sudo docker images | grep salonpro-app
   # salonpro-app:8fbe4ae (Actual)
   # salonpro-app:dc1c440 (Anterior)
   ```
2. **Actualizar la variable en Compose o entorno:**
   ```bash
   sudo sed -i 's/salonpro-app:8fbe4ae/salonpro-app:dc1c440/g' /opt/salonpro/compose/docker-compose.staging.yml
   ```
3. **Recrear el contenedor con downtime cero o mínimo (< 3 segundos):**
   ```bash
   sudo docker compose -f /opt/salonpro/compose/docker-compose.staging.yml up -d --force-recreate salonpro_app
   ```
4. **Verificar estado de salud:**
   ```bash
   sudo docker ps | grep salonpro_app
   # Debe figurar Up (healthy)
   ```

---

## 2. Reversión de Datos a Partir del Backup Cifrado

Si se requiere restaurar el estado de datos de Staging a un punto previo:

1. **Ubicar el archivo de backup cifrado y su manifiesto:**
   ```bash
   ls -la /opt/salonpro/backups/
   ```
2. **Ejecutar el script de restauración autenticado:**
   ```bash
   sudo docker run --rm \
     --network salon_infra_net \
     --env-file /opt/salonpro/secrets/migrator_staging.env \
     -e BACKUP_ENCRYPTION_KEY="$(cat /opt/salonpro/secrets/backup_encryption_key)" \
     -e BACKUP_HMAC_KEY="$(cat /opt/salonpro/secrets/backup_hmac_secret)" \
     -v /opt/salonpro/releases/current/backend/scripts:/app/backend/scripts:ro \
     salonpro-app:current \
     node backend/scripts/restore_encrypted_backup.cjs /opt/salonpro/backups/staging_backup_latest.enc
   ```
3. **Verificar integridad del esquema:**
   ```bash
   npm run test:matrix
   ```

---

## 3. Protocolo de Emergencia: Aislamiento Total

En caso de compromiso de seguridad en Staging:

1. **Detener de inmediato los contenedores de exposición Edge:**
   ```bash
   sudo docker compose -f /opt/salonpro/compose/docker-compose.staging.yml down
   ```
2. **PostgreSQL permanece aislado:**
   Dado que `salonpro_db` está en `salon_infra_net` con `internal: true`, la base de datos no es accesible desde ninguna red externa aún cuando los demás contenedores estén caídos.
3. **Rotar credenciales perimetrales en `/opt/salonpro/secrets/caddy.env`**.

