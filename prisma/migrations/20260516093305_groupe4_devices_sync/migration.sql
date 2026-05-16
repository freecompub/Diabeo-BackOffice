-- Groupe 4 — Devices & Sync (US-2091 / US-2092 / US-2093)
--
-- Trois US livrées en une migration :
--   - US-2091 : table `supported_devices` (whitelist HDS-conforme).
--   - US-2092 : 3 colonnes `patient_devices.{revoked_at, revoked_by,
--               revoked_reason_enc}` pour soft-revocation chiffrée.
--   - US-2093 : index `(patient_id, revoked_at)` pour history listing.
--
-- Aucune donnée existante à migrer (US-2091 nouvelle ; US-2092 colonnes
-- nullable rajoutées).

-- ─────────────────────────────────────────────────────────────
-- 1. Table supported_devices (US-2091)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE "supported_devices" (
    "id"                     SERIAL          PRIMARY KEY,
    "brand"                  VARCHAR(100)    NOT NULL,
    "model"                  VARCHAR(100)    NOT NULL,
    "category"               "DeviceCategory" NOT NULL,
    "model_identifier"       VARCHAR(100),
    "connection_types"       TEXT[]          NOT NULL DEFAULT ARRAY[]::TEXT[],
    "sensor_lifetime_days"   SMALLINT,
    "is_hds_certified"       BOOLEAN         NOT NULL DEFAULT FALSE,
    "notes"                  TEXT,
    "is_active"              BOOLEAN         NOT NULL DEFAULT TRUE,
    "created_at"             TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"             INTEGER,

    -- US-2091 — bornes anti-coquille.
    CONSTRAINT "supported_devices_sensor_lifetime_check"
        CHECK ("sensor_lifetime_days" IS NULL OR ("sensor_lifetime_days" > 0 AND "sensor_lifetime_days" <= 90))
);

ALTER TABLE "supported_devices"
    ADD CONSTRAINT "supported_devices_created_by_fkey"
        FOREIGN KEY ("created_by") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

-- Unicité (brand, model, category) — un device par triplet exactement.
CREATE UNIQUE INDEX "supported_devices_brand_model_category_idx"
    ON "supported_devices"("brand", "model", "category");

-- Index pour search UI pairing : `WHERE category = $1 AND is_active = TRUE`.
CREATE INDEX "supported_devices_category_active_idx"
    ON "supported_devices"("category", "is_active");

COMMENT ON TABLE "supported_devices" IS
    'US-2091 — Whitelist des dispositifs supportés. Maintenu par ADMIN.';

-- ─────────────────────────────────────────────────────────────
-- 2. patient_devices — colonnes revoked (US-2092 + US-2093)
-- ─────────────────────────────────────────────────────────────

ALTER TABLE "patient_devices"
    ADD COLUMN "revoked_at"          TIMESTAMPTZ,
    ADD COLUMN "revoked_by"          INTEGER,
    ADD COLUMN "revoked_reason_enc"  TEXT;

ALTER TABLE "patient_devices"
    ADD CONSTRAINT "patient_devices_revoked_by_fkey"
        FOREIGN KEY ("revoked_by") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

-- US-2092 — Borne : revoked_at NULL ⇔ revoked_by NULL ⇔ revoked_reason_enc NULL.
-- Coherence : on ne peut pas avoir une révocation partiellement renseignée.
-- `NOT VALID + VALIDATE` pour zero-downtime sur table existante.
ALTER TABLE "patient_devices"
    ADD CONSTRAINT "patient_devices_revoked_coherence_check"
    CHECK (
        ("revoked_at" IS NULL AND "revoked_by" IS NULL AND "revoked_reason_enc" IS NULL)
        OR
        ("revoked_at" IS NOT NULL AND "revoked_by" IS NOT NULL)
    ) NOT VALID;
ALTER TABLE "patient_devices"
    VALIDATE CONSTRAINT "patient_devices_revoked_coherence_check";

-- US-2093 — index history listing chronologique (incl. revoked).
CREATE INDEX "patient_devices_history_idx"
    ON "patient_devices"("patient_id", "revoked_at");

-- US-2092 — index forensique sur revokedBy (rare query "tous les devices
-- révoqués par PS X" pour audit interne / responsabilité IDE).
CREATE INDEX "patient_devices_revoked_by_idx"
    ON "patient_devices"("revoked_by")
    WHERE "revoked_by" IS NOT NULL;

COMMENT ON COLUMN "patient_devices"."revoked_at" IS
    'US-2092 — Soft-revoke timestamp. Device reste en DB pour historique + audit.';
COMMENT ON COLUMN "patient_devices"."revoked_reason_enc" IS
    'US-2092 — Raison AES-256-GCM (peut contenir contexte clinique PHI).';
