-- US-2663 (S3c/S3d) — Relâche le CHECK `slot_set_proposals.parameter_type` pour couvrir la basale et la dose
-- fixe : la proposition GROUPÉE devient INTÉGRALE (tous les leviers), non plus limitée à ISF/ICR.
--
-- Contexte : le CHECK posé en 20260717100000 restreignait `parameter_type` à ('insulinSensitivityFactor',
-- 'insulinToCarbRatio') car le modèle d'ensemble ne couvrait alors que ces deux leviers. S3c (basale
-- pompe/stylo, `basalRate`) et S3d (dose fixe, `fixedDose`) étendent l'émission/stockage groupés à ces
-- leviers → le CHECK doit désormais accepter les 4 valeurs de l'enum `AdjustableParameter`.
--
-- Défense en profondeur (on GARDE un CHECK explicite plutôt que de le supprimer) : verrouille EN BASE que
-- seules des valeurs connues du modèle d'ensemble sont stockées. Invisible au drift gate (Prisma ne modélise
-- pas les CHECK) → appliqué par `migrate deploy` mais non détecté comme drift. **Idempotent** (DROP IF EXISTS
-- + recréation). Aucun changement d'index : `slot_set_proposals_one_pending_per_param_origin`
-- (`(patient_id, parameter_type, (source='algorithm')) WHERE status='pending'`) est déjà générique sur
-- `parameter_type` → l'invariant « 1 pending humain + 1 pending algorithme par (patient × levier) » tient tel
-- quel pour `basalRate`/`fixedDose`. Additif/non destructif (élargit un domaine, ne rejette aucune ligne
-- existante ISF/ICR).
ALTER TABLE "slot_set_proposals" DROP CONSTRAINT IF EXISTS "chk_slot_set_proposal_param_type";
ALTER TABLE "slot_set_proposals" ADD CONSTRAINT "chk_slot_set_proposal_param_type"
  CHECK (parameter_type IN ('insulinSensitivityFactor', 'insulinToCarbRatio', 'basalRate', 'fixedDose'));
