-- Renommage du niveau de maturité `EXPERT` → `CONFIRME` (libellé « Confirmé »).
-- `ALTER TYPE ... RENAME VALUE` (PostgreSQL 10+) : NON destructif — les lignes existantes
-- (`patients.maturity_level = 'EXPERT'`) sont renommées en place, aucune perte de donnée, pas de
-- réécriture de table. Idempotent au replay via le tracking `_prisma_migrations`.
ALTER TYPE "MaturityLevel" RENAME VALUE 'EXPERT' TO 'CONFIRME';
