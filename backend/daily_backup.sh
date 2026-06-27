#!/bin/bash

# Ruta al directorio backend en tu VPS
PROJECT_DIR="/var/www/salon-pro/backend"
# Ruta de destino temporal para procesar el backup
TEMP_DIR="/tmp"
# Fecha de hoy para nombrar el archivo
DATE_STR=$(date +%Y-%m-%d)
FILENAME="backup_salonpro_$DATE_STR.sql"

echo "--- Iniciando Copia de Seguridad SQL Diaria ---"

# 1. Cargar las credenciales automáticamente desde el archivo .env
if [ -f "$PROJECT_DIR/.env" ]; then
    export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
else
    echo "Error: No se encontró el archivo .env en $PROJECT_DIR"
    exit 1
fi

# 2. Ejecutar mysqldump conectándose al host remoto
echo "Ejecutando volcado de base de datos..."
mysqldump --no-tablespaces -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" > "$TEMP_DIR/$FILENAME"


# 3. Subir a OneDrive a la carpeta "Backups"
echo "Subiendo copia .sql a OneDrive..."
rclone copy "$TEMP_DIR/$FILENAME" onedrive:Backups/

# 4. Eliminar el archivo temporal local de la VPS
rm "$TEMP_DIR/$FILENAME"

echo "--- Copia de seguridad .sql completada y subida con éxito ---"
