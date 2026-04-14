# Operational Runbook

Day-to-day operations playbook for the Diabeo Backoffice on OVHcloud GRA
(Docker Compose + managed PostgreSQL + Upstash Redis + Object Storage).

> **Audience**: on-call engineers. Assumes SSH access to the VPS, `gh` CLI
> authentication, and access to the shared 1Password vault for secrets.

- [Environments](#environments)
- [Deployment](#deployment)
- [Rollback](#rollback)
- [Database migrations](#database-migrations)
- [Backups](#backups)
- [Secrets](#secrets)
- [Monitoring](#monitoring)
- [Routine maintenance](#routine-maintenance)

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

```sh
ssh diabeo@app.diabeo.fr

cd /opt/diabeo/backoffice
git fetch origin main
git log HEAD..origin/main --oneline   # review incoming commits

# Apply any raw SQL migrations FIRST (Prisma db push will fail otherwise
# for column type changes like VARCHAR → enum).
psql $DATABASE_URL < prisma/sql/<new_migration>.sql

# Pull + build + swap containers
./scripts/deploy.sh update

# Health check
curl -sf https://app.diabeo.fr/api/health || echo "DEPLOY FAILED"
```

The `scripts/deploy.sh update` helper:

1. `git pull --ff-only origin main`
2. `pnpm install --frozen-lockfile`
3. `pnpm prisma generate`
4. `pnpm prisma db push --accept-data-loss=false`
5. `pnpm build`
6. `docker compose -f docker-compose.prod.yml up -d --build api`
7. Waits for healthcheck to report green for 30 s before yielding the tty.

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

Cron on the VPS: `0 2 * * * /opt/diabeo/scripts/backup-postgres.sh`.

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

# Validate encryption keys still decrypt fields
node scripts/decrypt-smoke.ts diabeo_restore
```

Document the drill outcome in `docs/operations/drill-log.md`.

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

`GET /api/health` returns:

```json
{
  "status": "ok" | "degraded",
  "db": "ok" | "down",
  "redis": "ok" | "down",
  "version": "a675b99"
}
```

Watchers:

- **OVH Cloud Monitoring** pings `/api/health` every 30 s. Alerts on non-200
  or `status != "ok"` for 3 consecutive checks.
- **Upstash Dashboard**: alerts on eval error rate > 1 %.

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
