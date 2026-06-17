/**
 * Garde anti-régression du backfill du socle d'accès (PR1).
 *
 * La migration `20260617120000_access_foundations_pr1` est **additive** et doit
 * **peupler sans perte** : 1 tenant par service existant + 1 appartenance miroir
 * par membre. On vérifie statiquement que le backfill est présent et correct
 * (notamment le garde-fou booléen `manager_id IS NOT NULL` qui évite un NULL sur
 * la colonne NOT NULL `can_manage`) — pour qu'un futur édit ne le casse pas.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

const MIGRATION = "prisma/migrations/20260617120000_access_foundations_pr1/migration.sql"

describe("access foundations PR1 — migration additive + backfill", () => {
  const sql = readFileSync(MIGRATION, "utf8")

  it("crée les tables du socle (additif)", () => {
    for (const t of [
      'CREATE TABLE "tenants"',
      'CREATE TABLE "verification_policies"',
      'CREATE TABLE "healthcare_memberships"',
      'CREATE TABLE "professional_registrations"',
    ]) expect(sql).toContain(t)
    // Colonnes de scope d'audit (F8) + lien tenant (F2).
    expect(sql).toContain('ALTER TABLE "audit_logs" ADD COLUMN')
    expect(sql).toContain('"tenant_id"')
    expect(sql).toContain('ALTER TABLE "healthcare_services" ADD COLUMN     "tenant_id"')
  })

  it("backfill 1 tenant par service + lien tenant_id (idempotent)", () => {
    expect(sql).toContain('INSERT INTO "tenants"')
    expect(sql).toContain('WHERE "tenant_id" IS NULL') // idempotent
    expect(sql).toContain('UPDATE "healthcare_services" SET "tenant_id"')
  })

  it("backfill appartenance miroir avec garde-fou booléen + ON CONFLICT", () => {
    expect(sql).toContain('INSERT INTO "healthcare_memberships"')
    // Garde-fou : manager_id NULL ne doit pas produire un NULL sur can_manage (NOT NULL).
    expect(sql).toContain('hs."manager_id" IS NOT NULL AND hs."manager_id" = hm."user_id"')
    // Ré-exécution sûre.
    expect(sql).toContain('ON CONFLICT ("user_id", "service_id") DO NOTHING')
  })
})
