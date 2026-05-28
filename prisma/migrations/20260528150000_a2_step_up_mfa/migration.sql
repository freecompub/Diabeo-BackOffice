-- Plan B follow-up A2 — Step-up MFA freshness timestamp.
--
-- Ajoute `Session.mfa_last_verified_at` (nullable timestamptz). Bumped à chaque
-- MFA challenge (login OU step-up). `requireFreshMfa` helper exige que ce
-- timestamp soit < STEP_UP_WINDOW_SECONDS (5min default) pour les actions
-- sensibles ADMIN.
--
-- Migration zero-downtime :
--  - ADD COLUMN nullable (pas de write lock long sur sessions).
--  - Pas d'index (queries triviales par PK Session).
--  - Backfill non requis : NULL = "jamais MFA-verified" (interprétation par
--    `requireFreshMfa` = forcer step-up sur les sessions actuelles).
--
-- Rollback : ALTER TABLE sessions DROP COLUMN mfa_last_verified_at.
-- Aucune perte de données (le bump est ré-acquérable via step-up).

ALTER TABLE "sessions" ADD COLUMN "mfa_last_verified_at" TIMESTAMPTZ;
