-- US-2657 (slice C3) — Proposition d'ENSEMBLE de créneaux (fallback groupe patient EXPERT).
-- Additif, non destructif.

-- CreateTable
CREATE TABLE "slot_set_proposals" (
    "id" TEXT NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "parameter_type" "AdjustableParameter" NOT NULL,
    "proposed_slots" JSONB NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'pending',
    "proposed_by_user_id" INTEGER NOT NULL,
    "reviewed_by_user_id" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ,

    CONSTRAINT "slot_set_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "slot_set_proposals_patient_id_status_created_at_idx" ON "slot_set_proposals"("patient_id", "status", "created_at");

-- AddForeignKey
ALTER TABLE "slot_set_proposals" ADD CONSTRAINT "slot_set_proposals_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Index UNIQUE PARTIEL : au plus UNE proposition d'ensemble `pending` par (patient, paramètre).
-- Rend l'invariant « une seule PENDING » robuste EN BASE (pas seulement dans le supersede applicatif) :
-- ferme la course TOCTOU de deux soumissions simultanées → violation P2002 → `duplicatePendingProposal`
-- (cf. slot-set-proposal.service.ts::createSetProposal). Prisma ne modélise pas les index PARTIELS (WHERE)
-- → invisible au drift-gate ; livré en migration versionnée (auto-appliqué par `migrate deploy`), comme
-- `adjustment_proposals_one_pending_per_slot` (US-2649a, migration 20260705100000).
CREATE UNIQUE INDEX IF NOT EXISTS "slot_set_proposals_one_pending_per_param"
  ON "slot_set_proposals" ("patient_id", "parameter_type")
  WHERE "status" = 'pending';
