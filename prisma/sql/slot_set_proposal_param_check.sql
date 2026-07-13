-- ═══════════════════════════════════════════════════════════════
-- SlotSetProposal — parameter_type restreint aux leviers groupés (US-2657 → US-2663 S3c/S3d)
-- ═══════════════════════════════════════════════════════════════
-- ⚠️ COPIE DE RÉFÉRENCE. La SOURCE DE VÉRITÉ (appliquée par `prisma migrate deploy`) est la migration
--    versionnée `20260727100000_us2663_s3cd_param_type` (qui a relâché la contrainte initiale de
--    `20260717100000_us2657_debt_fk_and_param_check`). Ce fichier sert uniquement à ré-appliquer la
--    contrainte manuellement sur une base legacy/pré-existante (idempotent). NE PAS s'y fier pour le déploiement.
-- ═══════════════════════════════════════════════════════════════
-- Le modèle SlotSetProposal (proposition d'ENSEMBLE de créneaux) couvre désormais ISF/ICR (US-2657), la basale
-- POMPE (`basalRate`, US-2663 S3c) et la dose fixe (`fixedDose`, US-2663 S3d). La colonne `parameter_type`
-- utilise l'enum `AdjustableParameter` ; cette contrainte verrouille EN BASE que seules des valeurs connues du
-- modèle d'ensemble sont stockées (défense en profondeur, symétrie avec la garde applicative `SlotSetParam` /
-- `unsupportedSlotSetParam`). La basale STYLO (aussi `basalRate`) est distinguée par la FORME du JSON, pas par
-- `parameter_type` — donc pas de valeur d'enum dédiée à exclure ici.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE "slot_set_proposals" DROP CONSTRAINT IF EXISTS "chk_slot_set_proposal_param_type";
ALTER TABLE "slot_set_proposals" ADD CONSTRAINT "chk_slot_set_proposal_param_type"
CHECK (parameter_type IN ('insulinSensitivityFactor', 'insulinToCarbRatio', 'basalRate', 'fixedDose'));
