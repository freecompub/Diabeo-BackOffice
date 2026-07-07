# US-2655 — Socle serveur : enregistrement transactionnel d'un GROUPE de créneaux

> 📌 Sous-US de [US-2654](US-2654-EPIC-edition-creneaux-autonomie-graduee.md) · **back** (service + routes + migration) · Taille **L**
> · **Version : V1**
>
> **Statut** : 🟡 spécifiée — **aucun code avant validation.**
> **Dépend de** : US-2648 (gate d'écriture `{mode, coherent}`), US-2649a (index `one_pending_per_slot`).
> **Prépare** : US-2656 (UI groupe), US-2657 (niveaux de maturité proposition), US-2658 (génération à la demande).

La logique clinique associée est cataloguée dans `docs/clinical-logic/regles-et-constantes-diabete.md` (invariants « pas de chevauchement / pas de trou » ISF-ICR, `MAX_SINGLE_BOLUS`, bornes `ISF/ICR`).

---

## 1. Intention (voix produit)

- **Médecin (DOCTOR)** — « Quand je réorganise le profil ISF ou ICR d'un patient (j'ajoute un créneau, j'en fusionne deux, je décale une frontière), je veux **enregistrer tout le profil d'un coup** et savoir *avant* de valider que le résultat couvre bien les 24 h sans trou ni double dose. Je ne veux plus enchaîner 6 requêtes ligne à ligne qui peuvent laisser la config à moitié appliquée si l'une échoue. »
- **Infirmier (NURSE)** — « Je prépare une réorganisation complète du profil, mais je sais que mon geste part en **proposition** au médecin référent. Si une proposition est déjà en attente pour ce patient, je veux un message clair plutôt qu'une erreur technique. »
- **Patient** — « Ma sécurité repose sur le fait qu'un profil incohérent (un trou à 3 h du matin) **ne peut jamais être enregistré**. Le serveur doit refuser, pas “réparer” tout seul, et jamais appliquer un demi-profil. »

**Problème résolu** : aujourd'hui l'édition est ligne à ligne (`createIsf`/`createIcr`/`deleteIsf`/`deleteIcr`/`update*Hours`). Chaque geste atomique traverse un état transitoire *incohérent* (trou/chevauchement passager), ce qui rend le « no-gap strict » impossible à imposer à l'écriture et multiplie les collisions `P2002` sur l'index `one_pending_per_slot`. On passe à un **enregistrement de groupe « remplacer tout le jeu »** validé sur l'état **final** complet.

---

## 2. Décisions actées

| # | Décision | Raison |
|---|----------|--------|
| D1 | Endpoint **groupe « replace the whole set »** par paramètre (ISF, ICR ; basale pompe plus tard) | Le client envoie le jeu complet désiré ; le serveur remplace atomiquement. Fin des enchaînements ligne-à-ligne fragiles. |
| D2 | **REPLACE** (et non diff) | Simple, atomique. Le « 1 proposition à la fois » (D6) supprime le besoin de préserver l'identité d'une proposition in-flight à travers un diff. Compromis assumé : la proposition portant sur l'ancien jeu est **supersedée**. |
| D3 | **Cohérence re-validée côté serveur** — le serveur fait autorité, jamais de confiance au client | Chevauchement = **rejet dur** (risque double dose). Pour ISF/ICR : **no-gap strict** désormais applicable (on valide le jeu final complet, pas un déplacement mono-créneau transitoire) → trou = rejet. Basale : trou = **avertissement** (fenêtre suspendue légitime). |
| D4 | Autres invariants d'écriture : **bornes cliniques**, **durée nulle interdite**, **« ne peut pas finir à 0 créneau »** | Fail-closed. Un bolus doit toujours résoudre un créneau ; un profil vide n'est pas une config valide. |
| D5 | **Dénormalisation** ISF/ICR : `startHour/endHour` (int) **ET** `startTime/endTime` (`@db.Time`) tenus synchronisés | Cohérence avec l'existant (`create*`, `update*Hours`). Écrites ensemble dans la transaction. |
| D6 | **1 proposition à la fois par patient** : édition groupe d'un **non-DOCTOR** (→ devient proposition) refusée si une proposition `pending` existe, signal `proposalAlreadyPending` | Tue les collisions `P2002`. Un DOCTOR édite **directement** (jamais de proposition). |
| D7 | **Correction de l'IDOR pré-existant** : `deleteIsf`/`deleteIcr` (et tout chemin group-replace) doivent être **scopés patient** | `delete({ where: { id } })` sans scope patient = IDOR (suppression d'un créneau d'un autre patient). |
| D8 | **Audit du changement de groupe** (ancien jeu → nouveau jeu), **dans la transaction**, sans PHI | Traçabilité HDS/ANS ; `auditService.logWithTx`. |
| D9 | Recommandation : **un endpoint par paramètre** (PUT sur les routes collection existantes) adossé à **une primitive service générique** | Garde les schémas Zod par paramètre (bornes ISF vs ICR, `mealLabel` ICR) propres, mutualise le cœur transactionnel. |
| D10 | Ajout d'un statut **`superseded`** à `ProposalStatus` | Distingue « périmé par un remplacement DOCTOR » de `expired` (TTL) / `rejected` (revue humaine) pour la forensique, et libère l'index partiel `one_pending_per_slot` (`WHERE status='pending'`). |

---

## 3. Contrat d'API

### 3.1 Choix de forme (recommandation)

**Un endpoint par paramètre, verbe `PUT` sur la route collection existante** — sémantique REST correcte : `PUT` sur la collection = « remplace la représentation complète de la collection ». On réutilise les routes déjà en place (`requireRole`, `requireGdprConsent`, `resolvePatientId`, `extractRequestContext`, `SLOT_ERROR_STATUS`) et leurs schémas Zod par paramètre (bornes ISF `ISF_GL_MIN/MAX`, ICR `ICR_MIN/MAX`, `mealLabel`). Les deux routes délèguent à **une** primitive service générique `replaceSlotSet(...)` qui porte tout le cœur transactionnel (validation, scope, remplacement, supersede, audit).

> Rejeté : un endpoint unifié `PUT /api/insulin-therapy/slots` avec discriminateur `parameter`. Il forcerait un Zod discriminé + un mapping de colonnes conditionnel dans la route, sans gain — le cœur transactionnel est déjà mutualisé par la primitive service.

### 3.2 `PUT /api/insulin-therapy/sensitivity-factors`

Rôle requis : **DOCTOR** pour l'application directe. NURSE/PATIENT → routage proposition (voir §6), gardé par `proposalAlreadyPending`.

**Request body**
```jsonc
{
  "patientId": 42,          // optionnel — résolu via resolvePatientId (anti-IDOR)
  "slots": [                // JEU COMPLET désiré (remplace TOUT)
    { "startHour": 0,  "endHour": 8,  "sensitivityFactorGl": 0.40 },
    { "startHour": 8,  "endHour": 22, "sensitivityFactorGl": 0.30 },
    { "startHour": 22, "endHour": 24, "sensitivityFactorGl": 0.45 } // endHour 24 = minuit (encodage jour plein)
  ]
}
```

### 3.3 `PUT /api/insulin-therapy/carb-ratios`

Idem, `slots[]` = `{ startHour, endHour, gramsPerUnit, mealLabel? }`, bornes `ICR_MIN/MAX`.

### 3.4 Réponse (succès `200`)

```jsonc
{
  "applied": true,
  "mode": "direct",              // "direct" (DOCTOR) | "proposal" (non-DOCTOR, US-2657)
  "count": 3,
  "coverage": {                  // résultat de la re-validation serveur (analyzeSlotCoverage)
    "hasGap": false,
    "hasOverlap": false
  },
  "coverageWarning": null,       // "coverageGap" seulement pour la basale (trou = avertissement non bloquant)
  "supersededProposalIds": ["…"] // propositions pending du paramètre marquées superseded (DOCTOR direct)
}
```

Cas non-DOCTOR routé en proposition : `{ "applied": false, "mode": "proposal", "proposalCreated": true, ... }` (mécanique détaillée en US-2657 ; ici seule la **garde** `proposalAlreadyPending` est normative).

### 3.5 Codes d'erreur → HTTP

Erreurs métier stables, **sans PHI** (mêmes conventions que `SLOT_ERROR_STATUS`).

| Code métier | HTTP | Sens |
|---|---|---|
| `validationFailed` | **400** | Échec Zod (shape, bornes `ISF/ICR`, `startHour/endHour` ∈ [0,24]). |
| `zeroDurationSlot` | **400** | Un créneau avec `startHour === endHour`. |
| `slotOverlap` | **409** | Chevauchement dans le jeu soumis (double dose) — **dur**. |
| `slotGap` | **422** | Trou de couverture 24 h — **ISF/ICR uniquement** (basale : avertissement, pas d'erreur). |
| `emptySlotSet` | **409** | Jeu vide (`slots.length === 0`) — un profil ne peut pas finir à 0 créneau. |
| `proposalAlreadyPending` | **409** | Édition non-DOCTOR alors qu'une proposition `pending` existe déjà pour ce patient. |
| `settingsNotFound` | **404** | Pas d'`InsulinTherapySettings` pour ce patient. |
| `patientNotFound` (IDOR) | **404** | `resolvePatientId` → null, ou jeu ciblant un patient hors périmètre. **Jamais 403** (anti-énumération). |
| `gdprConsentRequired` | **403** | `requireGdprConsent` faux. |
| `serverError` | **500** | Interne, message générique. |

> Choix `409` vs `422` : le **chevauchement** est un conflit d'état (deux créneaux se disputent une minute) → `409`. Le **trou** est une entité sémantiquement invalide (couverture 24 h incomplète) → `422`. Aligné sur `SLOT_ERROR_STATUS` existant (`slotOverlapWouldRemain: 409`).

---

## 4. Logique service (transaction)

Nouvelle primitive générique dans `insulin-therapy.service.ts`, une seule `$transaction`. Signature type :

```ts
type ReplaceParam = "isf" | "icr"
async replaceSlotSet(
  param: ReplaceParam,
  patientId: number,
  slots: Array<{ startHour: number; endHour: number; sensitivityFactorGl?: number; gramsPerUnit?: number; mealLabel?: string }>,
  auditUserId: number,
  ctx?: AuditContext,
): Promise<{ applied: true; count: number; coverage: SlotCoverage; supersededProposalIds: string[] }>
```

### Algorithme (ordre normatif)

1. **Pré-validation pure (hors DB, fail-fast)** — sur le jeu reçu, avant toute écriture :
   - `slots.length >= 1` sinon `emptySlotSet` (**409**).
   - chaque créneau `startHour !== endHour` sinon `zeroDurationSlot` (**400**) — durée nulle. (Les bornes de valeur `ISF/ICR` et `startHour/endHour ∈ [0,24]` sont déjà garanties par le Zod route ; garde-fou service en défense en profondeur.)
   - **chevauchement** : `analyzeSlotCoverage(slots.map(toMinutes)).hasOverlap` → `slotOverlap` (**409**).
   - **couverture** : `analyzeSlotCoverage(slots.map(toMinutes))`. Pour **ISF/ICR**, `hasGap === true` → `slotGap` (**422**). (Pour la basale, à venir : `hasGap` ne rejette pas → `coverageWarning: "coverageGap"`.)

   > `toMinutes = (s) => ({ start: s.startHour * 60, end: s.endHour * 60 })`. `endHour = 24` (minuit) est géré par `analyzeSlotCoverage` (segment `[start, 1440]`).

2. **Ouverture `$transaction`** :

   a. **Scope patient (anti-IDOR)** — charger `settings = tx.insulinTherapySettings.findUnique({ where: { patientId }, select: { id: true } })`. `null` → `settingsNotFound` (**404**). **Toute** écriture qui suit est bornée à `settingsId` de CE patient. Le body ne porte jamais de `settingsId` ni d'`id` de ligne : impossible de toucher un autre patient.

   b. **Snapshot ancien jeu** (pour l'audit `from`) : `tx.insulinSensitivityFactor.findMany({ where: { settingsId } })` (resp. `carbRatio`), sélection `startHour/endHour/valeur` uniquement.

   c. **REPLACE** :
   - `deleteMany({ where: { settingsId } })` — **scopé `settingsId`** (corrige l'IDOR D7 : plus aucun `delete({ where: { id } })` non scopé).
   - `createMany({ data: slots.map(...) })` en écrivant **les deux** représentations (D5) : `startHour/endHour` **et** `startTime/endTime = new Date(\`1970-01-01T${HH}:00:00Z\`)`, plus la valeur (`sensitivityFactorGl` + `sensitivityFactorMgdl = gl*100` pour ISF ; `gramsPerUnit` + `mealLabel?` pour ICR).

   d. **Supersede des propositions impactées** (DOCTOR direct) — le baseline a changé, toute proposition `pending` du même `parameterType` pour ce patient devient obsolète :
   ```ts
   const superseded = await tx.adjustmentProposal.findMany({
     where: { patientId, parameterType, status: "pending" }, select: { id: true },
   })
   await tx.adjustmentProposal.updateMany({
     where: { patientId, parameterType, status: "pending" },
     data: { status: "superseded", reviewedAt: new Date(), reviewedBy: auditUserId },
   })
   ```
   `parameterType` = `insulinSensitivityFactor` (ISF) / `insulinToCarbRatio` (ICR). Sortir ces lignes de `pending` **libère l'index partiel** `one_pending_per_slot` et évite tout `P2002` résiduel.

   e. **Audit `logWithTx`** (D8, sans PHI) :
   ```ts
   await auditService.logWithTx(tx, {
     userId: auditUserId, action: "UPDATE", resource: "INSULIN_THERAPY",
     resourceId: `${param}-set:${settingsId}`,
     ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
     metadata: {
       patientId,                          // ADR #18 — pivot forensique per-patient
       op: "replaceSet",
       from: oldSlots.map(s => ({ startHour: s.startHour, endHour: s.endHour })),
       to:   slots.map(s => ({ startHour: s.startHour, endHour: s.endHour })),
       supersededProposalIds: superseded.map(p => p.id),
     },
   })
   ```
   > **Pas de valeurs cliniques déchiffrées** ; les créneaux (heures/frontières) ne sont pas des PHI directes mais on reste minimal : heures uniquement.

3. **Retour** `{ applied: true, count: slots.length, coverage, supersededProposalIds }`.

### Où vivent les invariants

| Invariant | Emplacement | Rôle |
|---|---|---|
| Chevauchement (double dose) | **Écriture** (`analyzeSlotCoverage`/`hasTimeSlotOverlap`, étape 1) | Rejet dur `slotOverlap`. |
| No-gap strict ISF/ICR | **Écriture** (étape 1, sur le jeu **final**) | Désormais applicable — plus d'état transitoire mono-créneau. `slotGap`. |
| Bornes / durée nulle / jeu non vide | **Route (Zod)** + **écriture** (défense en profondeur) | Fail-closed. |
| `coherent` (mode de traitement) | **Lecture** (`treatment-mode.service.ts`) — **inchangé** | Reste la **défense read-time** : toute lecture (calcul de bolus, UI) refuse une config incohérente. Le gate écriture ne le remplace pas, il le **complète**. |

Atomicité : toute exception (validation tardive, contrainte DB, supersede en course) **rollback** l'intégralité — jamais de demi-profil.

---

## 5. Schéma / migration

### 5.1 Colonnes — aucun ajout structurel pour REPLACE

`REPLACE` ne nécessite **aucune** nouvelle colonne sur `insulin_sensitivity_factors` / `carb_ratios` : la dénormalisation `startHour/endHour` + `startTime/endTime` existe déjà. `createMany` + `deleteMany` scopés `settingsId` suffisent.

### 5.2 `ProposalStatus` — ajout de `superseded` (D10)

```prisma
enum ProposalStatus {
  pending
  accepted
  rejected
  expired
  superseded   // US-2655 — proposition périmée par un remplacement DOCTOR direct du jeu de créneaux
}
```
Migration versionnée `ALTER TYPE "ProposalStatus" ADD VALUE 'superseded';` (additif, non destructif). L'index partiel `one_pending_per_slot` (`WHERE status = 'pending'`) est **inchangé** : `superseded` en sort naturellement. Alternative écartée : réutiliser `expired` — perte d'information forensique (TTL vs remplacement médecin).

### 5.3 « 1 proposition à la fois par patient » — **pré-check service**, pas de contrainte DB

Recommandation : **garde applicative** (dans la transaction du chemin proposition, non-DOCTOR), **pas** de nouvel index unique per-patient :
```ts
const pending = await tx.adjustmentProposal.count({ where: { patientId, status: "pending" } })
if (pending > 0) throw new Error("proposalAlreadyPending")   // → 409
```
Justification :
- La politique « max 1 pending / patient » est **amenée à évoluer** (US-2657 maturité) ; une contrainte DB dure (`UNIQUE(patient_id) WHERE status='pending'`) serait rigide et casserait le générateur moteur multi-créneaux existant.
- L'index **per-slot** `one_pending_per_slot` reste le **filet DB** contre les courses TOCTOU par créneau ; le pré-check per-patient est une **politique produit** au bon niveau (service).
- Fenêtre TOCTOU per-patient résiduelle : négligeable (geste humain rare, sérialisé par la transaction).

### 5.4 Correction IDOR (D7)

`deleteIsf`/`deleteIcr` actuels (`delete({ where: { id } })` sans scope) sont **remplacés** dans le chemin group-replace par `deleteMany({ where: { settingsId } })` (scopé patient via `settings`). Les primitives mono-ligne conservées ailleurs doivent elles aussi passer à `deleteMany({ where: { id, settings: { patientId } } })` (aligné sur `updateIsf`/`updateIcr` qui utilisent déjà `updateMany({ where: { id, settings: { patientId } } })`). Un `count === 0` → `isfSlotNotFound`/`icrSlotNotFound` (**404**, anti-IDOR).

---

## 6. Provenance & rôle

| Rôle | Chemin | Comportement |
|---|---|---|
| **DOCTOR** | `replaceSlotSet` direct | Applique **immédiatement** le jeu (acte thérapeutique). Supersede les `pending` du paramètre (D2/D10). `mode: "direct"`. |
| **NURSE / PATIENT** | Routage **proposition** | Le geste devient une proposition (mécanique détaillée en **US-2657**). **Ici, normatif** : pré-check `proposalAlreadyPending` (§5.3) → **409** si une proposition `pending` existe déjà pour le patient. `mode: "proposal"`. |

- **RBAC route** : `PUT` = `requireRole(req, "DOCTOR")` pour le chemin direct ; le chemin proposition non-DOCTOR est ouvert par une route dédiée / branchement en US-2657. Le RBAC réel reste **aux routes** (jamais dans le capability descriptor UI).
- **Gating maturité** (US-2657) hors périmètre ici : on pose seulement la **frontière DOCTOR-direct vs proposition** et la **garde one-pending**.
- **`source`** de la proposition dérivé serveur (`proposer.role`), jamais du body.

---

## 7. Critères d'acceptation (Gherkin)

```gherkin
Fonctionnalité: Enregistrement transactionnel d'un GROUPE de créneaux ISF/ICR

  Contexte:
    Étant donné un patient 42 avec des InsulinTherapySettings existants
    Et un utilisateur authentifié avec consentement RGPD valide

  Scénario: Remplacement valide par un DOCTOR (couverture 24 h saine)
    Étant donné un DOCTOR responsable du patient 42
    Quand il PUT /api/insulin-therapy/sensitivity-factors avec un jeu de 3 créneaux couvrant 0h→24h sans trou ni chevauchement
    Alors la réponse est 200 avec applied=true, mode="direct" et coverage.hasGap=false, coverage.hasOverlap=false
    Et l'ancien jeu de créneaux est intégralement remplacé par le nouveau

  Scénario: Rejet d'un chevauchement (double dose)
    Étant donné un DOCTOR responsable du patient 42
    Quand il soumet un jeu où deux créneaux se recouvrent (8h→14h et 12h→18h)
    Alors la réponse est 409 avec error="slotOverlap"
    Et aucun créneau n'est modifié en base

  Scénario: Rejet d'un trou de couverture (ISF/ICR, no-gap strict)
    Étant donné un DOCTOR responsable du patient 42
    Quand il soumet un jeu laissant 22h→24h non couvert
    Alors la réponse est 422 avec error="slotGap"
    Et aucun créneau n'est modifié en base

  Scénario: Trou de couverture toléré en basale (avertissement)
    Étant donné le chemin basale pompe (livraison ultérieure)
    Quand un jeu laisse une fenêtre 2h→3h non couverte (suspension légitime)
    Alors la réponse est 200 avec coverageWarning="coverageGap" et n'est PAS rejetée

  Scénario: Rejet hors bornes cliniques
    Étant donné un DOCTOR responsable du patient 42
    Quand il soumet un créneau ISF avec sensitivityFactorGl=1.50 (> ISF_GL_MAX)
    Alors la réponse est 400 avec error="validationFailed"

  Scénario: Rejet d'un créneau de durée nulle
    Étant donné un DOCTOR responsable du patient 42
    Quand il soumet un créneau où startHour=8 et endHour=8
    Alors la réponse est 400 avec error="zeroDurationSlot"

  Scénario: Rejet d'un jeu vide (ne peut finir à 0 créneau)
    Étant donné un DOCTOR responsable du patient 42
    Quand il soumet slots=[]
    Alors la réponse est 409 avec error="emptySlotSet"

  Scénario: IDOR — créneau d'un autre patient inaccessible
    Étant donné un DOCTOR NON responsable du patient 99
    Quand il PUT un jeu en ciblant patientId=99
    Alors la réponse est 404 avec error="patientNotFound"
    Et aucun créneau du patient 99 n'est modifié ni supprimé

  Scénario: DOCTOR applique directement (pas de proposition)
    Étant donné un DOCTOR responsable du patient 42
    Quand il remplace le jeu ISF
    Alors mode="direct" et le jeu est écrit immédiatement, sans création d'AdjustmentProposal

  Scénario: NURSE — geste routé en proposition
    Étant donné un NURSE sans proposition pending pour le patient 42
    Quand il soumet un remplacement de jeu
    Alors mode="proposal" et le geste ne modifie pas directement les créneaux

  Scénario: Blocage one-pending (proposalAlreadyPending)
    Étant donné un NURSE et une proposition pending existante pour le patient 42
    Quand il soumet un remplacement de jeu
    Alors la réponse est 409 avec error="proposalAlreadyPending"

  Scénario: Supersede des propositions impactées par un remplacement DOCTOR
    Étant donné une proposition ISF pending pour le patient 42
    Quand un DOCTOR remplace le jeu ISF directement
    Alors la proposition passe au statut "superseded"
    Et supersededProposalIds contient son id
    Et l'index one_pending_per_slot est libéré (aucun P2002 ultérieur)

  Scénario: Synchronisation de la dénormalisation Time
    Étant donné un DOCTOR responsable du patient 42
    Quand il enregistre un créneau startHour=8, endHour=22
    Alors startTime="08:00:00" et endTime="22:00:00" sont écrits en cohérence avec startHour/endHour

  Scénario: Audit émis dans la transaction
    Étant donné un remplacement DOCTOR valide
    Alors un AuditLog UPDATE INSULIN_THERAPY est écrit avec op="replaceSet", from/to (heures) et metadata.patientId
    Et aucune valeur clinique déchiffrée n'apparaît dans l'audit

  Scénario: Rollback atomique en cas d'échec
    Étant donné un remplacement qui échoue après suppression de l'ancien jeu (ex: contrainte DB)
    Alors la transaction est annulée entièrement
    Et l'ancien jeu de créneaux est intact (jamais de demi-profil)
```

---

## 8. Hors périmètre

- **UI d'édition de groupe** (formulaire multi-créneaux, prévisualisation couverture 24 h, gestion optimiste) → **US-2656**.
- **Niveaux de maturité de proposition** (qui peut proposer quoi, workflow de revue, granularité `source`/`confidence` du geste groupe non-DOCTOR) → **US-2657**. Ici seule la frontière DOCTOR-direct vs proposition + garde `proposalAlreadyPending` est posée.
- **Génération à la demande** de propositions (moteur déclenché manuellement) → **US-2658**.
- **Basale pompe en group-replace** : le contrat prévoit le paramètre (`coverageWarning`), mais l'implémentation `PumpBasalSlot` (dénormalisation `startTime/endTime` uniquement, `isDeliverableBasalRate`, trou = avertissement) est livrée dans un lot ultérieur de l'épic.

---

*Constat IDOR confirmé dans `src/lib/services/insulin-therapy.service.ts` (`deleteIsf`/`deleteIcr` = `delete({ where: { id } })` non scopé). Invariants trou/chevauchement : `src/lib/insulin/slot-coverage.ts` (`analyzeSlotCoverage`) + `src/lib/services/time-slot-utils.ts` (`hasTimeSlotOverlap`). Index partiel `one_pending_per_slot` : migration `20260710100000_us2652_fixeddose_moment_discriminator`.*
