-- ═══════════════════════════════════════════════════════════════
-- US-2649a — Anti-spam propositions d'ajustement (1 pending / créneau)
-- ═══════════════════════════════════════════════════════════════
-- Index UNIQUE PARTIEL : au plus UNE proposition `pending` par
-- (patient, paramètre, créneau). Ferme la course TOCTOU du pré-check applicatif
-- (`adjustmentService.createProposal`) — la violation remonte en P2002 →
-- `duplicatePendingProposal`.
--
-- `NULLS NOT DISTINCT` (PostgreSQL 15+) : les colonnes de créneau non pertinentes
-- pour un paramètre valent NULL (ex. ISF → carb_ratio_slot_start / pump_basal_slot_id
-- NULL). Sans cette clause, deux NULL seraient distincts et l'unicité ne s'appliquerait
-- pas. (Le service normalise en plus les discriminateurs parasites → null.)
--
-- Prisma ne modélise pas les index PARTIELS (WHERE) → invisible au drift-gate ; livré
-- en migration versionnée (auto-appliqué par `migrate deploy`, comme
-- `emergency_alerts_one_live_per_type`), PAS en `prisma/sql` manuel.
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
