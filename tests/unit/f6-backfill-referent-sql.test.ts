/**
 * Garde anti-régression du backfill F6 (US-2618).
 *
 * La bascule de l'enforcement clinique (service → médecin référent) exige que
 * tout patient déjà suivi ait un `PatientReferent` (sinon invisible à son
 * médecin). On vérifie statiquement que la migration de backfill est présente,
 * idempotente (NOT EXISTS + ON CONFLICT), et data-only (aucune DDL).
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

const MIGRATION = "prisma/migrations/20260617180000_f6_backfill_patient_referent/migration.sql"

describe("F6 — backfill PatientReferent (migration)", () => {
  const sql = readFileSync(MIGRATION, "utf8")

  it("insère les référents manquants depuis PatientService.member_id", () => {
    expect(sql).toContain('INSERT INTO "patient_referent"')
    expect(sql).toContain('FROM "patient_services"')
    expect(sql).toContain('ps."member_id" IS NOT NULL')
  })

  it("idempotent : NOT EXISTS + ON CONFLICT DO NOTHING + DISTINCT ON", () => {
    expect(sql).toMatch(/NOT EXISTS[\s\S]*patient_referent/)
    expect(sql).toContain('ON CONFLICT ("patient_id") DO NOTHING')
    expect(sql).toContain('DISTINCT ON (ps."patient_id")')
  })

  it("data-only : aucune DDL (pas de CREATE/ALTER/DROP TABLE)", () => {
    expect(sql).not.toMatch(/\b(CREATE|ALTER|DROP)\s+TABLE\b/i)
  })
})
