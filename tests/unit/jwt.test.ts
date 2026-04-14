/**
 * Tests for JWT signing and verification (src/lib/auth/jwt.ts).
 *
 * Clinical safety context: JWT is the primary authentication mechanism.
 * Correct validation of claims (sub, role, sid, exp) ensures that only
 * properly authenticated users can access patient health data.
 * The exp field is critical for session revocation TTL calculation.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { generateKeyPair } from "crypto"
import { promisify } from "util"

const generateKeyPairAsync = promisify(generateKeyPair)

// Generate RSA keys for testing
let privateKeyPem: string
let publicKeyPem: string

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPairAsync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  })
  privateKeyPem = privateKey as string
  publicKeyPem = publicKey as string

  process.env.JWT_PRIVATE_KEY = privateKeyPem
  process.env.JWT_PUBLIC_KEY = publicKeyPem
})

// Dynamic import after env vars are set
let signJwt: typeof import("@/lib/auth/jwt").signJwt
let verifyJwt: typeof import("@/lib/auth/jwt").verifyJwt
let verifyJwtAllowExpired: typeof import("@/lib/auth/jwt").verifyJwtAllowExpired
let signMfaPendingToken: typeof import("@/lib/auth/jwt").signMfaPendingToken
let verifyMfaPendingToken: typeof import("@/lib/auth/jwt").verifyMfaPendingToken

beforeAll(async () => {
  const mod = await import("@/lib/auth/jwt")
  signJwt = mod.signJwt
  verifyJwt = mod.verifyJwt
  verifyJwtAllowExpired = mod.verifyJwtAllowExpired
  signMfaPendingToken = mod.signMfaPendingToken
  verifyMfaPendingToken = mod.verifyMfaPendingToken
})

describe("JWT signing and verification", () => {
  const validPayload = {
    sub: 42,
    role: "DOCTOR" as const,
    platform: "hc" as const,
    sid: "session-abc-123",
  }

  describe("signJwt + verifyJwt roundtrip", () => {
    it("signs and verifies a valid JWT", async () => {
      const token = await signJwt(validPayload)

      expect(typeof token).toBe("string")
      expect(token.split(".")).toHaveLength(3)

      const verified = await verifyJwt(token)

      expect(verified.sub).toBe(42)
      expect(verified.role).toBe("DOCTOR")
      expect(verified.platform).toBe("hc")
      expect(verified.sid).toBe("session-abc-123")
    })

    it("includes exp field in verified payload", async () => {
      const token = await signJwt(validPayload)
      const verified = await verifyJwt(token)

      expect(verified.exp).toBeDefined()
      expect(typeof verified.exp).toBe("number")
      // exp should be ~24h from now
      const nowSec = Math.floor(Date.now() / 1000)
      expect(verified.exp).toBeGreaterThan(nowSec)
      expect(verified.exp).toBeLessThanOrEqual(nowSec + 24 * 3600 + 5)
    })
  })

  describe("verifyJwt validation", () => {
    it("rejects a token with tampered signature", async () => {
      const token = await signJwt(validPayload)
      const tampered = token.slice(0, -5) + "XXXXX"

      await expect(verifyJwt(tampered)).rejects.toThrow()
    })

    it("rejects a completely invalid token", async () => {
      await expect(verifyJwt("not.a.jwt")).rejects.toThrow()
    })

    it("rejects an empty string", async () => {
      await expect(verifyJwt("")).rejects.toThrow()
    })
  })

  describe("verifyJwtAllowExpired", () => {
    it("verifies a valid non-expired token", async () => {
      const token = await signJwt(validPayload)
      const verified = await verifyJwtAllowExpired(token)

      expect(verified.sub).toBe(42)
      expect(verified.sid).toBe("session-abc-123")
      expect(verified.exp).toBeDefined()
    })

    it("rejects a tampered token even with clock tolerance", async () => {
      const token = await signJwt(validPayload)
      const tampered = token.slice(0, -5) + "XXXXX"

      await expect(verifyJwtAllowExpired(tampered)).rejects.toThrow(
        "Invalid token",
      )
    })
  })

  describe("JWTPayload type contract", () => {
    it("exp is always a positive finite number", async () => {
      const token = await signJwt(validPayload)
      const verified = await verifyJwt(token)

      expect(Number.isFinite(verified.exp)).toBe(true)
      expect(verified.exp).toBeGreaterThan(0)
    })

    it("preserves all RBAC roles through sign/verify", async () => {
      for (const role of ["ADMIN", "DOCTOR", "NURSE", "VIEWER"] as const) {
        const token = await signJwt({ ...validPayload, role })
        const verified = await verifyJwt(token)
        expect(verified.role).toBe(role)
      }
    })
  })

  /**
   * Cross-confusion attack tests: a full-access JWT must NEVER be accepted as
   * an mfa-pending token, and vice versa. Both checks rely on jose's audience
   * verification; the dedicated tests below harden the contract against any
   * future refactor that might forget to thread the audience constants.
   */
  describe("audience cross-confusion (defense in depth)", () => {
    it("verifyMfaPendingToken REJECTS a full-access JWT (audience mismatch)", async () => {
      const fullToken = await signJwt(validPayload)
      await expect(verifyMfaPendingToken(fullToken)).rejects.toThrow()
    })

    it("verifyJwt REJECTS an mfa-pending token (audience mismatch)", async () => {
      const pendingToken = await signMfaPendingToken(42)
      await expect(verifyJwt(pendingToken)).rejects.toThrow()
    })

    it("verifyMfaPendingToken accepts a properly-minted mfa-pending token", async () => {
      const pendingToken = await signMfaPendingToken(42)
      const verified = await verifyMfaPendingToken(pendingToken)
      expect(verified.sub).toBe(42)
      expect(verified.type).toBe("mfa_pending")
    })
  })
})
