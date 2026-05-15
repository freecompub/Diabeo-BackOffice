-- Groupe 9 — Admin & Ops (US-2007 / US-2137)
--
-- US-2007 : enrichit Session avec createdAt / ipAddress / userAgent /
--   lastSeenAt pour la vue "Sessions multiples" UI.
-- US-2137 : nouveau model DataBreach + 2 enums (severity, status)
--   pour le registre des violations RGPD Art. 33.

-- ─────────────────────────────────────────────────────────────
-- 1. Session enrichissement (US-2007)
-- ─────────────────────────────────────────────────────────────

ALTER TABLE "sessions"
    ADD COLUMN "created_at"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "ip_address"   VARCHAR(45),
    ADD COLUMN "user_agent"   VARCHAR(500),
    ADD COLUMN "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "sessions_user_id_created_at_idx"
    ON "sessions"("user_id", "created_at" DESC);

-- ─────────────────────────────────────────────────────────────
-- 2. Enums DataBreach (US-2137)
-- ─────────────────────────────────────────────────────────────

CREATE TYPE "data_breach_severity" AS ENUM ('low', 'medium', 'high', 'critical');

CREATE TYPE "data_breach_status" AS ENUM (
    'draft', 'under_assessment', 'notified_cnil', 'notified_users', 'closed'
);

-- ─────────────────────────────────────────────────────────────
-- 3. Table data_breaches (US-2137)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE "data_breaches" (
    "id"                    SERIAL                  NOT NULL,
    "severity"              "data_breach_severity"  NOT NULL,
    "status"                "data_breach_status"    NOT NULL DEFAULT 'draft',
    "title"                 VARCHAR(200)            NOT NULL,
    "description_enc"       TEXT,
    "remediation_enc"       TEXT,
    "cnil_case_number_enc"  TEXT,
    "users_notified_count"  INTEGER                 NOT NULL DEFAULT 0,
    "detected_at"           TIMESTAMPTZ             NOT NULL,
    "declared_by"           INTEGER,
    "cnil_notified_at"      TIMESTAMPTZ,
    "users_notified_at"     TIMESTAMPTZ,
    "closed_at"             TIMESTAMPTZ,
    "created_at"            TIMESTAMPTZ             NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMPTZ             NOT NULL,

    CONSTRAINT "data_breaches_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "data_breaches"
    ADD CONSTRAINT "data_breaches_declared_by_fkey"
    FOREIGN KEY ("declared_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CHECK : `users_notified_count` non négatif.
ALTER TABLE "data_breaches"
    ADD CONSTRAINT "data_breaches_users_notified_nonneg_chk"
    CHECK ("users_notified_count" >= 0) NOT VALID;

ALTER TABLE "data_breaches"
    VALIDATE CONSTRAINT "data_breaches_users_notified_nonneg_chk";

CREATE INDEX "data_breaches_status_severity_detected_at_idx"
    ON "data_breaches"("status", "severity", "detected_at" DESC);

CREATE INDEX "data_breaches_detected_at_idx"
    ON "data_breaches"("detected_at" DESC);

CREATE INDEX "data_breaches_declared_by_idx"
    ON "data_breaches"("declared_by");
