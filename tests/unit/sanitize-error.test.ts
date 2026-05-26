/**
 * Tests pour `sanitizeError` + `logHookError` helpers
 * (Fix H7 round 1 review PR #443).
 *
 * Couvre :
 *   - Email scrub : single + multiple + various TLDs
 *   - Phone scrub : FR 10 digits + international + parentheses
 *   - NIRPP scrub : SS FR 15 chars
 *   - Combinations
 *   - Empty / non-string input
 *   - logHookError : NODE_ENV gating + sanitize avant console.warn
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { sanitizeError, logHookError } from "@/lib/ui/sanitize-error"

describe("sanitizeError", () => {
  it("scrub email simple", () => {
    expect(sanitizeError("Invalid: john@example.com not found"))
      .toBe("Invalid: [REDACTED-email] not found")
  })

  it("scrub multiple emails", () => {
    expect(sanitizeError("From a@x.com to b@y.fr — both invalid"))
      .toBe("From [REDACTED-email] to [REDACTED-email] — both invalid")
  })

  it("scrub email avec subdomain + plus", () => {
    expect(sanitizeError("Bounce: user.name+filter@sub.example.co.uk"))
      .toBe("Bounce: [REDACTED-email]")
  })

  it("scrub phone FR 10 digits", () => {
    expect(sanitizeError("Patient tel: 0612345678"))
      .toBe("Patient tel: [REDACTED-phone]")
  })

  it("scrub phone international +33", () => {
    expect(sanitizeError("Try +33 6 12 34 56 78"))
      .toBe("Try [REDACTED-phone]")
  })

  it("scrub NIRPP FR (15 digits contigus)", () => {
    // NIRPP format = 13 digits + 2 digit key = 15 total contigus
    expect(sanitizeError("NIRPP 185041234567890 not found"))
      .toBe("NIRPP [REDACTED-nirpp] not found")
  })

  it("scrub combination email + phone", () => {
    expect(sanitizeError("Contact john@x.com / 0612345678"))
      .toContain("[REDACTED-email]")
    expect(sanitizeError("Contact john@x.com / 0612345678"))
      .toContain("[REDACTED-phone]")
  })

  it("empty string → empty string", () => {
    expect(sanitizeError("")).toBe("")
  })

  it("non-string input → empty string", () => {
    // @ts-expect-error testing runtime safety
    expect(sanitizeError(null)).toBe("")
    // @ts-expect-error testing runtime safety
    expect(sanitizeError(undefined)).toBe("")
    // @ts-expect-error testing runtime safety
    expect(sanitizeError(42)).toBe("")
  })

  it("message sans PII → unchanged", () => {
    expect(sanitizeError("Network timeout after 5s"))
      .toBe("Network timeout after 5s")
  })
})

describe("logHookError", () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
  })

  it("dev mode (NODE_ENV !== production) → console.warn appelé + sanitized", () => {
    vi.stubEnv("NODE_ENV", "development")
    try {
      logHookError("testHook", new Error("Failed: john@x.com timed out"))
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[testHook] error:",
        "Failed: [REDACTED-email] timed out",
      )
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it("prod mode → console.warn SKIPPED", () => {
    vi.stubEnv("NODE_ENV", "production")
    try {
      logHookError("testHook", new Error("Failed"))
      expect(consoleWarnSpy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it("non-Error thrown → log type uniquement (pas message PII)", () => {
    vi.stubEnv("NODE_ENV", "development")
    try {
      logHookError("testHook", "string thrown — could contain PII john@x.com")
      expect(consoleWarnSpy).toHaveBeenCalledWith("[testHook] non-error thrown:", "string")
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
