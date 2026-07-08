-- US-2657 (durcissement review epic) — TAMPER-EVIDENCE des artefacts de gouvernance.
-- Bloque tout UPDATE sur `governance_approvals` et `auto_apply_events` (append-only). Ces triggers vivaient
-- uniquement dans `prisma/sql/audit_immutability.sql` (NON appliqué par `migrate deploy`, cf.
-- `docs/runbook/migrations.md`) : la garantie d'intégrité affirmée par la DPIA et les commentaires n'était
-- donc PAS déployée en base. On la livre ici en migration versionnée.
-- Idempotent (`CREATE OR REPLACE` + `DROP TRIGGER IF EXISTS`). Le DELETE reste permis (effacement RGPD Art. 17
-- via `deletion.service`). Invisible au drift-gate Prisma (les triggers ne sont pas modélisés par le schema).

CREATE OR REPLACE FUNCTION prevent_governance_row_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: UPDATE is forbidden (governance tamper-evidence)', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS governance_approvals_no_update ON governance_approvals;
CREATE TRIGGER governance_approvals_no_update
  BEFORE UPDATE ON governance_approvals
  FOR EACH ROW EXECUTE FUNCTION prevent_governance_row_update();

DROP TRIGGER IF EXISTS auto_apply_events_no_update ON auto_apply_events;
CREATE TRIGGER auto_apply_events_no_update
  BEFORE UPDATE ON auto_apply_events
  FOR EACH ROW EXECUTE FUNCTION prevent_governance_row_update();
