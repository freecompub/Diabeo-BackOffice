# DPIA — Auto-application experte gouvernée — **DÉCOMMISSIONNÉE**

> ⚠️ **Statut : DÉCOMMISSIONNÉE (2026-07-10).** La fonctionnalité d'**auto-application experte
> gouvernée** (US-2657) a été **entièrement retirée** du produit avant toute activation en
> production. Voir **ADR #28** (`CLAUDE.md`) et la PR de retrait `feat/us2657-remove-auto-apply`.

## Pourquoi cette fiche est conservée

Conformément à l'exigence d'auditabilité HDS/RGPD (Art. 35), la trace d'une DPIA **effectivement
produite** est conservée même lorsque la fonctionnalité évaluée est retirée : un auditeur doit pouvoir
constater qu'une analyse d'impact « décision automatisée » (RGPD Art. 22 / frontière dispositif médical)
a bien été menée, puis que le traitement a été **abandonné**.

## Ce qui a été retiré

- Enveloppe de sécurité C1–C8 (+C6b), harnais gouverné, assemblage de contexte (glycémie/cétones/anti-cliquet).
- Service et route d'activation de gouvernance, kill-switch global `AUTO_APPLY_GLOBALLY_ENABLED`.
- Tables `GovernanceApproval` / `AutoApplyEvent`, colonne `Patient.autoApply` (migration
  `20260718100000_us2657_remove_auto_apply`, destructive).
- Constantes `AUTO_APPLY_*`, actions d'audit dédiées.

## Décision de décommissionnement (traçabilité)

- **Décision** : une proposition de dose doit **toujours** être validée par un médecin ; une voie
  d'application sans intervention humaine n'apportait pas de valeur clinique proportionnée au risque MDR.
- **Absence d'effet résiduel** : la fonctionnalité **n'a jamais été activée en production** (kill-switch
  fail-safe OFF par défaut, harnais livré inerte) → les tables de gouvernance/registre étaient
  **vides/inertes** ; aucune donnée patient exploitable n'a été traitée par cette voie, donc aucune donnée
  de « décision automatisée » n'est perdue par la suppression des tables.
- **Trace pérenne** : toute activation/downgrade éventuelle restait mirroir dans `audit_logs` (immuable,
  **non supprimée**) — la piste d'audit forensique survit indépendamment des tables retirées.

## Contenu original

Le contenu détaillé de la DPIA d'origine (analyse de risque, enveloppe, triple verrou, minimisation)
reste consultable dans l'historique Git (`git log --follow -- docs/compliance/dpia-auto-application.md`,
état antérieur au commit de retrait 2026-07-10).
