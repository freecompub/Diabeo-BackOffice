-- Audit log retention function (HDS 6-year compliance)
-- Anonymizes PII fields on old audit records while preserving the trail structure.
-- Uses SECURITY DEFINER + advisory lock + error-safe trigger management.
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

  ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_immutable;

  BEGIN
    UPDATE audit_logs SET
      ip_address = NULL,
      user_agent = NULL,
      old_value = NULL,
      new_value = NULL,
      metadata = jsonb_build_object('anonymized', true, 'retentionAppliedAt', NOW()::TEXT)
    WHERE created_at < cutoff
      AND (metadata->>'anonymized')::TEXT IS DISTINCT FROM 'true';

    GET DIAGNOSTICS affected = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_immutable;
    RAISE;
  END;

  ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_immutable;

  RETURN QUERY SELECT affected;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
