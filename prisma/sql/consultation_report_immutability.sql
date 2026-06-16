-- ═══════════════════════════════════════════════════════════════
-- US-2605 — Consultation Report Addendum Immutability Trigger — HDS
-- ═══════════════════════════════════════════════════════════════
-- Copie de référence (la source de vérité est la migration
-- 20260616160000_us2605_encounter_report). Permet de ré-appliquer le trigger
-- hors-bande (runbook incident) sans rejouer toute la migration.
--
-- Append-only : aucun DELETE, aucun UPDATE SAUF la transition soft-delete RGPD
-- (seul `deleted_at` peut changer). Défense en profondeur : même via SQL brut /
-- console DB, un compte rendu finalisé ne peut être altéré ni supprimé.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION prevent_consultation_report_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'consultation_report_addenda is append-only: DELETE forbidden (HDS compliance)';
  END IF;
  IF NEW."content" IS DISTINCT FROM OLD."content"
     OR NEW."period" IS DISTINCT FROM OLD."period"
     OR NEW."data_as_of" IS DISTINCT FROM OLD."data_as_of"
     OR NEW."encounter_id" IS DISTINCT FROM OLD."encounter_id"
     OR NEW."patient_id" IS DISTINCT FROM OLD."patient_id"
     OR NEW."author_id" IS DISTINCT FROM OLD."author_id"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'consultation_report_addenda is immutable except soft-delete (HDS compliance)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS consultation_report_addenda_immutable ON "consultation_report_addenda";
CREATE TRIGGER consultation_report_addenda_immutable
  BEFORE UPDATE OR DELETE ON "consultation_report_addenda"
  FOR EACH ROW EXECUTE FUNCTION prevent_consultation_report_mutation();
