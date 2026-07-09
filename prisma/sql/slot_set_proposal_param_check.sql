-- ═══════════════════════════════════════════════════════════════
-- SlotSetProposal — parameter_type restreint à ISF/ICR (US-2657)
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
