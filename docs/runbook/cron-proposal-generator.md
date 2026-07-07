# Runbook — Cron générateur de propositions d'ajustement (US-2651/2652)

> Générateur multi-levier de titration (ICR + basal + ISF + fixedDose + flags mode c).
> Dernière mise à jour : 2026-07-07 (activation prod).

## 0. ⚠️ Bloqueur pré-prod — signature DPO/RSSI

**Ne PAS activer le scheduler avant** la signature de la DPIA `docs/compliance/dpia-us2651-proposal-generator.md`
par le **DPO** (et RSSI si requis). Le cron accède à des données de santé (glycémie, insuline) sous un
acteur système (`userId = null`) et produit des propositions cliniques (jamais auto-appliquées, ADR #13,
gate médecin). Comme US-2108, l'activation est conditionnée à la validation conformité.

## 1. Vue d'ensemble

| Cron | Route | Schedule recommandé | Service |
|------|-------|---------------------|---------|
| Générateur de propositions | `POST /api/cron/generate-proposals` | `0 2 * * *` (2 h Paris — analyse nocturne, hors pics) | `proposalGeneratorService.generateForAllPatients` |

Partage le secret `CRON_SECRET` et le pattern d'auth (Bearer timing-safe) des crons rappels
(`cron-reminders.md`). Sélection des patients : actifs uniquement (`deletedAt: null` + `user.status: active`),
mode-routés (basalBolus → doses ; nonInsulin → flags ; fixedDose → doses par moment).

## 2. ⚠️ POST uniquement (durcissement US-2652, aligné rappels round 2 H3)

```bash
curl -X POST https://app.diabeo.fr/api/cron/generate-proposals \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Content-Length: 0"
```

**Ne pas utiliser GET.** Le secret partirait dans les access logs Nginx, le `Referer` CDN et serait
potentiellement cacheable. `GET` n'est pas exporté → Next.js répond **405**.

## 3. Configuration scheduler

### OVH Web Cloud Scheduler
```yaml
- name: proposal-generator
  schedule: "0 2 * * *"
  method: POST
  url: https://app.diabeo.fr/api/cron/generate-proposals
  headers:
    Authorization: Bearer ${CRON_SECRET}
    Content-Length: "0"
  timeout: 60s
```

### Vercel Cron (vercel.json)
Vercel Cron envoie `GET` par défaut → **incompatible** avec le POST-only. Utiliser l'OVH scheduler
(ou un proxy POST) — ne pas router Vercel Cron directement sur cette route.

## 4. Métriques attendues (success)

```json
{
  "processed": 120,
  "created": 34,
  "flagged": 8,
  "errored": 0,
  "skippedConcurrent": false
}
```

- `processed` : patients actifs parcourus. `created` : propositions moteur générées (toutes `pending`,
  gate médecin). `flagged` : `ClinicalReviewFlag` d'orientation levés (mode c). `errored` : patients en
  échec infra (**isolés** — n'arrêtent pas le portefeuille). `skippedConcurrent: true` → un autre run
  détient le verrou advisory (NORMAL si 2 schedulers).

## 5. ⚠️ Advisory lock

Identique aux crons rappels : `withSessionAdvisoryLock` (`src/lib/db/cron-lock.ts`), `pg.Pool({ max: 1 })`
dédié → `pg_try_advisory_lock`/`pg_advisory_unlock` sur la même connexion physique. Audit run-level :
`proposal.generator.cron.run` (succès) / `...skipped_locked` (verrou tenu). Procédure lock orphelin :
voir `cron-reminders.md` §5.

## 6. Forensique by runId

Le run émet un audit run-level ; les accès aux données de santé sont audités par patient
(`metadata.patientId`, index GIN partiel US-2268). Tracer un run/patient :

```sql
SELECT created_at, action, resource, resource_id, metadata
FROM audit_logs
WHERE metadata @> jsonb_build_object('patientId', <id>)
  AND created_at >= now() - interval '2 days'
ORDER BY created_at;
```

## 7. SLO et alertes recommandées

| Métrique | Seuil alerte | Action |
|----------|--------------|--------|
| `proposal.generator.cron.run` absent > 25 h | PagerDuty | Scheduler down ou route 401/503 |
| `cron.auth.failed` en rafale | Slack SOC | Tentative d'accès / secret rotaté sans MAJ scheduler |
| `skipped_locked` > 3 jours consécutifs | Slack | Lock orphelin — voir `cron-reminders.md` §5 |
| `errored` > 10 % des `processed` | Email ops | Panne DB / config patients incohérente |

## 8. Rétention secret & rotation

`CRON_SECRET` partagé avec les crons rappels — voir `cron-reminders.md` §9-§10 (≥ 32 bytes hex,
OVH Vault, rotation annuelle, jamais commité/loggé). Un run refusé émet `cron.auth.failed` sans exposer
le secret reçu.
