#!/usr/bin/env bash
# Verifies freshness (<26h) of last verified off-site backup and Google Drive quota (>15% free).
set -euo pipefail

ENV_NAME="${1:-staging}"
MAX_AGE_HOURS="${2:-26}"
STATE_FILE="/var/lib/etereas-backups/last_status_${ENV_NAME}.json"
RCLONE_CONF="/opt/salonpro/secrets/rclone.conf"
LOG_DIR="/opt/salonpro/logs/backups"
ALERT_SCRIPT="/opt/salonpro/ops/backups/etereas_backup_alert.cjs"
mkdir -p "$LOG_DIR"

send_alert() {
  local level="$1" subject="$2" body="$3"
  echo "[$(date -u +%FT%TZ)] HEALTH_ALERT [${level}] ${subject}: ${body}" >> "${LOG_DIR}/healthcheck_${ENV_NAME}.log"
  if [[ -f "$ALERT_SCRIPT" ]] && docker ps --format '{{.Names}}' | grep -qx "salonpro_app"; then
    docker exec -i -w /app/backend salonpro_app node - "$level" "$subject" "$body" < "$ALERT_SCRIPT" \
      >> "${LOG_DIR}/alert_failures.log" 2>&1 || true
  fi
}

if [[ ! -f "$STATE_FILE" ]]; then
  send_alert "ERROR" "Sin estado de backup (${ENV_NAME})" "No existe ${STATE_FILE}."
  exit 1
fi

VERIFIED_AT=$(jq -r '.stages.verified_at // empty' "$STATE_FILE")
if [[ -z "$VERIFIED_AT" ]]; then
  send_alert "ERROR" "Backup no verificado en Drive (${ENV_NAME})" "last_status no registra stages.verified_at."
  exit 1
fi

VERIFIED_EPOCH=$(date -u -d "$VERIFIED_AT" +%s)
NOW_EPOCH=$(date -u +%s)
AGE_HOURS=$(( (NOW_EPOCH - VERIFIED_EPOCH) / 3600 ))
if [[ "$AGE_HOURS" -gt "$MAX_AGE_HOURS" ]]; then
  send_alert "ERROR" "Backup vencido (${ENV_NAME})" "Último backup verificado hace ${AGE_HOURS}h (${VERIFIED_AT}), umbral=${MAX_AGE_HOURS}h."
  exit 1
fi

if [[ -f "$RCLONE_CONF" ]]; then
  ABOUT_JSON=$(rclone --config "$RCLONE_CONF" about gdrive: --json 2>/dev/null || echo '{}')
  FREE_BYTES=$(echo "$ABOUT_JSON" | jq -r '.free // -1')
  TOTAL_BYTES=$(echo "$ABOUT_JSON" | jq -r '.total // -1')
  if [[ "$FREE_BYTES" -ge 0 && "$TOTAL_BYTES" -gt 0 ]]; then
    FREE_PCT=$(( FREE_BYTES * 100 / TOTAL_BYTES ))
    if [[ "$FREE_PCT" -lt 15 ]]; then
      send_alert "WARN" "Cuota baja en Google Drive (${ENV_NAME})" "Espacio libre: ${FREE_PCT}% (${FREE_BYTES} bytes)."
    fi
  fi
fi

echo "BACKUP_HEALTH_OK env=${ENV_NAME} verified_at=${VERIFIED_AT} age_hours=${AGE_HOURS}"
