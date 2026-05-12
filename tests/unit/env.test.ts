/**
 * Test suite: env early-fail validation
 *
 * Behavior tested:
 * - `assertRequiredEnv()` throws avec message clair quand une variable
 *   requise est manquante.
 * - Format validations (HEX 64 chars, PEM, length min) sont vérifiées
 *   après la présence.
 * - Messages d'erreur référencent docs/local-development.md §3 pour
 *   guider l'opérateur.
 *
 * Risk mitigated:
 * - Boot silencieux avec secret manquant → 503 au login (cause initiale
 *   du fix #7 de cette PR). Le helper doit attraper ça AU DÉMARRAGE.
 * - Un secret mal formé (hex trop court, PEM tronqué) doit throw avant
 *   le premier `encrypt()` ou `signJwt()`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { assertRequiredEnv } from "@/lib/env"

// Valeurs valides — utilisées comme baseline pour tester un seul champ
// invalide à la fois.
const VALID_ENCRYPT_KEY =
  "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2"
const VALID_HMAC = "test-hmac-secret-32-bytes-long-x" // exactement 32 chars
const VALID_PRIV_PEM = "-----BEGIN PRIVATE KEY-----\nXXX\n-----END PRIVATE KEY-----"
const VALID_PUB_PEM = "-----BEGIN PUBLIC KEY-----\nXXX\n-----END PUBLIC KEY-----"

function setupValidEnv() {
  vi.stubEnv("DATABASE_URL", "postgresql://x:y@localhost:5432/z")
  vi.stubEnv("HEALTH_DATA_ENCRYPTION_KEY", VALID_ENCRYPT_KEY)
  vi.stubEnv("HMAC_SECRET", VALID_HMAC)
  vi.stubEnv("JWT_PRIVATE_KEY", VALID_PRIV_PEM)
  vi.stubEnv("JWT_PUBLIC_KEY", VALID_PUB_PEM)
}

describe("assertRequiredEnv", () => {
  beforeEach(() => setupValidEnv())
  afterEach(() => vi.unstubAllEnvs())

  it("does not throw when all required vars are set and valid", () => {
    expect(() => assertRequiredEnv()).not.toThrow()
  })

  it("throws when DATABASE_URL is missing", () => {
    vi.stubEnv("DATABASE_URL", "")
    expect(() => assertRequiredEnv()).toThrow(/DATABASE_URL is missing or empty/)
  })

  it("throws when DATABASE_URL is only whitespace", () => {
    vi.stubEnv("DATABASE_URL", "   ")
    expect(() => assertRequiredEnv()).toThrow(/DATABASE_URL is missing or empty/)
  })

  it("rejects HEALTH_DATA_ENCRYPTION_KEY with wrong length (32 chars instead of 64)", () => {
    vi.stubEnv("HEALTH_DATA_ENCRYPTION_KEY", "a".repeat(32))
    expect(() => assertRequiredEnv()).toThrow(/64 hex chars/)
  })

  it("rejects HEALTH_DATA_ENCRYPTION_KEY with non-hex chars", () => {
    vi.stubEnv("HEALTH_DATA_ENCRYPTION_KEY", "z".repeat(64))
    expect(() => assertRequiredEnv()).toThrow(/64 hex chars/)
  })

  it("rejects HMAC_SECRET shorter than 32 chars", () => {
    vi.stubEnv("HMAC_SECRET", "too-short")
    expect(() => assertRequiredEnv()).toThrow(/at least 32 characters/)
  })

  it("rejects JWT_PRIVATE_KEY without PEM markers", () => {
    vi.stubEnv("JWT_PRIVATE_KEY", "not-a-pem-key")
    expect(() => assertRequiredEnv()).toThrow(/PEM-encoded RSA private key/)
  })

  it("rejects JWT_PUBLIC_KEY without PEM markers", () => {
    vi.stubEnv("JWT_PUBLIC_KEY", "not-a-pem-key")
    expect(() => assertRequiredEnv()).toThrow(/PEM-encoded RSA public key/)
  })

  it("error message references docs/local-development.md §3", () => {
    vi.stubEnv("DATABASE_URL", "")
    try {
      assertRequiredEnv()
      throw new Error("expected throw")
    } catch (err) {
      expect((err as Error).message).toMatch(/docs\/local-development\.md/)
    }
  })

  it("collects ALL problems before throwing (not just the first)", () => {
    vi.stubEnv("DATABASE_URL", "")
    vi.stubEnv("HMAC_SECRET", "")
    try {
      assertRequiredEnv()
      throw new Error("expected throw")
    } catch (err) {
      expect((err as Error).message).toMatch(/DATABASE_URL/)
      expect((err as Error).message).toMatch(/HMAC_SECRET/)
    }
  })

  it("is idempotent (multiple calls with same valid env both pass)", () => {
    expect(() => assertRequiredEnv()).not.toThrow()
    expect(() => assertRequiredEnv()).not.toThrow()
  })
})
