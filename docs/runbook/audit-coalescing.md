# Runbook — Audit log coalescing

**Owner** : Backend platform
**Statut** : Production (Plan B follow-up A3, 2026-05-28)
**Scope** : Réduction volume `audit_logs` sur events haute fréquence

---

## 1. Pourquoi

Le pattern actuel `auditService.log(...)` crée **1 row par event**. Pour les
endpoints READ list (patient search, dashboard analytics, polling CGM), un
utilisateur scrollant/filtrant peut générer 50+ rows en quelques secondes pour
le même tuple `(userId, action=READ, resource=PATIENT, resourceId="search")`.

À 100 ADMIN actifs scrollant la patient list 100×/jour :
- **1M rows / jour** uniquement sur le search list
- Coût stockage PG + I/O index `(userId, createdAt)` + bruit forensique CNIL

Le coalescing accumule les events identiques dans un buffer mémoire et **flush
1 row toutes les 30s** avec `metadata.coalesced.{count, firstAt, lastAt}`.

Gain attendu : **÷ 50 à ÷ 100** sur le volume audit_logs des routes coalescées.

---

## 2. Architecture

### Contrainte fondamentale

`audit_logs` est IMMUTABLE (trigger `audit_immutability.sql` interdit
UPDATE/DELETE). Le coalescing **ne peut PAS** être "UPDATE counter sur même
row" — il doit être INSERT-only via buffer mémoire.

### Buffer mémoire

```typescript
const buffer = new Map<string, BufferEntry>()
// key = `userId:action:resource:resourceId`
// BufferEntry = { baseEntry, count, firstAt, lastAt }
```

- 1ère occurrence d'un tuple → nouvelle entry avec `count=1, firstAt=now, lastAt=now, baseEntry={...}` (metadata du 1er event préservée).
- Occurrences suivantes → `count++, lastAt=now` (metadata variantes IGNORÉES).
- Cap dur `MAX_BUFFER_SIZE = 10_000` → flush immédiat si dépassé.

### Flush

Timer périodique `setInterval(30_000)` (`unref()` pour ne pas bloquer Node).
À chaque tick :
1. Snapshot buffer (`Array.from(buffer.values())`)
2. `buffer.clear()` atomique (JS event loop synchrone — pas de race)
3. `Promise.all` des `prisma.auditLog.create({ data: { ..., metadata: { ..., coalesced: { count, firstAt, lastAt } } } })`
4. Si INSERT fail → `logger.warn` (best-effort, row perdue)

### Shutdown handler

```typescript
process.once("SIGTERM", drain)
process.once("SIGINT", drain)
```

Drain le buffer avant exit. Sans ça, un `kill -TERM` perdrait jusqu'à 30s
d'events.

⚠️ **Pas de drain sur SIGKILL** (impossible par design). Acceptable car les
events coalescés sont par construction "peu critiques forensiquement".

---

## 3. Critères d'adoption

### ✅ Whitelist (coalescer)

| Action | Resource | Justification |
|---|---|---|
| `READ` | `PATIENT` `resourceId="search"` | List view avec pagination/filtres |
| `READ` | `ANALYTICS` list | Dashboard polling |
| `READ` | `CGM_ENTRY` (futur) | Mobile polling 5 min |
| `IDEMPOTENT_REPLAY` | `IDEMPOTENCY` | Déjà fréquent via PR #462 |

### ❌ Blacklist (toujours `auditService.log`)

| Action | Raison |
|---|---|
| `CREATE` / `UPDATE` / `DELETE` | Forensique HDS L.1111-8 exige 1:1 |
| `LOGIN` / `LOGOUT` / `UNAUTHORIZED` | Sécurité visibilité 1:1 |
| `MFA_*` | Auth events critiques |
| `BOLUS_CALCULATED` | Safety clinique (immutable per-event) |
| `EXPORT` | RGPD Art. 20 traçabilité |
| `READ` sur ressource **individuelle** (ex: PATIENT/42) | PHI individuel = forensique 1:1 |

### Critère de décision (3 questions)

1. **Cet event est-il consulté individuellement en forensique CNIL/ANS ?**
   - Oui → `auditService.log` (1:1)
   - Non, on regarde des volumes / patterns → coalesce candidate
2. **L'event est-il déclenché par une action humaine consciente ?**
   - Oui (CREATE patient) → 1:1
   - Non (polling, scroll, refresh) → coalesce candidate
3. **L'event a-t-il un impact PHI direct ?**
   - Oui (mutation, individual read) → 1:1
   - Non (list view, count) → coalesce candidate

---

## 4. Pattern d'adoption

```typescript
// AVANT (1 row par event)
await auditService.log({
  userId,
  action: "READ",
  resource: "PATIENT",
  resourceId: "search",
  metadata: { count: results.length, hasSearch: true },
})

// APRÈS (coalescé)
await auditService.logCoalesced({
  userId,
  action: "READ",
  resource: "PATIENT",
  resourceId: "search",
  metadata: { count: results.length, hasSearch: true },
})
```

### Trade-off métadata

La metadata de la 1ère occurrence est préservée — les variantes au sein de la
fenêtre 30s sont perdues. Pour une route list view :
- `count` (résultats retournés) → uniquement 1ère valeur visible
- `hasSearch` (boolean) → 1ère valeur (acceptable car peu volatile)

Si vous AVEZ besoin du `count` exact post-coalescing, gardez `auditService.log`.

---

## 5. Forensique HDS

### Lecture d'une row coalescée

```sql
SELECT user_id, action, resource, resource_id,
       metadata->'coalesced'->>'count' AS occurrences,
       metadata->'coalesced'->>'firstAt' AS first_event_at,
       metadata->'coalesced'->>'lastAt' AS last_event_at
FROM audit_logs
WHERE action = 'READ'
  AND resource = 'PATIENT'
  AND resource_id = 'search'
  AND user_id = 42
  AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;
```

### Reconstruction du timeline

Le coalescing introduit un délai de jusqu'à 30s entre l'event réel et la row
DB. Pour les forensiques fines :
- `metadata.coalesced.firstAt` = timestamp du 1er event de la fenêtre
- `metadata.coalesced.lastAt` = timestamp du dernier event
- `created_at` = timestamp du flush (≤ lastAt + 30s)

### Reconnaître une row coalescée vs row standard

```sql
-- Coalescée
metadata->'coalesced' IS NOT NULL

-- Standard
metadata->'coalesced' IS NULL
```

---

## 6. Anti-patterns

- ❌ Ne PAS coalescer une mutation (CREATE/UPDATE/DELETE) — HDS 1:1 obligatoire.
- ❌ Ne PAS coalescer une route avec `resourceId` variable (ex: PATIENT/42)
  → chaque ID crée une key distincte = pas de gain + bruit buffer.
- ❌ Ne PAS supposer que `flush()` est synchrone — il est appelé dans le timer
  ou drain. Pour les tests, appeler `flush()` manuellement après l'action.
- ❌ Ne PAS s'appuyer sur le coalescing pour la sécurité (alertes SOC, burst
  detection). Utiliser `auditService.accessDenied` / `requireStepUp` qui sont
  câblés US-2265.

---

## 7. Monitoring (V1.5)

À ajouter dans US-2153 (Loki) :

- `audit.coalesce.cap_reached` (warn — buffer plein, force flush)
- `audit.coalesce.insert_failed` (warn — flush DB fail)
- `audit.coalesce.shutdown_drain` (info — SIGTERM observé)
- `audit.coalesce.shutdown_drain_failed` (warn — drain n'a pas pu vider)
- Métrique buffer.size (gauge — alerte si > 5000 sustained)
- Ratio coalesced_count / total_audit_inserts (volumetry validation)

---

## 8. DPIA — Impact RGPD

**Données traitées** : aucune PHI dans le buffer mémoire (les rows sont
déjà non-PHI per criteria §3). Le coalescing ne change pas la nature des
données.

**Risques résiduels** :

1. **Perte d'events sur SIGKILL** — jusqu'à 30s de READ list non-tracés.
   Acceptable car coalescés = par définition non-critiques 1:1.
2. **Délai forensique 30s** — un audit CNIL recherchant "qui a accédé à
   `PATIENT/search` à 14:30:15 exact" peut trouver une row à 14:30:45
   (timestamp flush). Métadata `firstAt`/`lastAt` permet reconstruction.
3. **Metadata variante perdue** — voir §4 trade-off.

**Base légale** : intérêt légitime du responsable de traitement (RGPD Art.
6.1.f) — sécurité du traitement (réduction surface I/O DB → meilleure
résilience).

---

## 9. Rollout

1. **Adoption progressive** — la PR initiale wrap 2 sites (`patientService.search`
   sur les 2 chemins). Les autres candidates (`ANALYTICS`, `CGM_ENTRY`) sont
   adoptables au case-by-case.
2. **Monitoring** — surveiller `audit.coalesce.*` logs pendant la 1ère semaine.
3. **Rollback** — si problème : `git revert` du commit. La feature est opt-in
   (chaque caller choisit `log` vs `logCoalesced`) — pas de rollback DB.

V1.5 envisagé :
- Migration `auditLog.created_at` index partiel `WHERE metadata @> '{"coalesced": {}}'` si forensique queries deviennent lentes.
- Métriques Prometheus expose buffer.size + flush latency.
