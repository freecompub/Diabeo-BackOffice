-- US-2619/F7 — Version d'authentification utilisateur (révocation immédiate des
-- droits). Additif : colonne NOT NULL avec DEFAULT 1 → metadata-only sur PG11+
-- (pas de réécriture de table), valeur 1 pour toutes les lignes existantes.
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "auth_version" INTEGER NOT NULL DEFAULT 1;
