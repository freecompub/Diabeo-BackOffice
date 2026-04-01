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
