-- Migration: AverageData.period_type String → PeriodType enum
--
-- Apply AFTER updating src/ code and BEFORE running `prisma db push` in prod.
-- Prisma 7 with an enum will try to ALTER COLUMN TYPE via implicit cast which
-- fails on VARCHAR → custom type — this script performs the cast explicitly.
--
-- Existing column values 'current', '7d', '30d' are preserved via @map in
-- schema.prisma, so no data transformation is required.
--
-- Safe to run multiple times (IF NOT EXISTS on type creation + conditional
-- column alter).

BEGIN;

-- Fail fast instead of stalling the app: an ALTER COLUMN TYPE on a large
-- average_data table could queue writes behind an ACCESS EXCLUSIVE lock.
-- Operators should retry off-peak if this trips; do not paper over with a
-- longer timeout in CI without explicit review.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 1. Create the enum type if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PeriodType') THEN
    CREATE TYPE "PeriodType" AS ENUM ('current', '7d', '30d');
  END IF;
END
$$;

-- 2. Drop the unique constraint that depends on the column (rebuilt after cast)
ALTER TABLE average_data DROP CONSTRAINT IF EXISTS average_data_patient_id_period_type_meal_type_key;

-- 3. Convert the column type. Existing values are valid enum literals.
ALTER TABLE average_data
  ALTER COLUMN period_type TYPE "PeriodType"
  USING period_type::text::"PeriodType";

-- 4. Recreate the unique index with the new column type
CREATE UNIQUE INDEX IF NOT EXISTS average_data_patient_id_period_type_meal_type_key
  ON average_data (patient_id, period_type, meal_type);

COMMIT;
