# Operational Runbook

Day-to-day operations playbook for the Diabeo Backoffice on OVHcloud GRA
(Docker Compose + managed PostgreSQL + Upstash Redis + Object Storage).

> **Audience**: on-call engineers. Assumes SSH access to the VPS, `gh` CLI
> authentication, and access to the shared 1Password vault for secrets.
>
> **Status markers**: sections tagged **[TODO — not yet implemented]** describe
> target procedures; the referenced scripts / endpoints do NOT exist yet.
> See [scripts-index.md](./scripts-index.md) for implementation status.
> Operators: do NOT rely on those sections in an incident — fall back to
> manual `git pull` + `pnpm build` until the scripts are shipped.

- [Environments](#environments)
- [Deployment](#deployment)
- [Rollback](#rollback)
- [Database migrations](#database-migrations)
- [Backups](#backups)
- [Secrets](#secrets)
- [Monitoring](#monitoring)
- [Routine maintenance](#routine-maintenance)
- [Manual setup checklist](#manual-setup-checklist)

---

## Environments

| Environment | URL                      | Purpose                              |
|-------------|--------------------------|--------------------------------------|
| Production  | `app.diabeo.fr`          | Live patient traffic (HDS)           |
| Recette     | `staging.diabeo.fr`      | Pre-prod validation + MyDiabby sync  |
| Local       | `localhost:3000`         | Dev loop, `pnpm dev` + Docker Compose `--profile local` |

Each env has its own:

- PostgreSQL instance (OVH managed DB in prod/recette, local container in dev).
- Upstash Redis (free tier for recette, paid tier for prod).
- Object Storage bucket (`diabeo-prod-documents`, `diabeo-staging-documents`).
- Env-file (`.env.production`, `.env.staging`) — never committed.

---

## Deployment

### Prerequisites

- Main branch green on GitHub Actions (E2E + unit + lint/typecheck).
- Every migration listed in `prisma/sql/` that is not yet applied has been
  reviewed with SQL-pro and medical-domain-validator agents.
- ChangeLog updated for the release.

### Standard deploy (prod)

`scripts/deploy.sh` ships in-repo. Complete the [Manual setup
checklist](#manual-setup-checklist) once per host before the first run.

```sh
ssh diabeo@app.diabeo.fr

cd /opt/diabeo/backoffice
git fetch origin main
git log HEAD..origin/main --oneline   # review incoming commits

# Apply any raw SQL migrations FIRST (Prisma db push will fail otherwise
# for column type changes like VARCHAR → enum).
psql $DATABASE_URL < prisma/sql/<new_migration>.sql

# Pull + build + swap containers
./scripts/deploy.sh update     # [TODO]

# Health check (endpoint exists — implemented in PR #107)
curl -sf https://app.diabeo.fr/api/health || echo "DEPLOY FAILED"
```

`scripts/deploy.sh update` runs, in order:

1. `git fetch origin main` + warns on any new `prisma/sql/*.sql` (operator
   must apply those with `psql` BEFORE acknowledging via `APPLIED_SQL=1`)
2. `git pull --ff-only origin main`
3. `pnpm install --frozen-lockfile`
4. `pnpm prisma generate`
5. `pnpm prisma db push --accept-data-loss=false`
6. `pnpm tsc --noEmit` + `pnpm test` (hard gate)
7. `pnpm build`
8. `pm2 restart $PM2_PROCESS --update-env`
9. Health probe on `/api/health` with up to 30 s retry window

Exit code 3 means the health probe failed — manual rollback required
(see [Rollback](#rollback)).

### Emergency hotfix (skipping CI)

**Not allowed** without an explicit on-call incident ticket. If absolutely
necessary:

```sh
git cherry-pick <hotfix-sha>
./scripts/deploy.sh update
# Open a post-mortem issue within 24 h.
```

---

## Rollback

### Fast rollback (same day, no schema change)

```sh
ssh diabeo@app.diabeo.fr
cd /opt/diabeo/backoffice
git reset --hard <previous-sha>
./scripts/deploy.sh update
```

Uses the same build pipeline; takes ~2 min.

### Rollback across a migration

If the deploy that introduced the issue also ran a migration, you **cannot**
simply `git reset` the code — the DB is still on the new schema.

Steps:

1. Check `prisma/sql/` for the migration that landed in the bad release.
2. Write a manual rollback script (never relies on Prisma to generate it —
   Prisma `db push` is forward-only on the POC). Place in
   `prisma/sql/rollback_<migration_name>.sql`.
3. Apply the rollback: `psql $DATABASE_URL < prisma/sql/rollback_<name>.sql`.
4. `git reset --hard <previous-sha>` then `./scripts/deploy.sh update`.

**Safe migrations** (additive, nullable columns, additive enum values, new
indexes) do not require a rollback script — the app code simply stops using
the new column.

**Unsafe migrations** (column drops, type conversions, NOT NULL additions,
enum value removals) MUST ship with a rollback script reviewed during PR.

---

## Database migrations

The project uses `prisma db push` for the POC phase — no Prisma migrations
directory. Column-type changes, enum additions, and any operation Prisma
can't infer from the schema are hand-written in `prisma/sql/`:

| File                           | Purpose                                            |
|--------------------------------|----------------------------------------------------|
| `audit_immutability.sql`       | Postgres trigger preventing UPDATE/DELETE on `audit_logs` (HDS §IV.3) |
| `cgm_partitioning.sql`         | Monthly partitions on `cgm_entries` — applied before seeding |
| `basal_config_check.sql`       | Check constraints on basal dose fields             |
| `patient_insulin_constraints.sql` | Referential + range constraints on therapy settings |
| `period_type_enum.sql`         | `AverageData.periodType` VARCHAR → enum (PR #105)  |
| `audit_log_request_id.sql`     | `AuditLog.requestId` column + index (PR #105)      |
| `mfa_hardening.sql`            | `User.mfaLastUsedStep` + `Session.mfaVerified` (PR #106) |

**Apply order** on a fresh env:

```sh
pnpm prisma db push             # creates all tables
psql $DATABASE_URL < prisma/sql/audit_immutability.sql
psql $DATABASE_URL < prisma/sql/cgm_partitioning.sql
psql $DATABASE_URL < prisma/sql/basal_config_check.sql
psql $DATABASE_URL < prisma/sql/patient_insulin_constraints.sql
psql $DATABASE_URL < prisma/sql/period_type_enum.sql
psql $DATABASE_URL < prisma/sql/audit_log_request_id.sql
psql $DATABASE_URL < prisma/sql/mfa_hardening.sql
```

---

## Backups

### PostgreSQL

- **Automatic**: OVH managed DB takes daily snapshots retained for 30 days.
- **Application-level** (belt and suspenders):

```sh
# Full dump with COPY format — fastest restore
pg_dump \
  --host=$PG_HOST --port=5432 --username=$PG_USER \
  --format=custom --jobs=4 --compress=9 \
  --file=/backups/diabeo-$(date +%Y%m%d-%H%M).dump \
  $PG_DB
```

Cron: `0 2 * * * /opt/diabeo/backoffice/scripts/backup-postgres.sh >> /var/log/diabeo-backup.log 2>&1`.
Setup steps in [Manual setup checklist](#manual-setup-checklist).

Backups are rsync'd to OVH Object Storage bucket `diabeo-backups-prod`
with 7-day lifecycle to Glacier tier.

### Redis (Upstash)

No backups needed — Redis holds only:

- Rate-limit counters (ephemeral, max 1 h TTL)
- Session-revocation keys (ephemeral, JWT TTL-bound)
- GDPR consent cache (60-300 s TTL, rebuildable from DB)

A total Redis loss → degraded-mode behavior (fail-closed on export,
fail-open on analytics) until keys repopulate from DB reads.

### Object Storage (OVH)

Bucket versioning enabled with 30-day retention. Object lock on the
`immutable/` prefix (used for backups + archived audit export bundles).

### Restore drill

**Run quarterly.** On the recette env:

```sh
# Fetch the most recent backup from Object Storage
aws --endpoint-url=$OVH_S3 s3 cp \
  s3://diabeo-backups-prod/diabeo-$(date +%Y%m%d)*.dump /tmp/

# Fresh DB
dropdb diabeo_restore; createdb diabeo_restore
pg_restore --dbname=diabeo_restore --jobs=4 /tmp/diabeo-*.dump

# Smoke: count critical tables
psql diabeo_restore -c "SELECT COUNT(*) FROM audit_logs;"
psql diabeo_restore -c "SELECT COUNT(*) FROM users;"

# Validate encryption keys still decrypt fields — see §Manual setup checklist
DATABASE_URL=postgres://...diabeo_restore \
HEALTH_DATA_ENCRYPTION_KEY=<hex32> \
HMAC_SECRET=smoke \
pnpm tsx scripts/decrypt-smoke.ts
```

Document the drill outcome in `docs/operations/drill-log.md` (log file to
be created on first drill).

---

## Secrets

Stored in OVH Secret Manager (prod/recette) and synced to the VPS as
Docker secrets (files mounted at `/run/secrets/<name>`).

| Secret                        | Purpose                          | Rotation         |
|-------------------------------|----------------------------------|------------------|
| `JWT_PRIVATE_KEY` / `PUBLIC_KEY` | JWT RS256 signing               | Annually — see Key rotation |
| `HEALTH_DATA_ENCRYPTION_KEY`  | AES-256-GCM for PII/PHI/MFA      | Never in POC; rotate on compromise |
| `HMAC_SECRET`                 | Email lookup HMAC                | Never (stability requirement) |
| `UPSTASH_REDIS_REST_URL/TOKEN`| Cache + rate limit + revocation  | When Upstash rotates |
| `DATABASE_URL`                | PostgreSQL connection string     | When DB password rotates |
| `OVH_S3_ACCESS/SECRET_KEY`    | Object Storage (photos, backups) | On credential leak |

### Key rotation — JWT

1. Generate new keypair: `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048`.
2. Deploy with BOTH keys configured; verifier accepts either; signer uses new.
3. Wait 15 min (max JWT TTL) for all issued tokens to expire.
4. Remove the old key from env; redeploy.

**Do not rotate during peak hours**. Plan for Sunday 02:00 CET.

### Key rotation — AES at-rest

Never in POC. When the user count justifies it, ship an encryption-version
prefix (`v1:<iv>:<tag>:<ciphertext>`) in `crypto/health-data.ts` and
migrate encrypted columns one batch at a time.

---

## Monitoring

### Health endpoint

`GET /api/health` (public, no auth — middleware skips it) returns:

```json
{
  "status": "ok" | "degraded" | "down",
  "db": "ok" | "down",
  "redis": "ok" | "down",
  "version": "a675b99"
}
```

Semantics:

- **`ok`** (HTTP 200) — DB + Redis both reachable within 1 s each.
- **`degraded`** (HTTP 503) — DB OK, Redis probe failed. App continues but
  rate-limit falls back to in-memory and session revocation is fail-closed.
- **`down`** (HTTP 503) — DB probe failed. Nothing works; alert loudly.

Implementation: `src/app/api/health/route.ts`. Version comes from the
`GIT_COMMIT_SHA` env var set during the Docker build.

**Liveness caveat** — the DB probe is `SELECT 1` through the Prisma
connection pool. A successful response means "a pool connection is live",
not "the primary is writable". During a managed-DB failover the pool may
reuse a read-only replica; `db: ok` would still be reported while writes
would fail. If write health matters for a specific procedure, run a
dedicated scratch-table write from the on-call box. Tracked in
[scripts-index.md](./scripts-index.md) as a TODO.

**Redis signals**:

- `redis: ok` — Upstash reachable, probe returned within 1 s.
- `redis: down` — Upstash env set but probe failed or timed out.
- `redis: disabled` — `UPSTASH_REDIS_REST_URL` or `TOKEN` missing. Indicates
  a mis-provisioned deployment; the in-memory fallback is still active but
  rate-limit / session-revocation behave as single-pod.

Watchers — **[TODO — not yet configured]**:

- **OVH Cloud Monitoring** should ping `/api/health` every 30 s and alert
  on non-200 for 3 consecutive checks.
- **Upstash Dashboard** should alert on eval error rate > 1 %.

Neither alert rule has been provisioned yet — tracked in
[scripts-index.md](./scripts-index.md).

### Logs

Production logs ship to OVH Logs Data Platform via the Docker logging
driver (JSON format). Query using `requestId` to trace a request end-to-end:

```
{ scope=~"auth/.+", requestId="abc12345" }
```

Retention: 90 days (HDS minimum §III.2).

### Audit events (HDS)

Query the `audit_logs` table directly for forensic investigations:

```sql
SELECT * FROM audit_logs
WHERE user_id = $1
  AND created_at >= NOW() - INTERVAL '30 days'
ORDER BY created_at DESC;
```

Requests with a known `requestId` can be joined with log lines:

```sql
SELECT * FROM audit_logs WHERE request_id = 'abc12345';
```

---

## Routine maintenance

### Weekly

- Review merged PRs, update CHANGELOG if missed.
- Check `pnpm audit` and `pnpm outdated` — upgrade patch versions.

### Monthly

- Run restore drill (quarterly minimum, monthly preferred).
- Review audit-log disk usage; archive rows older than 7 years if needed
  (RGPD + HDS retention rule — currently NOT enforced in code, manual).
- Check GDPR consent revocations vs cache invalidations count in Loki.

### Quarterly

- Rotate non-critical secrets (`UPSTASH_REDIS_REST_TOKEN`).
- Re-evaluate rate-limit presets in `src/lib/auth/api-rate-limit.ts` vs
  actual traffic (Grafana).
- Review this runbook for drift.

### Annually

- JWT keypair rotation.
- Security audit pass (external penetration test for HDS renewal).
- Reevaluate Docker base image vulnerabilities (`trivy` scan).

---

## Manual setup checklist

One-time operator actions required before the automation scripts
(`scripts/deploy.sh`, `scripts/backup-postgres.sh`, `scripts/decrypt-smoke.ts`)
can run. Keep this list in sync with [scripts-index.md](./scripts-index.md).

### Initial VPS bootstrap (per host)

- [ ] SSH access hardened per Phase 13 US-1109 (keys only, no root login)
- [ ] Node 22+ and pnpm 10+ in PATH (via Corepack or `curl -fsSL`)
- [ ] `pm2` installed globally: `npm install -g pm2`
- [ ] First-run app registration:
      ```sh
      cd /opt/diabeo/backoffice
      pm2 start npm --name diabeo-api -- start
      pm2 save
      pm2 startup systemd    # follow the printed command
      ```
- [ ] Verify: `pm2 describe diabeo-api` shows "online"
- [ ] All env vars from `.env.example` exported (validated by the app boot)

### `scripts/deploy.sh` prerequisites

- [ ] Bootstrap above complete
- [ ] `DATABASE_URL` exported in the deploying operator's shell
- [ ] `scripts/deploy.sh` is executable (`chmod +x`) — handled by git, verify after first pull
- [ ] Smoke-test: `./scripts/deploy.sh status` — returns without error

### `scripts/backup-postgres.sh` prerequisites

- [ ] **Dedicated system user** (principle of least privilege — PGPASSWORD in
      the env is only readable by this user):
      ```sh
      sudo adduser --system --no-create-home --group diabeo-backup
      ```
- [ ] Create bucket in the OVH console: `diabeo-backups-prod` (region GRA)
- [ ] Generate S3 credentials scoped to this bucket only — note access key + secret
- [ ] **Enable bucket versioning + Object Lock in Compliance mode** on the
      bucket (console) — tamper-evident storage required by HDS (ISO 27001
      A.12). Retention window on Object Lock must match your backup policy.
- [ ] **Lifecycle rule** on prefix `postgres/` (console):
      - Glacier (Cold Archive) after 7 days
      - Delete after the period documented in `docs/compliance/hds-rgpd.md`.
        Note: HDS does NOT mandate a specific minimum retention for
        backups — the legal obligation (20 years for medical records,
        Art. R.1112-7 CSP) applies to the SOURCE DB, which is the
        authoritative copy. A 365-day backup lifecycle is defensible as
        long as the source DB itself covers the 20-year horizon and the
        policy is documented.
- [ ] Install dependencies:
      ```sh
      apt-get install -y postgresql-client awscli coreutils age
      ```
      `coreutils` provides `sha256sum`; `age` provides client-side
      encryption (see next step).
- [ ] **Generate the client-side encryption keypair** (offline, on an
      HDS-scoped trusted workstation — NOT on the prod VPS):
      ```sh
      age-keygen -o diabeo-backup.age-key
      # Output contains "# public key: age1…" — note it.
      ```
      - **Private key** (`diabeo-backup.age-key`): store in HashiCorp
        Vault / OVH Secret Manager / offline HSM accessible by 2+ trusted
        operators. NEVER on the prod VPS. Only way to decrypt during
        restore drill.
      - **Public key** (`age1…`): goes into the backup env file below.
      - Losing the private key = losing every backup. Record in two
        independent locations + document in the DPO breach-recovery plan.
- [ ] **Give the `diabeo-backup` user a HOME directory** (required for `.pgpass`):
      ```sh
      sudo mkdir -p /var/lib/diabeo-backup
      sudo chown diabeo-backup:diabeo-backup /var/lib/diabeo-backup
      sudo usermod -d /var/lib/diabeo-backup diabeo-backup
      ```
- [ ] **MANDATORY `~/.pgpass`** — the script refuses `PGPASSWORD` in env:
      ```sh
      sudo -u diabeo-backup bash -c '
        umask 077
        printf "%s:5432:%s:%s:%s\n" \
          "<OVH-DB-host>" "<DB>" "<user>" "<password>" \
          > /var/lib/diabeo-backup/.pgpass
      '
      sudo chmod 0600 /var/lib/diabeo-backup/.pgpass
      ```
      The mode MUST be 0600 (Postgres silently ignores any other mode;
      the script rejects the dump if the mode is wrong).
- [ ] Create env file (owned by the backup user, mode 0600):
      ```sh
      sudo mkdir -p /etc/diabeo
      sudo tee /etc/diabeo/backup.env > /dev/null <<'EOF'
      PG_HOST=<OVH managed DB host>
      PG_PORT=5432
      PG_USER=<DB user>
      PG_DB=diabeo
      OVH_S3_ENDPOINT=https://s3.gra.io.cloud.ovh.net
      OVH_S3_ACCESS_KEY=<from OVH>
      OVH_S3_SECRET_KEY=<from OVH>
      OVH_S3_BUCKET=diabeo-backups-prod
      AGE_RECIPIENT_PUBLIC_KEY=<age1…the public key from the keypair step>
      EOF
      sudo chown diabeo-backup:diabeo-backup /etc/diabeo/backup.env
      sudo chmod 0600 /etc/diabeo/backup.env
      ```
      **No `PGPASSWORD` entry** — the script rejects it.
- [ ] Create backup directory owned by the backup user:
      ```sh
      sudo mkdir -p /var/backups/diabeo
      sudo chown diabeo-backup:diabeo-backup /var/backups/diabeo
      ```
- [ ] **Install logrotate config** (prevents /var/log fill-up):
      ```sh
      sudo cp /opt/diabeo/backoffice/scripts/logrotate.d/diabeo-backup \
        /etc/logrotate.d/diabeo-backup
      sudo chmod 0644 /etc/logrotate.d/diabeo-backup
      sudo touch /var/log/diabeo-backup.log /var/log/diabeo-deploy.log
      sudo chown diabeo-backup:diabeo-backup /var/log/diabeo-backup.log
      sudo logrotate -d /etc/logrotate.d/diabeo-backup    # dry-run
      ```
- [ ] Dry-run as the backup user:
      ```sh
      sudo -u diabeo-backup /opt/diabeo/backoffice/scripts/backup-postgres.sh
      ```
      Exercises the full path: env + dump + sha256 manifest + SSE
      AES256 upload + rotation.
- [ ] Register cron **as the backup user, NOT root**:
      ```sh
      sudo crontab -u diabeo-backup -e
      # Add:
      0 2 * * * /opt/diabeo/backoffice/scripts/backup-postgres.sh \
        >> /var/log/diabeo-backup.log 2>&1
      ```

### `scripts/decrypt-smoke.ts` prerequisites

Run only during the quarterly restore drill, on an **HDS-scoped trusted
workstation** — NEVER on the prod VPS (plaintext PHI is briefly in
memory).

#### Drill host hardening (one-time)

- [ ] Disable core dumps: `ulimit -c 0` in the drill user's shell profile
- [ ] Disable swap on the drill host: `sudo swapoff -a` + comment the
      swap entry in `/etc/fstab`. Prevents plaintext residency on disk
      if the drill runs longer than expected.
- [ ] Full-disk encryption (LUKS) required per HDS for any host that
      holds PHI plaintext even transiently.

#### Drill steps (quarterly)

- [ ] **Retrieve the age private key** from Vault/HSM — NOT from the
      prod VPS. Store in `~/diabeo-backup.age-key` on the drill host
      with `chmod 0600`.
- [ ] **Download** the latest backup envelope + manifest from the OVH
      bucket:
      ```sh
      aws --endpoint-url=$OVH_S3 s3 cp \
        s3://diabeo-backups-prod/postgres/$(date +%Y)/$(date +%m)/diabeo-<ts>.dump.age \
        /tmp/
      aws --endpoint-url=$OVH_S3 s3 cp \
        s3://diabeo-backups-prod/postgres/$(date +%Y)/$(date +%m)/diabeo-<ts>.dump.age.sha256 \
        /tmp/
      ```
- [ ] **Verify integrity** against the manifest:
      ```sh
      cd /tmp && sha256sum -c diabeo-<ts>.dump.age.sha256
      # Must print: diabeo-<ts>.dump.age: OK
      ```
- [ ] **Decrypt** the envelope with the age private key:
      ```sh
      age -d -i ~/diabeo-backup.age-key \
        -o /tmp/diabeo-<ts>.dump \
        /tmp/diabeo-<ts>.dump.age
      ```
- [ ] Restore into a throwaway DB: `pg_restore --dbname=diabeo_restore /tmp/diabeo-<ts>.dump`
- [ ] Export `DATABASE_URL` pointing at the restored DB
- [ ] Export `HEALTH_DATA_ENCRYPTION_KEY` (same key that was active when
      the backup was taken — mismatch is exactly what this smoke catches)
- [ ] Export `HMAC_SECRET` (any non-empty string; only required by the
      crypto module loader)
- [ ] Run: `pnpm tsx scripts/decrypt-smoke.ts`
- [ ] Exit code 0 + "samples decrypted cleanly" = drill success
- [ ] **Securely wipe** the plaintext dump + restored DB when done:
      `shred -u /tmp/diabeo-<ts>.dump && dropdb diabeo_restore`
- [ ] Record outcome in `docs/operations/drill-log.md`

### Centralized log forwarding (HDS traceability, 5-year retention)

Local `/var/log/diabeo-*.log` files are destroyed on VPS failure. HDS
§IV.3 requires operator-action logs retained on an independent trusted
system for the legal duration.

- [ ] Install `rsyslog` (default on Debian/Ubuntu) and configure
      forwarding to OVH Logs Data Platform:
      ```
      # /etc/rsyslog.d/50-diabeo-ldp.conf
      module(load="imfile" PollingInterval="10")
      input(type="imfile" File="/var/log/diabeo-deploy.log" Tag="diabeo-deploy:")
      input(type="imfile" File="/var/log/diabeo-backup.log" Tag="diabeo-backup:")
      *.* @@<OVH LDP endpoint>:6514;RSYSLOG_SyslogProtocol23Format
      ```
- [ ] LDP ingestion key stored in `/etc/rsyslog.d/.ldp-key` (chmod 0600).
- [ ] OVH LDP retention set to 5 years on the `diabeo-ops` stream.
- [ ] Enable `pgaudit` on the managed OVH PostgreSQL (console → config
      → `shared_preload_libraries += pgaudit`, `pgaudit.log = 'all'`).
      Restrict `$PG_USER` to `pg_read_all_data` + explicit GRANTs on
      the backup tables only — reduces blast radius on credential leak.
