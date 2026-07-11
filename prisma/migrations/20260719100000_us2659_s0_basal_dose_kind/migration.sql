-- ═══════════════════════════════════════════════════════════════
-- US-2659 (slice S0) — Socle de titration de la basale STYLO (MDI)
-- ═══════════════════════════════════════════════════════════════
-- Débloque la titration de la basale stylo (single/split) et la proposition patient de baisse basale :
-- sans discriminateur de CIBLE, aucune proposition ne peut adresser une `dailyDose`/`morningDose`/
-- `eveningDose` (la basale pompe cible un `PumpBasalSlot`, la basale stylo n'a pas de créneau adressable).
-- Additif, non destructif. Contrat iOS (nouveau discriminateur) → coordination swift-expert.

-- CreateEnum — cible d'une proposition de basale stylo (NULL pour pompe/ISF/ICR/fixedDose).
CREATE TYPE "BasalDoseKind" AS ENUM ('daily', 'morning', 'evening');

-- AlterTable — colonne NULLABLE (les autres paramètres restent `basal_dose_kind` NULL).
ALTER TABLE "adjustment_proposals" ADD COLUMN "basal_dose_kind" "BasalDoseKind";

-- L'index UNIQUE PARTIEL anti-spam (1 pending / cible) doit inclure `basal_dose_kind` : sinon deux
-- propositions de basale stylo pending sur des doses DIFFÉRENTES (matin vs soir en split_injection)
-- violeraient l'unicité à tort. Drop + recreate avec `basal_dose_kind` ajouté au tuple. `NULLS NOT
-- DISTINCT` conservé : pour pompe/ISF/ICR/fixedDose, `basal_dose_kind` vaut NULL et ne doit pas casser
-- l'unicité existante (deux NULL comptent comme égaux). Index partiel non modélisé par Prisma (WHERE)
-- → invisible au drift-gate, livré en migration versionnée (auto-appliqué par `migrate deploy`).
DROP INDEX IF EXISTS "adjustment_proposals_one_pending_per_slot";
CREATE UNIQUE INDEX IF NOT EXISTS "adjustment_proposals_one_pending_per_slot"
  ON "adjustment_proposals" (
    "patient_id",
    "parameter_type",
    "time_slot_start_hour",
    "carb_ratio_slot_start",
    "pump_basal_slot_id",
    "moment",
    "basal_dose_kind"
  )
  NULLS NOT DISTINCT
  WHERE "status" = 'pending';

-- CHECK — EXCLUSIVITÉ de la cible basale (revue swift-expert S0). `parameter_type = 'basalRate'` est
-- surchargé : cible POMPE (`pump_basal_slot_id`, U/h) OU cible STYLO (`basal_dose_kind`, U totales), jamais
-- les deux, jamais aucune. L'index unique partiel garantit l'anti-collision, PAS l'exclusivité de
-- remplissage → un client (iOS/back) pourrait lire le mauvais discriminateur ou afficher la mauvaise unité.
-- Ce CHECK verrouille l'invariant EN BASE (défense en profondeur). Hors basalRate, `basal_dose_kind` doit
-- rester NULL (discriminateur propre à la basale stylo). Validé inline : le chemin `basalRate` existant exige
-- déjà `pump_basal_slot_id` (adjustment.service.ts `getCurrentValue`) → toutes les lignes legacy conforment
-- (XOR vrai). Prisma ne modélise pas les CHECK → invisible au drift-gate, appliqué par `migrate deploy`. Idempotent.
ALTER TABLE "adjustment_proposals" DROP CONSTRAINT IF EXISTS "adjustment_proposals_basal_target_exclusivity_check";
ALTER TABLE "adjustment_proposals" ADD CONSTRAINT "adjustment_proposals_basal_target_exclusivity_check"
  CHECK (
    CASE
      WHEN "parameter_type" = 'basalRate'
        THEN ("pump_basal_slot_id" IS NOT NULL) <> ("basal_dose_kind" IS NOT NULL)
      ELSE "basal_dose_kind" IS NULL
    END
  );
