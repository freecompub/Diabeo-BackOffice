-- US-2657 (slice C) — Socle gouvernance & persistance de l'auto-application experte.
-- Additif, non destructif. `auto_apply` OFF par défaut (backfill false) ; subordonné au
-- kill-switch global `AUTO_APPLY_GLOBALLY_ENABLED` et à une GovernanceApproval valide.

-- AlterTable
ALTER TABLE "patients" ADD COLUMN "auto_apply" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "governance_approvals" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "approved_by_id" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "dpia_ref" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "governance_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_apply_events" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "parameter_type" "AdjustableParameter" NOT NULL,
    "slot_key" TEXT NOT NULL,
    "delta_percent" DOUBLE PRECISION NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auto_apply_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "governance_approvals_patient_id_idx" ON "governance_approvals"("patient_id");

-- CreateIndex
CREATE INDEX "auto_apply_events_patient_id_parameter_type_applied_at_idx" ON "auto_apply_events"("patient_id", "parameter_type", "applied_at");

-- AddForeignKey
ALTER TABLE "governance_approvals" ADD CONSTRAINT "governance_approvals_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_apply_events" ADD CONSTRAINT "auto_apply_events_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
