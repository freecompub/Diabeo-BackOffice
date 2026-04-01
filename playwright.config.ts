import { defineConfig } from "@playwright/test"

/**
 * Playwright E2E configuration for Diabeo Backoffice.
 *
 * Prerequisites:
 *   1. PostgreSQL running (docker compose --profile local up)
 *   2. .env file configured (copy .env.example, fill DATABASE_URL + NEXTAUTH_SECRET)
 *   3. Prisma migrations applied (pnpm prisma migrate dev)
 *   4. System deps for Chromium (sudo pnpm exec playwright install-deps chromium)
 *
 * Run: pnpm test:e2e
 * Run with UI: pnpm test:e2e:ui
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
