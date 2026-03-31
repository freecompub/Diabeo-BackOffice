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
