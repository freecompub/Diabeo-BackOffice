-- Audit log retention function (HDS 6-year compliance)
-- This function bypasses the immutability trigger using SECURITY DEFINER
-- to anonymize old audit records while preserving the audit trail structure.
--
-- Usage: SELECT audit_log_apply_retention(6);
-- This anonymizes records older than 6 years (sets PII fields to NULL).
--
-- IMPORTANT: This does NOT delete rows — it anonymizes PII fields
-- (ipAddress, userAgent, oldValue, newValue, metadata) to comply with
-- RGPD Art. 17 while maintaining the HDS audit trail structure.

-- Step 1: Create the retention function with SECURITY DEFINER
-- This allows it to bypass the audit_logs_immutable trigger
CREATE OR REPLACE FUNCTION audit_log_apply_retention(retention_years INT DEFAULT 6)
RETURNS TABLE(anonymized_count BIGINT) AS $$
DECLARE
  cutoff TIMESTAMPTZ;
  affected BIGINT;
BEGIN
  cutoff := NOW() - (retention_years || ' years')::INTERVAL;

  -- Temporarily disable the immutability trigger
  ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_immutable;

  -- Anonymize PII fields on old records (keep action, resource, userId, createdAt)
  UPDATE audit_logs SET
    ip_address = NULL,
    user_agent = NULL,
    old_value = NULL,
    new_value = NULL,
    metadata = '{"anonymized": true, "retentionAppliedAt": "' || NOW()::TEXT || '"}'::JSONB
  WHERE created_at < cutoff
    AND (metadata->>'anonymized')::TEXT IS DISTINCT FROM 'true';

  GET DIAGNOSTICS affected = ROW_COUNT;

  -- Re-enable the immutability trigger
  ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_immutable;

  RETURN QUERY SELECT affected;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
