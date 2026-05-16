# Runbook — Crons rappels (RDV + factures)

> US-2502 (rappels RDV) + US-2108 (relances factures).
> Dernière mise à jour : 2026-05-19 (round 3 review PR #418).

## 1. Vue d'ensemble

Deux crons quotidiens partagent le même secret `CRON_SECRET` et un pattern d'auth identique :

| Cron | Route | Schedule recommandé | Service |
|------|-------|---------------------|---------|
| Rappels RDV (push J-0 / SMS J-1 / email J-2) | `POST /api/cron/appointments/reminders` | `0 9 * * *` (9h Paris) | `appointmentReminderService.processAppointmentReminders` |
| Relances factures (J+7 / J+15 / J+30) | `POST /api/cron/billing/reminders` | `0 8 * * *` (8h Paris) | `invoiceReminderService.processOverdueInvoices` |

## 2. ⚠️ POST uniquement (round 2 H3 fix)

```bash
curl -X POST https://app.diabeo.fr/api/cron/appointments/reminders \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Content-Length: 0"
```

**Ne pas utiliser GET.** Le secret partirait dans les access logs Nginx, le header `Referer` côté CDN et serait potentiellement cacheable. La route refuse GET (405) depuis round 2.

## 3. Configuration scheduler

### OVH Web Cloud Scheduler
```yaml
- name: appointment-reminders
  schedule: "0 9 * * *"
  method: POST
  url: https://app.diabeo.fr/api/cron/appointments/reminders
  headers:
    Authorization: Bearer ${CRON_SECRET}
    Content-Length: "0"
  timeout: 60s
```

### Vercel Cron (vercel.json)
```json
{
  "crons": [
    {
      "path": "/api/cron/appointments/reminders",
      "schedule": "0 9 * * *"
    }
  ]
}
```
Vercel Cron envoie `GET` par défaut — **ne pas utiliser tel quel**. Wrapper via une route POST proxy ou utiliser une autre solution scheduler.

## 4. Métriques attendues (success)

```json
{
  "processed": 42,
  "sent": 38,
  "failed": 1,
  "skipped": 3,
  "byChannel": {
    "email": { "sent": 12, "failed": 0, "skipped": 1 },
    "sms":   { "sent": 14, "failed": 0, "skipped": 2 },
    "push":  { "sent": 12, "failed": 1, "skipped": 0 }
  },
  "timedOut": false,
  "skippedConcurrent": false,
  "runId": "uuid-v4"
}
```

- `skippedConcurrent: true` → un autre run est déjà en cours (advisory lock détenu). **NORMAL** si deux schedulers actifs (Vercel + OVH).
- `timedOut: true` → le run a dépassé `CRON_TIMEOUT_MS=50_000`. Investiguer si répétitif.

## 5. ⚠️ Advisory lock (round 3 CR-1 fix)

Le service utilise `withSessionAdvisoryLock` (cf. `src/lib/db/cron-lock.ts`) — un `pg.Pool({ max: 1, idleTimeoutMillis: 0 })` dédié garantit que `pg_try_advisory_lock` et `pg_advisory_unlock` tournent sur la **même connexion physique**.

### Lock orphelin (très improbable)

Si vous voyez `cron.skipped_locked` à chaque run pendant > 24h sans cause apparente :

```bash
# 1. Identifier la connexion qui détient le lock
psql $DATABASE_URL -c "
  SELECT pid, application_name, state, query_start, query
  FROM pg_stat_activity
  WHERE pid IN (
    SELECT pid FROM pg_locks WHERE locktype = 'advisory'
  );
"

# 2. Si pid identifié et idle depuis > 1h → terminate
psql $DATABASE_URL -c "SELECT pg_terminate_backend(<pid>);"

# 3. Alternative : restart du process Node (clear tout le pool)
# Le pool `cronLockPool` est singleton process — restart = release tous locks.
```

### Logs à surveiller

- `lock.release.failed` (logger.error, kind) → `pg_advisory_unlock` a throw. Lock peut être leaké jusqu'au release du client pool.
- `lock.release.no_op` (logger.error, kind) → `pg_advisory_unlock` a retourné `false` (la connexion n'avait pas le lock). **Critique** : signale bug pool ou misuse.

## 6. Forensique by runId (round 2 M11 + round 3 MED-2)

Le `runId` UUID propagé en `metadata.runId` permet de tracer un run :

```sql
-- Tous les events d'un run
SELECT created_at, action, resource_id, metadata
FROM audit_logs
WHERE metadata @> jsonb_build_object('runId', '<uuid>')
ORDER BY created_at;

-- Index GIN partial `audit_logs_run_id_gin_idx` rend cette query
-- < 100ms à 10M+ rows.
```

## 7. Maintenance — rebuild d'index (round 3 MED-6)

L'index `appointments_status_date_idx` (round 2 M5) a été créé sans `CONCURRENTLY` (Prisma 7 wrap migrations en TX). Acceptable V1 (< 100k rows). Si la table dépasse 1M+ rows :

```bash
# Hors fenêtre cron (avant 9h Paris)
psql $DATABASE_URL <<EOF
BEGIN;
ALTER INDEX appointments_status_date_idx RENAME TO appointments_status_date_idx_old;
COMMIT;

CREATE INDEX CONCURRENTLY appointments_status_date_idx
  ON appointments(status, date);

BEGIN;
DROP INDEX appointments_status_date_idx_old;
COMMIT;
EOF
```

### Rebuild GIN runId (si volume > 100M rows audit_logs)

Idem — utiliser `CONCURRENTLY` :

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_logs_run_id_gin_idx_new
  ON audit_logs USING gin ((metadata -> 'runId'))
  WHERE metadata ? 'runId';

DROP INDEX audit_logs_run_id_gin_idx;
ALTER INDEX audit_logs_run_id_gin_idx_new RENAME TO audit_logs_run_id_gin_idx;
```

## 8. SLO et alertes recommandées

| Métrique | Seuil alerte | Action |
|----------|--------------|--------|
| `cron.run` absent > 25h | PagerDuty page | Scheduler down ou route 503 |
| `cron.skipped_locked` > 3 jours consécutifs | Slack warning | Lock orphelin — voir §5 |
| `metrics.timedOut: true` 3 jours consécutifs | Slack warning | Cron sous-dimensionné — augmenter `CRON_TIMEOUT_MS` ou splitter par cabinet |
| `metrics.failed` > 10% | Email ops | Provider down (Resend / FCM / SMS) |
| `sms.credits.low_balance` (logger.warn) | Email cabinet manager | Cabinet à <10 crédits SMS — recharger |

## 9. Rétention secrets

- `CRON_SECRET` : ≥ 32 bytes hex (64 chars). Rotation manuelle annuelle ou si fuite suspectée.
- Pas de stockage en `.env` commité. OVH Vault / Vercel env vars uniquement.
- Pas de log du secret côté serveur (route refuse l'auth en `cron.auth.failed` audit sans exposer le secret reçu).

## 10. Procédure rotation `CRON_SECRET`

1. Générer un nouveau secret : `openssl rand -hex 32`.
2. Configurer dans OVH/Vercel env vars (overwrite).
3. Restart les apps Next.js (boot env validation `assertRequiredEnv`).
4. Mettre à jour le scheduler (OVH/Vercel cron config).
5. Vérifier 1 run réussi.

Pas de rotation dual-key pendant la migration — la route ne fait que valider un seul secret (acceptable car cron < 100 invocations/jour, fenêtre de fail minimale).
