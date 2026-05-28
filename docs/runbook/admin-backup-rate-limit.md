# Runbook — Rate-limit POST /api/admin/backups

**Owner** : Backend platform / Security
**Statut** : Production (Plan B follow-up A4 round 2, 2026-05-28)
**Scope** : Anti-DoS sur déclenchement manuel backup ADMIN + burst US-2265

---

## 1. Pourquoi

Le service `backupService.trigger` a un guard `backup_already_in_progress`
(409 si pending/running), MAIS aucune protection volumétrique au niveau
API. Vecteurs d'attaque :

- ADMIN session compromise → spam POST 1000/sec
- Chaque tentative consomme une `count` query DB
- 999 throws en cascade gaspillent transactions Prisma
- Si worker se débloque (état corrupted), 1000 backups en cascade → pg_dump
  pile-up + S3 quota explosion
- **Un backup = dump PostgreSQL COMPLET = TOUS les PHI Diabeo** (50k+ patients,
  PS, documents). Vecteur d'exfiltration massive si non bridé.

A4 introduit **2 rate-limits superposés** + **burst detection US-2265** via
`auditService.rateLimited()`.

---

## 2. Architecture

### Preset `RATE_LIMITS.adminBackupTrigger` (per-user 3/h fail-closed)

```typescript
adminBackupTrigger: {
  bucket: "admin-backup-trigger",
  windowSec: 3600,
  max: 3,
  failMode: "closed",
}
```

**Justification cap 3/h (A4 round 2 C-3)** :
- Aligné `exportUser` (RGPD Art. 20 = 1 user PHI déchiffré → 3/h)
- Backup = dump complet PHI × 50000+ patients → sensibilité × 50000 supérieure
- Besoin métier réel = 1-2/h (1 cron auto + 1-2 manuels), 3/h × 1.5 marge
- **Précédent round 1 cap 5/h jugé disproportionné** par HSA audit (round 2 H-2)

**Fail-closed** : si Redis down → reject 429. Justifié car backup = action
OPS sensible (impact disk/S3) + procédure break-glass documentée §7.2.

### Preset `RATE_LIMITS.adminBackupTriggerIp` (per-IP 6/h fail-closed)

```typescript
adminBackupTriggerIp: {
  bucket: "admin-backup-trigger-ip",
  windowSec: 3600,
  max: 6,
  failMode: "closed",
}
```

**Cas couvert** : 2 ADMIN simultanés depuis même IP = 3 × 2 = 6/h max.
> 6/h depuis 1 IP source = signal anormal.

### A4 round 2 M-5 — Const partagée

```typescript
const ADMIN_BACKUP_BUCKET_BASE = "admin-backup-trigger" as const
// adminBackupTrigger.bucket = `${ADMIN_BACKUP_BUCKET_BASE}`
// adminBackupTriggerIp.bucket = `${ADMIN_BACKUP_BUCKET_BASE}-ip`
```

Anti-drift si renommage.

### Ordre check (A4 round 2 H-1)

```typescript
1. requireRole(req, "ADMIN")               // 401 si pas ADMIN
2. resolveIpIdentifier(ctx.ipAddress, user.id)  // C-1 "unknown" → composite
3. Promise.all([                            // H-1 UNCONDITIONAL (both)
     checkApiRateLimit(userId, adminBackupTrigger),
     checkApiRateLimit(ipIdentifier, adminBackupTriggerIp),
   ])
4. Si user.allowed=false → audit scope=user (avec burst US-2265 via C-2)
5. Si ip.allowed=false → audit scope=ip (indépendant)
6. Si l'un OU l'autre fail → 429 avec headers ANSSI + Retry-After ≥ 1
7. Sinon backupService.trigger(...) → 202 ou 409
```

**A4 round 2 H-1 fix** : Les 2 checks `Promise.all` (vs ancien
short-circuit) → l'audit IP-scoped reste précis même si user-cap déjà
dépassé. Le SOC voit la double saturation explicitement.

---

## 3. Contrat client

### 3.1 Trigger backup (cas nominal)

```http
POST /api/admin/backups
Cookie: diabeo_token=<JWT>

→ HTTP/1.1 202 Accepted
X-RateLimit-Limit-User: 3
X-RateLimit-Limit-Ip: 6
X-RateLimit-Remaining: 2
X-RateLimit-Reset: 3600

{ "id": 42, "backupRef": "uuid-...", "status": "pending" }
```

UI peut afficher countdown via `X-RateLimit-Remaining` (RFC 6585 /
draft-ietf-httpapi-ratelimit-headers).

### 3.2 Rate-limit dépassé

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 2400
Cache-Control: no-store, no-cache, must-revalidate, private
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-RateLimit-Limit-User: 3
X-RateLimit-Limit-Ip: 6
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 2400

{ "error": "rateLimitExceeded" }
```

**A4 round 2 M-1** : headers ANSSI RGS §4.5 (no-store + nosniff +
Referrer-Policy) sur tous les 429.

**A4 round 2 H-5** : `Retry-After ≥ 1` toujours (jamais 0 ni négatif).

### 3.3 Concurrency guard service-level — **A4 round 2 H-6 fix**

```http
HTTP/1.1 409 Conflict
{ "error": "backup_already_in_progress" }
```

> ⚠️ **A4 round 2 H-6 — Important** : le 409 **CONSOMME** le budget
> rate-limit (les 2 `checkApiRateLimit` ont commit INCR Redis avant le
> throw service-level). Précédent runbook §3.3 affirmait l'inverse — FAUX.
>
> UX impact : un ADMIN qui reload pendant backup en cours consomme son
> budget 3/h. Documenter côté UI : "Attendre completion backup avant
> retry, sinon le quota du compte sera réduit."

---

## 4. Audit & forensique HDS

### Action `RATE_LIMITED` via `auditService.rateLimited()` (A4 round 2 C-2)

Émise pour CHAQUE 429 via la nouvelle méthode service-level avec :
- `resource: "BACKUP"`, `resourceId: "trigger"`
- `metadata: { scope: "user" | "ip", bucket, degraded, retryAfterSec }`
- Câble US-2265 `recordAndCheckBurst` → ≥ 50 events / 60s par userId →
  émission row `RBAC_BREACH_BURST` atomique + alerte SOC

**A4 round 2 C-2 fix** : précédent `auditService.log` direct ne câblait
PAS le burst → SOC aveugle. Aligné `auditService.requireStepUp` pattern
PR #463 A2 round 2.

### A4 round 2 C-4 — `metadata.degraded` propagé

```sql
SELECT user_id, ip_address, metadata->>'scope' AS scope,
       (metadata->>'degraded')::boolean AS redis_down
FROM audit_logs
WHERE action = 'RATE_LIMITED' AND resource = 'BACKUP'
  AND created_at > NOW() - INTERVAL '1 hour';
```

SOC distingue :
- `degraded=true` → Redis outage (escalade infra, pas sécurité)
- `degraded=false` → vraie saturation (escalade sécurité)

### Pattern détection attaque

```sql
SELECT user_id, ip_address, COUNT(*) AS rate_limit_hits
FROM audit_logs
WHERE action = 'RATE_LIMITED'
  AND resource = 'BACKUP'
  AND (metadata->>'degraded')::boolean = false
  AND created_at > NOW() - INTERVAL '1 hour'
GROUP BY user_id, ip_address
HAVING COUNT(*) > 5;
```

Si user/IP > 5 RATE_LIMITED rows en 1h sans degraded → escalade SOC.

### Burst US-2265 row

```sql
SELECT * FROM audit_logs
WHERE action = 'RBAC_BREACH_BURST'
  AND metadata->>'kind' = 'rate_limited_burst'
  AND created_at > NOW() - INTERVAL '24 hours';
```

Cooldown 60s entre 2 burst rows pour éviter log flood.

---

## 5. Sécurité

### 5.1 Fail-closed posture justifiée

Backup = full dump PHI. Si Redis down et fail-open → attacker peut spammer
sans contrôle. Fail-closed préfère bloquer ~5min outage Redis qu'autoriser
sans visibilité. **Procédure break-glass** §7.2 pour OPS pré-migration.

### 5.2 Per-user + Per-IP combinés

| Attaquant | Per-user 3/h | Per-IP 6/h | Result |
|---|---|---|---|
| 1 session ADMIN compromise → spam | ✅ après 3 calls | ✅ (mais user déjà bloqué) | 4ème+ calls bloqués |
| 2 sessions ADMIN compromises même IP | ❌ (chaque ≤ 3) | ✅ après 6 calls total | IP bloque cross-user |
| 2 sessions ADMIN compromises IPs distinctes | ❌ | ❌ | **Mitigation : US-2148 admin user mgmt + SOC alert burst US-2265** |

### 5.3 Burst detection US-2265 (A4 round 2 C-2)

`auditService.rateLimited()` câble `recordAndCheckBurst`. ≥ 50 events
RATE_LIMITED / 60s par userId → row `RBAC_BREACH_BURST` + alerte SOC.
Cooldown 60s anti log flood. Pattern aligné `accessDenied` (US-2265
original) + `requireStepUp` (A2 round 2 C-2).

### 5.4 `ipAddress="unknown"` (A4 round 2 C-1)

Si reverse proxy mal configuré OU direct connect → `ipAddress="unknown"`
fallback. Précédent round 1 : tous les ADMIN sans header partageaient le
bucket `apirl:admin-backup-trigger-ip:unknown` → DoS interne accidentel +
attacker pouvait strip headers pour weaponiser.

**Fix** : composite `unknown:<userId>` + `logger.warn` `kind:
"rate-limit.ip.unknown"` pour ops signaler reverse proxy à fixer.

### 5.5 Multi-sessions partagent budget per-user

> 📌 **A4 round 2 M-3** : Si un ADMIN a N sessions actives (mobile + web +
> tab × M), TOUTES partagent le bucket per-user `user.id` → cap 3/h
> **cumulé**. Pas par session.
>
> Trade-off : si un attacker compromise 1 session sur N, l'ADMIN légitime
> sur les autres sessions voit son quota réduit. Mitigation : US-2148
> sessions revoke + US-2007 sessions multiple UI.

---

## 6. Anti-patterns

- ❌ Ne PAS augmenter `max` au-delà de 5/h sans justification métier + sign-off
  DPO (sensibilité full-PHI dump).
- ❌ Ne PAS passer `failMode: "open"` (test M-10 anti-régression bloque).
- ❌ Ne PAS short-circuit après per-user fail (A4 round 2 H-1 — les 2 checks
  doivent rester unconditional pour forensique IP-scoped).
- ❌ Ne PAS appliquer ce rate-limit sur GET (lecture liste = OK fréquent).
- ❌ Ne PAS catch silent les erreurs audit (A4 round 2 H-2 — `logger.warn`
  obligatoire pour visibilité forensique).

---

## 7. Recovery

### 7.1 ADMIN locked out par rate-limit (cas nominal)

1. Attendre `Retry-After` (max 1h).
2. Si urgent + Redis OK, ops Redis CLI :
   ```bash
   curl https://<upstash>.upstash.io/del/diabeo:prod:apirl:admin-backup-trigger:<userId> \
     -H "Authorization: Bearer <REDIS_TOKEN>"
   curl https://<upstash>.upstash.io/del/diabeo:prod:apirl:admin-backup-trigger-ip:<ip> \
     -H "Authorization: Bearer <REDIS_TOKEN>"
   ```
3. Audit psql : insert `MFA_BREAK_GLASS_GRANTED`-style row avec justification + ops-userId.

> ⚠️ **`UPSTASH_REDIS_REST_TOKEN`** : distinct du JWT ADMIN. Rotation
> procédure : `docs/runbook/hmac-secret-rotation.md` (pattern PR #416).
> Anti-leak shell history : `unset HISTFILE` avant la session ops.

### 7.2 Break-glass — Redis outage prolongé (> 10 min)

Le fail-closed bloque 100% des triggers manuels. Si OPS doit absolument
backup AVANT migration risquée :

1. **Bypass API direct via worker** :
   ```bash
   # SSH sur le container worker
   docker exec -it diabeo-worker bash
   pnpm tsx scripts/manual-backup.ts --user-id=<ops-userId> --reason="redis_outage_premigration"
   ```
2. **Audit psql** (manuel — le worker ne passe pas par l'API) :
   ```sql
   INSERT INTO audit_logs (user_id, action, resource, resource_id, metadata)
   VALUES (<ops-userId>, 'CREATE', 'BACKUP', 'manual-break-glass',
           '{"kind":"break_glass","reason":"redis_outage_premigration","authorizedBy":"<direction>"}');
   ```
3. **2-eyes validation** : direction OPS confirme par email + log.

---

## 8. DPIA — Impact RGPD

**Données traitées** :
- `userId` (existant `Session.userId`)
- `ipAddress` (existant `Session.ipAddress` US-2007)
- `userAgent` (existant US-2007)
- `RATE_LIMITED` audit rows (`audit_logs` immutables, **rétention 6 ans HDS**
  via `retention.service.ts` US-2133 — A4 round 2 L-4 reconnaissance)
- Burst row `RBAC_BREACH_BURST` quand seuil dépassé

Pas de PHI directe.

**Base légale** : RGPD Art. 6.1.f (intérêt légitime — sécurité système
d'information). **A4 round 2 L-4** : ne contraint PAS l'obligation Art. 32
backup (le cron automatique quotidien tourne hors-API, non concerné).

**Risques résiduels** :
1. **Attaque discrète long-terme** — 3 POST/h × 100 jours = 300 dumps
   potentiels. Rate-limit n'a pas de mémoire long-terme. **Contrôle
   complémentaire** : S3 access logs + alerte volumétrie download
   bucket-side (hors scope PR).
2. **NAT corporate** — 2 ADMIN derrière 1 IP partagée saturent bucket à 3
   calls chacun. Workaround légitime via VPN/mobile = bypass. Acceptable
   car Diabeo prod = peu d'ADMIN, NAT improbable.
3. **Per-user cumul multi-sessions** — voir §5.5.

---

## 9. Monitoring (V1.5 — US-2153 Loki reportée V2)

Métriques structurées :

- `audit.rate_limited.persist_failed` (warn — audit DB down)
- `rate-limit.ip.unknown` (warn — reverse proxy mal configuré)
- Counter `audit_logs.action='RATE_LIMITED' resource='BACKUP'` / 1h
  - Alerte > 5 / hour (signal attaque)
- Counter `audit_logs.action='RBAC_BREACH_BURST' metadata->>'kind'='rate_limited_burst'`
  - Alerte > 0 (escalade immédiate SOC)
- Counter `audit_logs.metadata->>'degraded'='true'` / 1h
  - Alerte > 10 / h (Redis outage signal infra)
- Latency p99 `POST /api/admin/backups`
- Ratio `429 / 202` (élevé = saturation ou attaque)

⚠️ **A4 round 2 M-6 / M-9** — Tant que US-2153 (Loki) n'est pas livré, ces
warns vont uniquement dans stderr. **Pre-deploy checklist OPS** : valider
log forwarding stderr → SIEM avant deploy prod.

---

## 10. V1.5 — Adoption pattern A4 sur autres routes ADMIN sensibles

**A4 round 2 L-6** — Routes candidates pour extension du pattern :

| Route | Sensibilité | Cap suggéré | Priorité |
|---|---|---|---|
| `POST /api/admin/users/[id]/jwt-revoke` (US-2148) | Action OPS critique | 5/h user + 10/h IP | HIGH |
| `DELETE /api/admin/data-breaches/[id]` (US-2147) | RGPD Art. 33 irréversible | 2/h user + 5/h IP | HIGH |
| `POST /api/admin/exports/data-breach` | Export PHI massif | 1/h user + 3/h IP | MEDIUM |
| `PUT /api/admin/healthcare-services/[id]` (US-2118) | Configuration régalienne | 10/h user + 20/h IP | LOW |

Issue GH à créer : "Adoption pattern A4 rate-limit sur routes ADMIN
sensibles V1.5" — dépend de US-2153 monitoring + Loki forwarding.

---

## 11. Pre-deploy checklist

- [ ] Reverse proxy nginx/Traefik OVH injecte `x-forwarded-for` correctement
      (vérifier `metrics["rate-limit.ip.unknown"] === 0` pendant 24h staging)
- [ ] Stderr log forwarding vers SIEM/Loki configuré (pour
      `audit.rate_limited.persist_failed` et `RBAC_BREACH_BURST` alerts)
- [ ] Procédure break-glass `scripts/manual-backup.ts` testée en staging
- [ ] DPO sign-off : cap 3/h user + 6/h IP justifié vs full-PHI dump sensitivity
- [ ] Cron backup automatique quotidien validé hors-API (ne consomme PAS le
      bucket → obligation Art. 32 préservée)
- [ ] Documentation UI cliente côté frontend (header parsing `X-RateLimit-*` +
      `Retry-After` countdown affichage)

---

*Rate-limit + burst US-2265 = défense en profondeur prod-grade. V1.5
candidates listés §10 sous validation HSA case-by-case.*
