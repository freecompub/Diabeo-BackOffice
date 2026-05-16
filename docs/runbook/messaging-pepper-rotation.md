# Runbook — Rotation `CONVERSATION_KEY_PEPPER` (US-2076)

> Procédure de rotation du pepper HMAC utilisé pour `conversation_key`
> dans la table `messages`. ANSSI RGS §B1.2.2 (renouvellement des clés).
> HSA R6-MEDIUM-1 round 6.

## Quand exécuter une rotation

- **Suspicion de compromission** : leak `.env`, ex-employé avec accès
  prod, image Docker leakée, audit clé externe positif.
- **Rotation périodique préventive** : tous les 24 mois (ANSSI
  recommande 1-2 ans pour secrets cryptographiques applicatifs).
- **Migration cloud** : changement de fournisseur secret manager.

## Impact

⚠️ La rotation **invalide TOUS les `conversation_key` existants** —
les threads existants doivent être re-keyed manuellement, sinon ils
deviennent invisibles via `listThreads` (le pair recalculé ne match
plus la valeur stockée).

## Pré-requis

- Fenêtre de maintenance planifiée (write-freeze ~15-30 min selon
  volume).
- Backup PostgreSQL frais < 1h.
- Accès au nouveau pepper généré + ancien pepper.
- Communication aux utilisateurs (banner "maintenance messagerie").

## Procédure

### 1. Génération du nouveau pepper

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Stocker dans `CONVERSATION_KEY_PEPPER_NEW` du secret manager.
**NE PAS** écraser `CONVERSATION_KEY_PEPPER` encore.

### 2. Snapshot DB

```bash
./deploy.sh backup
# Vérifier dump < 1h dans OVH Object Storage backup bucket.
```

### 3. Write-freeze messages

Désactiver temporairement le POST `/api/messages` via feature flag ou
maintenance mode. UI affiche "Maintenance messagerie 15 min".

### 4. Re-key SQL script

Créer un script idempotent qui :
1. Lit tous les `(from_user_id, to_user_id)` distincts.
2. Recalcule `HMAC-SHA256(min:max, NEW_PEPPER)`.
3. UPDATE `messages.conversation_key` par paire.

```sql
-- À exécuter via le service applicatif Node (pas psql direct) car le
-- HMAC se fait côté Node avec le nouveau pepper. Pseudo-code :
--
-- for each distinct pair (a, b) in messages:
--   new_key = HMAC-SHA256(min(a,b) || ':' || max(a,b), NEW_PEPPER)
--   UPDATE messages SET conversation_key = new_key
--     WHERE (from_user_id, to_user_id) IN ((a,b), (b,a));
-- REINDEX TABLE messages;
```

Script Node `scripts/rotate-conversation-key-pepper.ts` à écrire pour
cette opération (template ci-dessous).

### 5. REINDEX des indexes touchés

```sql
REINDEX INDEX messages_conversation_key_created_at_idx;
REINDEX INDEX messages_from_thread_recency_idx;
REINDEX INDEX messages_to_thread_recency_idx;
REINDEX INDEX messages_unread_groupby_idx;
```

### 6. Bascule env var

```bash
# Dans le secret manager (OVH/Vault) :
mv CONVERSATION_KEY_PEPPER CONVERSATION_KEY_PEPPER_OLD
mv CONVERSATION_KEY_PEPPER_NEW CONVERSATION_KEY_PEPPER
./deploy.sh update  # restart Node containers
```

### 7. Vérification

```sql
-- Aucun conversation_key ne doit avoir l'ancienne forme (test sur 1 paire connue).
SELECT count(*) FROM messages
WHERE conversation_key = '<ancienne_clé_test>'; -- doit être 0
```

```bash
# Test E2E : un user envoie un message au même destinataire qu'avant rotation.
# Le thread doit apparaitre dans listThreads et le getThread doit fonctionner.
```

### 8. Nettoyage post-rotation

- Conserver `CONVERSATION_KEY_PEPPER_OLD` 30 jours pour rollback.
- Après 30 jours sans incident : suppression définitive du secret old.

## Rollback

En cas d'incident dans les 24h après rotation :

1. Stop l'app.
2. Bascule env var : `CONVERSATION_KEY_PEPPER = OLD`.
3. Re-key inversé : recalculer `conversation_key` avec OLD pepper.
4. Restart app.

## Template script (à implémenter avant V1+)

```typescript
// scripts/rotate-conversation-key-pepper.ts
import { createHmac } from "crypto"
import { prisma } from "@/lib/db/client"

async function rotate() {
  const newPepper = process.env.CONVERSATION_KEY_PEPPER_NEW
  if (!newPepper || Buffer.from(newPepper, "hex").length < 32) {
    throw new Error("CONVERSATION_KEY_PEPPER_NEW missing or too short")
  }
  const pepperBuf = Buffer.from(newPepper, "hex")

  // Aggregation des paires distinctes (from, to).
  const pairs = await prisma.$queryRaw<{ a: number; b: number }[]>`
    SELECT DISTINCT LEAST(from_user_id, to_user_id) AS a,
                    GREATEST(from_user_id, to_user_id) AS b
    FROM messages WHERE deleted_at IS NULL
  `

  console.log(`Rotating ${pairs.length} conversation_key pairs...`)
  for (const { a, b } of pairs) {
    const newKey = createHmac("sha256", pepperBuf)
      .update(`${a}:${b}`).digest("hex")
    await prisma.$executeRaw`
      UPDATE messages SET conversation_key = ${newKey}
      WHERE LEAST(from_user_id, to_user_id) = ${a}
        AND GREATEST(from_user_id, to_user_id) = ${b}
    `
  }
  console.log("Done. Run REINDEX manually.")
}

rotate().catch((e) => { console.error(e); process.exit(1) })
```

## Références

- DPIA §3.4 — `docs/compliance/dpia-messaging-scope-a.md`
- ANSSI RGS v2.0 §B1.2.2 — Renouvellement des clés
- Issue GH `US-2076-bis-pepper-rotation` (à créer si besoin V2)
