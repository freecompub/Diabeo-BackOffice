# Runbook — Audit log coalescing

**Owner** : Backend platform / Security
**Statut** : Production (Plan B follow-up A3 round 2, 2026-05-28)
**Scope** : Module infrastructure prêt — **AUCUNE adoption ne shippe en V1**

---

## 1. Pourquoi

Le pattern `auditService.log(...)` crée **1 row par event**. Pour des READ list
views (futures adoptions V1.5 : dashboard polling, IDEMPOTENT_REPLAY haute
fréquence), un user peut générer 50+ rows / seconde pour le même tuple. Le
coalescing accumule les events identiques dans un buffer mémoire et **flush
1 row toutes les 30s** avec `metadata.coalesced.{count, firstAt, lastAt}`.

**Gain attendu** : ÷ 50 à ÷ 100 sur les routes coalescées (PAR container —
voir §10 multi-instance).

> ⚠️ **A3 round 2 — Scope minimum honnête** : La PR initiale livre le module
> + tests + migration index. **AUCUNE adoption Diabeo n'est shippée**. Le
> path `patientService.search` qui avait été initialement adopté a été
> retiré round 2 (HSA CRITICAL : PHI list view + metadata variance →
> coalescing inefficace + violation §3 critères). Les V1.5 candidates
> nécessitent validation HSA formelle (§11).

---

## 2. Architecture

### Contrainte fondamentale

`audit_logs` est IMMUTABLE (trigger PG `audit_immutability.sql` interdit
UPDATE/DELETE). Le coalescing **doit être INSERT-only** via buffer mémoire.

### Buffer mémoire

```typescript
const buffer = new Map<string, BufferEntry>()
// key = `userId\0action\0resource\0resourceId` (A3 round 2 H-5 NULL byte
//        separator anti-injection)
// BufferEntry = { baseEntry, count, firstAt, lastAt }
```

- 1ère occurrence → nouvelle entry (`count=1, firstAt=now, lastAt=now, baseEntry={...}`).
- Occurrences suivantes → `count++, lastAt=now` (metadata variantes IGNORÉES).
- Cap dur `MAX_BUFFER_SIZE = 10_000` → flush déclenché en **fire-and-forget**
  (A3 round 2 M-4 — le caller ne paie plus la latence).

### Flush

Timer périodique `setInterval(30_000)` :
- `unref()` UNIQUEMENT en non-production (tests/CLI). En prod, le timer
  empêche correctement Node de quitter avec buffer non vidé.
- Tick = `Array.from(buffer.values())` + `buffer.clear()` (atomique JS) +
  `prisma.auditLog.createMany({ data })` batch (A3 round 2 M-10 — 1
  round-trip vs N).
- Sur fail batch → fallback per-row INSERT pour isoler les rows qui passent
  vs celles qui fail.
- Sur fail per-row → `logger.warn` avec `kind: "audit.coalesce.events_lost"`
  + structured payload pour reconstruction forensique via Loki.

### Shutdown handler

```typescript
process.once("SIGTERM", drain)
process.once("SIGINT", drain)
```

`drain()` :
1. Log structured `audit.coalesce.shutdown_drain`
2. `clearInterval(flushTimer)`
3. `await flush()`
4. **`process.exit(0)`** (A3 round 2 C-4 — sans ça, Node ne termine PAS
   après SIGTERM car un listener supprime le comportement default → Docker
   stop perd quand-même 30s d'events via SIGKILL après timeout).

⚠️ **Pas de drain sur SIGKILL / OOM / uncaughtException** (impossible par
design). Acceptable car les events coalescés sont par construction "peu
critiques forensiquement" — voir §8 DPIA et §11 V1.5 critères.

---

## 3. Critères d'adoption (validation HSA requise V1.5)

### ✅ Whitelist potentielle (sous validation HSA)

| Action | Resource | Caveat |
|---|---|---|
| `IDEMPOTENT_REPLAY` | `IDEMPOTENCY` | À valider : signal rejeu attaque (LOW-5) |
| Dashboard polling list (futur) | `ANALYTICS` | resourceId uniforme + metadata non-PHI |

### ❌ Blacklist (toujours `auditService.log` 1:1)

| Action | Raison |
|---|---|
| `CREATE` / `UPDATE` / `DELETE` | Forensique HDS L.1111-8 exige 1:1. **Refusé par assertion service-level** (L-4). |
| `LOGIN` / `LOGOUT` / `UNAUTHORIZED` | Sécurité visibilité 1:1. |
| `MFA_*` | Auth events critiques. |
| `BOLUS_CALCULATED`, `EXPORT` | Safety clinique + RGPD Art. 20. |
| Path "user authentifié sans permission" | Sémantique RBAC failure → `accessDenied` US-2265 (cf. C-2 fix). |
| `READ` PHI list view (firstname/lastname/glucoseValue dans metadata) | Forensique CNIL "patient exposés" requiert 1:1. |
| `READ` ressource individuelle (PATIENT/42) | PHI individuel = forensique 1:1. |

### Critères de décision (5 questions)

1. **Cet event est-il consulté individuellement en forensique CNIL/ANS ?**
   - Oui → 1:1
   - Non, volumes/patterns uniquement → coalesce candidate
2. **L'event est-il déclenché par action humaine consciente ?**
   - Oui (CREATE patient) → 1:1
   - Non (polling, scroll, refresh) → coalesce candidate
3. **L'event a-t-il un impact PHI direct ?**
   - Oui (mutation, individual read, list returning PHI fields) → 1:1
   - Non (count, hasSearch) → coalesce candidate
4. **L'event est-il un indicateur de comportement attaquant ?** (A3 round 2 LO-5)
   - Oui (UNAUTHORIZED, IDEMPOTENT_REPLAY massif, MFA fail) → 1:1 + burst US-2265
   - Non → coalesce candidate
5. **La metadata est-elle uniforme dans la fenêtre 30s ?**
   - Oui → coalesce candidate
   - Non (count varie, pathology varie) → 1:1 (sinon metadata 1ère wins
     fait perdre la valeur forensique)

---

## 4. Pattern d'adoption (V1.5)

```typescript
// AVANT (1 row par event)
await auditService.log({
  userId, action: "READ", resource: "ANALYTICS",
  resourceId: "dashboard",
  metadata: { polling: true },
})

// APRÈS (coalescé — V1.5)
await auditService.logCoalesced({
  userId, action: "READ", resource: "ANALYTICS",
  resourceId: "dashboard",
  metadata: { polling: true },
})
```

> ⚠️ **A3 round 2 M-2 SÉMANTIQUE** : `await logCoalesced(...)` NE GARANTIT PAS
> la persistance DB. L'event est en buffer mémoire. Si le process crash entre
> l'enqueue et le flush, l'event est perdu. Pour les events critiques
> forensiquement → utiliser `auditService.log()` (1:1 INSERT synchrone).

### Trade-off metadata

La metadata de la 1ère occurrence est préservée — les variantes au sein de
la fenêtre 30s sont perdues. À considérer :
- `count` (résultats variables) → seule 1ère valeur visible → si forensique
  CNIL "total exposition" est requise, **garder `auditService.log`**.
- `requestId` (US-2076 corrélation HDS §IV.3) → 1ère valeur — corrélation
  audit ↔ stderr cassée pour les N-1 occurrences suivantes. **Documenter
  cette limitation côté forensique**.
- `ipAddress`/`userAgent` → 1ère valeur. Si l'utilisateur change d'IP en
  cours de fenêtre (basculement réseau), la row coalescée ne le montre pas.

---

## 5. Forensique HDS

### Lecture d'une row coalescée

```sql
SELECT user_id, action, resource, resource_id,
       metadata->'coalesced'->>'count' AS occurrences,
       metadata->'coalesced'->>'firstAt' AS first_event_at,
       metadata->'coalesced'->>'lastAt' AS last_event_at,
       metadata - 'coalesced' AS original_metadata
FROM audit_logs
WHERE metadata ? 'coalesced'
  AND action = 'READ'
  AND resource = 'ANALYTICS'
  AND user_id = 42
  AND created_at > NOW() - INTERVAL '7 days'
ORDER BY (metadata->'coalesced'->>'firstAt')::timestamptz DESC;
```

> **Index requis** : migration `20260528160000_a3_audit_coalesced_gin_index`
> crée `audit_logs_metadata_coalesced_gin_idx` (GIN partial avec
> `jsonb_path_ops`) — query < 100ms à 10M rows.

### Reconnaître une row coalescée vs row standard

```sql
-- Coalescée
WHERE metadata ? 'coalesced'

-- Standard
WHERE NOT (metadata ? 'coalesced')
```

### Délai forensique

Le coalescing introduit un délai jusqu'à 30s entre l'event réel et la row
DB. Pour les forensiques fines :
- `metadata->'coalesced'->>'firstAt'` = timestamp du 1er event de la fenêtre
- `metadata->'coalesced'->>'lastAt'` = timestamp du dernier event
- `created_at` = timestamp du flush (≤ `lastAt` + 30s)

⚠️ Une query forensique "qui a accédé à X entre 14:30:00 et 14:30:15" doit
filtrer sur `firstAt` / `lastAt` (pas `created_at`) pour ne pas manquer
les events flushés après la fenêtre demandée.

---

## 6. Anti-patterns

- ❌ Ne PAS coalescer une mutation (CREATE/UPDATE/DELETE) — **bloqué par
  assertion service-level** (L-4).
- ❌ Ne PAS coalescer une route avec `resourceId` variable (ex: PATIENT/42)
  → chaque ID crée une key distincte = pas de gain + bruit buffer.
- ❌ Ne PAS supposer que `flush()` est synchrone — il est appelé dans le
  timer ou drain. Pour les tests, appeler `flush()` manuellement après
  l'action.
- ❌ Ne PAS s'appuyer sur le coalescing pour la sécurité (alertes SOC, burst
  detection). Utiliser `auditService.accessDenied` / `requireStepUp`.
- ❌ Ne PAS coalescer un event avec `userId=null` (anon) sur une route
  user-scopée — tous les anons partageraient la même key. Le service refuse
  les mutations (L-4) mais pas explicitement les anons — défense documentaire
  uniquement.
- ❌ Ne PAS hardcoder `metadata.coalesced` côté caller — c'est le service
  qui l'ajoute au flush.

---

## 7. Monitoring (V1.5 — US-2153 Loki reportée V2)

Le service émet ces `kind` structurés (taxonomie centralisée dans
`COALESCE_LOG_KINDS`) :

- `audit.coalesce.cap_reached` (warn — buffer plein, flush fire-and-forget)
- `audit.coalesce.insert_failed` (warn — batch createMany fail, fallback per-row)
- `audit.coalesce.events_lost` (warn — per-row INSERT fail, **event perdu**)
- `audit.coalesce.consecutive_failures` (warn — counter incrémenté à chaque
  flush dégradé. Si > 10 → DB en panne prolongée → escalade ops.)
- `audit.coalesce.shutdown_drain` (info — SIGTERM/SIGINT observé)
- `audit.coalesce.shutdown_drain_failed` (warn — drain n'a pas pu vider)

Métriques V1.5 attendues :
- Gauge `buffer.size` (alerte si > 5000 sustained)
- Counter `events_lost_total` (alerte si > 0 / heure)
- Counter `consecutive_failures` (alerte si > 5)
- Ratio `coalesced_count / total_audit_inserts`

⚠️ **A3 round 2 M-9** — Tant que US-2153 (Loki) n'est pas livré, ces warns
vont uniquement dans stderr. **Bloque l'adoption V1.5** sur des routes
sensibles. Pour V1, le module reste outillage prêt sans adoption.

---

## 8. DPIA — Impact RGPD

**Données traitées** : aucune PHI dans le buffer mémoire (whitelist §3
exclut metadata PHI). Le coalescing ne change pas la nature des données
persistées dans `audit_logs`.

**Base légale** (A3 round 2 LOW-5 reformulé) :
- **RGPD Art. 5.1.c minimisation** (vs Art. 6.1.f précédent — incorrect car
  6.1.f justifie l'existence du traitement, pas sa réduction) : la
  proportionnalité du tracking 1:1 vs la finalité forensique est analysée
  ci-dessous.
- Le responsable de traitement (Diabeo) atteste sous sa responsabilité que
  le coalescing préserve la finalité forensique pour les events sélectionnés
  selon §3 (validation case-by-case par DPO + HSA).

**Risques résiduels documentés** :

1. **Perte d'events sur SIGKILL/OOM/uncaughtException** — jusqu'à 30s de
   READ list non-tracés. Acceptable car coalescés = par définition
   non-critiques 1:1. **Mais** un attaquant qui détecte burst detection
   imminent peut crash le process volontairement → mitigation :
   `STEP_UP_WINDOW_SECONDS` low (5min) + monitoring `events_lost`.

2. **Délai forensique 30s** — query naïve `created_at BETWEEN X AND Y` peut
   manquer events. Utiliser `firstAt`/`lastAt`. Documenté §5.

3. **Metadata variante perdue** — voir §4 trade-off.

4. **Multi-instance Docker** — N rows coalescées par container (voir §10).

5. **Buffer mémoire non-chiffré** — pas de PHI aujourd'hui (whitelist §3
   exclut). Tape latente V1.5 si CGM_ENTRY polling ajouté avec metadata
   `glucoseValue` → memory dump exposerait PHI. **MITIGATION** : refus
   explicite §3 + assertion dev (V1.5).

6. **`requestId` perdu après 1ère occurrence** — corrélation HDS §IV.3
   cassée pour N-1 events. Documenté §4.

7. **`ipAddress` change session intra-fenêtre** — détection session
   hijacking dégradée sur la fenêtre coalescée.

---

## 9. Rollback

**Code rollback** : `git revert <commit>`.

⚠️ **A3 round 2 H-6** — les rows déjà insérées avec `metadata.coalesced`
restent dans `audit_logs` (immutables par trigger PG). Conséquence :
- La forensique post-rollback aura un mix "rows pré-coalescing 1:1" +
  "rows coalescées période X" + "rows post-rollback 1:1".
- Si on découvre après coup que la sémantique coalescée a corrompu une
  exigence forensique, on ne peut PAS reconstituer le détail des events
  agrégés (count est connu, mais pas les `requestId`/`ipAddress`/metadata
  variantes individuels).

**Pre-deploy checklist** :
- [ ] Signature DPO sur DPIA §8 (forensique trade-off accepté)
- [ ] Signature RSSI sur perte événements SIGKILL (§8 risque #1)
- [ ] Sign-off Ops sur procédure recovery (Redis spillover V2)
- [ ] Monitoring `audit.coalesce.events_lost` configuré (alerte > 0/h)
- [ ] Index `audit_logs_metadata_coalesced_gin_idx` créé en pre-prod et
      validé `EXPLAIN ANALYZE < 100ms` à dataset 1M rows

**Rollback DB** : la migration index peut être annulée :

```sql
DROP INDEX CONCURRENTLY audit_logs_metadata_coalesced_gin_idx;
```

---

## 10. Multi-instance Docker (A3 round 2 H-2)

Le buffer est **process-local** (`new Map<>`). Le déploiement Diabeo est
Docker Compose → scaling horizontal probable en V1 (`app: replicas: N`).

**Impact** : chaque container a son propre buffer + son propre timer. Pour
un même user qui fait 50 searches load-balancées sur 5 containers, on
obtient **5 rows coalescées (count ≈ 10 chacune)** au lieu de **1 row
(count = 50)**.

**Gain réel** : ÷ 50 / N_containers (pas ÷ 50 à ÷ 100 comme estimation
initiale).

**Query forensique agrégée** :

```sql
SELECT
  user_id,
  action,
  resource,
  resource_id,
  date_trunc('hour', (metadata->'coalesced'->>'firstAt')::timestamptz) AS hour_bucket,
  SUM((metadata->'coalesced'->>'count')::int) AS total_occurrences,
  COUNT(*) AS container_rows
FROM audit_logs
WHERE metadata ? 'coalesced'
  AND user_id = 42
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY user_id, action, resource, resource_id, hour_bucket
ORDER BY hour_bucket DESC;
```

**V2 envisagé** : buffer partagé Redis Upstash (déjà ADR Diabeo) avec atomic
`INCR` cross-container — gain ÷ 50 reproductible sans dégradation
forensique. Hors scope V1.

---

## 11. V1.5 candidates (validation HSA case-by-case requise)

| Route candidate | Critères §3 | Risques | Décision pending |
|---|---|---|---|
| `IDEMPOTENT_REPLAY` audit | OK 1+2+3+5 | LO-5 — signal rejeu attaque ? | DPO sign-off |
| Dashboard `READ ANALYTICS` polling | OK 1+2+3+5 | Si metadata `widgetId` varie → key explose | A/B test pre-prod |
| `READ MEDICAL_DOCUMENT` list (futur) | KO #3 — PHI list | — | **Refusé** |
| `READ CGM_ENTRY` polling (futur) | KO #3 — PHI direct | — | **Refusé** |
| `READ PATIENT search` | KO #3 + #5 (metadata variance) | C-1 + H-1 — retiré round 2 | **Refusé** |

---

## 12. Tests strategy (A3 round 2)

Couverture round 2 (30 cases unit) :
- Accumulation + key dedup
- Flush sémantique `{ attempted, succeeded, failed }`
- Mutations rejected (L-4)
- NULL byte injection rejected (H-5)
- Metadata 1ère wins + variantes ignorées
- `Prisma.JsonNull` / `Array` / primitive guards (M-1)
- Timer auto-flush via `vi.useFakeTimers` + `advanceTimersByTimeAsync` (C-5)
- SIGTERM + SIGINT drain via `process.emit` + spy `process.exit` (C-6)
- Idempotence `ensureTimerStarted` + `registerShutdownHook` (H-T2/T3)
- Race concurrent `Promise.all([enqueue×3, flush])` (H-T4)
- `__resetCoalescingForTests` symétrie complète (H-T6 — listeners, counter)
- All-fail scenario (`consecutiveFailures++`)
- Guards `__resetCoalescingForTests` + `__getBufferSnapshotForTests`
- `COALESCE_LOG_KINDS` taxonomy const

**Non couvert** (assumé) :
- Multi-instance Docker (test infrastructure)
- E2E adoption (aucune adoption shippée V1)
- Cap 10_001 réel (test long ~10s, validé via branch coverage code review)

---

*Module infrastructure prêt — première adoption V1.5 attendue après
signature DPO + monitoring US-2153 livré.*
