import { defineConfig } from "@playwright/test"

/**
 * Config Playwright dédiée aux tests manuels / exploratoires dans
 * `tests/manual/`. Séparée du config CI pour ne pas polluer le runner.
 *
 * Lancement :
 *   pnpm exec playwright test --config=playwright.manual.config.ts --headed
 *   pnpm exec playwright test --config=playwright.manual.config.ts tests/manual/<feature>.spec.ts --headed
 *
 * Différences vs `playwright.config.ts` :
 *   - `testDir` pointe sur `tests/manual` (au lieu de `tests/e2e`)
 *   - `webServer` désactivé : on suppose un `pnpm dev` déjà lancé,
 *     pour pouvoir partager la session active du dev (pas de redémarrage)
 *   - `retries: 0` même en CI (les tests manuels ne sont jamais en CI)
 *   - `reporter: list` toujours (pas de github reporter)
 */
export default defineConfig({
  testDir: "./tests/manual",
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
  // Pas de webServer : on assume que `pnpm dev` tourne déjà.
})
