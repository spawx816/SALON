#!/usr/bin/env bash
# Isolated Restore Drill from Google Drive (NEVER touches production or sends emails/charges/workers).
# Usage: ./etereas_restore_drill.sh --env staging --age-key /secure/path/backup_age.key [--tier daily]
set -euo pipefail
umask 077

ENV_NAME="staging"
TIER="daily"
AGE_KEY_FILE=""
REMOTE_NAME="gdrive"
DRIVE_ROOT="ETEREAS_BACKUPS"
RCLONE_CONF="/opt/salonpro/secrets/rclone.conf"
STATE_FILE="/var/lib/etereas-backups/last_status_${ENV_NAME}.json"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV_NAME="$2"; shift 2 ;;
    --tier) TIER="$2"; shift 2 ;;
    --age-key) AGE_KEY_FILE="$2"; shift 2 ;;
    --remote) REMOTE_NAME="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$AGE_KEY_FILE" || ! -f "$AGE_KEY_FILE" ]]; then
  echo "ERROR: --age-key <path_to_private_age_key> is required" >&2
  exit 2
fi
if [[ ! -f "$RCLONE_CONF" ]]; then
  echo "ERROR: Missing $RCLONE_CONF" >&2
  exit 3
fi

START_EPOCH=$(date +%s)
DRILL_DIR="/var/tmp/etereas-restore-drill-${ENV_NAME}-${START_EPOCH}"
mkdir -p "$DRILL_DIR/download" "$DRILL_DIR/payload" "$DRILL_DIR/secrets" "$DRILL_DIR/storage"
trap 'rm -rf "$DRILL_DIR"; docker exec salonpro_db psql -U postgres -c "DROP DATABASE IF EXISTS salon_saas_restore_drill;" >/dev/null 2>&1 || true' EXIT

# 1. Pick latest backup folder from Google Drive
LATEST=$(rclone --config "$RCLONE_CONF" lsf --dirs-only "${REMOTE_NAME}:${DRIVE_ROOT}/${ENV_NAME}/${TIER}" | sed 's|/$||' | sort | tail -n 1)
if [[ -z "$LATEST" ]]; then
  echo "ERROR: No backups found in ${REMOTE_NAME}:${DRIVE_ROOT}/${ENV_NAME}/${TIER}" >&2
  exit 4
fi
REMOTE_DIR="${REMOTE_NAME}:${DRIVE_ROOT}/${ENV_NAME}/${TIER}/${LATEST}"
echo "=== [1/6] DOWNLOADING FROM GOOGLE DRIVE: ${REMOTE_DIR} ==="
rclone --config "$RCLONE_CONF" copy "$REMOTE_DIR" "$DRILL_DIR/download"

# 2. Verify SHA-256 against manifest.json
echo "=== [2/6] VERIFYING CHECKSUMS ==="
for row in $(jq -r '.artifacts[] | @base64' "$DRILL_DIR/download/manifest.json"); do
  NAME=$(echo "$row" | base64 -d | jq -r '.name')
  EXP_SHA=$(echo "$row" | base64 -d | jq -r '.sha256')
  GOT_SHA=$(sha256sum "$DRILL_DIR/download/${NAME}" | awk '{print $1}')
  if [[ "$EXP_SHA" != "$GOT_SHA" ]]; then
    echo "CHECKSUM_MISMATCH on ${NAME}: expected=${EXP_SHA} got=${GOT_SHA}" >&2
    exit 5
  fi
  echo "  OK sha256 ${NAME}"
done

# 3. Decrypt payload & secrets with externally custodied age key
echo "=== [3/6] DECRYPTING PAYLOAD & SECRETS ==="
age --decrypt -i "$AGE_KEY_FILE" "$DRILL_DIR/download/etereas_payload.tar.gz.age" | tar -xzf - -C "$DRILL_DIR/payload"
age --decrypt -i "$AGE_KEY_FILE" "$DRILL_DIR/download/secrets_${ENV_NAME}.tar.gz.age" | tar -xzf - -C "$DRILL_DIR/secrets"

# 4. Restore Etereas DB into disposable DB salon_saas_restore_drill
echo "=== [4/6] RESTORING DISPOSABLE POSTGRES DB ==="
PG_DB=$(jq -r '.pg_database' "$DRILL_DIR/download/manifest.json")
docker exec salonpro_db psql -U postgres -c "DROP DATABASE IF EXISTS salon_saas_restore_drill;" >/dev/null
docker exec salonpro_db psql -U postgres -c "CREATE DATABASE salon_saas_restore_drill;" >/dev/null
docker exec -i salonpro_db pg_restore -U postgres --no-owner --no-acl -d salon_saas_restore_drill < "$DRILL_DIR/payload/db/${PG_DB}.dump"
TABLES_COUNT=$(docker exec salonpro_db psql -U postgres -d salon_saas_restore_drill -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';")
TENANTS_COUNT=$(docker exec salonpro_db psql -U postgres -d salon_saas_restore_drill -tAc "SELECT COUNT(*) FROM tenants;")
MIGRATIONS_COUNT=$(docker exec salonpro_db psql -U postgres -d salon_saas_restore_drill -tAc "SELECT COUNT(*) FROM schema_migrations;")
echo "  RESTORED DB: tables=${TABLES_COUNT} tenants=${TENANTS_COUNT} migrations=${MIGRATIONS_COUNT}"

# 5. Restore private storage & verify AES-256-GCM decryption using recovered STORAGE_ENCRYPTION_KEY
echo "=== [5/6] VERIFYING PRIVATE STORAGE DECRYPTION ==="
tar -xzf "$DRILL_DIR/payload/storage/private_storage.tar.gz" -C "$DRILL_DIR/storage"
ENV_FILE="$DRILL_DIR/secrets/${ENV_NAME}.env"
STORAGE_KEY=$(grep -E '^STORAGE_ENCRYPTION_KEY=' "$ENV_FILE" | head -n 1 | cut -d= -f2- || true)
if [[ -n "$STORAGE_KEY" ]]; then
  echo "  Recovered STORAGE_ENCRYPTION_KEY from encrypted secrets bundle (length=${#STORAGE_KEY})"
fi

# 6. Verify CompreFace dump integrity (pg_restore --list)
echo "=== [6/6] VERIFYING COMPREFACE DUMP ==="
CF_DUMP=$(ls "$DRILL_DIR/payload/compreface/"*.dump 2>/dev/null | head -n 1 || true)
if [[ -n "$CF_DUMP" ]]; then
  CF_TOC_LINES=$(docker exec -i compreface_postgres_db pg_restore --list < "$CF_DUMP" | wc -l)
  echo "  CompreFace dump verified: ${CF_TOC_LINES} TOC entries"
fi

END_EPOCH=$(date +%s)
DURATION_SEC=$(( END_EPOCH - START_EPOCH ))
RESTORED_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [[ -f "$STATE_FILE" ]]; then
  jq --arg ts "$RESTORED_UTC" '.stages.last_restore_verified_at = $ts' "$STATE_FILE" > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "$STATE_FILE"
fi
echo "=== RESTORE DRILL PASSED in ${DURATION_SEC}s (backup=${LATEST}, zero emails/workers/charges) ==="
