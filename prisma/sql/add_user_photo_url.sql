-- Migration: add photo_url column to User table
-- Apply before prisma db push in production
-- Usage: psql $DATABASE_URL < prisma/sql/add_user_photo_url.sql

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "photo_url" VARCHAR(500);
