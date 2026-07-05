# US-2648 — Onglet « Traitements » éditable (fiche pro) : lecture tous / DOCTOR direct / NURSE→proposition

> 📌 Épic US-2645 · front + back · Taille **L** · dépend de : US-2646, US-2647

## Contexte
L'onglet Traitements de `/patients/[id]` est aujourd'hui une **projection lecture seule**
(`treatment-view.ts`) ; l'éditeur vit sur la page orpheline `/insulin-therapy`. On **fusionne** :
l'onglet devient l'éditeur (une seule vérité, cohérent US-2630/US-2604).

## Périmètre
- Rendre l'onglet **Traitements** éditable **in place** dans `<PatientRecord variant="page">`,
  en réutilisant la logique de `/insulin-therapy` (formulaires ISF/ICR/basal + dose fixe selon mode).
- **RBAC / flux** (décisions D1–D3) :
  - **DOCTOR** → écriture **directe** (effet immédiat), via `/api/insulin-therapy/*` existant.
  - **NURSE** → l'action « enregistrer » crée une **`AdjustmentProposal` `pending`** (`proposedByRole=NURSE`),
    n'écrit pas en direct.
  - Lecture pour tout rôle autorisé (`canAccessPatient`).
- **Adaptatif au mode** (US-2647) : mode (a) édite ISF/ICR/basal ; mode (b) édite les **doses fixes
  structurées** ; mode (c) → **pas d'éditeur d'insuline**, affiche cible/orientation (lecture) +
  renvoi vers le suivi.
- Décommissionner la page autonome `/insulin-therapy` → **redirection** vers `/patients/[id]` (onglet
  Traitements) pour ne pas casser les liens ; retirer le code d'écran dupliqué.
- Fetch **transport-agnostique** (id fourni par la fiche, gardé `canAccessPatient` — pas de `?patientId`
  construit côté client, cohérent anti-énumération US-2642).

## Critères d'acceptation
- **AC-1** DOCTOR modifie ISF/ICR/basal/dose → appliqué immédiatement + audité.
- **AC-2** NURSE modifie → **proposition `pending`** créée (rien appliqué) + notif (US-2649).
- **AC-3** L'éditeur affiché correspond au **mode** ; mode (c) n'expose aucun champ de dose insuline.
- **AC-4** `/insulin-therapy` redirige vers la fiche ; aucune régression d'accès/audit.
- **AC-5** A11y (ARIA sur formulaires), acronymes ISF/ICR explicités, design-system respecté.

## Notes
- Bornes cliniques appliquées serveur (inchangé) ; l'UI n'assouplit jamais les bornes.

## Révision post-revue (archi + HDS) — voir épic §12
- **Transport d'ÉCRITURE injecté** (`mutate`) symétrique à `fetchAnalytics` ; identité résolue par l'adaptateur (anti-énumération) (§12.6).
- **Éditeur `variant="page"` uniquement** — jamais en contexte drawer/`x-consultation-token` (escalade de privilège), fail-closed. Capability descriptor serveur `{mode, canEditDirect, canPropose}` (§12.6).
- 🔴 **CRITICAL HDS** : passer les routes `POST/PATCH /api/insulin-therapy/*` de `requireRole(NURSE)` à **DOCTOR exact** ; NURSE → **403** + endpoint de proposition. Re-routage **serveur**. Test E2E `NURSE PATCH → 403` (§12.7).
- Redirect `/insulin-therapy` **role-branché** (DOCTOR/NURSE → fiche ; VIEWER → route patient) (§12 nit).

## US-2648a (livré) — socle backend RBAC + route de proposition
Tranche backend (débloque le front US-2648b) :
- 🔴 **CRITICAL HDS résolu** : `POST/PUT/DELETE /api/insulin-therapy/*` (settings, sensitivity-factors, carb-ratios, basal-config, pump-slots) passés de `requireRole(NURSE)` à **`requireRole(DOCTOR)`** — NURSE en écriture directe → **403**.
- **`POST /api/adjustment-proposals`** (route de proposition NURSE/patient/DOCTOR) : ferme les obligations route de US-2649a — accès via `resolvePatientId` (VIEWER→son dossier / pro→`canAccessPatient`), rôle proposeur **dérivé session** (ADMIN→403), réponse **sans `proposerComment`**, mapping erreurs métier→HTTP (422/400/404/409). `fixedDose` exclu du schéma.
- Tests : 8 (route POST) + RBAC. Catalogue diabète §6 mis à jour.

**Reste US-2648b (front)** : onglet Traitements éditable dans `<PatientRecord>` (transport `mutate` injecté, `variant="page"` only), capability descriptor serveur `{mode, canEditDirect, canPropose}`, redirect `/insulin-therapy` role-branché, `refreshTreatmentMode(tx)` writer, E2E `NURSE→403` + `NURSE save→proposition`.

### US-2648b (en cours) — slice 1 : capability descriptor
- `src/lib/insulin/edit-capability.ts` — `deriveEditCapability(role, {mode,coherent})` **pur** (sans dépendance serveur → importable client) : `canEditDirect` / `canPropose` + `editableParameters` **par mode** (fail-closed : `basalBolus`+cohérent → ISF/ICR/basal ; sinon vide).
- `treatmentModeService.getInsulinEditCapability(role, patientId)` (résout le mode en base).
- `GET /api/insulin-therapy/capability?patientId=` — accès `resolvePatientId`, aucune valeur de dose renvoyée.
- Tests : 12 (matrice rôle×mode + route). Catalogue §6 mis à jour.

**Reste 2648b** : onglet Traitements éditable dans `<PatientRecord>` (formulaires ISF/ICR/basal, transport `mutate` injecté, `variant=page`), branchement direct-write (DOCTOR) vs proposition (NURSE/patient), redirect `/insulin-therapy` role-branché, `refreshTreatmentMode(tx)` writer, E2E.

#### AC UI du slice React (issus de la revue clinique PR #645)
- **`blockedReason: "incoherentConfig"`** : afficher au **DOCTOR** un chemin **« corriger / configurer »** (écriture directe possible hors gate de cohérence), jamais un cul-de-sac « non éditable ». Cas `{canEditDirect:true, editableParameters:[], blockedReason}` — l'UI doit gérer ce trio (testé).
- **`blockedReason: "modeNotEditable"` + mode `fixedDose`** : message **clinique honnête** (« titration via votre soignant »), pas « non éditable » sec — la population sous doses fixes ne doit pas être silencieusement bloquée sans canal alternatif explicite.
- **Follow-up epic** : capability **par créneau** (permettre d'éditer uniquement le slot qui répare l'incohérence) — le gating global est acceptable en slice 1.

### US-2648b (en cours) — slice 2a : bandeau capability dans l'onglet Traitements
- `useInsulinCapability()` (`PatientRecordContext`) : fetch du capability descriptor via le transport **injecté** (id-less, `GET /api/insulin-therapy/capability`).
- `InsulinEditBanner` + `deriveBannerContent` (pur, testé) : badge de **mode** + messages d'état portant les **AC UI cliniques** — « configuration à revoir » + indice « corriger » si écriture directe, message honnête « doses fixes / titration via soignant », note non-insuliné.
- Câblé en tête de l'onglet Traitements de `<PatientRecord>` (silencieux hors provider / tant que non chargé).
- i18n fr/en/ar (`patientDetail`). Tests : 5 (matrice bannière).

**Reste 2648b** : formulaires d'édition/proposition (CTA « Modifier » DOCTOR / « Proposer » NURSE-patient → `POST /api/adjustment-proposals`), transport mutation injecté, `refreshTreatmentMode(tx)`, redirect `/insulin-therapy` role-branché, E2E.

#### Corrections revue slice 2a (PR #647)
- Route capability rendue **transport-agnostic** (`resolvePatientIdFromQuery`) : le bandeau ne disparaît plus en mode drawer (ADR #21).
- `useInsulinCapability` keyé sur `fetchAnalytics` (stable) : plus de re-fetch ni d'audit READ superflu à chaque changement de période.
- A11y : association programmatique libellé↔badge (`aria-label`, WCAG 1.3.1) ; `aria-live` redondant retiré. RTL confirmé géré par `dir=rtl` au niveau `<html>` (pas de flex-reverse).
- **Différé** : état `error` du bandeau (actuellement silencieux) → note « mode indisponible » (non critique, slice ultérieur).

### US-2648b (en cours) — slice 2b : flux « Proposer » ISF/ICR
- Créneaux ISF/ICR rendus **adressables** : `Slot` porte `startHour`/`endHour` (`treatment-view`).
- Transport de **mutation injecté** : `RecordMutator` + `usePagePatientMutator` (POST id-less, `patientId` ajouté au corps par l'adaptateur page ; `mutate` optionnel → fail-closed hors contexte éditable).
- `insulin-proposal.ts` (pur, testé) : `mapProposalOutcome` (status→message) + `buildProposalBody` (créneau ISF→`timeSlot*`, ICR→`carbRatioSlot*`, `reason=manualAdjustment`).
- `InsulinProposalDialog` : bouton « Proposer » par créneau (gated `capability.canPropose` + paramètre éditable) → dialog (nouvelle valeur + commentaire) → `POST /api/adjustment-proposals` → issue annoncée en `aria-live` (doublon/hors-bornes/garde-fou). Jamais appliqué (ADR #13).
- i18n fr/en/ar. Tests : 12 (mapping + corps).

**Reste 2648b** : proposition **basal** (nécessite `pumpBasalSlotId`), **édition directe DOCTOR** (PUT settings/ISF/ICR), `refreshTreatmentMode(tx)`, redirect `/insulin-therapy` role-branché, transport drawer, E2E.

#### Corrections revue slice 2b (PR #648)
- A11y : focus rendu au trigger (`finalFocus`, WCAG 2.4.3) ; `aria-invalid` sur le champ en erreur (3.3.1) ; deux régions live **stables** erreur/succès (4.1.3) ; `aria-describedby` parent retiré (hint préservé).
- Clinique : **plage autorisée** affichée en indice (`min–max unité` depuis `CLINICAL_BOUNDS`) — évite les typos ; serveur reste l'autorité.
- Robustesse : signal d'`abort` transmis au `mutate` + annulation à la fermeture (anti-course) ; `maxLength=1000` sur le commentaire.
- Différé (LOW, tracé) : delta live « vs valeur actuelle » ; affichage « patient requested » côté review médecin (US-2649b).

### US-2648b (en cours) — slice 2c : proposition BASAL (créneau pompe)
- `BasalSlot` porte `pumpBasalSlotId` (exposé via `getSettings`/`treatment-view`) → créneau pompe adressable.
- `ProposalTarget` discriminé (`timeSlot` ISF/ICR | `pumpSlot` basal) ; `buildProposalBody` construit `pumpBasalSlotId` pour le basal. `ProposableParameter` = ISF/ICR/basal.
- `InsulinProposalDialog` généralisé (slot d'affichage + `target`) ; bornes basal (`BASAL_MIN/MAX`) dans l'indice.
- SlotList basal : bouton « Proposer » (gated `capability.canPropose` + `basalRate` éditable). i18n `proposalParamBasal`. Tests +1 (corps basal).

**Reste 2648b** : édition directe DOCTOR (PUT), `refreshTreatmentMode(tx)`, redirect role-branché, transport drawer, E2E.

#### Corrections revue slice 2c (PR #649)
- **Incrément basal (MEDIUM)** : un débit basal proposé doit être multiple de `PUMP_BASAL_INCREMENT` (0,05 U/h) — validé au service (`validateProposedValue` → `valueOutOfBounds`) + `step="0.05"` au form. Catalogue §6 mis à jour. Test ajouté.
- **Message « baisse interdite »** enrichi (route vers soignant / déclaration hypo) — fr/en/ar.
- Différés (tracés) : test de rendu du gating basal (mock lourd, non bloquant) ; warning médecin sur gros écart mono-créneau basal (US-2649b) ; hint personnalisé `current ±10%` (nécessite le rôle client) ; débit live à l'accept + re-scoping patient de `pumpBasalSlot.update` (US-2649b).

### US-2648b (en cours) — slice 2d : routes UPDATE (édition directe DOCTOR, backend)
Foundation de l'édition directe (backend-first, comme US-2648a). Le service n'avait que
create/delete → ajout de l'UPDATE by id :
- `insulinTherapyService.updateIsf/updateIcr/updatePumpSlot(id, value, userId, patientId)` :
  `updateMany` **scopé patient** (via `settings.patientId` / `basalConfig.settings.patientId`,
  anti-IDOR → `*SlotNotFound` si autre patient) ; audit `UPDATE` (pivot patientId) ; ne modifie
  que la valeur (pas les heures).
- Routes **PATCH** `sensitivity-factors` / `carb-ratios` / `basal-config/pump-slots` :
  **DOCTOR only** (NURSE/patient → proposition) ; bornes Zod (`INSULIN_BOUNDS`) ; basal
  **multiple de `PUMP_BASAL_INCREMENT`** (refine, 400 sinon).
- Tests : +7 (RBAC PATCH DOCTOR/NURSE/VIEWER + off-increment 400).

**Reste 2648b** : UI DOCTOR « Modifier » (dialog direct-write + `router.refresh()`), redirect
`/insulin-therapy` role-branché, transport drawer, E2E.
