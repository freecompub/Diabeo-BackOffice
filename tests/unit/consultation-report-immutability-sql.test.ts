/**
 * Garde anti-régression du trigger d'immuabilité du compte rendu (US-2605).
 *
 * Le trigger PG `consultation_report_addenda_immutable` est la garantie HDS
 * d'append-only (aucun UPDATE sauf soft-delete `deleted_at`, aucun DELETE). On
 * vérifie ici, statiquement, qu'il est bien présent DANS LA MIGRATION (source de
 * vérité appliquée en prod) et dans la copie de référence — pour qu'un futur
 * refactor du schéma ne le perde pas silencieusement.
 *
 * (L'enforcement réel a été vérifié en base : `pg_trigger` contient le trigger ;
 * la suite ne dispose pas de PG live pour exercer le RAISE EXCEPTION.)
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

const MIGRATION = "prisma/migrations/20260616160000_us2605_encounter_report/migration.sql"
const REFERENCE = "prisma/sql/consultation_report_immutability.sql"

describe("consultation report immutability trigger (US-2605)", () => {
  for (const path of [MIGRATION, REFERENCE]) {
    it(`${path} installe le trigger append-only column-scoped`, () => {
      const sql = readFileSync(path, "utf8")
      expect(sql).toContain("CREATE TRIGGER consultation_report_addenda_immutable")
      expect(sql).toContain("BEFORE UPDATE OR DELETE ON")
      // DELETE interdit.
      expect(sql).toMatch(/TG_OP = 'DELETE'[\s\S]*RAISE EXCEPTION/)
      // UPDATE bloqué si le contenu/ancrage change (tout sauf soft-delete).
      expect(sql).toContain('NEW."content" IS DISTINCT FROM OLD."content"')
      expect(sql).toContain('NEW."data_as_of" IS DISTINCT FROM OLD."data_as_of"')
      // `deleted_at` n'est PAS dans la liste des colonnes gelées → soft-delete permis.
      expect(sql).not.toContain('NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at"')
    })
  }
})
