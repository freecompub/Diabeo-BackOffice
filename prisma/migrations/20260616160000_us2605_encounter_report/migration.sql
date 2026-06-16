-- US-2605 — Mode revue de consultation : séances (Encounter) + comptes rendus
-- immuables (ConsultationReportAddendum).
--
-- Modèles écrits par le BACKOFFICE (médecin) ; additif, non destructif.
-- Le compte rendu est append-only (immuabilité forcée par trigger ci-dessous) :
-- aucun UPDATE sauf la transition soft-delete RGPD (`deleted_at`), aucun DELETE.

-- CreateEnum
CREATE TYPE "EncounterStatus" AS ENUM ('draft', 'completed', 'abandoned');

-- CreateTable
CREATE TABLE "encounters" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "appointment_id" INTEGER,
    "opened_by_id" INTEGER NOT NULL,
    "status" "EncounterStatus" NOT NULL DEFAULT 'draft',
    "opened_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ,
    "draft_report_enc" TEXT,
    "period" VARCHAR(10),
    "data_as_of" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "encounters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation_report_addenda" (
    "id" SERIAL NOT NULL,
    "encounter_id" INTEGER NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "author_id" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "period" VARCHAR(10) NOT NULL,
    "data_as_of" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "consultation_report_addenda_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "encounters_patient_id_opened_by_id_status_idx" ON "encounters"("patient_id", "opened_by_id", "status");

-- CreateIndex
CREATE INDEX "encounters_patient_id_created_at_idx" ON "encounters"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "consultation_report_addenda_patient_id_created_at_idx" ON "consultation_report_addenda"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "consultation_report_addenda_encounter_id_idx" ON "consultation_report_addenda"("encounter_id");

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_opened_by_id_fkey" FOREIGN KEY ("opened_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_report_addenda" ADD CONSTRAINT "consultation_report_addenda_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_report_addenda" ADD CONSTRAINT "consultation_report_addenda_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_report_addenda" ADD CONSTRAINT "consultation_report_addenda_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════
-- US-2605 — Immuabilité du compte rendu (HDS, défense en profondeur)
-- ═══════════════════════════════════════════════════════════════
-- Append-only : aucun DELETE, aucun UPDATE SAUF la transition soft-delete RGPD
-- (seul `deleted_at` peut changer). Toute autre mutation lève une exception.
-- Cf. `prisma/sql/consultation_report_immutability.sql` (copie de référence).
CREATE OR REPLACE FUNCTION prevent_consultation_report_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'consultation_report_addenda is append-only: DELETE forbidden (HDS compliance)';
  END IF;
  -- UPDATE : autoriser UNIQUEMENT la transition soft-delete (deleted_at).
  IF NEW."content" IS DISTINCT FROM OLD."content"
     OR NEW."period" IS DISTINCT FROM OLD."period"
     OR NEW."data_as_of" IS DISTINCT FROM OLD."data_as_of"
     OR NEW."encounter_id" IS DISTINCT FROM OLD."encounter_id"
     OR NEW."patient_id" IS DISTINCT FROM OLD."patient_id"
     OR NEW."author_id" IS DISTINCT FROM OLD."author_id"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'consultation_report_addenda is immutable except soft-delete (HDS compliance)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER consultation_report_addenda_immutable
  BEFORE UPDATE OR DELETE ON "consultation_report_addenda"
  FOR EACH ROW EXECUTE FUNCTION prevent_consultation_report_mutation();
