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

ACTOR="${USER:-$(whoami)}"
HOST="$(hostname -s 2>/dev/null || echo unknown)"

log()  { printf '[%s][backup][host=%s actor=%s] %s\n' "$(date -u +%FT%TZ)" "$HOST" "$ACTOR" "$*"; }
err()  { printf '[%s][backup][host=%s actor=%s][ERROR] %s\n' "$(date -u +%FT%TZ)" "$HOST" "$ACTOR" "$*" >&2; }

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

for cmd in pg_dump aws sha256sum; do
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

# Integrity manifest — sidecar sha256 uploaded alongside the dump so a
# restore drill can verify the object hasn't been silently rewritten.
SHA_FILE="${DUMP_FILE}.sha256"
( cd "$BACKUP_DIR" && sha256sum "$(basename "$DUMP_FILE")" > "$SHA_FILE" )
log "SHA256 manifest generated: $(cat "$SHA_FILE")"

S3_KEY="postgres/$(date -u +%Y)/$(date -u +%m)/$(basename "$DUMP_FILE")"
S3_URI="s3://$OVH_S3_BUCKET/$S3_KEY"
S3_SHA_URI="s3://$OVH_S3_BUCKET/${S3_KEY}.sha256"

# HDS at-rest (ISO 27018 A.10): dump contains passwordHash, mfaSecret, emailHmac,
# session tokens, full audit_logs. Field-level AES-GCM protects PII columns but
# not the dump envelope. --sse AES256 enables OVH server-side encryption;
# client-side age/gpg encryption is planned for a follow-up (runbook §Future).
log "Uploading (SSE AES256) to $S3_URI"
if ! aws --endpoint-url="$OVH_S3_ENDPOINT" s3 cp "$DUMP_FILE" "$S3_URI" \
  --sse AES256 --only-show-errors; then
  err "S3 upload failed — local dump kept at $DUMP_FILE"
  exit 3
fi
log "Uploading sha256 manifest to $S3_SHA_URI"
if ! aws --endpoint-url="$OVH_S3_ENDPOINT" s3 cp "$SHA_FILE" "$S3_SHA_URI" \
  --sse AES256 --only-show-errors; then
  err "S3 manifest upload failed — backup is still in S3 but without integrity sidecar"
  exit 3
fi
log "Upload OK (dump + manifest, both SSE AES256)"

# ----------------------------------------------------------------------------
# 3. Rotate local dumps (OVH bucket has its own lifecycle rule)
# ----------------------------------------------------------------------------

log "Rotating local dumps older than $LOCAL_RETENTION_DAYS days"
find "$BACKUP_DIR" -name 'diabeo-*.dump' -mtime "+$LOCAL_RETENTION_DAYS" -print -delete || true

log "Backup complete."
