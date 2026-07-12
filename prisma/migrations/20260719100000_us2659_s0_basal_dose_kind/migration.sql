-- ═══════════════════════════════════════════════════════════════
-- US-2659 (slice S0) — Socle de titration de la basale STYLO (MDI)
-- ═══════════════════════════════════════════════════════════════
-- Débloque la titration de la basale stylo (single/split) et la proposition patient de baisse basale :
-- sans discriminateur de CIBLE, aucune proposition ne peut adresser une `dailyDose`/`morningDose`/
-- `eveningDose` (la basale pompe cible un `PumpBasalSlot`, la basale stylo n'a pas de créneau adressable).
-- Contrat iOS (nouveau discriminateur) → coordination swift-expert.
--
-- ⚠️ CORRECTIF (post-échec migrate deploy, code 23514) : la version initiale posait le CHECK d'exclusivité
-- en supposant que TOUTE ligne `basalRate` avait déjà un `pump_basal_slot_id` (XOR vrai). FAUX : une ancienne
-- version de l'algorithme créait des propositions `basalRate` adressées par `time_slot_start_hour` SEUL
-- (aucun `pump_basal_slot_id`) → lignes orphelines qui violent le XOR et font échouer le ADD CONSTRAINT,
-- bloquant tout `migrate deploy` suivant. Cette migration est donc rendue (1) IDEMPOTENTE (rejouable sur une
-- base partiellement appliquée) et (2) AUTO-RÉPARANTE (remédiation des orphelins AVANT le CHECK) — elle
-- garantit son succès quel que soit l'état des données existantes (prod incluse).

-- CreateEnum — cible d'une proposition de basale stylo (NULL pour pompe/ISF/ICR/fixedDose).
-- Bloc DO idempotent : CREATE TYPE n'accepte pas IF NOT EXISTS (rejeu sur base partiellement appliquée).
DO $$ BEGIN
  CREATE TYPE "BasalDoseKind" AS ENUM ('daily', 'morning', 'evening');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable — colonne NULLABLE (les autres paramètres restent `basal_dose_kind` NULL). IF NOT EXISTS : rejeu sûr.
ALTER TABLE "adjustment_proposals" ADD COLUMN IF NOT EXISTS "basal_dose_kind" "BasalDoseKind";

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

-- ─────────────────────────────────────────────────────────────────────────────
-- REMÉDIATION DES DONNÉES (auto-réparation) — AVANT le CHECK, sinon 23514.
-- Cible : lignes `basalRate` sans AUCUN discriminateur de cible (`pump_basal_slot_id` NULL ET
-- `basal_dose_kind` NULL), héritées de l'ancien adressage par `time_slot_start_hour`.
-- ─────────────────────────────────────────────────────────────────────────────

-- (1) Backfill NON destructif : rattacher `pump_basal_slot_id` depuis le créneau pompe du patient dont
--     l'heure de début matche `time_slot_start_hour`. Récupère les VRAIES propositions pompe orphelines
--     (patients sous pompe). Le join ne matche que des configs pompe (seules porteuses de `pump_basal_slots`).
UPDATE "adjustment_proposals" ap
SET "pump_basal_slot_id" = pbs."id"
FROM "pump_basal_slots" pbs
  JOIN "basal_configurations" bc ON pbs."basal_config_id" = bc."id"
  JOIN "insulin_therapy_settings" its ON bc."settings_id" = its."id"
WHERE ap."parameter_type" = 'basalRate'
  AND ap."pump_basal_slot_id" IS NULL
  AND ap."basal_dose_kind" IS NULL
  AND its."patient_id" = ap."patient_id"
  AND EXTRACT(HOUR FROM pbs."start_time")::int = ap."time_slot_start_hour";

-- (2) Défensif : hors `basalRate`, `basal_dose_kind` doit rester NULL (no-op sur colonne fraîche, filet au rejeu).
UPDATE "adjustment_proposals"
SET "basal_dose_kind" = NULL
WHERE "parameter_type" <> 'basalRate' AND "basal_dose_kind" IS NOT NULL;

-- (3) DESTRUCTIF (autorisé explicitement — US-2659 recovery) : les orphelins restants ne correspondent à
--     AUCUNE cible valide (patients stylo sans créneau pompe : `current_value` en U/h ≠ dose stylo totale,
--     leur poser un `basal_dose_kind` mentirait). Ce sont des propositions `pending` JAMAIS appliquées,
--     générées par une version périmée de l'algorithme. On les supprime pour rendre la table conforme au XOR.
--     Marquer `superseded` ne suffirait pas : le CHECK est inconditionnel sur le statut.
DELETE FROM "adjustment_proposals"
WHERE "parameter_type" = 'basalRate'
  AND "pump_basal_slot_id" IS NULL
  AND "basal_dose_kind" IS NULL;

-- CHECK — EXCLUSIVITÉ de la cible basale (revue swift-expert S0). `parameter_type = 'basalRate'` est
-- surchargé : cible POMPE (`pump_basal_slot_id`, U/h) OU cible STYLO (`basal_dose_kind`, U totales), jamais
-- les deux, jamais aucune. L'index unique partiel garantit l'anti-collision, PAS l'exclusivité de
-- remplissage → un client (iOS/back) pourrait lire le mauvais discriminateur ou afficher la mauvaise unité.
-- Ce CHECK verrouille l'invariant EN BASE (défense en profondeur). Hors basalRate, `basal_dose_kind` doit
-- rester NULL (discriminateur propre à la basale stylo). La remédiation (1)–(3) ci-dessus garantit que TOUTES
-- les lignes conforment au XOR AVANT ce ADD CONSTRAINT. Prisma ne modélise pas les CHECK → invisible au
-- drift-gate, appliqué par `migrate deploy`. DROP IF EXISTS + ADD → idempotent.
ALTER TABLE "adjustment_proposals" DROP CONSTRAINT IF EXISTS "adjustment_proposals_basal_target_exclusivity_check";
ALTER TABLE "adjustment_proposals" ADD CONSTRAINT "adjustment_proposals_basal_target_exclusivity_check"
  CHECK (
    CASE
      WHEN "parameter_type" = 'basalRate'
        THEN ("pump_basal_slot_id" IS NOT NULL) <> ("basal_dose_kind" IS NOT NULL)
      ELSE "basal_dose_kind" IS NULL
    END
  );
