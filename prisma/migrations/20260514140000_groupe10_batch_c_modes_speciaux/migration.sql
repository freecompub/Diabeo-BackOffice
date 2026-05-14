-- Groupe 10 Batch C — Modes spéciaux (US-2233 pédiatrique, US-2234 Ramadan, US-2235 voyage)
--
-- Stratégie : étendre l'enum ConfigVersionType avec 3 nouvelles valeurs
-- (pediatric_mode, ramadan_mode, travel_mode) — les modes utilisent le hub
-- ConfigVersion (PR #395) pour versioning + audit immutability.
--
-- Le mode pédiatrique nécessite des PHI (nom, téléphone aidants) qu'on
-- isole dans une table dédiée `pediatric_caregivers` (chiffrement
-- AES-256-GCM dans nameEncrypted/phoneEncrypted). Ramadan et voyage n'ont
-- pas de PHI : leurs données sont dans `config_versions.config_snapshot`.

-- 1. Extend ConfigVersionType enum (3 valeurs).
ALTER TYPE config_version_type ADD VALUE IF NOT EXISTS 'pediatric_mode';
ALTER TYPE config_version_type ADD VALUE IF NOT EXISTS 'ramadan_mode';
ALTER TYPE config_version_type ADD VALUE IF NOT EXISTS 'travel_mode';

-- 2. Table pediatric_caregivers (PHI chiffrée).
CREATE TABLE "pediatric_caregivers" (
    "id"              SERIAL NOT NULL,
    "patient_id"      INTEGER NOT NULL,
    "version_id"      INTEGER NOT NULL,
    "rank"            INTEGER NOT NULL,
    "name_encrypted"  TEXT NOT NULL,
    "phone_encrypted" TEXT NOT NULL,
    "relationship"    VARCHAR(50) NOT NULL,
    "permission_level" VARCHAR(20) NOT NULL,
    "is_active"       BOOLEAN NOT NULL DEFAULT true,
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pediatric_caregivers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pediatric_caregivers_patient_id_rank_is_active_idx"
    ON "pediatric_caregivers" ("patient_id", "rank", "is_active");

-- M4 (healthcare audit) — index FK so cascade-include joins from
-- ConfigVersion don't sequential-scan at scale.
CREATE INDEX "pediatric_caregivers_version_id_idx"
    ON "pediatric_caregivers" ("version_id");

ALTER TABLE "pediatric_caregivers"
    ADD CONSTRAINT "pediatric_caregivers_patient_id_fkey"
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pediatric_caregivers"
    ADD CONSTRAINT "pediatric_caregivers_version_id_fkey"
    FOREIGN KEY ("version_id") REFERENCES "config_versions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Check constraints : permission_level (3 valeurs) + rank 1..5.
ALTER TABLE "pediatric_caregivers"
    ADD CONSTRAINT "pediatric_caregivers_permission_level_check"
    CHECK ("permission_level" IN ('read', 'write', 'config'));

ALTER TABLE "pediatric_caregivers"
    ADD CONSTRAINT "pediatric_caregivers_rank_check"
    CHECK ("rank" BETWEEN 1 AND 5);
