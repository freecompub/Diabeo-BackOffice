-- US-2076 scope A — Messagerie sécurisée 1↔1 patient↔PS / staff↔staff.
--
-- Scope V1 : REST + polling 60s badge + FCM data-only push.
-- Scope B (WS/SSE realtime) reporté V2 sous US-2076bis.
--
-- Modèle :
--   - 1 table `messages` avec corps chiffré AES-256-GCM (bytea natif PG).
--   - `conversation_key` = SHA-256 hex 64 chars (canonical hash des
--     2 userIds triés ASC). Permet fetch thread sans JOIN.
--   - `patient_id` nullable = pivot US-2268 pour forensique
--     "messages liés au patient X" via index dédié.
--   - Soft-delete via `deleted_at` (RGPD Art. 17, trigger non-impacté).
--   - FK fromUser/toUser RESTRICT (Prisma H3 / HSA MED-3 review round 3) :
--     la suppression user passe par `deletion.service.ts` qui anonymise
--     (UPDATE) + purge explicitement les messages. RESTRICT empêche
--     toute DELETE physique raw SQL accidentelle qui détruirait la
--     correspondance légitime de la contrepartie (jurisprudence CNIL :
--     droit du destinataire à conserver SA correspondance ≠ effacement
--     de A).
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

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id"),

    -- CHECK constraints inline (table neuve → pattern direct au lieu de
    -- NOT VALID + VALIDATE qui est conçu pour tables existantes).
    -- Prisma M1 review round 3.

    -- Pas d'auto-message (from ≠ to). Évite conversation self↔self.
    CONSTRAINT "messages_no_self_message_check"
        CHECK ("from_user_id" <> "to_user_id"),

    -- conversation_key = exactement 64 caractères hex (SHA-256).
    CONSTRAINT "messages_conversation_key_hex_check"
        CHECK ("conversation_key" ~ '^[a-f0-9]{64}$'),

    -- Cap dur sur body_encrypted (BYTEA natif PG, pas de base64
    -- expansion — Prisma L1 review round 3).
    -- AES-GCM = stream cipher (pas de padding) :
    --   ciphertext_bytes = plaintext_utf8_bytes + IV(12) + TAG(16)
    -- MAX_BODY_BYTES_UTF8 = 8164 (cap service en octets UTF-8)
    -- Donc ciphertext ≤ 8164 + 28 = 8192 octets.
    -- BLOCKER #1 fix : cap aligné sur MAX_BODY_BYTES_UTF8 côté service
    -- qui valide en octets, pas en codepoints (4000 emoji × 4 = 16 KB
    -- aurait violé le CHECK avant ce fix).
    CONSTRAINT "messages_body_encrypted_size_check"
        CHECK (OCTET_LENGTH("body_encrypted") <= 8192)
);

-- ─────────────────────────────────────────────────────────────
-- 2. Foreign keys
-- ─────────────────────────────────────────────────────────────

ALTER TABLE "messages"
    ADD CONSTRAINT "messages_from_user_id_fkey"
        FOREIGN KEY ("from_user_id") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "messages"
    ADD CONSTRAINT "messages_to_user_id_fkey"
        FOREIGN KEY ("to_user_id") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "messages"
    ADD CONSTRAINT "messages_patient_id_fkey"
        FOREIGN KEY ("patient_id") REFERENCES "patients"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- 3. Indexes
-- ─────────────────────────────────────────────────────────────

-- Unread count badge + inbox tri.
-- Query : SELECT count(*) WHERE to_user_id = $me AND read_at IS NULL
--                          AND deleted_at IS NULL.
CREATE INDEX "messages_to_user_id_read_at_created_at_idx"
    ON "messages"("to_user_id", "read_at", "created_at");

-- Prisma H1 review round 3 — Couvre le `groupBy` unread aggregate
-- de `listThreads` : SELECT conversation_key, count(*) WHERE
-- to_user_id = me AND conversation_key IN (...) AND read_at IS NULL
-- AND deleted_at IS NULL GROUP BY conversation_key.
-- Partial : taille réduite (~5% du total, fraction des messages non lus).
CREATE INDEX "messages_unread_groupby_idx"
    ON "messages"("to_user_id", "read_at", "conversation_key")
    WHERE "read_at" IS NULL AND "deleted_at" IS NULL;

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

-- NEW-H1 CR round 4 — Index composite pour DISTINCT ON listThreads.
-- Permet à PostgreSQL d'utiliser Index Skip Scan (PG 14+) ou Merge Append
-- pour le `DISTINCT ON (conversation_key) ... ORDER BY conversation_key,
-- created_at DESC` au lieu d'un Sort O(N log N) sur tous les messages
-- du user. Le partial `WHERE deleted_at IS NULL` réduit la taille.
CREATE INDEX "messages_from_thread_recency_idx"
    ON "messages"("from_user_id", "conversation_key", "created_at" DESC)
    WHERE "deleted_at" IS NULL;

CREATE INDEX "messages_to_thread_recency_idx"
    ON "messages"("to_user_id", "conversation_key", "created_at" DESC)
    WHERE "deleted_at" IS NULL;

-- Soft-delete filter rapide.
CREATE INDEX "messages_deleted_at_idx"
    ON "messages"("deleted_at")
    WHERE "deleted_at" IS NOT NULL;

COMMENT ON TABLE "messages" IS
    'US-2076 scope A — Messagerie sécurisée 1↔1. Corps chiffré AES-256-GCM. Soft-delete RGPD.';
COMMENT ON COLUMN "messages"."conversation_key" IS
    'SHA-256(min(uid1,uid2)+":"+max(uid1,uid2)) hex 64. Canonique.';
COMMENT ON COLUMN "messages"."body_encrypted" IS
    'AES-256-GCM IV(12)+TAG(16)+CIPHERTEXT bytea natif PG. JAMAIS de plaintext.';
COMMENT ON COLUMN "messages"."patient_id" IS
    'US-2268 pivot — Patient.id si message contextualise un patient.';
