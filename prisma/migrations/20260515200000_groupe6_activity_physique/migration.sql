-- Groupe 6 Batch 1 — Activité physique (US-2059 / 2060 / 2061)
--
-- Étend `diabetes_events` avec des champs riches pour le tracking
-- d'activité physique : intensité, steps, distance, calories, heart
-- rate moyen, source (manual / healthkit / google_fit / health_connect)
-- et `external_sync_id` pour dédupliquer les bulk-pushes mobiles.

-- ─────────────────────────────────────────────────────────────
-- 1. Enums
-- ─────────────────────────────────────────────────────────────

CREATE TYPE "activity_intensity" AS ENUM ('light', 'moderate', 'intense');

CREATE TYPE "activity_source" AS ENUM ('manual', 'healthkit', 'google_fit', 'health_connect');

-- ─────────────────────────────────────────────────────────────
-- 2. Colonnes diabetes_events
-- ─────────────────────────────────────────────────────────────

ALTER TABLE "diabetes_events"
    ADD COLUMN "activity_intensity"      "activity_intensity",
    ADD COLUMN "activity_steps"          INTEGER,
    ADD COLUMN "activity_distance_m"     INTEGER,
    ADD COLUMN "activity_calories"       INTEGER,
    ADD COLUMN "activity_heart_rate_avg" INTEGER,
    ADD COLUMN "activity_source"         "activity_source" DEFAULT 'manual',
    ADD COLUMN "external_sync_id"        VARCHAR(128);

-- ─────────────────────────────────────────────────────────────
-- 3. CHECK constraints (bornes anti-coquille)
-- ─────────────────────────────────────────────────────────────

ALTER TABLE "diabetes_events"
    ADD CONSTRAINT "diabetes_events_activity_steps_chk"
    CHECK ("activity_steps" IS NULL OR ("activity_steps" >= 0 AND "activity_steps" <= 200000)),
    ADD CONSTRAINT "diabetes_events_activity_distance_chk"
    CHECK ("activity_distance_m" IS NULL OR ("activity_distance_m" >= 0 AND "activity_distance_m" <= 1000000)),
    ADD CONSTRAINT "diabetes_events_activity_calories_chk"
    CHECK ("activity_calories" IS NULL OR ("activity_calories" >= 0 AND "activity_calories" <= 50000)),
    ADD CONSTRAINT "diabetes_events_activity_hr_chk"
    CHECK ("activity_heart_rate_avg" IS NULL OR ("activity_heart_rate_avg" BETWEEN 30 AND 250)),
    ADD CONSTRAINT "diabetes_events_activity_duration_chk"
    CHECK ("activity_duration" IS NULL OR ("activity_duration" >= 0 AND "activity_duration" <= 1440));

-- ─────────────────────────────────────────────────────────────
-- 4. Indexes
-- ─────────────────────────────────────────────────────────────

-- Index composite pour le lookup dedup (activitySource, externalSyncId).
CREATE INDEX "diabetes_events_activity_source_external_sync_id_idx"
    ON "diabetes_events"("activity_source", "external_sync_id");

-- UNIQUE partial : empêche le double-push d'un même sample mobile, mais
-- autorise plusieurs entries `manual` sans externalSyncId.
CREATE UNIQUE INDEX "diabetes_events_activity_dedup_uniq"
    ON "diabetes_events"("activity_source", "external_sync_id")
    WHERE "external_sync_id" IS NOT NULL;
