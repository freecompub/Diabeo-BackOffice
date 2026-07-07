-- ═══════════════════════════════════════════════════════════════
-- US-2652 — Dose fixe : discriminateur `moment` sur adjustment_proposals
-- ═══════════════════════════════════════════════════════════════
-- Débloque `createEngineProposal`/`createProposal` pour le paramètre `fixedDose` : sans colonne
-- de moment, impossible de cibler/dédoublonner une `FixedDoseSlot` → l'ancien code levait
-- `fixedDoseNotWired` (fail-closed). Colonne NULLABLE (les 3 autres paramètres restent `moment` NULL).
ALTER TABLE "adjustment_proposals" ADD COLUMN "moment" "DoseMoment";

-- L'index UNIQUE PARTIEL anti-spam (1 pending / créneau) doit inclure `moment` : sinon deux
-- propositions `fixedDose` pending sur des moments DIFFÉRENTS violeraient l'unicité à tort. Drop +
-- recreate avec `moment` ajouté. `NULLS NOT DISTINCT` : pour ISF/ICR/basal, `moment` vaut NULL et ne
-- doit pas casser l'unicité existante (deux NULL comptent comme égaux). Index partiel non modélisé par
-- Prisma (WHERE) → invisible au drift-gate, livré en migration versionnée.
DROP INDEX IF EXISTS "adjustment_proposals_one_pending_per_slot";
CREATE UNIQUE INDEX IF NOT EXISTS "adjustment_proposals_one_pending_per_slot"
  ON "adjustment_proposals" (
    "patient_id",
    "parameter_type",
    "time_slot_start_hour",
    "carb_ratio_slot_start",
    "pump_basal_slot_id",
    "moment"
  )
  NULLS NOT DISTINCT
  WHERE "status" = 'pending';
