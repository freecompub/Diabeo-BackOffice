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
