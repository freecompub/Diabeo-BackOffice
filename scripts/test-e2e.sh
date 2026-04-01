#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# test-e2e.sh — Run Playwright E2E tests with automatic infrastructure setup
#
# Usage:
#   ./scripts/test-e2e.sh          # Run all E2E tests
#   ./scripts/test-e2e.sh --ui     # Open Playwright UI mode
#   ./scripts/test-e2e.sh --setup  # Only setup infra (no tests)
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[e2e]${NC} $1"; }
warn() { echo -e "${YELLOW}[e2e]${NC} $1"; }
err()  { echo -e "${RED}[e2e]${NC} $1" >&2; }

# --------------------------------------------------------------------------
# 1. Check system dependencies for Playwright Chromium
# --------------------------------------------------------------------------
check_playwright_deps() {
  if ! pnpm exec playwright install --dry-run chromium &>/dev/null; then
    log "Installing Playwright Chromium browser..."
    pnpm exec playwright install chromium
  fi

  # Check if system libs are available by trying a quick browser launch
  if ! pnpm exec playwright install-deps --dry-run chromium &>/dev/null 2>&1; then
    warn "System dependencies for Chromium may be missing."
    warn "Run: sudo pnpm exec playwright install-deps chromium"
  fi
}

# --------------------------------------------------------------------------
# 2. Start PostgreSQL via Docker Compose
# --------------------------------------------------------------------------
start_postgres() {
  if docker compose --profile local ps --services --filter "status=running" 2>/dev/null | grep -q postgres; then
    log "PostgreSQL already running."
  else
    log "Starting PostgreSQL via Docker Compose..."
    docker compose --profile local up -d --wait
    log "PostgreSQL is ready."
  fi
}

# --------------------------------------------------------------------------
# 3. Generate .env.test if needed, then symlink as .env
# --------------------------------------------------------------------------
setup_env() {
  local ENV_TEST="$PROJECT_DIR/.env.test"

  if [ ! -f "$ENV_TEST" ]; then
    log "Generating .env.test with test-safe values..."

    local SECRET
    SECRET=$(openssl rand -base64 32)
    local ENCRYPTION_KEY
    ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    local HMAC_SECRET
    HMAC_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

    cat > "$ENV_TEST" <<ENVEOF
# Auto-generated for E2E tests — DO NOT COMMIT
DATABASE_URL="postgresql://diabeo:password@localhost:5432/diabeo?schema=public"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="$SECRET"
AUTH_SECRET="$SECRET"
HEALTH_DATA_ENCRYPTION_KEY="$ENCRYPTION_KEY"
HMAC_SECRET="$HMAC_SECRET"
NODE_ENV="test"
ENVEOF

    log ".env.test generated."
  else
    log ".env.test already exists."
  fi

  # Symlink .env -> .env.test (only if .env doesn't exist or is already a symlink)
  if [ -L "$PROJECT_DIR/.env" ]; then
    rm "$PROJECT_DIR/.env"
    ln -s "$ENV_TEST" "$PROJECT_DIR/.env"
  elif [ ! -f "$PROJECT_DIR/.env" ]; then
    ln -s "$ENV_TEST" "$PROJECT_DIR/.env"
  else
    warn ".env exists and is not a symlink — using it as-is."
    warn "To use test config: rm .env && ln -s .env.test .env"
  fi
}

# --------------------------------------------------------------------------
# 4. Generate Prisma client + run migrations
# --------------------------------------------------------------------------
setup_prisma() {
  log "Generating Prisma client..."
  pnpm prisma generate --no-hints 2>&1 | tail -1

  log "Applying migrations..."
  pnpm prisma migrate deploy 2>&1 | tail -3

  log "Database ready."
}

# --------------------------------------------------------------------------
# 5. Seed test data
# --------------------------------------------------------------------------
seed_data() {
  log "Seeding test data..."
  pnpm prisma db seed 2>&1 | tail -1
  log "Seed complete."
}

# --------------------------------------------------------------------------
# 6. Run Playwright tests
# --------------------------------------------------------------------------
run_tests() {
  local ARGS=("$@")
  log "Running Playwright E2E tests..."
  pnpm exec playwright test "${ARGS[@]}"
}

# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
main() {
  local SETUP_ONLY=false
  local PW_ARGS=()

  for arg in "$@"; do
    case "$arg" in
      --setup) SETUP_ONLY=true ;;
      --ui)    PW_ARGS+=("--ui") ;;
      *)       PW_ARGS+=("$arg") ;;
    esac
  done

  log "Setting up E2E test infrastructure..."
  echo ""

  check_playwright_deps
  start_postgres
  setup_env
  setup_prisma
  seed_data

  echo ""
  log "Infrastructure ready."

  if [ "$SETUP_ONLY" = true ]; then
    log "Setup complete (--setup mode). Skipping tests."
    exit 0
  fi

  echo ""
  run_tests "${PW_ARGS[@]}"
}

main "$@"
