-- Plan B follow-up A3 round 2 (HSA HIGH-4) — Index GIN partial pour forensique
-- sur les rows coalescées.
--
-- Le runbook §5 propose des queries forensiques :
--   SELECT ..., metadata->'coalesced'->>'count' AS occurrences
--   FROM audit_logs
--   WHERE metadata->'coalesced' IS NOT NULL
--     AND user_id = ?
--     AND created_at > NOW() - INTERVAL '7 days'
--
-- Sans index, le filtre `metadata->'coalesced' IS NOT NULL` est un seqscan
-- sur audit_logs (10M+ rows en V1 projetée).
--
-- L'index GIN partial avec opclass `jsonb_path_ops` est :
--   - 30% plus compact que `jsonb_ops` (US-2268 référence)
--   - Optimisé pour `@>` (containment) — pattern dominant des queries forensiques
--   - Partial WHERE → couvre uniquement les rows coalescées (gain stockage ~95%
--     si l'adoption coalescing reste minoritaire vs auditService.log direct)
--
-- CONCURRENTLY : pas de lock long sur audit_logs (table à fort I/O).
-- Migration zero-downtime PG 11+.
--
-- ⚠️ Prisma 7 NE supporte PAS `CREATE INDEX CONCURRENTLY` dans une migration
-- déclarative — la commande doit être exécutée SEULE (pas de transaction).
-- Le fichier prisma migrate deploy l'exécute hors-TX par défaut, mais valider
-- en pre-prod via `psql -c "BEGIN; SELECT 1; ROLLBACK;"` qu'aucune TX implicite
-- n'enveloppe le script.
--
-- Rollback : DROP INDEX CONCURRENTLY audit_logs_metadata_coalesced_gin_idx.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_logs_metadata_coalesced_gin_idx"
  ON "audit_logs" USING GIN ((metadata) jsonb_path_ops)
  WHERE metadata ? 'coalesced';
