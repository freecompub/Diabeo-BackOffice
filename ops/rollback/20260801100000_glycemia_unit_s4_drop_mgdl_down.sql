-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK (down) de la migration 20260801100000_glycemia_unit_s4_drop_mgdl
-- (ADR #32). Prisma ne fournit PAS de rollback auto — script inverse manuel.
--
-- ⚠️ La migration S4 est DESTRUCTIVE (DROP COLUMN glycemia_mgdl) : les valeurs
-- mg/dL d'origine ont été perdues au DROP. Ce down-script RESTAURE la colonne et
-- la REPEUPLE de façon DÉRIVÉE depuis l'unité canonique g/L (mg/dL = g/L × 100).
-- La valeur clinique est préservée (conversion sans perte 1 g/L = 100 mg/dL) ;
-- seuls d'éventuels arrondis d'origine < 0,01 mg/dL ne sont pas restitués à
-- l'identique. Acceptable (une entrée BGM mg/dL est un entier en pratique).
--
-- Usage :
--   psql "$DATABASE_URL" -f ops/rollback/20260801100000_glycemia_unit_s4_drop_mgdl_down.sql
--   pnpm prisma migrate resolve --rolled-back 20260801100000_glycemia_unit_s4_drop_mgdl
-- ⚠️ Rollbacker ce down SANS le down S1 laisse le CHECK CGM en place (voulu :
--    ils sont indépendants). Pour un rollback complet, appliquer AUSSI le down S1.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Restaurer la colonne mg/dL (même type qu'avant : Decimal(6,2), nullable).
ALTER TABLE "glycemia_entries" ADD COLUMN IF NOT EXISTS "glycemia_mgdl" DECIMAL(6,2);

-- 2) Repeupler depuis g/L (dérivé, sans perte). Seules les lignes portant une
--    glycémie (glycemia_gl non-null) reçoivent une valeur mg/dL ; les entrées
--    sans glycémie (poids/HbA1c seuls) restent NULL, comme à l'origine.
UPDATE "glycemia_entries"
SET "glycemia_mgdl" = round("glycemia_gl" * 100.0, 2)
WHERE "glycemia_gl" IS NOT NULL
  AND "glycemia_mgdl" IS NULL;

-- 3) Retirer le CHECK BGM ajouté par S4.
ALTER TABLE "glycemia_entries" DROP CONSTRAINT IF EXISTS "glycemia_entries_glycemia_gl_bounds";

-- NB : après ce rollback, remettre AUSSI le code applicatif sur la version
-- pré-#753 (schéma Prisma avec glycemiaMgdl, services lisant les 2 colonnes) —
-- sinon le client ignore glycemia_mgdl (grouped-only g/L). Le rollback DB seul
-- ne suffit pas ; coordonner avec un rollback de déploiement du code.
