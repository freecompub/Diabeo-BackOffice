-- Groupe 4 — Devices & Sync follow-up (round 2 review)
--
-- Suite à la review multi-agents PR #415 round 1 (5490edd), ajoute :
--   - CR H2 : CHECK coherence enforce revoked_reason_enc NOT NULL.
--   - HSA M1 : `patient_devices.created_at` (tri non-déterministe sinon).
--   - HSA M2 : `revoked_reason_enc` VARCHAR(1024) cap (anti payload DoS).
--   - CR L4 / HSA L3 : `supported_devices.model_identifier` partial unique.
--   - CR L8 : trigger `set_updated_at` sur `supported_devices`.
--
-- Zero-downtime : `NOT VALID + VALIDATE` pour le CHECK + `ALTER COLUMN TYPE`
-- VARCHAR(1024) safe car colonne TEXT vide actuellement (US-2092 jamais
-- pousée en prod — PR encore ouverte).

-- ─────────────────────────────────────────────────────────────
-- 1. CR H2 — CHECK coherence : enforce revoked_reason_enc NOT NULL.
-- ─────────────────────────────────────────────────────────────
-- L'ancienne contrainte permettait `revoked_at NOT NULL AND revoked_by
-- NOT NULL AND revoked_reason_enc NULL` (raison perdue → audit incomplet).
-- HDS § Art. L.1111-8 exige la traçabilité du motif de révocation.

ALTER TABLE "patient_devices"
    DROP CONSTRAINT IF EXISTS "patient_devices_revoked_coherence_check";

ALTER TABLE "patient_devices"
    ADD CONSTRAINT "patient_devices_revoked_coherence_check"
    CHECK (
        ("revoked_at" IS NULL
            AND "revoked_by" IS NULL
            AND "revoked_reason_enc" IS NULL)
        OR
        ("revoked_at" IS NOT NULL
            AND "revoked_by" IS NOT NULL
            AND "revoked_reason_enc" IS NOT NULL)
    ) NOT VALID;
ALTER TABLE "patient_devices"
    VALIDATE CONSTRAINT "patient_devices_revoked_coherence_check";

-- ─────────────────────────────────────────────────────────────
-- 2. HSA M1 — `patient_devices.created_at` pour tri déterministe.
-- ─────────────────────────────────────────────────────────────
-- `date` est nullable (`PatientDevice.date` ≠ création — date pairing).
-- Le tri history ORDER BY date DESC NULLS LAST + id DESC marche mais
-- mélange les vrais "date pairing" avec les fallbacks id-only. Audit
-- forensique RGPD/HDS doit être chronologique. `created_at` garantit
-- la séquence d'insertion (immuable, NOT NULL).

ALTER TABLE "patient_devices"
    ADD COLUMN "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

COMMENT ON COLUMN "patient_devices"."created_at" IS
    'HSA M1 review — Date de création immutable. Tri history déterministe.';

-- Index pour history listing (remplace patient_devices_history_idx
-- éventuellement, mais garde l'ancien pour compat — Prisma le mappe).
CREATE INDEX "patient_devices_patient_created_idx"
    ON "patient_devices"("patient_id", "created_at" DESC);

-- ─────────────────────────────────────────────────────────────
-- 3. HSA M2 — VARCHAR(1024) cap revoked_reason_enc (anti DoS).
-- ─────────────────────────────────────────────────────────────
-- Bornes applicatives Zod = 500 chars plaintext. Avec ciphertext base64
-- (IV 12 + TAG 16 + len*1.34) → ~700 bytes max. VARCHAR(1024) = marge.
-- Sans cap, attaquant authentifié peut bourrer la colonne TEXT (1GB max
-- PG) → bloat + index page cost.

ALTER TABLE "patient_devices"
    ALTER COLUMN "revoked_reason_enc" TYPE VARCHAR(1024);

-- ─────────────────────────────────────────────────────────────
-- 4. CR L4 / HSA L3 — `supported_devices.model_identifier` unique.
-- ─────────────────────────────────────────────────────────────
-- USB VID:PID ou BLE UUID = identifiant matériel global. Doit être unique
-- quand renseigné (anti-doublons). PG défaut NULLS DISTINCT autorise
-- multiples NULL (legacy devices sans identifier).

CREATE UNIQUE INDEX "supported_devices_model_identifier_key"
    ON "supported_devices"("model_identifier");

-- ─────────────────────────────────────────────────────────────
-- 5. CR L8 — Trigger set_updated_at sur supported_devices.
-- ─────────────────────────────────────────────────────────────
-- Prisma `@updatedAt` met à jour `updated_at` côté JS uniquement.
-- Si un ADMIN/MIGRATION fait un UPDATE direct SQL, la colonne stagne.
-- Trigger DB garantit la fraîcheur (audit forensique RGPD Art. 5.1.d).

CREATE OR REPLACE FUNCTION supported_devices_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "supported_devices_set_updated_at_trigger"
    BEFORE UPDATE ON "supported_devices"
    FOR EACH ROW
    EXECUTE FUNCTION supported_devices_set_updated_at();
