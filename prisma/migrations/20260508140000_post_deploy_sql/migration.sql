-- US-2267 — Migration post-deploy : DDL non exprimables en Prisma schema
-- (triggers, fonctions SECURITY DEFINER, CHECK constraints, partial indexes).
-- Doit s'appliquer APRÈS la baseline_v1 sur DB neuve.
--
-- ⚠️ NB : cgm_partitioning.sql n'est PAS inclus ici car la conversion d'une
-- table regular vers partitionnée crée un drift permanent vs le schema Prisma
-- (clé primaire composite, FK reconstruite). Voir docs/runbook/postgres-partitioning.md
-- pour l'opération manuelle à exécuter post-prod si volume CGM le justifie.
--
-- Si vous travaillez sur une DB pré-existante (db push historique), ces
-- objets peuvent déjà exister — chaque bloc est idempotent (CREATE OR
-- REPLACE / IF NOT EXISTS) ou explicitement guarded.


-- ─────────────────────────────────────────────────────────────
-- Source : prisma/sql/audit_immutability.sql
-- ─────────────────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════
-- Audit Log Immutability Trigger — HDS Compliance
-- ═══════════════════════════════════════════════════════════════
-- Apply AFTER the initial Prisma migration creates the tables.
-- This enforces immutability at the database level in addition to
-- the Prisma middleware in src/lib/db/client.ts.
--
-- Defense-in-depth: even if the middleware is bypassed (raw SQL,
-- database console), audit records cannot be modified or deleted.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is immutable: % operation is forbidden (HDS compliance)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

-- ─────────────────────────────────────────────────────────────
-- Source : prisma/sql/audit_retention.sql
-- ─────────────────────────────────────────────────────────────
-- Audit log retention function (HDS 6-year compliance)
-- Anonymizes PII fields on old audit records while preserving the trail structure.
-- Uses SECURITY DEFINER + advisory lock + SET LOCAL (crash-safe).
--
-- Usage: SELECT audit_log_apply_retention(6);
--
-- IMPORTANT: Does NOT delete rows — anonymizes PII fields only.
-- Minimum retention_years = 6 (HDS legal requirement).

CREATE OR REPLACE FUNCTION audit_log_apply_retention(retention_years INT DEFAULT 6)
RETURNS TABLE(anonymized_count BIGINT) AS $$
DECLARE
  cutoff TIMESTAMPTZ;
  affected BIGINT;
BEGIN
  IF retention_years < 6 THEN
    RAISE EXCEPTION 'retention_years must be >= 6 (HDS minimum), got %', retention_years;
  END IF;

  -- Serialize concurrent retention calls
  PERFORM pg_advisory_xact_lock(hashtext('audit_log_retention'));

  cutoff := NOW() - (retention_years || ' years')::INTERVAL;

  -- SET LOCAL is transaction-scoped: auto-reverts on commit, rollback, or crash
  SET LOCAL session_replication_role = 'replica';

  UPDATE audit_logs SET
    ip_address = NULL,
    user_agent = NULL,
    old_value = NULL,
    new_value = NULL,
    metadata = jsonb_build_object('anonymized', true, 'retentionAppliedAt', NOW()::TEXT)
  WHERE created_at < cutoff
    AND (metadata->>'anonymized')::TEXT IS DISTINCT FROM 'true';

  GET DIAGNOSTICS affected = ROW_COUNT;

  RESET session_replication_role;

  RETURN QUERY SELECT affected;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────
-- Source : prisma/sql/basal_config_check.sql
-- ─────────────────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════
-- Basal Configuration Type/Fields Mutual Exclusion
-- ═══════════════════════════════════════════════════════════════
-- Ensures that dose fields match the config_type:
-- - pump: only totalDailyDose (calculated from slots)
-- - single_injection: only dailyDose
-- - split_injection: only morningDose + eveningDose
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE "basal_configurations" ADD CONSTRAINT "chk_basal_config_type_fields"
CHECK (
  (config_type = 'pump' AND daily_dose IS NULL AND morning_dose IS NULL AND evening_dose IS NULL)
  OR (config_type = 'single_injection' AND total_daily_dose IS NULL AND morning_dose IS NULL AND evening_dose IS NULL)
  OR (config_type = 'split_injection' AND total_daily_dose IS NULL AND daily_dose IS NULL)
);

-- ─────────────────────────────────────────────────────────────
-- Source : prisma/sql/emergency_alerts_constraints.sql
-- ─────────────────────────────────────────────────────────────
-- Mirror MVP — Constraints for emergency_alerts and ketone_thresholds.
-- Apply manually after `prisma db push` / migration:
--   psql $DATABASE_URL < prisma/sql/emergency_alerts_constraints.sql
--
-- Idempotent (uses IF NOT EXISTS / DROP-CREATE patterns where supported).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) PARTIAL UNIQUE INDEX — at most one live alert per (patient, alertType).
-- Source of truth for the cooldown / TOCTOU race protection in
-- emergency.service.ts → safeCreateAlert (catches P2002).
-- Without this index, concurrent CGM ingestion bursts can insert duplicate
-- live alerts for the same patient/type, fanning out duplicate FCM pushes.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS emergency_alerts_one_live_per_type
  ON emergency_alerts (patient_id, alert_type)
  WHERE status IN ('open', 'acknowledged');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) CHECK CONSTRAINT — ketone_thresholds ordering invariant.
-- Application validator already enforces light < moderate < dka, but a
-- DB-level CHECK ensures direct SQL writes / future migrations cannot
-- silently introduce a degenerate configuration that would suppress alerts.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ketone_thresholds DROP CONSTRAINT IF EXISTS ketone_thresholds_ordering_check;
ALTER TABLE ketone_thresholds ADD CONSTRAINT ketone_thresholds_ordering_check
  CHECK (
    light_threshold > 0
    AND light_threshold < moderate_threshold
    AND moderate_threshold < dka_threshold
    AND dka_threshold <= 10.0
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) CHECK CONSTRAINT — emergency_alerts trigger-value sanity bounds.
-- Mirrors the application-layer Zod / detect helpers: glucose [40, 600] mg/dL,
-- ketones [0.1, 10] mmol/L. Sensor errors above these ranges should never
-- persist as a real alert trigger.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE emergency_alerts DROP CONSTRAINT IF EXISTS emergency_alerts_glucose_bounds;
ALTER TABLE emergency_alerts ADD CONSTRAINT emergency_alerts_glucose_bounds
  CHECK (glucose_value_mgdl IS NULL OR (glucose_value_mgdl >= 40 AND glucose_value_mgdl <= 600));

ALTER TABLE emergency_alerts DROP CONSTRAINT IF EXISTS emergency_alerts_ketone_bounds;
ALTER TABLE emergency_alerts ADD CONSTRAINT emergency_alerts_ketone_bounds
  CHECK (ketone_value_mmol IS NULL OR (ketone_value_mmol >= 0.1 AND ketone_value_mmol <= 10));

-- ─────────────────────────────────────────────────────────────
-- Source : prisma/sql/patient_insulin_constraints.sql
-- ─────────────────────────────────────────────────────────────
-- Contrainte unique partielle : un patient ne peut pas avoir deux entrées actives
-- pour la même insuline du catalogue avec le même usage.
-- Empêche les doublons (ex: 2x Humalog actif en bolus pour le même patient).
CREATE UNIQUE INDEX IF NOT EXISTS patient_insulin_active_unique
ON patient_insulins (patient_id, insulin_catalog_id, usage)
WHERE is_active = true;

-- Contrainte CHECK : customDurationHours doit être dans les bornes cliniques (0.5 - 48.0h)
ALTER TABLE patient_insulins
ADD CONSTRAINT patient_insulin_duration_check
CHECK (custom_duration_hours IS NULL OR (custom_duration_hours >= 0.5 AND custom_duration_hours <= 48.0));

-- Contrainte CHECK : customOnsetMinutes doit être dans les bornes cliniques (1 - 720 min = 12h)
ALTER TABLE patient_insulins
ADD CONSTRAINT patient_insulin_onset_check
CHECK (custom_onset_minutes IS NULL OR (custom_onset_minutes >= 1 AND custom_onset_minutes <= 720));

-- Contrainte : bolusInsulinId et basalInsulinId dans InsulinTherapySettings
-- doivent référencer des PatientInsulin appartenant au même patient.
-- Implémenté via trigger car les CHECK constraints ne supportent pas les sous-requêtes.
CREATE OR REPLACE FUNCTION check_insulin_therapy_patient_match()
RETURNS TRIGGER AS $$
BEGIN
  -- Vérifier bolusInsulinId appartient au même patient
  IF NEW.bolus_insulin_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM patient_insulins
      WHERE id = NEW.bolus_insulin_id AND patient_id = NEW.patient_id
    ) THEN
      RAISE EXCEPTION 'bolusInsulinId (%) does not belong to patient %', NEW.bolus_insulin_id, NEW.patient_id;
    END IF;
  END IF;

  -- Vérifier basalInsulinId appartient au même patient
  IF NEW.basal_insulin_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM patient_insulins
      WHERE id = NEW.basal_insulin_id AND patient_id = NEW.patient_id
    ) THEN
      RAISE EXCEPTION 'basalInsulinId (%) does not belong to patient %', NEW.basal_insulin_id, NEW.patient_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_insulin_therapy_patient_match
BEFORE INSERT OR UPDATE ON insulin_therapy_settings
FOR EACH ROW
EXECUTE FUNCTION check_insulin_therapy_patient_match();

-- Trigger inverse : si patient_insulins.patient_id est modifié,
-- vérifier que les insulin_therapy_settings liés sont toujours cohérents.
CREATE OR REPLACE FUNCTION check_patient_insulin_patient_match()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.patient_id != NEW.patient_id THEN
    IF EXISTS (
      SELECT 1 FROM insulin_therapy_settings
      WHERE (bolus_insulin_id = NEW.id OR basal_insulin_id = NEW.id)
        AND patient_id != NEW.patient_id
    ) THEN
      RAISE EXCEPTION 'Cannot change patient_id on PatientInsulin (%) — still referenced by insulin_therapy_settings for patient %', NEW.id, OLD.patient_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_patient_insulin_patient_match
BEFORE UPDATE ON patient_insulins
FOR EACH ROW
EXECUTE FUNCTION check_patient_insulin_patient_match();
