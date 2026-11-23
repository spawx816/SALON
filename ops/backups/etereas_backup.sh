#!/usr/bin/env bash
# Etereas Off-Site Encrypted Backup to Google Drive (rclone + age)
# Strictly separates staging vs production. Never logs secrets. Never uses destructive rclone sync.
set -euo pipefail
umask 077

ENV_NAME="staging"
LOCAL_ONLY="false"
TIER_OVERRIDE=""
REMOTE_NAME="gdrive"
DRIVE_ROOT="ETEREAS_BACKUPS"
RCLONE_CONF="/opt/salonpro/secrets/rclone.conf"
STATE_DIR="/var/lib/etereas-backups"
LOG_DIR="/opt/salonpro/logs/backups"
WORK_BASE="/var/tmp/etereas-backup-work"
ALERT_SCRIPT="/opt/salonpro/ops/backups/etereas_backup_alert.cjs"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV_NAME="$2"; shift 2 ;;
    --local-only) LOCAL_ONLY="true"; shift ;;
    --tier) TIER_OVERRIDE="$2"; shift 2 ;;
    --remote) REMOTE_NAME="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ "$ENV_NAME" != "staging" && "$ENV_NAME" != "production" ]]; then
  echo "ERROR: --env must be 'staging' or 'production'" >&2
  exit 2
fi

mkdir -p "$STATE_DIR" "$LOG_DIR" "$WORK_BASE"
chmod 700 "$STATE_DIR" "$WORK_BASE"
chmod 750 "$LOG_DIR"

LOCK_FILE="/run/lock/etereas-backup-${ENV_NAME}.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date -u +%FT%TZ)] SKIP: another backup for ${ENV_NAME} is already running." >&2
  exit 1
fi

TS_UTC="$(date -u +%Y%m%dT%H%M%SZ)"
ISO_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DAY_OF_MONTH="$(TZ=America/Santo_Domingo date +%d)"
DAY_OF_WEEK="$(TZ=America/Santo_Domingo date +%u)" # 7 = Sunday

if [[ -n "$TIER_OVERRIDE" ]]; then
  TIER="$TIER_OVERRIDE"
elif [[ "$DAY_OF_MONTH" == "01" ]]; then
  TIER="monthly"
elif [[ "$DAY_OF_WEEK" == "7" ]]; then
  TIER="weekly"
else
  TIER="daily"
fi

# Environment-specific mapping
if [[ "$ENV_NAME" == "staging" ]]; then
  PG_DB="salon_saas_staging"
  STORAGE_VOL="/var/lib/docker/volumes/salonpro_storage_staging/_data"
  APP_CONTAINER="salonpro_app"
  AGE_PUB_FILE="/opt/salonpro/secrets/backup_age_staging.pub"
  SECRET_FILES=(
    "staging.env"
    "caddy.env"
    "jwt_secret_staging"
    "staging_user_password"
    "staging_migrator_password"
    "postgres_bootstrap_password"
    "backup_encryption_key"
    "backup_hmac_secret"
  )
else
  PG_DB="salon_saas_prod"
  STORAGE_VOL="/var/lib/docker/volumes/salonpro_storage_prod/_data"
  APP_CONTAINER="salonpro_app_prod"
  AGE_PUB_FILE="/opt/salonpro/secrets/backup_age_production.pub"
  SECRET_FILES=(
    "production.env"
    "caddy.env"
    "jwt_secret_prod"
    "prod_user_password"
    "prod_migrator_password"
    "postgres_bootstrap_password"
    "backup_encryption_key"
    "backup_hmac_secret"
  )
fi

STATUS_FILE="${STATE_DIR}/last_status_${ENV_NAME}.json"
WORK_DIR="${WORK_BASE}/${ENV_NAME}_${TS_UTC}"
mkdir -p "$WORK_DIR/payload/db" "$WORK_DIR/payload/storage" "$WORK_DIR/payload/compreface" "$WORK_DIR/payload/infra" "$WORK_DIR/secrets_stage" "$WORK_DIR/out"

send_alert() {
  local level="$1"
  local subject="$2"
  local body="$3"
  echo "[$(date -u +%FT%TZ)] ALERT [${level}] ${subject}: ${body}" >> "${LOG_DIR}/backup_${ENV_NAME}.log"
  if [[ -f "$ALERT_SCRIPT" ]] && docker ps --format '{{.Names}}' | grep -qx "salonpro_app"; then
    docker exec -i -w /app/backend salonpro_app node - "$level" "$subject" "$body" < "$ALERT_SCRIPT" \
      >> "${LOG_DIR}/alert_failures.log" 2>&1 || \
      echo "[$(date -u +%FT%TZ)] ALERT_DISPATCH_FAILED: ${subject}" >> "${LOG_DIR}/alert_failures.log"
  else
    echo "[$(date -u +%FT%TZ)] ALERT_SKIPPED_NO_APP_CONTAINER: ${subject}" >> "${LOG_DIR}/alert_failures.log"
  fi
}

cleanup() {
  local rc=$?
  if [[ $rc -ne 0 ]]; then
    send_alert "ERROR" "Fallo en backup off-site (${ENV_NAME})" "El respaldo ${TS_UTC} (${TIER}) terminó con código ${rc}. Revisar ${LOG_DIR}/backup_${ENV_NAME}.log"
  fi
  if [[ "${KEEP_WORK_DIR:-false}" != "true" ]]; then
    rm -rf "$WORK_DIR"
  fi
}
trap cleanup EXIT

if [[ ! -f "$AGE_PUB_FILE" ]]; then
  echo "ERROR: Missing age public key file: $AGE_PUB_FILE" >&2
  exit 3
fi
if [[ "$LOCAL_ONLY" != "true" && ! -f "$RCLONE_CONF" ]]; then
  echo "ERROR: Missing rclone config: $RCLONE_CONF (complete Google Drive OAuth first)" >&2
  exit 4
fi

echo "[$(date -u +%FT%TZ)] START backup env=${ENV_NAME} tier=${TIER} local_only=${LOCAL_ONLY}"

# 1. Consistent PostgreSQL logical dump (MVCC snapshot T1)
docker exec salonpro_db pg_dump -U postgres --format=custom --compress=6 --no-owner --no-acl "$PG_DB" > "$WORK_DIR/payload/db/${PG_DB}.dump"

# Capture DB metadata, applied migrations & referenced private_files paths
MIGRATIONS_JSON=$(docker exec salonpro_db psql -U postgres -d "$PG_DB" -tAc "SELECT COALESCE(json_agg(version ORDER BY version), '[]'::json) FROM schema_migrations;" 2>/dev/null || echo '[]')
REFERENCED_PATHS_FILE="$WORK_DIR/referenced_private_paths.txt"
docker exec salonpro_db psql -U postgres -d "$PG_DB" -tAc "SELECT storage_path FROM private_files WHERE deleted_at IS NULL AND storage_path IS NOT NULL;" > "$REFERENCED_PATHS_FILE" 2>/dev/null || true

# 2. Private encrypted storage files + verifiable DB<->file consistency check
REF_COUNT=0
VERIFIED_COUNT=0
MISSING_COUNT=0
if [[ -d "$STORAGE_VOL" ]]; then
  tar -czf "$WORK_DIR/payload/storage/private_storage.tar.gz" -C "$STORAGE_VOL" .
  while IFS= read -r rel_path; do
    [[ -z "$rel_path" ]] && continue
    REF_COUNT=$((REF_COUNT + 1))
    if [[ -f "${STORAGE_VOL}/${rel_path}" ]]; then
      VERIFIED_COUNT=$((VERIFIED_COUNT + 1))
    else
      MISSING_COUNT=$((MISSING_COUNT + 1))
      echo "CONSISTENCY_ERROR: missing private_file on disk: ${rel_path}" >&2
    fi
  done < "$REFERENCED_PATHS_FILE"
  if [[ $MISSING_COUNT -gt 0 ]]; then
    echo "ERROR: ${MISSING_COUNT} referenced private_files missing from storage volume!" >&2
    exit 5
  fi
else
  echo "WARN: Storage volume directory not found: $STORAGE_VOL (creating empty archive)"
  tar -czf "$WORK_DIR/payload/storage/private_storage.tar.gz" --files-from /dev/null
fi

# 3. CompreFace PostgreSQL logical dump + compose/config
if docker ps --format '{{.Names}}' | grep -qx "compreface_postgres_db"; then
  CF_USER=$(docker exec compreface_postgres_db printenv POSTGRES_USER)
  CF_DB=$(docker exec compreface_postgres_db printenv POSTGRES_DB)
  docker exec compreface_postgres_db pg_dump -U "$CF_USER" --format=custom --compress=6 --no-owner --no-acl "$CF_DB" > "$WORK_DIR/payload/compreface/compreface_${CF_DB}.dump"
  CF_SUBJECTS=$(docker exec compreface_postgres_db psql -U "$CF_USER" -d "$CF_DB" -tAc "SELECT COUNT(*) FROM subject;" 2>/dev/null || echo "0")
else
  CF_SUBJECTS="0"
fi
if [[ -d "/opt/compreface" ]]; then
  tar -czf "$WORK_DIR/payload/compreface/compreface_config.tar.gz" -C /opt/compreface --exclude='*.log' --exclude='.git' .
fi

# 4. Infrastructure config (Compose, Caddyfile, init-dbs.sh) - NO secrets here
if [[ -d "/opt/salonpro/compose" ]]; then
  tar -czf "$WORK_DIR/payload/infra/compose_and_caddy.tar.gz" -C /opt/salonpro/compose .
fi

# 5. Release metadata (image + commit)
APP_IMAGE=$(docker inspect "$APP_CONTAINER" --format '{{.Config.Image}}' 2>/dev/null || echo "unknown")
RELEASE_COMMIT="${APP_IMAGE##*:}"

# 6. Secrets bundle (encrypted separately with age public key - NEVER stored plaintext)
INCLUDED_SECRETS=()
for sf in "${SECRET_FILES[@]}"; do
  if [[ -f "/opt/salonpro/secrets/${sf}" ]]; then
    cp "/opt/salonpro/secrets/${sf}" "$WORK_DIR/secrets_stage/${sf}"
    INCLUDED_SECRETS+=("$sf")
  fi
done
tar -czf - -C "$WORK_DIR/secrets_stage" . | age -R "$AGE_PUB_FILE" -o "$WORK_DIR/out/secrets_${ENV_NAME}.tar.gz.age"
rm -rf "$WORK_DIR/secrets_stage"

# 7. Encrypt main payload with age public key
tar -czf - -C "$WORK_DIR/payload" . | age -R "$AGE_PUB_FILE" -o "$WORK_DIR/out/etereas_payload.tar.gz.age"

# 8. Build manifest with checksums & sizes + quick restore guide
PAYLOAD_SIZE=$(stat -c%s "$WORK_DIR/out/etereas_payload.tar.gz.age")
PAYLOAD_SHA=$(sha256sum "$WORK_DIR/out/etereas_payload.tar.gz.age" | awk '{print $1}')
SECRETS_SIZE=$(stat -c%s "$WORK_DIR/out/secrets_${ENV_NAME}.tar.gz.age")
SECRETS_SHA=$(sha256sum "$WORK_DIR/out/secrets_${ENV_NAME}.tar.gz.age" | awk '{print $1}')
SECRETS_JSON=$(printf '%s\n' "${INCLUDED_SECRETS[@]}" | jq -R . | jq -s .)

jq -n \
  --arg created_at_utc "$ISO_UTC" \
  --arg environment "$ENV_NAME" \
  --arg tier "$TIER" \
  --arg pg_database "$PG_DB" \
  --arg app_image "$APP_IMAGE" \
  --arg release_commit "$RELEASE_COMMIT" \
  --argjson migrations "$MIGRATIONS_JSON" \
  --argjson private_files_referenced "$REF_COUNT" \
  --argjson private_files_verified "$VERIFIED_COUNT" \
  --argjson compreface_subjects "${CF_SUBJECTS:-0}" \
  --argjson included_secrets "$SECRETS_JSON" \
  --arg payload_file "etereas_payload.tar.gz.age" \
  --argjson payload_bytes "$PAYLOAD_SIZE" \
  --arg payload_sha256 "$PAYLOAD_SHA" \
  --arg secrets_file "secrets_${ENV_NAME}.tar.gz.age" \
  --argjson secrets_bytes "$SECRETS_SIZE" \
  --arg secrets_sha256 "$SECRETS_SHA" \
  '{
    schema_version: 1,
    created_at_utc: $created_at_utc,
    environment: $environment,
    tier: $tier,
    pg_database: $pg_database,
    app_image: $app_image,
    release_commit: $release_commit,
    applied_migrations: $migrations,
    consistency: {
      strategy: "mvcc_pg_dump_t1_plus_immutable_private_files_verification",
      private_files_referenced: $private_files_referenced,
      private_files_verified: $private_files_verified,
      compreface_subjects: $compreface_subjects
    },
    included_secret_names: $included_secrets,
    artifacts: [
      { name: $payload_file, bytes: $payload_bytes, sha256: $payload_sha256, cipher: "age-x25519-chacha20poly1305" },
      { name: $secrets_file, bytes: $secrets_bytes, sha256: $secrets_sha256, cipher: "age-x25519-chacha20poly1305" }
    ]
  }' > "$WORK_DIR/out/manifest.json"

cat > "$WORK_DIR/out/RESTORE_QUICKSTART.txt" <<'EOF'
ETEREAS OFF-SITE RECOVERY QUICKSTART
1. Verify SHA-256 of etereas_payload.tar.gz.age and secrets_<env>.tar.gz.age against manifest.json.
2. Decrypt using your externally custodied age recovery private key:
   age --decrypt -i /secure/path/backup_age.key etereas_payload.tar.gz.age | tar -xzf - -C ./restored_payload
   age --decrypt -i /secure/path/backup_age.key secrets_<env>.tar.gz.age | tar -xzf - -C ./restored_secrets
3. Restore PostgreSQL: pg_restore --clean --if-exists --no-owner --no-acl -d <target_db> restored_payload/db/<db>.dump
4. Restore private storage files to Docker volume and CompreFace frs.dump to compreface_postgres_db.
5. Full procedure: docs/BACKUP_AND_RECOVERY_GDRIVE.md in repository.
EOF

CREATED_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
UPLOADED_UTC="null"
VERIFIED_UTC="null"
REMOTE_PATH="local-only"

if [[ "$LOCAL_ONLY" != "true" ]]; then
  # Check Drive free space before upload
  ABOUT_JSON=$(rclone --config "$RCLONE_CONF" about "${REMOTE_NAME}:" --json 2>/dev/null || echo '{}')
  FREE_BYTES=$(echo "$ABOUT_JSON" | jq -r '.free // -1')
  TOTAL_BYTES=$(echo "$ABOUT_JSON" | jq -r '.total // -1')
  if [[ "$FREE_BYTES" -ge 0 && "$TOTAL_BYTES" -gt 0 ]]; then
    FREE_PCT=$(( FREE_BYTES * 100 / TOTAL_BYTES ))
    if [[ "$FREE_PCT" -lt 15 || "$FREE_BYTES" -lt 2147483648 ]]; then
      send_alert "WARN" "Espacio bajo en Google Drive (${ENV_NAME})" "Espacio libre en Drive: ${FREE_PCT}% (${FREE_BYTES} bytes)."
    fi
  fi

  REMOTE_PATH="${REMOTE_NAME}:${DRIVE_ROOT}/${ENV_NAME}/${TIER}/${TS_UTC}"
  rclone --config "$RCLONE_CONF" copy "$WORK_DIR/out" "$REMOTE_PATH" \
    --transfers 2 --retries 3 --low-level-retries 5 --timeout 2m --stats-one-line
  UPLOADED_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  # Verify remote transfer integrity (size + checksums)
  rclone --config "$RCLONE_CONF" check "$WORK_DIR/out" "$REMOTE_PATH" --one-way
  VERIFIED_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  # GFS retention ONLY inside dedicated tier folder and ONLY after verified upload
  case "$TIER" in
    daily)   KEEP_COUNT=7 ;;
    weekly)  KEEP_COUNT=4 ;;
    monthly) KEEP_COUNT=6 ;;
    *)       KEEP_COUNT=7 ;;
  esac

  TIER_REMOTE="${REMOTE_NAME}:${DRIVE_ROOT}/${ENV_NAME}/${TIER}"
  mapfile -t DIRS < <(rclone --config "$RCLONE_CONF" lsf --dirs-only "$TIER_REMOTE" | sed 's|/$||' | sort)
  TOTAL_DIRS="${#DIRS[@]}"
  if [[ "$TOTAL_DIRS" -gt "$KEEP_COUNT" ]]; then
    TO_DELETE=$(( TOTAL_DIRS - KEEP_COUNT ))
    for ((i=0; i<TO_DELETE; i++)); do
      OLD_DIR="${DIRS[$i]}"
      echo "[$(date -u +%FT%TZ)] RETENTION_PRUNE ${TIER_REMOTE}/${OLD_DIR}"
      rclone --config "$RCLONE_CONF" purge "${TIER_REMOTE}/${OLD_DIR}"
    done
  fi
fi

# Preserve last_restore_verified_at if present
PREV_RESTORE=$(jq -r '.last_restore_verified_at // empty' "$STATUS_FILE" 2>/dev/null || true)

jq -n \
  --arg env "$ENV_NAME" \
  --arg tier "$TIER" \
  --arg backup_id "$TS_UTC" \
  --arg release_commit "$RELEASE_COMMIT" \
  --arg remote_path "$REMOTE_PATH" \
  --arg created_at "$CREATED_UTC" \
  --arg uploaded_at "$UPLOADED_UTC" \
  --arg verified_at "$VERIFIED_UTC" \
  --arg last_restore_verified_at "${PREV_RESTORE:-}" \
  --argjson payload_bytes "$PAYLOAD_SIZE" \
  --argjson secrets_bytes "$SECRETS_SIZE" \
  --argjson private_files_verified "$VERIFIED_COUNT" \
  '{
    environment: $env,
    tier: $tier,
    backup_id: $backup_id,
    release_commit: $release_commit,
    remote_path: $remote_path,
    stages: {
      created_at: $created_at,
      uploaded_at: (if $uploaded_at == "null" then null else $uploaded_at end),
      verified_at: (if $verified_at == "null" then null else $verified_at end),
      last_restore_verified_at: (if $last_restore_verified_at == "" then null else $last_restore_verified_at end)
    },
    payload_bytes: $payload_bytes,
    secrets_bytes: $secrets_bytes,
    private_files_verified: $private_files_verified
  }' > "$STATUS_FILE"

echo "[$(date -u +%FT%TZ)] DONE backup env=${ENV_NAME} tier=${TIER} id=${TS_UTC} payload=${PAYLOAD_SIZE}B secrets=${SECRETS_SIZE}B remote=${REMOTE_PATH}"
