-- US-2022 — Patient tags (catégorisation libre par cabinet).

CREATE TABLE "patient_tags" (
  "id"         SERIAL PRIMARY KEY,
  "service_id" INTEGER NOT NULL,
  "label"      VARCHAR(50) NOT NULL,
  "color"      VARCHAR(7)  NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "created_by" INTEGER,
  CONSTRAINT "patient_tags_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "healthcare_services"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "patient_tags_service_id_label_key" ON "patient_tags" ("service_id", "label");
CREATE INDEX "patient_tags_service_id_idx" ON "patient_tags" ("service_id");

CREATE TABLE "patient_tag_assignments" (
  "id"          SERIAL PRIMARY KEY,
  "patient_id"  INTEGER NOT NULL,
  "tag_id"      INTEGER NOT NULL,
  "assigned_by" INTEGER,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "patient_tag_assignments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE,
  CONSTRAINT "patient_tag_assignments_tag_id_fkey"     FOREIGN KEY ("tag_id")     REFERENCES "patient_tags"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "patient_tag_assignments_patient_id_tag_id_key" ON "patient_tag_assignments" ("patient_id", "tag_id");
CREATE INDEX "patient_tag_assignments_patient_id_idx" ON "patient_tag_assignments" ("patient_id");
CREATE INDEX "patient_tag_assignments_tag_id_idx"     ON "patient_tag_assignments" ("tag_id");
