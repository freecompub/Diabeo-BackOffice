-- Review PR #391 fixes:
--  * C4 : add unique (patient_id, timestamp, event_type) on pump_events
--  * H5 : add FK meal_photos.patient_id → patients(id) Cascade
--  * M9 : drop redundant insulin_adjustment_templates_service_id_idx
--  * M10: partial index on diabetes_events for pending validation queries

-- C4 — Pump events idempotency (cross-batch dedup)
CREATE UNIQUE INDEX "pump_events_patient_id_timestamp_event_type_key"
    ON "pump_events"("patient_id", "timestamp", "event_type");

-- H5 — meal_photos.patient_id FK (was denormalised without constraint)
ALTER TABLE "meal_photos"
    ADD CONSTRAINT "meal_photos_patient_id_fkey"
        FOREIGN KEY ("patient_id") REFERENCES "patients"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

-- M9 — Drop redundant single-column index (covered by unique (service_id, title))
DROP INDEX IF EXISTS "insulin_adjustment_templates_service_id_idx";

-- M10 — Partial index for "pending validation" hot-path query
-- (WHERE patient_id = ? AND validated_at IS NULL ORDER BY event_date DESC)
CREATE INDEX "diabetes_events_pending_validation_idx"
    ON "diabetes_events"("patient_id", "event_date" DESC)
    WHERE "validated_at" IS NULL;
