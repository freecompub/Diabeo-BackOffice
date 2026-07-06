# US-2651 — Algorithme d'ajustement multi-mode

> 📌 Épic US-2645 · back · Taille **L** · dépend de : US-2646, US-2647 · **validation `medical-domain-validator` obligatoire**

## Contexte
`src/lib/proposal-algorithm.ts` est **mono-mode basal-bolus**. Il faut le **router par mode** et couvrir
doses fixes (b) et non-insuliné (c) — **sans jamais franchir la ligne du dosage médicamenteux** (D7).

## Périmètre
- **Router `generateProposals(patient)` par `treatmentMode`** (US-2647).
- **Mode (a)** : conserver l'existant (`analyzeIsfSlot`/`analyzeIcrSlot`/`analyzeBasalTrend`, cap ± 20 %,
  min 3 événements & ≥ 2 %, confiance par volume, bornes dures, `pending`).
- **Mode (b) — nouveau `analyzeFixedDose*`** : base = **tendance glycémique par moment**
  (`BGM_CARNET.MIN_READINGS_PER_MOMENT`, `MEAL_TREND` PPG 2 h). Produit une proposition `fixedDose` bornée :
  cap **absolu** ± 1–2 U ou ± 10 % (le plus petit), plancher/plafond absolu de dose, **cooldown 72 h/moment**.
  **Jamais** : convertir doses fixes → basal-bolus, créer ISF/ICR ex nihilo.
- **Mode (c) — pas de proposition de dose** : produire uniquement des **flags/tâches d'orientation**
  (« à revoir en consultation »), rappels observance/analyses (HbA1c périmée `HBA1C_STALE_DAYS=180`),
  alertes de tendance (TIR < cible). La **cible glycémique** reste ajustable **par le médecin** (bornée
  `TARGET_MIN/MAX_MGDL`, plus stricte en `pregnancyMode`). **Interdiction absolue** de recommander une
  posologie orale/GLP-1 (frontière MDR/IEC 62304).
- **Bornes** : ajouter dans `CLINICAL_BOUNDS` les bornes dose fixe + caps patient (US-2652 les verrouille par test).
- **Grossesse/DG** : désactiver l'auto-proposition ou basculer sur cibles GD (`pregnancyMode`).

## Critères d'acceptation
- **AC-1** L'algorithme choisit sa logique selon le **mode** ; un DT1 n'est jamais traité en (c).
- **AC-2** Mode (b) : proposition de dose fixe **bornée** (cap absolu + cooldown), jamais de refonte de schéma.
- **AC-3** Mode (c) : **aucune** proposition de posologie ; uniquement flags/orientation/cible médecin.
- **AC-4** Toute proposition reste `pending` (jamais auto-appliquée) ; bornes vérifiées à la création.
- **AC-5** Couverture tests unitaires (par mode + cas limites) ≥ 80 %.

## Notes
- Le mode (c) **ne réutilise pas** `AdjustmentProposal` pour porter une dose — objet flag/tâche distinct.

## Révision post-revue (archi + HDS) — voir épic §12
- **Refus serveur** de toute `AdjustmentProposal` de dose si `treatmentMode=nonInsulin` ; mode (c) → `ClinicalReviewFlag` (défini US-2646), jamais une proposition de dose (§12.5, MDR).
- Remonter **`MAX_CHANGE_PERCENT=20`** (en dur) dans `CLINICAL_BOUNDS` (source unique testée) (§12 nit).
- Application `fixedDose` mode-aware côté `accept` (dépendance vers US-2649b).

## Journal d'implémentation

### Slice 1 — frontière MDR nonInsulin + hoist MAX_CHANGE_PERCENT (validé medical)
- `createProposal` **et** `createManual` refusent une proposition de dose si le mode dérivé serveur est
  `nonInsulin` → `nonInsulinNoDose` (422). Frontière MDR appliquée aux **deux** primitives de création
  (medical §A). Fail-closed : un DT1 n'est jamais `nonInsulin` (double garde `pathology==="DT1"` +
  `hadInsulinEver`) → jamais bloqué à tort.
- `MAX_CHANGE_PERCENT=20` hoisté vers `CLINICAL_BOUNDS` (source unique testée) ; l'algo le référence.
- Tests : +2 (createProposal + createManual nonInsulin), anti-drift `MAX_CHANGE_PERCENT`.

**Suivi (revue medical)** :
- **B (Medium, prioritaire)** : le refus nonInsulin est un cul-de-sac silencieux côté soignant → créer un
  **`ClinicalReviewFlag`** (« patient non insuliné a tenté une proposition — revoir l'indication ») pour
  remonter l'intention à l'équipe. Slice dédiée (lignée US-2646).
- **C (Low)** : `accept`/apply est sûr **par construction** (nonInsulin n'a aucun créneau → `…SlotNotFound`) ;
  re-check `resolveTreatmentMode` explicite = défense en profondeur optionnelle (non requise).

### Slice 2 — flag d'orientation à la tentative patient nonInsulin (mode c / suivi B)
Ferme le finding Medium B de la revue de #661 (l'intention du patient non insuliné était un
cul-de-sac silencieux).
- **`clinicalReviewFlagService.raise(patientId, type, createdBy, ctx)`** (nouveau) : lève un
  `ClinicalReviewFlag` (objet DISTINCT d'`AdjustmentProposal`, **jamais de posologie** — frontière MDR),
  **idempotent** (aucun doublon si un flag `open` du même type existe → anti-spam). Audit CREATE sans PHI.
- `createProposal` : un **PATIENT** non insuliné → lève `reviewInConsultation` (best-effort, idempotent)
  **puis** refuse (`nonInsulinNoDose`). Un clinicien (nurse/doctor) agit directement → pas de flag.
- Audit : nouvelle ressource `CLINICAL_REVIEW_FLAG`. Tests : +4 (création, idempotence, patient→flag,
  best-effort sur échec).

**Reste US-2651** : router `generateProposals` par mode · `analyzeFixedDose*` (mode b). **Suivi** :
surface UI des flags côté dashboard soignant (slice dédiée).

#### Corrections revue slice 2 (PR #662)
Revues code + medical + HDS : **frontière MDR intacte** (aucune dose dans le flag, à toutes les
couches), **PHI-free**, **own-scoped** (IDOR impossible), RGPD gaté.
- **A (code+HDS Medium)** : `createdBy ?? 0` → **`?? null`** (le sentinel 0 viole la FK `users.id` ;
  audit.service impose `null` pour un acteur système).
- **B (medical+HDS Medium)** : **chaque tentative refusée est auditée** (`PROPOSAL_REFUSED`, action
  distincte de `PROPOSAL_REJECTED`, sans dose) → les 2ᵉ…Nᵉ tentatives d'un patient (insistance) sont
  désormais **traçables** malgré le flag idempotent.
- **C (HDS Low)** : JSDoc corrigée (seule la création est auditée ; le skip idempotent ne l'est pas).

**Suivis tracés** : (1) **intention spécifique** — capturer le `parameterType` visé en métadonnée
**non-dosante** (schema change, medical Medium) ; (2) **surface UI des flags** (dashboard soignant —
sans elle le « dead-end » n'est fermé qu'à moitié) ; (3) TOCTOU (index partiel unique) + rate-limit POST (LOW).

### Slice 3 — surface UI des flags d'orientation (dashboard soignant)
Ferme le **caveat opérationnel** de la revue medical de #662 (le flag était écrit mais invisible).
- **`reviewFlagsQuery.forCaller`** (doctor-dashboard.service) : liste les `ClinicalReviewFlag` **ouverts**
  du portefeuille (scope RBAC `getAccessiblePatientIds`, cap 10, prénom déchiffré, audit READ). Jamais de posologie.
- **`GET /api/dashboard/medecin/review-flags`** (minRole NURSE, no-store) — miroir de `pending-proposals`.
- **`ReviewFlagsCard`** (dashboard médecin « Ma journée ») : carte read-only, polling 60 s, renvoie vers
  `/patients/[id]/review`. i18n `reviewFlags` (fr/en/ar) — `HbA1c`/`TIR` explicités.
- Tests : +2 (scope RBAC + audit ; portefeuille vide → []).

**Reste US-2651** : router `generateProposals` par mode · mode (b) `analyzeFixedDose*`. **Suivi** :
`parameterType` intent (non-dosant) dans le flag ; résolution du flag (marquer `resolved`).

##### Corrections revue slice 3 (PR #663)
- **A (Low)** : commentaire « Grille 2×2 » de `medecin/page.tsx` corrigé (5 cartes désormais).
- **Suivi B (Low, transverse)** : cap 10 silencieux (comme toute la famille dashboard : propositions
  cap 5, etc.) → amélioration éventuelle d'un indice « 10+ »/compteur total **transverse** à toutes
  les cartes (pas propre à celle-ci). Revues code+HDS : surface **scope-safe, PHI minimal, posology-free**.
