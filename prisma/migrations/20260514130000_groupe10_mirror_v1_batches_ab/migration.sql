-- Groupe 10 Mirror V1 — Batches A+B (7 US, ~30 SP)
--   Batch A : US-2218/2219/2220/2221 Config urgences avancée
--   Batch B : US-2227/2228/2229     Analytics urgences
-- Reuses Mirror MVP models : AlertThresholdConfig, KetoneThreshold,
--   HypoTreatmentProtocol, EmergencyAlert, AuditLog (cf. PR #343).

-- ─────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────
CREATE TYPE "config_version_type" AS ENUM (
    'emergency_contacts', 'escalation_rules', 'alert_thresholds'
);
CREATE TYPE "config_version_status" AS ENUM ('active', 'superseded', 'archived');
CREATE TYPE "escalation_target_type" AS ENUM ('contact', 'doctor', 'samu');
CREATE TYPE "risk_level" AS ENUM ('low', 'medium', 'high', 'critical');

-- ─────────────────────────────────────────────────────────────
-- US-2221 — config_versions (hub versioning)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE "config_versions" (
    "id"              SERIAL NOT NULL,
    -- C3-NEW (re-review) — nullable to support FK SetNull on patient hard-delete.
    "patient_id"      INTEGER,
    "config_type"     "config_version_type" NOT NULL,
    "version"         INTEGER NOT NULL,
    "config_snapshot" JSONB NOT NULL,
    "valid_from"      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to"        TIMESTAMPTZ,
    "status"          "config_version_status" NOT NULL DEFAULT 'active',
    "created_by"      INTEGER NOT NULL,
    "validated_by"    INTEGER,
    "validated_at"    TIMESTAMPTZ,
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "config_versions_pkey" PRIMARY KEY ("id"),
    -- Append-only : valid_to may transition from NULL → date, never back.
    -- A second-level immutability is enforced via DB trigger below.
    CONSTRAINT "config_versions_range_check"
        CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from")
);
CREATE UNIQUE INDEX "config_versions_patient_id_config_type_version_key"
    ON "config_versions"("patient_id", "config_type", "version");
CREATE INDEX "config_versions_patient_id_config_type_valid_from_idx"
    ON "config_versions"("patient_id", "config_type", "valid_from");
CREATE INDEX "config_versions_status_config_type_idx"
    ON "config_versions"("status", "config_type");

-- C3-NEW (re-review) — patient_id FK SetNull (was CASCADE). The append-only
-- BEFORE DELETE trigger blocks any cascade-delete, which would make RGPD
-- Art. 17 hard-deletion of a patient fail. SetNull lets the patient row
-- be deleted while preserving the config history as an orphan (audit-friendly).
-- patient_id must therefore be nullable in the schema.
ALTER TABLE "config_versions"
    ADD CONSTRAINT "config_versions_patient_id_fkey"
        FOREIGN KEY ("patient_id") REFERENCES "patients"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "config_versions_created_by_fkey"
        FOREIGN KEY ("created_by") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "config_versions_validated_by_fkey"
        FOREIGN KEY ("validated_by") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

-- US-2221 — append-only trigger : reject UPDATE on config_snapshot /
-- created_by / version after row insertion.
-- H3 (re-review) — also lock `validated_by` and `validated_at` once set
-- (a NURSE-created version can be approved by a DOCTOR exactly once ;
-- attempts to forge approval via direct SQL/Prisma are blocked).
-- `valid_to` and `status` remain mutable for the supersession workflow,
-- but status transitions are restricted to allowed states.
CREATE OR REPLACE FUNCTION config_versions_immutability()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.config_snapshot IS DISTINCT FROM NEW.config_snapshot
       OR OLD.created_by    IS DISTINCT FROM NEW.created_by
       OR OLD.version       IS DISTINCT FROM NEW.version
       OR OLD.patient_id    IS DISTINCT FROM NEW.patient_id
       OR OLD.config_type   IS DISTINCT FROM NEW.config_type
       OR OLD.valid_from    IS DISTINCT FROM NEW.valid_from THEN
        RAISE EXCEPTION 'config_versions: immutable columns cannot be modified';
    END IF;
    -- H3 — once validated, validated_by + validated_at are frozen forever.
    IF OLD.validated_at IS NOT NULL AND (
           OLD.validated_at IS DISTINCT FROM NEW.validated_at
        OR OLD.validated_by IS DISTINCT FROM NEW.validated_by
    ) THEN
        RAISE EXCEPTION 'config_versions: validation cannot be revoked or replayed';
    END IF;
    -- Forbid resurrecting an archived or superseded version.
    -- H1-NEW (re-review) — without this, a direct SQL UPDATE could revive a
    -- previously-superseded row and produce dual-active rows for the same
    -- (patient, configType), defeating the version model.
    IF OLD.status = 'archived' AND NEW.status <> 'archived' THEN
        RAISE EXCEPTION 'config_versions: archived versions are terminal';
    END IF;
    IF OLD.status = 'superseded' AND NEW.status = 'active' THEN
        RAISE EXCEPTION 'config_versions: superseded versions cannot be reactivated';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER config_versions_immutability_trigger
    BEFORE UPDATE ON "config_versions"
    FOR EACH ROW
    EXECUTE FUNCTION config_versions_immutability();

-- M6 (re-review) — append-only also means no DELETE. Match the audit_logs
-- pattern (cf. prisma/sql/audit_immutability.sql).
CREATE OR REPLACE FUNCTION config_versions_no_delete()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'config_versions: append-only, DELETE is forbidden';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER config_versions_no_delete_trigger
    BEFORE DELETE ON "config_versions"
    FOR EACH ROW
    EXECUTE FUNCTION config_versions_no_delete();

-- ─────────────────────────────────────────────────────────────
-- US-2218 — emergency_contacts (PHI, max 5/patient)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE "emergency_contacts" (
    "id"               SERIAL NOT NULL,
    "patient_id"       INTEGER NOT NULL,
    "version_id"       INTEGER NOT NULL,
    "rank"             INTEGER NOT NULL,
    "name_encrypted"   TEXT NOT NULL,
    "phone_encrypted"  TEXT NOT NULL,
    "relationship"     VARCHAR(50) NOT NULL,
    "is_active"        BOOLEAN NOT NULL DEFAULT true,
    "created_at"       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_contacts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "emergency_contacts_rank_check"
        CHECK ("rank" BETWEEN 1 AND 5),
    -- Defense-in-depth length caps on encrypted columns (plaintext name ≤ 100,
    -- phone ≤ 20 ; AES-256-GCM + base64 overhead ~33% + IV/TAG 28B).
    CONSTRAINT "emergency_contacts_name_enc_length_check"
        CHECK (octet_length("name_encrypted") <= 400),
    CONSTRAINT "emergency_contacts_phone_enc_length_check"
        CHECK (octet_length("phone_encrypted") <= 200)
);
CREATE INDEX "emergency_contacts_patient_id_rank_is_active_idx"
    ON "emergency_contacts"("patient_id", "rank", "is_active");

ALTER TABLE "emergency_contacts"
    ADD CONSTRAINT "emergency_contacts_patient_id_fkey"
        FOREIGN KEY ("patient_id") REFERENCES "patients"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "emergency_contacts_version_id_fkey"
        FOREIGN KEY ("version_id") REFERENCES "config_versions"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- US-2219 — escalation_rules
-- ─────────────────────────────────────────────────────────────
CREATE TABLE "escalation_rules" (
    "id"           SERIAL NOT NULL,
    "patient_id"   INTEGER NOT NULL,
    "version_id"   INTEGER NOT NULL,
    "priority"     INTEGER NOT NULL,
    "target_type"  "escalation_target_type" NOT NULL,
    "target_id"    INTEGER,
    "delay_minutes" INTEGER NOT NULL DEFAULT 15,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escalation_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "escalation_rules_priority_check"
        CHECK ("priority" BETWEEN 1 AND 10),
    CONSTRAINT "escalation_rules_delay_check"
        CHECK ("delay_minutes" BETWEEN 0 AND 60),
    -- target_id null is allowed only for SAMU target.
    CONSTRAINT "escalation_rules_target_id_check"
        CHECK (
            ("target_type" = 'samu' AND "target_id" IS NULL)
            OR ("target_type" <> 'samu' AND "target_id" IS NOT NULL)
        )
);
CREATE INDEX "escalation_rules_patient_id_priority_idx"
    ON "escalation_rules"("patient_id", "priority");

ALTER TABLE "escalation_rules"
    ADD CONSTRAINT "escalation_rules_patient_id_fkey"
        FOREIGN KEY ("patient_id") REFERENCES "patients"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "escalation_rules_version_id_fkey"
        FOREIGN KEY ("version_id") REFERENCES "config_versions"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- US-2220 — alert_threshold_templates (cabinet-scoped library)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE "alert_threshold_templates" (
    "id"                     SERIAL NOT NULL,
    "organization_id"        INTEGER NOT NULL,
    "profile_type"           VARCHAR(50) NOT NULL,
    "name"                   VARCHAR(100) NOT NULL,
    "glucose_low_mgdl"       DECIMAL(6, 2) NOT NULL,
    "glucose_high_mgdl"      DECIMAL(6, 2) NOT NULL,
    "glucose_very_low_mgdl"  DECIMAL(6, 2) NOT NULL,
    "glucose_very_high_mgdl" DECIMAL(6, 2) NOT NULL,
    "alert_on_hypo"          BOOLEAN NOT NULL DEFAULT true,
    "cooldown_minutes"       INTEGER NOT NULL DEFAULT 30,
    "is_active"              BOOLEAN NOT NULL DEFAULT true,
    "created_at"             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             TIMESTAMPTZ NOT NULL,
    -- M10 (re-review) — nullable to allow RGPD Art. 17 user hard-delete to
    -- SetNull the author reference rather than block on Restrict.
    "created_by"             INTEGER,

    CONSTRAINT "alert_threshold_templates_pkey" PRIMARY KEY ("id"),
    -- Clinical bounds 40-300 mg/dL ; cooldown bounded.
    CONSTRAINT "alert_threshold_templates_low_bounds"
        CHECK ("glucose_low_mgdl" BETWEEN 40 AND 250),
    CONSTRAINT "alert_threshold_templates_high_bounds"
        CHECK ("glucose_high_mgdl" BETWEEN 100 AND 400),
    CONSTRAINT "alert_threshold_templates_order"
        CHECK (
            "glucose_very_low_mgdl" < "glucose_low_mgdl"
            AND "glucose_low_mgdl"  < "glucose_high_mgdl"
            AND "glucose_high_mgdl" < "glucose_very_high_mgdl"
        ),
    CONSTRAINT "alert_threshold_templates_cooldown_bounds"
        CHECK ("cooldown_minutes" BETWEEN 5 AND 360)
);
CREATE UNIQUE INDEX "alert_threshold_templates_organization_id_profile_type_name_key"
    ON "alert_threshold_templates"("organization_id", "profile_type", "name");
CREATE INDEX "alert_threshold_templates_organization_id_is_active_idx"
    ON "alert_threshold_templates"("organization_id", "is_active");

ALTER TABLE "alert_threshold_templates"
    ADD CONSTRAINT "alert_threshold_templates_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "healthcare_services"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    -- M10 (re-review) — SetNull so RGPD Art. 17 user deletion doesn't get
    --   blocked by templates. The "author" reference is for forensic trace
    --   only ; orphaning is preferable to blocking deletion.
    ADD CONSTRAINT "alert_threshold_templates_created_by_fkey"
        FOREIGN KEY ("created_by") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- US-2227 — patient_monitoring_metrics (quarterly cache)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE "patient_monitoring_metrics" (
    "id"                SERIAL NOT NULL,
    "patient_id"        INTEGER NOT NULL,
    "quarter"           VARCHAR(7) NOT NULL,
    "hypo_count"        INTEGER NOT NULL DEFAULT 0,
    "severe_hypo_count" INTEGER NOT NULL DEFAULT 0,
    "dka_count"         INTEGER NOT NULL DEFAULT 0,
    "avg_duration_min"  DECIMAL(6, 1),
    "top_hour_of_day"   INTEGER,
    "metrics_json"      JSONB NOT NULL,
    "computed_at"       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_monitoring_metrics_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "patient_monitoring_metrics_quarter_check"
        CHECK ("quarter" ~ '^[0-9]{4}-Q[1-4]$'),
    CONSTRAINT "patient_monitoring_metrics_top_hour_check"
        CHECK ("top_hour_of_day" IS NULL OR "top_hour_of_day" BETWEEN 0 AND 23)
);
CREATE UNIQUE INDEX "patient_monitoring_metrics_patient_id_quarter_key"
    ON "patient_monitoring_metrics"("patient_id", "quarter");
CREATE INDEX "patient_monitoring_metrics_computed_at_idx"
    ON "patient_monitoring_metrics"("computed_at");

ALTER TABLE "patient_monitoring_metrics"
    ADD CONSTRAINT "patient_monitoring_metrics_patient_id_fkey"
        FOREIGN KEY ("patient_id") REFERENCES "patients"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- US-2228 — cohort_analytics_snapshots
-- ─────────────────────────────────────────────────────────────
CREATE TABLE "cohort_analytics_snapshots" (
    "id"                 SERIAL NOT NULL,
    "organization_id"    INTEGER NOT NULL,
    "snapshot_date"      DATE NOT NULL,
    "patient_count"      INTEGER NOT NULL,
    "severe_hypo_rate"   DECIMAL(7, 2) NOT NULL,
    "dka_incidence"      DECIMAL(7, 2) NOT NULL,
    "national_benchmark" JSONB NOT NULL,
    "stratification"     JSONB NOT NULL,
    "computed_at"        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cohort_analytics_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cohort_analytics_snapshots_patient_count_check"
        CHECK ("patient_count" >= 0)
);
CREATE UNIQUE INDEX "cohort_analytics_snapshots_organization_id_snapshot_date_key"
    ON "cohort_analytics_snapshots"("organization_id", "snapshot_date");
CREATE INDEX "cohort_analytics_snapshots_snapshot_date_idx"
    ON "cohort_analytics_snapshots"("snapshot_date");

ALTER TABLE "cohort_analytics_snapshots"
    ADD CONSTRAINT "cohort_analytics_snapshots_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "healthcare_services"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- US-2229 — patient_risk_scores
-- ─────────────────────────────────────────────────────────────
CREATE TABLE "patient_risk_scores" (
    "id"                   SERIAL NOT NULL,
    "patient_id"           INTEGER NOT NULL,
    "risk_score"           SMALLINT NOT NULL,
    "risk_level"           "risk_level" NOT NULL,
    "recent_hypo_count"    INTEGER NOT NULL,
    "declaration_ratio"    DECIMAL(4, 2) NOT NULL,
    "dka_history"          BOOLEAN NOT NULL DEFAULT false,
    "contributing_factors" JSONB NOT NULL,
    "flagged_at"           TIMESTAMPTZ,
    "acknowledged_by"      INTEGER,
    "acknowledged_at"      TIMESTAMPTZ,
    "computed_at"          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_risk_scores_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "patient_risk_scores_score_bounds"
        CHECK ("risk_score" BETWEEN 0 AND 100),
    CONSTRAINT "patient_risk_scores_ratio_bounds"
        CHECK ("declaration_ratio" BETWEEN 0 AND 9.99)
);
CREATE UNIQUE INDEX "patient_risk_scores_patient_id_key"
    ON "patient_risk_scores"("patient_id");
CREATE INDEX "patient_risk_scores_risk_level_computed_at_idx"
    ON "patient_risk_scores"("risk_level", "computed_at");

ALTER TABLE "patient_risk_scores"
    ADD CONSTRAINT "patient_risk_scores_patient_id_fkey"
        FOREIGN KEY ("patient_id") REFERENCES "patients"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "patient_risk_scores_acknowledged_by_fkey"
        FOREIGN KEY ("acknowledged_by") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
