-- Review PR #390 refinements:
--  * H10: AdjustmentProposalAck.patient_id → patients(id) FK (cascade)
--  * L6:  index on patient_group_assignments.assigned_by
--  * L7:  index on adjustment_proposal_actualizations.verified_by

-- AddForeignKey (H10)
ALTER TABLE "adjustment_proposal_acks"
    ADD CONSTRAINT "adjustment_proposal_acks_patient_id_fkey"
        FOREIGN KEY ("patient_id") REFERENCES "patients"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex (L6)
CREATE INDEX "patient_group_assignments_assigned_by_idx"
    ON "patient_group_assignments"("assigned_by");

-- CreateIndex (L7)
CREATE INDEX "adjustment_proposal_actualizations_verified_by_idx"
    ON "adjustment_proposal_actualizations"("verified_by");
