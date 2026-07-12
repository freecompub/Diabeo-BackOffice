-- ═══════════════════════════════════════════════════════════════
-- US-2659 (slice S0) — Socle de titration de la basale STYLO (MDI)
-- ═══════════════════════════════════════════════════════════════
-- Débloque la titration de la basale stylo (single/split) et la proposition patient de baisse basale :
-- sans discriminateur de CIBLE, aucune proposition ne peut adresser une `dailyDose`/`morningDose`/
-- `eveningDose` (la basale pompe cible un `PumpBasalSlot`, la basale stylo n'a pas de créneau adressable).
-- Additif, non destructif. Contrat iOS (nouveau discriminateur) → coordination swift-expert.
--
-- ⚠️ NOTE (post-échec migrate deploy, code 23514) : cette migration NE POSE PLUS le CHECK d'exclusivité
-- de cible basale. Ce CHECK était prématuré (dépendant des données : il supposait que toute ligne
-- `basalRate` avait déjà un `pump_basal_slot_id`, faux pour les propositions legacy adressées par
-- `time_slot_start_hour` seul). Il est déplacé — avec la remédiation des données requise en amont — dans
-- la migration forward `20260724100000_us2659_s0b_basal_target_check`. S0 reste ainsi une migration
-- purement additive de schéma, qui réussit quel que soit l'état des données.
--
-- ⚠️ IDEMPOTENCE (reprise d'un `migrate deploy` échoué) : `migrate deploy` n'enveloppe PAS ce fichier dans
-- une transaction unique — chaque instruction est committée séparément. Sur l'environnement qui a subi
-- l'échec 23514 (l'`ADD CONSTRAINT` d'origine), le `CREATE TYPE` et l'`ADD COLUMN` étaient DÉJÀ committés
-- avant l'échec. Rejouer S0 telle quelle (`migrate resolve --rolled-back` → `migrate deploy`) échouerait
-- donc à nouveau (`42710 type already exists`, `42701 column already exists`). Les gardes ci-dessous
-- (`EXCEPTION WHEN duplicate_object`, `ADD COLUMN IF NOT EXISTS`) rendent S0 rejouable sur cet état partiel.

-- CreateEnum — cible d'une proposition de basale stylo (NULL pour pompe/ISF/ICR/fixedDose).
-- Gardé : le type peut déjà exister (committé par une tentative `migrate deploy` antérieure ayant échoué
-- plus loin, sur l'`ADD CONSTRAINT` d'origine 23514). `duplicate_object` = type déjà présent → no-op.
DO $$ BEGIN
  CREATE TYPE "BasalDoseKind" AS ENUM ('daily', 'morning', 'evening');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable — colonne NULLABLE (les autres paramètres restent `basal_dose_kind` NULL).
-- `IF NOT EXISTS` : idem, la colonne peut avoir été committée par la tentative échouée en amont du CHECK.
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
