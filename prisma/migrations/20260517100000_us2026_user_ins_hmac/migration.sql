-- US-2026 — INS (Identité Nationale Santé) — lookup HMAC anti-doublon.
--
-- Le champ `User.ins` est déjà présent (String? chiffré base64 AES-256-GCM).
-- Cette migration ajoute la colonne HMAC-SHA256 dérivée du plaintext INS
-- pour permettre un lookup UNIQUE rapide sans déchiffrer.
--
-- Pourquoi HMAC plutôt que ciphertext direct ?
--   - Le ciphertext AES-256-GCM est non-déterministe (IV aléatoire) → 2 chif-
--     frements du même plaintext produisent des bytes différents → impossible
--     à indexer pour unicité.
--   - HMAC-SHA256(ins, HMAC_SECRET) est déterministe + unidirectionnel.
--   - Clé HMAC_SECRET déjà partagée avec `emailHmac` (sera utilisée pour
--     éviter de multiplier les secrets ; rotation gérée par runbook).
--
-- Garantie clinique : un INS = un User (cf. RNIPP français, INS = identifiant
-- national unique). L'UNIQUE PARTIAL (WHERE NOT NULL) autorise les Users
-- sans INS (PS, comptes ADMIN) sans contraindre.

ALTER TABLE "users"
    ADD COLUMN "ins_hmac" VARCHAR(64);

COMMENT ON COLUMN "users"."ins_hmac" IS
    'US-2026 — HMAC-SHA256 hex de User.ins plaintext. Lookup anti-doublon RNIPP. NULL si pas d''INS renseigné.';

-- UNIQUE : PG 16 default NULLS DISTINCT autorise plusieurs NULL (PS, ADMIN
-- sans INS renseigne) mais contraint chaque INS plaintext a apparaitre au
-- plus une fois (anti-doublon RNIPP). Pas de WHERE NOT NULL (eviterait
-- l'alignement avec `@@unique([insHmac])` Prisma drift check CI).
CREATE UNIQUE INDEX "users_ins_hmac_key"
    ON "users"("ins_hmac");
