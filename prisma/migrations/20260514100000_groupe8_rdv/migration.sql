-- Groupe 8 Batch 1 — RDV core CRUD (5 US, 36 SP)
--  * US-2500 Calendrier — indexes pour list par range
--  * US-2501 Detail RDV — Appointment étendu + note chiffrée
--  * US-2503 Annulation/report bilatéral — state machine
--  * US-2504 Plages indisponibles — member_unavailabilities
--  * US-2505 Config prise RDV — HealthcareMember.bookingMode

-- ─────────────────────────────────────────────────────────────
-- New enums
-- ─────────────────────────────────────────────────────────────
CREATE TYPE "appointment_location" AS ENUM ('in_person', 'video', 'phone');
CREATE TYPE "appointment_status" AS ENUM (
    'scheduled', 'pending_validation', 'confirmed',
    'cancelled', 'completed', 'no_show'
);
CREATE TYPE "booking_mode" AS ENUM ('auto', 'validation');
CREATE TYPE "cancellation_actor" AS ENUM ('patient', 'doctor');

-- ─────────────────────────────────────────────────────────────
-- US-2501/2503 — Appointment columns
-- PHI free-text fields are stored encrypted (AES-256-GCM base64).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "appointments"
    ADD COLUMN "member_id" INTEGER,
    ADD COLUMN "duration_minutes" INTEGER,
    ADD COLUMN "location" "appointment_location",
    ADD COLUMN "status" "appointment_status" NOT NULL DEFAULT 'scheduled',
    ADD COLUMN "motif_encrypted" TEXT,
    ADD COLUMN "note_encrypted" TEXT,
    ADD COLUMN "proposed_alternative_at" TIMESTAMPTZ,
    ADD COLUMN "cancelled_by" "cancellation_actor",
    ADD COLUMN "cancel_reason_encrypted" TEXT,
    ADD COLUMN "cancelled_at" TIMESTAMPTZ;

ALTER TABLE "appointments"
    ADD CONSTRAINT "appointments_member_id_fkey"
        FOREIGN KEY ("member_id") REFERENCES "healthcare_members"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

-- M8 — Enforce clinical bounds at DB level (15-240 min). NULL allowed for
-- legacy rows pre-Groupe-8.
ALTER TABLE "appointments"
    ADD CONSTRAINT "appointments_duration_minutes_check"
        CHECK ("duration_minutes" IS NULL OR ("duration_minutes" BETWEEN 15 AND 240));

CREATE INDEX "appointments_member_id_date_idx" ON "appointments"("member_id", "date");
CREATE INDEX "appointments_patient_id_date_idx" ON "appointments"("patient_id", "date");
CREATE INDEX "appointments_member_id_status_date_idx"
    ON "appointments"("member_id", "status", "date");

-- ─────────────────────────────────────────────────────────────
-- US-2505 — HealthcareMember booking config
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "healthcare_members"
    ADD COLUMN "booking_mode" "booking_mode" NOT NULL DEFAULT 'auto',
    ADD COLUMN "default_appointment_minutes" INTEGER;

ALTER TABLE "healthcare_members"
    ADD CONSTRAINT "healthcare_members_default_appointment_minutes_check"
        CHECK ("default_appointment_minutes" IS NULL
            OR ("default_appointment_minutes" BETWEEN 15 AND 240));

-- ─────────────────────────────────────────────────────────────
-- US-2504 — Member unavailabilities (time-slot blockers)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE "member_unavailabilities" (
    "id" SERIAL NOT NULL,
    "member_id" INTEGER NOT NULL,
    "start_at" TIMESTAMPTZ NOT NULL,
    "end_at" TIMESTAMPTZ NOT NULL,
    "reason_encrypted" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_unavailabilities_pkey" PRIMARY KEY ("id"),
    -- L8 — Coherence check on temporal interval.
    CONSTRAINT "member_unavailabilities_range_check" CHECK ("end_at" > "start_at")
);
CREATE INDEX "member_unavailabilities_member_id_start_at_idx"
    ON "member_unavailabilities"("member_id", "start_at");
-- M15 — Cover end_at lookups (overlap queries filter on both bounds).
CREATE INDEX "member_unavailabilities_member_id_end_at_idx"
    ON "member_unavailabilities"("member_id", "end_at");

-- H3/M12 — Postgres EXCLUDE constraint prevents overlapping unavailabilities
-- for the same member without relying on Serializable transactions catching
-- write-write conflicts (which they may not when no rw-conflict exists).
-- `btree_gist` extension is required for INT GiST ops.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "member_unavailabilities"
    ADD CONSTRAINT "member_unavailabilities_no_overlap"
        EXCLUDE USING GIST (
            "member_id" WITH =,
            tstzrange("start_at", "end_at", '[)') WITH &&
        );

ALTER TABLE "member_unavailabilities"
    ADD CONSTRAINT "member_unavailabilities_member_id_fkey"
        FOREIGN KEY ("member_id") REFERENCES "healthcare_members"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "member_unavailabilities"
    ADD CONSTRAINT "member_unavailabilities_created_by_fkey"
        FOREIGN KEY ("created_by") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
