/**
 * Test suite: staging-guard (US-prisma7-finalize, follow-up)
 *
 * Behavior tested:
 * - `isStagingEnv()` open en staging (`APP_ENV=staging`).
 * - `isStagingEnv()` open en dev local (`NODE_ENV=development`).
 * - `isStagingEnv()` fermé en prod (`NODE_ENV=production` sans APP_ENV).
 * - `isStagingEnv()` fermé en test (NODE_ENV=test) — pas de dépendance
 *   accidentelle aux APIs externes dans la CI.
 *
 * Risk mitigated:
 * - Une régression qui ouvrirait la sync MyDiabby en production permettrait
 *   un import de PHI depuis un compte tiers non audité → fuite RGPD.
 * - Une régression qui la fermerait en dev local empêcherait le test
 *   manuel des imports → goulot d'étranglement DevX.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { isStagingEnv } from "@/lib/staging-guard"

// `process.env.NODE_ENV` est typé readonly par @types/node — cast via une
// vue Record local pour pouvoir le muter en test.
const env = process.env as Record<string, string | undefined>

describe("staging-guard.isStagingEnv", () => {
  const originalAppEnv = env.APP_ENV
  const originalNodeEnv = env.NODE_ENV

  beforeEach(() => {
    delete env.APP_ENV
    delete env.NODE_ENV
  })

  afterEach(() => {
    if (originalAppEnv === undefined) delete env.APP_ENV
    else env.APP_ENV = originalAppEnv
    if (originalNodeEnv === undefined) delete env.NODE_ENV
    else env.NODE_ENV = originalNodeEnv
  })

  it("returns true when APP_ENV === 'staging'", () => {
    env.APP_ENV = "staging"
    env.NODE_ENV = "production" // staging VPS = NODE_ENV=production + APP_ENV=staging
    expect(isStagingEnv()).toBe(true)
  })

  it("returns true when NODE_ENV === 'development' (local pnpm dev)", () => {
    env.NODE_ENV = "development"
    expect(isStagingEnv()).toBe(true)
  })

  it("returns false in production (no APP_ENV, NODE_ENV=production)", () => {
    env.NODE_ENV = "production"
    expect(isStagingEnv()).toBe(false)
  })

  it("returns false in test (NODE_ENV=test)", () => {
    env.NODE_ENV = "test"
    expect(isStagingEnv()).toBe(false)
  })
})
