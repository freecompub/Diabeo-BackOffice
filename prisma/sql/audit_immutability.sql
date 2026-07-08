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

-- ═══════════════════════════════════════════════════════════════
-- US-2657 (slice C) — Immutabilité des artefacts de gouvernance
-- ═══════════════════════════════════════════════════════════════
-- governance_approvals & auto_apply_events sont append-only : une
-- approbation enregistrée ou un événement d'auto-application ne doit
-- JAMAIS être ALTÉRÉ silencieusement (tamper-evidence HDS/MDR).
--
-- ⚠️ On bloque UPDATE UNIQUEMENT (pas DELETE) : ces tables ont un FK
-- ON DELETE CASCADE vers patients, requis pour l'effacement RGPD
-- Art. 17 (deletion.service.ts). L'ACTION de gouvernance reste tracée
-- dans audit_logs (immuable UPDATE+DELETE, non cascadé) même si
-- l'artefact est effacé avec le patient.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION prevent_governance_row_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: UPDATE is forbidden (governance tamper-evidence)', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER governance_approvals_no_update
  BEFORE UPDATE ON governance_approvals
  FOR EACH ROW EXECUTE FUNCTION prevent_governance_row_update();

CREATE TRIGGER auto_apply_events_no_update
  BEFORE UPDATE ON auto_apply_events
  FOR EACH ROW EXECUTE FUNCTION prevent_governance_row_update();
