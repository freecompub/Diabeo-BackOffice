# DPIA — US-2026 INS (Identité Nationale Santé) scope V1 standalone

> Document Privacy Impact Assessment pour le stockage et la gestion de
> l'INS patient sans connexion au Téléservice INSi (V2 procurement-bloqué).
> RGPD Art. 35 + CNIL délibération 2021-099 + Référentiel INS ANS v3.
> Statut : draft V1 — validation DPO en cours.

## 1. Périmètre du traitement

- **Données** :
  - `User.ins` : Identité Nationale Santé chiffrée AES-256-GCM (15 chiffres
    + clé Luhn-97). Catégorie particulière RGPD Art. 9.
  - `User.insHmac` : HMAC-SHA256 hex pour lookup unique anti-doublon RNIPP.
  - `User.insQualityStatus` : enum `saisi_non_verifie` / `insi_recupere` /
    `insi_verifie` / `rejete_traits_incoherent` (V1 force `saisi_non_verifie`).
  - `User.insSetAt`, `User.insSetByUserId`, `User.insTraitsHash` : traçabilité
    HDS § Art. L.1111-8 + détection drift traits.

- **Personnes concernées** : patients diabétiques (data subjects),
  médecins/infirmiers (saisisseurs PS), ADMIN (audit + correctif), VIEWER
  (auto-onboarding patient).

- **Finalité** :
  - **V1** : Identification interne Diabeo + déduplication patient (un INS
    unique → un User) + traçabilité forensique HDS.
  - **Hors scope V1** : Vérification INSi temps-réel (V2 US-2126),
    partage hors-Diabeo (DMP, MSSanté, FHIR, factures DGFiP).

- **Base légale** :
  - **Art. 9(2)(h) RGPD** : traitement nécessaire à la médecine
    préventive et diagnostic par un professionnel de santé soumis au
    secret professionnel.
  - **Art. 6(1)(c) RGPD** : obligation légale (Référentiel INS ANS v3
    impose stockage INS pour patients FR — applicable dès intégration INSi
    en V2).
  - **Pas de consentement explicite Art. 9(2)(a)** : V1 invoque
    Art. 9(2)(h) car la saisie de l'INS s'inscrit dans la prise en charge
    médicale du diabète (suivi insulinothérapie).

## 2. Mesures techniques implémentées

| Mesure | Référence | Statut |
|---|---|---|
| Chiffrement AES-256-GCM `User.ins` | `crypto/health-data.ts` + `encryptField` | ✅ |
| HMAC-SHA256 anti-doublon `User.insHmac` (UNIQUE NULLS DISTINCT) | `crypto/hmac.ts::hmacIns` + migration | ✅ |
| Validation format Luhn-97 (BigInt précis 13 digits) | `ins.service.ts::isValidInsFormat` | ✅ |
| Flag `insQualityStatus = saisi_non_verifie` V1 (Réf. INS ANS v3 §4.1) | `setIns` | ✅ round 2 C1 |
| CHECK SQL cohérence `(all null) OR (all set)` | migration §4 | ✅ round 2 C1 |
| Traits hash `insTraitsHash` détection drift post-set | `computeTraitsHash` | ✅ round 2 C1 |
| Traçabilité saisisseur `insSetByUserId` FK SetNull | migration §3 | ✅ round 2 H5 |
| Anti-énumération RBAC `resolvePatientForConsent` | PR #415 H2 | ✅ |
| Audit transactionnel `setIns/clearIns` | `logWithTx` | ✅ |
| Audit collision `collidingUserIdHmac` anonymisé (anti leak cross-cabinet) | `hmacAuditId("ins-collision", id)` | ✅ round 2 H1 |
| Rate-limit anti-énumération RNIPP (5 collisions/24h/auditUserId) | `assertNotRateLimited` | ✅ round 2 H2 |
| Race P2002 catchée → `InsCollisionError` cohérent | `Prisma.PrismaClientKnownRequestError` catch | ✅ round 2 H4 |
| Headers ANSSI RGS §4.5 (no-store + Referrer-Policy + nosniff + CSP) | route INS | ✅ round 2 M2 |
| Pivot `metadata.patientId` (US-2268) | toutes les routes | ✅ |
| AuditResource enum `USER_INS` | `audit.service.ts` | ✅ |
| RGPD Art. 17 deletion cascade INS (cols + audit USER_INS dédié) | `deletion.service.ts` | ✅ round 2 M7 |
| RGPD Art. 20 export INS wrapper qualité + disclaimer | `export.service.ts` | ✅ round 2 M1 |
| `canBeSharedExternally` guard (interdit propagation V1) | `insService.canBeSharedExternally` | ✅ round 2 C1 |
| Chaînage forensique `previousInsHmac` audit | `setIns/clearIns` metadata | ✅ round 2 LOW |

## 3. Risques résiduels V1 (décision DPO requise)

### 3.1 CRITICAL — Posture INS non-vérifié INSi (V1 standalone)

- **Risque** : l'INS Diabeo V1 est validé format Luhn-97 mais **non
  vérifié INSi** → identitovigilance dégradée. Un PS peut saisir un INS
  syntaxiquement correct mais correspondant à un autre patient
  (homonymie, erreur de saisie, fraude).
- **Mitigation V1** :
  - `insQualityStatus = saisi_non_verifie` flag → utilisation interne
    Diabeo uniquement.
  - **Interdiction explicite** de partage hors-Diabeo via
    `insService.canBeSharedExternally()` → US-2123 FHIR + US-2102 Facture
    doivent appeler ce guard.
  - Audit `setByRole: VIEWER` permet au DPO de filtrer les INS saisis
    par patients eux-mêmes (auto-onboarding) → workflow validation
    DOCTOR manuel post-saisie.
  - Cohérence traits via `insTraitsHash` → re-vérification déclenchée si
    nom/dob/sexe change.
- **Plan V2** : US-2126 Téléservice INSi (procurement ANS 5-10k€) →
  `setIns` appelle automatiquement INSi + upgrade `qualityStatus` à
  `insi_recupere` / `insi_verifie`.
- **Décision DPO** : valider posture V1 + documenter contractuellement
  que Diabeo ne transmet PAS l'INS à des systèmes tiers tant que V2 pas
  livrée.

### 3.2 HIGH — Pas de vérification cohérence INS ↔ traits stricte

- **Risque** : Référentiel INS ANS §4.2 exige que les traits d'identité
  (nom de naissance, prénom premier état civil, date+lieu naissance,
  sexe) soient cohérents avec ceux retournés par INSi. V1 stocke
  `insTraitsHash` pour détecter le drift mais n'enforce pas la cohérence
  au moment du set (un INS-1 = sexe M peut être saisi pour User-sexe-F).
- **Mitigation V1** : `insTraitsHash` calculé au set → audit forensique
  futur ("trait drift détecté entre set t0 et lecture t1").
- **Plan V2** : `assertTraitsCoherence` enforce au `setIns` (sexe-INS
  position 1 = `User.sex`, année naissance position 2-3 = `User.birthday
  .getFullYear() % 100`).
- **Décision DPO** : accepter V1 si dégradé d'identitovigilance documenté
  contractuellement.

### 3.3 MEDIUM — Audit `previousInsHmac` chaînage forensique

- **Risque** : Si un PS change l'INS d'un User (correction), pas de
  reconstruction triviale de l'historique sans chaînage.
- **Mitigation V1** : `setIns/clearIns` audit metadata inclut
  `previousInsHmac` (HMAC, pas plaintext) → DPO peut re-corréler en
  posant la question "ce HMAC correspond-il à INS X ?" via fonction
  interne contrôlée.
- **Acceptabilité** : OK V1.

### 3.4 MEDIUM — Rétention INS dans audit_logs

- **Risque** : Les audit rows USER_INS contiennent `insSetAt`,
  `insSetByRole`, `qualityStatus`, `previousInsHmac` indéfiniment.
  Diabeo retient les audit logs 6 ans (HDS Art. L.1111-8). Pas de
  problème direct, mais la rétention dépasse celle des données patient
  classiques (généralement 20 ans DMP post-dernier soin).
- **Mitigation V1** : aucune purge spécifique. Audit retention 6 ans
  s'applique.
- **Acceptabilité** : OK V1.

### 3.5 LOW — KMS envelope V2

- **Risque** : Clé applicative `HEALTH_DATA_ENCRYPTION_KEY` dans env-var
  partagée pour tous les champs chiffrés (nom, prénom, INS, etc.). En
  cas de compromission env-var, tout est lisible.
- **Mitigation V1** : RGS §B1 conforme (AES-256-GCM + 32 bytes hex).
  Rotation manuelle via runbook (M3 round 2).
- **Plan V2** : envelope KMS (OVH KMS) avec data-key chiffrée par
  master-key → rotation per-data-key indépendante.
- **Acceptabilité** : OK V1 POC.

## 4. Conformité ANSSI / HDS / ANS

- **RGS §B1 (cryptographie)** : AES-256-GCM 12-byte IV + 16-byte TAG
  + HMAC-SHA256 ≥ 32 bytes clé. ✅
- **RGS §B1.2 (cross-domain key reuse)** : `HMAC_SECRET` (lookup),
  `CONVERSATION_KEY_PEPPER` (messagerie), `AUDIT_PEPPER` (anonymisation
  audit IDs) — 3 secrets distincts. ✅ round 2 H1.
- **RGS §4.5 (headers HTTP defensifs)** : no-store + no-referrer +
  nosniff + CSP `default-src 'none'` sur routes INS. ✅ round 2 M2.
- **HDS § Art. L.1111-8 (traçabilité)** : `setIns/clearIns` audit
  transactionnel + `setByRole` + `previousInsHmac` chaînage. ✅
- **HDS § Art. L.1110-4 (secret médical)** : `resolvePatientForConsent`
  RBAC + 403 forbidden uniforme anti-énumération. ✅
- **CNIL délibération 2021-099 art. 4** : DPIA produite (ce document). ✅
- **Référentiel INS ANS v3 §4.1** : flag `insQualityStatus` distingue
  qualifié / non-vérifié. ✅
- **Référentiel INS ANS v3 §5.1** : `canBeSharedExternally` guard
  interdit propagation V1. ✅
- **Référentiel INS ANS v3 §6.3** : rate-limit anti-énumération
  (5 collisions/24h/auditUserId). ✅
- **Référentiel INS ANS v3 §4.2** : ⚠️ cohérence traits non-enforced V1
  (cf. §3.2) — bloqueur si on prétend qualifier l'INS.

## 5. Workflow opérationnel

```
1. Patient s'inscrit Diabeo via app → User créé (role=VIEWER)
2. PS saisit l'INS dans le backoffice OU patient le saisit (auto-onboarding)
   - Validation Luhn-97 → 422 si invalide
   - Rate-limit anti-énumération check → 429 si > 5 collisions/24h
   - Lookup HMAC → 409 + audit anonymisé si déjà registered (autre user)
   - Set INS chiffré + HMAC + qualityStatus=saisi_non_verifie + setByRole
3. PS consulte l'INS (DOCTOR ou NURSE) → audit READ + hasIns flag
4. Patient demande export RGPD Art. 20 → JSON inclut ins:{value, quality,
   setAt, disclaimer} (recepteur informé du statut non-vérifié)
5. Patient supprime son compte → cascade :
   - audit row USER_INS kind=user.ins.cleared reason=user_deletion
   - bulk anonymisation ins+insHmac+qualityStatus+setAt+setByUserId+traitsHash
6. PS corrige une saisie erronée (DELETE) → audit cleared reason=manual +
   previousInsHmac chaînage
```

## 6. Procédures opérationnelles (runbook)

### 6.1 Rollback humain saisie INS erronée

```sql
-- Avant l'UPDATE, audit la raison (resourceId = userId concerne).
INSERT INTO audit_logs (user_id, action, resource, resource_id, metadata, ...)
VALUES (
  <admin_user_id>, 'UPDATE', 'USER_INS', '<userId>',
  jsonb_build_object(
    'kind', 'user.ins.cleared',
    'reason', 'manual_rollback_pre_prod',
    'previousInsHmac', (SELECT ins_hmac FROM users WHERE id = <userId>)
  ), ...
);

-- Rollback atomique (passe le CHECK : all null OR all set).
UPDATE users
SET ins = NULL, ins_hmac = NULL, ins_quality_status = NULL,
    ins_set_at = NULL, ins_set_by_user_id = NULL, ins_traits_hash = NULL
WHERE id = <userId>;
```

### 6.2 Rotation HMAC_SECRET

Voir `docs/runbook/hmac-secret-rotation.md` (M3 round 2 review).

### 6.3 Re-correlation `collidingUserIdHmac` (DPO/RSSI uniquement)

```typescript
// Fonction interne — accès restreint DPO/RSSI.
import { hmacAuditId } from "@/lib/crypto/hmac"

function reconcileCollidingUserId(hmac: string): Promise<number | null> {
  // Compare le HMAC reçu avec tous les User.id existants via re-calcul.
  // Bornée à User.id sériels — 50k users → 50k HMAC à recalculer
  // côté admin tool (pas en API publique). ~quelques secondes acceptable.
  // ...
}
```

## 7. Validation

- [ ] Revue DPO sur §3.1 (posture saisi_non_verifie V1)
- [ ] Revue DPO sur §3.2 (cohérence traits déférée V2)
- [ ] Décision contractuelle "INS V1 strictement interne, jamais transmis"
- [ ] Runbook rotation HMAC_SECRET (M3 round 2)
- [ ] Runbook reconciliation `collidingUserIdHmac` DPO-only

---

**Références**
- US-2026 (`docs/UserStory/pro-user-stories/02-patients/US-2026-ins-identite-nationale-sante.md`)
- US-2126 (V2) Téléservice INSi
- PR #416 (rounds 1+2 review multi-agents)
- RGPD : Art. 6(1)(c) obligation légale, Art. 9(2)(h) soins, Art. 17 effacement, Art. 20 portabilité, Art. 32 sécurité, Art. 35 DPIA
- HDS : Art. L.1110-4 secret médical, Art. L.1111-8 traçabilité
- ANSSI : RGS §B1 cryptographie, RGS §4.5 durcissement web, RGS §B1.2 cross-domain key reuse
- ANS : Référentiel INS v3 (Mars 2024) §4.1 / §4.2 / §5.1 / §6.3
- CNIL : délibération 2021-099 du 22 juillet 2021 (INS)
- CSP : Code Santé Publique L.1111-8-1
