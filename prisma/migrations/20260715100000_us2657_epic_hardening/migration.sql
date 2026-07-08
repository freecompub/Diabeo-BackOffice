-- US-2657 (durcissement review epic) — index anti-cliquet C7 couvrant slot_key + colonnes temporelles
-- timestamptz (cohérence cross-timezone ; `hoursSinceLastAutoApply`). Additif/non destructif.

-- DropIndex
DROP INDEX "auto_apply_events_patient_id_parameter_type_applied_at_idx";

-- AlterTable
ALTER TABLE "auto_apply_events" ALTER COLUMN "applied_at" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "governance_approvals" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ;

-- CreateIndex
CREATE INDEX "auto_apply_events_patient_id_parameter_type_slot_key_applie_idx" ON "auto_apply_events"("patient_id", "parameter_type", "slot_key", "applied_at");
