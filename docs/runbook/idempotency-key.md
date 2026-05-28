# Runbook — Idempotency-Key

**Owner** : Backend platform
**Statut** : Production (Plan B follow-up A1 round 2, 2026-05-28)
**Scope** : Toutes les routes Next.js `POST / PUT / PATCH / DELETE` mutantes

---

## 1. Pourquoi

Sans dédup côté serveur, un double-click ADMIN sur "Suspendre l'utilisateur" produit :

- Deux mutations Prisma (la 2e souvent NOOP, mais...)
- **Deux entrées audit log** → traçabilité HDS L.1111-8 polluée
- Deux JWT revoke (US-2148) → double broadcast Redis
- Sur `data-breaches/transition` : **double notification CNIL** (RGPD Art. 33)

Le frontend (Plan B PR #457-#461) envoie déjà `Idempotency-Key: <UUID v4>` via
`crypto.randomUUID()`. Le wrapper `withIdempotency` ferme la boucle backend.

---

## 2. Contrat client

```http
PATCH /api/admin/users/42
Idempotency-Key: a3f9b8c2-4d56-4e89-8f12-345678abcdef
X-Requested-With: XMLHttpRequest    ← REQUIS (anti-CSRF middleware) sur le 1er appel
Content-Type: application/json

{ "role": "DOCTOR" }
```

| Cas | Conditions | Response |
|---|---|---|
| Pas de header | Header absent | Handler exécute (rétro-compat) |
| Header invalide | Pas UUID v4 strict | `400 invalidIdempotencyKey` |
| Body > 64 KB | `Content-Length` ou body lu | `413 requestBodyTooLarge` |
| Rate-limit dépassé | > 1000 idem writes/h/user | `429 idempotencyRateLimited` + `Retry-After` |
| Premier appel | Header présent, miss cache | Handler exécute + response cachée 24h |
| Race window | Lock PENDING acquis par autre req | `409 idempotencyInProgress` + `Retry-After: 5` |
| Replay valide | Même key + **même body hash** | Response cachée + `X-Idempotency-Replayed: true` |
| Mismatch | Même key + body différent | `409 idempotencyMismatch` + audit `accessDenied` |

**Scope** : par utilisateur authentifié (lookup via `x-user-id` injecté par
middleware JWT). Empêche cross-user replay.

**TTL** : 24h (RFC 7231 Retry-After convention).

**Statuts cachés** : 2xx + 4xx **sauf** 408/423/425/429 (transient, retry attendu).
5xx jamais cachés.

**Content-Type** : `application/json` (+ `application/problem+json`) uniquement.
Pour les routes binaires (PDF stream, S3) — wrapper exécute le handler mais ne
cache pas la response.

### Ordre middleware → wrapper (H-CR-1)

Le middleware Next.js valide CSRF (`X-Requested-With`) **avant** que le wrapper
ne soit appelé. Le wrapper ne peut PAS observer les 403 du middleware → un 1er
appel sans `X-Requested-With` retourne 403 (rien caché), un 2e avec retourne le
résultat réel. Le **client doit envoyer `X-Requested-With` sur la 1re tentative**
sinon le replay n'a rien à replayer.

---

## 3. Adopter sur une nouvelle route

```ts
// src/app/api/.../route.ts
import { withIdempotency } from "@/lib/idempotency/with-idempotency"

async function patchHandler(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // ... ton handler classique
}

export const PATCH = withIdempotency(patchHandler, {
  route: "admin/foo/[id] PATCH", // utilisé pour audit metadata + log
})
```

**Routes actuellement wrappées** (PR #462 round 2) :

- `PATCH /api/admin/users/[id]` (PR #461 — iter 5 UI)
- `POST /api/admin/data-breaches/[id]/transition` (PR #457 — FSM critique RGPD)
- `PUT /api/cabinet/[id]/settings` (PR #459)

**Routes restantes à wrapper en follow-up** :

- `PATCH /api/admin/data-breaches/[id]` (declare/update)
- `PATCH /api/billing/invoices/[id]` (cancel/refund) — voir issue tracker
- `POST /api/billing/invoices/[id]/pdf` (idempotent côté service mais bénéficierait)
- `PUT /api/account/*` (user self-service — moins critique, double-submit rare)

**Best practice frontend** :

```ts
const idemKey = crypto.randomUUID() // UUID v4 garanti
const res = await fetch("/api/admin/users/42", {
  method: "PATCH",
  headers: {
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",  // CSRF guard backend (H-CR-1)
    "Idempotency-Key": idemKey,
  },
  body: JSON.stringify({ role: "DOCTOR" }),
})
if (res.headers.get("X-Idempotency-Replayed") === "true") {
  // Replay → pas besoin de re-toaster "success", juste afficher l'état.
}
if (res.status === 409 && (await res.json()).error === "idempotencyInProgress") {
  // Race window — autre requête en cours, retry dans 5s.
  // Affichage UX : "Action en cours, veuillez patienter…"
}
```

---

## 4. Stockage

- **Production** : Upstash Redis (clé `${REDIS_KEY_PREFIX}idem:u<userId>:<idemKey>`).
- **Dev/test** : `Map` in-memory LRU cap **1000 entries** (H-CR-4 — anti OOM
  si Upstash absent en prod). Eviction FIFO insertion order.
- **Fail-open** : si Redis unreachable, lookup retourne `miss` et store
  silencieusement. La requête réussit sans dédup — meilleur que de bloquer.

**Clé Redis** : `diabeo:prod:idem:u42:a3f9b8c2-4d56-4e89-8f12-345678abcdef`

**Valeur stockée** (auto-sérialisée par Upstash SDK — pas de `JSON.stringify`
manuel — fix CRITICAL C-HSA-1 round 2) :

```json
{
  "bodyHash": "<sha256 hex du body request>",
  "status": 200,
  "bodyEnc": "<base64 AES-256-GCM encrypted response body>",
  "headers": { "content-type": "application/json", "x-request-id": "..." },
  "ttlAt": 1748100000000
}
```

### Chiffrement applicatif AES-256-GCM (H-HSA-1)

Le body de la response est **chiffré via `encryptField()`** avant stockage.
Upstash chiffre at-rest, mais c'est de la défense en profondeur conforme ADR #2
("données protégées même si la BDD/cache est compromise"). Clé : la même
`HEALTH_DATA_ENCRYPTION_KEY` que les colonnes PHI Prisma.

### NX advisory lock (H-CR-3)

Sur miss → wrapper acquiert un sentinel `"PENDING"` (TTL 60s) via `SET NX EX`.
Une 2e requête concurrente même clé+body → lookup retourne `in_progress` →
`409 idempotencyInProgress` avec `Retry-After: 5`. Empêche le double side-effect
(audit + JWT revoke + notif CNIL) en cas de double-submit simultané.

Le lock est libéré :
- automatiquement par `store()` (write entry chiffrée).
- explicitement par `releasePending()` si handler renvoie 5xx/408/423/425/429
  (transient → retry doit pouvoir succès) ou non-JSON (skip cache).
- explicitement par `releasePending()` si handler throw.
- automatiquement par expiration TTL 60s en dernier recours.

---

## 5. Forensique HDS

### Replay (H-HSA-2)
Sur replay valide → handler PAS appelé (anti-spam audit) → un audit `READ /
IDEMPOTENCY` léger est émis avec `metadata.kind: "replay"`. Reconstitue
"l'ADMIN a tenté 3 fois (peut-être hésitation, peut-être bug UI)" forensique
CNIL/ANS.

### Mismatch (H-HSA-4)
Sur mismatch → `auditService.accessDenied()` US-2265 burst detection +
`logger.warn` avec `kind: "idem.mismatch"`. Cas usuels :

1. **Bug frontend** : `useState` partagé, key régénéré à chaque render.
2. **Retry sauvage** : un script tape la même UUID dans une boucle qui change
   le body. Scope per-user empêche d'affecter d'autres users.
3. **Bot** : tentative d'oracle. US-2265 burst detection triggera l'alerte SOC.

Log côté serveur :

```
[WARN] idempotency: key reused with different body
  kind: "idem.mismatch"
  requestId: "abc123…"
  action: "admin/users/[id] PATCH"
  userId: 42
  key: "a3f9b8c2…"
```

**Pas de payload loggué** (anti-PHI : un body utilisateur peut contenir un nom).

### Headers de response sur replay (H-HSA-3)

Les headers originaux sont **préservés** sauf une denylist :
- `Set-Cookie` — re-injecter un cookie ancien = confusion auth
- `Date` — recalculé par Next.js
- `Content-Length` — recalculé
- `Connection`, `Transfer-Encoding` — hop-by-hop RFC 7230

Tous les autres (`Cache-Control`, `X-Content-Type-Options`, `Referrer-Policy`,
custom `X-*`) sont rejoués. Le `Cache-Control: no-store, no-cache,
must-revalidate, private` est **toujours forcé** ANSSI RGS §4.5 sur les 3
chemins (400/409/replay).

---

## 6. Rotation / purge

- TTL 24h → auto-expiration Redis.
- Pas de purge manuelle nécessaire en fonctionnement nominal.

### Purge manuelle d'urgence (Redis CLI Upstash)

```bash
# Lister les keys d'un user (REST API Upstash via curl ou upstash-cli)
curl https://<your-redis>.upstash.io/keys/diabeo:prod:idem:u42:* \
  -H "Authorization: Bearer <REDIS_TOKEN>"

# Purger un user (RGPD Art. 17 manuelle)
curl https://<your-redis>.upstash.io/del/diabeo:prod:idem:u42:* \
  -H "Authorization: Bearer <REDIS_TOKEN>"
```

### Purge automatique RGPD Art. 17

`deleteUserAccount()` (`deletion.service.ts`) appelle
`idempotencyService.purgeUserKeys(userId)` après commit. Best-effort —
si la purge échoue, le TTL 24h finit le travail. Log `kind:
"idem.purge.gdpr_art17"` avec `deletedCount` pour traçabilité.

### Rotation `REDIS_KEY_PREFIX`

Si passage `prod` → `prod-v2` :
- Les anciennes clés deviennent orphelines mais expirent en 24h.
- Pas de risque sécurité (les clés sont scope par user, le bodyEnc reste
  chiffré).
- Conseillé de faire la rotation en heure creuse pour éviter une fenêtre
  où toutes les actions ADMIN perdent leur dédup.

### Rotation `HEALTH_DATA_ENCRYPTION_KEY`

Si la clé est rotée alors qu'un entry est cached avec l'ancienne clé →
`safeDecryptField` retourne `null` → lookup retourne `miss` → handler
ré-exécute. Comportement attendu et safe (pas de fuite).

---

## 7. Métriques / alertes (V1.5)

À ajouter dans le dashboard observabilité quand US-2153 (Loki) sera livrée.
Le service émet déjà ces `kind` structurés :

- `idem.lookup.miss` / `idem.lookup.replay` / `idem.lookup.mismatch`
- `idem.lookup.failed` (Redis dégradé — alerte si > 100/h)
- `idem.lookup.invalid_entry` (collision namespace ou corruption — investiguer)
- `idem.lookup.decrypt_failed` (clé rotée ou data corrompue)
- `idem.store.success` / `idem.store.failed` / `idem.cache.too_large`
- `idem.cache.skip_non_json` (route binaire wrappée par erreur)
- `idem.lock.failed` / `idem.release.failed`
- `idem.mismatch` / `idem.audit.failed`
- `idem.memory_fallback.production` (**ALERTE CRITICAL** — Upstash down en prod)
- `idem.purge.gdpr_art17` (audit RGPD Art. 17 purge)

Ratio attendu en production normale :
- `replay / miss` < 5 % (au-delà = double-submit systémique UI à investiguer)
- `mismatch / total` < 0.1 % (au-delà = bug client probable)
- `failed / total` < 0.01 % (au-delà = Upstash dégradé)

---

## 8. Pourquoi UUID v4 strict

- **Évite le tracking** : un client malicieux pourrait envoyer un identifiant
  prédictible (`Idempotency-Key: <email_de_la_victime>`) pour leak via
  cross-user. Le scope per-user empêche déjà cette attaque, mais format strict
  = défense en profondeur.
- **Cohérent client** : tous les browsers modernes ont `crypto.randomUUID()`.
- **Entropie** : 122 bits aléatoires → collision pratique impossible.

---

## 9. Anti-patterns

- ❌ Ne PAS cacher les responses 5xx ou 408/423/425/429 (transient — retry
  attendu).
- ❌ Ne PAS hasher le body **après** parsing JSON (les whitespace différents
  produiraient des hash différents → mismatch faux positifs). Le wrapper hash
  le body brut bytewise.
- ❌ Ne PAS exposer le payload caché à un autre user (scope per-user obligatoire).
- ❌ Ne PAS appliquer sur les routes GET (idempotentes par définition HTTP).
- ❌ Ne PAS appliquer sur les routes binaires (PDF, S3 stream). Le wrapper
  détecte le Content-Type et skip le cache, mais autant ne pas wrapper.
- ❌ Ne PAS oublier `X-Requested-With: XMLHttpRequest` côté client (anti-CSRF
  middleware — H-CR-1).
- ❌ Ne PAS re-sérialiser le body entre 1er appel et retry (ordre des clés JSON
  différent → 409 mismatch faux positif). Bytewise stability requise.

---

## 10. DPIA — Impact RGPD du cache idempotent

**Données traitées** : responses HTTP de routes mutantes ADMIN. Peuvent
contenir des PII (`User.email/firstname/lastname` déchiffrés sur retour
`/admin/users/[id]`) ou métadonnées non-sensibles (`{role, status, changed}`).

**Mesures** :
- Chiffrement applicatif AES-256-GCM via `encryptField` (clé
  `HEALTH_DATA_ENCRYPTION_KEY`).
- TTL 24h (proportionnel à l'usage retry).
- Scope per-user (anti cross-user replay).
- Purge cascade sur RGPD Art. 17 (`deleteUserAccount`).
- Hébergement Upstash : **vérifier région contrat** (`fra1` Frankfurt pour
  RGPD strict — pas de transfert hors-UE).

**Base légale** : intérêt légitime du responsable de traitement (RGPD Art. 6.1.f)
pour garantir la cohérence audit HDS L.1111-8 (pas de double-mutation
silencieuse). Pas de consentement requis (traitement infrastructure).

**Risques résiduels** :
- Si Upstash région US accidentellement utilisée → transfert hors-UE Art. 44+
  (SCC + DPA requis). À documenter en pré-prod.
- Si rotation `HEALTH_DATA_ENCRYPTION_KEY` mal gérée → orphans cache de 24h
  avec ancienne clé (safe via fail-open mais coût UX double-submit).
