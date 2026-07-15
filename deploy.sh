#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# deploy.sh — script de déploiement Diabeo Backoffice (VPS OVHcloud)
#
# Script de RÉFÉRENCE, versionné avec le code. À adapter à ton VPS (chemins,
# nom du service systemd, outil S3). Modèle : Next.js (Node 22) derrière nginx,
# PostgreSQL 16, Redis Upstash + OVH Object Storage managés. Déploiement manuel.
#
#   ./deploy.sh update    # pull + install + prisma generate + migrate deploy + build + restart
#   ./deploy.sh migrate   # prisma migrate deploy uniquement (+ status)
#   ./deploy.sh backup    # pg_dump gzip → OVH Object Storage
#   ./deploy.sh status    # santé service + DB + migrations
#
# Prérequis : /etc/diabeo/${APP_ENV}.env (chmod 600) contenant TOUTES les vars
# obligatoires (cf. docs/runbook/vps-setup.md + src/lib/env.ts).
# ═══════════════════════════════════════════════════════════════════════════
set -Eeuo pipefail

# ── Config (à adapter) ──────────────────────────────────────────────────────
APP_DIR="${APP_DIR:-/opt/diabeo}"
APP_ENV="${APP_ENV:-recette}"
ENV_FILE="${ENV_FILE:-/etc/diabeo/${APP_ENV}.env}"
SERVICE="${SERVICE:-diabeo-${APP_ENV}}"          # unité systemd
GIT_REF="${GIT_REF:-main}"
S3_BUCKET_BACKUPS="${S3_BUCKET_BACKUPS:-diabeo-backups-${APP_ENV}}"

log()  { printf '\033[36m[deploy]\033[0m %s\n' "$*"; }
fail() { printf '\033[31m[deploy][ERREUR]\033[0m %s\n' "$*" >&2; exit 1; }

load_env() {
  [ -f "$ENV_FILE" ] || fail "Fichier d'env introuvable : $ENV_FILE"
  set -a; # shellcheck disable=SC1090
  source "$ENV_FILE"; set +a
  : "${DATABASE_URL:?DATABASE_URL manquant dans $ENV_FILE}"
}

cmd_update() {
  load_env
  cd "$APP_DIR"
  log "Pull $GIT_REF"
  git fetch --quiet origin "$GIT_REF"
  git checkout --quiet "$GIT_REF"
  git reset --hard --quiet "origin/$GIT_REF"

  log "Install (frozen lockfile)"
  pnpm install --frozen-lockfile

  log "Prisma generate"
  pnpm prisma generate

  # ⚠️ Migrations AVANT le build/restart : le nouveau code peut dépendre du
  #    nouveau schéma. Pour une release à migration DESTRUCTIVE (ex. glycémie
  #    g/L, DROP glycemia_mgdl), passer d'abord le pré-vol + backup :
  #    ./deploy.sh backup && psql "$DATABASE_URL" -f ops/preflight/<...>.sql
  log "Migrations (prisma migrate deploy — idempotent)"
  pnpm prisma migrate deploy

  log "Build (next build)"
  pnpm build

  log "Restart service $SERVICE"
  sudo systemctl restart "$SERVICE"

  cmd_status
  log "✅ Déploiement terminé."
}

cmd_migrate() {
  load_env
  cd "$APP_DIR"
  pnpm prisma migrate deploy
  pnpm prisma migrate status
}

cmd_backup() {
  load_env
  local ts stamp dump
  ts="$(date -u +%Y/%m/%d)"; stamp="$(date -u +%H%M%S)"
  dump="/tmp/diabeo-${APP_ENV}-${stamp}.sql.gz"
  log "pg_dump → $dump"
  pg_dump "$DATABASE_URL" | gzip -9 > "$dump" || fail "pg_dump a échoué"
  # Upload S3 (OVH). Adapter à ton outil (aws-cli/rclone/s3cmd) et tes creds S3.
  if command -v aws >/dev/null; then
    log "Upload s3://${S3_BUCKET_BACKUPS}/${ts}/"
    aws --endpoint-url "${OVH_S3_ENDPOINT:?}" s3 cp "$dump" \
      "s3://${S3_BUCKET_BACKUPS}/${ts}/diabeo-backup-${stamp}.sql.gz"
  else
    log "aws-cli absent — dump laissé sur $dump (uploader manuellement)."
  fi
  log "✅ Backup OK."
}

cmd_status() {
  load_env
  cd "$APP_DIR"
  log "Service :"; systemctl is-active "$SERVICE" || true
  log "Postgres :"; pg_isready -d "$DATABASE_URL" || true
  log "Migrations :"; pnpm prisma migrate status || true
}

case "${1:-}" in
  update)  cmd_update ;;
  migrate) cmd_migrate ;;
  backup)  cmd_backup ;;
  status)  cmd_status ;;
  *) echo "Usage: $0 {update|migrate|backup|status}"; exit 2 ;;
esac
