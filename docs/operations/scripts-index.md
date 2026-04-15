# Operational scripts — inventory

Tracks the operational scripts and alert configurations referenced by
[runbook.md](./runbook.md) and [incident-response.md](./incident-response.md).
Each row states whether it **exists** today (`✓`) or is **TODO** (`✗`).

Operators: when an `✗` item is invoked in a playbook, fall back to the
manual procedure also documented in the runbook, then open a tracking
issue so the script can be productionized.

## Status

| Asset                                       | Status | Owner | Notes |
|---------------------------------------------|--------|-------|-------|
| `GET /api/health`                           | ✓ | backend | Implemented in PR #107 — `src/app/api/health/route.ts` |
| `scripts/test-e2e.sh`                       | ✓ | QA | Existing, boots Playwright fixture stack |
| `scripts/deploy.sh update`                  | ✓ | devops | Wraps manual fallback: git pull + pnpm + migrate + build + pm2 restart + health probe. Manual steps (pm2 setup) in runbook §Manual setup |
| `docker-compose.prod.yml`                   | ✗ | devops | Prod currently runs `next start` under pm2 directly. Dépend de US-1108 Nginx + US-1107 TLS |
| `scripts/backup-postgres.sh` (cron 02:00)   | ✓ | devops | pg_dump custom + aws s3 cp + rotation locale 14 jours. Requires one-time OVH bucket + cron + `/etc/diabeo/backup.env` setup (runbook §Manual setup) |
| `scripts/decrypt-smoke.ts`                  | ✓ | backend | Post-restore validation: samples 5 users × 5 encrypted fields via `safeDecryptField`. Run manually during the quarterly restore drill |
| `docs/operations/drill-log.md`              | ✗ | on-call | Created on first drill — template in incident-response.md |
| OVH Cloud Monitoring alert on `/api/health` | ✗ | devops | Endpoint ready; monitor rule not provisioned |
| Upstash eval-error-rate alert > 1 %         | ✗ | devops | Dashboard accessible, alert webhook not wired |
| `docs/compliance/breach-notification.md`    | ✗ | DPO | Legal playbook referenced by incident-response.md |

## Implementation priorities

Roughly ordered by impact / effort:

1. **OVH Cloud Monitoring alert on `/api/health`** — endpoint exists, just
   needs a 30 s ping rule + webhook to on-call Slack. ~30 min of ops work.
2. **`scripts/deploy.sh update`** — wrap the manual fallback from the
   runbook (8 lines of bash + pm2 reload). Unblocks routine deploys.
3. **`scripts/backup-postgres.sh` + cron** — OVH snapshots are good but
   application-level dumps give faster restore + portability.
4. **`docker-compose.prod.yml`** — only needed if we move off pm2; not
   blocking anything today.
5. **`scripts/decrypt-smoke.ts`** — nice-to-have for the restore drill;
   a `SELECT decrypt(...) FROM users LIMIT 10` does the same job manually.
6. **`docs/compliance/breach-notification.md`** — DPO-owned, legal doc;
   blocks nothing operationally but is a HDS audit requirement.

## How to add a new row

1. Add the script / asset to the `scripts/` or `docs/` tree.
2. Reference it from `runbook.md` or `incident-response.md`.
3. Add a row here with `✓`, the owner, and a short note.
4. Bump the CHANGELOG under "Added".

## How to remove a TODO

When the `✗` becomes `✓`:

1. Flip the status cell.
2. Drop the `[TODO — not yet implemented]` marker from the runbook section
   that references it.
3. Add a CHANGELOG entry ("Added: …").
