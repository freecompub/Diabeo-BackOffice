#!/usr/bin/env bash
# =============================================================================
# backup-postgres.sh — nightly PostgreSQL dump (HDS-hardened)
# =============================================================================
#
# Pipeline:
#   pg_dump --format=custom  →  age -r <recipient>  →  .age envelope
#                           ↓
#                     sha256sum (integrity manifest)
#                           ↓
#           aws s3 cp --sse AES256 (defense in depth)
#           to s3://$OVH_S3_BUCKET/postgres/YYYY/MM/
#
# HDS guarantees:
# - Client-side encryption (age) with recipient key held OUTSIDE OVH — the
#   cloud provider cannot decrypt even under legal compulsion (ISO 27018
#   A.10 + RGPD Art. 32).
# - Server-side SSE AES256 is belt-and-suspenders against an age key leak
#   pre-compromise.
# - Pre-flight verifies the bucket is in Object Lock Compliance mode —
#   tamper-evidence required by HDS (ISO 27001 A.12.3).
# - `.pgpass` authentication (not PGPASSWORD env) — eliminates the
#   `ps auxe` env-exposure window.
# - SHA256 manifest over the ENCRYPTED envelope — verifiable against what
#   is actually stored in S3.
#
# Cron:
#   0 2 * * * /opt/diabeo/backoffice/scripts/backup-postgres.sh \
#     >> /var/log/diabeo-backup.log 2>&1
#
# Exit codes:
#   0  — success
#   1  — missing dependency / env / bucket misconfiguration
#   2  — pg_dump or age failure
#   3  — S3 upload failure (local encrypted file is kept for manual retry)
# =============================================================================

set -euo pipefail

# All files this script creates (encrypted envelope, sha256 manifest) must be
# owner-readable only. The diabeo-backup user is dedicated, but defense in
# depth on a HDS host (CIS Benchmark Linux 5.4.4): a compromised process
# running as another local user must not be able to read backup metadata.
umask 077

# Cleanup partial files on Ctrl-C / SIGTERM / unexpected error. Without this,
# an interrupted pg_dump | age leaves a fresh-mtime file that the
# `find -mtime +N -delete` rotation would never remove.
ENC_FILE=""
SHA_FILE=""
cleanup_partial() {
  local rc=$?
  [[ -n "$ENC_FILE" && -f "$ENC_FILE" && $rc -ne 0 ]] && rm -f "$ENC_FILE"
  [[ -n "$SHA_FILE" && -f "$SHA_FILE" && $rc -ne 0 ]] && rm -f "$SHA_FILE"
}
trap cleanup_partial ERR INT TERM

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
  err "Env file not found: $ENV_FILE (see docs/operations/runbook.md §Manual setup)"
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

for cmd in pg_dump aws sha256sum age; do
  if ! command -v "$cmd" > /dev/null 2>&1; then
    err "Required command not found: $cmd"
    err "Install: apt-get install -y postgresql-client awscli coreutils age"
    exit 1
  fi
done

for v in PG_HOST PG_USER PG_DB \
         OVH_S3_ENDPOINT OVH_S3_ACCESS_KEY OVH_S3_SECRET_KEY OVH_S3_BUCKET \
         AGE_RECIPIENT_PUBLIC_KEY; do
  if [[ -z "${!v-}" ]]; then
    err "Missing env var: $v (check $ENV_FILE)"
    exit 1
  fi
done

# .pgpass is MANDATORY. Reject PGPASSWORD in env to prevent operators from
# regressing to the less safe pattern flagged in the 2026-04-15 HDS audit.
if [[ -n "${PGPASSWORD:-}" ]]; then
  err "PGPASSWORD must not be set. Use ~/.pgpass (chmod 0600) — see runbook."
  exit 1
fi
PGPASSFILE_DEFAULT="${HOME}/.pgpass"
PGPASSFILE="${PGPASSFILE:-$PGPASSFILE_DEFAULT}"
if [[ ! -f "$PGPASSFILE" ]]; then
  err "$PGPASSFILE not found. Create it with the backup user credentials."
  exit 1
fi
# Postgres silently ignores a .pgpass that isn't 0600 → refuse to run.
# GNU stat returns "600" (3 digits), BSD `%Lp` may return "0600" (zero-
# padded). Normalize to last 3 chars so the check is portable.
pgpass_mode_raw=$(stat -c '%a' "$PGPASSFILE" 2>/dev/null || stat -f '%Lp' "$PGPASSFILE")
pgpass_mode="${pgpass_mode_raw: -3}"
if [[ "$pgpass_mode" != "600" ]]; then
  err "$PGPASSFILE must be mode 0600 (current: $pgpass_mode_raw)"
  exit 1
fi
export PGPASSFILE

mkdir -p "$BACKUP_DIR"

ENC_BASENAME="diabeo-${TIMESTAMP}.dump.age"
# Re-assigned (previously declared as empty for the trap cleanup hook).
ENC_FILE="$BACKUP_DIR/$ENC_BASENAME"
SHA_FILE="$BACKUP_DIR/${ENC_BASENAME}.sha256"

export AWS_ACCESS_KEY_ID="$OVH_S3_ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$OVH_S3_SECRET_KEY"
AWS_S3_FLAGS=(--endpoint-url="$OVH_S3_ENDPOINT")

# ----------------------------------------------------------------------------
# 1. Pre-flight — verify bucket is in Object Lock Compliance mode
# ----------------------------------------------------------------------------

log "Verifying bucket Object Lock configuration…"
# Force --output json so the parser is immune to the operator's
# AWS_DEFAULT_OUTPUT (yaml/text would silently bypass a regex check).
# Use python3 (always present on Debian/Ubuntu) for robust JSON parsing.
lock_config=$(AWS_DEFAULT_OUTPUT=json aws "${AWS_S3_FLAGS[@]}" \
  s3api get-object-lock-configuration --output json \
  --bucket "$OVH_S3_BUCKET" 2>/dev/null || echo "null")
lock_mode=$(printf '%s' "$lock_config" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin) or {}
    print(d.get('ObjectLockConfiguration', {}).get('Rule', {}).get('DefaultRetention', {}).get('Mode', 'NONE'))
except Exception:
    print('PARSE_ERROR')
" 2>/dev/null || echo "PARSE_ERROR")
if [[ "$lock_mode" != "COMPLIANCE" ]]; then
  err "Bucket $OVH_S3_BUCKET Object Lock mode is '$lock_mode', expected COMPLIANCE."
  err "HDS requires tamper-evident storage (ISO 27001 A.12.3)."
  err "Enable: OVH console → bucket → Object Lock → Compliance mode."
  exit 1
fi
log "Object Lock: COMPLIANCE ✓"

# ----------------------------------------------------------------------------
# 2. Dump + encrypt — plaintext never touches disk
# ----------------------------------------------------------------------------

log "pg_dump | age -r <recipient> → $ENC_FILE"
if ! pg_dump \
      --host="$PG_HOST" --port="${PG_PORT:-5432}" --username="$PG_USER" \
      --format=custom --jobs=1 --compress=9 \
      "$PG_DB" \
    | age -r "$AGE_RECIPIENT_PUBLIC_KEY" -o "$ENC_FILE"; then
  err "pg_dump | age pipeline failed."
  rm -f "$ENC_FILE"
  exit 2
fi
enc_size=$(du -h "$ENC_FILE" | cut -f1)
log "Encrypted envelope OK ($enc_size) — plaintext never hit disk"

# ----------------------------------------------------------------------------
# 3. Integrity manifest over the envelope (what S3 will actually hold)
# ----------------------------------------------------------------------------

# Compute hash on the encrypted envelope, write the manifest with the
# basename only so `sha256sum -c` works against the file as downloaded
# during a restore drill (without the local path prefix).
# Building the manifest line manually avoids a `( cd && sha256sum )` subshell
# whose `&&` could silently skip the manifest if `cd` failed.
enc_hash=$(sha256sum "$ENC_FILE" | awk '{print $1}')
printf '%s  %s\n' "$enc_hash" "$ENC_BASENAME" > "$SHA_FILE"
log "SHA256 manifest: $(cat "$SHA_FILE")"

# ----------------------------------------------------------------------------
# 4. Upload to OVH (SSE AES256 on top of client-side age encryption)
# ----------------------------------------------------------------------------

S3_KEY="postgres/$(date -u +%Y)/$(date -u +%m)/$ENC_BASENAME"
S3_URI="s3://$OVH_S3_BUCKET/$S3_KEY"
S3_SHA_URI="s3://$OVH_S3_BUCKET/${S3_KEY}.sha256"

log "Uploading envelope → $S3_URI (SSE AES256)"
if ! aws "${AWS_S3_FLAGS[@]}" s3 cp "$ENC_FILE" "$S3_URI" \
  --sse AES256 --only-show-errors; then
  err "S3 upload failed — encrypted envelope kept at $ENC_FILE"
  exit 3
fi
log "Uploading manifest → $S3_SHA_URI"
if ! aws "${AWS_S3_FLAGS[@]}" s3 cp "$SHA_FILE" "$S3_SHA_URI" \
  --sse AES256 --only-show-errors; then
  err "Manifest upload failed — envelope is in S3 but without integrity sidecar"
  exit 3
fi
log "Upload OK (envelope + manifest, both SSE AES256 + Object Lock)"

# ----------------------------------------------------------------------------
# 5. Local rotation (OVH bucket has its own lifecycle rule)
# ----------------------------------------------------------------------------

log "Rotating local envelopes older than $LOCAL_RETENTION_DAYS days"
find "$BACKUP_DIR" -name 'diabeo-*.dump.age*' -mtime "+$LOCAL_RETENTION_DAYS" -print -delete || true

log "Backup complete."
