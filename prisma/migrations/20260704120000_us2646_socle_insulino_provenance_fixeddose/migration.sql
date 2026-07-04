-- ═══════════════════════════════════════════════════════════════
-- US-2646 — Socle données édition insulinothérapie (épic US-2645)
-- ═══════════════════════════════════════════════════════════════
-- - Provenance AdjustmentProposal : enum ProposalSource + proposed_by_user_id
--   (nullable, FK SetNull) + proposer_comment (chiffré AES-256-GCM applicatif).
--   confidence / supporting_events rendus nullable (union taguée : une proposition
--   humaine n'a pas de métriques moteur). Backfill implicite des lignes existantes
--   via DEFAULT 'algorithm'.
-- - AdjustableParameter += fixedDose ; AdjustmentReason += patientRequested/manualAdjustment.
-- - Tables : fixed_dose_slots (dose fixe structurée, mode b), clinical_review_flags
--   (orientation mode non-insuliné — JAMAIS de posologie, D7).
-- - patients.treatment_mode (cache d'affichage ; source de vérité = dérivée US-2647).
--
-- ⚠️ CHECK de provenance : n'impose QUE l'invariant `algorithm` (userId NULL +
-- métriques présentes). Le « userId NOT NULL pour une proposition humaine » est
-- imposé côté SERVICE (à la création), PAS en base, car la suppression RGPD
-- (FK SetNull) peut annuler l'auteur — le rôle reste porté par `source`.
-- CreateEnum
CREATE TYPE "ProposalSource" AS ENUM ('algorithm', 'patient', 'nurse', 'doctor');

-- CreateEnum
CREATE TYPE "TreatmentMode" AS ENUM ('basalBolus', 'fixedDose', 'nonInsulin');

-- CreateEnum
CREATE TYPE "DoseMoment" AS ENUM ('morning', 'noon', 'evening', 'night');

-- CreateEnum
CREATE TYPE "ClinicalReviewFlagType" AS ENUM ('reviewInConsultation', 'hba1cStale', 'tirBelowTarget', 'observance');

-- CreateEnum
CREATE TYPE "ClinicalReviewFlagStatus" AS ENUM ('open', 'resolved');

-- AlterEnum
ALTER TYPE "AdjustableParameter" ADD VALUE 'fixedDose';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdjustmentReason" ADD VALUE 'patientRequested';
ALTER TYPE "AdjustmentReason" ADD VALUE 'manualAdjustment';

-- AlterTable
ALTER TABLE "adjustment_proposals" ADD COLUMN     "proposed_by_user_id" INTEGER,
ADD COLUMN     "proposer_comment" TEXT,
ADD COLUMN     "source" "ProposalSource" NOT NULL DEFAULT 'algorithm',
ALTER COLUMN "confidence" DROP NOT NULL,
ALTER COLUMN "supporting_events" DROP NOT NULL;

-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "treatment_mode" "TreatmentMode";

-- CreateTable
CREATE TABLE "fixed_dose_slots" (
    "id" TEXT NOT NULL,
    "patient_insulin_id" INTEGER NOT NULL,
    "moment" "DoseMoment" NOT NULL,
    "value_u" DECIMAL(5,2) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "fixed_dose_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical_review_flags" (
    "id" TEXT NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "type" "ClinicalReviewFlagType" NOT NULL,
    "status" "ClinicalReviewFlagStatus" NOT NULL DEFAULT 'open',
    "created_by" INTEGER,
    "resolved_by" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "clinical_review_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fixed_dose_slots_patient_insulin_id_idx" ON "fixed_dose_slots"("patient_insulin_id");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_dose_slots_patient_insulin_id_moment_key" ON "fixed_dose_slots"("patient_insulin_id", "moment");

-- CreateIndex
CREATE INDEX "clinical_review_flags_patient_id_status_idx" ON "clinical_review_flags"("patient_id", "status");

-- AddForeignKey
ALTER TABLE "adjustment_proposals" ADD CONSTRAINT "adjustment_proposals_proposed_by_user_id_fkey" FOREIGN KEY ("proposed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_dose_slots" ADD CONSTRAINT "fixed_dose_slots_patient_insulin_id_fkey" FOREIGN KEY ("patient_insulin_id") REFERENCES "patient_insulins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_review_flags" ADD CONSTRAINT "clinical_review_flags_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_review_flags" ADD CONSTRAINT "clinical_review_flags_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_review_flags" ADD CONSTRAINT "clinical_review_flags_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- US-2646 — invariant de provenance (union taguée). Prisma ne modélise pas les
-- CHECK ; ajouté ici en DDL (appliqué par migrate deploy, présent en CI/E2E).
ALTER TABLE "adjustment_proposals"
  ADD CONSTRAINT "adjustment_proposals_algorithm_provenance_check"
  CHECK (
    "source" <> 'algorithm'
    OR (
      "proposed_by_user_id" IS NULL
      AND "supporting_events" IS NOT NULL
      AND "confidence" IS NOT NULL
    )
  );
