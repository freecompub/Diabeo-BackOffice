-- Groupe 5 — Insuline & Repas (5 US)
--  * US-2050 : insulin_adjustment_templates (cabinet-scoped)
--  * US-2053 : DiabetesEvent.validatedAt / validatedBy (validation soignant)
--  * US-2054 : food_items (CIQUAL ANSES référentiel)
--  * US-2057 : meal_photos (S3 references)

-- ─────────────────────────────────────────────────────────────
-- US-2053 — Validation soignant sur diabetes_events
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "diabetes_events" ADD COLUMN "validated_at" TIMESTAMPTZ;
ALTER TABLE "diabetes_events" ADD COLUMN "validated_by" INTEGER;

CREATE INDEX "diabetes_events_patient_id_validated_at_idx"
    ON "diabetes_events"("patient_id", "validated_at");

ALTER TABLE "diabetes_events" ADD CONSTRAINT "diabetes_events_validated_by_fkey"
    FOREIGN KEY ("validated_by") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- US-2050 — Insulin adjustment templates (cabinet-scoped)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE "insulin_adjustment_templates" (
    "id" SERIAL NOT NULL,
    "service_id" INTEGER NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "pathology" "Pathology",
    "parameter" VARCHAR(20) NOT NULL,
    "adjustments" JSONB NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "insulin_adjustment_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "insulin_adjustment_templates_service_id_title_key"
    ON "insulin_adjustment_templates"("service_id", "title");
CREATE INDEX "insulin_adjustment_templates_service_id_idx"
    ON "insulin_adjustment_templates"("service_id");

ALTER TABLE "insulin_adjustment_templates" ADD CONSTRAINT "insulin_adjustment_templates_service_id_fkey"
    FOREIGN KEY ("service_id") REFERENCES "healthcare_services"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "insulin_adjustment_templates" ADD CONSTRAINT "insulin_adjustment_templates_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- US-2054 — CIQUAL food items
-- ─────────────────────────────────────────────────────────────
CREATE TABLE "food_items" (
    "id" SERIAL NOT NULL,
    "ciqual_code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "name_hmac" CHAR(64) NOT NULL,
    "carbs_per_100g" DECIMAL(6, 2),
    "protein_per_100g" DECIMAL(6, 2),
    "fat_per_100g" DECIMAL(6, 2),
    "energy_kcal_100g" DECIMAL(6, 2),
    "category" VARCHAR(100),
    "source" VARCHAR(40) NOT NULL DEFAULT 'ciqual',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "food_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "food_items_ciqual_code_key" ON "food_items"("ciqual_code");
CREATE INDEX "food_items_name_hmac_idx" ON "food_items"("name_hmac");
CREATE INDEX "food_items_category_idx" ON "food_items"("category");

-- ─────────────────────────────────────────────────────────────
-- US-2057 — Meal photos (S3 references)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE "meal_photos" (
    "id" SERIAL NOT NULL,
    "event_id" TEXT NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "s3_key" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "uploaded_by" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_photos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "meal_photos_event_id_idx" ON "meal_photos"("event_id");
CREATE INDEX "meal_photos_patient_id_created_at_idx" ON "meal_photos"("patient_id", "created_at");

ALTER TABLE "meal_photos" ADD CONSTRAINT "meal_photos_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "diabetes_events"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meal_photos" ADD CONSTRAINT "meal_photos_uploaded_by_fkey"
    FOREIGN KEY ("uploaded_by") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
