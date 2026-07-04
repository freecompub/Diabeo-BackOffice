# US-2645 — EPIC : Édition de l'insulinothérapie (fiche + self-service patient) & ajustement multi-mode « propose → valide »

> 📌 Épic · fiche patient + espace patient · front + back + **migration Prisma** · Taille **XL**
> · fait suite à US-2630 (fiche patient unifiée) & US-2642 (unification ouverture) · concerne l'ADR #13
>
> **Statut** : 🟡 spécification (à valider) — **aucun code avant validation de l'US.**

## 1. Intention (voix produit)

> En tant que **médecin/infirmier**, je veux **consulter et modifier** l'insulinothérapie
> d'un patient **directement dans sa fiche** (`/patients/[id]`), pour éviter un écran
> séparé et garder une seule vérité.
>
> En tant que **patient**, je veux **voir ma thérapie** et **proposer un ajustement**
> depuis mon espace, **notifié à mon médecin pour validation** — sans jamais que ma
> demande ne s'applique seule.
>
> Le tout doit fonctionner que le patient soit sous **insulinothérapie complète**, sous
> **doses d'insuline simples**, ou **non insuliné** — et l'algorithme d'ajustement doit
> couvrir ces trois cas **sans jamais franchir la ligne du dosage médicamenteux**.

## 2. Décisions actées (avec l'utilisateur)

| # | Décision |
|---|---|
| D1 | **Médecin (DOCTOR)** édite en **direct** (effet immédiat). |
| D2 | **Infirmier (NURSE)** édite via **proposition** (`pending`) → **validée par un DOCTOR**. |
| D3 | **Patient** édite via **proposition** (`pending`) → **notifiée + validée par un DOCTOR**. Jamais d'auto-application. |
| D4 | L'éditeur vit dans l'**onglet « Traitements »** de la fiche patient (qui passe de lecture seule à éditable) — pas d'écran séparé. La page autonome `/insulin-therapy` devient une redirection vers la fiche. |
| D5 | Accès **patient** aussi via un **item de navigation** de l'espace patient. |
| D6 | Feature **treatment-mode-aware** : 3 modes (voir §4). L'algorithme d'ajustement couvre les 3. |
| D7 | **Interdiction absolue** : proposer/ajuster automatiquement une **posologie orale ou GLP-1** (frontière dispositif médical MDR/IEC 62304). Mode non-insuliné = orientation, pas dosage. |

> ✅ **Verrouillé (décision utilisateur)** : le validateur (accept/reject) est **DOCTOR
> only** — et plus précisément **rôle exactement DOCTOR** (pas `hasMinRole`, donc **ADMIN
> exclu** : rôle technique, non clinicien) **+ `canAccessPatient`**. NURSE et patient
> **proposent** uniquement. Un DOCTOR édite en direct (D1) et n'a pas à passer par une
> proposition.

## 3. Constat technique (ce qui bloque aujourd'hui)

Ancré dans le code (cf. synthèse `medical-domain-validator`) :

- **`AdjustmentProposal` n'a pas de provenance** — `reviewedBy` existe, mais **pas** de
  `proposedByRole` / `proposedByUserId` (`prisma/schema.prisma`). Le flux « patient/infirmier
  propose » **n'est pas modélisable** en l'état. `adjustmentService.createManual` est « DOCTOR only ».
- **`enum AdjustableParameter` = 3 valeurs** seulement : `basalRate`, `insulinSensitivityFactor`,
  `insulinToCarbRatio`. Pas de **dose fixe**, pas de cible. `validateProposedValue` / `accept()`
  ne savent appliquer que ces 3 types.
- **`src/lib/proposal-algorithm.ts` est mono-mode basal-bolus** (`analyzeIsfSlot`/`analyzeIcrSlot`/
  `analyzeBasalTrend`, cap `MAX_CHANGE_PERCENT = 20`, seuil 3 événements + 2 %). Rien pour dose
  fixe ni non-insuliné.
- **`PatientInsulin.dosage` est du texte libre** (« 18U le soir ») → **non calculable** : une
  proposition « +2 U » n'a pas de valeur numérique de départ fiable. Il faut une dose fixe **structurée**.
- L'onglet **Traitements** (`treatment-view.ts`) est une **projection lecture seule** ; l'édition
  vit sur `/insulin-therapy` (page **orpheline de nav**, cf. `docs/inventory/composants-orphelins.md`).
- La page de **validation** `/adjustment-proposals` (accept/reject `pending`) **existe déjà** mais
  est **orpheline** (aucun lien de nav) → à surfacer. `push.service.ts` existe pour la notification.

## 4. Modes de traitement (taxonomie)

| Mode | Détection (schéma actuel) | Ajustable | Le **patient** peut proposer ? |
|---|---|---|---|
| **(a) Basal-bolus / pompe** | `InsulinTherapySettings` présent + `sensitivityFactors[]` & `carbRatios[]` non vides. Pompe : `deliveryMethod=pump` + `PumpBasalSlot[]`. MDI : `deliveryMethod=manual`. | ISF (g/L/U), ICR (g/U), débit basal/slot (U/h) | **Non** en valeur brute (trop technique/dangereux). Peut au mieux **signaler un ressenti** → *flag*, pas une valeur. |
| **(b) Doses simples / fixes** | `BasalConfiguration.configType = single_injection \| split_injection` (`morningDose`/`eveningDose`/`dailyDose`) ; et/ou `PatientInsulin.dosage` texte libre. ISF/ICR vides/partiels. | Dose fixe par moment (matin/midi/soir/nuit) — **après structuration numérique** | **Encadré** : ± quelques unités sur une dose fixe (voir §6), jamais une refonte de schéma. |
| **(c) Non insuliné** | **Aucun** `InsulinTherapySettings` **et** aucun `PatientInsulin` actif bolus/basal/both. Traitement `Treatment.type=glp1` ou ADO (module médicaments) ; DT2/GD diététique. | Cible glycémique (médecin), rappels/observance, orientation. **Aucun dosage médicamenteux.** | Le patient **déclare** (glycémies, ressenti, observance), il **ne propose pas de posologie**. |

> Détection : dérivable, mais l'US recommande un champ explicite **`Patient.treatmentMode`**
> (plus sûr, auditable, évite les faux positifs sur configs incohérentes).

## 5. Algorithme d'ajustement par mode — ce qu'il propose / ne propose **jamais**

- **Mode (a)** : conserver les garde-fous existants (`proposal-algorithm.ts` + `adjustment.service.ts`) —
  cap ± 20 %/proposition, min 3 événements & ≥ 2 %, confiance par volume, bornes dures
  `CLINICAL_BOUNDS` à l'application, `status=pending`, `accept` DOCTOR-only.
- **Mode (b)** : nouvelle mécanique — type `fixedDose` + moment cible ; base = **tendance
  glycémique par moment** (`BGM_CARNET.MIN_READINGS_PER_MOMENT`, `MEAL_TREND` PPG 2 h) ; **bornes
  à créer** (cap absolu ± 1–2 U ou ± 10 %, plancher/plafond absolu de dose, **cooldown 72 h**).
  **Jamais** convertir doses fixes → basal-bolus (acte médical), ni créer ISF/ICR pour un patient
  qui n'en a pas.
- **Mode (c)** : **pas d'`AdjustmentProposal` de dose**. Objet = **flag/tâche d'orientation**
  (« à revoir en consultation »), rappels observance/analyses (HbA1c périmée `HBA1C_STALE_DAYS=180`),
  cible glycémique (médecin, bornée `TARGET_MIN/MAX_MGDL`, plus stricte en `pregnancyMode`), alertes
  de tendance (TIR sous cible). **Interdit** : recommander/ajuster une posologie orale/GLP-1.

## 6. Garde-fous « proposition patient » (obligatoires)

- **Bornes cliniques dures** rejetées **à la création** (pas seulement à l'accept) — étendre
  `validateProposedValue`.
- **Cap variation patient resserré** (< moteur) : ex. ± 10 % ISF/ICR, ± 1–2 U dose fixe.
- **Sens interdit patient** : refuser toute **baisse de basal/dose** (risque hyper/cétose) et toute
  hausse qui rapproche d'une hypo — décision médecin.
- **Anti-spam** : 1 proposition patient en attente max par paramètre/slot + cooldown (72 h).
- **Champs obligatoires** : motif structuré (`AdjustmentReason`) + justification patient (réutiliser
  `AdjustmentProposalAck.comment`, chiffré) + fenêtre de données support ≥ planchers de suffisance.
- **Jamais d'auto-application** : `applyImmediately` désactivé pour toute proposition non-DOCTOR
  (aligné ADR #13). La seule voie reste `…→ AdjustmentProposal(pending) → review DOCTOR`.
- **Audit** : `auditService.log` sur create/accept/reject + provenance en metadata.

## 7. Cas limites à border (§ risques)

Grossesse/DG (`pregnancyMode` — cibles strictes, désactiver auto-proposition ou basculer cibles GD) ·
pédiatrie (cap **absolu en U**, co-signature `PediatricCaregiver`) · **DT1 jamais traité comme mode (c)**
(router par `pathology` + présence settings) · insuffisance rénale / sujet âgé (validation médecin
renforcée, pas de hausse auto — pas de champ comorbidité aujourd'hui) · **config incohérente** (bloquer
toute proposition si `hasGap`/`hasOverlap`/`bolusInconsistent` signalés par `buildTreatmentView`) ·
toute extension d'`AdjustableParameter` **doit** ajouter sa borne dans `CLINICAL_BOUNDS` + branche
`validateProposedValue` + test `tests/unit/clinical-bounds.test.ts`.

## 8. Décomposition (sous-US)

| US | Titre | Portée | Dépend de |
|---|---|---|---|
| **US-2646** | Socle données : provenance proposition + dose fixe structurée + enum + `treatmentMode` | back / migration | — |
| **US-2647** | Détection du mode de traitement (a/b/c) + gating fail-closed | back | 2646 |
| **US-2648** | Onglet « Traitements » **éditable** (fiche pro) : lecture tous / DOCTOR direct / NURSE→proposition | front/back | 2646, 2647 |
| **US-2649** | Flux **proposition → validation** : provenance, notifications push, UI validation (surface `/adjustment-proposals`) | front/back | 2646 |
| **US-2650** | **Self-service patient** : route `(patient)` + item de nav + lecture + proposer (bornes strictes) | front/back | 2648, 2649 |
| **US-2651** | **Algorithme multi-mode** : router par mode ; `fixedDose` (b) ; flags/orientation (c) ; bornes | back | 2646, 2647 |
| **US-2652** | Garde-fous cliniques & cas limites + i18n/acronymes + design-system + tests + docs | transverse | 2646→2651 |

**Chemin critique** : `2646 → 2647 → {2648, 2651} → 2649 → 2650 → 2652`.

## 9. Critères d'acceptation (épic)

- **AC-1** Dans `/patients/[id]` onglet Traitements : lecture pour tout rôle autorisé ; **DOCTOR**
  édite en direct ; **NURSE** et **patient** créent une **proposition** `pending` (jamais appliquée seule).
- **AC-2** Le comportement s'adapte au **mode** (a/b/c) détecté ; un DT1 n'est jamais traité en mode (c).
- **AC-3** L'algorithme ne propose **aucune posologie médicamenteuse** en mode (c) — uniquement
  flags/orientation/cible.
- **AC-4** Toute valeur hors `CLINICAL_BOUNDS` est **rejetée à la création** ; cap patient < moteur ;
  baisse de basal/dose interdite côté patient.
- **AC-5** Le patient accède à sa thérapie depuis son espace (nav), en lecture + proposition, **sans
  jamais voir/énumérer l'id d'un autre patient** (scope serveur sur `user.id`).
- **AC-6** Provenance (`proposedByRole`/`proposedByUserId`) tracée + auditée ; validation DOCTOR
  auditée (`reviewedBy`).
- **AC-7** Aucune migration destructive ; `db push` interdit en prod ; tests bornes cliniques verts.

## 10. Hors périmètre

- Dosage automatique de médicaments oraux / GLP-1 (interdit, D7).
- Refonte de stratégie thérapeutique (doses fixes ⇄ basal-bolus) = acte médical hors app.
- Alignement iOS (à traiter séparément via `swift-expert` si le modèle de données bouge).

## 11. Validation requise avant dev

- `medical-domain-validator` (bornes dose fixe, cas grossesse/pédiatrie) — **synthèse initiale faite**.
- `healthcare-security-auditor` (scope patient own-id, audit provenance, PHI).
- `architect-reviewer` (extension `AdjustmentProposal` vs nouvel objet pour le mode c).
- `prisma-specialist` (migration provenance + dose fixe structurée + enum).

## 12. Revue archi + HDS — changements **imposés** (source unique)

> Consolidé des revues `architect-reviewer` (B/A/N) et `healthcare-security-auditor`
> (CRITICAL/HIGH/MEDIUM/LOW). **Ces points ne sont pas optionnels** — chaque sous-US
> renvoie ici.

### 🔴 Bloquants / CRITICAL
1. **Provenance = enum `ProposalSource` (`ALGORITHM|PATIENT|NURSE|DOCTOR`)**, pas `Role`.
   `proposedByUserId` **nullable** + `CHECK` DB (`ALGORITHM → userId IS NULL` ; sinon NOT NULL).
   **Toujours dérivé serveur** (`session.user.id/role`), jamais lu du body (anti-usurpation).
   Backfill des lignes existantes → `ALGORITHM`. *(US-2646)*
2. **Union taguée sur `AdjustmentProposal`** (pas de sous-typage) : rendre `supportingEvents`,
   `confidence`, `analysisPeriod`, `dataQuality`, `averageObservedValue` **nullable** +
   `CHECK` conditionnel `source=ALGORITHM → supportingEvents & confidence NOT NULL`. *(US-2646)*
3. **`fixedDose` atomique en US-2646** : enum `AdjustableParameter.fixedDose` **+** bornes
   `CLINICAL_BOUNDS` (min/max/cap absolus U) **+** branche `validateProposedValue` **+** test,
   livrés **ensemble**. **Ne PAS** ajouter `glucoseTarget` à l'enum (la cible = **édition directe
   DOCTOR** sur `GlucoseTarget`/`CgmObjective`, jamais une proposition). *(US-2646)*
4. **Table dédiée `FixedDoseSlot`** (`patientInsulinId`, `moment`, `valueU`…) — **pas**
   `BasalConfiguration` (basal-only, 2 moments, 1:1 settings). **Pas de backfill auto** du texte
   libre `PatientInsulin.dosage` (fourchettes non parsables) → **structuration opt-in par un PS**. *(US-2646)*
5. **Objet distinct mode (c)** : nouveau `ClinicalReviewFlag` (`patientId`, `type`, `status`,
   `createdBy` nullable, `resolvedBy`) — **défini en US-2646**. Le mode (c) ne crée **jamais**
   d'`AdjustmentProposal` de dose. *(US-2646 + US-2651)*
6. **Transport d'ÉCRITURE injecté** symétrique à `fetchAnalytics` (`mutate(endpoint, body)`),
   identité résolue par l'adaptateur (jamais l'URL construite par le composant → anti-énumération).
   **Éditeur `variant="page"` uniquement** : un `x-consultation-token` de **lecture** (drawer) ne doit
   **jamais** autoriser une écriture insuline (escalade de privilège) → fail-closed. Capability
   descriptor serveur `{ mode, canEditDirect, canPropose }`. *(US-2648)*
7. **RBAC écriture directe** (CRITICAL HDS) : les routes `POST/PATCH /api/insulin-therapy/*` sont
   aujourd'hui `requireRole(NURSE)` (hiérarchique → NURSE écrit en direct). Les passer à **DOCTOR
   exact** ; NURSE → **403** et doit passer par l'endpoint de proposition. Re-routage **serveur**,
   pas UI. Test E2E : `NURSE PATCH insulin-therapy/*` → 403. *(US-2648)*
8. **Validation = DOCTOR exact + `canAccessPatient`** (MEDIUM HDS) : `requireRole(DOCTOR)` laisse
   passer **ADMIN** → exclure. `accept/reject` : rôle exact DOCTOR, jamais l'UI. *(US-2649b)*

### 🟠 À intégrer
- **`treatmentMode` dérivé = source de vérité** ; le gate d'écriture **re-dérive dans la même
  transaction** (Prisma 7 sans `$use()` → pas de recalcul middleware fiable). `Patient.treatmentMode`
  persisté = **cache d'affichage** recalculé en transaction, **jamais** l'autorité (fail-**closed**).
  Migration : **pas** de défaut global `basalBolus` ; backfill via détection (DT1 jamais `nonInsulin`). *(US-2646/2647)*
- **Scinder US-2649** : **2649a** (primitive `createProposal` : provenance serveur, bornes-à-la-création,
  anti-spam, `validateProposedValue` étendu) livrée **avant US-2648** ; **2649b** (notifications + UI
  `/adjustment-proposals` + accept/reject mode-aware) après 2648/2651. Corriger les `dépend de` (2649 dépend
  aussi de 2647 et 2651). *(dépendances)*
- **`accept()` sûr** : `updateMany` silencieux → vérifier `count === 1` (sinon rollback + « slot introuvable »).
  **Re-lire la valeur courante** au moment de l'accept, revalider le delta vs `currentValue` figée ; drift →
  refus d'auto-application, re-saisie médecin. `applyImmediately` **forcé `false`** pour `source != DOCTOR`.
  `validateProposedValue` **à la création ET à l'accept** (double gate). *(US-2649)*
- **Justification patient = champ dédié chiffré** `AdjustmentProposal.proposerComment` (AES-256-GCM),
  **pas** `AdjustmentProposalAck.comment` (qui est la réponse patient post-décision, 1:1). *(US-2646/2650)*
- **Self-service patient own-id strict** : résolution **exclusive** `getOwnPatientId(user.id)` ; **aucun**
  `?patientId`, **aucun** `x-consultation-token` sur les routes patient ; Zod **sans** `patientId`. Re-scoper
  `/api/patient/insulin-settings`. Test : VIEWER visant un autre id / avec token → toujours son dossier. *(US-2650)*

### 🟡 Nits (à ne pas perdre)
- **Audit sans PHI** : `resourceId=proposalId` + `metadata={patientId, proposedByRole}` ; **jamais** de
  dose/valeur en clair dans log/notif/URL. Notif push = corps générique + `data={type, proposalId}`,
  détails via API auth. *(US-2649b)*
- **Anti-spam serveur** : index unique partiel PG « 1 `pending` max par (patientId, parameterType, slot)
  `WHERE status='pending'` » + cooldown 72 h. *(US-2649a)*
- **Redirect `/insulin-therapy` role-branché** (DOCTOR/NURSE → fiche ; VIEWER → route patient). *(US-2648/2650)*
- **Réutiliser le mapper pur `treatment-view.ts`** pour la détection (ratios complets, gap/overlap). *(US-2647)*
- **`MAX_CHANGE_PERCENT=20`** en dur → remonter dans `CLINICAL_BOUNDS`. *(US-2651)*
- **`InsulinSummary`** : vérifier absence de fuite import client/serveur avant montage `(patient)`. *(US-2650)*
- **ADR #21** devient « 1 composant présentational, **N transports** » (ajout own-id patient) ; **DPIA** :
  documenter les doses numériques en clair (calculabilité → at-rest pgcrypto + RBAC). *(US-2652)*

---

*Sources : agents `medical-domain-validator`, `architect-reviewer`, `healthcare-security-auditor`
(fichiers cités : `prisma/schema.prisma`, `src/lib/clinical-bounds.ts`, `src/lib/proposal-algorithm.ts`,
`src/lib/services/adjustment.service.ts`, `src/lib/auth/{rbac,query-helpers}.ts`, `src/lib/access-control.ts`,
`src/app/api/insulin-therapy/*`, `src/app/api/adjustment-proposals/[id]/{accept,reject}/route.ts`,
`src/components/diabeo/patient/PatientRecordContext.tsx`, `treatment-view.ts`).*
