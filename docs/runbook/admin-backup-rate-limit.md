# Runbook — Rate-limit POST /api/admin/backups

**Owner** : Backend platform / Security
**Statut** : Production (Plan B follow-up A4, 2026-05-28)
**Scope** : Anti-DoS sur le déclenchement manuel de backup ADMIN

---

## 1. Pourquoi

Le service `backupService.trigger` a un guard `backup_already_in_progress`
(409 si un backup `pending`/`running` existe), MAIS aucune protection
volumétrique au niveau API :

- ADMIN avec session compromise → spam POST 1000/sec
- Chaque tentative consomme une `count` query DB
- Race conditions : 1000 calls concurrents voient tous `inflight=0` puis 1
  réussit, 999 throw (gaspillage de transactions Prisma)
- Si le worker se débloque (état corrupted), 1000 backups pourraient être
  déclenchés en cascade → pg_dump pile-up + S3 quota explosion

A4 introduit **2 rate-limits superposés** :
- **Per-user** 5/h fail-closed (cap volumétrique normal)
- **Per-IP** 10/h fail-closed (defense contre rotation sessions volées)

---

## 2. Architecture

### Preset `RATE_LIMITS.adminBackupTrigger` (per-user)

```typescript
adminBackupTrigger: {
  bucket: "admin-backup-trigger",
  windowSec: 3600,
  max: 5,
  failMode: "closed",
}
```

**Justification cap 5/h** :
- Diabeo prod : 1 backup automatique/jour + 1-2 manuels = ~3/h plafond métier
- 5/h = marge sécurité × 1.6 sans frustrer un ADMIN OPS légitime
- Aligné `fhirRetryAdmin` (5/h) + cohérence pattern Diabeo

**Fail-closed** : si Redis down → reject 429 (pas 200). Justifié car
backup = action OPS sensible. Mieux vaut bloquer temporairement qu'autoriser
sans visibilité.

### Preset `RATE_LIMITS.adminBackupTriggerIp` (per-IP)

```typescript
adminBackupTriggerIp: {
  bucket: "admin-backup-trigger-ip",
  windowSec: 3600,
  max: 10,
  failMode: "closed",
}
```

**Cas couvert** : attaquant qui compromet 2-3 sessions ADMIN simultanément
et rotate. Per-user bucket ne le voit pas (chaque user a 5/h). Per-IP cap
limite la source.

10/h = 5 × 2 ADMIN simultanés. Si > 10/h depuis 1 IP, signal anormal.

### Ordre check

```typescript
1. requireRole(req, "ADMIN")      // 401 si pas ADMIN
2. checkApiRateLimit(userId, …)   // 429 si per-user dépassé (short-circuit)
3. checkApiRateLimit(ipAddress, …) // 429 si per-IP dépassé
4. backupService.trigger(...)      // 202 ou 409 backup_already_in_progress
```

Short-circuit après per-user fail évite de consommer le budget per-IP avant
le per-user.

---

## 3. Contrat client

### 3.1 Trigger backup (cas nominal)

```http
POST /api/admin/backups
Cookie: diabeo_token=<JWT>
X-Requested-With: XMLHttpRequest

→ HTTP/1.1 202 Accepted
{ "id": 42, "backupRef": "uuid-...", "status": "pending" }
```

### 3.2 Rate-limit dépassé

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 2400
Content-Type: application/json

{ "error": "rateLimitExceeded" }
```

UI doit afficher countdown UX "Prochain backup dispo dans <X> min".

### 3.3 Concurrency guard service-level

```http
HTTP/1.1 409 Conflict
{ "error": "backup_already_in_progress" }
```

Un backup `pending`/`running` existe déjà. Attendre completion avant
re-trigger. **N'incrémente PAS** les compteurs rate-limit (l'erreur arrive
APRÈS les 2 checkApiRateLimit qui ont déjà passé).

---

## 4. Audit & forensique HDS

### Action `RATE_LIMITED` (existante US-2002)

Émise pour CHAQUE 429 avec :
- `resource: "BACKUP"`
- `resourceId: "trigger"`
- `metadata: { scope: "user" | "ip", bucket: "..." }`

Permet forensique CNIL/ANS :
- "Qui a saturé le rate-limit user X ?" → `WHERE userId = X AND action = 'RATE_LIMITED'`
- "Quelle IP source a saturé ?" → `WHERE metadata->>'scope' = 'ip' AND ipAddress = ...`

### Pattern de détection attaque

```sql
SELECT user_id, ip_address, COUNT(*) AS rate_limit_hits
FROM audit_logs
WHERE action = 'RATE_LIMITED'
  AND resource = 'BACKUP'
  AND created_at > NOW() - INTERVAL '1 hour'
GROUP BY user_id, ip_address
HAVING COUNT(*) > 10
ORDER BY rate_limit_hits DESC;
```

Si un user/IP dépasse 10 RATE_LIMITED rows en 1h, alerter SOC.

---

## 5. Sécurité

### 5.1 Fail-closed posture justifiée

Backup = action OPS sensible avec impacts :
- Disk I/O serveur (pg_dump CPU + RAM)
- S3 quota OVH Object Storage
- Audit log row + worker dispatch

Si Redis down et fail-open → un attacker peut spammer sans contrôle. Fail-closed
préfère bloquer temporairement (~5 min outage Redis = 0 backup manuel possible).

### 5.2 Per-user + Per-IP combinés

| Attaquant | Per-user bloque ? | Per-IP bloque ? |
|---|---|---|
| 1 session ADMIN compromise → spam | ✅ après 5 calls | ✅ après 10 (mais user déjà bloqué avant) |
| 2 sessions ADMIN compromises même IP | ❌ (chaque user ≤ 5) | ✅ après 10 calls total |
| 2 sessions ADMIN compromises IPs distinctes | ❌ (chaque user ≤ 5 + IP ≤ 10) | ❌ — mitigation : SOC alert sur 2 ADMIN simultanés |

Trade-off : multi-session multi-IP attack = laissé à US-2148 admin user management
(suspend compromised users) + US-2007 sessions revoke.

### 5.3 Bypass via cron interne ?

`POST /api/admin/backups` est ADMIN-only. Le cron de backup automatique
quotidien tourne hors-API via worker direct → pas concerné par ce rate-limit
(souhaité — le cron a son propre ordonnancement OVH).

---

## 6. Anti-patterns

- ❌ Ne PAS augmenter `max` au-delà de 10/h sans justification métier (risque
  pg_dump pile-up).
- ❌ Ne PAS passer `failMode: "open"` (laisse passer pendant outage Redis).
- ❌ Ne PAS skipper le per-IP check (defense rotation sessions).
- ❌ Ne PAS appliquer le même rate-limit sur GET (lecture liste = OK fréquent).

---

## 7. Recovery

### ADMIN locked out par rate-limit

1. Ops Redis CLI :
   ```bash
   curl https://<your-redis>.upstash.io/del/diabeo:prod:apirl:admin-backup-trigger:<userId> \
     -H "Authorization: Bearer <REDIS_TOKEN>"
   curl https://<your-redis>.upstash.io/del/diabeo:prod:apirl:admin-backup-trigger-ip:<ip> \
     -H "Authorization: Bearer <REDIS_TOKEN>"
   ```
2. Audit psql : insert `MFA_BREAK_GLASS_GRANTED`-style row avec justification

### Redis outage prolongé

- Tous les triggers manuels échouent 429.
- Le cron automatique continue (hors-API).
- Mitigation : OVH support Upstash + restart si possible.
- Si > 24h outage → activer manuellement le backup via worker direct (ops only).

---

## 8. DPIA — Impact RGPD

**Données traitées** : `userId`, `ipAddress` (Diabeo conserve déjà via
`Session.ipAddress` US-2007). Pas de PHI. Pas de transfert hors-UE.

**Base légale** : intérêt légitime du responsable de traitement (RGPD Art.
6.1.f) — sécurité du système d'information (anti-DoS).

**Risques résiduels** : aucun nouveau. Hérite des mesures `api-rate-limit.ts`
existantes (US-2005 export RGPD, US-2123 FHIR retry).

---

## 9. Monitoring (V1.5)

À ajouter dans le dashboard observabilité quand US-2153 (Loki) sera livré :

- Counter `audit_logs.action='RATE_LIMITED' resource='BACKUP'` / 1h
- Alerte si > 10 / hour (signal attaque ou bug UI en boucle)
- Latency p99 `POST /api/admin/backups`
- Ratio `429 / 202` (faible normal, élevé = saturation ou attaque)
