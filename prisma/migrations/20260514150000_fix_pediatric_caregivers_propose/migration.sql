-- Re-review C1 (PR #396 post-merge) — Fix CHECK constraint that still
-- carries the pre-rename value `'config'`. The TS/Zod/tests layer was
-- renamed to `'propose'` (medical H1 — HAS pédiatrique / ISPAD 2022 :
-- caregivers may only propose, never directly mutate) but this CHECK
-- was missed. Without this migration, every `PUT /api/patient/modes/pediatric`
-- crashes at runtime with PostgreSQL `23514 check_violation`.
--
-- H3 (re-review) — also add UNIQUE constraint on (version_id, rank) to
-- enforce MAX_CAREGIVERS=5 at the DB layer (rank ∈ [1..5] + UNIQUE pair
-- ⇒ max 5 caregivers per version). Defense in depth against a buggy or
-- compromised caller bypassing the service-level validator.

ALTER TABLE "pediatric_caregivers"
    DROP CONSTRAINT "pediatric_caregivers_permission_level_check";

ALTER TABLE "pediatric_caregivers"
    ADD CONSTRAINT "pediatric_caregivers_permission_level_check"
    CHECK ("permission_level" IN ('read', 'write', 'propose'));

ALTER TABLE "pediatric_caregivers"
    ADD CONSTRAINT "pediatric_caregivers_version_id_rank_key"
    UNIQUE ("version_id", "rank");
