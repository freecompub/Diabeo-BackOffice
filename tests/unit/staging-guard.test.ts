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
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { isStagingEnv } from "@/lib/staging-guard"

describe("staging-guard.isStagingEnv", () => {
  beforeEach(() => {
    // vi.stubEnv est thread-safe (scoped à ce test seulement) — vi.unstubAllEnvs
    // dans afterEach restore l'état initial proprement, contrairement à une
    // mutation directe de process.env qui pourrait fuiter en parallèle.
    vi.stubEnv("APP_ENV", "")
    vi.stubEnv("NODE_ENV", "")
    vi.stubEnv("DIABEO_ALLOW_LOCAL_MYDIABBY", "")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("returns true when APP_ENV === 'staging'", () => {
    vi.stubEnv("APP_ENV", "staging")
    vi.stubEnv("NODE_ENV", "production") // staging VPS = NODE_ENV=production + APP_ENV=staging
    expect(isStagingEnv()).toBe(true)
  })

  it("returns true when NODE_ENV === 'development' AND opt-in (DIABEO_ALLOW_LOCAL_MYDIABBY=1)", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("DIABEO_ALLOW_LOCAL_MYDIABBY", "1")
    expect(isStagingEnv()).toBe(true)
  })

  it("returns FALSE in dev local without opt-in (H4 — opt-in explicite requis)", () => {
    vi.stubEnv("NODE_ENV", "development")
    // DIABEO_ALLOW_LOCAL_MYDIABBY non set → gate fermée par défaut.
    expect(isStagingEnv()).toBe(false)
  })

  it("returns false in dev local with malformed opt-in (e.g. 'true' instead of '1')", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("DIABEO_ALLOW_LOCAL_MYDIABBY", "true")
    expect(isStagingEnv()).toBe(false)
  })

  it("returns false in production (no APP_ENV, NODE_ENV=production)", () => {
    vi.stubEnv("NODE_ENV", "production")
    expect(isStagingEnv()).toBe(false)
  })

  it("ignores DIABEO_ALLOW_LOCAL_MYDIABBY in production (defense in depth)", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("DIABEO_ALLOW_LOCAL_MYDIABBY", "1")
    expect(isStagingEnv()).toBe(false)
  })

  it("returns false in test (NODE_ENV=test)", () => {
    vi.stubEnv("NODE_ENV", "test")
    expect(isStagingEnv()).toBe(false)
  })
})
