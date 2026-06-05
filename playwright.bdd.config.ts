import { defineConfig } from "@playwright/test"
import { defineBddConfig } from "playwright-bdd"

/**
 * Config Playwright-BDD — preuve de concept "Gherkin exécutable".
 *
 * Rangée avec les tests **MANUELS** (`tests/manual/bdd/`) :
 *   - PAS de `webServer` : on suppose un `pnpm dev` déjà lancé (comme
 *     `playwright.manual.config.ts`) ;
 *   - JAMAIS en CI (nécessite base + dev server + navigateur complet).
 *
 * Les `.feature` sont la source de vérité (extraits du plan QA `docs/qa/`).
 * `bddgen` génère des specs Playwright à partir des `.feature` + des step
 * definitions, puis `playwright test` les exécute.
 *
 * Usage :
 *   pnpm bdd:gen     # génère les specs (dossier .features-gen, gitignoré)
 *   pnpm bdd:test    # bddgen + exécution
 *
 * Pré-requis navigateur (sandbox sans GUI) : voir tests/manual/bdd/README.md.
 */
const testDir = defineBddConfig({
  features: "tests/manual/bdd/features/**/*.feature",
  steps: "tests/manual/bdd/steps/**/*.ts",
})

export default defineConfig({
  testDir,
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
})
