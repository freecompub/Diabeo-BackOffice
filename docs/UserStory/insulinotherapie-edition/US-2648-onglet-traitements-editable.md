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
