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

-- L2 — Defense-in-depth caps on encrypted PHI columns. Plaintext caps are
-- 200 (motif), 4096 (note), 500 (reason). Encrypted base64 overhead is ~33% +
-- 28 bytes (12 IV + 16 TAG) + base64 padding. Allow ~2x headroom.
ALTER TABLE "appointments"
    ADD CONSTRAINT "appointments_motif_enc_length_check"
        CHECK (octet_length("motif_encrypted") IS NULL OR octet_length("motif_encrypted") <= 600),
    ADD CONSTRAINT "appointments_note_enc_length_check"
        CHECK (octet_length("note_encrypted") IS NULL OR octet_length("note_encrypted") <= 9000),
    ADD CONSTRAINT "appointments_cancel_reason_enc_length_check"
        CHECK (octet_length("cancel_reason_encrypted") IS NULL OR octet_length("cancel_reason_encrypted") <= 1200);

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
    CONSTRAINT "member_unavailabilities_range_check" CHECK ("end_at" > "start_at"),
    -- L2 — Defense-in-depth cap on encrypted reason (plaintext 200 chars).
    CONSTRAINT "member_unavailabilities_reason_enc_length_check"
        CHECK (octet_length("reason_encrypted") IS NULL OR octet_length("reason_encrypted") <= 600)
);
CREATE INDEX "member_unavailabilities_member_id_start_at_idx"
    ON "member_unavailabilities"("member_id", "start_at");
-- M15 — Cover end_at lookups (overlap queries filter on both bounds).
CREATE INDEX "member_unavailabilities_member_id_end_at_idx"
    ON "member_unavailabilities"("member_id", "end_at");

-- H3/M12 — Postgres EXCLUDE constraint prevents overlapping unavailabilities
-- for the same member without relying on Serializable transactions catching
-- write-write conflicts (which they may not when no rw-conflict exists).
--
-- `btree_gist` extension is required for INT GiST ops.
-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ DEPLOYMENT PREREQUISITE (H4) — `btree_gist` must be available on the    │
-- │ target Postgres instance. OVH-managed DBaaS pre-installs it by default  │
-- │ (verify via `SELECT * FROM pg_available_extensions WHERE name           │
-- │ = 'btree_gist'`). If the role lacks `CREATE EXTENSION` privilege, run   │
-- │ the statement below as a superuser BEFORE `prisma migrate deploy`.      │
-- │ Documented in `docs/runbook/migrations.md` (US-2267).                   │
-- └─────────────────────────────────────────────────────────────────────────┘
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
