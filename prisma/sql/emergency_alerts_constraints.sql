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
