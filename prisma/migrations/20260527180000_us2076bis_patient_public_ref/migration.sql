-- US-2076bis-V2 (Issue #442) — Opaque UUID for patient anonymisation UI.
--
-- Pattern : add column nullable + DEFAULT gen_random_uuid() → existing rows
-- get UUID via DEFAULT at backfill → ALTER COLUMN SET NOT NULL → UNIQUE.
-- Zero-downtime safe : existing reads/writes ne sont pas affectés (la colonne
-- est ajoutée optional puis remplie immédiatement).
--
-- Rationale anti-énumération : `patient.id` séquentiel autoincrement laisse
-- inférer ordre d'inscription cabinet (timing oracle ANSSI / RGPD Art. 5.1.f).
-- `public_ref` UUID v4 (122 bits entropy) élimine ce vector.
--
-- Le `patient_id` BDD reste l'identifiant interne pour toutes les FK +
-- audit pivot US-2268 — jamais exposé client UI.

-- Étape 1 — Add column avec DEFAULT (existing rows get auto-generated UUID).
-- pgcrypto extension fournit gen_random_uuid() (déjà loaded — utilisé par autres
-- tables).
ALTER TABLE "patients" ADD COLUMN "public_ref" UUID DEFAULT gen_random_uuid();

-- Étape 2 — Backfill explicite des rows existants (defense-in-depth : si une
-- row a été créée avant le DEFAULT pour une raison quelconque).
UPDATE "patients" SET "public_ref" = gen_random_uuid() WHERE "public_ref" IS NULL;

-- Étape 3 — SET NOT NULL maintenant que toutes les rows ont une valeur.
ALTER TABLE "patients" ALTER COLUMN "public_ref" SET NOT NULL;

-- Étape 4 — UNIQUE constraint (empêche collision UUID v4 + permet lookup
-- `publicRef → patientId` interne via index B-tree).
CREATE UNIQUE INDEX "patients_public_ref_key" ON "patients"("public_ref");
