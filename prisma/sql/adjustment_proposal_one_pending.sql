-- ═══════════════════════════════════════════════════════════════
-- US-2649a — Anti-spam des propositions d'ajustement (1 pending / créneau)
-- ═══════════════════════════════════════════════════════════════
-- Index UNIQUE PARTIEL garantissant qu'il n'existe qu'UNE proposition en statut
-- `pending` par (patient, paramètre, créneau). Ferme la course TOCTOU du pré-check
-- applicatif (`adjustmentService.createProposal`) : deux requêtes concurrentes ne
-- peuvent plus créer deux propositions en attente sur le même créneau.
--
-- `NULLS NOT DISTINCT` (PostgreSQL 15+) : les colonnes de créneau non pertinentes
-- pour un paramètre valent NULL (ex. ISF → carb_ratio_slot_start / pump_basal_slot_id
-- NULL) ; sans cette clause, deux NULL seraient considérés distincts et l'unicité ne
-- s'appliquerait pas. La violation remonte en P2002 → `duplicatePendingProposal`.
--
-- ⚠️ Hors migration Prisma (comme les autres `prisma/sql/*` : Prisma ne modélise pas
-- les index partiels → éviterait le drift-gate). À appliquer manuellement en prod :
--   psql $DATABASE_URL < prisma/sql/adjustment_proposal_one_pending.sql
-- Idempotent (IF NOT EXISTS).

CREATE UNIQUE INDEX IF NOT EXISTS "adjustment_proposals_one_pending_per_slot"
  ON "adjustment_proposals" (
    "patient_id",
    "parameter_type",
    "time_slot_start_hour",
    "carb_ratio_slot_start",
    "pump_basal_slot_id"
  )
  NULLS NOT DISTINCT
  WHERE "status" = 'pending';
