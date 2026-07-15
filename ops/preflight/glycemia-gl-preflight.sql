-- ═══════════════════════════════════════════════════════════════════════════
-- PRÉ-VOL — Release « unités glycémie g/L canonique » (ADR #32, PR #753)
-- Migrations : 20260731100000 (S1, additif) + 20260801100000 (S4, DROP destructif)
--
-- À exécuter AVANT `prisma migrate deploy` sur une base contenant des données
-- (prod, ou recette non re-seedée). Objectif : détecter ce qui ferait ÉCHOUER
-- les `ADD CONSTRAINT CHECK` (la migration s'interrompt sur une seule ligne
-- hors-bornes) et mesurer l'ampleur du backfill / du DROP.
--
-- Usage :  psql "$DATABASE_URL" -f ops/preflight/glycemia-gl-preflight.sql
-- Lecture : toutes les lignes « *_bloquant » DOIVENT valoir 0 avant de migrer.
-- ═══════════════════════════════════════════════════════════════════════════

\echo '--- [1] CGM hors bornes (bloquant S1 : CHECK value_gl 0.20–6.00) ---'
SELECT count(*) AS cgm_hors_bornes_bloquant
FROM cgm_entries
WHERE value_gl < 0.20 OR value_gl > 6.00;

\echo '--- [2] BGM g/L hors bornes (bloquant S4 : CHECK glycemia_gl 0.20–6.00) ---'
SELECT count(*) AS bgm_gl_hors_bornes_bloquant
FROM glycemia_entries
WHERE glycemia_gl IS NOT NULL
  AND (glycemia_gl < 0.20 OR glycemia_gl > 6.00);

\echo '--- [3] BGM mg/dL-only : seront backfillées en g/L par S1 (informatif) ---'
SELECT count(*) AS bgm_mgdl_only_a_backfiller
FROM glycemia_entries
WHERE glycemia_gl IS NULL
  AND glycemia_mgdl IS NOT NULL;

\echo '--- [4] BGM mg/dL-only HORS bornes après conversion (bloquant S4 post-backfill) ---'
-- Une ligne mg/dL-only dont mg/dL/100 sort de [0.20,6.00] serait backfillée
-- en g/L hors bornes par S1, puis ferait échouer le CHECK S4.
SELECT count(*) AS bgm_mgdl_only_hors_bornes_bloquant
FROM glycemia_entries
WHERE glycemia_gl IS NULL
  AND glycemia_mgdl IS NOT NULL
  AND (round(glycemia_mgdl / 100.0, 4) < 0.20 OR round(glycemia_mgdl / 100.0, 4) > 6.00);

\echo '--- [5] Volume de la colonne supprimée par S4 (glycemia_mgdl non-null) ---'
SELECT count(*) AS bgm_mgdl_non_null_a_dropper
FROM glycemia_entries
WHERE glycemia_mgdl IS NOT NULL;

\echo '--- [6] État des migrations attendues comme NON encore appliquées ---'
SELECT migration_name, finished_at
FROM _prisma_migrations
WHERE migration_name IN (
  '20260731100000_glycemia_unit_s1_cgm_check_bgm_backfill',
  '20260801100000_glycemia_unit_s4_drop_mgdl'
)
ORDER BY migration_name;
-- Attendu : 0 ligne (migrations pas encore déployées). Si présentes → déjà appliquées.

-- ── REMÉDIATION si [1], [2] ou [4] > 0 ──────────────────────────────────────
-- Les valeurs hors [0.20,6.00] g/L sont non-physiologiques (< 20 ou > 600 mg/dL) :
-- soit des erreurs capteur/saisie, soit des extrêmes « LO/HI ». Décider AVANT deploy :
--   (a) purge ciblée (DELETE) des lignes hors bornes en recette, OU
--   (b) clamp aux bornes si cliniquement justifié (à valider medical), OU
--   (c) recette jetable → `prisma migrate reset` + `prisma db seed` (le seed
--       génère du CGM 0.40–4.00, dans les bornes) : chemin recommandé en recette.
