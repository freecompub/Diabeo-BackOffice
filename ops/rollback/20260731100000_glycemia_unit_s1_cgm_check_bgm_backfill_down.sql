-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK (down) de la migration 20260731100000_glycemia_unit_s1_cgm_check_bgm_backfill
-- (ADR #32). Script inverse manuel (Prisma ne rollback pas automatiquement).
--
-- La migration S1 était ADDITIVE : (a) backfill glycemia_gl depuis glycemia_mgdl,
-- (b) ajout du CHECK de bornes CGM. Ce down retire le CHECK. Le backfill (b)
-- n'est PAS annulé : il n'existe aucun marqueur des lignes backfillées, et une
-- valeur g/L correcte laissée en place est inoffensive (données enrichies, pas
-- corrompues). Ne PAS tenter de re-NULLer glycemia_gl (perte d'info + on ne
-- sait pas distinguer backfill vs saisie native).
--
-- Usage :
--   psql "$DATABASE_URL" -f ops/rollback/20260731100000_glycemia_unit_s1_cgm_check_bgm_backfill_down.sql
--   pnpm prisma migrate resolve --rolled-back 20260731100000_glycemia_unit_s1_cgm_check_bgm_backfill
-- ⚠️ Si la migration S4 a déjà été appliquée, appliquer d'ABORD son down
--    (restaure glycemia_mgdl) — l'ordre inverse du deploy.
-- ═══════════════════════════════════════════════════════════════════════════

-- Retirer le CHECK de bornes CGM ajouté par S1.
ALTER TABLE "cgm_entries" DROP CONSTRAINT IF EXISTS "cgm_entries_value_gl_bounds";
