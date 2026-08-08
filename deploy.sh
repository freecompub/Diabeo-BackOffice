#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# deploy.sh — script de déploiement Diabeo Backoffice (VPS OVHcloud)
#
# Script de RÉFÉRENCE, versionné avec le code. À adapter à ton VPS (chemins,
# nom du service systemd, outil S3). Modèle : Next.js (Node 22) derrière nginx,
# PostgreSQL 16, Redis Upstash + OVH Object Storage managés. Déploiement manuel
# OU via le runner self-hosted (CD recette, cf. docs/runbook/cd-recette.md).
#
#   ./deploy.sh update    # pull + install + generate + migrate deploy + build + restart + health
#   ./deploy.sh migrate   # prisma migrate deploy uniquement (+ status)
#   ./deploy.sh backup    # pg_dump gzip → OVH Object Storage
#   ./deploy.sh status    # santé service + DB + migrations
#   ./deploy.sh health    # sonde /api/health (exit ≠ 0 si l'app ne répond pas)
#
# Prérequis : /etc/diabeo/${APP_ENV}.env (chmod 600) contenant TOUTES les vars
# obligatoires (cf. docs/runbook/vps-setup.md + src/lib/env.ts).
#
# 1er déploiement sur une DB vierge : exporter MIGRATION_BOOTSTRAPPED=1 une seule
# fois (le garde bootstrap refuse sinon de migrer une DB jamais initialisée en
# migrations versionnées — cf. docs/runbook/migrations.md §7).
#
# Codes de sortie : 0 succès · 1 erreur générique · 3 sonde /api/health en échec.
# ═══════════════════════════════════════════════════════════════════════════
set -Eeuo pipefail

# ── Config (à adapter) ──────────────────────────────────────────────────────
APP_DIR="${APP_DIR:-/opt/diabeo}"
APP_ENV="${APP_ENV:-recette}"
ENV_FILE="${ENV_FILE:-/etc/diabeo/${APP_ENV}.env}"
SERVICE="${SERVICE:-diabeo-${APP_ENV}}"          # unité systemd
GIT_REF="${GIT_REF:-main}"
S3_BUCKET_BACKUPS="${S3_BUCKET_BACKUPS:-diabeo-backups-${APP_ENV}}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/api/health}"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-30}"
# Dead-man's-switch backup (optionnel) : URL de ping Healthchecks.io (ou compatible).
# Vide = désactivé. Si renseignée : ping /start au début, base=succès, /fail à l'échec
# → alerte si le backup n'a PAS tourné. Cf. docs/runbook/supervision.md.
BACKUP_PING_URL="${BACKUP_PING_URL:-}"

log()  { printf '\033[36m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[deploy][WARN]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[31m[deploy][ERREUR]\033[0m %s\n' "$*" >&2; exit 1; }

# DATABASE_URL porte `?schema=public` (paramètre PRISMA, PAS libpq) : psql et
# pg_isready le rejettent (« invalid URI query parameter: schema »). Cette forme
# sans query string est utilisée pour les outils libpq ; Prisma, lui, garde l'URL
# complète. Renseignée par load_env.
DB_URL_LIBPQ=""

load_env() {
  [ -f "$ENV_FILE" ] || fail "Fichier d'env introuvable : $ENV_FILE"
  set -a; # shellcheck disable=SC1090
  source "$ENV_FILE"; set +a
  : "${DATABASE_URL:?DATABASE_URL manquant dans $ENV_FILE}"
  DB_URL_LIBPQ="${DATABASE_URL%%\?*}"   # retire ?schema=… pour psql/pg_isready
}

# Sonde /api/health avec retry jusqu'au timeout. Distingue :
#  - 200            → OK (app saine) ;
#  - 503 persistant → app UP mais dépendance dégradée (Redis ?) : WARN, non fatal
#    (un blip Upstash ne doit pas faire échouer un déploiement dont l'app tourne) ;
#  - aucune réponse → app pas remontée : ÉCHEC (exit 3).
probe_health() {
  command -v curl >/dev/null || { warn "curl absent — sonde health ignorée."; return 0; }
  local deadline=$((SECONDS + HEALTH_TIMEOUT_SEC)) code last=""
  while (( SECONDS < deadline )); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" 2>/dev/null || true)"
    if [[ "$code" == "200" ]]; then log "Health OK (200 — $HEALTH_URL)"; return 0; fi
    [[ -n "$code" && "$code" != "000" ]] && last="$code"
    sleep 2
  done
  if [[ "$last" == "503" ]]; then
    warn "Health dégradé (503) après ${HEALTH_TIMEOUT_SEC}s — app UP mais dépendance down (Redis ?). Déploiement NON échoué ; à investiguer."
    return 0
  fi
  printf '\033[31m[deploy][ERREUR]\033[0m Sonde /api/health en échec après %ss sur %s (dernier code : %s)\n' \
    "$HEALTH_TIMEOUT_SEC" "$HEALTH_URL" "${last:-aucune réponse}" >&2
  exit 3
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

  # Garde bootstrap (US-2267) : refuse de migrer une DB jamais initialisée en
  # migrations versionnées (sinon `migrate deploy` tenterait de rejouer la
  # baseline sur un schéma legacy `db push` → destructif/échec). 1er deploy sur
  # DB vierge → exporter MIGRATION_BOOTSTRAPPED=1. Cf. docs/runbook/migrations.md §7.
  if command -v psql >/dev/null; then
    local has_mig
    has_mig="$(psql "$DB_URL_LIBPQ" -tAc \
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='_prisma_migrations';" \
      2>/dev/null | tr -d ' ')"
    if [[ "$has_mig" == "0" && "${MIGRATION_BOOTSTRAPPED:-0}" != "1" ]]; then
      fail "_prisma_migrations absente : DB jamais initialisée en migrations versionnées. DB vierge → relancer avec MIGRATION_BOOTSTRAPPED=1 ; DB legacy → switch via 'prisma migrate resolve --applied' (docs/runbook/migrations.md §7)."
    fi
    [[ "$has_mig" == "0" ]] && warn "MIGRATION_BOOTSTRAPPED=1 — DB vierge supposée ; migrate deploy appliquera la baseline."
  else
    warn "psql absent — garde bootstrap _prisma_migrations non vérifiée."
  fi

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

  log "Sonde /api/health (max ${HEALTH_TIMEOUT_SEC}s)"
  probe_health

  cmd_status
  log "✅ Déploiement terminé."
}

cmd_migrate() {
  load_env
  cd "$APP_DIR"
  pnpm prisma migrate deploy
  pnpm prisma migrate status
}

# Ping du dead-man's-switch. $1 = suffixe (start|fail|"" pour succès). No-op si
# BACKUP_PING_URL vide ou curl absent ; jamais fatal (ne casse pas le backup).
ping_backup() {
  [ -n "$BACKUP_PING_URL" ] || return 0
  command -v curl >/dev/null || return 0
  curl -fsS -m 10 -o /dev/null "${BACKUP_PING_URL}${1:+/$1}" || true
}

# Trap EXIT (posé par cmd_backup) : pinge succès si BACKUP_DONE=1, sinon /fail.
# Fire aussi bien sur `fail` (exit 1) que sur fin normale → alerte fiable.
on_backup_exit() {
  if [ "${BACKUP_DONE:-0}" = 1 ]; then ping_backup; else ping_backup fail; fi
}

cmd_backup() {
  load_env
  BACKUP_DONE=0
  ping_backup start
  trap on_backup_exit EXIT
  local ts stamp dump
  ts="$(date -u +%Y/%m/%d)"; stamp="$(date -u +%H%M%S)"
  dump="/tmp/diabeo-${APP_ENV}-${stamp}.sql.gz"
  log "pg_dump → $dump"
  pg_dump "$DB_URL_LIBPQ" | gzip -9 > "$dump" || fail "pg_dump a échoué"
  # Upload S3 (OVH). Adapter à ton outil (aws-cli/rclone/s3cmd) et tes creds S3.
  if command -v aws >/dev/null; then
    log "Upload s3://${S3_BUCKET_BACKUPS}/${ts}/"
    aws --endpoint-url "${OVH_S3_ENDPOINT:?}" s3 cp "$dump" \
      "s3://${S3_BUCKET_BACKUPS}/${ts}/diabeo-backup-${stamp}.sql.gz" || fail "upload S3 a échoué"
  else
    log "aws-cli absent — dump laissé sur $dump (uploader manuellement)."
  fi
  BACKUP_DONE=1            # succès → le trap EXIT pinge le succès
  log "✅ Backup OK."
}

cmd_status() {
  load_env
  cd "$APP_DIR"
  log "Service :"; systemctl is-active "$SERVICE" || true
  log "Postgres :"; pg_isready -d "$DB_URL_LIBPQ" || true
  log "Migrations :"; pnpm prisma migrate status || true
}

cmd_health() {
  load_env
  probe_health
}

case "${1:-}" in
  update)  cmd_update ;;
  migrate) cmd_migrate ;;
  backup)  cmd_backup ;;
  status)  cmd_status ;;
  health)  cmd_health ;;
  *) echo "Usage: $0 {update|migrate|backup|status|health}"; exit 2 ;;
esac
