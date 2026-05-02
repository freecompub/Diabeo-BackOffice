/**
 * Test suite: HMAC — field hashing for searchable encryption
 *
 * Clinical behavior tested:
 * - hmacField produces deterministic 64-char hex output
 * - hmacField normalizes case and whitespace
 * - hmacEmail delegates to hmacField (backwards-compatible)
 * - Different inputs produce different hashes
 */
import { describe, it, expect } from "vitest"
import { hmacEmail, hmacField } from "@/lib/crypto/hmac"

describe("hmacField", () => {
  it("returns 64-char hex string", () => {
    const result = hmacField("Dupont")
    expect(result).toMatch(/^[0-9a-f]{64}$/)
  })

  it("normalizes case (lowercase)", () => {
    expect(hmacField("DUPONT")).toBe(hmacField("dupont"))
  })

  it("normalizes whitespace (trim)", () => {
    expect(hmacField("  Dupont  ")).toBe(hmacField("Dupont"))
  })

  it("produces different hashes for different inputs", () => {
    expect(hmacField("Dupont")).not.toBe(hmacField("Martin"))
  })

  it("is deterministic", () => {
    expect(hmacField("test")).toBe(hmacField("test"))
  })
})

describe("hmacEmail", () => {
  it("delegates to hmacField", () => {
    expect(hmacEmail("Test@Example.COM")).toBe(hmacField("test@example.com"))
  })
})

describe("hmacField — missing secret", () => {
  it("throws when HMAC_SECRET is not set", () => {
    const original = process.env.HMAC_SECRET
    delete process.env.HMAC_SECRET
    try {
      expect(() => hmacField("test")).toThrow("HMAC_SECRET is not set")
    } finally {
      process.env.HMAC_SECRET = original
    }
  })
})
