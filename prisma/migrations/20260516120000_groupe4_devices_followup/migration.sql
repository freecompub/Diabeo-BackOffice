-- Groupe 4 — Devices & Sync follow-up (round 2 review)
--
-- Suite à la review multi-agents PR #415 round 1 (5490edd) et round 2
-- (b95e69c), ajoute :
--   - CR H2 : CHECK coherence enforce revoked_reason_enc NOT NULL.
--   - HSA M1 : `patient_devices.created_at` (tri non-déterministe sinon).
--   - HSA M2 : `revoked_reason_enc` VARCHAR(2816) cap UTF-8 safe (round 2).
--   - CR L4 / HSA L3 : `supported_devices.model_identifier` unique.
--   - CR L8 : trigger `set_updated_at` sur `supported_devices` (search_path
--             verrouillé, round 2 M2).
--   - H3 round 2 : backfill `created_at` historique pour préserver
--             chronologie réelle.
--
-- Zero-downtime : `NOT VALID + VALIDATE` pour le CHECK. `ADD COLUMN
-- DEFAULT CURRENT_TIMESTAMP` = fast-path metadata-only PG 11+ (CURRENT_
-- TIMESTAMP est STABLE pas VOLATILE — pas de rewrite). `ALTER COLUMN TYPE`
-- VARCHAR(2816) safe car colonne TEXT vide actuellement (US-2092 jamais
-- poussée en prod — PR encore ouverte).

-- ─────────────────────────────────────────────────────────────
-- 1. CR H2 — CHECK coherence : enforce revoked_reason_enc NOT NULL.
-- ─────────────────────────────────────────────────────────────
-- L'ancienne contrainte permettait `revoked_at NOT NULL AND revoked_by
-- NOT NULL AND revoked_reason_enc NULL` (raison perdue → audit incomplet).
-- HDS § Art. L.1111-8 exige la traçabilité du motif de révocation.
--
-- NOTE prod future : le DROP CONSTRAINT prend un AccessExclusiveLock bref
-- (microseconde, catalog-only). Acceptable car PR encore en dev/staging.
-- Sur table volumineuse en prod avec forte concurrence, prévoir une fenêtre
-- de maintenance courte.

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
--
-- PG 11+ fast-path : `ADD COLUMN ... DEFAULT CURRENT_TIMESTAMP` est
-- metadata-only (CURRENT_TIMESTAMP = STABLE, valeur capturée au moment
-- de l'ALTER). Pas de rewrite, pas de lock long.

ALTER TABLE "patient_devices"
    ADD COLUMN "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

COMMENT ON COLUMN "patient_devices"."created_at" IS
    'HSA M1 review — Date de création immutable. Tri history déterministe.';

-- H3 round 2 review — backfill historic rows.
-- Sans ce backfill, toutes les lignes pré-migration auraient `created_at`
-- = instant de la migration, tassant la chronologie réelle (forensique
-- RGPD Art. 5.1.d cassée pour le legacy). Le COALESCE prend `date` (date
-- de pairing initial) si présente, sinon une époque fallback. Le résultat
-- reste imparfait pour les rows sans `date`, mais préserve l'ordre relatif
-- via le rang d'insertion `id` (le tie-breaker stable du orderBy listHistory).
UPDATE "patient_devices"
SET "created_at" = COALESCE("date", TIMESTAMPTZ '2024-01-01 00:00:00+00')
WHERE "date" IS NOT NULL OR "id" < (SELECT COALESCE(MAX("id"), 0) FROM "patient_devices");

-- Index pour history listing (round 2 H1 : cursor pagination keyset valide
-- sur (created_at DESC, id DESC) — index couvrant les 2 colonnes du orderBy).
CREATE INDEX "patient_devices_patient_created_idx"
    ON "patient_devices"("patient_id", "created_at" DESC);

-- ─────────────────────────────────────────────────────────────
-- 3. HSA M2 + M1 round 2 — VARCHAR(2816) cap revoked_reason_enc UTF-8 safe.
-- ─────────────────────────────────────────────────────────────
-- Bornes applicatives Zod = 500 chars plaintext, mais UTF-8 multi-octets
-- (arabe US-2112 LocaleSwitcher, emojis) → jusqu'à 4 bytes par char =
-- 2000 bytes plaintext max. Ciphertext AES-256-GCM + base64 :
--   bytes_total = IV(12) + TAG(16) + ciphertext (~= plaintext bytes)
--                 = 2028 bytes binaire max
--   base64_chars = ceil(2028/3) * 4 = 2704 chars
-- VARCHAR(2816) = marge sécurité 4% sans risque de truncation silencieuse.
-- Cap applicatif Zod `Buffer.byteLength <= MAX_REASON_BYTES` = 500 bytes
-- (defense-in-depth, refus explicite avant DB).

ALTER TABLE "patient_devices"
    ALTER COLUMN "revoked_reason_enc" TYPE VARCHAR(2816);

-- ─────────────────────────────────────────────────────────────
-- 4. CR L4 / HSA L3 — `supported_devices.model_identifier` unique.
-- ─────────────────────────────────────────────────────────────
-- USB VID:PID ou BLE UUID = identifiant matériel global. Doit être unique
-- quand renseigné (anti-doublons).
--
-- PG 16 default: NULLS DISTINCT (multiple NULL allowed). Intentional pour
-- les legacy devices sans identifier — comportement standard PG (≠ certains
-- SGBD comme SQL Server qui font NULLS NOT DISTINCT par défaut).
-- Si à terme tous les devices doivent avoir un identifier, repasser à
-- `NULLS NOT DISTINCT` (PG 15+).

CREATE UNIQUE INDEX "supported_devices_model_identifier_key"
    ON "supported_devices"("model_identifier");

-- ─────────────────────────────────────────────────────────────
-- 5. CR L8 — Trigger set_updated_at sur supported_devices.
-- ─────────────────────────────────────────────────────────────
-- Prisma `@updatedAt` met à jour `updated_at` côté JS uniquement.
-- Si un ADMIN/MIGRATION fait un UPDATE direct SQL, la colonne stagne.
-- Trigger DB garantit la fraîcheur (audit forensique RGPD Art. 5.1.d).
--
-- M2 round 2 review (ANSSI RGS §4.5 / CWE-426) — `SET search_path =
-- pg_catalog, public` verrouille la résolution des objets de la fonction
-- pour empêcher un user créant un objet homonyme dans son search_path
-- de hijacker la résolution. Pattern documenté dans le projet (cf.
-- 20260508140000_post_deploy_sql/migration.sql US-2267 re-review A3).

CREATE OR REPLACE FUNCTION supported_devices_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "supported_devices_set_updated_at_trigger"
    BEFORE UPDATE ON "supported_devices"
    FOR EACH ROW
    EXECUTE FUNCTION supported_devices_set_updated_at();
