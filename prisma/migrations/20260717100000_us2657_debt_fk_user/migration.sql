-- US-2657 (dette) — Clés étrangères User sur les tables de l'epic auto-application, avec ON DELETE SET NULL
-- (RGPD Art. 17 : la purge d'un compte PS ne casse pas le dossier de gouvernance/proposition ; l'attribution
-- passe à NULL, l'enregistrement immuable est conservé). Aligné sur AdjustmentProposal (proposer/reviewer).
-- Additif et non destructif : élargit deux colonnes en NULLABLE puis ajoute les contraintes FK.

-- AlterTable
ALTER TABLE "governance_approvals" ALTER COLUMN "approved_by_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "slot_set_proposals" ALTER COLUMN "proposed_by_user_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "governance_approvals" ADD CONSTRAINT "governance_approvals_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_set_proposals" ADD CONSTRAINT "slot_set_proposals_proposed_by_user_id_fkey" FOREIGN KEY ("proposed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_set_proposals" ADD CONSTRAINT "slot_set_proposals_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
