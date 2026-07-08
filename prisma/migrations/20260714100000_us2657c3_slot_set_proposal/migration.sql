-- US-2657 (slice C3) — Proposition d'ENSEMBLE de créneaux (fallback groupe patient EXPERT).
-- Additif, non destructif.

-- CreateTable
CREATE TABLE "slot_set_proposals" (
    "id" TEXT NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "parameter_type" "AdjustableParameter" NOT NULL,
    "proposed_slots" JSONB NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'pending',
    "proposed_by_user_id" INTEGER NOT NULL,
    "reviewed_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "slot_set_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "slot_set_proposals_patient_id_status_idx" ON "slot_set_proposals"("patient_id", "status");

-- AddForeignKey
ALTER TABLE "slot_set_proposals" ADD CONSTRAINT "slot_set_proposals_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
