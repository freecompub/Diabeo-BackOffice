/**
 * @vitest-environment node
 */

/** Tests — gate du mode dev mocké (US-2270). */

import { describe, it, expect, vi, afterEach } from "vitest"
import { isDevMocked, isMockFlagOn, isFlagTrue } from "@/lib/mocks/dev-mock"

afterEach(() => vi.unstubAllEnvs())

describe("isDevMocked", () => {
  it("JAMAIS en production (même clé absente)", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("RESEND_API_KEY", "")
    expect(isDevMocked("RESEND_API_KEY")).toBe(false)
  })

  it("JAMAIS en production même si MOCK_MODE=true (flag résiduel)", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("MOCK_MODE", "true")
    vi.stubEnv("RESEND_API_KEY", "")
    expect(isDevMocked("RESEND_API_KEY")).toBe(false)
  })

  it("JAMAIS sur staging (NODE_ENV=production + APP_ENV=staging) → vrais services", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("APP_ENV", "staging")
    vi.stubEnv("MOCK_MODE", "true")
    vi.stubEnv("RESEND_API_KEY", "")
    expect(isDevMocked("RESEND_API_KEY")).toBe(false)
  })

  it("fail-safe : NODE_ENV absent → pas de stub (traité comme prod)", () => {
    vi.stubEnv("NODE_ENV", undefined)
    vi.stubEnv("MOCK_MODE", "true")
    vi.stubEnv("RESEND_API_KEY", "")
    expect(isDevMocked("RESEND_API_KEY")).toBe(false)
  })

  it("development + clé absente → mocké", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("RESEND_API_KEY", "")
    expect(isDevMocked("RESEND_API_KEY")).toBe(true)
  })

  it("MOCK_MODE=true (hors prod) → mocké même si la clé est présente", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("MOCK_MODE", "true")
    vi.stubEnv("RESEND_API_KEY", "re_real_key")
    expect(isDevMocked("RESEND_API_KEY")).toBe(true)
  })

  it("development + clé présente sans MOCK_MODE → service réel", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("MOCK_MODE", "")
    vi.stubEnv("RESEND_API_KEY", "re_real_key")
    expect(isDevMocked("RESEND_API_KEY")).toBe(false)
  })

  it("env test (vitest) sans MOCK_MODE → PAS de stub (vrai chemin)", () => {
    vi.stubEnv("NODE_ENV", "test")
    vi.stubEnv("RESEND_API_KEY", "")
    expect(isDevMocked("RESEND_API_KEY")).toBe(false)
  })
})

describe("isMockFlagOn", () => {
  it("JAMAIS en production même si le flag est présent", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("MOCK_ANTIVIRUS", "true")
    expect(isMockFlagOn("MOCK_ANTIVIRUS")).toBe(false)
  })

  it("JAMAIS en production même si MOCK_MODE=true", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("MOCK_MODE", "true")
    expect(isMockFlagOn("MOCK_ANTIVIRUS")).toBe(false)
  })

  it("fail-safe : NODE_ENV absent → false (traité comme prod)", () => {
    vi.stubEnv("NODE_ENV", undefined)
    vi.stubEnv("MOCK_ANTIVIRUS", "true")
    expect(isMockFlagOn("MOCK_ANTIVIRUS")).toBe(false)
  })

  it("development + flag=true → actif", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("MOCK_ANTIVIRUS", "true")
    expect(isMockFlagOn("MOCK_ANTIVIRUS")).toBe(true)
  })

  it("development + MOCK_MODE=true (flag absent) → actif", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("MOCK_MODE", "true")
    vi.stubEnv("MOCK_ANTIVIRUS", "")
    expect(isMockFlagOn("MOCK_ANTIVIRUS")).toBe(true)
  })

  it("development sans aucun flag → inactif (vrai scan)", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("MOCK_MODE", "")
    vi.stubEnv("MOCK_ANTIVIRUS", "")
    expect(isMockFlagOn("MOCK_ANTIVIRUS")).toBe(false)
  })

  it("env test + flag=true → actif (asymétrie assumée vs isDevMocked)", () => {
    vi.stubEnv("NODE_ENV", "test")
    vi.stubEnv("MOCK_ANTIVIRUS", "true")
    expect(isMockFlagOn("MOCK_ANTIVIRUS")).toBe(true)
  })

  it("capte les variantes de casse/format (TRUE, 1, yes)", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("MOCK_MODE", "")
    for (const v of ["TRUE", "True", " true ", "1", "yes", "YES"]) {
      vi.stubEnv("MOCK_ANTIVIRUS", v)
      expect(isMockFlagOn("MOCK_ANTIVIRUS")).toBe(true)
    }
  })
})

describe("isFlagTrue", () => {
  it("vrai pour true/1/yes insensible à la casse et aux espaces", () => {
    for (const v of ["true", "TRUE", " True ", "1", "yes", "YES"]) {
      expect(isFlagTrue(v)).toBe(true)
    }
  })

  it("faux pour absent/vide/valeurs non vraies", () => {
    for (const v of [undefined, "", "false", "0", "no", "off", "2"]) {
      expect(isFlagTrue(v)).toBe(false)
    }
  })
})
