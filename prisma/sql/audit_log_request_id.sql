-- Migration: AuditLog.request_id (HDS §IV.3 — correlation)
--
-- Adds a nullable column + index so audit rows can be joined with stderr
-- log lines carrying the same correlation ID (middleware x-request-id).
--
-- Apply AFTER updating src/ code and BEFORE running `prisma db push` in prod.
-- Safe on a live DB: the column is nullable, the index is built concurrently.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS request_id VARCHAR(64);

COMMIT;

-- Index built OUTSIDE the transaction to allow CONCURRENTLY on a large table.
-- Prisma's shadow DB won't see this as an issue because the column already exists.
CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_logs_request_id_idx
  ON audit_logs (request_id);
