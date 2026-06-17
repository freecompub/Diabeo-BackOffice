-- ═══════════════════════════════════════════════════════════════
-- Socle « Accès & Cabinet » — PR1 (F2 + F4 + F8), ADDITIF
-- ═══════════════════════════════════════════════════════════════
-- US-2616 (F2) Tenant + politique de vérification · US-2617 (F4) appartenance
-- N-N + enregistrement PS · US-2620 (F8) scope d'audit.
-- 100 % additif : tables/colonnes nullables + index. AUCUN enforcement modifié
-- ici (canAccessPatient/isOrgMember/requireRole inchangés) → zéro régression
-- d'accès. La bascule d'enforcement se fait dans les PRs suivantes.
-- ═══════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "VerificationMode" AS ENUM ('required', 'provisional');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('unverified', 'verified', 'provisional');

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "scope_service_id" INTEGER,
ADD COLUMN     "tenant_id" INTEGER;

-- AlterTable
ALTER TABLE "healthcare_services" ADD COLUMN     "tenant_id" INTEGER;

-- CreateTable
CREATE TABLE "tenants" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "country" CHAR(2),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_policies" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER,
    "country" CHAR(2),
    "mode" "VerificationMode" NOT NULL,
    "expires_at" TIMESTAMPTZ,
    "set_by_id" INTEGER NOT NULL,
    "set_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "healthcare_memberships" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "service_id" INTEGER NOT NULL,
    "clinical_role" "Role",
    "can_manage" BOOLEAN NOT NULL DEFAULT false,
    "is_principal_admin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "healthcare_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "professional_registrations" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "country" CHAR(2) NOT NULL,
    "scheme" VARCHAR(40) NOT NULL,
    "number" VARCHAR(64),
    "method" VARCHAR(40) NOT NULL,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'unverified',
    "verified_by_id" INTEGER,
    "verified_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "professional_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenants_country_idx" ON "tenants"("country");

-- CreateIndex
CREATE INDEX "verification_policies_tenant_id_idx" ON "verification_policies"("tenant_id");

-- CreateIndex
CREATE INDEX "verification_policies_country_idx" ON "verification_policies"("country");

-- CreateIndex
CREATE INDEX "healthcare_memberships_service_id_idx" ON "healthcare_memberships"("service_id");

-- CreateIndex
CREATE UNIQUE INDEX "healthcare_memberships_user_id_service_id_key" ON "healthcare_memberships"("user_id", "service_id");

-- CreateIndex
CREATE INDEX "professional_registrations_user_id_idx" ON "professional_registrations"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "healthcare_services_tenant_id_idx" ON "healthcare_services"("tenant_id");

-- AddForeignKey
ALTER TABLE "healthcare_services" ADD CONSTRAINT "healthcare_services_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_policies" ADD CONSTRAINT "verification_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_policies" ADD CONSTRAINT "verification_policies_set_by_id_fkey" FOREIGN KEY ("set_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "healthcare_memberships" ADD CONSTRAINT "healthcare_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "healthcare_memberships" ADD CONSTRAINT "healthcare_memberships_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "healthcare_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_registrations" ADD CONSTRAINT "professional_registrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_registrations" ADD CONSTRAINT "professional_registrations_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════
-- Backfill (sans perte, comportement inchangé). Idempotent.
-- ═══════════════════════════════════════════════════════════════

-- (1) F2 — 1 tenant par service existant (self-tenant), lien tenant_id.
--     RETURNING + corrélation par ligne (le nom du service n'est pas unique seul).
DO $$
DECLARE
  r RECORD;
  new_tenant_id INTEGER;
BEGIN
  FOR r IN SELECT "id", "name", "country" FROM "healthcare_services" WHERE "tenant_id" IS NULL LOOP
    INSERT INTO "tenants" ("name", "country") VALUES (r."name", r."country") RETURNING "id" INTO new_tenant_id;
    UPDATE "healthcare_services" SET "tenant_id" = new_tenant_id WHERE "id" = r."id";
  END LOOP;
END $$;

-- (2) F4 — appartenance miroir depuis HealthcareMember (accès actuel implicite) :
--     clinical_role = User.role ; can_manage / is_principal_admin = manager du service.
--     ON CONFLICT : ré-exécution sûre (aucun doublon (user, service)).
INSERT INTO "healthcare_memberships" ("user_id", "service_id", "clinical_role", "can_manage", "is_principal_admin")
SELECT hm."user_id",
       hm."service_id",
       u."role",
       (hs."manager_id" IS NOT NULL AND hs."manager_id" = hm."user_id") AS can_manage,
       (hs."manager_id" IS NOT NULL AND hs."manager_id" = hm."user_id") AS is_principal_admin
FROM "healthcare_members" hm
JOIN "users" u ON u."id" = hm."user_id"
JOIN "healthcare_services" hs ON hs."id" = hm."service_id"
WHERE hm."user_id" IS NOT NULL AND hm."service_id" IS NOT NULL
ON CONFLICT ("user_id", "service_id") DO NOTHING;
