-- ═══════════════════════════════════════════════════════════════
-- Normalisation unités glycémie (ADR #32) — slice S1
--   • pose enfin le CHECK de bornes CGM en migration VERSIONNÉE (sortie du drift
--     `prisma/sql/cgm_partitioning.sql`, jusqu'ici jamais appliqué par les migrations) ;
--   • consolide le stockage BGM sur `glycemia_gl` (unité canonique g/L) en dérivant
--     les lignes historiques mg/dL-only (`glycemia_gl` NULL & `glycemia_mgdl` présent).
--
-- ADDITIF & RÉVERSIBLE (aucune colonne supprimée ici — le DROP de `glycemia_mgdl`
-- et le CHECK BGM arrivent en S4). Écrit pour être **idempotent / rejouable** (backfill
-- gardé par `WHERE glycemia_gl IS NULL`, contrainte par `DROP IF EXISTS`) — sûr même
-- après une reprise partielle. Convention : 1 g/L = 100 mg/dL (jamais ×18).
-- ═══════════════════════════════════════════════════════════════

-- 1) Backfill BGM : dériver g/L depuis mg/dL pour les entrées historiques mg/dL-only.
--    Decimal(6,4) ← mg/dL / 100 (ex. 120 mg/dL → 1.2000 g/L). Idempotent (WHERE NULL).
UPDATE "glycemia_entries"
SET "glycemia_gl" = ROUND("glycemia_mgdl" / 100.0, 4)
WHERE "glycemia_gl" IS NULL
  AND "glycemia_mgdl" IS NOT NULL;

-- 2) CHECK de bornes CGM (g/L) — plage physiologiquement valide pour les agrégats
--    (CGM_AGGREGATE_RANGE_GL 0.20–6.00). Aligne le schéma versionné sur la référence
--    `cgm_partitioning.sql`. Pattern idempotent DROP IF EXISTS + ADD (cf. post_deploy_sql).
ALTER TABLE "cgm_entries" DROP CONSTRAINT IF EXISTS "cgm_entries_value_gl_bounds";
ALTER TABLE "cgm_entries" ADD CONSTRAINT "cgm_entries_value_gl_bounds"
  CHECK ("value_gl" >= 0.20 AND "value_gl" <= 6.00);
