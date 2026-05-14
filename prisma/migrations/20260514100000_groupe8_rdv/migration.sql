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

-- ─────────────────────────────────────────────────────────────
-- US-2501/2503 — Appointment columns
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "appointments"
    ADD COLUMN "member_id" INTEGER,
    ADD COLUMN "duration_minutes" INTEGER,
    ADD COLUMN "location" "appointment_location",
    ADD COLUMN "status" "appointment_status" NOT NULL DEFAULT 'scheduled',
    ADD COLUMN "motif" VARCHAR(200),
    ADD COLUMN "note_encrypted" TEXT,
    ADD COLUMN "proposed_alternative_at" TIMESTAMPTZ,
    ADD COLUMN "cancelled_by" VARCHAR(20),
    ADD COLUMN "cancel_reason" VARCHAR(500),
    ADD COLUMN "cancelled_at" TIMESTAMPTZ;

ALTER TABLE "appointments"
    ADD CONSTRAINT "appointments_member_id_fkey"
        FOREIGN KEY ("member_id") REFERENCES "healthcare_members"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

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

-- ─────────────────────────────────────────────────────────────
-- US-2504 — Member unavailabilities (time-slot blockers)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE "member_unavailabilities" (
    "id" SERIAL NOT NULL,
    "member_id" INTEGER NOT NULL,
    "start_at" TIMESTAMPTZ NOT NULL,
    "end_at" TIMESTAMPTZ NOT NULL,
    "reason" VARCHAR(200),
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_unavailabilities_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "member_unavailabilities_member_id_start_at_idx"
    ON "member_unavailabilities"("member_id", "start_at");

ALTER TABLE "member_unavailabilities"
    ADD CONSTRAINT "member_unavailabilities_member_id_fkey"
        FOREIGN KEY ("member_id") REFERENCES "healthcare_members"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "member_unavailabilities"
    ADD CONSTRAINT "member_unavailabilities_created_by_fkey"
        FOREIGN KEY ("created_by") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
