-- Groupe 3 — Équipe & Communication (10 US workflow équipe)

-- CreateEnum
CREATE TYPE "delegation_request_status" AS ENUM ('pending', 'approved', 'rejected', 'expired');

-- ─────────────────────────────────────────────────────────────
-- US-2078 — Templates de messages cabinet
-- ─────────────────────────────────────────────────────────────
CREATE TABLE "message_templates" (
    "id" SERIAL NOT NULL,
    "service_id" INTEGER NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "body" TEXT NOT NULL,
    "variables" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "message_templates_service_id_title_key" ON "message_templates"("service_id", "title");
CREATE INDEX "message_templates_service_id_idx" ON "message_templates"("service_id");

-- ─────────────────────────────────────────────────────────────
-- US-2080 — Read receipts (Announcement, etc.)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE "read_receipts" (
    "id" SERIAL NOT NULL,
    "resource" VARCHAR(40) NOT NULL,
    "resource_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "read_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "read_receipts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "read_receipts_resource_resource_id_user_id_key" ON "read_receipts"("resource", "resource_id", "user_id");
CREATE INDEX "read_receipts_resource_resource_id_idx" ON "read_receipts"("resource", "resource_id");

-- ─────────────────────────────────────────────────────────────
-- US-2065 — Patient acknowledgment of an adjustment proposal
-- ─────────────────────────────────────────────────────────────
CREATE TABLE "adjustment_proposal_acks" (
    "id" SERIAL NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "accepted" BOOLEAN,
    "read_at" TIMESTAMPTZ,
    "responded_at" TIMESTAMPTZ,
    "comment" TEXT,

    CONSTRAINT "adjustment_proposal_acks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "adjustment_proposal_acks_proposal_id_key" ON "adjustment_proposal_acks"("proposal_id");
CREATE INDEX "adjustment_proposal_acks_patient_id_idx" ON "adjustment_proposal_acks"("patient_id");

-- ─────────────────────────────────────────────────────────────
-- US-2066 — Adjustment proposal actualization (real-world apply)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE "adjustment_proposal_actualizations" (
    "id" SERIAL NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "effective_at" TIMESTAMPTZ,
    "verified_via" VARCHAR(40) NOT NULL,
    "verified_by" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adjustment_proposal_actualizations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "adjustment_proposal_actualizations_proposal_id_key" ON "adjustment_proposal_actualizations"("proposal_id");

-- ─────────────────────────────────────────────────────────────
-- US-2068 — Consultation notes (encrypted content)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE "consultation_notes" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "author_id" INTEGER NOT NULL,
    "appointment_id" INTEGER,
    "content" TEXT NOT NULL,
    "category" VARCHAR(40),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "consultation_notes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "consultation_notes_patient_id_created_at_idx" ON "consultation_notes"("patient_id", "created_at");

-- ─────────────────────────────────────────────────────────────
-- US-2083 — Delegation requests (IDE → DOCTOR approval workflow)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE "delegation_requests" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "from_user_id" INTEGER NOT NULL,
    "to_user_id" INTEGER NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "payload" JSONB,
    "status" "delegation_request_status" NOT NULL DEFAULT 'pending',
    "reviewed_at" TIMESTAMPTZ,
    "reviewed_by" INTEGER,
    "reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delegation_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "delegation_requests_to_user_id_status_idx" ON "delegation_requests"("to_user_id", "status");
CREATE INDEX "delegation_requests_patient_id_idx" ON "delegation_requests"("patient_id");

-- ─────────────────────────────────────────────────────────────
-- US-2084 — Member absences + cover
-- ─────────────────────────────────────────────────────────────
CREATE TABLE "member_absences" (
    "id" SERIAL NOT NULL,
    "member_id" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "cover_member_id" INTEGER,
    "reason" VARCHAR(120),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_absences_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "member_absences_member_id_start_date_idx" ON "member_absences"("member_id", "start_date");
CREATE INDEX "member_absences_cover_member_id_idx" ON "member_absences"("cover_member_id");

-- ─────────────────────────────────────────────────────────────
-- US-2086 — Handoff notes (encrypted note + ack)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE "handoff_notes" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "from_user_id" INTEGER NOT NULL,
    "to_user_id" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "acknowledged_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "handoff_notes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "handoff_notes_to_user_id_acknowledged_at_idx" ON "handoff_notes"("to_user_id", "acknowledged_at");
CREATE INDEX "handoff_notes_patient_id_idx" ON "handoff_notes"("patient_id");

-- ─────────────────────────────────────────────────────────────
-- US-2088 — Patient groups (cohorts) + assignment
-- ─────────────────────────────────────────────────────────────
CREATE TABLE "patient_groups" (
    "id" SERIAL NOT NULL,
    "service_id" INTEGER NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_groups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "patient_groups_service_id_label_key" ON "patient_groups"("service_id", "label");
CREATE INDEX "patient_groups_service_id_idx" ON "patient_groups"("service_id");

CREATE TABLE "patient_group_assignments" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "group_id" INTEGER NOT NULL,
    "assigned_by" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_group_assignments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "patient_group_assignments_patient_id_group_id_key" ON "patient_group_assignments"("patient_id", "group_id");
CREATE INDEX "patient_group_assignments_group_id_idx" ON "patient_group_assignments"("group_id");
CREATE INDEX "patient_group_assignments_patient_id_created_at_idx" ON "patient_group_assignments"("patient_id", "created_at");

-- ─────────────────────────────────────────────────────────────
-- US-2072 — Teleconsultation acte (billing link)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE "teleconsultation_actes" (
    "id" SERIAL NOT NULL,
    "appointment_id" INTEGER NOT NULL,
    "billing_code" VARCHAR(20) NOT NULL,
    "amount_cents" INTEGER,
    "invoiced_at" TIMESTAMPTZ,
    "invoiced_by" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teleconsultation_actes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "teleconsultation_actes_appointment_id_key" ON "teleconsultation_actes"("appointment_id");
CREATE INDEX "teleconsultation_actes_invoiced_at_idx" ON "teleconsultation_actes"("invoiced_at");

-- ─────────────────────────────────────────────────────────────
-- Foreign keys
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_service_id_fkey"
    FOREIGN KEY ("service_id") REFERENCES "healthcare_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "read_receipts" ADD CONSTRAINT "read_receipts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "adjustment_proposal_acks" ADD CONSTRAINT "adjustment_proposal_acks_proposal_id_fkey"
    FOREIGN KEY ("proposal_id") REFERENCES "adjustment_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "adjustment_proposal_actualizations" ADD CONSTRAINT "adjustment_proposal_actualizations_proposal_id_fkey"
    FOREIGN KEY ("proposal_id") REFERENCES "adjustment_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "adjustment_proposal_actualizations" ADD CONSTRAINT "adjustment_proposal_actualizations_verified_by_fkey"
    FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "consultation_notes" ADD CONSTRAINT "consultation_notes_patient_id_fkey"
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "consultation_notes" ADD CONSTRAINT "consultation_notes_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consultation_notes" ADD CONSTRAINT "consultation_notes_appointment_id_fkey"
    FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "delegation_requests" ADD CONSTRAINT "delegation_requests_patient_id_fkey"
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "delegation_requests" ADD CONSTRAINT "delegation_requests_from_user_id_fkey"
    FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delegation_requests" ADD CONSTRAINT "delegation_requests_to_user_id_fkey"
    FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delegation_requests" ADD CONSTRAINT "delegation_requests_reviewed_by_fkey"
    FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "member_absences" ADD CONSTRAINT "member_absences_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "healthcare_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "member_absences" ADD CONSTRAINT "member_absences_cover_member_id_fkey"
    FOREIGN KEY ("cover_member_id") REFERENCES "healthcare_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "handoff_notes" ADD CONSTRAINT "handoff_notes_patient_id_fkey"
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "handoff_notes" ADD CONSTRAINT "handoff_notes_from_user_id_fkey"
    FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "handoff_notes" ADD CONSTRAINT "handoff_notes_to_user_id_fkey"
    FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "patient_groups" ADD CONSTRAINT "patient_groups_service_id_fkey"
    FOREIGN KEY ("service_id") REFERENCES "healthcare_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "patient_groups" ADD CONSTRAINT "patient_groups_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "patient_group_assignments" ADD CONSTRAINT "patient_group_assignments_patient_id_fkey"
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patient_group_assignments" ADD CONSTRAINT "patient_group_assignments_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "patient_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patient_group_assignments" ADD CONSTRAINT "patient_group_assignments_assigned_by_fkey"
    FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "teleconsultation_actes" ADD CONSTRAINT "teleconsultation_actes_appointment_id_fkey"
    FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "teleconsultation_actes" ADD CONSTRAINT "teleconsultation_actes_invoiced_by_fkey"
    FOREIGN KEY ("invoiced_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
