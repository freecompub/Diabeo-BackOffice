-- ═══════════════════════════════════════════════════════════════
-- SlotSetProposal — parameter_type restreint à ISF/ICR (US-2657)
-- ═══════════════════════════════════════════════════════════════
-- ⚠️ COPIE DE RÉFÉRENCE. La SOURCE DE VÉRITÉ (appliquée par `prisma migrate deploy`) est la migration
--    versionnée `20260717100000_us2657_debt_fk_and_param_check`. Ce fichier sert uniquement à ré-appliquer
--    la contrainte manuellement sur une base legacy/pré-existante (idempotent). NE PAS s'y fier pour le déploiement.
-- ═══════════════════════════════════════════════════════════════
-- Le modèle SlotSetProposal (proposition d'ENSEMBLE de créneaux) ne couvre QUE les paramètres à jeu de
-- créneaux horaires ISF/ICR. La colonne `parameter_type` utilise l'enum `AdjustableParameter` qui inclut
-- aussi `basalRate`/`fixedDose` — cette contrainte verrouille EN BASE l'invariant applicatif :
--  - création gardée par le type `SlotSetParam` (isf/icr) — `slot-set-proposal.service.ts` ;
--  - application (`applyGroupProposal`) lève `unsupportedSlotSetParam` sur tout autre paramètre.
-- La fenêtre de « dérive de base » basale est ainsi close des DEUX côtés (appli + base). Défense en profondeur.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE "slot_set_proposals" ADD CONSTRAINT "chk_slot_set_proposal_param_type"
CHECK (parameter_type IN ('insulinSensitivityFactor', 'insulinToCarbRatio'));
