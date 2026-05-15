-- Groupe 1 — Devices supervision + sync status (US-2243 / 2244)
--
-- Étend `patient_devices` avec 3 colonnes : battery_level (%),
-- sensor_expires_at (capteur CGM), last_sync_at (fraîcheur par
-- appareil physique). Indexes pour requêtes cohorte filtre status.

ALTER TABLE "patient_devices"
    ADD COLUMN "battery_level"      SMALLINT,
    ADD COLUMN "sensor_expires_at"  TIMESTAMPTZ,
    ADD COLUMN "last_sync_at"       TIMESTAMPTZ;

-- CHECK constraints (anti-coquille, NOT VALID + VALIDATE pour
-- zero-downtime cohérent avec PR #407 NEW-L4).
ALTER TABLE "patient_devices"
    ADD CONSTRAINT "patient_devices_battery_level_chk"
    CHECK ("battery_level" IS NULL OR ("battery_level" BETWEEN 0 AND 100)) NOT VALID;

ALTER TABLE "patient_devices"
    VALIDATE CONSTRAINT "patient_devices_battery_level_chk";

-- Indexes pour requêtes cohort US-2243/2244.
CREATE INDEX "patient_devices_patient_id_last_sync_at_idx"
    ON "patient_devices"("patient_id", "last_sync_at");

CREATE INDEX "patient_devices_sensor_expires_at_idx"
    ON "patient_devices"("sensor_expires_at");
