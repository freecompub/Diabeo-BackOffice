-- US-2657 (dette) — Clés étrangères User sur les tables de l'epic auto-application + CHECK parameter_type.
--
-- FK : attribution PS des propositions d'ensemble et des approbations de gouvernance.
--  - `slot_set_proposals` (table MUTABLE — statut pending→accepted/rejected) : ON DELETE SET NULL (RGPD Art.17,
--    aligné sur AdjustmentProposal proposer/reviewer) → `proposed_by_user_id` élargi en NULLABLE.
--  - `governance_approvals` (table APPEND-ONLY — trigger `governance_approvals_no_update` interdit tout UPDATE,
--    or SET NULL est un UPDATE) : ON DELETE RESTRICT + `approved_by_id` reste NOT NULL. L'attribution de
--    l'approbateur est de toute façon figée dans l'audit immuable.
-- Additif/non destructif. FK validées inline (tables neuves, volumétrie minime).

-- AlterTable
ALTER TABLE "slot_set_proposals" ALTER COLUMN "proposed_by_user_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "governance_approvals" ADD CONSTRAINT "governance_approvals_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_set_proposals" ADD CONSTRAINT "slot_set_proposals_proposed_by_user_id_fkey" FOREIGN KEY ("proposed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_set_proposals" ADD CONSTRAINT "slot_set_proposals_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CHECK — `slot_set_proposals.parameter_type` restreint à ISF/ICR (le modèle d'ensemble ne couvre pas basalRate/
-- fixedDose). Verrouille EN BASE l'invariant applicatif (défense en profondeur). Invisible au drift gate (Prisma
-- ne modélise pas les CHECK) → appliqué par `migrate deploy` mais non détecté comme drift. Idempotent.
ALTER TABLE "slot_set_proposals" DROP CONSTRAINT IF EXISTS "chk_slot_set_proposal_param_type";
ALTER TABLE "slot_set_proposals" ADD CONSTRAINT "chk_slot_set_proposal_param_type"
  CHECK (parameter_type IN ('insulinSensitivityFactor', 'insulinToCarbRatio'));
