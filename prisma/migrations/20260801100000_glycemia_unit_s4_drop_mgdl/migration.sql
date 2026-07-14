-- ═══════════════════════════════════════════════════════════════
-- Normalisation unités glycémie (ADR #32) — slice S4 (DESTRUCTIF)
--   • pose le CHECK de bornes BGM sur la colonne canonique `glycemia_gl` (g/L),
--     tolérant au NULL (la glycémie est une mesure OPTIONNELLE d'une entrée :
--     une saisie peut ne porter que poids / HbA1c / tension) ;
--   • SUPPRIME la colonne `glycemia_mgdl` (fin du double-stockage BGM).
--
-- Prérequis (S1) : `glycemia_gl` a été backfillé depuis `glycemia_mgdl` pour les
-- lignes mg/dL-only → aucune donnée glycémique perdue par le DROP.
-- Prérequis (S2) : plus aucun lecteur/écriveur ne référence `glycemia_mgdl`.
--
-- ⚠️ Étape IRRÉVERSIBLE (DROP COLUMN). Acceptable : backoffice PAS encore en
-- production (ADR #31) — aucune donnée patient réelle. Idempotent (IF EXISTS).
-- Convention : 1 g/L = 100 mg/dL.
-- ═══════════════════════════════════════════════════════════════

-- 1) CHECK de bornes BGM (g/L) sur la colonne canonique, NULL toléré (glycémie
--    optionnelle). Pattern idempotent DROP IF EXISTS + ADD.
ALTER TABLE "glycemia_entries" DROP CONSTRAINT IF EXISTS "glycemia_entries_glycemia_gl_bounds";
ALTER TABLE "glycemia_entries" ADD CONSTRAINT "glycemia_entries_glycemia_gl_bounds"
  CHECK ("glycemia_gl" IS NULL OR ("glycemia_gl" >= 0.20 AND "glycemia_gl" <= 6.00));

-- 2) Suppression de la colonne mg/dL (double-stockage). DESTRUCTIF, idempotent.
ALTER TABLE "glycemia_entries" DROP COLUMN IF EXISTS "glycemia_mgdl";
