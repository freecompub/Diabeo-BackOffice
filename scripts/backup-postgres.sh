#!/usr/bin/env bash
# =============================================================================
# backup-postgres.sh — nightly PostgreSQL dump + offload to OVH Object Storage
# =============================================================================
#
# Designed to run from cron on the prod VPS at 02:00 local:
#   0 2 * * * /opt/diabeo/backoffice/scripts/backup-postgres.sh \
#     >> /var/log/diabeo-backup.log 2>&1
#
# Backups are in PostgreSQL "custom" format (portable, parallel restore).
# A local copy is kept in $BACKUP_DIR for $LOCAL_RETENTION_DAYS days.
# Every dump is uploaded to OVH Object Storage; the bucket lifecycle rule
# (configured in the OVH console, see docs/operations/runbook.md §Backups)
# moves objects to Glacier after 7 days.
#
# Prerequisites (one-time setup):
# - pg_dump installed (postgresql-client package)
# - aws-cli installed and configured for the OVH S3 endpoint
# - env-file at /etc/diabeo/backup.env containing:
#     PG_HOST, PG_PORT (default 5432), PG_USER, PG_DB, PGPASSWORD
#     OVH_S3_ENDPOINT (e.g. https://s3.gra.io.cloud.ovh.net)
#     OVH_S3_ACCESS_KEY, OVH_S3_SECRET_KEY
#     OVH_S3_BUCKET (e.g. diabeo-backups-prod)
# - /var/backups/diabeo writable by the cron user
#
# Exit codes:
#   0  — success
#   1  — missing dependency or env var
#   2  — pg_dump failure
#   3  — S3 upload failure (local backup still kept)
# =============================================================================

set -euo pipefail

# ----------------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------------

ENV_FILE="${DIABEO_BACKUP_ENV:-/etc/diabeo/backup.env}"
BACKUP_DIR="${DIABEO_BACKUP_DIR:-/var/backups/diabeo}"
LOCAL_RETENTION_DAYS="${DIABEO_LOCAL_RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"

log()  { printf '[%s][backup] %s\n' "$(date -u +%FT%TZ)" "$*"; }
err()  { printf '[%s][backup][ERROR] %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }

# ----------------------------------------------------------------------------
# Prerequisites
# ----------------------------------------------------------------------------

if [[ ! -f "$ENV_FILE" ]]; then
  err "Env file not found: $ENV_FILE"
  err "Create it per docs/operations/runbook.md §Backups."
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

for cmd in pg_dump aws; do
  if ! command -v "$cmd" > /dev/null 2>&1; then
    err "Required command not found: $cmd"
    exit 1
  fi
done

for v in PG_HOST PG_USER PG_DB PGPASSWORD OVH_S3_ENDPOINT OVH_S3_ACCESS_KEY OVH_S3_SECRET_KEY OVH_S3_BUCKET; do
  if [[ -z "${!v-}" ]]; then
    err "Missing env var: $v (check $ENV_FILE)"
    exit 1
  fi
done

mkdir -p "$BACKUP_DIR"

DUMP_FILE="$BACKUP_DIR/diabeo-${TIMESTAMP}.dump"
export PGPASSWORD
export AWS_ACCESS_KEY_ID="$OVH_S3_ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$OVH_S3_SECRET_KEY"

# ----------------------------------------------------------------------------
# 1. Dump
# ----------------------------------------------------------------------------

log "pg_dump → $DUMP_FILE"
if ! pg_dump \
  --host="$PG_HOST" --port="${PG_PORT:-5432}" --username="$PG_USER" \
  --format=custom --jobs=4 --compress=9 \
  --file="$DUMP_FILE" \
  "$PG_DB"; then
  err "pg_dump failed — no file produced."
  exit 2
fi

local_size=$(du -h "$DUMP_FILE" | cut -f1)
log "Dump OK ($local_size)"

# ----------------------------------------------------------------------------
# 2. Upload to OVH Object Storage
# ----------------------------------------------------------------------------

S3_KEY="postgres/$(date -u +%Y)/$(date -u +%m)/$(basename "$DUMP_FILE")"
S3_URI="s3://$OVH_S3_BUCKET/$S3_KEY"

log "Uploading to $S3_URI"
if ! aws --endpoint-url="$OVH_S3_ENDPOINT" s3 cp "$DUMP_FILE" "$S3_URI" \
  --only-show-errors; then
  err "S3 upload failed — local dump kept at $DUMP_FILE"
  exit 3
fi
log "Upload OK"

# ----------------------------------------------------------------------------
# 3. Rotate local dumps (OVH bucket has its own lifecycle rule)
# ----------------------------------------------------------------------------

log "Rotating local dumps older than $LOCAL_RETENTION_DAYS days"
find "$BACKUP_DIR" -name 'diabeo-*.dump' -mtime "+$LOCAL_RETENTION_DAYS" -print -delete || true

log "Backup complete."
