-- Migration: add firstname_hmac and lastname_hmac columns to User table
-- Apply before prisma db push in production
-- Usage: psql $DATABASE_URL < prisma/sql/add_user_hmac_fields.sql

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "firstname_hmac" VARCHAR(64);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastname_hmac" VARCHAR(64);
CREATE INDEX IF NOT EXISTS "users_firstname_hmac_lastname_hmac_idx" ON "users" ("firstname_hmac", "lastname_hmac");
