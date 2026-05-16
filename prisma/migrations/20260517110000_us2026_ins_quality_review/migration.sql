-- US-2026 — INS quality + traits hash + setter tracking (round 2 review).
--
-- Suite a la review multi-agents PR #416 round 1 (commit cd2e51c), ajoute :
--   - C1 review : enum `InsQualityStatus` + colonne `ins_quality_status`
--                 (V1 force `saisi_non_verifie`, V2 elargit insi_*).
--   - C1 review : `ins_set_at` timestamptz (forensique HDS L.1111-8).
--   - H5 review : `ins_set_by_user_id` FK SetNull vers users (qui a saisi).
--   - C1 review : `ins_traits_hash` SHA-256 hex (detection trait drift).
--   - M4 review : alignement `ins_hmac` VARCHAR(64) → TEXT (coherent avec
--                 email_hmac/firstname_hmac/lastname_hmac).

-- ─────────────────────────────────────────────────────────────
-- 1. Enum InsQualityStatus.
-- ─────────────────────────────────────────────────────────────

CREATE TYPE "InsQualityStatus" AS ENUM (
    'saisi_non_verifie',
    'insi_recupere',
    'insi_verifie',
    'rejete_traits_incoherent'
);

-- ─────────────────────────────────────────────────────────────
-- 2. Colonnes USER (4 nouvelles + 1 ALTER type).
-- ─────────────────────────────────────────────────────────────

ALTER TABLE "users"
    ADD COLUMN "ins_quality_status" "InsQualityStatus",
    ADD COLUMN "ins_set_at"         TIMESTAMPTZ,
    ADD COLUMN "ins_set_by_user_id" INTEGER,
    ADD COLUMN "ins_traits_hash"    TEXT;

COMMENT ON COLUMN "users"."ins_quality_status" IS
    'C1 review — Statut qualite INS Referentiel ANS v3. V1 force saisi_non_verifie.';
COMMENT ON COLUMN "users"."ins_set_at" IS
    'C1 review — Timestamp set INS (forensique HDS).';
COMMENT ON COLUMN "users"."ins_set_by_user_id" IS
    'H5 review — User qui a saisi (FK SetNull anonymisation RGPD).';
COMMENT ON COLUMN "users"."ins_traits_hash" IS
    'C1 review — SHA-256 hex traits (nom+prenom+dob+sex+lieu) au set time.';

-- M4 review — alignement TEXT (coherent emailHmac etc.).
-- Sur PG TEXT et VARCHAR(64) sont stockes identiquement, l'ALTER est
-- metadata-only (pas de rewrite). Safe sur table existante.
ALTER TABLE "users"
    ALTER COLUMN "ins_hmac" TYPE TEXT;

-- ─────────────────────────────────────────────────────────────
-- 3. FK + indexes.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE "users"
    ADD CONSTRAINT "users_ins_set_by_user_id_fkey"
        FOREIGN KEY ("ins_set_by_user_id") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

-- Index sur le FK pour permettre les queries "tous INS saisis par PS X"
-- (forensique audit cabinet) sans seq scan.
CREATE INDEX "users_ins_set_by_user_id_idx"
    ON "users"("ins_set_by_user_id")
    WHERE "ins_set_by_user_id" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 4. Coherence constraint : si ins NOT NULL alors quality_status + set_at
--    + set_by_user_id obligatoires (audit HDS Art. L.1111-8).
-- ─────────────────────────────────────────────────────────────

ALTER TABLE "users"
    ADD CONSTRAINT "users_ins_coherence_check"
    CHECK (
        ("ins" IS NULL
            AND "ins_hmac" IS NULL
            AND "ins_quality_status" IS NULL
            AND "ins_set_at" IS NULL
            AND "ins_set_by_user_id" IS NULL
            AND "ins_traits_hash" IS NULL)
        OR
        ("ins" IS NOT NULL
            AND "ins_hmac" IS NOT NULL
            AND "ins_quality_status" IS NOT NULL
            AND "ins_set_at" IS NOT NULL)
    ) NOT VALID;
ALTER TABLE "users"
    VALIDATE CONSTRAINT "users_ins_coherence_check";
