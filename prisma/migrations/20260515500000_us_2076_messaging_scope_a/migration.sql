-- US-2076 scope A — Messagerie sécurisée 1↔1 patient↔PS / staff↔staff.
--
-- Scope V1 : REST + polling 60s badge + FCM data-only push.
-- Scope B (WS/SSE realtime) reporté V2 sous US-2076bis.
--
-- Modèle :
--   - 1 table `messages` avec corps chiffré AES-256-GCM (bytea).
--   - `conversation_key` = SHA-256 hex 64 chars (canonical hash des
--     2 userIds triés ASC). Permet fetch thread sans JOIN.
--   - `patient_id` nullable = pivot US-2268 pour forensique
--     "messages liés au patient X" via index dédié.
--   - Soft-delete via `deleted_at` (RGPD Art. 17, trigger non-impacté).
--   - FK fromUser/toUser CASCADE : suppression user → purge messages
--     (audit log immuable conserve la trace).
--   - FK patient SET NULL : suppression patient → message subsiste
--     (rare cas staff↔staff discutant ancien patient archivé).

-- ─────────────────────────────────────────────────────────────
-- 1. Table messages
-- ─────────────────────────────────────────────────────────────

CREATE TABLE "messages" (
    "id"               TEXT          NOT NULL,
    "conversation_key" VARCHAR(64)   NOT NULL,
    "from_user_id"     INTEGER       NOT NULL,
    "to_user_id"       INTEGER       NOT NULL,
    "body_encrypted"   BYTEA         NOT NULL,
    "patient_id"       INTEGER,
    "read_at"          TIMESTAMPTZ,
    "created_at"       TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at"       TIMESTAMPTZ,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────────────────────────────────────────
-- 2. Foreign keys
-- ─────────────────────────────────────────────────────────────

ALTER TABLE "messages"
    ADD CONSTRAINT "messages_from_user_id_fkey"
        FOREIGN KEY ("from_user_id") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "messages"
    ADD CONSTRAINT "messages_to_user_id_fkey"
        FOREIGN KEY ("to_user_id") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "messages"
    ADD CONSTRAINT "messages_patient_id_fkey"
        FOREIGN KEY ("patient_id") REFERENCES "patients"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- 3. CHECK constraints (bornes anti-coquille)
-- ─────────────────────────────────────────────────────────────

-- Pas d'auto-message (from ≠ to). Évite que canMessage permette
-- accidentellement une conversation self↔self qui aurait
-- `conversation_key = hash(uid:uid)` cohérent mais sans valeur.
ALTER TABLE "messages"
    ADD CONSTRAINT "messages_no_self_message_check"
    CHECK ("from_user_id" <> "to_user_id") NOT VALID;
ALTER TABLE "messages" VALIDATE CONSTRAINT "messages_no_self_message_check";

-- conversation_key = exactement 64 caractères hex (SHA-256 hex).
-- Empêche un caller buggé d'insérer une clé arbitraire (anti-collision
-- accidentelle entre threads).
ALTER TABLE "messages"
    ADD CONSTRAINT "messages_conversation_key_hex_check"
    CHECK ("conversation_key" ~ '^[a-f0-9]{64}$') NOT VALID;
ALTER TABLE "messages" VALIDATE CONSTRAINT "messages_conversation_key_hex_check";

-- Cap soft sur body_encrypted (4000 chars plaintext × ~1.5 base64
-- expansion + IV+TAG ≈ 6100 bytes après chiffrement). Cap 8KB
-- préventif anti-DoS DB (cohérent avec validation Zod 4000 chars).
ALTER TABLE "messages"
    ADD CONSTRAINT "messages_body_encrypted_size_check"
    CHECK (OCTET_LENGTH("body_encrypted") <= 8192) NOT VALID;
ALTER TABLE "messages" VALIDATE CONSTRAINT "messages_body_encrypted_size_check";

-- ─────────────────────────────────────────────────────────────
-- 4. Indexes
-- ─────────────────────────────────────────────────────────────

-- Unread count badge + inbox tri.
-- Query : SELECT count(*) WHERE to_user_id = $me AND read_at IS NULL
--                          AND deleted_at IS NULL.
-- Inclut created_at pour le tri inbox sans seconde lookup.
CREATE INDEX "messages_to_user_id_read_at_created_at_idx"
    ON "messages"("to_user_id", "read_at", "created_at");

-- Fetch thread paginé par cursor.
-- Query : SELECT * WHERE conversation_key = $key
--                  AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50.
CREATE INDEX "messages_conversation_key_created_at_idx"
    ON "messages"("conversation_key", "created_at" DESC);

-- Pivot US-2268 — forensique "tous les messages liés au patient X".
-- Partial : `WHERE patient_id IS NOT NULL` réduit la taille (la
-- majorité des messages staff↔staff sans patient resterait NULL).
CREATE INDEX "messages_patient_id_idx"
    ON "messages"("patient_id")
    WHERE "patient_id" IS NOT NULL;

-- FK from_user_id : messages envoyés par un user (forensique).
CREATE INDEX "messages_from_user_id_idx"
    ON "messages"("from_user_id");

-- Soft-delete filter rapide.
CREATE INDEX "messages_deleted_at_idx"
    ON "messages"("deleted_at")
    WHERE "deleted_at" IS NOT NULL;

COMMENT ON TABLE "messages" IS
    'US-2076 scope A — Messagerie sécurisée 1↔1. Corps chiffré AES-256-GCM. Soft-delete RGPD.';
COMMENT ON COLUMN "messages"."conversation_key" IS
    'SHA-256(min(uid1,uid2)+":"+max(uid1,uid2)) hex 64. Canonique.';
COMMENT ON COLUMN "messages"."body_encrypted" IS
    'AES-256-GCM IV(12)+TAG(16)+CIPHERTEXT. JAMAIS de plaintext.';
COMMENT ON COLUMN "messages"."patient_id" IS
    'US-2268 pivot — Patient.id si message contextualise un patient.';
