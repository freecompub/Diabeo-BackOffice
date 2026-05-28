# Runbook — Idempotency-Key

**Owner** : Backend platform
**Statut** : Production (Plan B follow-up A1, 2026-05-27)
**Scope** : Toutes les routes Next.js `POST / PUT / PATCH / DELETE` mutantes

---

## 1. Pourquoi

Sans dédup côté serveur, un double-click ADMIN sur "Suspendre l'utilisateur" produit :

- Deux mutations Prisma (la 2e échoue souvent en NOOP, mais...)
- **Deux entrées audit log** → tracabilité HDS L.1111-8 polluée (qui a fait quoi devient ambigu)
- Deux JWT revoke (US-2148) → 2 fois la révocation broadcast Redis

Le frontend (PR #461) envoie déjà `Idempotency-Key: <UUID v4>` mais le backend n'en
faisait rien. Le wrapper `withIdempotency` ferme cette boucle.

---

## 2. Contrat client

```http
PATCH /api/admin/users/42
Idempotency-Key: a3f9b8c2-4d56-4e89-8f12-345678abcdef
Content-Type: application/json

{ "role": "DOCTOR" }
```

| Cas | Conditions | Response |
|---|---|---|
| Pas de header | Header absent | Handler exécute (rétro-compat) |
| Header invalide | Pas UUID v4 strict | `400 invalidIdempotencyKey` |
| Premier appel | Header présent, miss cache | Handler exécute + response cachée 24h |
| Replay valide | Même key + **même body hash** | Response cachée + `X-Idempotency-Replayed: true` |
| Mismatch | Même key + body différent | `409 idempotencyMismatch` |

**Scope** : par utilisateur authentifié (lookup via `x-user-id` injecté par middleware JWT).
Empêche un user A et user B ayant tiré la même UUID au hasard (1 chance sur 2^122) de
voir leurs requêtes se confondre.

**TTL** : 24h (RFC 7231 Retry-After convention).

**Statuts cachés** : 2xx + 4xx. Les 5xx ne sont **pas** cachés (transient → le client doit
pouvoir retry sans `idempotencyMismatch`).

---

## 3. Adopter sur une nouvelle route

```ts
// src/app/api/.../route.ts
import { withIdempotency } from "@/lib/idempotency/with-idempotency"

async function patchHandler(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // ... ton handler classique
}

export const PATCH = withIdempotency(patchHandler, {
  route: "admin/foo/[id] PATCH", // utilisé en log warning si mismatch
})
```

**Best practice frontend** :

```ts
const idemKey = crypto.randomUUID() // UUID v4 garanti
const res = await fetch("/api/admin/users/42", {
  method: "PATCH",
  headers: {
    "Content-Type": "application/json",
    "Idempotency-Key": idemKey,
  },
  body: JSON.stringify({ role: "DOCTOR" }),
})
if (res.headers.get("X-Idempotency-Replayed") === "true") {
  // C'était un replay → pas besoin de re-toaster "success", juste afficher l'état.
}
```

---

## 4. Stockage

- **Production** : Upstash Redis (clé `${REDIS_KEY_PREFIX}idem:u<userId>:<idemKey>`).
- **Dev/test** : `Map` in-memory fallback (perte au restart, acceptable).
- **Fail-open** : si Redis unreachable, lookup retourne `miss` et store silencieusement.
  La requête réussit même sans dédup — meilleur que de bloquer une action ADMIN.

**Clé Redis** :

```
diabeo:prod:idem:u42:a3f9b8c2-4d56-4e89-8f12-345678abcdef
```

**Valeur** :

```json
{
  "bodyHash": "<sha256 hex>",
  "status": 200,
  "body": "<response JSON>",
  "contentType": "application/json",
  "ttlAt": 1748100000000
}
```

---

## 5. Forensics — debug d'un 409 mismatch

Si un user rapporte un `409 idempotencyMismatch`, c'est qu'il a **réutilisé la même
clé avec un body différent**. Cas usuels :

1. **Bug frontend** : `useState` partagé, key régénéré à chaque render. Logger côté
   navigateur le `crypto.randomUUID()` généré pour vérifier l'unicité.
2. **Retry sauvage** : un script tape la même UUID dans une boucle qui change le body.
   Le scope par-user empêche que ça affecte d'autres users.
3. **Bot** : tentative malicieuse pour exploiter une race. Le 409 est la défense.

Log côté serveur (kind `idempotency`) :

```
[WARN] idempotency: key reused with different body
  route: admin/users/[id] PATCH
  userId: 42
  key: a3f9b8c2…
```

Pas de payload loggué (anti-PHI : un body utilisateur peut contenir un nom).

---

## 6. Rotation / purge

- TTL 24h → auto-expiration Redis.
- Pas de purge manuelle nécessaire en fonctionnement nominal.
- Si rotation `REDIS_KEY_PREFIX` (ex: passage `prod` → `prod-v2`), les anciennes
  clés deviennent orphelines mais expirent en 24h. Pas de risque sécurité.

---

## 7. Métriques / alertes (V1.5)

À ajouter dans le dashboard observabilité quand US-2153 (Loki) sera livrée :

- `idem.lookup.miss` / `idem.lookup.replay` / `idem.lookup.mismatch` (counter)
- `idem.store.failed` (counter — alerte si > 100/h, Redis dégradé)
- Histogramme ratio `replay / miss` par route (anomalie si > 5%, indique double-submit
  systémique côté UI).

---

## 8. Pourquoi UUID v4 strict (et pas autres formats)

- **Évite le tracking** : un client malicieux pourrait envoyer `Idempotency-Key:
  <email_de_la_victime>` pour leak via cross-user (le scope par-user empêche cette attaque,
  mais format strict = défense en profondeur).
- **Cohérent client** : tous les browsers modernes ont `crypto.randomUUID()`.
- **Entropie** : 122 bits aléatoires → collision pratique impossible (vs UUID v1
  basé sur MAC = fingerprinting).

---

## 9. Anti-patterns

- ❌ Ne PAS cacher les responses 5xx (transient — retry doit pouvoir succès).
- ❌ Ne PAS hasher le body **après** parsing JSON (les whitespace JSON différents
  produiraient des hash différents → mismatch faux positifs). Le wrapper hash le body
  brut.
- ❌ Ne PAS exposer le payload caché à un autre user (scope par-user obligatoire).
- ❌ Ne PAS appliquer sur les routes GET (idempotentes par définition HTTP).
