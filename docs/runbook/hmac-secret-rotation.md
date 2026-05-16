# Runbook — Rotation HMAC_SECRET

> Procédure de rotation des secrets HMAC partagés (`HMAC_SECRET`,
> `AUDIT_PEPPER`, `CONVERSATION_KEY_PEPPER`) en cas de compromission ou
> de rotation préventive.
>
> ANSSI RGS §B1.2 : les secrets doivent pouvoir être rotés indépendamment
> sans interrompre le service. Ce runbook documente la procédure
> **dual-key** (ancien + nouveau secret en parallèle, re-HMAC progressif).

## ⚠️ Avertissements

- **Ne JAMAIS rotater `HMAC_SECRET` sans plan** — tous les login email
  cessent immédiatement de fonctionner (lookup `emailHmac` invalidé).
- Ne pas confondre :
  - **`HEALTH_DATA_ENCRYPTION_KEY`** (AES-256-GCM data) → rotation = ré-
    encryptage de tout PHI. Procédure distincte (à venir V2 KMS envelope).
  - **`HMAC_SECRET`** (lookup hash) → couvert par ce runbook.
  - **`CONVERSATION_KEY_PEPPER`** (US-2076 messagerie) → couvert par
    `messaging-pepper-rotation.md`.
  - **`AUDIT_PEPPER`** (US-2026 anonymisation audit IDs) → re-correlation
    DPO/RSSI casserait, mais audit logs restent valides en lecture (le
    `collidingUserIdHmac` historique reste comparable via l'ancien
    pepper si retenu en archive).

## Cas d'usage

1. **Compromission** : env-var leak, employé sortant ayant eu accès aux
   secrets, audit ANSSI/HDS exigeant rotation post-incident.
2. **Rotation préventive** : tous les 12-24 mois selon politique
   d'entreprise (alignée HDS Art. R.1112-3).

## Procédure dual-key (zero-downtime)

### Phase 1 — Provision nouveau secret

```bash
# Générer un nouveau secret (32 bytes hex = 64 chars).
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Ajouter dans le secret manager OVH (sans supprimer l'ancien) :
- `HMAC_SECRET_NEXT="<nouveau>"` (variable dérivée temporaire)

### Phase 2 — Code dual-read

Modifier `src/lib/crypto/hmac.ts` :

```typescript
export function hmacField(value: string): string {
  const key = process.env.HMAC_SECRET
  if (!key) throw new Error("HMAC_SECRET is not set")
  return createHmac("sha256", key).update(value.toLowerCase().trim()).digest("hex")
}

// Lookup helper qui essaye nouveau puis ancien (transition).
export function hmacFieldLookup(value: string): { primary: string; legacy: string | null } {
  const next = process.env.HMAC_SECRET_NEXT
  const current = process.env.HMAC_SECRET
  if (!current) throw new Error("HMAC_SECRET is not set")
  return {
    primary: next
      ? createHmac("sha256", next).update(value.toLowerCase().trim()).digest("hex")
      : createHmac("sha256", current).update(value.toLowerCase().trim()).digest("hex"),
    legacy: next
      ? createHmac("sha256", current).update(value.toLowerCase().trim()).digest("hex")
      : null,
  }
}
```

Patcher les call-sites qui font `findUnique({ where: { emailHmac } })` :

```typescript
const { primary, legacy } = hmacFieldLookup(email)
const user = await prisma.user.findFirst({
  where: {
    OR: [
      { emailHmac: primary },
      ...(legacy ? [{ emailHmac: legacy }] : []),
    ],
  },
})
```

Déployer cette version → dual-read actif.

### Phase 3 — Re-HMAC progressif (script de migration)

Script `scripts/rehmac-with-next-secret.ts` :

```typescript
import { prisma } from "@/lib/db/client"
import { decrypt } from "@/lib/crypto/health-data"
import { createHmac } from "crypto"

const NEXT = process.env.HMAC_SECRET_NEXT!
const CHUNK = 500

async function rehmacBatch(offset: number): Promise<number> {
  const users = await prisma.user.findMany({
    skip: offset,
    take: CHUNK,
    select: { id: true, email: true, emailHmac: true /* + firstnameHmac, lastnameHmac, insHmac */ },
  })
  for (const u of users) {
    const plaintextEmail = decrypt(Buffer.from(u.email, "base64"))
    const newHmac = createHmac("sha256", NEXT)
      .update(plaintextEmail.toLowerCase().trim()).digest("hex")
    await prisma.user.update({
      where: { id: u.id },
      data: { emailHmac: newHmac /* + autres HMAC */ },
    })
  }
  return users.length
}

let offset = 0
let processed = 0
while (true) {
  const n = await rehmacBatch(offset)
  if (n === 0) break
  offset += n
  processed += n
  console.log(`[rehmac] processed=${processed}`)
}
```

**Important** : exécuter ce script **idempotent** — si interrompu, le
relancer reprend où il s'est arrêté car le HMAC final = HMAC NEXT
quelle que soit l'origine.

### Phase 4 — Switch primary → next

Dans le secret manager :
- Renommer `HMAC_SECRET` → `HMAC_SECRET_OLD` (archive temporaire)
- Renommer `HMAC_SECRET_NEXT` → `HMAC_SECRET`
- Supprimer `HMAC_SECRET_NEXT`

Re-déployer.

### Phase 5 — Vérification + suppression `HMAC_SECRET_OLD`

Après vérification production (login + lookup OK pendant 24-48h) :
- Supprimer `HMAC_SECRET_OLD` du secret manager.
- Re-déployer code mono-read (rollback `hmacFieldLookup` → `hmacField`).

## Procédure express (compromission active — break-glass)

Si compromission active confirmée :

1. **Immédiat** : générer nouveau secret + déployer dual-read avec
   `HMAC_SECRET_NEXT` (étapes 1-2).
2. **+1h** : lancer `rehmac-with-next-secret.ts` en parallèle de la prod
   (les writes pendant le script sont déjà au nouveau HMAC).
3. **+6h max** : switch (phase 4).
4. **Post-mortem** : audit `audit_logs` sur les 24h précédentes
   (`action=UNAUTHORIZED` + `kind=*.accessDenied`) pour détecter
   tentatives d'exploitation.

## Compromission `AUDIT_PEPPER` (US-2026 H1)

Cas spécifique au pepper d'anonymisation audit IDs (`collidingUserIdHmac`
pour collision INS notamment) :

- **Impact** : si compromis, l'attaquant peut **brute-force**
  `User.id ∈ [1, N]` via HMAC pour démasquer les `collidingUserIdHmac`
  historiques dans `audit_logs.metadata`. Cela révèle les correspondances
  INS-collision cross-cabinet.
- **Mitigation** : `AUDIT_PEPPER` est **rotatable indépendamment** sans
  re-HMAC des audit logs historiques (les logs anciens restent comparables
  via l'ancien pepper, gardé en archive lecture seule).
- **Procédure** :
  1. Générer nouveau `AUDIT_PEPPER`, déployer (mono-read suffit, les
     nouveaux `collidingUserIdHmac` utiliseront le nouveau pepper).
  2. Archiver l'ancien `AUDIT_PEPPER` dans un secret-store DPO-only
     (re-correlation `audit_logs.metadata.collidingUserIdHmac` antérieurs
     reste possible via la fonction `reconcileCollidingUserId` qui essaie
     successivement les peppers en archive).
  3. Aucune migration de données nécessaire.

## Compromission `CONVERSATION_KEY_PEPPER` (US-2076)

Voir `docs/runbook/messaging-pepper-rotation.md`.

## Validation post-rotation

- [ ] `POST /api/auth/login` fonctionne pour un user pré-rotation (lookup
      via nouveau HMAC après re-HMAC).
- [ ] `PUT /api/patients/[id]/ins` rejette `409 insAlreadyRegistered`
      pour un INS connu (lookup HMAC fonctionne après re-HMAC).
- [ ] `audit_logs` continue d'écrire avec nouveau pepper.
- [ ] Aucune dégradation de p95 sur les routes critiques.

---

**Références** :
- ANSSI RGS v2.0 §B1.2 (cross-domain key reuse)
- HDS Art. R.1112-3 (politique sécurité)
- `src/lib/crypto/hmac.ts` (helpers actuels)
- `src/lib/env.ts` (validation env-var)
