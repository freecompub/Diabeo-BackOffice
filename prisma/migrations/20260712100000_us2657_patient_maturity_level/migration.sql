-- US-2657 (slice A) — Niveau de maturité (autonomie) du patient.
-- Additif, non destructif : nouvel enum + colonne NOT NULL DEFAULT 'JUNIOR' (backfill implicite du défaut
-- pour tous les patients existants → démarrage au niveau le plus restrictif).
CREATE TYPE "MaturityLevel" AS ENUM ('JUNIOR', 'INTERMEDIATE', 'EXPERT');

ALTER TABLE "patients" ADD COLUMN "maturity_level" "MaturityLevel" NOT NULL DEFAULT 'JUNIOR';
