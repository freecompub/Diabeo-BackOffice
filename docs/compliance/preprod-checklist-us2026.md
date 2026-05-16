# Pre-prod checklist — US-2026 INS

> Document opérationnel **gouvernance** pour le go-live PR #416
> (INS — Identité Nationale Santé V1 standalone, sans Téléservice INSi).
>
> Statut : **CODE merge-ready** ✅ — Bloqueurs restants = **gouvernance**
> (signatures DPO, clauses contractuelles, tests staging Ops).
>
> Aucun commit dev requis pour les 5 actions ci-dessous.

---

## Légende sévérité

| Marqueur | Signification |
|---|---|
| 🔴 **HARD** | Ne PAS déployer en prod tant que non-résolu. Risque CNIL/HDS direct. |
| 🟠 **CONDITIONAL** | Bloqueur SI déploiement >X. Sinon acceptable. |
| 🟡 **SOFT** | Acceptable de déférer V2 avec risque documenté DPO. |

---

## 🔴 BLOQUEUR #1 — Signature DPIA `dpia-ins-us2026.md`

### Risque concret si pas fait

**Audit CNIL spontané** (peut arriver suite à plainte patient, signalement
employé, contrôle aléatoire) → demande la DPIA Art. 35 → tu présentes un
draft non-signé → **mise en demeure formelle** (CNIL SAN-2023-016 précédent :
sanction 50k€-1M€ selon gravité).

**Audit HDS de re-certification annuel** (HDS certifié obligatoire pour
héberger PHI en France) → l'auditeur HDS inspecte les DPIA → DPIA non-signée
= **non-renouvellement certification HDS** → tu ne peux plus héberger
Diabeo en France légalement.

### Qui doit signer (3 personnes minimum)

1. **DPO (Délégué Protection Données)** — c'est qui chez Diabeo ?
   - Si interne : la personne nommée dans le registre CNIL (Art. 37 RGPD
     obligatoire pour traitement systématique PHI grande échelle = Diabeo).
   - Si externe : cabinet conseil RGPD (ex. Lexing, Mathias Avocats —
     coût ~5-15k€ pour audit + signature).
2. **RSSI (Responsable Sécurité SI)** — peut être cumulé avec CTO si Diabeo
   est <20 salariés.
3. **Direction Médicale** — médecin référent / scientifique de Diabeo
   (signature requise car contenu clinique).

### Action étape par étape

**Étape A — Préparer le document (~30 min, dev)**

```bash
# Ajouter signataires + date dans le fichier
sed -i 's/Statut : draft V1/Statut : DRAFT V1 — pour signature/' \
  docs/compliance/dpia-ins-us2026.md

# Ajouter section §8 Signatures
cat >> docs/compliance/dpia-ins-us2026.md <<EOF

## 8. Signatures

| Rôle | Nom | Date | Signature |
|------|-----|------|-----------|
| DPO  | _________ | _____ | _____ |
| RSSI | _________ | _____ | _____ |
| Direction Médicale | _________ | _____ | _____ |

EOF
```

**Étape B — Convoquer réunion DPO + RSSI + Dir. Méd. (~2h)**

Email-template :

```
Sujet : DPIA US-2026 INS — signature requise avant go-live prod patients réels

Bonjour,

La PR #416 livre la gestion de l'INS (Identité Nationale Santé) dans Diabeo.
Conformément CNIL délibération 2021-099 art. 7 et RGPD Art. 35, ce traitement
de catégorie particulière (Art. 9) exige une DPIA signée.

Document à valider : docs/compliance/dpia-ins-us2026.md (250 lignes).

Points de décision spécifiques :
- §3.1 — Posture "saisi_non_verifie" V1 stricte (interne uniquement).
        Validation : OK pour pilote sans transmission tiers ? OUI/NON
- §3.2 — Cohérence traits non-enforcée V1 (détection drift via hash uniquement).
        Validation : risque identitovigilance acceptable contre clauses CGU ? OUI/NON
- §3.4 — Rétention previousInsHmacPeppered 6 ans (HDS Art. L.1111-8).
        Validation : interprétation Art. 17(3)(b) RGPD acceptable ? OUI/NON
- §3.5 — Cap rate-limit per-user uniquement (pas per-IP/cabinet).
        Validation : acceptable pour pilote 1-3 cabinets ? OUI/NON

Date proposée : <DATE>
Durée : 1h30
Présence : DPO, RSSI, Direction Médicale, CTO

Cordialement,
<Diabeo CEO/CTO>
```

**Étape C — Archiver signatures (~10 min)**

- DPO signe physiquement OU via DocuSign/Universign
- PDF signé archivé dans `docs/compliance/signed/dpia-ins-us2026-signed-YYYY-MM-DD.pdf`
- Git commit doc avec checksum SHA256 du PDF
- Mise à jour registre interne avec date signature

### Effort total : 5-10 jours homme (calendrier, pas effectif)

- Préparation doc : 30 min dev
- Lecture DPO (asynchrone) : ~3h
- Réunion : 1h30
- Itérations corrections demandées DPO : 2-4h dev
- Archivage : 10 min

### Si Diabeo n'a PAS de DPO

**Obligation légale** : RGPD Art. 37(1)(c) impose un DPO si traitement
**régulier + systématique + grande échelle** de données Art. 9. Diabeo
coche les 3 cases dès le 1er patient médecin → DPO obligatoire.

**Solution rapide** :
- DPO externe mutualisé : cabinet conseil RGPD type Dipeeo, Data Legal Drive
  (50-200€/mois).
- DPO interne : nommer le CTO ou un cofondateur (incompatibilités →
  préférer externe).

---

## 🔴 BLOQUEUR #2 — Clause contractuelle "INS V1 strictement interne"

### Risque concret si pas fait

Sans clause contractuelle :

- Un cabinet client utilise Diabeo, voit qu'on stocke des INS, **suppose**
  qu'on les transmet à son LGC (Logiciel Gestion Cabinet) via une intégration
  future → il commande une intégration FHIR avec son LGC → ton équipe livre
  → propagation INS non-qualifié → **violation Référentiel ANS §5.1** →
  sanction CNIL + perte certification HDS.

- Si demain un développeur dans 6 mois ajoute la propagation INS dans
  US-2123 FHIR **sans appeler `assertQualifiedForSharing`** → le code part
  en prod → fuite. La clause contractuelle est la **deuxième ligne de
  défense** (la première étant le Branded type).

### Qui doit rédiger

**Juriste Diabeo** ou cabinet d'avocats partenaire (Mathias Avocats,
Lexing — 1-3 jours, ~2-5k€ si externe).

### Action étape par étape

**Étape A — Identifier les contrats à modifier**

```bash
# Trouver tous les contrats existants
find . -iname "*cgu*" -o -iname "*contrat*" -o -iname "*terms*" 2>/dev/null
ls docs/legal/ 2>/dev/null  # si Diabeo a un répertoire dédié
```

À minima :

1. **CGU Backoffice** (médecins, infirmiers, admins)
2. **CGU App Patient** (iOS / Web)
3. **Contrat cabinet** (B2B avec cabinets médicaux abonnés)
4. **DPA** (Data Processing Agreement avec sous-traitants, ex. OVH)

**Étape B — Texte clause à insérer (à valider juriste)**

```markdown
### Article X — Identifiant National de Santé (INS)

Diabeo collecte et conserve l'INS (Identité Nationale de Santé)
du Patient à des fins exclusives d'identification interne et de
déduplication au sein de la plateforme Diabeo.

L'INS stocké dans Diabeo est dit "saisi non vérifié" au sens du
Référentiel INS de l'Agence du Numérique en Santé (ANS) v3 §4.1 :
il a été validé syntaxiquement (15 chiffres + clé Luhn-97) mais
n'a PAS été vérifié auprès du Téléservice INSi.

À ce titre, le Référentiel INS ANS v3 §5.1 interdit formellement
son utilisation comme INS qualifié pour :
- Le partage via la messagerie sécurisée MSSanté ;
- La transmission au Dossier Médical Partagé (DMP) / Mon Espace Santé ;
- L'inclusion dans un Bundle HL7 FHIR à destination d'un Système
  d'Information de Santé tiers ;
- La facturation tiers payant (DGFiP, Assurance Maladie).

Diabeo s'engage à ne PAS transmettre cet INS à des systèmes tiers
tant que la qualification INSi n'a pas été obtenue (déploiement
prévu dans la version 2 de la plateforme, conditionné à l'obtention
de l'habilitation ANS).

Le Professionnel de Santé reconnaît expressément cette limitation
et s'engage à utiliser l'INS Diabeo uniquement dans le cadre interne
du suivi des Patients sur la plateforme.

En cas de saisie erronée de l'INS, le PS dispose d'un mécanisme
de correction (DELETE puis re-saisie) tracé dans le journal d'audit
conformément à HDS Art. L.1111-8.
```

**Étape C — Notifier clients existants (si déjà en pilote)**

```
Email-template à clients pilotes :

Sujet : Diabeo v1.X — Évolution des CGU (INS)

Cher [Nom cabinet],

Suite à la mise en service de la fonctionnalité INS (Identité Nationale Santé)
dans la version 1.X de Diabeo, nous mettons à jour les CGU pour préciser
le périmètre d'usage de cet identifiant.

Modification clé : l'Article X précise que l'INS Diabeo est strictement
interne et n'est PAS qualifié au sens du Référentiel INS ANS v3.

Vous trouverez ci-joint la version 1.Y des CGU. Sans contestation
de votre part avant <DATE+30j>, nous considérerons l'avenant accepté.

Bien à vous,
<Diabeo Direction>
```

### Effort total : 2-5 jours homme

- Identification contrats : 2h
- Rédaction clause : 1 jour (juriste)
- Revue juridique : 0.5 jour
- Insertion CGU + déploiement : 0.5 jour
- Notification clients (si pilote actif) : 0.5 jour

---

## 🔴 BLOQUEUR #3 — Sign-off Ops sur runbook rotation HMAC

### Risque concret si pas fait

**Incident sécurité** : un employé sortant a eu accès au secret manager OVH
→ tu dois rotater `HMAC_SECRET` en urgence → sans runbook validé, ton équipe
Ops fait n'importe quoi :

- Cas A : ils ne rotatent pas (panique) → l'employé peut décrypter les login
  emails pendant des mois.
- Cas B : ils rotatent brutalement → tous les `emailHmac` BDD invalides →
  **100% des login cassent en prod** → Diabeo down → contrat SLA violé →
  perte clients.

**Audit ANSSI/HDS** : auditeur demande "comment vous rotatez vos secrets
cryptographiques ?" → vous montrez `docs/runbook/hmac-secret-rotation.md`
non-testé → non-conformité ANSSI RGS §B1.2.

### Qui doit valider

- **DevOps lead** (qui maintient OVH + secret manager)
- **RSSI** (signature finale)

### Action étape par étape

**Étape A — Provisionner environnement staging dédié (si pas déjà)**

```bash
# Vérifier qu'on a un staging avec données représentatives
gh workflow run deploy-staging.yml -f source=main

# Cloner anonymisé prod → staging (si pas auto)
./scripts/clone-prod-to-staging.sh --anonymize
```

**Étape B — Exécuter le runbook end-to-end en staging**

Suivre `docs/runbook/hmac-secret-rotation.md` Phase 1 → Phase 5 :

```bash
# 1. Générer nouveau secret
NEW_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
echo "HMAC_SECRET_NEXT=$NEW_SECRET" | ovh-secret-manager set staging

# 2. Déployer code dual-read (PR temporaire avec hmacFieldLookup)
git checkout -b ops/hmac-rotation-test
# ... patch hmac.ts comme dans runbook ...
gh pr create --title "ops: HMAC dual-read test rotation" --label "ops-only-staging"
gh pr merge --squash  # staging only

# 3. Lancer script re-HMAC
DATABASE_URL=$STAGING_DB pnpm exec ts-node scripts/rehmac-with-next-secret.ts

# 4. Switch secrets
ovh-secret-manager rename HMAC_SECRET HMAC_SECRET_OLD --env staging
ovh-secret-manager rename HMAC_SECRET_NEXT HMAC_SECRET --env staging

# 5. Vérifier login + INS lookup OK pendant 24h
./scripts/smoke-tests-prod.sh --env staging --duration 24h

# 6. Cleanup
ovh-secret-manager delete HMAC_SECRET_OLD --env staging
gh pr revert <dual-read-PR>  # retour mono-read
```

**Étape C — Documenter résultat dans runbook**

Ajouter à `hmac-secret-rotation.md` :

```markdown
## Validation staging

| Date | Opérateur | Durée totale | Login impact | INS lookup impact |
|------|-----------|--------------|--------------|--------------------|
| YYYY-MM-DD | <DevOps> | Xh | 0 erreurs / N login | 0 erreurs / N lookup |

Sign-off RSSI : <signature> le <date>
```

**Étape D — Faire de même pour `AUDIT_PEPPER` et `CONVERSATION_KEY_PEPPER`**

Ces 2 secrets ont moins d'impact (rotation `AUDIT_PEPPER` n'invalide que
les `collidingUserIdHmac` historiques, pas le service en prod). Procédure
plus courte :

```bash
# AUDIT_PEPPER — pas de re-HMAC, juste switch
ovh-secret-manager set AUDIT_PEPPER=<new-hex>  --env staging
# Vérifier que les nouveaux audit logs collision utilisent le nouveau pepper
```

### Effort total : 1-2 jours homme DevOps + 1h RSSI

---

## 🟠 BLOQUEUR CONDITIONNEL #4 — Triple cap rate-limit (per-IP/cabinet)

### Conditionnel sur quoi ?

- ✅ **Pilote fermé 1-3 cabinets connus** → V1 suffit (per-user cap = 5/24h)
- ❌ **Production publique >10 cabinets** → V1.5 nécessaire (per-IP + per-cabinet)
- 🚨 **Scaling >100 cabinets ou self-onboarding** → V1.5 OBLIGATOIRE

### Risque concret en cas de production publique sans V1.5

Un DOCTOR malveillant créé 100 patients bidons dans son workflow (création
légitime côté Diabeo : "patients pré-onboarding"). Il tente 5 INS distincts
par patient → 500 INS testés en 24h sans déclencher le rate-limit (cap est
per-userId, pas per-cabinet).

Sur 6 mois : 500 × 180 = **90 000 INS testés** = ~1% du parc RNIPP scanné
(pour un département ciblé).

Chaque collision révèle "ce numéro INS existe quelque part dans Diabeo"
→ cartographie indirecte du parc patient → **délit de fichage** Article
226-19 Code Pénal (5 ans + 300k€ amende).

### Qui doit décider

**Product Owner / Samir** : "scope déploiement V1 = pilote fermé ou
production publique ?"

### Si décision = pilote fermé → AUCUNE action

Documenter dans CLAUDE.md et release notes :

```
V1.0 INS — déploiement limité aux cabinets <liste-pilote>.
Scaling commercial requiert US-2026.1 (triple cap rate-limit) — V1.5.
```

### Si décision = production publique → implémenter V1.5

Effort estimé : **5-8 SP** (Redis sliding-window OR audit_logs supplémentaires
+ index)

```typescript
// src/lib/services/ins.service.ts — V1.5 addition
async function assertNotRateLimitedExtended(
  tx: TxClient,
  auditUserId: number,
  ipAddress: string,
  cabinetId: number | null,
  ctx: AuditContext,
): Promise<void> {
  // Per-user 5/24h (déjà V1)
  await assertNotRateLimited(tx, auditUserId, ctx)

  // V1.5 — Per-IP 10/heure (NAT cabinet partagé)
  const ipCount = await tx.auditLog.count({
    where: {
      ipAddress, resource: "USER_INS", action: "UNAUTHORIZED",
      createdAt: { gte: new Date(Date.now() - 3600_000) },
      metadata: { path: ["kind"], equals: AUDIT_KIND.COLLISION },
    },
  })
  if (ipCount >= 10) throw new InsCollisionRateLimitError(3600)

  // V1.5 — Per-cabinet 20/24h
  if (cabinetId !== null) {
    const cabinetCount = await tx.auditLog.count({
      where: {
        user: { healthcareMember: { some: { serviceId: cabinetId } } },
        // ... même filtre kind=collision
      },
    })
    if (cabinetCount >= 20) throw new InsCollisionRateLimitError(86400)
  }
}
```

Plus migration index :

```sql
CREATE INDEX audit_logs_ip_collision_idx
  ON audit_logs (ip_address, created_at DESC)
  WHERE resource = 'USER_INS' AND action = 'UNAUTHORIZED'
    AND metadata @> '{"kind":"user.ins.collision"}';
```

### Effort total V1.5 si requis : 5-8 SP (1-2 sprints)

---

## 🟡 SOFT #5 — Implémentation `reconcileCollidingUserId` CLI

### Risque concret si pas fait

**Incident** : CNIL/ANS te demande "donnez-moi la liste des INS que vous
avez tentés d'attribuer à User.X qui ont collidé" → tu regardes audit_logs
→ tu vois des `collidingUserIdHmac` opaques → tu ne peux pas répondre sans
le CLI de re-correlation.

**Acceptable de différer** car :

- Incident-driven (rare)
- DPIA §6.3 documente la procédure → CNIL acceptera "nous avons documenté,
  nous implémenterons sur demande"
- Implémentation rapide (2-4h dev) si demandée

### Action si décidé d'implémenter V1

Créer `scripts/dpo-reconcile-colliding-user-id.ts` (CLI bastion DPO
uniquement, pas d'endpoint HTTP) :

```typescript
#!/usr/bin/env tsx
/**
 * DPO-only — Re-correlation collidingUserIdHmac → User.id.
 * Usage : tsx scripts/dpo-reconcile-colliding-user-id.ts <hmac-64-hex>
 * Output : User.id si match, "no match" sinon.
 *
 * SÉCURITÉ : ce script ne doit JAMAIS être déployé sur le serveur Node prod.
 * Bastion DPO uniquement, accès SSH restreint, audit log dédié.
 */
import { prisma } from "../src/lib/db/client"
import { hmacAuditId } from "../src/lib/crypto/hmac"

const targetHmac = process.argv[2]
if (!targetHmac || !/^[0-9a-f]{64}$/.test(targetHmac)) {
  console.error("Usage: tsx dpo-reconcile.ts <hmac-64-hex>")
  process.exit(1)
}

async function main() {
  // Iterate users sequentially, compute hmacAuditId, compare.
  const users = await prisma.user.findMany({ select: { id: true } })
  for (const u of users) {
    if (hmacAuditId("ins-collision", u.id) === targetHmac) {
      console.log(JSON.stringify({ found: true, userId: u.id }))
      // AUDIT TRAIL : log dans audit_logs que DPO a fait la re-correlation
      await prisma.auditLog.create({
        data: {
          userId: 0, // sentinel DPO
          action: "READ",
          resource: "USER_INS",
          resourceId: String(u.id),
          metadata: { kind: "dpo.reconciliation", queryHmac: targetHmac },
        },
      })
      process.exit(0)
    }
  }
  console.log(JSON.stringify({ found: false }))
}
main().finally(() => prisma.$disconnect())
```

### Effort si décidé V1 : 2-4h dev + 1h test bastion

---

## 📋 Récapitulatif — qui fait quoi quand

| # | Bloqueur | Sévérité | Owner principal | Owner support | Effort | Calendrier réaliste |
|---|----------|----------|-----------------|---------------|--------|---------------------|
| 1 | DPIA signée DPO+RSSI+DirMed | 🔴 HARD | **DPO** (interne ou externe) | CTO + Direction Médicale | 5-10j calendrier | Semaine 1-2 |
| 2 | Clause CGU "INS interne V1" | 🔴 HARD | **Juriste** (interne ou cabinet) | CTO | 2-5j calendrier | Semaine 1 |
| 3 | Sign-off runbook rotation HMAC | 🔴 HARD | **DevOps lead** | RSSI | 1-2j effectif | Semaine 2 |
| 4 | Triple cap rate-limit | 🟠 CONDITIONAL | **Backend dev** | Product Owner décide scope | 5-8 SP (si requis) | Sprint suivant |
| 5 | CLI `reconcileCollidingUserId` | 🟡 SOFT | **Backend dev** | DPO valide procédure | 2-4h | À la demande |

---

## 🎯 Décisions à prendre pour DÉCIDER si on est pre-prod ready

Réponds à ces questions, on peut dire EXACTEMENT le go/no-go :

### Question 1 — DPO en place ?

- [ ] OUI, interne (qui ?)
- [ ] OUI, externe (cabinet ?)
- [ ] NON → bloqueur #1 nécessite d'abord nommer un DPO

### Question 2 — Scope déploiement V1 ?

- [ ] Pilote fermé 1-3 cabinets connus → #4 NON-bloqueur
- [ ] Production publique multi-cabinets → #4 BLOQUEUR
- [ ] Self-service inscription cabinet → #4 + #2 BLOQUEURS RENFORCÉS

### Question 3 — Délai go-live cible ?

- [ ] <1 semaine → Impossible (DPIA + clause CGU = 2 semaines min)
- [ ] 2-4 semaines → Réaliste si DPO disponible
- [ ] >1 mois → Confortable, on peut aussi faire V1.5 #4

### Question 4 — Budget compliance ?

- [ ] DPO externe : ~50-200€/mois → OK pour pilote
- [ ] Cabinet RGPD audit unique : ~5-15k€ → OK si pas de DPO interne
- [ ] Cabinet avocats CGU : ~2-5k€ → OK
- [ ] **Total minimum compliance V1** : ~10-25k€ one-shot + 50-200€/mois

---

## ✅ Ce qui EST déjà fait (rappel)

| Conformité | Mécanisme | Status |
|------------|-----------|--------|
| Référentiel ANS §4.1 qualification | `insQualityStatus` enum + CHECK SQL | ✅ |
| Référentiel ANS §5.1 interdit partage | Branded `QualifiedIns` + `assertQualifiedForSharing` | ✅ |
| Référentiel ANS §6.3 anti-énumération | Rate-limit 5/24h + advisory lock atomique | ✅ |
| ANSSI RGS §B1 crypto | AES-256-GCM + HMAC-SHA256 | ✅ |
| ANSSI RGS §B1.2 cross-domain | 3 secrets distincts + domain prefixes | ✅ |
| ANSSI RGS §4.5 headers | no-store + Referrer-Policy + nosniff + CSP | ✅ |
| HDS Art. L.1111-8 traçabilité | setByRole/clearedByRole/previousInsHmacPeppered | ✅ |
| RGPD Art. 17 cascade | `insService.clearIns(tx)` réutilisé | ✅ |
| RGPD Art. 20 portabilité | Wrapper qualité + disclaimer FR/EN/AR | ✅ |
| RGPD Art. 35 DPIA | `docs/compliance/dpia-ins-us2026.md` produite | ✅ (signatures pending) |

---

## TL;DR

Le **code est merge-ready** maintenant. Pour **déployer en prod patients
réels**, l'équipe Diabeo (non-dev) doit :

1. **Trouver/nommer un DPO** (si pas déjà)
2. **Faire signer la DPIA** (réunion 1h30 + signatures)
3. **Faire rédiger la clause CGU** (1 juriste + 2-5j)
4. **Tester le runbook rotation HMAC en staging** (DevOps + 1-2j)
5. **Décider scope déploiement** (pilote vs prod publique) pour le cap
   rate-limit V1.5

**Pas un seul commit dev requis pour ces 5 actions.** Tout est de la
gouvernance, pas du code.

---

## Templates disponibles

Si tu veux, on peut générer des templates concrets prêts à l'envoi :

- Email DPO meeting request
- Texte clause CGU pour ton juriste
- Script staging rotation HMAC pas-à-pas
- Checklist signature DPIA

---

**Références** :

- PR #416 (US-2026 INS) — 3 rounds review multi-agents
- `docs/compliance/dpia-ins-us2026.md` — DPIA à signer (§7 checklist)
- `docs/runbook/hmac-secret-rotation.md` — procédure dual-key à valider Ops
- RGPD : Art. 9, 17, 20, 32, 35, 37
- CNIL : délibération 2021-099 du 22 juillet 2021 (INS)
- HDS : Art. L.1110-4, L.1111-8, R.1112-3
- ANSSI : RGS v2.0 §B1, §B1.2, §4.5
- ANS : Référentiel INS v3 (Mars 2024) §4.1, §4.2, §5.1, §6.3
- Code Santé Publique : L.1111-8-1
- Code Pénal : Art. 226-19 (délit de fichage)
