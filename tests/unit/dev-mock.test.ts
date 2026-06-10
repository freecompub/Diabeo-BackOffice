/**
 * @vitest-environment node
 */

/** Tests — gate du mode dev mocké (US-2270). */

import { describe, it, expect, vi, afterEach } from "vitest"
import { isDevMocked } from "@/lib/mocks/dev-mock"

afterEach(() => vi.unstubAllEnvs())

describe("isDevMocked", () => {
  it("JAMAIS en production (même clé absente)", () => {
    vi.stubEnv("NODE_ENV", "production")
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
