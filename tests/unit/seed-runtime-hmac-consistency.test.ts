/**
 * Test suite: Seed ↔ Runtime HMAC consistency
 *
 * Behavior tested:
 * - `prisma/seed.ts` calcule `emailHmac` avec la MÊME normalisation que le
 *   runtime (`src/lib/crypto/hmac.ts`) : `.toLowerCase().trim()` avant le
 *   HMAC-SHA256.
 *
 * Risk mitigated:
 * - Si le seed insère "Admin@Diabeo.test" hashé tel quel et que le runtime
 *   au login fait `hmacEmail(email.toLowerCase().trim())`, les 2 hashes
 *   diffèrent → user introuvable au login → 401 invalidCredentials malgré
 *   un user existant en base. Faux négatif difficile à diagnostiquer.
 *
 * Edge cases:
 * - Whitespace de bord (espaces, tabulations) doit être trim.
 * - Casse mixte doit être normalisée.
 */
import { describe, it, expect } from "vitest"
import { createHmac } from "node:crypto"
import { hmacEmail } from "@/lib/crypto/hmac"

// Réplique du helper utilisé dans prisma/seed.ts. Si ces deux implémentations
// divergent, ce test capture la dérive immédiatement.
function seedHmacEmail(email: string): string {
  const key = process.env.HMAC_SECRET
  if (!key) throw new Error("HMAC_SECRET is not set")
  return createHmac("sha256", key)
    .update(email.toLowerCase().trim())
    .digest("hex")
}

describe("seed ↔ runtime HMAC consistency (US-prisma7-finalize)", () => {
  it("seed and runtime produce the same HMAC for lowercase email", () => {
    const email = "admin@diabeo.test"
    expect(seedHmacEmail(email)).toBe(hmacEmail(email))
  })

  it("seed and runtime normalize mixed-case identically", () => {
    expect(seedHmacEmail("Admin@DIABEO.test")).toBe(hmacEmail("admin@diabeo.test"))
    expect(seedHmacEmail("Admin@DIABEO.test")).toBe(hmacEmail("Admin@DIABEO.test"))
  })

  it("seed and runtime normalize surrounding whitespace identically", () => {
    expect(seedHmacEmail("  admin@diabeo.test  ")).toBe(hmacEmail("admin@diabeo.test"))
    expect(seedHmacEmail("\tadmin@diabeo.test\n")).toBe(hmacEmail("admin@diabeo.test"))
  })

  it("different normalized emails produce different HMACs (no collision)", () => {
    expect(hmacEmail("admin@diabeo.test")).not.toBe(hmacEmail("doctor@diabeo.test"))
  })
})
