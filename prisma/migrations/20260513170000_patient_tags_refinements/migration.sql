-- US-2022 — Refinements PR #389 review:
--  * M7: HealthcareService → PatientTag : Restrict (was Cascade)
--  * M8: Drop redundant index on patient_tags(service_id) (covered by unique)
--  * M9: Add composite index (patient_id, created_at) on assignments
--  * M10: Add FK relations for created_by / assigned_by → users(id) with SetNull

-- DropIndex (redundant — covered by patient_tags_service_id_label_key)
DROP INDEX IF EXISTS "patient_tags_service_id_idx";

-- DropIndex (replaced by composite below)
DROP INDEX IF EXISTS "patient_tag_assignments_patient_id_idx";

-- CreateIndex
CREATE INDEX "patient_tag_assignments_patient_id_created_at_idx"
    ON "patient_tag_assignments"("patient_id", "created_at");

-- Switch service→tags FK to Restrict (was Cascade). Drop then re-add.
ALTER TABLE "patient_tags"
    DROP CONSTRAINT "patient_tags_service_id_fkey";
ALTER TABLE "patient_tags"
    ADD CONSTRAINT "patient_tags_service_id_fkey"
        FOREIGN KEY ("service_id") REFERENCES "healthcare_services"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey created_by → users(id) (was unconstrained Int)
ALTER TABLE "patient_tags"
    ADD CONSTRAINT "patient_tags_created_by_fkey"
        FOREIGN KEY ("created_by") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey assigned_by → users(id) (was unconstrained Int)
ALTER TABLE "patient_tag_assignments"
    ADD CONSTRAINT "patient_tag_assignments_assigned_by_fkey"
        FOREIGN KEY ("assigned_by") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
