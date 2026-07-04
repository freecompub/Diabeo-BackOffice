# US-2652 — Garde-fous cliniques & cas limites + i18n/acronymes + design-system + tests + docs

> 📌 Épic US-2645 · transverse · Taille **M** · dépend de : US-2646 → US-2651 · **gate finale medical + HDS + a11y**

## Contexte
Story de durcissement transverse fermant l'épic : verrouiller les bornes, border les cas limites,
et garantir conformité (clinique, HDS, a11y, i18n, design-system).

## Périmètre
- **`CLINICAL_BOUNDS`** (`src/lib/clinical-bounds.ts`) : ajouter bornes **dose fixe** (min/max absolus U,
  cap variation U/%), **cap patient** (< moteur), **cooldown/fréquence** ; **source de vérité unique**,
  gardée synchrone par `tests/unit/clinical-bounds.test.ts`. Garde-fou : tout nouveau `AdjustableParameter`
  sans borne = test rouge.
- **Cas limites bordés** : grossesse/DG (`pregnancyMode`), pédiatrie (cap **absolu en U** + co-signature
  `PediatricCaregiver`), DT1 jamais mode (c), insuffisance rénale/âgé (validation médecin renforcée, pas de
  hausse auto), config incohérente (bloquer si `hasGap`/`hasOverlap`/`bolusInconsistent`).
- **Sens interdit patient** (baisse basal/dose) appliqué serveur, pas seulement UI.
- **i18n** (fr/en/ar) : libellés proposition/validation/modes ; **acronymes** ISF/ICR/IOB explicités
  (glossaire + `Acronym`).
- **Design-system** : composants conformes (tokens), **mettre en conformité `InsulinSummary`** avant réemploi
  (aujourd'hui `text-gray-*`, `var(--color-teal-500)` — cf. inventaire orphelins).
- **Audit HDS** : `auditService.log` sur create/accept/reject + provenance ; aucun PHI en clair (logs/notif).
- **Tests** : unitaires par mode + bornes + sens interdit + scope patient own-id ; E2E des 3 flux
  (DOCTOR direct, NURSE→proposition, patient→proposition→validation).
- **Docs** : ADR (extension `AdjustmentProposal` provenance + multi-mode) ; MAJ `docs/clinical-logic/`,
  `CLAUDE.md` (logique métier), `docs/ROADMAP.md`.

## Critères d'acceptation
- **AC-1** Toute borne/cap/cooldown est dans `CLINICAL_BOUNDS` + testée ; aucun paramètre sans borne.
- **AC-2** Chaque cas limite (grossesse, pédiatrie, DT1/DT2, rénal, config incohérente) a un test dédié.
- **AC-3** Sens interdit patient bloqué **serveur** (pas contournable via API).
- **AC-4** i18n complet + acronymes explicités ; design-system respecté (`InsulinSummary` conforme).
- **AC-5** Gate finale : `medical-domain-validator` + `healthcare-security-auditor` + `accessibility-tester` PASS.

## Notes
- Réviser l'inventaire orphelins : `InsulinSummary` et `/insulin-therapy` (redirigée) sortent du statut orphelin.

## Révision post-revue — RECENTRÉE hardening (voir épic §12)
Les bornes `fixedDose` **naissent en US-2646** (atomique). Cette US = **vérification/durcissement** :
- Cas limites (grossesse/DG, pédiatrie cap **absolu U** + co-signature, DT1 jamais mode c, rénal/âgé, config incohérente) + **sens interdit patient appliqué serveur**.
- **Chiffrement** effectif de `proposerComment`/notes (test AES-256-GCM, jamais en clair log/notif/URL).
- **DPIA** : documenter les doses numériques en clair (calculabilité → at-rest pgcrypto + RBAC).
- **ADR** : #21 → « 1 composant présentational, **N transports** » (ajout own-id patient) ; nouvel ADR provenance `AdjustmentProposal` (union taguée + `ProposalSource`).

## Reports de la revue code+migration (PR #638 / US-2646) — à fermer ici
- **DPIA** : documenter que `fixed_dose_slots.value_u` **et** `clinical_review_flags.type` (health-adjacent : un flag `tirBelowTarget`/`hba1cStale` implique une préoccupation clinique) reposent sur le chiffrement **at-rest (pgcrypto) + RBAC**, pas sur l'AES-GCM applicatif (contrainte de calculabilité). Étendre la note DPIA au-delà des seules doses. *(HDS LOW)*
- **Vérifier** que les caps delta dose fixe + les seuils d'avertissement par type (routés basal/bolus) sont bien enforced (implémentés en US-2649) et couverts par des tests de cas limites. *(medical)*
