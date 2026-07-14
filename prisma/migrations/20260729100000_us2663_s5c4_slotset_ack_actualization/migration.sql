-- ═══════════════════════════════════════════════════════════════
-- US-2663 (slice S5/c4) — Port grouped-only de l'accusé / actualisation sur SlotSetProposal
-- ═══════════════════════════════════════════════════════════════
-- La voie d'écriture par-valeur `AdjustmentProposal` est retirée en S5 (grouped-only). L'accusé
-- patient (US-2065, lecture/acceptation/rejet côté app mobile) et la vérification d'application
-- réelle (US-2066) ciblent désormais la proposition GROUPÉE `SlotSetProposal`.
--   • Décision produit D3 : UN accusé = jeu entier → relation 1:1 (`slot_set_proposal_id` UNIQUE).
--   • Miroir strict des tables `adjustment_proposal_acks` / `adjustment_proposal_actualizations`
--     (mêmes colonnes/contraintes ; `patient_id` FK explicite dès la création — parité review #390 H10).
--
-- ADDITIF et RÉVERSIBLE : nouvelles tables, aucun consommateur existant modifié. `IF NOT EXISTS` +
-- garde `DO $$ … EXCEPTION WHEN duplicate_object` sur les FK : idempotence de reprise (`migrate deploy`
-- ne wrappe pas le fichier dans une transaction unique — cf. incident US-2659 S0, doit être rejouable).

-- ─────────────────────────────────────────────────────────────
-- US-2663 S5/c4 — Accusé patient sur SlotSetProposal
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "slot_set_proposal_acks" (
    "id" SERIAL NOT NULL,
    "slot_set_proposal_id" TEXT NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "accepted" BOOLEAN,
    "read_at" TIMESTAMPTZ,
    "responded_at" TIMESTAMPTZ,
    "comment" TEXT,

    CONSTRAINT "slot_set_proposal_acks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "slot_set_proposal_acks_slot_set_proposal_id_key" ON "slot_set_proposal_acks"("slot_set_proposal_id");
CREATE INDEX IF NOT EXISTS "slot_set_proposal_acks_patient_id_idx" ON "slot_set_proposal_acks"("patient_id");

-- ─────────────────────────────────────────────────────────────
-- US-2663 S5/c4 — Actualisation (application réelle) d'une SlotSetProposal
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "slot_set_proposal_actualizations" (
    "id" SERIAL NOT NULL,
    "slot_set_proposal_id" TEXT NOT NULL,
    "effective_at" TIMESTAMPTZ,
    "verified_via" VARCHAR(40) NOT NULL,
    "verified_by" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slot_set_proposal_actualizations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "slot_set_proposal_actualizations_slot_set_proposal_id_key" ON "slot_set_proposal_actualizations"("slot_set_proposal_id");
CREATE INDEX IF NOT EXISTS "slot_set_proposal_actualizations_verified_by_idx" ON "slot_set_proposal_actualizations"("verified_by");

-- Clés étrangères (rejouables via garde duplicate_object).
DO $$ BEGIN
  ALTER TABLE "slot_set_proposal_acks" ADD CONSTRAINT "slot_set_proposal_acks_slot_set_proposal_id_fkey"
    FOREIGN KEY ("slot_set_proposal_id") REFERENCES "slot_set_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "slot_set_proposal_acks" ADD CONSTRAINT "slot_set_proposal_acks_patient_id_fkey"
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "slot_set_proposal_actualizations" ADD CONSTRAINT "slot_set_proposal_actualizations_slot_set_proposal_id_fkey"
    FOREIGN KEY ("slot_set_proposal_id") REFERENCES "slot_set_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "slot_set_proposal_actualizations" ADD CONSTRAINT "slot_set_proposal_actualizations_verified_by_fkey"
    FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
