-- Groupe 8 i18n & Interopérabilité Batch 1 (4 US, 6 SP)
--  * US-2113 Devises EUR/DZD
--  * US-2114 Règles fiscales par pays
--  * US-2116 Réglementation santé par pays
--  * US-2123 HL7 FHIR R4 export

-- ─────────────────────────────────────────────────────────────
-- US-2113 — country_currencies
-- ─────────────────────────────────────────────────────────────
CREATE TABLE "country_currencies" (
    "id"            SERIAL NOT NULL,
    "country_code"  CHAR(2) NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "symbol"        VARCHAR(8) NOT NULL,
    "exchange_rate" DECIMAL(12, 6) NOT NULL,
    "is_active"     BOOLEAN NOT NULL DEFAULT true,
    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMPTZ NOT NULL,
    "created_by"    INTEGER,

    CONSTRAINT "country_currencies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "country_currencies_country_code_check"
        CHECK ("country_code" ~ '^[A-Z]{2}$'),
    CONSTRAINT "country_currencies_currency_code_check"
        CHECK ("currency_code" ~ '^[A-Z]{3}$'),
    CONSTRAINT "country_currencies_exchange_rate_check"
        CHECK ("exchange_rate" > 0)
);
CREATE UNIQUE INDEX "country_currencies_country_code_currency_code_key"
    ON "country_currencies"("country_code", "currency_code");
CREATE INDEX "country_currencies_country_code_is_active_idx"
    ON "country_currencies"("country_code", "is_active");

ALTER TABLE "country_currencies"
    ADD CONSTRAINT "country_currencies_created_by_fkey"
        FOREIGN KEY ("created_by") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- US-2114 — country_tax_rules
-- ─────────────────────────────────────────────────────────────
CREATE TABLE "country_tax_rules" (
    "id"             SERIAL NOT NULL,
    "country_code"   CHAR(2) NOT NULL,
    "tax_type"       VARCHAR(30) NOT NULL,
    "base_rate"      DECIMAL(6, 4) NOT NULL,
    "description"    VARCHAR(500),
    "applies_from"   DATE NOT NULL,
    "applies_until"  DATE,
    "is_active"      BOOLEAN NOT NULL DEFAULT true,
    "created_at"     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMPTZ NOT NULL,
    "created_by"     INTEGER,

    CONSTRAINT "country_tax_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "country_tax_rules_country_code_check"
        CHECK ("country_code" ~ '^[A-Z]{2}$'),
    CONSTRAINT "country_tax_rules_base_rate_check"
        CHECK ("base_rate" >= 0 AND "base_rate" <= 1),
    CONSTRAINT "country_tax_rules_range_check"
        CHECK ("applies_until" IS NULL OR "applies_until" > "applies_from")
);
CREATE UNIQUE INDEX "country_tax_rules_country_code_tax_type_applies_from_key"
    ON "country_tax_rules"("country_code", "tax_type", "applies_from");
CREATE INDEX "country_tax_rules_country_code_tax_type_is_active_idx"
    ON "country_tax_rules"("country_code", "tax_type", "is_active");

ALTER TABLE "country_tax_rules"
    ADD CONSTRAINT "country_tax_rules_created_by_fkey"
        FOREIGN KEY ("created_by") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- US-2116 — healthcare_regulations
-- ─────────────────────────────────────────────────────────────
CREATE TABLE "healthcare_regulations" (
    "id"               SERIAL NOT NULL,
    "country_code"     CHAR(2) NOT NULL,
    "regulation_type"  VARCHAR(50) NOT NULL,
    "title"            VARCHAR(200) NOT NULL,
    "rule"             TEXT NOT NULL,
    "references"       TEXT,
    "enforced_from"    DATE NOT NULL,
    "enforced_until"   DATE,
    "is_active"        BOOLEAN NOT NULL DEFAULT true,
    "created_at"       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMPTZ NOT NULL,
    "created_by"       INTEGER,

    CONSTRAINT "healthcare_regulations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "healthcare_regulations_country_code_check"
        CHECK ("country_code" ~ '^[A-Z]{2}$'),
    CONSTRAINT "healthcare_regulations_range_check"
        CHECK ("enforced_until" IS NULL OR "enforced_until" > "enforced_from")
);
CREATE INDEX "healthcare_regulations_country_code_regulation_type_is_acti_idx"
    ON "healthcare_regulations"("country_code", "regulation_type", "is_active");

ALTER TABLE "healthcare_regulations"
    ADD CONSTRAINT "healthcare_regulations_created_by_fkey"
        FOREIGN KEY ("created_by") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- US-2123 (H5) — FHIR allowed-systems registry
-- RGPD Art. 28 / HDS Art. 4 : un destinataire ne peut recevoir des
-- données de santé qu'après signature d'un Data Processing Agreement.
-- Cette table en est la source de vérité. `kill_switch_active=true`
-- arrête immédiatement toute transmission.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE "fhir_allowed_systems" (
    "id"                 SERIAL NOT NULL,
    "origin"             VARCHAR(255) NOT NULL,
    "label"              VARCHAR(200) NOT NULL,
    "dpa_reference"      VARCHAR(500) NOT NULL,
    "is_active"          BOOLEAN NOT NULL DEFAULT true,
    "kill_switch_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at"         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMPTZ NOT NULL,
    "created_by"         INTEGER,

    CONSTRAINT "fhir_allowed_systems_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fhir_allowed_systems_origin_https_check"
        CHECK ("origin" ~ '^https://[a-z0-9.-]+(:\d+)?$')
);
CREATE UNIQUE INDEX "fhir_allowed_systems_origin_key"
    ON "fhir_allowed_systems"("origin");
CREATE INDEX "fhir_allowed_systems_is_active_kill_switch_active_idx"
    ON "fhir_allowed_systems"("is_active", "kill_switch_active");

ALTER TABLE "fhir_allowed_systems"
    ADD CONSTRAINT "fhir_allowed_systems_created_by_fkey"
        FOREIGN KEY ("created_by") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- US-2123 — FHIR interoperability + sync log
-- ─────────────────────────────────────────────────────────────
CREATE TYPE "fhir_sync_status" AS ENUM ('pending', 'synced', 'failed', 'stale');

CREATE TABLE "fhir_interoperability" (
    "id"                  SERIAL NOT NULL,
    "patient_id"          INTEGER,
    "resource_type"       VARCHAR(50) NOT NULL,
    "external_system_url" VARCHAR(500) NOT NULL,
    "fhir_resource_id"    VARCHAR(255),
    "payload_encrypted"   TEXT NOT NULL,
    "sync_status"         "fhir_sync_status" NOT NULL DEFAULT 'pending',
    "retry_count"         INTEGER NOT NULL DEFAULT 0,
    "next_retry_at"       TIMESTAMPTZ,
    "last_synced_at"      TIMESTAMPTZ,
    "created_at"          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMPTZ NOT NULL,
    "created_by"          INTEGER,

    CONSTRAINT "fhir_interoperability_pkey" PRIMARY KEY ("id"),
    -- Defense-in-depth cap on encrypted payload (FHIR JSON can be large
    -- but a single resource > 1 MB is suspicious — flag for review).
    CONSTRAINT "fhir_interoperability_payload_length_check"
        CHECK (octet_length("payload_encrypted") <= 2097152), -- 2 MB
    -- M8 — Aligned with service-layer MAX_RETRIES=5 ; raising one must update both.
    CONSTRAINT "fhir_interoperability_retry_count_check"
        CHECK ("retry_count" >= 0 AND "retry_count" <= 5),
    -- H1 — HDS: PHI must NEVER travel unencrypted over http://. https:// only.
    CONSTRAINT "fhir_interoperability_external_url_check"
        CHECK ("external_system_url" ~ '^https://')
);
CREATE INDEX "fhir_interoperability_status_retry_idx"
    ON "fhir_interoperability"("sync_status", "next_retry_at");
CREATE INDEX "fhir_interoperability_patient_id_resource_type_idx"
    ON "fhir_interoperability"("patient_id", "resource_type");
CREATE INDEX "fhir_interoperability_resource_type_external_system_url_idx"
    ON "fhir_interoperability"("resource_type", "external_system_url");

-- H2 — SetNull (not Cascade) so the audit-trail of PHI exports survives
-- a patient hard-delete. CNIL/ANS require traceability of every PHI
-- transmission to a third-party for the legal retention period, even if
-- the patient record is later anonymised.
ALTER TABLE "fhir_interoperability"
    ADD CONSTRAINT "fhir_interoperability_patient_id_fkey"
        FOREIGN KEY ("patient_id") REFERENCES "patients"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "fhir_interoperability_created_by_fkey"
        FOREIGN KEY ("created_by") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "fhir_sync_logs" (
    "id"            SERIAL NOT NULL,
    "interop_id"    INTEGER NOT NULL,
    "action"        VARCHAR(30) NOT NULL,
    "http_status"   INTEGER,
    "error_message" TEXT,
    "duration_ms"   INTEGER,
    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fhir_sync_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "fhir_sync_logs_interop_id_created_at_idx"
    ON "fhir_sync_logs"("interop_id", "created_at");

ALTER TABLE "fhir_sync_logs"
    ADD CONSTRAINT "fhir_sync_logs_interop_id_fkey"
        FOREIGN KEY ("interop_id") REFERENCES "fhir_interoperability"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
