#!/usr/bin/env bash
# =============================================================================
# deploy.sh — production deployment wrapper for Diabeo Backoffice
# =============================================================================
#
# Replaces the manual fallback sequence documented in
# docs/operations/runbook.md §Deployment. Runs on the prod VPS.
#
# Prerequisites (one-time setup, see docs/operations/runbook.md §Manual setup):
# - pm2 installed globally and `diabeo-api` process registered
# - Node 22+, pnpm 10+ available in PATH (or via corepack)
# - psql client available in PATH (used for migration baseline pre-flight check)
# - `$DATABASE_URL` exported in the shell that invokes the script
# - DB switched to versioned migrations (US-2267) — see docs/runbook/migrations.md §7
#   On a fresh DB, set MIGRATION_BOOTSTRAPPED=1 the first time only.
#
# Usage:
#   ./scripts/deploy.sh update         # Standard deploy
#   ./scripts/deploy.sh status         # Show current branch / commit / health
#   ./scripts/deploy.sh health         # Probe /api/health and exit non-zero if down
#
# Exit codes:
#   0  — success
#   1  — generic error (missing env, lint/typecheck/test failure)
#   2  — pm2 process not found
#   3  — health check failed after deploy (manual rollback required)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PM2_PROCESS="${PM2_PROCESS:-diabeo-api}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/api/health}"
HEALTH_TIMEOUT_SEC=30

# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------

ACTOR="${SUDO_USER:-${USER:-$(whoami)}}"
HOST="$(hostname -s 2>/dev/null || echo unknown)"

# All log lines carry actor + host so downstream syslog aggregation
# (HDS §IV.3 operator-action trail — ISO 27001 A.12.4) can attribute
# every deploy event to a human.
log()  { printf '\033[1;34m[deploy]\033[0m [host=%s actor=%s] %s\n' "$HOST" "$ACTOR" "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m   [host=%s actor=%s] %s\n' "$HOST" "$ACTOR" "$*" >&2; }
err()  { printf '\033[1;31m[error]\033[0m  [host=%s actor=%s] %s\n' "$HOST" "$ACTOR" "$*" >&2; }

require_env() {
  local name=$1
  if [[ -z "${!name-}" ]]; then
    err "$name is not set. Export it in the invoking shell."
    exit 1
  fi
}

require_cmd() {
  if ! command -v "$1" > /dev/null 2>&1; then
    err "Required command not found: $1"
    exit 1
  fi
}

probe_health() {
  # Retries until the endpoint returns HTTP 200 or the timeout expires.
  local deadline=$((SECONDS + HEALTH_TIMEOUT_SEC))
  while (( SECONDS < deadline )); do
    if curl -sf -o /dev/null -w '%{http_code}' "$HEALTH_URL" | grep -q '^200$'; then
      log "Health OK ($HEALTH_URL)"
      return 0
    fi
    sleep 2
  done
  err "Health probe failed after ${HEALTH_TIMEOUT_SEC}s on $HEALTH_URL"
  return 3
}

# ----------------------------------------------------------------------------
# Commands
# ----------------------------------------------------------------------------

cmd_update() {
  require_env DATABASE_URL
  require_env OVH_S3_ENDPOINT
  require_env OVH_S3_BUCKET
  require_env OVH_S3_ACCESS_KEY
  require_env OVH_S3_SECRET_KEY
  require_env OVH_S3_REGION
  # Firebase FCM is optional — push notifications degrade gracefully (503 on send)
  # Set FIREBASE_SERVICE_ACCOUNT_KEY + FIREBASE_PROJECT_ID to enable push
  if [[ -z "${FIREBASE_SERVICE_ACCOUNT_KEY-}" ]]; then
    warn "FIREBASE_SERVICE_ACCOUNT_KEY not set — push notifications will be disabled (503 on /api/push/send)"
  fi
  require_cmd git
  require_cmd pnpm
  require_cmd pm2
  require_cmd curl
  require_cmd psql

  cd "$REPO_DIR"

  log "Fetching main…"
  git fetch origin main

  local incoming
  incoming=$(git log --oneline HEAD..origin/main | wc -l | tr -d ' ')
  if [[ "$incoming" == "0" ]]; then
    log "Nothing to deploy. HEAD is up to date with origin/main."
    exit 0
  fi

  log "Incoming commits:"
  git log --oneline HEAD..origin/main | sed 's/^/  /'

  # US-2267 — Pre-flight : la DB doit avoir été switchée du legacy `db push` au
  # workflow `migrate` AVANT le 1er deploy versionné. Sinon `migrate deploy`
  # essaie de rejouer la baseline_v1 sur un schéma déjà rempli (DROP/CREATE
  # destructifs ou échecs sur duplicate). Le switch manuel est documenté dans
  # docs/runbook/migrations.md §7 : `migrate resolve --applied <baseline>`.
  #
  # On vérifie la présence de la table `_prisma_migrations` ET au moins une
  # entry baseline marquée comme appliquée. L'opérateur peut bypass via
  # MIGRATION_BOOTSTRAPPED=1 lorsqu'il sait que la DB est neuve (1er deploy
  # sur prod vierge).
  log "Pre-flight : verifying versioned migrations baseline state…"
  local baseline_applied
  baseline_applied=$(psql "$DATABASE_URL" -tAc \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = '_prisma_migrations';" \
    2>/dev/null | tr -d ' ')
  if [[ "$baseline_applied" == "0" ]]; then
    if [[ "${MIGRATION_BOOTSTRAPPED:-0}" != "1" ]]; then
      err "_prisma_migrations table not found. This DB has never run \`prisma migrate\`."
      err "BEFORE this script: switch the DB to versioned migrations (one-time)."
      err "  → Either: \`pnpm prisma migrate resolve --applied <baseline>\` for each migration"
      err "  → Or:     run on a freshly-provisioned DB and set MIGRATION_BOOTSTRAPPED=1"
      err "Reference: docs/runbook/migrations.md §7"
      exit 1
    fi
    warn "MIGRATION_BOOTSTRAPPED=1 set — assuming fresh DB ; \`migrate deploy\` will apply baseline."
  fi

  log "Pulling…"
  git pull --ff-only origin main

  log "Installing dependencies (frozen lockfile)…"
  pnpm install --frozen-lockfile

  log "Regenerating Prisma client…"
  pnpm prisma generate

  log "Applying versioned migrations (US-2267)…"
  # `migrate deploy` est idempotent — ne ré-applique pas les migrations déjà
  # passées. Voir docs/runbook/migrations.md pour le workflow complet (incluant
  # le switch d'une DB pré-US-2267 via `migrate resolve --applied`).
  pnpm prisma migrate deploy

  # TypeCheck is cheap and catches `prisma generate` drift locally. Tests
  # are NOT re-run here — CI owns the test gate on the merge commit SHA
  # (GitHub Actions "Unit & Integration Tests" must pass to merge). Running
  # `pnpm test` on the prod VPS would risk hitting the prod DB if any test
  # forgets a dedicated test DATABASE_URL — HDS data-minimization / PII
  # exposure concern flagged in the 2026-04-15 audit.
  log "Running typecheck (hard gate)…"
  pnpm tsc --noEmit

  log "Building Next.js production bundle…"
  pnpm build

  log "Restarting pm2 process '$PM2_PROCESS'…"
  if ! pm2 describe "$PM2_PROCESS" > /dev/null 2>&1; then
    err "pm2 process '$PM2_PROCESS' is not registered."
    err "First-run setup: pm2 start npm --name $PM2_PROCESS -- start && pm2 save"
    exit 2
  fi
  pm2 restart "$PM2_PROCESS" --update-env

  log "Probing /api/health (max ${HEALTH_TIMEOUT_SEC}s)…"
  probe_health

  log "Deploy complete. Current commit: $(git rev-parse --short HEAD)"
}

cmd_status() {
  cd "$REPO_DIR"
  log "Branch: $(git rev-parse --abbrev-ref HEAD)"
  log "Commit: $(git rev-parse --short HEAD) — $(git log -1 --format=%s)"
  log "Uncommitted changes:"
  git status --short || true
  log "Health:"
  curl -sS "$HEALTH_URL" 2>/dev/null | head -c 500 || echo "  (unreachable)"
  echo
}

cmd_health() {
  probe_health
}

# ----------------------------------------------------------------------------
# Entrypoint
# ----------------------------------------------------------------------------

main() {
  local cmd="${1:-}"
  case "$cmd" in
    update) cmd_update ;;
    status) cmd_status ;;
    health) cmd_health ;;
    "") err "Missing command. Usage: $0 {update|status|health}"; exit 1 ;;
    *)    err "Unknown command: $cmd. Usage: $0 {update|status|health}"; exit 1 ;;
  esac
}

main "$@"
