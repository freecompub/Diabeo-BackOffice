-- Migration: MFA hardening — replay protection + session provenance
--
-- Apply AFTER updating src/ code and BEFORE running `prisma db push` in prod.
-- Both columns are nullable / defaulted so existing rows remain valid.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Replay guard: last accepted TOTP step (RFC 6238 T counter). Rejects reuse
-- of a code within its validity window (±1 step = up to 60 s).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_last_used_step INTEGER;

-- HDS forensics: did this session go through the second factor, or just the
-- password? Default false — existing sessions are assumed password-only.
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS mfa_verified BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
