-- US-2026 — INS round 3 review (post `46d188d` 3-agent re-review).
--
-- Ajoute :
--   - H1 review : index partiel sur audit_logs pour la query rate-limit
--                 (collision count par auditUserId sur 24h sliding window).
--   - L6/Prisma F-2 review : commentaire migration round 2 corrige
--                            (set_by_user_id pas dans CHECK all-set branch
--                            par design FK SetNull).

-- ─────────────────────────────────────────────────────────────
-- H1 review — Index partiel pour `assertNotRateLimited`.
-- ─────────────────────────────────────────────────────────────
-- Sans cet index, la query Prisma :
--   audit_logs.count({
--     where: { userId, resource: "USER_INS", action: "UNAUTHORIZED",
--              createdAt: { gte: since },
--              metadata: { path: ["kind"], equals: "user.ins.collision" } }
--   })
-- emet en SQL :
--   SELECT count(*) FROM audit_logs
--   WHERE user_id = $1 AND resource = 'USER_INS' AND action = 'UNAUTHORIZED'
--     AND created_at >= $2
--     AND metadata->>'kind' = 'user.ins.collision'
--
-- L'index @@index([userId, createdAt]) existant est utilisable mais
-- `resource` + `action` + le check JSONB sont des recheck post-index.
-- A scale (6 ans retention HDS x 50k users x ~5 audit/jour = ~500M rows),
-- on veut un index partiel ultra-selectif sur le sous-ensemble "INS
-- collision events" (cardinality faible — collision = anomalie).
--
-- Note `@>` containment + `jsonb_path_ops` est plus efficient que `->>`
-- text comparison sur les query Prisma path/equals (Prisma 7 emet `@>`
-- pour ce shape). L'index utilise donc `metadata @> jsonb`.

CREATE INDEX "audit_logs_ins_collision_by_user_idx"
    ON "audit_logs" ("user_id", "created_at" DESC)
    WHERE "resource" = 'USER_INS'
      AND "action" = 'UNAUTHORIZED'
      AND metadata @> '{"kind":"user.ins.collision"}';

COMMENT ON INDEX "audit_logs_ins_collision_by_user_idx" IS
    'US-2026 H1 round 3 — Rate-limit query (5 collisions/24h/auditUserId). '
    'Tiny partial index (collision = anomalie rare).';

-- ─────────────────────────────────────────────────────────────
-- Note Prisma F-2 round 3 : aucune modification SQL — le CHECK
-- coherence `users_ins_coherence_check` est volontairement asymetrique
-- (n'enforce PAS ins_set_by_user_id + ins_traits_hash dans le all-set
-- branch) car :
--   - ins_set_by_user_id : FK SetNull → null possible post-anonymisation
--                          PS qui a saisi (sans casser la coherence).
--   - ins_traits_hash : detection drift, peut etre null si pas recalcule
--                       (set d'urgence par script admin sans traits).
-- Commentaire migration round 2 a ete trompeur — corrige dans le DPIA.
