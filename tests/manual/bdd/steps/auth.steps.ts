import { createBdd } from "playwright-bdd"
import { loginAs, type SeedUserRole } from "../../../e2e/helpers/auth"

const { Given } = createBdd()

/**
 * Mapping rôle QA (libellé Gherkin) → utilisateur de seed.
 * Voir docs/qa/README.md §4 (comptes de seed) et prisma/seed.ts.
 */
const ROLE_MAP: Record<string, SeedUserRole> = {
  ADMIN: "admin",
  DOCTOR: "doctor",
  NURSE: "nurse",
  VIEWER: "patient_dt1",
}

Given(
  "je suis connecté en tant que {string}",
  async ({ context, request }, role: string) => {
    const seed = ROLE_MAP[role]
    if (!seed) {
      throw new Error(
        `Rôle QA inconnu : "${role}" (attendu ADMIN | DOCTOR | NURSE | VIEWER)`,
      )
    }
    await loginAs(context, request, seed)
  },
)
